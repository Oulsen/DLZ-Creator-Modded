#!/bin/bash
# The report of each start (install/sd-system/dlzmod-bootreport) with stand-ins for systemd-analyze,
# systemctl, journalctl and sleep: no mixer, no dump, no root; GitHub runs it too.
#   bash tests/bootreport.sh
set -u
cd "$(dirname "$0")/.." || exit 2
SCRIPT=$PWD/install/sd-system/dlzmod-bootreport
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
fail=0
ok() { echo "ok    $*"; }
bad() { echo "FAIL  $*"; fail=1; }

# stand-ins: FINISHED_AFTER = how many systemd-analyze calls answer "not finished" first;
# WARN_LINES = how many warnings journalctl has
mkdir -p "$TMP/bin"
cat > "$TMP/bin/systemd-analyze" << 'EOF'
#!/bin/sh
n=$(cat "$STATE/calls" 2>/dev/null || echo 0); echo $((n + 1)) > "$STATE/calls"
if [ "$n" -lt "$FINISHED_AFTER" ]; then echo "Bootup is not yet finished" >&2; exit 1; fi
case $1 in
  time) echo "Startup finished in 3.1s (kernel) + 40.2s (userspace) = 43.3s" ;;
  critical-chain) echo "multi-user.target @40.1s" ;;
  blame) i=0; while [ $i -lt 40 ]; do echo "${i}s unit$i.service"; i=$((i + 1)); done ;;
esac
EOF
cat > "$TMP/bin/systemctl" << 'EOF'
#!/bin/sh
case $1 in
  list-jobs) echo "12 glesgui.service start running" ;;
  show) printf '%s\n' NRestarts=0 ActiveState=active SubState=running Result=success ExecMainStatus=0 \
          InactiveExitTimestampMonotonic=24899087 ActiveEnterTimestampMonotonic=24900000 ;;
  --failed) echo "dlzmod-x.service loaded failed failed" ;;
esac
EOF
cat > "$TMP/bin/journalctl" << 'EOF'
#!/bin/sh
# dspserver's own lines (-u): a good chip start, or the DAC not answering: CHIP_FAIL=1 99 equal retry
# lines, 2 retries numbered and alternating between two addresses, 3 40 different lines before it
case " $* " in *" -u "*)
  echo "[   27.04] host dspserver[726]: DLZ Lite detected"
  echo "[   27.05] host dspserver[726]: new CPU PLL: 90001510"
  if [ "${CHIP_FAIL:-0}" != 0 ]; then
    case $CHIP_FAIL in
      1) i=0; while [ $i -lt 99 ]; do echo "[   27.10] host dspserver[726]: i2c: retrying address 22"; i=$((i + 1)); done ;;
      2) i=0; while [ $i -lt 99 ]; do echo "[   27.10] host dspserver[726]: i2c: retrying attempt $i (addr=$((22 + i % 2 * 4)))"; i=$((i + 1)); done ;;
      3) awk 'BEGIN { for (i = 0; i < 40; i++) printf "[   27.10] host dspserver[726]: Initialising part %c%c\n", 97 + int(i / 26), 97 + i % 26 }' ;;
    esac
    echo "[   27.15] host dspserver[726]: Couldn't initialise AKM DAC (possibly dead): failed to send I2C data"
  else
    echo "[   27.15] host dspserver[726]: Initialising AKM DAC..."
  fi
  echo "[   27.49] host dspserver[726]: Audio initialisation is done."
  echo "[   30.24] host dspserver[726]: Waiting for graphics to initialise..."
  echo "[   30.44] host dspserver[726]: Done."
  exit 0 ;;
