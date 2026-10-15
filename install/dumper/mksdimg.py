"""Build a small SD-card image: U-Boot SPL at 8 KiB plus an MBR with one FAT32 partition.

Default (dumper): a 16 GiB partition entry, left unformatted; format it as FAT32 in Windows after
flashing (needs a card of 32 GB or more). Flashing only writes the first few MiB, the partition
entry points past them. With --part-mib the image covers the whole partition, so a caller can
format and fill it (mkfs.vfat on a loop device) and the card needs no manual format or copy step.
"""
import argparse
import struct

SPL_OFFSET = 8 * 1024          # where the Allwinner BROM looks for eGON.BT0
PART_START_SECTOR = 2048       # 1 MiB
SECTOR = 512


def build(spl: bytes, part_sectors: int, image_size: int) -> bytes:
    if spl[4:12] != b"eGON.BT0":
        raise ValueError("not an Allwinner SPL image (missing eGON.BT0 header)")
    if SPL_OFFSET + len(spl) > PART_START_SECTOR * SECTOR:
        raise ValueError("SPL/U-Boot overlaps the first partition")

    img = bytearray(image_size)
    # status 0x80 (bootable), CHS fields set to "use LBA", type 0x0C = FAT32 LBA
    img[446:462] = struct.pack("<B3sB3sII", 0x80, b"\xfe\xff\xff", 0x0C, b"\xfe\xff\xff",
                               PART_START_SECTOR, part_sectors)
    img[510:512] = b"\x55\xaa"
    img[SPL_OFFSET:SPL_OFFSET + len(spl)] = spl
    return bytes(img)


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("spl", help="u-boot-sunxi-with-spl.bin")
    ap.add_argument("output", help="image to write")
    size = ap.add_mutually_exclusive_group()
    size.add_argument("--part-gib", type=int, help="partition size, image stays 2 MiB (default 16, max 32 for Windows format)")
    size.add_argument("--part-mib", type=int, help="partition size; the image covers it, ready to format and fill")
    args = ap.parse_args()

    if args.part_mib:
        part_sectors = args.part_mib * 1024**2 // SECTOR
        image_size = PART_START_SECTOR * SECTOR + args.part_mib * 1024**2
        label = f"{args.part_mib} MiB"
    else:
        gib = args.part_gib or 16
        part_sectors = gib * 1024**3 // SECTOR
        image_size = 2 * 1024**2
        label = f"{gib} GiB"
    with open(args.spl, "rb") as f:
        img = build(f.read(), part_sectors, image_size)
    with open(args.output, "wb") as f:
        f.write(img)
    print(f"{args.output}: {len(img)} bytes, partition {label} at 1 MiB")


if __name__ == "__main__":
    main()
