#!/bin/bash
# The pin log (install/sd-system/dlzmod-pinlog, #261, #287, #293) against a stand-in: a sparse file in place of
# /dev/mem and a small /sys and /proc tree. No mixer, no root, no dump.
#   bash tests/pinlog.sh
set -u
cd "$(dirname "$0")/.." || exit 2
SCRIPT=$PWD/install/sd-system/dlzmod-pinlog
TMP=$(mktemp -d)
pid=
busy=
trap 'kill $pid $busy 2> /dev/null; rm -rf "$TMP"' EXIT
fail=0
ok() { echo "ok    $*"; }
bad() { echo "FAIL  $*"; fail=1; }

MEM=$TMP/mem
R=$TMP/root
truncate -s $((0x01C22000 + 4096)) "$MEM"   # the CCU/PIO page and the I2S page
# poke PORT REG VALUE...: write 32-bit words into a port's registers (REG 0-3 CFG, 4 DAT, 5-6 DRV, 7-8
# PULL); with several values they are written one after the other, 10 ms apart. PORT "@" takes REG as
# a physical address (the CCU, the I2S registers)
poke() {
  python3 - "$MEM" "$@" << 'EOF'
import os, struct, sys, time
mem, port, reg, vals = sys.argv[1], sys.argv[2], int(sys.argv[3], 0), sys.argv[4:]
off = reg if port == "@" else 0x01C20000 + 0x800 + "ABCDEFGHI".index(port) * 0x24 + reg * 4
fd = os.open(mem, os.O_WRONLY)
for i, v in enumerate(vals):
    if i:
        time.sleep(0.01)
    os.pwrite(fd, struct.pack("<I", int(v, 0)), off)
os.close(fd)
EOF
}
# in place, as sysfs does: the log keeps those files open
put() { mkdir -p "$(dirname "$R/$1")"; printf '%s\n' "$2" > "$R/$1"; }
irqs() {
  put proc/interrupts "           CPU0       CPU1       CPU2       CPU3
 82:         99          0          0          0  sunxi_pio_edge  22 Edge      gt911
 92:          $1          0          0          0  sunxi-nmi   0 Level     axp22x_irq_chip
Err:          0"
}
B=sys/class
put $B/backlight/backlight/brightness 541
put $B/backlight/backlight/actual_brightness 541
put $B/backlight/backlight/bl_power 0
put $B/drm/card0-LVDS-1/status connected
put $B/drm/card0-LVDS-1/enabled enabled
put $B/drm/card0-LVDS-1/dpms On
put $B/regulator/regulator.7/name dc5ldo
put $B/regulator/regulator.7/state enabled
put $B/regulator/regulator.7/num_users 0
put $B/regulator/regulator.8/name dc5ldo        # a second rail with the same name
put $B/regulator/regulator.8/state enabled
put $B/regulator/regulator.9/name "vcc 3v3"     # a name with a space
put $B/regulator/regulator.9/state enabled
put $B/thermal/thermal_zone0/temp 45000
put $B/thermal/thermal_zone0/type cpu_thermal
put $B/thermal/thermal_zone1/temp 30000          # a zone on the PMIC's ADC: an I2C read, skipped
put $B/thermal/thermal_zone1/type axp221-adc
put sys/bus/iio/devices/iio:device0/in_temp_raw 1234   # the PMIC's ADC: an I2C read, never taken
irqs 3
# the mixer's load (#8): core 0 half busy (cpustat() below), 512 MB available, two of Mackie's processes
cpustat() {  # cpustat N: N steps of 100 jiffies on core 0 (50 busy), cores 1-3 idle
  put proc/stat "cpu  0 0 0 0 0 0 0 0 0 0
cpu0 $((50 * $1)) 0 0 $((50 * $1)) 0 0 0 0 0 0
cpu1 0 0 0 $((100 * $1)) 0 0 0 0 0 0
cpu2 0 0 0 $((100 * $1)) 0 0 0 0 0 0
cpu3 $((100 * $1)) 0 0 0 0 0 0 0 0 0
intr 0"
}
cpustat 1
put proc/meminfo "MemTotal: 1000000 kB
MemFree: 102400 kB
MemAvailable: 524288 kB
Cached: 307200 kB
Shmem: 20480 kB
SUnreclaim: 10240 kB
CmaFree: 8192 kB"
put proc/vmstat "nr_free_pages 25600
oom_kill 0"
# as on the mixer: dspserver calls its main thread dspMainLoop, node is started as "node server.js"
put proc/123/comm dspMainLoop
put proc/123/status "VmRSS:	30720 kB
RssAnon:	10240 kB
RssFile:	4096 kB
RssShmem:	16384 kB"
printf '/usr/local/bin/dspserver\0' > "$R/proc/123/cmdline"
put proc/124/comm node; put proc/124/status "VmRSS:	81920 kB
RssAnon:	71680 kB
RssFile:	10240 kB
RssShmem:	0 kB"
printf '/usr/bin/node\0server.js\0' > "$R/proc/124/cmdline"

