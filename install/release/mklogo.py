"""Render our MODDED sticker with the version under it, as on the boot screens (mklayers.py; no
Mackie logo), for the installer screens. ui.py has no Pillow on the device, so it gets ready pixels.

Format: b"DLZL1\\n", one JSON line {"sizes": [{"for_h": screen height, "w", "h", "offset"}, ...]},
then per size w*h pixels BGRX (straight on the black screen background), row-major.

Usage: python3 mklogo.py <out logo.bin> [--version-file VERSION]
Needs: Pillow, fonts-dejavu-core
"""
import argparse
import json
import os
import sys
from pathlib import Path

from PIL import Image

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
from mklayers import (BOX_H, BOX_W, STICKER_CX, STICKER_TOP, VERSION_RIGHT, VERSION_TOP,  # noqa: E402
                      _rotate_about, _sticker, _version)
from modversion import VERSION_FILE, read_version  # noqa: E402

SCALES = {600: 0.85, 480: 0.7}   # screen height -> scale (1.0 = the boot screens' size)


def group(version):
    """Sticker + version at their boot-screen positions, on black, cropped to what is drawn."""
    canvas = Image.new("RGB", (BOX_W, BOX_H), (0, 0, 0))
    st = _sticker()
    rot, _ = _rotate_about(st, (st.width / 2, st.height / 2))
    cx, cy = STICKER_CX, STICKER_TOP + st.height / 2
    canvas.paste(rot, (round(cx - rot.width / 2), round(cy - rot.height / 2)), rot)
    ver = _version(version)
    rot, (ax, ay) = _rotate_about(ver, (ver.width, 0))
    canvas.paste(rot, (round(VERSION_RIGHT - ax), round(VERSION_TOP - ay)), rot)
    return canvas.crop(canvas.getbbox())


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("out")
    ap.add_argument("--version-file", type=Path, default=VERSION_FILE)
    args = ap.parse_args()
    img = group(read_version(args.version_file))
    sizes, blobs, offset = [], [], 0
    for for_h, scale in sorted(SCALES.items()):
        flat = img.resize((round(img.width * scale), round(img.height * scale)), Image.LANCZOS)
        r, g, b = flat.split()
        blob = Image.merge("RGBA", (b, g, r, Image.new("L", flat.size, 255))).tobytes()   # B, G, R, X
        sizes.append({"for_h": for_h, "w": flat.width, "h": flat.height, "offset": offset})
        blobs.append(blob)
        offset += len(blob)
    with open(args.out, "wb") as f:
        f.write(b"DLZL1\n" + json.dumps({"sizes": sizes}).encode() + b"\n" + b"".join(blobs))
    print(f"{args.out}: " + ", ".join(f"{z['w']}x{z['h']} for {z['for_h']}" for z in sizes))


if __name__ == "__main__":
    main()
