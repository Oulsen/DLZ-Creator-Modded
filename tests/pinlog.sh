#!/bin/bash
# The dev card's pin log (dev/pinlog.py, #261, #287, #293) against a stand-in: a sparse file in place of
# /dev/mem and a small /sys and /proc tree. No mixer, no root, no dump.
#   bash tests/pinlog.sh
set -u
cd "$(dirname "$0")/.." || exit 2
SCRIPT=$PWD/dev/pinlog.py
TMP=$(mktemp -d)
pid=
trap 'kill $pid 2> /dev/null; rm -rf "$TMP"' EXIT
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
put $B/thermal/thermal_zone0/temp 45000
irqs 3

# the start: PH0/PH1 outputs, PH2 input, PH0 and PH2 high; PB2 the backlight's PWM (function 2) with
# its data bit high, PB3 an output, high
poke H 0 0x011; poke H 4 0x5
poke B 0 0x1200; poke B 4 0xC
# the clocks: audio PLL on and locked; I2S0 clocked and out of reset with sample counters, I2S1 only
# clocked (still in reset: must not be read), I2S2 off
poke @ $((0x01C20008)) 0x90047F18
poke @ $((0x01C20068)) 0x3000; poke @ $((0x01C202D0)) 0x1000
poke @ $((0x01C22000)) 0x17; poke @ $((0x01C22028)) 0x1234; poke @ $((0x01C22400)) 0x99
export DLZ_PINLOG_MEM=$MEM DLZ_PINLOG_ROOT=$R DLZ_PINLOG_WINDOW=3600
run() { python3 "$SCRIPT" "$@"; }
has() { grep -q -- "$1" "$TMP/out"; }

# 1. --once: the codec line in its old format, then a snapshot of six lines
run --once > "$TMP/out" 2>&1; rc=$?
[ $rc -eq 0 ] && grep -Eq '^pinlog [0-9.]+ first PH0=1 PH1=0 PH2=1 PH12=0 \| f0=1 f1=1 f2=0 f12=0 \| p0=0 p1=0 p2=0 p12=0$' "$TMP/out" \
  && ok "--once: the codec line as before" || bad "--once: $(cat "$TMP/out")"
[ "$(grep -c 'snapshot first: ' "$TMP/out")" = 6 ] && has "pio .*B=1200,0,0,0,c," \
  && has "sys .*bl.brightness=541" && has "reg.dc5ldo.state=enabled" && has "drm.LVDS-1.dpms=On" \
  && has "irq 82:sunxi_pio_edge_22_Edge_gt911=99 92:sunxi-nmi_0_Level_axp22x_irq_chip=3" \
  && has "sensors temp.thermal_zone0=45000" \
  && ok "--once: snapshot of pins, screen, rails, interrupts, sensors" || bad "snapshot: $(cat "$TMP/out")"
has "clk pll_cpu=0 pll_audio=90047f18 .*bus_gate2=3000 bus_rst3=1000 .*audio_pll_locked=1$" \
  && has "i2s i2s0 ctl=17 .*txcnt=1234 rxcnt=0 tx+0 rx+0 in 10ms, i2s1=off, i2s2=off$" \
  && ok "--once: clocks, and only the I2S that is clocked and out of reset" || bad "clk/i2s: $(grep -E 'clk|i2s' "$TMP/out")"

# 2. the unit: run in the background, change things, stop it as systemd does
python3 "$SCRIPT" > "$TMP/out" 2>&1 &  # python itself, so the TERM reaches it
pid=$!
sleep 0.5
poke B 4 0x8            # PB2's data bit falls while it is the PWM: not a change
sleep 0.2
poke B 4 0x0            # PB3, an output, goes low
sleep 0.2
poke B 1 0x00100000     # PB13 becomes an output
sleep 0.2
poke H 4 0x7            # PH1 high: the codec setup is done
sleep 0.2
poke H 4 0x3            # PH2 low for ~20 ms
sleep 0.02
poke H 4 0x7
sleep 0.2
put $B/regulator/regulator.7/state disabled
put $B/backlight/backlight/bl_power 4
irqs 4
sleep 0.8
poke B 4 $(for i in $(seq 1 15); do echo 0x8 0x0; done)   # PB3 toggles 30 times
sleep 0.3
kill -TERM $pid; wait $pid 2> /dev/null; pid=

grep -q "pins PB2" "$TMP/out" && bad "PB2's PWM data bit was logged" || ok "a hardware-function pin's data bit is ignored"
has "pins PB3 d1>0$" && ok "PB3 output going low" || bad "PB3: $(grep pins "$TMP/out" | head -3)"
has "pins PB13 f0>1$" && ok "PB13 becoming an output" || bad "PB13: $(grep pins "$TMP/out" | head -3)"
grep -q "pins PH" "$TMP/out" && bad "a codec pin also came as a pins line" || ok "codec pins only in the codec line"
has "change PH0=1 PH1=1 PH2=1 PH12=0" && has "snapshot PH1 high (codec setup done): pio" \
  && ok "PH1 high: codec line and snapshot" || bad "PH1: $(grep -E 'change|snapshot PH1' "$TMP/out")"
has "change PH0=1 PH1=1 PH2=0 PH12=0" && has "snapshot PH2 low: sys" && has "snapshot PH2 high again: irq" \
  && ok "a 20 ms PH2 low: caught, snapshots at both edges" || bad "PH2: $(grep -E 'PH2' "$TMP/out" | head)"
has "reg.dc5ldo.state enabled>disabled" && ok "a rail switched off" || bad "rail: $(grep ' sys ' "$TMP/out")"
has "bl.bl_power 0>4" && ok "the backlight switched off" || bad "backlight: $(grep ' sys ' "$TMP/out")"
has "irq.92:sunxi-nmi_0_Level_axp22x_irq_chip 3>4" && ok "a PMIC interrupt" || bad "irq: $(grep ' sys ' "$TMP/out")"
grep -qF "irq.82" "$TMP/out" && bad "the touch interrupt logged on change" || ok "busy interrupt lines only in snapshots"
n=$(grep -c "pins PB" "$TMP/out")
[ "$n" -eq 20 ] && grep -Eq "skipped [0-9]+ PB lines in the minute" "$TMP/out" \
  && ok "PB's budget: 20 lines, the rest counted" || bad "budget: $n PB lines, $(grep skipped "$TMP/out")"
has "alive at the end: " && has "snapshot at the end: sensors" && grep -Eq "last \([0-9]+ changes\) PH0=1 PH1=1 PH2=1" "$TMP/out" \
  && ok "the end lines at SIGTERM" || bad "end: $(tail -5 "$TMP/out")"
grep -v "^pinlog " "$TMP/out" && bad "lines other than pinlog's (above)" || ok "nothing else written"

[ $fail -eq 0 ] && echo "ALL OK" || { echo "--- output"; cat "$TMP/out"; }
exit $fail