# the start: PH0/PH1 outputs, PH2 input, PH0 and PH2 high; PB2 the backlight's PWM (function 2) with
# its data bit high, PB3 an output, high
poke H 0 0x011; poke H 4 0x5
poke B 0 0x1200; poke B 4 0xC
# the clocks: audio PLL on and locked; I2S0 clocked and out of reset with sample counters, I2S1 only
# clocked (still in reset: must not be read), I2S2 off
poke @ $((0x01C20008)) 0x90047F18
poke @ $((0x01C20068)) 0x3000; poke @ $((0x01C202D0)) 0x1000
poke @ $((0x01C22000)) 0x17; poke @ $((0x01C22028)) 0x1234; poke @ $((0x01C22400)) 0x99
export DLZ_PINLOG_MEM=$MEM DLZ_PINLOG_ROOT=$R DLZ_PINLOG_WINDOW=1e9   # one budget window for the whole test
run() { python3 "$SCRIPT" "$@"; }
has() { grep -q -- "$1" "$TMP/out"; }

# 1. --once: the codec line in its old format, then a snapshot of six lines
run --once > "$TMP/out" 2>&1; rc=$?
[ $rc -eq 0 ] && grep -Eq '^pinlog [0-9.]+ first PH0=1 PH1=0 PH2=1 PH12=0 \| f0=1 f1=1 f2=0 f12=0 \| p0=0 p1=0 p2=0 p12=0$' "$TMP/out" \
  && ok "--once: the codec line as before" || bad "--once: $(cat "$TMP/out")"
[ "$(grep -c 'snapshot first: ' "$TMP/out")" = 6 ] && has "pio .*B=1200,0,0,0,c," \
  && has "sys .*bl.backlight.brightness=541" && has "reg.dc5ldo@regulator.7.state=enabled" \
  && has "drm.card0-LVDS-1.dpms=On" \
  && has "irq 82:sunxi_pio_edge_22_Edge_gt911=99 92:sunxi-nmi_0_Level_axp22x_irq_chip=3" \
  && has "sensors temp.thermal_zone0.cpu_thermal=45000$" \
  && ok "--once: snapshot of pins, screen, rails, interrupts, sensors" || bad "snapshot: $(cat "$TMP/out")"
has "reg.dc5ldo@regulator.8.state=enabled" && has "reg.vcc_3v3@regulator.9.state=enabled" \
  && ok "--once: rails keyed by name and number, a space in a name" || bad "names: $(grep 'snapshot first: sys' "$TMP/out")"
grep -q "adc\.\|in_temp_raw\|thermal_zone1" "$TMP/out" && bad "the PMIC's ADC was read" || ok "--once: no PMIC ADC (I2C) reading"
has "clk pll_cpu=0 pll_audio=90047f18 .*bus_gate2=3000 bus_rst3=1000 .*audio_pll_locked=1$" \
  && has "i2s i2s0 ctl=17 .*txcnt=1234 rxcnt=0 tx+0 rx+0 in 10ms, i2s1=off, i2s2=off$" \
  && ok "--once: clocks, and only the I2S that is clocked and out of reset" || bad "clk/i2s: $(grep -E 'clk|i2s' "$TMP/out")"
