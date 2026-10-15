"""The whole real install as screenshots, drawn by install/installer/ui.py's own draw()/spinner(),
for checking the look on the PC and for the install guide.

Builds the glyph atlas and the logo from the repo (mkglyphs.py, mklogo.py), then renders every screen
of a real install at the given size: <outdir>/NN-name.png, spinner.gif (the copy screen, animated)
and 00-sheet.png (all screens on one page). The texts are copies of install/installer/init's and of
a real run's progress lines: when init's texts change, change them here too.

Usage (WSL, Pillow): python3 dev/installer-mockup.py [--no-sheet] <outdir> [WxH]   (default 1024x600, the XS panel)
The install guide's screens:  python3 dev/installer-mockup.py --no-sheet docs/images/install
Are they current?             python3 dev/installer-mockup.py --check docs/images/install
  (renders afresh and compares pixel by pixel; also fails when a fixed text of this file is no longer
  in init or install-card.sh. Texts with digits are skipped: progress, sizes and log names are
  filled in at run time)
"""
import os
import re
import shutil
import subprocess
import sys
import tempfile
from types import SimpleNamespace

from PIL import Image, ImageChops, ImageSequence

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(REPO, "install", "installer"))
import ui  # noqa: E402

argv = sys.argv[1:]
CHECK = "--check" in argv
NO_SHEET = CHECK or "--no-sheet" in argv
argv = [v for v in argv if v not in ("--check", "--no-sheet")]
if len(argv) not in (1, 2):
    sys.exit(__doc__)
target = argv[0]
W, H = (int(v) for v in (argv[1] if len(argv) > 1 else "1024x600").split("x"))
outdir = tempfile.mkdtemp() if CHECK else target
os.makedirs(outdir, exist_ok=True)
with tempfile.TemporaryDirectory() as tmp:
    for tool, out in (("mkglyphs.py", "glyphs.bin"), ("mklogo.py", "logo.bin")):
        subprocess.run([sys.executable, os.path.join(REPO, "install", "release", tool), os.path.join(tmp, out)],
                       check=True, stdout=subprocess.DEVNULL)
    glyphs = ui.Glyphs(os.path.join(tmp, "glyphs.bin"))
    LOGO = ui.Logo(os.path.join(tmp, "logo.bin"))

BRAND = "DLZ Creator Modded"
CREDIT = "by Oulsen · github.com/Oulsen/DLZ-Creator-Modded"
HINT = "info|If nothing changes for 10 minutes: switch off and flash the installer again"
WIP = "Do not switch off or remove the card"
CHECKS = ["ok|Installer package complete and undamaged", "ok|Internal storage locked read-only (mmcblk1)",
          "ok|DLZ Creator XS, evolve-node 3297 (build 1731)", "ok|Internal storage layout as expected",
          "ok|SD card: 128 GB", "ok|All tools present on the mixer",
          "ok|12 anchors in /srv/app.js, dlzmod.js (v0.1.0)", "ok|4 anchors in /srv/server.js, dlzmod-server.js",
          "ok|Mod fits this firmware", "ok|Touchscreen found"]
SAFE = dict(notice="ok|Safe to power off", notice_text="Use the switch on the back of the mixer")


def args(**kw):
    base = dict(banner=None, title=None, title_colour="green", line=None, lines_file=None, text=None,
                progress=None, progress_text=None, progress_text2=None, stall=None, button=None, notice=None,
                notice_text=None, footer=None, brand=BRAND, credit=CREDIT, logo_obj=LOGO)
    base.update(kw)
    return SimpleNamespace(**base)


def frame(a, spin=None):
    scr = ui.Screen(bytearray(W * H * 4), W, H, W * 4, 0, 0)
    ui.draw(scr, glyphs, a)
    if spin is not None:
        ui.spinner(scr, spin)
    return Image.frombytes("RGBX", (W, H), bytes(scr.buf), "raw", "BGRX").convert("RGB")


