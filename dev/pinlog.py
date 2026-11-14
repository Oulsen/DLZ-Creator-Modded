#!/usr/bin/env python3
# Pin log for the dev card (#261, #287, #293, for #257). Runs at every start once dev/pinlog.sh has put
# it on the card, and writes to the journal (so the network log carries it), for the whole session:
#
# - the codec pins PH0-PH2 and PH12 (data, function, pull): the first state and every change, in the
#   line format of #261/#287, so old and new logs compare line by line ("last (N changes)" still
#   counts only these);
# - every other GPIO pin of ports A-I: every change of its function, pull or drive, and of its level
#   while it is an input, an output or an interrupt input (functions 0, 1, 6); a pin running another
#   hardware function (the backlight's PWM, a UART, I2S at MHz rates) toggles all the time, its data
#   bit is masked; for the codec pins their drive, which the codec line does not carry. Budgets per
#   pin, so a busy one (dspserver's bit-banged I2C on port I) cannot hide another (PI14);
# - every 100 ms the screen (backlight, the display connectors) and the power chip's interrupt lines
#   (AXP221, NMI, power key), every 500 ms each regulator's state, users and voltage: each change.
#   Drivers that come up after this unit (it starts early) are picked up by a rescan, every 5 s in
#   the first 2 minutes, then every minute;
# - every minute a "load" line for #8 (memory and processor over long sessions): per core 0-2 the
#   average busy share and the highest second (sampled every second; core 3 is dspserver's, which
#   spins there, so it always reads ~99 %), MemAvailable and the memory (RSS, MB) of dspserver, the
#   node processes, glesgui and faderlink; then a "mem" line: MemFree, Cached, Shmem, SUnreclaim,
#   CmaFree, swap, the kernel's OOM kills (/proc/vmstat oom_kill) and per process RssAnon (what it
#   allocated itself: what grows in a leak), RssFile and RssShmem; both outside the line budgets;
# - a full snapshot (all pin registers, all of the above read anew, every interrupt line's count, the
#   SoC's temperatures, the clocks dspserver sets: CPU, DDR, GPU and audio PLLs, the I2S gates, resets
#   and module clocks, and the registers of each I2S that is clocked and out of reset, with its sample
#   counters read twice 10 ms apart: whether the processor still streams audio to the codecs) at the
#   first read, when the codec setup ends (PH1 goes high), when PH2 goes low and high again, a minute
#   into the start, every hour and at the end, so a silent start compares field by field with a start
#   with sound.
#
# Three threads: the pin loop reads only the pin registers; a poller does the /sys and /proc reads
# (a regulator read can wait for the PMIC's I2C) and the rescans; a worker does the snapshots. While
# either of the two is busy the interpreter lock changes hands every 0.5 ms (Python's default is 5 ms),
# so the pin loop waits at most that long for it.
#
# dspserver makes PH0/PH1 outputs and PH2 an input with pull-up, pulses PH0 and raises PH1 around the
# codec setup at its start, and gates a later AKM re-setup on PH2 (notes/components/dspserver.md,
# #257). In both silent starts so far PH2 went low for ~12 ms about 1.2 s after the setup.
#
# How often it reads: it sleeps 1 ms between reads, but this kernel wakes sleepers only on its 4 ms
# tick (CONFIG_HZ=250 without high-resolution timers), so a pin read comes about every 4 ms; a pulse
# shorter than that can fall between two reads. Every hour (and at the end) an "alive" line says how
# many reads it made, their mean and longest gap, the CPU time it used, and whether its threads run.
#
# Read-only: two pages of /dev/mem mapped PROT_READ (the CCU and PIO page, and the I2S page, which is
# optional), and reads of /sys and /proc. The I2S FIFO registers are never read (a read takes a
# sample out). An I2S is read only when its bus gate and reset show it running, checked before and
# after; dspserver changes them only at its own start and stop, so a read can at worst meet a block
# that was just stopped (on this SoC such a read returns zeros [guess]) and is then dropped. The
# PMIC is never written and never addressed directly: no PMIC register, no IIO ADC (axp20x_adc reads
# the AXP221 over I2C at every read), temperatures only from the SoC's thermal zones. The regulator
# files are read through the kernel's driver, which keeps the AXP221's regulator registers in its
# register cache after their first read [guess, regmap].
# DLZ_PINLOG_MEM and DLZ_PINLOG_ROOT point it at a stand-in file and tree (tests/pinlog.sh).
# Usage: dlzdev-pinlog            (the unit: until it is stopped)
#        dlzdev-pinlog --once     (one reading and one snapshot, for dev/pinlog.sh on)
import glob
import mmap
import os
import queue
import signal
import sys
import threading
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
LEVEL = (0, 1, 6)    # functions whose data bit is the pin's level: input, output, interrupt input
STEP = 0.001         # asks for 1 ms; the 4 ms tick sets the real pace
FAST = 0.1           # screen and interrupt lines
SLOW = 0.5           # regulators
RESCAN_EARLY, RESCAN_LATE, EARLY = 5.0, 60.0, 120.0  # new screen/rail/sensor files: every 5 s for
# the first 2 minutes of the unit (from ~11 s uptime), then every minute
ALIVE = 3600.0       # seconds between "alive" lines (each with a snapshot)
LOAD_SAMPLE = 1.0    # the mixer's load (#8): cores 0-2 sampled every second...
LOAD_LINE = float(os.environ.get("DLZ_PINLOG_LOAD", 60.0))  # ...one line a minute (the test: sooner)
MINUTE_IN = 60.0     # one more snapshot at this uptime, when a start has settled
# the line budgets count per minute of uptime (fixed minutes, not a sliding one); the test makes the
# window longer so it never crosses one
WINDOW = float(os.environ.get("DLZ_PINLOG_WINDOW", 60.0))
# change lines per window at most, more are counted in one summary line; separate budgets, so a busy
# pin or rail can neither crowd out a PH0-PH2 change nor flood the card's syslog
BUDGET = {"codec": 60, "PH12": 10, "sys": 60, "snapshot": 10}
PIN_BUDGET = 10      # per other pin, e.g. "PI14"
IRQ_WATCH = ("axp", "nmi", "pek")  # interrupt lines logged on change; all of them in a snapshot
# the clock unit (CCU) shares the PIO's page: the PLLs dspserver sets at its start (CPU, DDR, GPU, and
# the audio PLL it writes without waiting for the lock bit, bit 28), the I2S bus gates and resets
# (bits 12-14 = I2S0-2) and the I2S module clocks; for snapshots only
CCU = (("pll_cpu", 0x00), ("pll_audio", 0x08), ("pll_ddr0", 0x20), ("pll_gpu", 0x38),
       ("bus_gate2", 0x68), ("bus_rst3", 0x2D0), ("i2s0_clk", 0xB0), ("i2s1_clk", 0xB4),
       ("i2s2_clk", 0xB8))
