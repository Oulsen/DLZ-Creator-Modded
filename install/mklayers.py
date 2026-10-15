"""Render our own boot-visual layers (no Mackie logo) for mkvisuals.sh.

Writes to <out dir>:
- marker.png: the Weston background layer (1024x600), straight-alpha RGBA
- splash.png: the kernel splash picture layer (640x260, upright), straight-alpha RGBA
- layout.env: sizes and logo positions for mkvisuals.sh (sourced by sh)

Layout: the kernel splash and the Weston marker (/etc/dlz.png) draw the same group (Mackie logo,
MODDED sticker, version, status lines) in the kernel splash's picture box: 640x260, centred on the
1024x600 screen. The splash can only draw inside that box; the marker draws the identical group at
the identical place, so nothing moves between the two. Coordinates match the approved HTML mockup
(CSS px = image px). Mackie's logo is never drawn here: mkvisuals.sh puts the device's own logo
underneath (logobbox.py finds it in /etc/dlz.png).

Each layer is drawn twice, on black and on white, and colour + alpha are recovered from the
difference; this is exact for Pillow's linear blending, so layer-over-logo equals drawing the logo
first (tested pixel-exact against the old all-Pillow pipeline). Runs on the PC (needs Pillow); the
device only composes.

Usage: python3 mklayers.py <out dir> [--version-file VERSION]
"""
import argparse
import math
import os
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

from modversion import VERSION_FILE, read_version

W, H = 1024, 600
BOX_W, BOX_H = 640, 260
BOX_X, BOX_Y = (W - BOX_W) // 2, (H - BOX_H) // 2

GREEN = (51, 255, 102)
DONE_GREEN = (31, 166, 72)
YELLOW = (255, 214, 0)
HINT_GRAY = (150, 150, 150)   # darker greys vanish on the 7" panel
MONO = "/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf"
MONO_BOLD = "/usr/share/fonts/truetype/dejavu/DejaVuSansMono-Bold.ttf"

LOGO_W, LOGO_TOP = 390, 40
STICKER_CX, STICKER_TOP = BOX_W // 2 + 219, 14   # centre x / top of the unrotated sticker
VERSION_RIGHT, VERSION_TOP = BOX_W - 39, 47      # top-right corner of the unrotated version text
TILT = 12                                        # degrees, counter-clockwise
LINES_TOP, LINE_H = 206, 36

SPLASH_LINES = [(">", "booting from microSD", "cur")]
MARKER_LINES = [("✓", "booting from microSD", "done"), (">", "starting mixer...", "cur")]
HINT = "Stuck on this screen? Power off and check the microSD card."


def _rotate_about(img: Image.Image, anchor: tuple) -> tuple:
    """Rotate img by TILT (expanding it); return it and where `anchor` (a point in img) ends up."""
    rot = img.rotate(TILT, expand=True, resample=Image.BICUBIC)
    t = math.radians(TILT)
    x, y = anchor[0] - img.width / 2, anchor[1] - img.height / 2
    rx, ry = x * math.cos(t) + y * math.sin(t), -x * math.sin(t) + y * math.cos(t)
    return rot, (rot.width / 2 + rx, rot.height / 2 + ry)


def _sticker() -> Image.Image:
    font = ImageFont.truetype(MONO_BOLD, 28)
    left, top, right, bottom = font.getbbox("MODDED")
    w, h = right - left + 32, 44
    img = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.rounded_rectangle((0, 0, w - 1, h - 1), radius=8, fill=YELLOW)
    d.text((w / 2, h / 2 + 1), "MODDED", font=font, fill=(0, 0, 0), anchor="mm")
    return img


def _version(text: str) -> Image.Image:
    font = ImageFont.truetype(MONO_BOLD, 18)
    w = math.ceil(font.getlength(text))
    img = Image.new("RGBA", (w, 22), (0, 0, 0, 0))
    ImageDraw.Draw(img).text((0, 0), text, font=font, fill=YELLOW)
    return img


def logo_xy(ox: int, oy: int) -> tuple:
    """Top-left corner of the logo (scaled to LOGO_W wide) for a picture box at (ox, oy)."""
    return ox + (BOX_W - LOGO_W) // 2, oy + LOGO_TOP


