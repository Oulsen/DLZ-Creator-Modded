"""Installer screens: draw on the framebuffer and read the touchscreen (stdlib only).

Runs with the mixer's own python3 inside the read-only eMMC chroot, called by /init once per screen;
/init keeps the state. Layout is computed from the screen size fb0 reports, text comes from the glyph
atlas (glyphs.bin, mkglyphs.py). The XS panel is mounted upside down: drawing and touch are rotated
180 degrees (screen x = width-1 - raw x, same for y) [device].

Commands:
  probe                       clear the screen, print its size and the touch device; exit 4 if there
                              is no touch
  touch                       print the touch device (screen untouched); exit 4 if there is none
                              (1 = the screen itself failed)
  screen [options]            draw one screen; with --button, wait for a tap and print the button id
                              ("timeout" after --timeout seconds)
Screen options:
  --banner TEXT               yellow line above the title (e.g. DRY RUN)
  --title TEXT                green title
  --line STATE|TEXT           status line, STATE = ok, fail, wait, warn, info (repeatable)
  --lines-file FILE           more status lines, one STATE|TEXT per line
  --text TEXT                 paragraph, wrapped (repeatable)
  --progress PCT --progress-text TEXT [--progress-text2 TEXT]
  --button ID=LABEL           button (repeatable, the first is the main one)
  --timeout SECONDS           with buttons: give up after this long
  --footer TEXT               grey line at the bottom
  --next-title TEXT, --next-line STATE|TEXT, --next-footer TEXT
                              screen drawn at once after the main button is tapped, so the panel
                              does not sit on the pressed button while /init prepares the next step
Before the command: --brand TEXT (small grey line at the top of every screen), --credit TEXT
(small grey, bottom right; one row higher when the footer leaves no room) and --logo FILE (our
MODDED sticker with the version, mklogo.py; drawn top right when the file exists).
PC testing: --fb out.raw --size 1024x600 [--touch events.bin] [--rotate 0|180]
"""
import argparse
import fcntl
import json
import math
import mmap
import os
import select
import signal
import struct
import sys
import time
import zlib

HERE = os.path.dirname(os.path.abspath(__file__))
BG = (0, 0, 0)
GREEN = (51, 255, 102)
YELLOW = (255, 214, 0)
RED = (255, 60, 60)
GREY = (150, 150, 150)
WHITE = (235, 235, 235)
BUTTON_BG = (38, 38, 38)
STATES = {"ok": ("✓", GREEN), "fail": ("✗", RED), "wait": ("…", YELLOW), "warn": ("!", YELLOW),
          "info": ("•", GREY)}

EV_SYN, EV_KEY, EV_ABS = 0, 1, 3
BTN_TOUCH = 0x14A
ABS_X, ABS_Y, ABS_MT_X, ABS_MT_Y = 0x00, 0x01, 0x35, 0x36
EVENT_FMT = "IIHHi" if struct.calcsize("l") == 4 else "qqHHi"   # struct input_event, 32/64-bit
RECORDED_FMT = "IIHHi"   # event files recorded on the device (32-bit ARM)
TAP_GRACE = 0.4   # taps this soon after drawing belong to the previous screen
SPIN_DOTS = 8   # serve: a turning ring of dots on the active line, so a busy screen visibly lives
SPIN_STEP = 0.15   # seconds per spinner frame
STALL_AFTER = 120   # serve: seconds without a new progress line before the screen says so


class Glyphs:
    def __init__(self, path):
        data = open(path, "rb").read()
        if not data.startswith(b"DLZG1\n"):
            raise SystemExit(f"{path}: not a glyph atlas")
        nl = data.index(b"\n", 6)
        head = json.loads(data[6:nl])
        self.data, self.base = data, nl + 1
        self.index = {c: i for i, c in enumerate(head["chars"])}
        self.sizes = sorted(head["sizes"], key=lambda s: s["px"])

    def fit(self, max_h):
        """Largest size whose cell is at most max_h pixels high (else the smallest)."""
        ok = [s for s in self.sizes if s["h"] <= max_h]
        return ok[-1] if ok else self.sizes[0]

    def cell(self, size, ch):
        i = self.index.get(ch, self.index["?"])
        n = size["w"] * size["h"]
        start = self.base + size["offset"] + i * n
        return self.data[start:start + n]


