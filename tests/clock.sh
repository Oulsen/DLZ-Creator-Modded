#!/bin/bash
# The clock saver (install/sd-system/dlzmod-clock, #1) without a card, in seconds: no root, no dump
# (also on GitHub). Never sets the clock: only the save (to a file of its own) and the choice of the
# time the start would set are run.
# - save: fake-hwclock's format (its load reads it back), no temp file left, the old file kept when
#   the new one cannot be written
# - newest: a file written after the last save moves the clock just past it; older files, files
#   too far ahead (a computer in another time zone) or none leave it
# Needs: Linux or WSL, bash, the sh the mixer has (dash), GNU find, touch and date.
# Usage: bash tests/clock.sh (from anywhere)
set -uo pipefail

REPO=$(cd "$(dirname "$0")/.." && pwd)
CLOCK=$REPO/install/sd-system/dlzmod-clock
T=$(mktemp -d)
trap 'chmod -R u+w "$T"; rm -rf "$T"' EXIT
F=0
ok() { echo "  ok: $*"; }; bad() { echo "  FAIL: $*"; F=$((F + 1)); }
# is <name> <expected> <actual>
is() { [ "$2" = "$3" ] && ok "$1" || bad "$1 (expected '$2', got '$3')"; }

echo "== save"
f=$T/etc/fake-hwclock.data
mkdir -p "$T/etc"
before=$(date -u +%s)
DLZMOD_CLOCK_FILE=$f sh "$CLOCK" save && ok "saved" || bad "save failed"
saved=$(cat "$f" 2>/dev/null)
grep -qxE '[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}' <<< "$saved" \
  && ok "fake-hwclock's format ($saved)" || bad "format: '$saved'"
# fake-hwclock's load: date -u -d "$(cat $FILE)"
back=$(date -u -d "$saved" +%s 2>/dev/null)
[ -n "$back" ] && [ "$back" -ge "$before" ] && [ "$back" -le "$(date -u +%s)" ] \
  && ok "read back as now" || bad "read back as '$back'"
is "no temp file left" "" "$(ls "$T/etc" | grep -v '^fake-hwclock.data$')"
echo "2030-01-01 00:00:00" > "$f"
chmod a-w "$T/etc"
if [ "$(id -u)" = 0 ]; then echo "  (root: the read-only folder case is skipped)"
else
  DLZMOD_CLOCK_FILE=$f sh "$CLOCK" save > "$T/out" 2>&1 && bad "save into a read-only folder passed" \
    || ok "save into a read-only folder fails"
  grep -qF "cannot save the time" "$T/out" && ok "and says so" || bad "no message: $(cat "$T/out")"
  is "the old file kept" "2030-01-01 00:00:00" "$(cat "$f")"
fi
chmod u+w "$T/etc"

echo "== newest"
d=$T/data
mkdir -p "$d/Recordings" "$d/Recorded_Samples"
now=1800000000
at() { touch -d "@$1" "$2"; }   # at <seconds> <file>
is "an empty card: nothing" "" "$(sh "$CLOCK" newest "$d" $now)"
at $((now - 3600)) "$d/Recordings/REC_0001_otter.wav"
is "only older files: nothing" "" "$(sh "$CLOCK" newest "$d" $now)"
at $now "$d/Recordings/REC_0002_heron.wav"
is "a file at the clock's own second: nothing" "" "$(sh "$CLOCK" newest "$d" $now)"
at $((now + 40)) "$d/Recordings/REC_0003_lynx.wav"
is "a recording 40 s ahead: just past it" $((now + 41)) "$(sh "$CLOCK" newest "$d" $now)"
at $((now + 90)) "$d/Recorded_Samples/RS_0004.wav"
is "a sample further ahead counts too" $((now + 91)) "$(sh "$CLOCK" newest "$d" $now)"
at $((now + 600)) "$d/preset.json"
is "10 min ahead still counts" $((now + 601)) "$(sh "$CLOCK" newest "$d" $now)"
at $((now + 7200)) "$d/from-a-computer.wav"
is "2 h ahead (another time zone) is left out" $((now + 601)) "$(sh "$CLOCK" newest "$d" $now)"
at $((now + 601)) "$d/preset.json"
is "just over 10 min ahead is left out" $((now + 91)) "$(sh "$CLOCK" newest "$d" $now)"
mkdir "$d/folder-ahead" && at $((now + 300)) "$d/folder-ahead"
is "folders do not count" $((now + 91)) "$(sh "$CLOCK" newest "$d" $now)"
is "no such folder: nothing" "" "$(sh "$CLOCK" newest "$T/none" $now)"

echo "== usage"
sh "$CLOCK" > /dev/null 2>&1; is "no command: usage, exit 2" 2 $?

echo
[ $F = 0 ] && echo "ALL CLOCK CHECKS PASSED" || { echo "$F CLOCK CHECK(S) FAILED"; exit 1; }
