"""Render the glyph atlas for the installer screens (ui.py draws text from it, stdlib only).

DejaVu Sans Mono, monospace, so every glyph of one size has the same cell. Several sizes, so ui.py
can pick one that fits the screen it finds (1024x600 on the XS, other panels later).

Format (glyphs.bin):
  b"DLZG1\\n"
  one JSON line: {"chars": "<all chars>", "sizes": [{"px": N, "w": cw, "h": ch, "offset": o}, ...]}
  then per size, at its offset from the end of the JSON line: one cell of 8-bit alpha per char
  (row-major, w*h bytes, 0 = background, 255 = full ink), in "chars" order

Refuses a char the font does not have (it would draw the font's empty box).

Usage: python3 mkglyphs.py <out glyphs.bin>
Needs: Pillow, fonts-dejavu-core
"""
import json
import sys

from PIL import Image, ImageDraw, ImageFont

FONT = "/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf"
SIZES = (16, 24, 32, 48)
CHARS = "".join(chr(c) for c in range(32, 127)) + "✓✗…°–—•·"
MAGIC = b"DLZG1\n"


def cell_size(font):
    ascent, descent = font.getmetrics()
    return round(font.getlength("M")), ascent + descent


def render(font, ch, w, h):
    img = Image.new("L", (w, h), 0)
    ImageDraw.Draw(img).text((0, 0), ch, font=font, fill=255)
    return img.tobytes()


def main():
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    sizes, blobs, offset = [], [], 0
    for px in SIZES:
        font = ImageFont.truetype(FONT, px)
        w, h = cell_size(font)
        missing = render(font, "￿", w, h)
        cells = []
        for ch in CHARS:
            cell = render(font, ch, w, h)
            if ch != " " and (cell == missing or not any(cell)):
                sys.exit(f"{FONT} has no glyph for {ch!r} (U+{ord(ch):04X})")
            cells.append(cell)
        blob = b"".join(cells)
        sizes.append({"px": px, "w": w, "h": h, "offset": offset})
        blobs.append(blob)
        offset += len(blob)
    header = json.dumps({"chars": CHARS, "sizes": sizes}, ensure_ascii=True).encode() + b"\n"
    with open(sys.argv[1], "wb") as f:
        f.write(MAGIC + header + b"".join(blobs))
    print(f"{sys.argv[1]}: {len(CHARS)} chars, sizes "
          + ", ".join(f"{s['px']}px ({s['w']}x{s['h']})" for s in sizes) + f", {offset} bytes of glyphs")


if __name__ == "__main__":
    main()
