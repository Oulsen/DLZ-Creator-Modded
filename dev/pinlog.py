#!/usr/bin/env python3
# Codec pin log for the dev card (#261, for #257). Runs at every start once dev/pinlog.sh has put it
# on the card, and writes to the journal (so the network log carries it) the first state and every
# change of GPIO port H's pins 0-2 and 12 until 120 s after the kernel starts (the clock of the log's
# [uptime] stamps), then exits.
#
# dspserver makes PH0/PH1 outputs and PH2 an input with pull-up, pulses PH0 and raises PH1 around the
# codec setup at its start, and gates a later AKM re-setup on PH2 (notes/components/dspserver.md,
# #257). The function and pull registers are logged too: before dspserver configures a pin, its data
# bit says little.
#
# Read-only: one page of /dev/mem mapped PROT_READ; reading the PIO registers has no side effects.
# Usage: dlzdev-pinlog            (the unit: until 120 s after the kernel starts)
#        dlzdev-pinlog --once     (one reading, for dev/pinlog.sh on)
import mmap
import os
import sys
import time

PAGE = 0x01C20000  # the PIO controller sits at 0x01C20800
REGS = (("cfg0", 0x8FC, 0x00000FFF),   # PH0-PH2 function, 4 bits each
        ("cfg1", 0x900, 0x00070000),   # PH12 function (PH8-PH15 in this one)
        ("dat", 0x90C, 0x00001007),    # PH0, PH1, PH2, PH12
        ("pull0", 0x918, 0x0300003F))  # PH0-PH2 and PH12 pull, 2 bits each
PINS = (0, 1, 2, 12)
UNTIL = 120.0  # seconds since the kernel started (CLOCK_BOOTTIME, as the journal's uptime)
STEP = 0.005


def uptime():
    return time.clock_gettime(time.CLOCK_BOOTTIME)


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
    n = 0
    while True:
        t = uptime()
        if t >= UNTIL:
            break
        v = read()
        if v != last:
            line(t, v, "change")
            last = v
            n += 1
        time.sleep(STEP)
    line(uptime(), last, "last (%d changes)" % n)


if __name__ == "__main__":
    try:
        main(once=sys.argv[1:] == ["--once"])
    except OSError as e:
        print("pinlog: %s" % e, file=sys.stderr, flush=True)
        sys.exit(1)
