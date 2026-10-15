"""Render an installer screen on the PC as it will look on the mixer.

Runs install/installer/ui.py into a raw framebuffer file (rotated 180 degrees, as on the device), then
turns it back upright into a PNG. Needs Pillow and a glyph atlas (install/release/mkglyphs.py).

Usage: python3 dev/installer-shot.py <out.png> <glyphs.bin> [--size WxH] -- <ui.py screen options>
Example: python3 dev/installer-shot.py build/shots/accept.png /tmp/glyphs.bin -- screen \\
           --title "Ready" --button accept="I accept" --button cancel=Cancel
(ui.py gets --touch none unless the options after -- start with --touch FILE before "screen")
"""
import os
import subprocess
import sys
import tempfile

from PIL import Image

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def main():
    if "--" not in sys.argv or len(sys.argv) < 4:
        sys.exit(__doc__)
    split = sys.argv.index("--")
    out, glyphs, *opts = sys.argv[1:split]
    size = opts[opts.index("--size") + 1] if "--size" in opts else "1024x600"
    ui_args = sys.argv[split + 1:]
    w, h = (int(v) for v in size.split("x"))
    with tempfile.TemporaryDirectory() as tmp:
        raw = os.path.join(tmp, "fb.raw")
        cmd = [sys.executable, os.path.join(REPO, "install", "installer", "ui.py"), "--fb", raw,
               "--size", size, "--glyphs", glyphs]
        if "--touch" not in ui_args:
            cmd += ["--touch", "none"]
        res = subprocess.run(cmd + ui_args, capture_output=True, text=True)
        if res.stdout.strip():
            print(f"ui.py printed: {res.stdout.strip()}")
        if res.returncode not in (0, 3):
            sys.exit(f"ui.py failed ({res.returncode}): {res.stderr}")
        img = Image.frombytes("RGBX", (w, h), open(raw, "rb").read(), "raw", "BGRX").convert("RGB")
        os.makedirs(os.path.dirname(os.path.abspath(out)), exist_ok=True)
        img.rotate(180).save(out)
    print(out)


if __name__ == "__main__":
    main()
