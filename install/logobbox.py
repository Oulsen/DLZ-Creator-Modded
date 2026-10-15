"""Find Mackie's logo in the device's own /etc/dlz.png (stdlib only, runs on the device).

Bounding box of all pixels with luminance > 40, using Pillow's RGB->L formula, so the result is
identical to the old Pillow cut-out (ffmpeg's cropdetect averages whole rows and would trim the
faint edges). The PNG is decoded by ffmpeg. Prints shell assignments for mkvisuals.sh:
CROP=<w>:<h>:<x>:<y> and LOGO_H=<height after scaling to <logo width>>.

Usage: python3 logobbox.py <png> <logo width>
"""
import struct
import subprocess
import sys

THRESHOLD = 40


def main() -> None:
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    png, logo_w = sys.argv[1], int(sys.argv[2])
    with open(png, "rb") as f:
        head = f.read(24)
    if head[:8] != b"\x89PNG\r\n\x1a\n" or head[12:16] != b"IHDR":
        sys.exit(f"{png}: not a PNG")
    w, h = struct.unpack(">II", head[16:24])
    data = subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-i", png,
                           "-f", "rawvideo", "-pix_fmt", "rgb24", "-"],
                          check=True, capture_output=True).stdout
    if len(data) != w * h * 3:
        sys.exit(f"{png}: decoded {len(data)} bytes, expected {w}x{h} RGB24")

    x0, y0, x1, y1 = w, h, -1, -1
    stride = w * 3
    for y in range(h):
        row = data[y * stride:(y + 1) * stride]
        if max(row) <= THRESHOLD:  # L never exceeds the brightest channel: skip dark rows fast
            continue
        for x in range(w):
            r, g, b = row[3 * x], row[3 * x + 1], row[3 * x + 2]
            if (r * 19595 + g * 38470 + b * 7471 + 0x8000) >> 16 > THRESHOLD:
                x0, x1 = min(x0, x), max(x1, x)
                y0, y1 = min(y0, y), y
    if x1 < 0:
        sys.exit(f"{png}: no logo found")
    bw, bh = x1 - x0 + 1, y1 - y0 + 1
    print(f"CROP={bw}:{bh}:{x0}:{y0}")
    print(f"LOGO_H={round(bh * logo_w / bw)}")


if __name__ == "__main__":
    main()