def draw_group(canvas: Image.Image, ox: int, oy: int, version: str, lines: list) -> None:
    """Draw the group without the logo, with the picture box's top-left corner at (ox, oy)."""
    d = ImageDraw.Draw(canvas)

    st = _sticker()
    rot, _ = _rotate_about(st, (st.width / 2, st.height / 2))
    cx, cy = ox + STICKER_CX, oy + STICKER_TOP + st.height / 2
    canvas.paste(rot, (round(cx - rot.width / 2), round(cy - rot.height / 2)), rot)

    ver = _version(version)
    rot, (ax, ay) = _rotate_about(ver, (ver.width, 0))
    canvas.paste(rot, (round(ox + VERSION_RIGHT - ax), round(oy + VERSION_TOP - ay)), rot)

    # left-aligned block, centred on its widest line; line 1 is the widest in both images
    font = ImageFont.truetype(MONO, 24)
    prefix_w = 30
    block_w = max(prefix_w + font.getlength(text) for _, text, _ in lines)
    x = ox + (BOX_W - block_w) / 2
    for i, (prefix, text, state) in enumerate(lines):
        y = oy + LINES_TOP + LINE_H * i + LINE_H / 2
        d.text((x, y), prefix, font=font, anchor="lm", fill=YELLOW if state == "done" else GREEN)
        d.text((x + prefix_w, y), text, font=font, anchor="lm", fill=DONE_GREEN if state == "done" else GREEN)


def splash_picture(version: str, bg: tuple) -> Image.Image:
    """The kernel splash's picture without the logo (upright; mkvisuals.sh rotates it)."""
    img = Image.new("RGB", (BOX_W, BOX_H), bg)
    draw_group(img, 0, 0, version, SPLASH_LINES)
    return img


def marker_screen(version: str, bg: tuple) -> Image.Image:
    """The full-screen Weston background without the logo."""
    img = Image.new("RGB", (W, H), bg)
    draw_group(img, BOX_X, BOX_Y, version, MARKER_LINES)
    font = ImageFont.truetype(MONO, 15)
    ImageDraw.Draw(img).text((W / 2, H - 22), HINT, font=font, anchor="md", fill=HINT_GRAY)
    return img


def matte(on_black: Image.Image, on_white: Image.Image) -> Image.Image:
    out = Image.new("RGBA", on_black.size)
    pb, pw, po = on_black.load(), on_white.load(), out.load()
    for y in range(on_black.height):
        for x in range(on_black.width):
            b, w = pb[x, y], pw[x, y]
            a = max(0, min(255, 255 - round(sum(w[i] - b[i] for i in range(3)) / 3)))
            po[x, y] = (0, 0, 0, 0) if a == 0 else tuple(min(255, round(c * 255 / a)) for c in b) + (a,)
    return out


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("out_dir")
    ap.add_argument("--version-file", type=Path, default=VERSION_FILE)
    args = ap.parse_args()

    version = read_version(args.version_file)
    os.makedirs(args.out_dir, exist_ok=True)
    black, white = (0, 0, 0), (255, 255, 255)
    matte(marker_screen(version, black), marker_screen(version, white)).save(
        os.path.join(args.out_dir, "marker.png"))
    matte(splash_picture(version, black), splash_picture(version, white)).save(
        os.path.join(args.out_dir, "splash.png"))

    marker_x, marker_y = logo_xy(BOX_X, BOX_Y)
    splash_x, splash_y = logo_xy(0, 0)
    with open(os.path.join(args.out_dir, "layout.env"), "w", newline="\n") as f:
        f.write(f"W={W}\nH={H}\nBOX_W={BOX_W}\nBOX_H={BOX_H}\nLOGO_W={LOGO_W}\n"
                f"MARKER_X={marker_x}\nMARKER_Y={marker_y}\nSPLASH_X={splash_x}\nSPLASH_Y={splash_y}\n"
                f"GREEN_R={GREEN[0]}\nGREEN_G={GREEN[1]}\nGREEN_B={GREEN[2]}\n")
    print(f"{args.out_dir}: layers {version}")


if __name__ == "__main__":
    main()
