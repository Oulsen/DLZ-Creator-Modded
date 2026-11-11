#!/usr/bin/env python3
# Codec pin log for the dev card (#261, for #257). Runs at every start once dev/pinlog.sh has put it
# on the card, and writes to the journal (so the network log carries it) the first state and every
# change of GPIO port H's pins 0-2 and 12 until 120 s after power-on, then exits.
#
# dspserver sets up the AKM DAC/ADC only while PH2 reads low, makes PH0/PH1 outputs and PH2 an input
# with pull-up (notes/components/dspserver.md, #257). The config and pull registers are logged too:
# before dspserver configures PH2, its data bit says little.
#
# Read-only: one page of /dev/mem mapped PROT_READ; reading the PIO registers has no side effects.
# Usage: dlzdev-pinlog            (the unit: until 120 s after power-on)
#        dlzdev-pinlog --once     (one reading, for dev/pinlog.sh on)
import mmap
import os
import sys
import time

PAGE = 0x01C20000  # the PIO controller sits at 0x01C20800
REGS = (("cfg0", 0x8FC, 0x00000FFF),   # PH0-PH2 function, 4 bits each
        ("dat", 0x90C, 0x00001007),    # PH0, PH1, PH2, PH12
        ("pull0", 0x918, 0x0000003F))  # PH0-PH2 pull, 2 bits each
UNTIL = 120.0  # seconds since power-on
STEP = 0.005


def uptime():
    return time.clock_gettime(time.CLOCK_BOOTTIME)


def main(once=False):
    fd = os.open("/dev/mem", os.O_RDONLY | os.O_SYNC)
    m = mmap.mmap(fd, 4096, mmap.MAP_SHARED, mmap.PROT_READ, offset=PAGE)
    os.close(fd)
    # whole 32-bit reads, as dspserver does: struct's "<I" would read byte by byte and could log a
    # torn value as a change
    words = memoryview(m).cast("I")

    def read():
        return tuple(words[off // 4] & mask for _, off, mask in REGS)

    def line(t, v, what):
        cfg, dat, pull = v
        pins = " ".join("PH%d=%d" % (b, (dat >> b) & 1) for b in (0, 1, 2, 12))
        fn = " ".join("f%d=%d" % (p, (cfg >> (4 * p)) & 7) for p in range(3))
        pl = " ".join("p%d=%d" % (p, (pull >> (2 * p)) & 3) for p in range(3))
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
