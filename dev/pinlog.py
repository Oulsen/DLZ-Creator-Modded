#!/usr/bin/env python3
# Codec pin log for the dev card (#261, #287, for #257). Runs at every start once dev/pinlog.sh has
# put it on the card, and writes to the journal (so the network log carries it) the first state and
# every change of GPIO port H's pins 0-2 and 12, for the whole session: until the mixer shuts down.
#
# dspserver makes PH0/PH1 outputs and PH2 an input with pull-up, pulses PH0 and raises PH1 around the
# codec setup at its start, and gates a later AKM re-setup on PH2 (notes/components/dspserver.md,
# #257). The function and pull registers are logged too: before dspserver configures a pin, its data
# bit says little.
#
# How often it reads: it sleeps 1 ms between reads, but this kernel wakes sleepers only on its 4 ms
# tick (CONFIG_HZ=250 without high-resolution timers, notes/components/dspserver.md), so a read comes
# about every 4 ms; a pulse shorter than that can fall between two reads. Every hour (and at the end)
# an "alive" line says how many reads it made, their mean and longest gap, and the CPU time it used,
# so the log itself shows what it could have missed and what it cost.
#
# Read-only: one page of /dev/mem mapped PROT_READ; reading the PIO registers has no side effects.
# Usage: dlzdev-pinlog            (the unit: until it is stopped)
#        dlzdev-pinlog --once     (one reading, for dev/pinlog.sh on)
import mmap
import os
import signal
import sys
import time

PAGE = 0x01C20000  # the PIO controller sits at 0x01C20800
REGS = (("cfg0", 0x8FC, 0x00000FFF),   # PH0-PH2 function, 4 bits each
        ("cfg1", 0x900, 0x00070000),   # PH12 function (PH8-PH15 in this one)
        ("dat", 0x90C, 0x00001007),    # PH0, PH1, PH2, PH12
        ("pull0", 0x918, 0x0300003F))  # PH0-PH2 and PH12 pull, 2 bits each
PINS = (0, 1, 2, 12)
CODEC = (0x00000FFF, 0, 0x00000007, 0x0000003F)  # the bits of PH0-PH2 in each of REGS; the rest is PH12
STEP = 0.001         # asks for 1 ms; the 4 ms tick sets the real pace
ALIVE = 3600.0       # seconds between "alive" lines
WINDOW = 60.0        # the line budget counts per minute of uptime (fixed minutes, not a sliding one)
# change lines per minute at most, more are counted in one summary line a minute; two budgets, so
# PH12 (faderlink's pin) toggling can neither crowd out a PH0-PH2 change nor flood the card's syslog
BUDGET = {"codec": 60, "PH12": 10}


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


def main(once=False):
    fd = os.open("/dev/mem", os.O_RDONLY | os.O_SYNC)
    m = mmap.mmap(fd, 4096, mmap.MAP_SHARED, mmap.PROT_READ, offset=PAGE)
    os.close(fd)
    # one 4-byte copy per register (in practice a single 32-bit load on armhf, as dspserver reads them)
    words = memoryview(m).cast("I")

    def read():
        return tuple(words[off // 4] & mask for _, off, mask in REGS)

    def line(t, v, what):
        cfg0, cfg1, dat, pull = v
        cfg = cfg0 | cfg1 << 32  # one 4-bit field per pin, PH0 upwards
        pins = " ".join("PH%d=%d" % (p, (dat >> p) & 1) for p in PINS)
        fn = " ".join("f%d=%d" % (p, (cfg >> (4 * p)) & 7) for p in PINS)
        pl = " ".join("p%d=%d" % (p, (pull >> (2 * p)) & 3) for p in PINS)
        print("pinlog %.3f %s %s | %s | %s" % (t, what, pins, fn, pl), flush=True)

    last = read()
    line(uptime(), last, "first")
    if once:
        return

    signal.signal(signal.SIGTERM, stop)  # systemd's stop at shutdown: still write the end lines
    changes = 0
    win = int(uptime() // WINDOW)
    lines = dict.fromkeys(BUDGET, 0)
    skipped = dict.fromkeys(BUDGET, 0)
    t_prev = t_alive = uptime()
    cpu_alive = time.process_time()
    reads, gap_max = 0, 0.0

    def alive(t, what):
        nonlocal t_alive, cpu_alive, reads, gap_max
        span = t - t_alive
        cpu = time.process_time() - cpu_alive
        print("pinlog %.3f %s: %d reads in %.0f s, mean gap %.1f ms, longest %.1f ms, CPU %.1f s"
              " (%.2f %% of one core), %.1f MB in memory, %d changes so far"
              % (t, what, reads, span, span / reads * 1000 if reads else 0.0, gap_max * 1000, cpu,
                 cpu / span * 100 if span else 0.0, rss_mb(), changes), flush=True)
        t_alive, cpu_alive, reads, gap_max = t, time.process_time(), 0, 0.0

    def flush_skipped(t):
        # the state the skipped changes ended in (last): the reading that follows is compared to it
        for kind, n in skipped.items():
            if n:
                line(t, last, "skipped %d %s changes in the minute from %d s (more than %d), now"
                     % (n, kind, win * WINDOW, BUDGET[kind]))

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
                changes += 1
                kind = "codec" if any((a ^ b) & c for a, b, c in zip(v, last, CODEC)) else "PH12"
                if lines[kind] < BUDGET[kind]:
                    line(t, v, "change")
                    lines[kind] += 1
                else:
                    skipped[kind] += 1
                last = v
            if t - t_alive >= ALIVE:
                alive(t, "alive")
            time.sleep(STEP)
    finally:
        # at a shutdown the journal's stream may already be gone: then the end lines are lost, quietly
        try:
            t = uptime()
            flush_skipped(t)
            alive(t, "alive at the end")
            line(t, last, "last (%d changes)" % changes)
        except OSError:
            pass


if __name__ == "__main__":
    try:
        main(once=sys.argv[1:] == ["--once"])
    except OSError as e:
        print("pinlog: %s" % e, file=sys.stderr, flush=True)
        sys.exit(1)
