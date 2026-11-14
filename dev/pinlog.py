#!/usr/bin/env python3
# Pin log for the dev card (#261, #287, #293, for #257). Runs at every start once dev/pinlog.sh has put
# it on the card, and writes to the journal (so the network log carries it), for the whole session:
#
# - the codec pins PH0-PH2 and PH12 (data, function, pull): the first state and every change, in the
#   line format of #261/#287, so old and new logs compare line by line;
# - every other GPIO pin of ports A-I: every change of its function, pull or drive, and of its data
#   bit while it is a plain input or output (a pin running a hardware function, such as the backlight's
#   PWM or a UART, toggles all the time; its data bit says nothing there);
# - every 100 ms the screen (backlight, the display connectors) and the power chip's interrupt lines
#   (AXP221, NMI, power key), every 500 ms each regulator's state, users and voltage: each change;
# - a full snapshot (all pin registers, all of the above, every interrupt line's count, temperatures
#   and the PMIC's ADC readings) at the first read, when the codec setup ends (PH1 goes high), when
#   PH2 goes low and high again, every hour and at the end, so a silent start compares field by field
#   with a start with sound.
#
# dspserver makes PH0/PH1 outputs and PH2 an input with pull-up, pulses PH0 and raises PH1 around the
# codec setup at its start, and gates a later AKM re-setup on PH2 (notes/components/dspserver.md,
# #257). In both silent starts so far PH2 went low for ~12 ms about 1.2 s after the setup.
#
# How often it reads: it sleeps 1 ms between reads, but this kernel wakes sleepers only on its 4 ms
# tick (CONFIG_HZ=250 without high-resolution timers), so a pin read comes about every 4 ms; a pulse
# shorter than that can fall between two reads. Every hour (and at the end) an "alive" line says how
# many reads it made, their mean and longest gap, and the CPU time it used.
#
# Read-only: one page of /dev/mem mapped PROT_READ (reading the PIO registers has no side effects),
# and reads of /sys and /proc. The PMIC is never addressed over I2C (its interrupt status clears on a
# write). DLZ_PINLOG_MEM and DLZ_PINLOG_ROOT point it at a stand-in file and tree (tests/pinlog.sh).
# Usage: dlzdev-pinlog            (the unit: until it is stopped)
#        dlzdev-pinlog --once     (one reading and one snapshot, for dev/pinlog.sh on)
import glob
import mmap
import os
import signal
import sys
import time

MEM = os.environ.get("DLZ_PINLOG_MEM", "/dev/mem")
ROOT = os.environ.get("DLZ_PINLOG_ROOT", "")
PAGE = 0x01C20000    # the PIO controller sits at 0x01C20800
PIO = 0x800 // 4     # its first register as a word index into the page
PORTS = "ABCDEFGHI"  # the A40i's ports
PW = 9               # words per port (0x24 bytes): CFG0-3, DAT, DRV0-1, PULL0-1
H = PORTS.index("H") * PW
CODEC_PINS = (0, 1, 2, 12)                         # PH0-PH2 and PH12: the codec line's
CODEC = (0x00000FFF, 0, 0x00000007, 0x0000003F)    # the bits of PH0-PH2 in each codec field
STEP = 0.001         # asks for 1 ms; the 4 ms tick sets the real pace
FAST = 0.1           # screen and interrupt lines
SLOW = 0.5           # regulators
ALIVE = 3600.0       # seconds between "alive" lines (each with a snapshot)
WINDOW = float(os.environ.get("DLZ_PINLOG_WINDOW", 60.0))  # the line budgets count per minute of
# uptime (fixed minutes, not a sliding one); the test makes it longer so it never crosses one
# change lines per minute at most, more are counted in one summary line a minute; separate budgets,
# so a busy pin or rail can neither crowd out a PH0-PH2 change nor flood the card's syslog
BUDGET = dict({"codec": 60, "PH12": 10, "sys": 60, "snapshot": 10},
              **{"P" + p: 20 for p in PORTS})
IRQ_WATCH = ("axp", "nmi", "pek")  # interrupt lines logged on change; all of them in a snapshot


def uptime():
    return time.clock_gettime(time.CLOCK_BOOTTIME)


def stop(signum, frame):
    raise SystemExit(0)


def rss_mb():
    try:
        with open("/proc/self/status") as f:
            for row in f:
                if row.startswith("VmRSS:"):
                    return int(row.split()[1]) / 1024
    except (OSError, ValueError):
        pass
    return -1.0


def codec(v):
    # the codec line's fields (cfg0, cfg1, dat, pull0) from one read of all ports
    return (v[H] & 0x00000FFF, v[H + 1] & 0x00070000, v[H + 4] & 0x00001007, v[H + 7] & 0x0300003F)