I2S_PAGE = 0x01C22000  # I2S0 at +0x000, I2S1 at +0x400, I2S2 at +0x800
# readable without side effects: CTL, FMT0, FMT1, ISTA, FCTL, FSTA, INT, CLKD, TXCNT, RXCNT. Never
# 0x10 (RXFIFO: a read takes a sample out) or 0x20 (TXFIFO). TXCNT/RXCNT count the samples moved, so
# two reads 10 ms apart say whether that I2S is streaming
I2S = (("ctl", 0x00), ("fmt0", 0x04), ("fmt1", 0x08), ("ista", 0x0C), ("fctl", 0x14), ("fsta", 0x18),
       ("int", 0x1C), ("clkd", 0x24), ("txcnt", 0x28), ("rxcnt", 0x2C))

PRINT = threading.Lock()  # the three threads all write lines


def uptime():
    return time.clock_gettime(time.CLOCK_BOOTTIME)


def say(t, text):
    with PRINT:
        print("pinlog %.3f %s" % (t, text), flush=True)


def rss_mb():
    try:
        with open("/proc/self/status") as f:
            for row in f:
                if row.startswith("VmRSS:"):
                    return int(row.split()[1]) / 1024
    except (OSError, ValueError):
        pass
    return -1.0


class Busy:
    # while a background thread works, the interpreter lock changes hands every 0.5 ms; idle, the
    # default 5 ms (switching costs nothing then)
    lock = threading.Lock()
    n = 0

    def __enter__(self):
        with Busy.lock:
            Busy.n += 1
            sys.setswitchinterval(0.0005)

    def __exit__(self, *exc):
        with Busy.lock:
            Busy.n -= 1
            if not Busy.n:
                sys.setswitchinterval(0.005)


