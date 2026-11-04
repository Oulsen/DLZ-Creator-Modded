#!/usr/bin/env python3
# Tap-to-screen probe (#7, #196). Two halves in one file:
#
#   On the mixer (nothing written there, stdout only):   python3 tapprobe.py probe [seconds]
#     polls every 4 ms: touch-downs, app.js's writes, glesgui's reads, CPU per process and the page
#     flip (plane-1's fb= in sun4i-drm's debugfs state changes to another of Weston's buffers).
#   On the PC:                                           python tapprobe.py report <capture.csv>
#     per tap: touch -> app.js writes the page -> glesgui reads it -> the next flip, which is usually
#     the frame before the page (notes/components/glesgui.md, "Tap to screen"); plus flips and
#     writes per second and CPU over the whole capture.
#
# Run through the SSH wrapper (a confirmed command: python is not on its read-only list, and it
# feeds no stdin, so the script goes along as base64):
#   bash dev/tapprobe.sh 40 build/device-logs/196-baseline.csv
import glob
import os
import statistics
import struct
import sys
import time

NAMES = {"app": "app.js", "srv": "server.js", "gles": "glesgui", "weston": "weston", "xw": "Xwayland"}
STATE = "/sys/kernel/debug/dri/3/state"
PAGE_MIN = 4096  # a write or read this big is a page, not a meter update or hub traffic


def find():
    pids = {}
    for d in glob.glob("/proc/[0-9]*"):
        try:
            comm = open(d + "/comm").read().strip()
            cmd = open(d + "/cmdline", "rb").read().replace(b"\0", b" ").decode(errors="replace")
        except OSError:
            continue
        for k, n in NAMES.items():
            hit = (comm == "node" and n in cmd) if n.endswith(".js") else comm == n
            if k not in pids and hit:
                pids[k] = int(d[6:])
    return pids


def io(pid, field):
    with open("/proc/%d/io" % pid) as f:
        for line in f:
            if line.startswith(field):
                return int(line.split()[1])


def cpu(pid):
    with open("/proc/%d/stat" % pid) as f:
        s = f.read()
    r = s[s.rindex(")") + 2:].split()
    return int(r[11]) + int(r[12])  # utime + stime, clock ticks


def plane_fb(f):
    f.seek(0)
    want = False
    for line in f:
        if "plane-1" in line:
            want = True
        elif want and "fb=" in line:
            return line.split("fb=")[1].strip()
    return None


def probe(dur):
    pids = find()
    print("pids", " ".join("%s=%d" % kv for kv in sorted(pids.items())), "clk_tck", os.sysconf("SC_CLK_TCK"), flush=True)
    touch = os.open("/dev/input/event1", os.O_RDONLY | os.O_NONBLOCK)
    state = open(STATE)
    t0 = time.time()
    print("t0 %.3f" % t0, flush=True)
    last = {}
    out = []
    fb = plane_fb(state)
    while True:
        t = (time.time() - t0) * 1000
        if t > dur * 1000:
            break
        try:
            data = os.read(touch, 16 * 64)
            for i in range(0, len(data) - 15, 16):
                sec, usec, typ, code, val = struct.unpack("llHHi", data[i : i + 16])
                if typ == 1 and code == 330:  # BTN_TOUCH
                    out.append("%.1f,touch,%d" % ((sec + usec / 1e6 - t0) * 1000, val))
        except BlockingIOError:
            pass
        vals = {}
        try:
            vals["app_w"] = io(pids["app"], "wchar")
            vals["gles_r"] = io(pids["gles"], "rchar")
            for k in pids:
                vals[k + "_cpu"] = cpu(pids[k])
        except (OSError, KeyError):
            pass
        for k, v in vals.items():
            if last.get(k) != v:
                if k in last:
                    out.append("%.1f,%s,%d" % (t, k, v - last[k]))
                last[k] = v
        now = plane_fb(state)
        if now != fb:
            fb = now
            out.append("%.1f,flip,1" % t)
        time.sleep(0.004)
    print("\n".join(out))


