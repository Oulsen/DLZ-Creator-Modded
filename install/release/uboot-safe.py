"""Make Debian U-Boot's built-in default environment safe for the DLZ (same-length patches).

Our cards bring a uboot.env that limits U-Boot to the SD card. If that file cannot be read (FAT
damaged by a pulled card or power loss, a card quick-formatted in Windows that still has U-Boot at
8 KiB), U-Boot falls back to its built-in defaults: boot_targets="fel mmc_auto scsi0 usb0 pxe dhcp"
would then try the eMMC next and boot the stock system with the Banana Pi device tree, and
preboot="usb start" drives the Banana Pi's USB power pin. Patched defaults:
  boot_targets  -> "mmc0" (padded with spaces): only ever the SD card; nothing bootable = U-Boot
                   stops at its prompt (no input devices), it never boots the eMMC
  preboot       -> "echo safe": no USB start
bootcmd is unchanged ("run distro_bootcmd"), so a normal boot behaves exactly as before.

Built-in device tree (the Banana Pi's, appended to U-Boot proper): its GMAC /soc/ethernet@1c50000
is "okay", so U-Boot's network start would mux PA0-PA16 to the GMAC (on the DLZ, PA13 enables USB0
power). Mackie's tree has that GMAC disabled. Patched:
  status "okay" -> "fail" in that node only (same length): U-Boot binds only "okay" nodes, so the
                   GMAC is never probed (no pinmux, no PHY supply request; the SPL switches dc1sw
                   on with DCDC1 anyway, as Mackie's own U-Boot does).

U-Boot proper is a legacy uImage inside u-boot-sunxi-with-spl.bin (32 KiB after the SPL start):
both of its CRCs are recalculated, and the result is checked.

Usage: python3 uboot-safe.py <u-boot-sunxi-with-spl.bin> <out .bin>
"""
import struct
import sys
import zlib

UIMAGE_OFFSET = 0x8000
IH_MAGIC = 0x27051956
PATCHES = [
    (b"\x00boot_targets=fel mmc_auto scsi0 usb0 pxe dhcp \x00", b"mmc0"),
    (b"\x00preboot=usb start\x00", b"echo safe"),
]


FDT_MAGIC = 0xD00DFEED
GMAC_NODE = "/soc/ethernet@1c50000"


def fdt_status_props(img, start, end):
    """Every valid FDT between start and end: (offset, {node path: offset of its status value})."""
    found = []
    i = img.find(struct.pack(">I", FDT_MAGIC), start, end)
    while i >= 0:
        total, ostruct, ostrings, _, version, _, _, _, sstruct = struct.unpack(">9I", img[i + 4:i + 40])
        if version == 17 and i + total <= end and ostruct + sstruct <= total and ostrings <= total:
            path, status, p = [], {}, i + ostruct
            while True:
                tok = struct.unpack(">I", img[p:p + 4])[0]
                p += 4
                if tok == 1:  # BEGIN_NODE
                    n = img.index(b"\0", p)
                    path.append(img[p:n].decode())
                    p = (n + 4) & ~3
                elif tok == 2:  # END_NODE
                    path.pop()
                elif tok == 3:  # PROP
                    plen, nameoff = struct.unpack(">2I", img[p:p + 8])
                    s = i + ostrings + nameoff
                    if img[s:img.index(b"\0", s)] == b"status":
                        key = "/" + "/".join(path[1:])
                        if key in status:
                            sys.exit(f"{key}: two status properties: refusing")
                        status[key] = (p + 8, plen)
                    p = (p + 8 + plen + 3) & ~3
                elif tok == 4:  # NOP
                    pass
                elif tok == 9:  # END
                    break
                else:
                    sys.exit(f"FDT at {i:#x}: bad token {tok:#x}: refusing")
            found.append((i, status))
        i = img.find(struct.pack(">I", FDT_MAGIC), i + 4, end)
    return found


def check_uimage(img, off):
    hdr = bytearray(img[off:off + 64])
    magic, hcrc, _, size, _, _, dcrc = struct.unpack(">7I", hdr[:28])
    if magic != IH_MAGIC:
        sys.exit(f"no uImage at {off:#x}")
    hdr[4:8] = b"\0\0\0\0"
    data = img[off + 64:off + 64 + size]
    return size, zlib.crc32(bytes(hdr)) == hcrc, zlib.crc32(data) == dcrc


def main():
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    img = bytearray(open(sys.argv[1], "rb").read())
    size, hok, dok = check_uimage(img, UIMAGE_OFFSET)
    if not (hok and dok):
        sys.exit("U-Boot uImage CRCs do not match before patching: refusing")
    start, end = UIMAGE_OFFSET + 64, UIMAGE_OFFSET + 64 + size
    for entry, value in PATCHES:
        if img.count(entry) != 1:
            sys.exit(f"{entry!r} not found exactly once: refusing")
        i = img.find(entry)
        if not start <= i < end:
            sys.exit(f"{entry!r} is outside U-Boot proper: refusing")
        name, old = entry[1:-1].split(b"=", 1)
        if len(value) > len(old):
            sys.exit(f"{name.decode()}: new value longer than the old one")
        new = b"\x00" + name + b"=" + value.ljust(len(old), b" ") + b"\x00"
        img[i:i + len(entry)] = new
    fdts = fdt_status_props(img, start, end)
    if len(fdts) != 1:
        sys.exit(f"{len(fdts)} device trees in U-Boot proper, expected 1: refusing")
    fdt, status = fdts[0]
    if GMAC_NODE not in status:
        sys.exit(f"{GMAC_NODE} has no status in the device tree: refusing")
    v, plen = status[GMAC_NODE]
    if plen != 5 or img[v:v + 5] != b"okay\0":
        sys.exit(f"{GMAC_NODE} status is not \"okay\": refusing")
    before = bytes(img)
    img[v:v + 5] = b"fail\0"
    changed = [k for k in range(start, end) if before[k] != img[k]]
    if fdt_status_props(img, start, end) != fdts or changed[-4:] != list(range(v, v + 4)) \
            or any(not start <= k < fdt for k in changed[:-4]):
        sys.exit("device tree patch changed more than the GMAC status: refusing")
    # data CRC, then header CRC (computed with the header CRC field zeroed)
    struct.pack_into(">I", img, UIMAGE_OFFSET + 24, zlib.crc32(img[start:end]) & 0xFFFFFFFF)
    struct.pack_into(">I", img, UIMAGE_OFFSET + 4, 0)
    struct.pack_into(">I", img, UIMAGE_OFFSET + 4, zlib.crc32(img[UIMAGE_OFFSET:UIMAGE_OFFSET + 64]) & 0xFFFFFFFF)
    _, hok, dok = check_uimage(img, UIMAGE_OFFSET)
    if not (hok and dok):
        sys.exit("CRCs wrong after patching: refusing")
    open(sys.argv[2], "wb").write(img)
    print(f"{sys.argv[2]}: defaults boot_targets=mmc0, preboot=echo safe, {GMAC_NODE} status fail; uImage CRCs recalculated")


if __name__ == "__main__":
    main()