def installing(lines, pct, text, total=None, stall=None):
    return args(title="Installing", line=["ok|All checks passed"] + lines + [HINT], footer=WIP,
                progress=pct, progress_text=text, progress_text2=total, stall=stall)


built = ["ok|Copied to the card and compared with the mixer", "wait|Building the modded system"]
copy = installing(["wait|Copying the mixer's software to the card, with a backup"], 20,
                  "Step 1 of 3: 1.4 GB written, about 3 min left", "About 8 min left for the whole install")
SCREENS = [
    ("01-checks", args(title="Checking your mixer", line=CHECKS), None),
    ("01b-checks-full-size", args(title="Checking your mixer", line=[
        "ok|DLZ Creator, evolve-node 3297 (build 1731)" if "DLZ Creator XS" in c else c for c in CHECKS]), None),
    ("02-ready", args(title="Ready to install", text=[
        "This builds DLZ Creator Modded on this SD card from your mixer's own software. Everything on this card is erased.",
        "The mixer's internal storage stays locked read-only and is never changed. Without the card the mixer keeps starting its normal software.",
        "This takes about 10 to 15 minutes. Do not switch off or remove the card while it runs."],
        button=["accept=Install", "cancel=Cancel"], footer="No touch within 5 minutes = cancel"), None),
    ("03-starting", args(title="Installing", line=["ok|All checks passed", "wait|Starting the install", HINT],
                         footer=WIP), None),
    ("04-preparing", args(title="Installing", line=["ok|All checks passed", "wait|Preparing the card", HINT],
                          footer=WIP), None),
    ("05-copy", copy, 0),
    ("06-compare", installing(["ok|Copied to the card, with a backup", "wait|Comparing the card with the mixer's own software"], 79,
                              "Step 2 of 3: 5.8 of 7.6 GB compared, about 1 min left",
                              "About 2 min left for the whole install"), 3),
    ("07-build", installing(built, 91, "Step 3 of 3: checking the mixer's software, less than a minute left"), 5),
    ("08-build-quiet", installing(built, 95, "Step 3 of 3: checking the file system, less than a minute left",
                                  stall="No change for 2 min (some steps take a while)"), 6),
    ("09-done", args(title="Installation done", line=[
        "ok|All checks passed", "ok|Copied to the card and compared with the mixer",
        "ok|Backup of the mixer saved on the card", "ok|Modded system built and made bootable"], text=[
        "Switch on again with this card in to start DLZ Creator Modded. Without the card the mixer starts its normal software.",
        "The backup is in DLZDATA/dlzmod-backup: copy it to a computer to keep it. It holds your settings, so keep it private.",
        "On a computer, Windows may offer to format a part of this card: never click Format."],
        footer="Log: DLZDATA/dlzmod-logs/install-1.txt", **SAFE), None),
    ("10-stopped", args(title="Installation stopped", title_colour="red", line=[
        "fail|Building the modded system failed (see the log)",
        "info|step 4: MBR written, disk id 0xc79584c3 (eMMC: 9956aba0)",
        "info|card-core.sh: line 239: ... (exit 1)",
        "info|step 4: card-core.sh failed"], text=[
        "The mixer itself was not changed. This card cannot start anything yet, so the mixer starts normally even with it inserted. To try again, flash the installer onto the card again."],
        footer="Log: DLZLOG/dlzmod-logs/install-1.txt", **SAFE), None),
]