class Logo:
    """Pre-rendered picture (mklogo.py): one size per screen height, BGRX on black."""

    def __init__(self, path):
        data = open(path, "rb").read()
        if not data.startswith(b"DLZL1\n"):
            raise SystemExit(f"{path}: not a logo file")
        nl = data.index(b"\n", 6)
        self.data, self.base = data, nl + 1
        self.sizes = sorted(json.loads(data[6:nl])["sizes"], key=lambda z: z["for_h"])

    def pick(self, screen_h):
        ok = [z for z in self.sizes if z["for_h"] <= screen_h]
        return ok[-1] if ok else self.sizes[0]

    def rows(self, size):
        start, w = self.base + size["offset"], size["w"] * 4
        return [self.data[start + r * w:start + (r + 1) * w] for r in range(size["h"])]


class Screen:
    """Logical (upright) coordinates; rotation happens when bytes are written.

    Draws into a frame in memory; present() copies it to the framebuffer in one go, so the panel
    switches from the old screen to the new one without showing a cleared (black) frame."""

    def __init__(self, fb, w, h, stride, offset, rotate):
        self.fb, self.fb_offset = fb, offset
        self.w, self.h, self.stride = w, h, stride
        self.buf, self.offset = bytearray(h * stride), 0
        self.rot = rotate == 180
        self.cache = {}
        self.spin_at = None   # (x, y, w, h) of the active line's icon, set by draw()

    def present(self):
        self.fb[self.fb_offset:self.fb_offset + len(self.buf)] = self.buf
        self.fb.flush()

    def present_rows(self, y, h):
        """Copy only logical rows y..y+h to the framebuffer (the spinner: a few KB, not the frame)."""
        if self.rot:
            y = self.h - y - h
        a, b = y * self.stride, (y + h) * self.stride
        self.fb[self.fb_offset + a:self.fb_offset + b] = self.buf[a:b]
        self.fb.flush()

    def picture(self, x, y, w, rows):
        """Blit BGRX rows (upright) with the top-left corner at logical (x, y)."""
        if self.rot:
            x, y = self.w - x - w, self.h - y - len(rows)
            rows = [memoryview(r).cast("I")[::-1].tobytes() for r in reversed(rows)]
        for i, row in enumerate(rows):
            o = self.offset + (y + i) * self.stride + x * 4
            self.buf[o:o + w * 4] = row

    @staticmethod
    def pix(c):
        return bytes((c[2], c[1], c[0], 255))   # XRGB8888 little-endian: B, G, R, X

    def rect(self, x, y, w, h, colour):
        x, y = max(0, x), max(0, y)
        w, h = min(w, self.w - x), min(h, self.h - y)
        if w <= 0 or h <= 0:
            return
        if self.rot:
            x, y = self.w - x - w, self.h - y - h
        row = self.pix(colour) * w
        for r in range(y, y + h):
            o = self.offset + r * self.stride + x * 4
            self.buf[o:o + w * 4] = row

    def glyph_rows(self, glyphs, size, ch, fg, bg):
        key = (size["px"], ch, fg, bg)
        rows = self.cache.get(key)
        if rows is None:
            table = [self.pix(tuple(b + (f - b) * a // 255 for f, b in zip(fg, bg))) for a in range(256)]
            cell, cw = glyphs.cell(size, ch), size["w"]
            rows = []
            for r in range(size["h"]):
                line = cell[r * cw:(r + 1) * cw]
                rows.append(b"".join(table[a] for a in (reversed(line) if self.rot else line)))
            if self.rot:
                rows.reverse()
            self.cache[key] = rows
        return rows

    def text(self, glyphs, size, x, y, s, fg, bg=BG):
        cw, ch = size["w"], size["h"]
        for i, c in enumerate(s):
            gx = x + i * cw
            if gx + cw > self.w or y + ch > self.h or gx < 0 or y < 0:
                break
            px, py = (self.w - gx - cw, self.h - y - ch) if self.rot else (gx, y)
            for r, row in enumerate(self.glyph_rows(glyphs, size, c, fg, bg)):
                o = self.offset + (py + r) * self.stride + px * 4
                self.buf[o:o + cw * 4] = row


def wrap(s, width):
    out, line = [], ""
    for word in s.split():
        if line and len(line) + 1 + len(word) > width:
            out.append(line)
            line = word
        else:
            line = f"{line} {word}" if line else word
        while len(line) > width:
            out.append(line[:width])
            line = line[width:]
    if line:
        out.append(line)
    return out or [""]


def write_png(scr, path):
    """The (upright, rotate 0) frame as an RGB PNG, stdlib only."""
    w, h, n = scr.w, scr.h, scr.w * scr.h
    rgb = bytearray(3 * n)
    rgb[0::3], rgb[1::3], rgb[2::3] = scr.buf[2::4], scr.buf[1::4], scr.buf[0::4]   # from B, G, R, X
    raw = b"".join(b"\0" + rgb[r * w * 3:(r + 1) * w * 3] for r in range(h))

    def chunk(kind, data):
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data))
    with open(path, "wb") as f:
        f.write(b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0))
                + chunk(b"IDAT", zlib.compress(bytes(raw), 6)) + chunk(b"IEND", b""))


