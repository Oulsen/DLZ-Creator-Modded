#!/bin/bash
# dspserver's wait (install/sd-system/dlzmod-wait-hub, #239) without a card, in seconds: no root, no
# dump (also on GitHub). Stand-ins for ss, pidof and sleep; a pretend /proc.
# - both up at once (a dspserver restart with glesgui running too): starts at once, says nothing of a wait
# - server.js late, then glesgui running but without its GPU file yet: waits for both, in that order
# - no server.js, or no graphics at all: gives up after 50 s, exit 0, and says so
# - a start so busy that each turn takes longer than its sleep: still 50 s by the clock
# Needs: Linux or WSL, bash, the sh the mixer has (dash).
# Usage: bash tests/wait-hub.sh (from anywhere)
set -uo pipefail

REPO=$(cd "$(dirname "$0")/.." && pwd)
WAIT=$REPO/install/sd-system/dlzmod-wait-hub
T=$(mktemp -d)
trap 'rm -rf "$T"' EXIT
F=0
ok() { echo "  ok: $*"; }; bad() { echo "  FAIL: $*"; F=$((F + 1)); }
is() { [ "$2" = "$3" ] && ok "$1" || bad "$1 (expected '$2', got '$3')"; }

B=$T/bin; mkdir -p "$B"
# the ticks passed so far; each stand-in looks at them. Each tick moves the pretend /proc/uptime by
# $TURN hundredths of a second, from 100.00 on
cat > "$B/sleep" <<'S'
#!/bin/sh
n=$(($(cat "$T/ticks") + 1))
echo $n > "$T/ticks"
c=$((10000 + n * TURN))
printf '%d.%02d 50.00
' $((c / 100)) $((c % 100)) > "$T/proc/uptime"
S
# port 80 listens from tick $HUB_AT on (never when empty)
cat > "$B/ss" <<'S'
#!/bin/sh
[ -n "$HUB_AT" ] && [ "$(cat "$T/ticks")" -ge "$HUB_AT" ] && echo "LISTEN 0 511 *:80 *:*"
exit 0
S
# glesgui runs from tick $GLES_AT on, and has its GPU file from $DRI_AT on (made here, on purpose:
# run removes it again)
cat > "$B/pidof" <<'S'
#!/bin/sh
[ -n "$GLES_AT" ] && [ "$(cat "$T/ticks")" -ge "$GLES_AT" ] || exit 1
[ -n "$DRI_AT" ] && [ "$(cat "$T/ticks")" -ge "$DRI_AT" ] && ln -sf /dev/dri/renderD129 "$T/proc/713/fd/9"
echo 713
S
chmod +x "$B"/*
mkdir -p "$T/proc/713/fd"
ln -s /dev/null "$T/proc/713/fd/0"

# run <hub> <gles> <dri> [hundredths a turn]: sets $out, $rc and $ticks
run() {
  echo 0 > "$T/ticks"
  echo "100.00 50.00" > "$T/proc/uptime"
  rm -f "$T/proc/713/fd/9"
  out=$(PATH=$B:$PATH T=$T HUB_AT=$1 GLES_AT=$2 DRI_AT=$3 TURN=${4:-20} DLZMOD_WAIT_PROC=$T/proc sh "$WAIT" 2>&1)
  rc=$?
  ticks=$(cat "$T/ticks")
}

echo "== both up"
run 0 0 0
is "exit 0" 0 "$rc"; is "no wait" 0 "$ticks"
case $out in *listening*) bad "no server line without a wait: $out" ;; *) ok "no server line" ;; esac
echo "== server.js at 2 s, glesgui at 3 s, its GPU file at 8 s"
run 10 15 40
is "exit 0" 0 "$rc"; is "waits for the file" 40 "$ticks"
case $out in *"server.js listening after 2.0 s"*) ok "says when the server came" ;; *) bad "server line: $out" ;; esac
case $out in *"graphics up after 8.0 s"*) ok "says when the graphics came" ;; *) bad "graphics line: $out" ;; esac
echo "== glesgui's file before server.js"
run 30 0 0
is "waits for the server" 30 "$ticks"
echo "== no server.js"
run "" 0 0
is "exit 0" 0 "$rc"; is "gives up at 50 s" 250 "$ticks"
case $out in *"nothing on port 80 after 50.0 s"*) ok "says so" ;; *) bad "$out" ;; esac
echo "== no graphics"
run 0 "" ""
is "exit 0" 0 "$rc"; is "gives up at 50 s" 250 "$ticks"
case $out in *"no graphics after 50.0 s"*) ok "says so" ;; *) bad "$out" ;; esac
echo "== glesgui runs, never gets its file"
run 0 0 ""
is "gives up at 50 s" 250 "$ticks"
echo "== the limit is shared: server.js at 45 s, no graphics"
run 225 0 ""
is "still 50 s in all" 250 "$ticks"

echo "== a busy start: each turn 0.4 s, no graphics"
run 0 0 "" 40
is "exit 0" 0 "$rc"; is "50 s by the clock" 125 "$ticks"
case $out in *"no graphics after 50.0 s"*) ok "says so" ;; *) bad "$out" ;; esac

[ "$F" = 0 ] && echo "ALL OK" || { echo "$F FAILED"; exit 1; }
