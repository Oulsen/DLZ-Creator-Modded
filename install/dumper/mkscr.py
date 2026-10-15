"""Wrap a plain-text U-Boot script into a legacy uImage script (boot.scr).

Equivalent to: mkimage -A arm -O linux -T script -C none -n <name> -d <in> <out>
"""
import argparse
import os
import struct
import time
import zlib

IH_MAGIC = 0x27051956
IH_OS_LINUX = 5
IH_ARCH_ARM = 2
IH_TYPE_SCRIPT = 6
IH_COMP_NONE = 0


def build(script: bytes, name: str) -> bytes:
    script = script.replace(b"\r\n", b"\n")
    data = struct.pack(">II", len(script), 0) + script
    dcrc = zlib.crc32(data) & 0xFFFFFFFF
    stamp = int(os.environ.get("SOURCE_DATE_EPOCH", time.time()))  # fixed = reproducible images

    def header(hcrc: int) -> bytes:
        return struct.pack(
            ">7I4B32s", IH_MAGIC, hcrc, stamp, len(data), 0, 0, dcrc,
            IH_OS_LINUX, IH_ARCH_ARM, IH_TYPE_SCRIPT, IH_COMP_NONE,
            name.encode()[:31].ljust(32, b"\0"),
        )

    return header(zlib.crc32(header(0)) & 0xFFFFFFFF) + data


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("input", help="plain-text U-Boot script")
    ap.add_argument("output", help="boot.scr to write")
    ap.add_argument("-n", "--name", default="DLZ script")
    args = ap.parse_args()

    with open(args.input, "rb") as f:
        out = build(f.read(), args.name)
    with open(args.output, "wb") as f:
        f.write(out)
    print(f"{args.output}: {len(out)} bytes")


if __name__ == "__main__":
    main()