# the I2S page refused (here: a file that ends before it): the pins are still logged
head -c $((0x01C20000 + 4096)) "$MEM" > "$TMP/short"
DLZ_PINLOG_MEM=$TMP/short run --once > "$TMP/out" 2>&1 && has "first PH0=1" && has "snapshot first: i2s unmapped" \
  && ok "--once: no I2S page, the rest still logged" || bad "unmapped: $(cat "$TMP/out")"

# 2. the unit: run in the background, change things, stop it as systemd does. It starts as at
# sysinit, before dspserver: PH2 not set up yet (function 7, data low)
poke H 0 0x711; poke H 4 0x1
DLZ_PINLOG_LOAD=2 python3 "$SCRIPT" > "$TMP/out" 2>&1 &  # python itself, so the TERM reaches it
pid=$!
( for i in $(seq 2 40); do sleep 0.25; cpustat "$i"; done ) &  # core 0 keeps working, half the time
busy=$!
sleep 0.5
poke H 4 0x5            # dspserver sets PH2 up: input with pull-up, so its data goes high...
sleep 0.05
poke H 0 0x011          # ...which is no "PH2 high again" edge
sleep 0.1
put $B/drm/card1-HDMI-A-1/status connected   # a display driver that comes up later
poke H 5 0x1            # PH0's drive changes: not in the codec line, so a pins line
sleep 0.2
poke B 4 0x8            # PB2's data bit falls while it is the PWM: not a change
sleep 0.2
poke B 4 0x0            # PB3, an output, goes low
sleep 0.2
poke B 1 0x00100000     # PB13 becomes an output
sleep 0.2
poke I 1 0x00000600     # PI10 an interrupt input (function 6), as the touch IRQ...
sleep 0.1
poke I 4 0x00000400     # ...whose data bit is its level: a change
sleep 0.2
poke B 4 0x4            # PB2's data bit rises while it is the PWM: not a change...
sleep 0.1
poke B 0 0x1100         # ...and PB2 becomes an output, high: a function change, no made-up edge
sleep 0.2
poke H 4 0x7            # PH1 high: the codec setup is done
sleep 0.2
poke H 4 0x3 0x7        # PH2 low for 10 ms (one python, so its start does not stretch it)
sleep 0.2
put $B/regulator/regulator.7/state disabled
put $B/backlight/backlight/bl_power 4
irqs 4
sleep 0.8
poke B 4 $(for i in $(seq 1 15); do echo 0x8 0x0; done)   # PB3 toggles 30 times
sleep 4                 # past the first rescan (5 s)
kill -TERM $pid; wait $pid 2> /dev/null; pid=; kill $busy 2> /dev/null; wait $busy 2> /dev/null

sed "/pins PB2 f2>1/q" "$TMP/out" | grep -q "pins PB2 d" && bad "PB2's PWM data bit was logged" || ok "a hardware-function pin's data bit is ignored"
has "pins PB2 f2>1$" && ok "PWM to output: the function change, no made-up data edge" || bad "PB2: $(grep 'pins PB2' "$TMP/out")"
has "pins PB3 d1>0$" && ok "PB3 output going low" || bad "PB3: $(grep pins "$TMP/out" | head -3)"
has "pins PB13 f0>1$" && ok "PB13 becoming an output" || bad "PB13: $(grep pins "$TMP/out" | head -3)"
has "pins PI10 f0>6$" && has "pins PI10 d0>1$" && ok "an interrupt input's level counts" \
  || bad "PI10: $(grep 'pins PI' "$TMP/out")"
[ "$(grep -c "pins PH" "$TMP/out")" = 1 ] && has "pins PH0 r0>1$" \
  && ok "codec pins: only their drive as a pins line" || bad "codec pins: $(grep 'pins PH' "$TMP/out")"
