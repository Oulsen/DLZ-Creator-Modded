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
i=0; while [ $i -lt "$WARN_LINES" ]; do echo "[ $i.0] host prog[1]: warning $i"; i=$((i + 1)); done
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
grep -q "warnings and errors of this start: 250 (first 100)" "$o" && ok "normal: warnings counted" || bad "normal: warning count"
[ "$(grep -c ': warning [0-9]*$' "$o")" = 100 ] && ok "normal: warnings capped at 100" || bad "normal: warnings not capped"
grep -q "end of report" "$o" && ok "normal: complete" || bad "normal: no end line"
[ "$(slept normal)" = 90 ] && ok "normal: waited 90 s, no polling" || bad "normal: slept $(slept normal) s"

# 2. a start that finishes late: polled every 15 s, then the report
run late 3 0
o=$TMP/late.out
[ "$(slept late)" = 135 ] && ok "late: polled until done (90 + 3 x 15 s)" || bad "late: slept $(slept late) s"
grep -q "not finished" "$o" && bad "late: says not finished" || ok "late: no 'not finished'"
grep -q "warnings and errors of this start: 0" "$o" && ok "late: zero warnings" || bad "late: warning count"

# 3. a start that never finishes: gives up after 5 min, names the waiting jobs, still reports
run hung 1000 5
o=$TMP/hung.out
[ "$(slept hung)" = 300 ] && ok "hung: gave up after 300 s" || bad "hung: slept $(slept hung) s"
grep -q "start not finished after 300 s" "$o" && grep -q "glesgui.service start running" "$o" \
  && ok "hung: names the waiting jobs" || bad "hung: no jobs list"
grep -q "end of report" "$o" && ok "hung: still reports" || bad "hung: no report"

[ $fail = 0 ] && echo "ALL OK" || { echo "FAILED"; exit 1; }