def too_long():
    """Progress lines that would not fit in one row at this size: every build part's name (ic_bstep in
    install-card.sh, step in card-core.sh) and the copy/compare/backup lines, each with the longest time
    text. ui.py wraps a longer one onto a second row, but the screens here show one."""
    cols = (W - 2 * max(8, W // 32)) // glyphs.fit(H // 20)["w"]
    src = {f: open(os.path.join(REPO, "install", *f.split("/")), encoding="utf-8").read()
           for f in ("installer/install-card.sh", "card-core.sh")}
    names = re.findall(r'ic_bstep \d+ "([^"]+)"', src["installer/install-card.sh"]) \
        + re.findall(r'^step \d+ "([^"]+)"', src["card-core.sh"], re.M)
    longest = "less than a minute left"     # ic_left (build parts)
    longest2 = "working out the time left"  # IC_AWK's lefttxt (copy and compare)
    lines = [f"Step 3 of 3: {n}, {longest}" for n in names] + [
        f"Step 1 of 3: 99.9 GB written, {longest2}", f"Step 2 of 3: 99.9 of 99.9 GB compared, {longest2}",
        f"Step 1 of 3: finishing the backup, {longest2}", f"Step 2 of 3: checking the backup, {longest2}",
        "Step 2 of 3: checking the backup, almost done", "Less than a minute left for the whole install",
        "About 99 min left for the whole install"]
    return [f"too long for one row ({len(t)} > {cols} at {W}x{H}): {t}" for t in lines if len(t) > cols]


shots = []
for name, a, spin in SCREENS:
    img = frame(a, spin)
    img.save(os.path.join(outdir, f"{name}.png"))
    shots.append(img)
spin_frames = [frame(copy, i) for i in range(ui.SPIN_DOTS)]
spin_frames[0].save(os.path.join(outdir, "spinner.gif"), save_all=True, append_images=spin_frames[1:],
                    duration=int(ui.SPIN_STEP * 1000), loop=0)

if CHECK:
    def frames(path):
        with Image.open(path) as im:
            return [f.convert("RGB") for f in ImageSequence.Iterator(im)]

    src = "".join(open(os.path.join(REPO, "install", "installer", f), encoding="utf-8").read()
                  for f in ("init", "install-card.sh"))
    texts = set()
    for _, a, _ in SCREENS:   # the fields shown as text (not title_colour, brand, credit, ...)
        for k in ("banner", "title", "line", "text", "button", "footer", "notice", "notice_text"):
            v = getattr(a, k)
            for s in v if isinstance(v, list) else [v]:
                if isinstance(s, str):
                    texts.add(re.sub(r"^(ok|wait|info|fail)\||^\w+=", "", s))
    stale = sorted(f"text not in init: {s}" for s in texts if s not in src and not re.search(r"\d", s))
    files = [f"{name}.png" for name, _, _ in SCREENS] + ["spinner.gif"]
    for f in files:
        old = os.path.join(target, f)
        if not os.path.exists(old):
            stale.append(f"missing: {f}")
        else:
            new_f, old_f = frames(os.path.join(outdir, f)), frames(old)
            if len(new_f) != len(old_f) or any(n.size != o.size or ImageChops.difference(n, o).getbbox()
                                               for n, o in zip(new_f, old_f)):
                stale.append(f"differs: {f}")
    stale += [f"not a screen any more: {f}" for f in sorted(os.listdir(target)) if f not in files]
    stale += too_long()
    shutil.rmtree(outdir)
    if stale:
        sys.exit("\n".join(stale) + f"\n{target} is out of date: update this file's texts from init if needed, then\n"
                 f"python3 dev/installer-mockup.py --no-sheet {target}   and check docs/INSTALL.md")
    print(f"{len(files)} files in {target} current")
    sys.exit(0)

if not NO_SHEET:
    cw, ch, gap, cols = W // 2, H // 2, 8, 3
    rows = (len(shots) + cols - 1) // cols
    sheet = Image.new("RGB", (cols * (cw + gap) + gap, rows * (ch + gap) + gap), (60, 60, 60))
    for i, img in enumerate(shots):
        sheet.paste(img.resize((cw, ch), Image.LANCZOS), (gap + (i % cols) * (cw + gap), gap + (i // cols) * (ch + gap)))
    sheet.save(os.path.join(outdir, "00-sheet.png"))
print(f"{len(shots)} screens + spinner.gif{'' if NO_SHEET else ' + 00-sheet.png'} in {outdir} at {W}x{H}")
if too_long():
    sys.exit("\n".join(too_long()) + "\nshorten them in install-card.sh / card-core.sh")