[ "$(grep -c 'snapshot PH2 high again: pio' "$TMP/out")" = 1 ] \
  && ok "PH2 being set up is no edge" || bad "set-up edge: $(grep 'snapshot PH2' "$TMP/out" | cut -c1-60)"
has "change PH0=1 PH1=1 PH2=1 PH12=0" && has "snapshot PH1 high (codec setup done): pio" \
  && ok "PH1 high: codec line and snapshot" || bad "PH1: $(grep -E 'change|snapshot PH1' "$TMP/out")"
has "change PH0=1 PH1=1 PH2=0 PH12=0" && has "snapshot PH2 low: sys" && has "snapshot PH2 high again: irq" \
  && ok "a 10 ms PH2 low: caught, snapshots at both edges" || bad "PH2: $(grep -E 'PH2' "$TMP/out" | head)"
lo=$(grep "change PH0=1 PH1=1 PH2=0" "$TMP/out" | head -1 | cut -d' ' -f2)
hi=$(grep "change PH0=1 PH1=1 PH2=1" "$TMP/out" | sed -n 2p | cut -d' ' -f2)
awk -v a="$lo" -v b="$hi" 'BEGIN { exit !(b - a > 0.005 && b - a < 0.1) }' \
  && ok "the PH2 low's width kept while its snapshot runs ($lo to $hi)" || bad "PH2 width: $lo to $hi"
has "reg.dc5ldo@regulator.7.state enabled>disabled" && ok "a rail switched off" || bad "rail: $(grep ' sys ' "$TMP/out")"
has "bl.backlight.bl_power 0>4" && ok "the backlight switched off" || bad "backlight: $(grep ' sys ' "$TMP/out")"
has "drm.card1-HDMI-A-1.status ->connected" && ok "a display driver that came later, found by the rescan" \
  || bad "rescan: $(grep ' sys ' "$TMP/out")"
has "irq.92:sunxi-nmi_0_Level_axp22x_irq_chip 3>4" && ok "a PMIC interrupt" || bad "irq: $(grep ' sys ' "$TMP/out")"
grep -qF "irq.82" "$TMP/out" && bad "the touch interrupt logged on change" || ok "busy interrupt lines only in snapshots"
n=$(grep -c "PB3 d" "$TMP/out")
[ "$n" -eq 10 ] && grep -Eq "skipped [0-9]+ PB3 lines in the minute" "$TMP/out" && has "pins PB13 f0>1$" \
  && ok "a pin's own budget: 10 lines for PB3, the rest counted" || bad "budget: $n PB3 lines, $(grep skipped "$TMP/out")"
has "alive at the end: .*snapshot thread stopped, poller stopped$" && has "snapshot at the end: sensors" && grep -Eq "last \([0-9]+ changes\) PH0=1 PH1=1 PH2=1" "$TMP/out" \
  && ok "the end lines at SIGTERM" || bad "end: $(tail -5 "$TMP/out")"
grep -Eq "load cpu0 50% max 50%, cpu1 0% max 0%, cpu2 0% max 0%, MemAvailable 512 MB, RSS MB dspserver=30 node:server.js=80$" "$TMP/out" \
  && ! grep -q "cpu3" "$TMP/out" && ok "the mixer's load: cores 0-2, memory, Mackie's processes (#8)" \
  || bad "load: $(grep ' load ' "$TMP/out" | head -3)"
has "mem MB MemFree 100, Cached 300, Shmem 20, SUnreclaim 10, CmaFree 8, oom_kill 0, anon/file/shmem MB dspserver=10/4/16 node:server.js=70/10/0$" \
  && ok "the memory line: by kind, OOM kills, per process anon/file/shmem (#8)" || bad "mem: $(grep ' mem ' "$TMP/out" | head -2)"
grep -v "^pinlog " "$TMP/out" && bad "lines other than pinlog's (above)" || ok "nothing else written"
grep "failed" "$TMP/out" && bad "a snapshot or rescan failed (above)" || ok "no job failed"

[ $fail -eq 0 ] && echo "ALL OK" || { echo "--- output"; cat "$TMP/out"; }
exit $fail
