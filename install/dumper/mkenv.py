"""Write a uboot.env for our SD cards: Debian U-Boot's default environment with overrides.

Debian U-Boot (sunxi) reads its environment from uboot.env on the boot card's FAT partition
(ENV_IS_IN_FAT). A valid file replaces the whole default environment, so this copies the complete
default block out of the U-Boot binary and changes only the given variables. Our cards set
boot_targets=mmc0 so U-Boot can never fall through to the eMMC's own boot.scr (which it would boot
with the Banana Pi DTB) when our script is missing or returns.

Format: CRC32 (little-endian) of the data area, then NUL-separated var=value entries, padded to
the environment size (ENV_SIZE 0x10000). Same output as `mkenvimage -s 0x10000`.

Usage: python mkenv.py <u-boot-sunxi-with-spl.bin> <out uboot.env> [name=value ...]
"""
import re
import sys
import zlib

ENV_SIZE = 0x10000
ENTRY = re.compile(rb"^[A-Za-z_][A-Za-z0-9_.]*=[\x20-\x7e\t\n]*$")
ANCHOR = b"bootcmd=run distro_bootcmd\x00"


def default_env(uboot: bytes) -> list:
    if uboot.count(ANCHOR) != 1:
        sys.exit("default environment not found exactly once in the U-Boot binary")
    i = uboot.find(ANCHOR)
    start = i
    while True:  # walk back while the previous NUL-terminated entry still looks like name=value
        p = uboot.rfind(b"\x00", 0, start - 1)
        if p < 0 or not ENTRY.match(uboot[p + 1:start - 1]):
            break
        start = p + 1
    entries = uboot[start:uboot.find(b"\x00\x00", i)].split(b"\x00")
    if not all(ENTRY.match(e) for e in entries):
        sys.exit("default environment block looks damaged")
    return [e.decode() for e in entries]


def main() -> None:
    if len(sys.argv) < 3:
        sys.exit(__doc__)
    env = dict(e.split("=", 1) for e in default_env(open(sys.argv[1], "rb").read()))
    for override in sys.argv[3:]:
        name, value = override.split("=", 1)
        if name not in env:
            sys.exit(f"{name} is not in the default environment (typo?)")
        env[name] = value
    data = b"".join(f"{k}={v}".encode() + b"\x00" for k, v in env.items()) + b"\x00"
    if len(data) > ENV_SIZE - 4:
        sys.exit("environment too large")
    data = data.ljust(ENV_SIZE - 4, b"\x00")
    with open(sys.argv[2], "wb") as f:
        f.write(zlib.crc32(data).to_bytes(4, "little") + data)
    print(f"{sys.argv[2]}: {len(env)} variables, overrides: {' '.join(sys.argv[3:]) or 'none'}")


if __name__ == "__main__":
    main()