def fb_geometry():
    base = "/sys/class/graphics/fb0"
    bpp = int(open(f"{base}/bits_per_pixel").read())
    if bpp != 32:
        raise SystemExit(f"fb0: {bpp} bpp, only 32 is supported")
    stride = int(open(f"{base}/stride").read())
    vw, vh = (int(v) for v in open(f"{base}/virtual_size").read().split(","))
    w, h = vw, vh
    modes = open(f"{base}/modes").read().split()
    if modes:   # e.g. U:1024x600p-0: the visible part of a larger virtual buffer
        w, h = (int(v) for v in modes[0].split(":")[1].split("p")[0].split("x"))
    pan_x, pan_y = (int(v) for v in open(f"{base}/pan").read().split(","))
    if pan_x:
        raise SystemExit(f"fb0: pan {pan_x},{pan_y} is not supported")
    return w, h, stride, pan_y * stride, vh * stride


class WriteBuf(bytearray):
    """Framebuffer through write() instead of mmap (the spike drew this way): flush() writes it out."""

    def __init__(self, fd, length):
        super().__init__(length)
        self.fd = fd

    def flush(self):
        os.pwrite(self.fd, self, 0)


def open_screen(args):
    if args.fb == "/dev/fb0":
        w, h, stride, offset, length = fb_geometry()
        f = open("/dev/fb0", "r+b")
        try:
            buf = mmap.mmap(f.fileno(), length)
            buf.flush()
        except OSError:
            buf = WriteBuf(f.fileno(), offset + h * stride)
    else:
        w, h = (int(v) for v in args.size.split("x"))
        stride, offset = w * 4, 0
        f = open(args.fb, "w+b")
        f.truncate(stride * h)
        buf = mmap.mmap(f.fileno(), stride * h)
    return Screen(buf, w, h, stride, offset, args.rotate), f


def find_touch():
    """/dev/input/eventN of the touchscreen (Goodix on the XS), or None."""
    try:
        blocks = open("/proc/bus/input/devices").read().split("\n\n")
    except OSError:
        return None
    for b in blocks:
        name = next((l.split("=", 1)[1].strip('"') for l in b.splitlines() if l.startswith("N: Name=")), "")
        handlers = next((l.split("=", 1)[1].split() for l in b.splitlines() if l.startswith("H: Handlers=")), [])
        if "goodix" in name.lower() or "touchscreen" in name.lower():
            ev = [h for h in handlers if h.startswith("event")]
            if ev:
                return f"/dev/input/{ev[0]}"
    return None


