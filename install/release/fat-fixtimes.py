#!/usr/bin/env python3
"""Set the times of every entry on a FAT32 partition to one time (UTC), the volume label included.

mtools stamps each file copied onto the FAT with the build's clock (created and modified), and
neither it nor touch can set the created time: with this, the same package gives the same
installer image byte for byte (mkinstaller.sh, after filling it), whatever the build's clock and
time zone. Writes only the time fields of directory entries.
Usage: fat-fixtimes.py <image> <partition offset in bytes> <seconds since 1970>
"""
import struct
import sys
import time


def main():
    path, off, epoch = sys.argv[1], int(sys.argv[2]), int(sys.argv[3])
    if not 315532800 <= epoch < 4354819200:
        sys.exit("SOURCE_DATE_EPOCH outside what FAT can store (1980..2107)")
    tm = time.gmtime(epoch)
    date = ((tm.tm_year - 1980) << 9) | (tm.tm_mon << 5) | tm.tm_mday
    tod = (tm.tm_hour << 11) | (tm.tm_min << 5) | (tm.tm_sec // 2)
    tenth = (tm.tm_sec % 2) * 100
    with open(path, "r+b") as f:
        f.seek(off)
        bs = f.read(512)
        bps, spc, reserved, nfats = struct.unpack_from("<HBHB", bs, 11)
        total = struct.unpack_from("<I", bs, 32)[0]
        fatsz, root = struct.unpack_from("<I", bs, 36)[0], struct.unpack_from("<I", bs, 44)[0] & 0x0FFFFFFF
        if bs[510:512] != b"\x55\xaa" or bps != 512 or not spc or struct.unpack_from("<H", bs, 22)[0] != 0 or not fatsz:
            sys.exit("not a FAT32 partition at that offset")
        fat = off + reserved * bps
        data = fat + nfats * fatsz * bps
        csize = spc * bps
        nclusters = (total - reserved - nfats * fatsz) // spc + 2
        seen = set()

        def chain(c):
            while 2 <= c < nclusters and c not in seen:
                seen.add(c)
                yield c
                f.seek(fat + 4 * c)
                c = struct.unpack("<I", f.read(4))[0] & 0x0FFFFFFF

        def walk(first):
            for c in chain(first):
                pos = data + (c - 2) * csize
                f.seek(pos)
                buf = bytearray(f.read(csize))
                subdirs = []
                for i in range(0, csize, 32):
                    e = buf[i:i + 32]
                    if e[0] == 0:
                        break
                    # deleted, long-name part
                    if e[0] == 0xE5 or e[11] == 0x0F:
                        continue
                    buf[i + 13] = tenth
                    struct.pack_into("<HHH", buf, i + 14, tod, date, date)
                    struct.pack_into("<HH", buf, i + 22, tod, date)
                    if e[11] & 0x10 and e[0:2] != b". " and e[0:3] != b".. ":
                        subdirs.append(struct.unpack_from("<H", e, 20)[0] << 16 | struct.unpack_from("<H", e, 26)[0])
                f.seek(pos)
                f.write(buf)
                for d in subdirs:
                    walk(d)

        walk(root)


if __name__ == "__main__":
    main()