def pin(v, b, n):
    # function, data, drive, pull of pin n of the port whose first word is b
    return ((v[b + n // 8] >> (4 * (n % 8))) & 7, (v[b + 4] >> n) & 1,
            (v[b + 5 + n // 16] >> (2 * (n % 16))) & 3, (v[b + 7 + n // 16] >> (2 * (n % 16))) & 3)


def pin_changes(old, new):
    # [(port letter, "PB3 d1>0 ...")] for every pin outside the codec line that changed
    out = []
    for i, p in enumerate(PORTS):
        b = i * PW
        if old[b:b + PW] == new[b:b + PW]:
            continue
        parts = []
        for n in range(32):
            if p == "H" and n in CODEC_PINS:
                continue
            o, w = pin(old, b, n), pin(new, b, n)
            if o == w:
                continue
            got = []
            for k, name in enumerate("fdrp"):  # function, data, drive, pull
                if o[k] == w[k] or (k == 1 and o[0] == w[0] and o[0] > 1):
                    continue  # a data bit counts only while the pin is a plain input (0) or output (1)
                got.append("%s%d>%d" % (name, o[k], w[k]))
            if got:
                parts.append("P%s%d %s" % (p, n, " ".join(got)))
        if parts:
            out.append((p, ", ".join(parts)))
    return out


class Files:
    # sysfs attributes kept open and re-read with pread at offset 0 (sysfs makes the value anew)
    def __init__(self):
        self.fds = {}

    def add(self, name, path):
        try:
            self.fds[name] = os.open(path, os.O_RDONLY)
        except OSError:
            pass

    def read(self):
        out = {}
        for name, fd in self.fds.items():
            try:
                out[name] = os.pread(fd, 256, 0).decode(errors="replace").strip().replace(" ", "_") or "-"
            except OSError as e:
                out[name] = "err%d" % (e.errno or 0)
        return out


def interrupts():
    # {"92:axp22x_irq_chip": total count over all CPUs} for every line of /proc/interrupts
    out = {}
    try:
        with open(ROOT + "/proc/interrupts") as f:
            rows = f.read().splitlines()
    except OSError:
        return out
    ncpu = len(rows[0].split()) if rows else 0
    for row in rows[1:]:
        f = row.split()
        if not f or not f[0].endswith(":"):
            continue
        counts = [int(x) for x in f[1:1 + ncpu] if x.isdigit()]
        name = f[0][:-1] + ":" + "_".join(f[1 + len(counts):])
        out[name] = sum(counts)
    return out


def watched(irqs):
    return {"irq." + k: str(n) for k, n in irqs.items() if any(w in k.lower() for w in IRQ_WATCH)}


def sources():
    fast, slow, sensors = Files(), Files(), Files()
    for d in sorted(glob.glob(ROOT + "/sys/class/backlight/*")):
        for a in ("brightness", "actual_brightness", "bl_power"):
            fast.add("bl.%s" % a, "%s/%s" % (d, a))
    for d in sorted(glob.glob(ROOT + "/sys/class/drm/card*-*")):
        for a in ("status", "enabled", "dpms"):
            fast.add("drm.%s.%s" % (os.path.basename(d).split("-", 1)[1], a), "%s/%s" % (d, a))
    for d in sorted(glob.glob(ROOT + "/sys/class/regulator/regulator.*")):
        try:
            with open(d + "/name") as f:
                name = f.read().strip()
        except OSError:
            name = os.path.basename(d)
        for a in ("state", "num_users", "microvolts"):
            if os.path.exists("%s/%s" % (d, a)):
                slow.add("reg.%s.%s" % (name, a), "%s/%s" % (d, a))
    for d in sorted(glob.glob(ROOT + "/sys/class/thermal/thermal_zone*")):
        sensors.add("temp.%s" % os.path.basename(d), d + "/temp")
    for d in sorted(glob.glob(ROOT + "/sys/bus/iio/devices/iio:device*")):
        for a in sorted(glob.glob(d + "/in_*_raw")):
            sensors.add("adc.%s.%s" % (os.path.basename(d), os.path.basename(a)), a)
    return fast, slow, sensors


def main(once=False):
    fd = os.open(MEM, os.O_RDONLY | os.O_SYNC)
    m = mmap.mmap(fd, 4096, mmap.MAP_SHARED, mmap.PROT_READ, offset=PAGE)
    os.close(fd)
    # one 4-byte load per register (as dspserver reads them), all ports in one C loop
    block = memoryview(m).cast("I")[PIO:PIO + len(PORTS) * PW]

    def read():
        return block.tolist()

    def say(t, text):
        print("pinlog %.3f %s" % (t, text), flush=True)

    def line(t, c, what):
        cfg0, cfg1, dat, pull = c
        cfg = cfg0 | cfg1 << 32  # one 4-bit field per pin, PH0 upwards
        pins = " ".join("PH%d=%d" % (p, (dat >> p) & 1) for p in CODEC_PINS)
        fn = " ".join("f%d=%d" % (p, (cfg >> (4 * p)) & 7) for p in CODEC_PINS)
        pl = " ".join("p%d=%d" % (p, (pull >> (2 * p)) & 3) for p in CODEC_PINS)
        say(t, "%s %s | %s | %s" % (what, pins, fn, pl))

    fast, slow, sensors = sources()

    def snapshot(t, v, sys_now, why):
        say(t, "snapshot %s: pio %s" % (why, " ".join(
            "%s=%s" % (p, ",".join("%x" % w for w in v[i * PW:(i + 1) * PW])) for i, p in enumerate(PORTS))))
        say(t, "snapshot %s: sys %s" % (why, " ".join("%s=%s" % kv for kv in sorted(sys_now.items()))))
        say(t, "snapshot %s: irq %s" % (why, " ".join("%s=%d" % kv for kv in interrupts().items())))
        say(t, "snapshot %s: sensors %s" % (why, " ".join("%s=%s" % kv for kv in sensors.read().items())))

    last = read()
    sys_last = dict(fast.read(), **slow.read(), **watched(interrupts()))
    t = uptime()
    line(t, codec(last), "first")
    snapshot(t, last, sys_last, "first")
    if once:
        return

    signal.signal(signal.SIGTERM, stop)  # systemd's stop at shutdown: still write the end lines
    changes = 0
    win = int(uptime() // WINDOW)
    lines = dict.fromkeys(BUDGET, 0)
    skipped = dict.fromkeys(BUDGET, 0)
    t_prev = t_alive = t_fast = t_slow = uptime()
    cpu_alive = time.process_time()
    reads, gap_max = 0, 0.0

    def alive(t, what):
        nonlocal t_alive, cpu_alive, reads, gap_max
        span = t - t_alive
        cpu = time.process_time() - cpu_alive
        say(t, "%s: %d reads in %.0f s, mean gap %.1f ms, longest %.1f ms, CPU %.1f s"
               " (%.2f %% of one core), %.1f MB in memory, %d changes so far"
               % (what, reads, span, span / reads * 1000 if reads else 0.0, gap_max * 1000, cpu,
                  cpu / span * 100 if span else 0.0, rss_mb(), changes))
        t_alive, cpu_alive, reads, gap_max = t, time.process_time(), 0, 0.0

    def budget(kind):
        if lines[kind] < BUDGET[kind]:
            lines[kind] += 1
            return True
        skipped[kind] += 1
        return False

    def flush_skipped(t):
        # the codec line says the state the skipped changes ended in: the next reading compares to it
        for kind, n in skipped.items():
            if not n:
                continue
            if kind in ("codec", "PH12"):
                line(t, codec(last), "skipped %d %s changes in the minute from %d s (more than %d), now"
                     % (n, kind, win * WINDOW, BUDGET[kind]))
            else:
                say(t, "skipped %d %s lines in the minute from %d s (more than %d)"
                    % (n, kind, win * WINDOW, BUDGET[kind]))

    def sys_changes(t, now):
        nonlocal sys_last
        diff = [k for k in sorted(set(now) | set(sys_last)) if now.get(k) != sys_last.get(k)]
        if diff and budget("sys"):
            say(t, "sys %s" % ", ".join("%s %s>%s" % (k, sys_last.get(k, "-"), now.get(k, "-"))
                                        for k in diff))
        sys_last = now
        return bool(diff)

    try:
        while True:
            t = uptime()
            v = read()
            reads += 1
            gap_max = max(gap_max, t - t_prev)
            t_prev = t
            if int(t // WINDOW) != win:
                flush_skipped(t)
                win = int(t // WINDOW)
                lines = dict.fromkeys(BUDGET, 0)
                skipped = dict.fromkeys(BUDGET, 0)
            if v != last:
                c, c_last = codec(v), codec(last)
                if c != c_last:
                    changes += 1
                    kind = "codec" if any((a ^ b) & k for a, b, k in zip(c, c_last, CODEC)) else "PH12"
                    if budget(kind):
                        line(t, c, "change")
                for p, text in pin_changes(last, v):
                    changes += 1
                    if budget("P" + p):
                        say(t, "pins %s" % text)
                dat, dat_last = c[2], c_last[2]
                why = None
                if (dat ^ dat_last) & 4:
                    why = "PH2 low" if not dat & 4 else "PH2 high again"
                elif dat & 2 and not dat_last & 2:
                    why = "PH1 high (codec setup done)"
                last = v
                if why and budget("snapshot"):
                    snapshot(t, v, sys_last, why)
            if t - t_fast >= FAST:
                now = dict(sys_last)
                now.update(fast.read())
                now = {k: x for k, x in now.items() if not k.startswith("irq.")}
                now.update(watched(interrupts()))
                if t - t_slow >= SLOW:
                    now.update(slow.read())
                    t_slow = t
                if sys_changes(t, now):
                    changes += 1
                t_fast = t
            if t - t_alive >= ALIVE:
                alive(t, "alive")
                snapshot(t, last, sys_last, "hourly")
            time.sleep(STEP)
    finally:
        # at a shutdown the journal's stream may already be gone: then the end lines are lost, quietly
        try:
            t = uptime()
            flush_skipped(t)
            alive(t, "alive at the end")
            snapshot(t, last, sys_last, "at the end")
            line(t, codec(last), "last (%d changes)" % changes)
        except OSError:
            pass


if __name__ == "__main__":
    try:
        main(once=sys.argv[1:] == ["--once"])
    except OSError as e:
        print("pinlog: %s" % e, file=sys.stderr, flush=True)
        sys.exit(1)
