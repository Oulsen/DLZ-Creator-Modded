"""Replace one regular file in an uncompressed newc cpio archive (an initrd), keeping every other
entry byte for byte: no extract/repack, so headers, inode numbers and directory mtimes stay as
built. The replaced entry keeps its header except size and mtime. Anything after the trailer
(padding) is kept as is. Stdlib only (runs on the PC and in the device chroot).

Usage: python3 cpio-replace.py <in.cpio> <out.cpio> <member path> <new file> <mtime>
"""
import sys

HDR = 110          # "070701" + 13 fields of 8 hex digits
MAGIC = b"070701"
S_IFMT, S_IFREG = 0o170000, 0o100000


def pad4(n):
    return (4 - n % 4) % 4


def main():
    src, dst, member, new_file, mtime = sys.argv[1:]
    data = open(src, "rb").read()
    new = open(new_file, "rb").read()
    out = bytearray()
    pos = found = 0
    while True:
        hdr = data[pos:pos + HDR]
        if len(hdr) != HDR or hdr[:6] != MAGIC:
            sys.exit(f"{src}: no newc header at offset {pos}")
        fields = [int(hdr[6 + 8 * i:14 + 8 * i], 16) for i in range(13)]
        mode, nlink, size, namesize = fields[1], fields[4], fields[6], fields[11]
        name_end = pos + HDR + namesize
        name = data[pos + HDR:name_end - 1].decode()
        body = name_end + pad4(HDR + namesize)
        end = body + size + pad4(size)
        if name == member:
            if mode & S_IFMT != S_IFREG or nlink != 1:
                sys.exit(f"{member}: not a plain file (mode {mode:o}, nlink {nlink})")
            fields[5], fields[6] = int(mtime), len(new)
            out += MAGIC + b"".join(b"%08X" % f for f in fields)
            out += data[pos + HDR:body] + new + b"\0" * pad4(len(new))
            found += 1
        else:
            out += data[pos:end]
        pos = end
        if name == "TRAILER!!!":
            break
    if found != 1:
        sys.exit(f"{member}: found {found} times in {src}, expected once")
    out += data[pos:]
    open(dst, "wb").write(out)


if __name__ == "__main__":
    main()