def abs_max(fd, code, default):
    """Maximum of an absolute axis (EVIOCGABS), so raw touch positions scale to the screen."""
    buf = bytearray(24)   # struct input_absinfo: value, minimum, maximum, fuzz, flat, resolution
    try:
        fcntl.ioctl(fd, (2 << 30) | (24 << 16) | (ord("E") << 8) | (0x40 + code), buf)
        mx = struct.unpack("6i", buf)[2]
        return mx if mx > 0 else default
    except OSError:
        return default


class Touch:
    def __init__(self, path, w, h, rotate, is_device):
        self.w, self.h, self.rot = w, h, rotate == 180
        flags = os.O_RDONLY | (os.O_NONBLOCK if is_device else 0)
        self.fd = os.open(path, flags)
        self.is_device = is_device
        self.fmt = EVENT_FMT if is_device else RECORDED_FMT
        self.size = struct.calcsize(self.fmt)
        if is_device:
            self.max_x = abs_max(self.fd, ABS_MT_X, 0) or abs_max(self.fd, ABS_X, w - 1)
            self.max_y = abs_max(self.fd, ABS_MT_Y, 0) or abs_max(self.fd, ABS_Y, h - 1)
            try:   # drop taps that happened before this screen
                while os.read(self.fd, self.size * 64):
                    pass
            except BlockingIOError:
                pass
        else:
            self.max_x, self.max_y = w - 1, h - 1

    def to_screen(self, rx, ry):
        x = min(self.w - 1, max(0, rx * (self.w - 1) // max(1, self.max_x)))
        y = min(self.h - 1, max(0, ry * (self.h - 1) // max(1, self.max_y)))
        return (self.w - 1 - x, self.h - 1 - y) if self.rot else (x, y)

    def taps(self, deadline, shown_at):
        """Yield (down_xy, up_xy) for each finger down/up, until the deadline (None = forever)."""
        rx = ry = None
        down = down_at = None
        pending = None   # BTN_TOUCH changed, position completes at SYN_REPORT
        while True:
            if self.is_device:
                wait = None if deadline is None else max(0.0, deadline - time.monotonic())
                if wait == 0.0:
                    return
                ready, _, _ = select.select([self.fd], [], [], wait)
                if not ready:
                    return
            try:
                data = os.read(self.fd, self.size)
            except BlockingIOError:
                continue
            if len(data) < self.size:
                return   # end of a recorded file
            _, _, typ, code, value = struct.unpack(self.fmt, data)
            if typ == EV_ABS and code in (ABS_X, ABS_MT_X):
                rx = value
            elif typ == EV_ABS and code in (ABS_Y, ABS_MT_Y):
                ry = value
            elif typ == EV_KEY and code == BTN_TOUCH:
                pending = value
            elif typ == EV_SYN and code == 0 and pending is not None and rx is not None and ry is not None:
                pos = self.to_screen(rx, ry)
                if pending == 1:
                    down, down_at = pos, time.monotonic()
                elif down is not None:
                    if not self.is_device or down_at - shown_at >= TAP_GRACE:
                        yield down, pos
                    down = None
                pending = None


def draw(scr, glyphs, a):
    W, H = scr.w, scr.h
    m = max(8, W // 32)
    body = glyphs.fit(H // 20)
    title = glyphs.fit(H // 11)
    small = glyphs.fit(H // 30)
    cols = (W - 2 * m) // body["w"]
    scr.rect(0, 0, W, H, BG)
    scr.spin_at = None
    y = m
    logo_w = 0
    if getattr(a, "logo_obj", None):
        z = a.logo_obj.pick(H)
        scr.picture(W - m - z["w"], max(0, m - z["h"] // 6), z["w"], a.logo_obj.rows(z))
        logo_w = z["w"] + m // 2
    if getattr(a, "brand", None):
        scr.text(glyphs, small, m, y, a.brand[:(W - 2 * m - logo_w) // small["w"]], GREY)
        y += small["h"] + small["h"] // 3
    if a.banner:
        scr.text(glyphs, body, m, y, a.banner[:cols], YELLOW)
        y += body["h"] + body["h"] // 3
    if a.title:
        colour = {"green": GREEN, "yellow": YELLOW, "red": RED}[a.title_colour]
        scr.text(glyphs, title, m, y, a.title[:(W - 2 * m - logo_w) // title["w"]], colour)
        y += title["h"] + body["h"] // 2
    lines = []
    if a.lines_file:
        lines += [l.rstrip("\n") for l in open(a.lines_file, encoding="utf-8") if l.strip()]
    lines += a.line or []
    footer_h = small["h"] + m // 2 if a.footer else 0
    credit = getattr(a, "credit", None)
    small_cols = (W - 2 * m) // small["w"]
    credit_y = H - m // 2 - small["h"]   # the footer's row, right-aligned
    if credit:
        if a.footer and len(a.footer) + 3 + len(credit) > small_cols:
            credit_y -= small["h"]   # its own row, above the footer
            footer_h += small["h"]
        elif not a.footer:
            footer_h = small["h"] + m // 2
    bh = max(title["h"] + body["h"], H // 7)
    bottom = (H - m - footer_h - bh - m // 2) if a.button else (H - m - footer_h)
    if a.notice:   # closing message in title size at the bottom, so it does not read as one more check
        state, _, txt = a.notice.partition("|")
        ny = bottom - title["h"] - (body["h"] if a.notice_text else 0)
        scr.text(glyphs, title, m, ny, txt[:(W - 2 * m) // title["w"]], STATES.get(state, ("", GREEN))[1])
        if a.notice_text:
            scr.text(glyphs, body, m, ny + title["h"], a.notice_text[:cols], WHITE)
        bottom = ny - body["h"] // 2

    def room(y, reserve=0):   # content stops above the buttons and the footer
        return y + body["h"] <= bottom - reserve
    # the paragraphs say what to do next: their room is kept, lines that do not fit are dropped first
    text_h = sum(body["h"] // 3 + len(wrap(p, cols)) * body["h"] for p in a.text or [])
    for entry in lines:
        state, _, txt = entry.partition("|")
        icon, colour = STATES.get(state, ("•", GREY))
        for i, part in enumerate(wrap(txt, cols - 2)):
            if not room(y, text_h):
                break
            if i == 0:
                scr.text(glyphs, body, m, y, icon, colour)
                if state == "wait":
                    scr.spin_at = (m, y, 2 * body["w"] - 5, body["h"])
            scr.text(glyphs, body, m + 2 * body["w"], y, part, WHITE if state != "fail" else RED)
            y += body["h"]
    for para in a.text or []:
        y += body["h"] // 3
        for part in wrap(para, cols):
            if not room(y):
                break
            scr.text(glyphs, body, m, y, part, WHITE)
            y += body["h"]
    if a.progress is not None:
        y += body["h"] // 2
        bar_h = body["h"]
        pct = max(0, min(100, a.progress))
        bar_w = W - 2 * m - 6 * body["w"]   # room for " 100 %" on the right
        scr.rect(m, y, bar_w, bar_h, GREY)
        scr.rect(m + 2, y + 2, bar_w - 4, bar_h - 4, BG)
        scr.rect(m + 2, y + 2, (bar_w - 4) * pct // 100, bar_h - 4, GREEN)
        label = f"{pct} %"
        scr.text(glyphs, body, W - m - len(label) * body["w"], y, label, WHITE)
        y += bar_h + body["h"] // 3
        if a.progress_text:   # wrapped like the paragraphs: a long step name must not run off the screen
            for part in wrap(a.progress_text, cols)[:2]:
                scr.text(glyphs, body, m, y, part, WHITE)
                y += body["h"]
        if getattr(a, "progress_text2", None):
            scr.text(glyphs, body, m, y, a.progress_text2[:cols], GREY)
            y += body["h"]
        if getattr(a, "stall", None):
            scr.text(glyphs, body, m, y, a.stall[:cols], GREY)
            y += body["h"]
    buttons = []
    if a.button:
        n = len(a.button)
        gap = m
        bw = (W - 2 * m - (n - 1) * gap) // n
        by = H - m - footer_h - bh
        for i, spec in enumerate(a.button):
            bid, _, label = spec.partition("=")
            bx = m + i * (bw + gap)
            colour = GREEN if i == 0 else GREY
            scr.rect(bx, by, bw, bh, colour)
            scr.rect(bx + 3, by + 3, bw - 6, bh - 6, BUTTON_BG)
            label = label[:(bw - 12) // title["w"]]
            tx = bx + (bw - len(label) * title["w"]) // 2
            ty = by + (bh - title["h"]) // 2
            scr.text(glyphs, title, tx, ty, label, colour, BUTTON_BG)
            buttons.append((bid, bx, by, bw, bh, colour, label, tx, ty, title))
    if a.footer:
        scr.text(glyphs, small, m, H - m // 2 - small["h"], a.footer[:small_cols], GREY)
    if credit:
        credit = credit[:small_cols]
        scr.text(glyphs, small, W - m - len(credit) * small["w"], credit_y, credit, GREY)
    return buttons


def spinner(scr, frame):
    """Ring of SPIN_DOTS dots in place of the active line's icon; the bright head moves one dot per
    frame and the dots behind it fade."""
    if not scr.spin_at:
        return
    x, y, w, h = scr.spin_at
    scr.rect(x, y, w, h, BG)
    d = min(w, h) - 2
    dot = max(3, d // 4)
    rad = (d - dot) / 2
    cx, cy = x + w / 2, y + h / 2
    for i in range(SPIN_DOTS):
        level = max(90, 255 - ((frame - i) % SPIN_DOTS) * 45)
        ang = 2 * math.pi * i / SPIN_DOTS
        scr.rect(round(cx + rad * math.sin(ang) - dot / 2), round(cy - rad * math.cos(ang) - dot / 2),
                 dot, dot, tuple(c * level // 255 for c in YELLOW))


def serve(scr, glyphs, a):
    """One process for a progress screen: each stdin line "PERCENT<TAB>TEXT[<TAB>TEXT2]" redraws it
    (TEXT2: a grey second line, e.g. the time left in total). Between
    lines the spinner turns; after STALL_AFTER seconds without a line the screen says how long
    nothing changed (the spinner only shows that the screen lives, not that the work moves)."""
    a.button, a.stall = None, None
    fd = sys.stdin.fileno()
    pending, last, n, spent = b"", None, 0, 0.0
    while True:
        ready, _, _ = select.select([fd], [], [], SPIN_STEP if last is not None else None)
        redraw = False
        if ready:
            chunk = os.read(fd, 4096)
            if not chunk:
                break
            *full, pending = (pending + chunk).split(b"\n")
            for raw in full:
                pct, _, txt = raw.decode("utf-8", "replace").partition("\t")
                txt, _, txt2 = txt.partition("\t")
                if pct.isdigit():
                    a.progress, a.progress_text, a.progress_text2, a.stall = int(pct), txt, txt2, None
                    last, redraw = time.monotonic(), True
        now = time.monotonic()
        if last is not None and now - last >= STALL_AFTER:
            stall = f"No change for {int((now - last) // 60)} min (some steps take a while)"
            redraw = redraw or stall != a.stall
            a.stall = stall
        t = time.monotonic()
        if last is not None:
            if redraw:
                draw(scr, glyphs, a)
                n += 1
            spinner(scr, int(now / SPIN_STEP))
            if redraw:
                scr.present()
            elif scr.spin_at:
                scr.present_rows(scr.spin_at[1], scr.spin_at[3])
        spent += time.monotonic() - t
    print(f"serve: {n} screens, {spent:.2f} s drawing", file=sys.stderr)


def inside(pos, b):
    _, bx, by, bw, bh = b[:5]
    return bx <= pos[0] < bx + bw and by <= pos[1] < by + bh


def main():
    ap = argparse.ArgumentParser(description="installer screens", add_help=True)
    ap.add_argument("--fb", default="/dev/fb0")
    ap.add_argument("--size", default="1024x600", help="PC testing with --fb FILE")
    ap.add_argument("--rotate", type=int, choices=(0, 180), default=180)
    ap.add_argument("--touch", default="auto", help="auto, none, or a recorded event file")
    ap.add_argument("--glyphs", default=os.path.join(HERE, "glyphs.bin"))
    ap.add_argument("--logo", default=os.path.join(HERE, "logo.bin"))
    ap.add_argument("--brand")
    ap.add_argument("--credit")
    ap.add_argument("--png", help="screen: draw off-screen (upright, the panel's size) into this PNG "
                                  "instead of on the panel; no touch")
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("probe")
    sub.add_parser("touch")
    for name in ("screen", "serve"):
        s = sub.add_parser(name)
        s.add_argument("--banner")
        s.add_argument("--title")
        s.add_argument("--title-colour", choices=("green", "yellow", "red"), default="green")
        s.add_argument("--line", action="append")
        s.add_argument("--lines-file")
        s.add_argument("--text", action="append")
        s.add_argument("--progress", type=int)
        s.add_argument("--progress-text")
        s.add_argument("--button", action="append")
        s.add_argument("--timeout", type=float)
        s.add_argument("--notice", help="STATE|TEXT, closing message in title size above the footer")
        s.add_argument("--notice-text")
        s.add_argument("--footer")
        s.add_argument("--next-title")
        s.add_argument("--next-line", action="append")
        s.add_argument("--next-footer")
    a = ap.parse_args()

    touch_path = find_touch() if a.touch == "auto" else (None if a.touch == "none" else a.touch)
    if a.cmd == "touch":
        print(f"touch {touch_path or 'none'}")
        sys.exit(0 if touch_path else 4)
    if a.cmd == "probe":   # opens and clears the screen for real, so a broken one shows up here
        scr, f = open_screen(a)
        scr.rect(0, 0, scr.w, scr.h, BG)
        scr.present()
        print(f"screen {scr.w}x{scr.h} stride {scr.stride} {'write' if isinstance(scr.fb, WriteBuf) else 'mmap'}")
        print(f"touch {touch_path or 'none'}")
        sys.exit(0 if touch_path else 4)

    glyphs = Glyphs(a.glyphs)
    a.logo_obj = Logo(a.logo) if os.path.exists(a.logo) else None
    if a.png and a.cmd == "screen":
        signal.alarm(20)   # finish() waits for this: a hang must not keep the last screen away
        w, h = fb_geometry()[:2] if a.fb == "/dev/fb0" else (int(v) for v in a.size.split("x"))
        scr = Screen(bytearray(w * h * 4), w, h, w * 4, 0, 0)
        a.button = None
        draw(scr, glyphs, a)
        write_png(scr, a.png)
        return
    scr, f = open_screen(a)
    if a.cmd == "serve":
        serve(scr, glyphs, a)
        return
    buttons = draw(scr, glyphs, a)
    scr.present()
    shown = time.monotonic()
    if not buttons:
        return
    if not touch_path:
        print("no-touch")
        sys.exit(3)
    touch = Touch(touch_path, scr.w, scr.h, a.rotate, a.touch == "auto")
    deadline = None if a.timeout is None else shown + a.timeout
    for down, up in touch.taps(deadline, shown):
        for b in buttons:
            if inside(down, b) and inside(up, b):
                bid, bx, by, bw, bh, colour, label, tx, ty, font = b
                scr.rect(bx + 3, by + 3, bw - 6, bh - 6, colour)   # pressed: filled, label stays
                scr.text(glyphs, font, tx, ty, label, BG, colour)
                scr.present()
                if b is buttons[0] and a.next_title:   # the next screen now, not after /init's work
                    time.sleep(0.15)
                    a.title, a.title_colour, a.line, a.lines_file = a.next_title, "green", a.next_line, None
                    a.text, a.button, a.footer, a.progress = None, None, a.next_footer, None
                    a.notice, a.notice_text = None, None   # the banner (dry run) stays
                    draw(scr, glyphs, a)
                    scr.present()
                print(b[0])
                return
    print("timeout")


if __name__ == "__main__":
    main()