class Budget:
    # lines per window per kind; more are counted and summed up in one line per kind at the window's end
    def __init__(self, limits, default=None):
        self.limits, self.default = limits, default
        self.win = int(uptime() // WINDOW)
        self.lines, self.skipped = {}, {}

    def roll(self, t, flush):
        if int(t // WINDOW) != self.win:
            flush(t)
            self.win = int(t // WINDOW)
            self.lines, self.skipped = {}, {}

    def take(self, kind):
        if self.lines.get(kind, 0) < self.limits.get(kind, self.default):
            self.lines[kind] = self.lines.get(kind, 0) + 1
            return True
        self.skipped[kind] = self.skipped.get(kind, 0) + 1
        return False

    def limit(self, kind):
        return self.limits.get(kind, self.default)


def codec(v):
    # the codec line's fields (cfg0, cfg1, dat, pull0) from one read of all ports
    return (v[H] & 0x00000FFF, v[H + 1] & 0x00070000, v[H + 4] & 0x00001007, v[H + 7] & 0x0300003F)


def pin(v, b, n):
    # function, data, drive, pull of pin n of the port whose first word is b
    return ((v[b + n // 8] >> (4 * (n % 8))) & 7, (v[b + 4] >> n) & 1,
            (v[b + 5 + n // 16] >> (2 * (n % 16))) & 3, (v[b + 7 + n // 16] >> (2 * (n % 16))) & 3)


def changed_pins(old, new, b):
    # the pins of the port at b whose function, data, drive or pull bits differ, from the XOR of each
    # register: a toggling pin costs one pin's work, not 32 (the mixer has pins toggling 60-120 times a
    # second, e.g. PA14/PA15 [device])
    pins = set()
    for k in range(4):  # CFG0-3: 4 bits per pin, 8 pins per word
        x = old[b + k] ^ new[b + k]
        while x:
            low = (x & -x).bit_length() - 1
            pins.add(k * 8 + low // 4)
            x &= ~(0xF << (low // 4 * 4))
    x = old[b + 4] ^ new[b + 4]  # DAT: 1 bit per pin
    while x:
        low = (x & -x).bit_length() - 1
        pins.add(low)
        x &= x - 1
    for k in (5, 6, 7, 8):  # DRV0-1, PULL0-1: 2 bits per pin, 16 pins per word
        x = old[b + k] ^ new[b + k]
        while x:
            low = (x & -x).bit_length() - 1
            pins.add((k - 5) % 2 * 16 + low // 2)
            x &= ~(0x3 << (low // 2 * 2))
    return sorted(pins)


def pin_changes(old, new):
    # [("PB3", "d1>0 ...")] for every pin change the codec line does not show
    out = []
    for i, p in enumerate(PORTS):
        b = i * PW
        if old[b:b + PW] == new[b:b + PW]:
            continue
        for n in changed_pins(old, new, b):
            o, w = pin(old, b, n), pin(new, b, n)
            if o == w:
                continue
            in_codec = p == "H" and n in CODEC_PINS
            got = []
            for k, name in enumerate("fdrp"):  # function, data, drive, pull
                if o[k] == w[k] or (in_codec and k != 2):
                    continue  # a codec pin's function, data and pull are in the codec line
                if k == 1 and (o[0] not in LEVEL or w[0] not in LEVEL):
                    continue  # a data bit counts only while it is the pin's level on both sides:
                    # across a change to or from another function the masked bit would invent an edge
                got.append("%s%d>%d" % (name, o[k], w[k]))
            if got:
                out.append(("P%s%d" % (p, n), " ".join(got)))
    return out


def level_mask(v):
    # per port, the data bits that are a pin's level, and always the codec pins (their line shows the
    # data whatever the function, as in #261/#287)
    mask = []
    for i, p in enumerate(PORTS):
        b, bits = i * PW, 0
        for n in range(32):
            if pin(v, b, n)[0] in LEVEL or (p == "H" and n in CODEC_PINS):
                bits |= 1 << n
        mask.append(bits)
    return mask


def masked(v, mask):
    out = list(v)
    for i in range(len(PORTS)):
        out[i * PW + 4] &= mask[i]
    return out


def cfgs(v):
    return [v[i * PW + k] for i in range(len(PORTS)) for k in range(4)]


def clean(name):
    return name.strip().replace(" ", "_").replace("=", "_") or "-"


class Files:
    # sysfs attributes kept open and re-read with pread at offset 0 (sysfs makes the value anew)
    def __init__(self):
        self.fds = {}

    def add(self, name, path):
        if name in self.fds:
            return
        try:
            self.fds[name] = os.open(path, os.O_RDONLY)
        except OSError:
            pass

    def read(self):
        out = {}
        for name, fd in list(self.fds.items()):  # a copy: the poller's rescan may add to it
            try:
                out[name] = clean(os.pread(fd, 256, 0).decode(errors="replace"))
            except OSError as e:
                out[name] = "err%d" % (e.errno or 0)
        return out


class Interrupts:
    # /proc/interrupts kept open; the watched lines are picked out before any parsing
    def __init__(self):
        try:
            self.fd = os.open(ROOT + "/proc/interrupts", os.O_RDONLY)
        except OSError:
            self.fd = None

    def rows(self):
        if self.fd is None:
            return []
        try:
            return os.pread(self.fd, 65536, 0).decode(errors="replace").splitlines()
        except OSError:
            return []

    @staticmethod
    def parse(rows, ncpu):
        out = {}
        for row in rows:
            f = row.split()
            if not f or not f[0].endswith(":"):
                continue
            n = 1  # the per-CPU counts: the digit fields right after the number, at most one per CPU
            while n <= ncpu and n < len(f) and f[n].isdigit():
                n += 1
            out[f[0][:-1] + ":" + "_".join(f[n:])] = sum(int(x) for x in f[1:n])
        return out

    def all(self):
        rows = self.rows()
        return self.parse(rows[1:], len(rows[0].split()) if rows else 0)

    def watched(self):
        rows = self.rows()
        if not rows:
            return {}
        picked = [r for r in rows[1:] if any(w in r.lower() for w in IRQ_WATCH)]
        return {"irq." + k: str(n) for k, n in self.parse(picked, len(rows[0].split())).items()}


class Sources:
    def __init__(self):
        self.fast, self.slow, self.temps = Files(), Files(), Files()
        self.irqs = Interrupts()
        self.known = {}  # regulator directory: its name
        self.scan()

    def scan(self):
        for d in sorted(glob.glob(ROOT + "/sys/class/backlight/*")):
            for a in ("brightness", "actual_brightness", "bl_power"):
                self.fast.add("bl.%s.%s" % (os.path.basename(d), a), "%s/%s" % (d, a))
        for d in sorted(glob.glob(ROOT + "/sys/class/drm/card*-*")):
            for a in ("status", "enabled", "dpms"):
                self.fast.add("drm.%s.%s" % (os.path.basename(d), a), "%s/%s" % (d, a))
        for d in sorted(glob.glob(ROOT + "/sys/class/regulator/regulator.*")):
            if d not in self.known:  # its name once; its files are looked for at every scan
                try:
                    with open(d + "/name") as f:
                        self.known[d] = clean(f.read())
                except OSError:
                    continue  # still being registered: the next scan
            for a in ("state", "num_users", "microvolts"):
                if os.path.exists("%s/%s" % (d, a)):
                    # name and number: the same key in every start, two rails of one name apart
                    self.slow.add("reg.%s@%s.%s" % (self.known[d], os.path.basename(d), a),
                                  "%s/%s" % (d, a))
        for d in sorted(glob.glob(ROOT + "/sys/class/thermal/thermal_zone*")):
            # only the SoC's own sensors: a zone on an ADC (the PMIC's) would read it over I2C
            try:
                with open(d + "/type") as f:
                    kind = f.read().strip().lower()
            except OSError:
                continue
            if not any(w in kind for w in ("axp", "adc", "iio", "pmic", "battery")):
                self.temps.add("temp.%s.%s" % (os.path.basename(d), clean(kind)), d + "/temp")

    def fast_now(self):
        return dict(self.fast.read(), **self.irqs.watched())

    def now(self):
        return dict(self.fast_now(), **self.slow.read())


class Load:
    # the whole mixer's load for #8 (memory and processor over long sessions): cores 0-2 sampled every
    # second from /proc/stat (core 3 left out: dspserver spins there while it waits, ~99 % always; its
    # headroom is dev/dsp-headroom.sh's), and once a line period the average and the highest second
    # per core, MemAvailable and the memory (RSS) of Mackie's processes. Outside the line budgets
    CORES = ("cpu0", "cpu1", "cpu2")
    PROCS = ("dspserver", "node", "glesgui", "faderlink")

    def __init__(self):
        self.prev = self.stat()
        self.busy = {c: [] for c in self.CORES}

    @staticmethod
    def stat():
        out = {}
        try:
            with open(ROOT + "/proc/stat") as f:
                for row in f:
                    f_ = row.split()
                    if f_ and f_[0] in Load.CORES:
                        n = [int(x) for x in f_[1:]]
                        out[f_[0]] = (sum(n), n[3] + (n[4] if len(n) > 4 else 0))  # total, idle+iowait
        except (OSError, ValueError):
            pass
        return out

    def sample(self):
        now = self.stat()
        for c in self.CORES:
            if c in now and c in self.prev:
                total, idle = now[c][0] - self.prev[c][0], now[c][1] - self.prev[c][1]
                if total > 0:
                    self.busy[c].append(100.0 * (total - idle) / total)
        self.prev = now

    @staticmethod
    def mem_available():
        try:
            with open(ROOT + "/proc/meminfo") as f:
                for row in f:
                    if row.startswith("MemAvailable:"):
                        return "%d MB" % (int(row.split()[1]) // 1024)
        except (OSError, ValueError):
            pass
        return "-"

    MEMINFO = ("MemFree", "Cached", "Shmem", "SUnreclaim", "CmaFree", "SwapTotal", "SwapFree")

    @staticmethod
    def mem():
        # the line after "load", for a leak over a long session: the system's memory by kind, the
        # kernel's OOM kills, and per process what it allocated itself (RssAnon, what grows when it
        # leaks), files it maps (RssFile) and shared memory (RssShmem), in MB
        info = {}
        try:
            with open(ROOT + "/proc/meminfo") as f:
                for row in f:
                    k = row.split(":")[0]
                    if k in Load.MEMINFO:
                        info[k] = int(row.split()[1]) // 1024
        except (OSError, ValueError, IndexError):
            pass
        oom = "-"
        try:
            with open(ROOT + "/proc/vmstat") as f:
                for row in f:
                    if row.startswith("oom_kill "):
                        oom = row.split()[1]
        except OSError:
            pass
        sysmem = ", ".join("%s %s" % (k, info[k]) for k in Load.MEMINFO if k in info) or "-"
        procs = " ".join("%s=%s" % (name, "/".join(str(st.get(k, "-")) for k in
                                                   ("RssAnon", "RssFile", "RssShmem")))
                         for name, st in Load.procs())
        return "mem MB %s, oom_kill %s, anon/file/shmem MB %s" % (sysmem, oom, procs or "-")

    @staticmethod
    def procs():
        # [(name, {VmRSS, RssAnon, RssFile, RssShmem in MB})] of Mackie's processes, by their program
        # (not their thread name: dspserver calls its main thread dspMainLoop [device]); node's
        # (evolve-node, evolve-app) by their script
        out = []
        for d in glob.glob(ROOT + "/proc/[0-9]*"):
            try:
                with open(d + "/cmdline", "rb") as f:
                    args = [a.decode(errors="replace") for a in f.read().split(b"\0") if a]
                prog = os.path.basename(args[0]) if args else ""
                if prog not in Load.PROCS:
                    continue
                name = prog
                if prog == "node":
                    script = [a for a in args[1:] if not a.startswith("-")]
                    name = "node:" + (os.path.basename(script[0]) if script else "?")
                st = {}
                with open(d + "/status") as f:
                    for r in f:
                        k = r.split(":")[0]
                        if k in ("VmRSS", "RssAnon", "RssFile", "RssShmem"):
                            st[k] = int(r.split()[1]) // 1024
                out.append((name, st))
            except (OSError, ValueError, IndexError):
                continue  # gone in between, or a kernel thread
        return sorted(out)

    @staticmethod
    def rss():
        return " ".join("%s=%d" % (name, st["VmRSS"]) for name, st in Load.procs() if "VmRSS" in st) or "-"

    def line(self):
        parts = []
        for c in self.CORES:
            b = self.busy[c]
            parts.append("%s %.0f%% max %.0f%%" % (c, sum(b) / len(b), max(b)) if b else "%s -" % c)
        self.busy = {c: [] for c in self.CORES}
        return "load %s, MemAvailable %s, RSS MB %s" % (", ".join(parts), self.mem_available(), self.rss())


def main(once=False):
    stopping = threading.Event()
    if not once:  # from the very start: a stop during the first snapshot still ends with the end lines
        signal.signal(signal.SIGTERM, lambda signum, frame: stopping.set())
    fd = os.open(MEM, os.O_RDONLY | os.O_SYNC)
    m = mmap.mmap(fd, 4096, mmap.MAP_SHARED, mmap.PROT_READ, offset=PAGE)
    try:  # optional: without it the snapshots say so, and the pins are still logged
        i2s_page = memoryview(mmap.mmap(fd, 4096, mmap.MAP_SHARED, mmap.PROT_READ,
                                        offset=I2S_PAGE)).cast("I")
        i2s_error = 0
    except (OSError, ValueError) as e:  # refused, or (a stand-in file) past its end
        i2s_page, i2s_error = None, getattr(e, "errno", None) or 0
    os.close(fd)
    # one 4-byte load per register (as dspserver reads them), all ports in one C loop
    page = memoryview(m).cast("I")
    block = page[PIO:PIO + len(PORTS) * PW]
    gate, rst = dict(CCU)["bus_gate2"] // 4, dict(CCU)["bus_rst3"] // 4

    def read():
        return block.tolist()

    def clocks():
        return {name: page[off // 4] for name, off in CCU}

    def i2s():
        # only an I2S whose bus clock is on and whose reset is released, before and after the read; a
        # read that met a change in between is dropped
        regs = {}
        for n in range(3):
            bit = 1 << (12 + n)
            ccu = (page[gate], page[rst])
            if not ccu[0] & bit or not ccu[1] & bit:
                continue
            got = {name: i2s_page[(0x400 * n + off) // 4] for name, off in I2S}
            if (page[gate], page[rst]) == ccu:
                regs[n] = got
        return regs

    def line(t, c, what):
        cfg0, cfg1, dat, pull = c
        cfg = cfg0 | cfg1 << 32  # one 4-bit field per pin, PH0 upwards
        pins = " ".join("PH%d=%d" % (p, (dat >> p) & 1) for p in CODEC_PINS)
        fn = " ".join("f%d=%d" % (p, (cfg >> (4 * p)) & 7) for p in CODEC_PINS)
        pl = " ".join("p%d=%d" % (p, (pull >> (2 * p)) & 3) for p in CODEC_PINS)
        say(t, "%s %s | %s | %s" % (what, pins, fn, pl))

    src = Sources()

    def snapshot(t, v, why):
        # t and v: the moment and the pin read that caused it; everything else is read now
        say(t, "snapshot %s: pio %s" % (why, " ".join(
            "%s=%s" % (p, ",".join("%x" % w for w in v[i * PW:(i + 1) * PW])) for i, p in enumerate(PORTS))))
        say(t, "snapshot %s: sys %s (read at %.3f)" % (
            why, " ".join("%s=%s" % kv for kv in sorted(src.now().items())), uptime()))
        say(t, "snapshot %s: irq %s" % (why, " ".join("%s=%d" % kv for kv in src.irqs.all().items())))
        say(t, "snapshot %s: sensors %s" % (why, " ".join("%s=%s" % kv for kv in src.temps.read().items())))
        ccu = clocks()
        say(t, "snapshot %s: clk %s audio_pll_locked=%d" % (why, " ".join(
            "%s=%x" % kv for kv in ccu.items()), ccu["pll_audio"] >> 28 & 1))
        if i2s_page is None:
            say(t, "snapshot %s: i2s unmapped (error %d)" % (why, i2s_error))
            return
        first = i2s()
        time.sleep(0.01)
        again = i2s()
        parts = []
        for n in range(3):
            if n not in first or n not in again:
                parts.append("i2s%d=off" % n)
                continue
            regs = " ".join("%s=%x" % kv for kv in first[n].items())
            parts.append("i2s%d %s tx+%d rx+%d in 10ms" % (
                n, regs, (again[n]["txcnt"] - first[n]["txcnt"]) & 0xFFFFFFFF,
                (again[n]["rxcnt"] - first[n]["rxcnt"]) & 0xFFFFFFFF))
        say(t, "snapshot %s: i2s %s" % (why, ", ".join(parts)))

    last = read()
    t = uptime()
    line(t, codec(last), "first")
    snapshot(t, last, "first")
    if once:
        return

    counts = {"codec": 0, "other": 0}  # codec-line changes (as in #261/#287), and every other change

    def flush(budget, t):
        for kind, n in budget.skipped.items():
            if kind in ("codec", "PH12"):
                line(t, codec(last), "skipped %d %s changes in the minute from %d s (more than %d), now"
                     % (n, kind, budget.win * WINDOW, budget.limit(kind)))
            else:
                say(t, "skipped %d %s lines in the minute from %d s (more than %d)"
                    % (n, kind, budget.win * WINDOW, budget.limit(kind)))

    # the snapshot worker: the pin loop only queues them, so it keeps reading at an edge
    jobs = queue.Queue()

    def worker():
        while True:
            job = jobs.get()
            if job is None:
                return
            try:
                with Busy():
                    snapshot(*job)
            except Exception as e:  # a failed snapshot must not end the thread
                try:
                    say(uptime(), "pinlog snapshot %s failed: %s" % (job[2], e))
                except Exception:
                    pass

    # the poller: /sys and /proc every 100 ms (regulators every 500 ms) and the rescans, off the pin
    # loop, since a regulator read can wait for the PMIC's I2C
    def poller():
        budget = Budget({"sys": BUDGET["sys"]})
        cached = src.slow.read()
        sys_last = dict(src.fast_now(), **cached)
        t_slow = t_scan = t_start = t_sample = t_load = uptime()
        load = Load()
        while not stopping.wait(FAST):
            try:
                t = uptime()
                with Busy():
                    if t - t_sample >= LOAD_SAMPLE:
                        load.sample()
                        t_sample = t
                    if t - t_load >= LOAD_LINE:
                        say(t, load.line())
                        say(t, load.mem())
                        t_load = t
                    if t - t_scan >= (RESCAN_EARLY if t - t_start < EARLY else RESCAN_LATE):
                        src.scan()  # a driver that came up after this unit: its files from now on
                        t_scan = t
                    if t - t_slow >= SLOW:
                        cached = src.slow.read()
                        t_slow = t
                    now = dict(src.fast_now(), **cached)
                budget.roll(t, lambda t: flush(budget, t))
                diff = [k for k in sorted(set(now) | set(sys_last)) if now.get(k) != sys_last.get(k)]
                if diff:
                    counts["other"] += 1
                    if budget.take("sys"):
                        say(t, "sys %s" % ", ".join(
                            "%s %s>%s" % (k, sys_last.get(k, "-"), now.get(k, "-")) for k in diff))
                sys_last = now
            except Exception as e:  # keep polling; one line about it
                try:
                    say(uptime(), "pinlog poll failed: %s" % e)
                except Exception:
                    pass
        flush(budget, uptime())

    snapper = threading.Thread(target=worker, daemon=True)
    poll = threading.Thread(target=poller, daemon=True)
    snapper.start()
    poll.start()

    budget = Budget(BUDGET, PIN_BUDGET)
    t_prev = t_alive = uptime()
    cpu_alive = time.process_time()
    reads, gap_max = 0, 0.0
    minute_done = uptime() >= MINUTE_IN  # started later by hand: no "a minute in" snapshot
    raw_last = raw_prev = last
    mask = level_mask(last)
    # a pin whose data changes used up its lines for the window is left out of the comparison until
    # the window ends ("muted"): a pin toggling 120 times a second would otherwise send nearly every
    # read through the change handling, which cost ~25 % of one core on the mixer [device]. Its
    # toggles are still counted, one bit test per read, for the window's "skipped" line
    muted = [0] * len(PORTS)
    muted_pins = []  # (port index, bit, "PA14")

    def effective():
        return [m & ~u for m, u in zip(mask, muted)]

    mask_eff = effective()
    last = masked(last, mask_eff)

    def flush_main(t):
        nonlocal muted, muted_pins, mask_eff
        flush(budget, t)
        muted, muted_pins = [0] * len(PORTS), []
        mask_eff = effective()

    def alive(t, what):
        nonlocal t_alive, cpu_alive, reads, gap_max
        span = t - t_alive
        cpu = time.process_time() - cpu_alive
        say(t, "%s: %d reads in %.0f s, mean gap %.1f ms, longest %.1f ms, CPU %.1f s"
               " (%.2f %% of one core), %.1f MB in memory, %d changes so far, %d other, snapshot"
               " thread %s, poller %s"
               % (what, reads, span, span / reads * 1000 if reads else 0.0, gap_max * 1000, cpu,
                  cpu / span * 100 if span else 0.0, rss_mb(), counts["codec"], counts["other"],
                  "running" if snapper.is_alive() else "GONE", "running" if poll.is_alive() else "GONE"))
        t_alive, cpu_alive, reads, gap_max = t, time.process_time(), 0, 0.0

    def queue_snapshot(t, v, why, planned=False):
        # the planned ones (a minute in, hourly) outside the edges' budget: a flapping pin cannot
        # take them away
        if planned or budget.take("snapshot"):
            jobs.put((t, v, why))

    try:
        while not stopping.is_set():
            t = uptime()
            raw = read()
            reads += 1
            gap_max = max(gap_max, t - t_prev)
            t_prev = t
            if budget.win != int(t // WINDOW):
                budget.roll(t, flush_main)  # unmutes: compare those pins from the previous read on
                last = masked(raw_prev, mask_eff)
            for i, bit, name in muted_pins:  # a muted pin's toggles, counted
                if (raw[i * PW + 4] ^ raw_prev[i * PW + 4]) & bit:
                    budget.skipped[name] = budget.skipped.get(name, 0) + 1
                    counts["other"] += 1
            raw_prev = raw
            v = masked(raw, mask_eff)
            if v != last and cfgs(raw) != cfgs(raw_last):
                mask = level_mask(raw)  # a pin's function changed: which data bits count, anew
                mask_eff = effective()
                v = masked(raw, mask_eff)
            if v != last:
                c, c_last = codec(v), codec(last)
                if c != c_last:
                    counts["codec"] += 1
                    kind = "codec" if any((a ^ b) & k for a, b, k in zip(c, c_last, CODEC)) else "PH12"
                    if budget.take(kind):
                        line(t, c, "change")
                by_port = {}
                for name, text in pin_changes(last, v):
                    counts["other"] += 1
                    if budget.take(name):
                        by_port.setdefault(name[1], []).append("%s %s" % (name, text))
                    elif text.startswith("d") and " " not in text and name != "PH12":
                        # only its level changed and its lines are used up: mute it for the window
                        i, n = PORTS.index(name[1]), int(name[2:])
                        if not muted[i] >> n & 1:
                            muted[i] |= 1 << n
                            muted_pins.append((i, 1 << n, name))
                            mask_eff = effective()
                for p in sorted(by_port):
                    say(t, "pins %s" % ", ".join(by_port[p]))
                v = masked(raw, mask_eff)  # a pin muted just now: compare without it from here on
                # edges only while the pin is set up as dspserver sets it: PH2 an input, PH1 an output
                dat, dat_last = c[2], c_last[2]
                f1, f1_last = c[0] >> 4 & 7, c_last[0] >> 4 & 7
                f2, f2_last = c[0] >> 8 & 7, c_last[0] >> 8 & 7
                last, raw_last = v, raw
                if (dat ^ dat_last) & 4 and f2 == 0 and f2_last == 0:
                    queue_snapshot(t, raw, "PH2 low" if not dat & 4 else "PH2 high again")
                if dat & 2 and not dat_last & 2 and f1 == 1 and f1_last == 1:
                    queue_snapshot(t, raw, "PH1 high (codec setup done)")
            if t - t_alive >= ALIVE:
                alive(t, "alive")
                queue_snapshot(t, raw, "hourly", planned=True)  # this read, not the last changed one
            if not minute_done and t >= MINUTE_IN:
                minute_done = True
                queue_snapshot(t, raw, "a minute in", planned=True)
            time.sleep(STEP)
    finally:
        # at a shutdown the journal's stream may already be gone: then the end lines are lost, quietly.
        # Snapshots still waiting are dropped (and counted), the one running may finish, the poller
        # ends, then the end lines come alone, never mixed with a snapshot's
        try:
            stopping.set()
            dropped = 0
            while True:
                try:
                    jobs.get_nowait()
                    dropped += 1
                except queue.Empty:
                    break
            jobs.put(None)
            snapper.join(5.0)
            poll.join(5.0)
            t = uptime()
            if dropped:
                say(t, "%d snapshots dropped at the end" % dropped)
            flush(budget, t)
            alive(t, "alive at the end")
            if not snapper.is_alive():
                snapshot(t, read(), "at the end")
            line(t, codec(last), "last (%d changes)" % counts["codec"])
        except OSError:
            pass


if __name__ == "__main__":
    try:
        main(once=sys.argv[1:] == ["--once"])
    except OSError as e:
        print("pinlog: %s" % e, file=sys.stderr, flush=True)
        sys.exit(1)
