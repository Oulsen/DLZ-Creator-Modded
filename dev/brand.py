"""The mod's brand images for GitHub, drawn like the MODDED sticker on the mixer's screens
(install/mklayers.py, _sticker: its colour, font and tilt; font 28, height 44, radius 8, padding 32).

<outdir>/modded.png: the sticker alone on transparent, at 4x the screen size (the README shows it
smaller, sharp on high-resolution screens). <outdir>/social-preview.png: 1280x640, in the
installer's look, for GitHub's Settings -> General -> Social preview (GitHub doesn't read it from
the repo: upload it by hand after a change).

Usage (WSL, Pillow, fonts-dejavu-core): python3 dev/brand.py docs/images/brand
"""
import os
import sys

from PIL import Image, ImageDraw, ImageFont

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "install"))
from mklayers import GREEN, MONO, MONO_BOLD, TILT, YELLOW  # noqa: E402

SUPER = 4   # drawn this much bigger, tilted, then scaled down: smooth edges


def sticker(scale: float) -> Image.Image:
    k = scale * SUPER
    font = ImageFont.truetype(MONO_BOLD, round(28 * k))
    left, _, right, _ = font.getbbox("MODDED")
    w, h = round(right - left + 32 * k), round(44 * k)
    img = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.rounded_rectangle((0, 0, w - 1, h - 1), radius=round(8 * k), fill=YELLOW)
    d.text((w / 2, h / 2 + k), "MODDED", font=font, fill=(0, 0, 0), anchor="mm")
    rot = img.rotate(TILT, expand=True, resample=Image.BICUBIC)
    return rot.resize((round(rot.width / SUPER), round(rot.height / SUPER)), Image.LANCZOS)


def social_preview() -> Image.Image:
    w, h = 1280, 640
    img = Image.new("RGB", (w, h), (0, 0, 0))
    d = ImageDraw.Draw(img)
    st = sticker(3.2)
    top = 70
    img.paste(st, ((w - st.width) // 2, top), st)
    d.text((w / 2, top + st.height + 60), "DLZ Creator Modded", font=ImageFont.truetype(MONO_BOLD, 64),
           fill=GREEN, anchor="mm")
    d.text((w / 2, top + st.height + 130), "Unofficial mod for the Mackie DLZ Creator and XS",
           font=ImageFont.truetype(MONO, 30), fill=(230, 230, 230), anchor="mm")
    d.text((w / 2, h - 50), "github.com/Oulsen/DLZ-Creator-Modded", font=ImageFont.truetype(MONO, 24),
           fill=(140, 140, 140), anchor="mm")
    return img


def main() -> None:
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    out = sys.argv[1]
    os.makedirs(out, exist_ok=True)
    sticker(4).save(os.path.join(out, "modded.png"), optimize=True)
    social_preview().save(os.path.join(out, "social-preview.png"), optimize=True)


if __name__ == "__main__":
    main()