esac
i=0; while [ $i -lt "$WARN_LINES" ]; do echo "[ $i.0] host prog[1]: warning $i"; i=$((i + 1)); done
# a kernel line that starts with 4 hex digits but is no register dump: it stays
[ "${STACK_DUMP:-0}" = 1 ] && echo "[   12.000000] host kernel: beef: a message that only looks like a dump line"
# one kernel stack dump as the mixer logs it at every start: the CPU line stays, 6 lines go
if [ "${STACK_DUMP:-0}" = 1 ]; then
  echo "[   27.078292] host kernel: CPU: 1 PID: 848 Comm: dspserver Tainted: G     U            5.10.197-sunxi #trunk"
  echo "[   27.078299] host kernel: Hardware name: Allwinner sun8i Family"
  echo "[   27.078331] host kernel: [<c010c84d>] (unwind_backtrace) from [<c0109279>] (show_stack+0x11/0x14)"
  echo "[   27.078349] host kernel: [<c0109279>] (show_stack) from [<c09c6ccd>] (dump_stack+0x71/0x7e)"
  echo "[   27.078350] host kernel: Exception stack(0xc15bdfb0 to 0xc15bdff8)"
  echo "[   27.078351] host kernel: dfa0:                                     00000000 00000000 00000000 00000000"
  echo "[   27.078352] host kernel: dfe0: 00000000 00000000 00000000 00000000 00000013 00000000"
fi
EOF
cat > "$TMP/bin/sleep" << 'EOF'
#!/bin/sh
echo "$1" >> "$STATE/slept"
EOF
chmod +x "$TMP/bin/"*

# run <name> <finished after n calls> <warning lines>: the report in $TMP/<name>.out
run() {
  mkdir -p "$TMP/$1"
  STATE=$TMP/$1 FINISHED_AFTER=$2 WARN_LINES=$3 PATH="$TMP/bin:$PATH" \
    sh "$SCRIPT" > "$TMP/$1.out" 2>&1
}
slept() { awk '{ s += $1 } END { print s + 0 }' "$TMP/$1/slept"; }

# 1. a normal start: everything once, the services in seconds, the warnings counted and capped
run normal 0 250 || bad "normal: exit $?"
o=$TMP/normal.out
grep -q "Startup finished in" "$o" && ok "normal: start times" || bad "normal: no start times"
grep -q "multi-user.target @40.1s" "$o" && ok "normal: critical chain" || bad "normal: no critical chain"
[ "$(grep -c 'unit[0-9]*.service' "$o")" = 15 ] && ok "normal: blame capped at 15" || bad "normal: blame not 15 lines"
grep -qE '^dspserver +start +24\.9  up +24\.9  restarts 0  active/running  result success  exit 0$' "$o" \
  && ok "normal: a service's line" || bad "normal: dspserver line: $(grep '^dspserver' "$o")"
[ "$(grep -cE '^(flash-gd32|flash-fpga|faderlink|dspserver|evolve-node|evolve-app|weston-mackie|glesgui|dlzmod-[a-z-]+|NetworkManager|ssh) +start' "$o")" = 14 ] \
  && ok "normal: 14 services" || bad "normal: not 14 service lines"
grep -q "dlzmod-x.service loaded failed" "$o" && ok "normal: failed units" || bad "normal: no failed units"
grep -q "warnings and errors of this start: 250 (first 100; 0 lines of kernel stack dumps left out)" "$o" \
  && ok "normal: warnings counted" || bad "normal: warning count"
[ "$(grep -c ': warning [0-9]*$' "$o")" = 100 ] && ok "normal: warnings capped at 100" || bad "normal: warnings not capped"
grep -q "end of report" "$o" && ok "normal: complete" || bad "normal: no end line"
[ "$(slept normal)" = 90 ] && ok "normal: waited 90 s, no polling" || bad "normal: slept $(slept normal) s"
c=$(sed -n '/--- audio chips/,/--- warnings/p' "$o")
echo "$c" | grep -q "Lite detected" && echo "$c" | grep -q "Initialising AKM DAC" && echo "$c" | grep -q "Audio initialisation is done" \
  && ok "normal: the audio chips' start" || bad "normal: chip section: $c"
echo "$c" | grep -qE "for graphics|PLL|Done\." && bad "normal: other dspserver lines in the chip section" || ok "normal: only chip lines"