def stats(v):
    if not v:
        return "none"
    return "%.0f / %.0f / %.0f (n=%d)" % (min(v), statistics.median(v), max(v), len(v))


def report(path):
    ev = []
    for line in open(path):
        p = line.strip().split(",")
        if len(p) == 3:
            try:
                ev.append((float(p[0]), p[1], int(p[2])))
            except ValueError:
                pass
    ev.sort(key=lambda e: e[0])
    dur = (ev[-1][0] - ev[0][0]) / 1000 if ev else 1
    downs = [e[0] for e in ev if e[1] == "touch" and e[2] == 1]
    flips = [e[0] for e in ev if e[1] == "flip"]

    def first(kind, after, before, size=PAGE_MIN):
        for e in ev:
            if e[1] == kind and after < e[0] < before and e[2] >= size:
                return e
        return None

    write, read, flip, total, sizes, react, build, idle = [], [], [], [], [], [], [], []
    small = [e[0] for e in ev if e[1] == "app_w" and e[2] < PAGE_MIN]
    for k, d in enumerate(downs):
        end = min(d + 600, downs[k + 1] if k + 1 < len(downs) else d + 600)
        w = first("app_w", d, end)
        if not w:
            continue
        r = first("gles_r", w[0] - 8, end)
        if not r:
            continue
        f = next((x for x in flips if x > r[0]), None)
        if f is None or f > end + 300:
            continue
        # app.js's first small write after the touch: its answer to the hub, so the touch has arrived
        s = next((x for x in small if d < x < w[0]), None)
        if s is not None:
            react.append(s - d)
            build.append(w[0] - s)
        # the same wait from a moment with no touch: what its other small writes alone would give
        s = next((x for x in small if x > d - 300), None)
        if s is not None and s < d:
            idle.append(s - (d - 300))
        write.append(w[0] - d)
        read.append(r[0] - w[0])
        flip.append(f - r[0])
        total.append(f - d)
        sizes.append((round(r[2] / 1024), round(f - d)))
    print("capture %.0f s, taps %d, used %d" % (dur, len(downs), len(total)))
    print("min / median / max ms")
    print("  touch -> app.js writes page  ", stats(write))
    print("  app.js write -> glesgui read ", stats(read))
    print("  glesgui read -> next flip    ", stats(flip))
    print("  touch -> next flip           ", stats(total))
    print("  (the first flip after the read: usually the frame before the page, so too low; for the")
    print("   page's own flip use a GPU trace, notes/components/glesgui.md, \"Tap to screen\")")
    print("  page KiB, ms:", sorted(sizes))
    print("the first stage split by app.js's first small write (only where there is one)")
    print("  touch -> app.js reacts       ", stats(react))
    print("  app.js reacts -> writes page ", stats(build))
    print("  noise: same wait, no touch   ", stats(idle))
    gaps = [b - a for a, b in zip(flips, flips[1:])]
    print("flips %.1f/s, gap ms %s" % (len(flips) / dur, stats(gaps)))
    reads = [e[2] for e in ev if e[1] == "gles_r"]
    print("glesgui reads %.1f/s, %.0f KiB/s" % (len(reads) / dur, sum(reads) / 1024 / dur))
    for k in ("app", "gles", "xw", "weston", "srv"):
        ticks = sum(e[2] for e in ev if e[1] == k + "_cpu")
        print("cpu %-6s %.1f %%" % (k, ticks / dur))


if __name__ == "__main__":
    if len(sys.argv) >= 2 and sys.argv[1] == "probe":
        probe(float(sys.argv[2]) if len(sys.argv) > 2 else 40.0)
    elif len(sys.argv) == 3 and sys.argv[1] == "report":
        report(sys.argv[2])
    else:
        sys.exit(__doc__ or "usage: tapprobe.py probe [seconds] | report <capture.csv>")