# 2. a start that finishes late: polled every 15 s, then the report
run late 3 0
o=$TMP/late.out
[ "$(slept late)" = 135 ] && ok "late: polled until done (90 + 3 x 15 s)" || bad "late: slept $(slept late) s"
grep -q "not finished" "$o" && bad "late: says not finished" || ok "late: no 'not finished'"
grep -q "warnings and errors of this start: 0 (first 100; 0 lines" "$o" && ok "late: zero warnings" || bad "late: warning count"
[ "$(sed -n '/warnings and errors/,/end of report/p' "$o" | wc -l)" = 2 ] && ok "late: no empty warning line" || bad "late: lines between the warning header and the end"

# 3. the kernel stack dump at every start: its body left out and counted, its CPU line kept
mkdir -p "$TMP/dump"
STATE=$TMP/dump FINISHED_AFTER=0 WARN_LINES=2 STACK_DUMP=1 PATH="$TMP/bin:$PATH" sh "$SCRIPT" > "$TMP/dump.out" 2>&1
o=$TMP/dump.out
grep -q "warnings and errors of this start: 4 (first 100; 6 lines of kernel stack dumps left out)" "$o" \
  && ok "dump: 6 lines left out, 4 counted" || bad "dump: $(grep 'warnings and errors' "$o")"
grep -q "Comm: dspserver Tainted" "$o" && ok "dump: its CPU line kept" || bad "dump: CPU line gone"
grep -qE "unwind_backtrace|Hardware name|Exception stack|dfa0:" "$o" && bad "dump: stack lines still there" || ok "dump: stack lines gone"
grep -q ": warning 1$" "$o" && ok "dump: other warnings kept" || bad "dump: other warnings gone"
grep -q "kernel: beef: a message" "$o" && ok "dump: a hex-looking message kept" || bad "dump: hex-looking message dropped"

# 4. a chip that does not answer: shown in the report (dspserver logs it at priority info, so it is
# not among the warnings), the retries collapsed, the failure shown whatever comes before it
# chip <mode>: the audio chip section of a run with CHIP_FAIL=<mode>
chip() {
  mkdir -p "$TMP/chip$1"
  STATE=$TMP/chip$1 FINISHED_AFTER=0 WARN_LINES=0 CHIP_FAIL=$1 PATH="$TMP/bin:$PATH" sh "$SCRIPT" > "$TMP/chip$1.out" 2>&1
  sed -n '/--- audio chips/,/--- warnings/p' "$TMP/chip$1.out"
}
c=$(chip 1)
echo "$c" | grep -q "Couldn't initialise AKM DAC (possibly dead)" && ok "chip: the failure shown" || bad "chip: failure not shown"
[ "$(echo "$c" | grep -c 'retrying address')" = 1 ] && echo "$c" | grep -q "the line above, 98 more like it" \
  && ok "chip: 99 equal retries as one line and a count" || bad "chip: retries: $(echo "$c" | grep -E 'retrying|more like')"
c=$(chip 2)
[ "$(echo "$c" | grep -c 'retrying attempt')" = 1 ] && echo "$c" | grep -q "the line above, 98 more like it" \
  && echo "$c" | grep -q "possibly dead" \
  && ok "chip: numbered retries on two addresses as one line, the failure shown" || bad "chip 2: $c"
c=$(chip 3)
echo "$c" | grep -q "possibly dead" && echo "$c" | grep -q "Initialising part aa" && ! echo "$c" | grep -q "part bn" \
  && echo "$c" | grep -q "more lines in the log" \
  && ok "chip: 40 different lines capped at 30, the failure still shown" || bad "chip 3: $(echo "$c" | tail -4)"
echo "$c" | grep -q "Audio initialisation is done" && bad "chip 3: a line past the cap shown" || ok "chip: other lines past the cap left out"

# 5. a start that never finishes: gives up after 5 min, names the waiting jobs, still reports
run hung 1000 5
o=$TMP/hung.out
[ "$(slept hung)" = 300 ] && ok "hung: gave up after 300 s" || bad "hung: slept $(slept hung) s"
grep -q "start not finished 300 s after this report began waiting" "$o" && grep -q "glesgui.service start running" "$o" \
  && ok "hung: names the waiting jobs" || bad "hung: no jobs list"
grep -q "end of report" "$o" && ok "hung: still reports" || bad "hung: no report"

[ $fail = 0 ] && echo "ALL OK" || { echo "FAILED"; exit 1; }
