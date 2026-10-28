#!/bin/bash
# The touch fix for glesgui (install/sd-system/dlzmod-glesgui, #188) on a folder as rootfs, in seconds.
# Without the dump (also on GitHub): no glesgui, a link, a file of another size, one of the right size
# with other bytes: all left alone, exit 0, nothing written. With the dump mounted read-only at
# /mnt/dlz (WSL; a copy of its glesgui, the dump itself is only read):
# - stock: patched (the patched hash, mode and owner kept, no temp file left), and only the one
#   instruction differs from stock
# - a second run: silent, unchanged
# - a leftover temp file from a power cut: replaced, the result patched
# - a stock-size file with the stock bytes at the spot but another hash: left alone
# - no room for the copy (as root: a small tmpfs): left alone, the stock file kept
# Usage: bash tests/glesgui.sh (from anywhere)
set -uo pipefail

REPO=$(cd "$(dirname "$0")/.." && pwd)
FIX=$REPO/install/sd-system/dlzmod-glesgui
DUMP=${DLZ_DUMP:-/mnt/dlz}/usr/local/bin/glesgui
T=$(mktemp -d)
trap 'mountpoint -q "$T/small" 2>/dev/null && umount "$T/small"; rm -rf "$T"' EXIT
F=0
ok() { echo "  ok: $*"; }; bad() { echo "  FAIL: $*"; F=$((F + 1)); }
# is <name> <expected> <actual>
is() { [ "$2" = "$3" ] && ok "$1" || bad "$1 (expected '$2', got '$3')"; }
SIZE=$(sed -n 's/^SIZE = //p' "$FIX")
STOCK=$(sed -n 's/^STOCK = "\(.*\)"/\1/p' "$FIX")
PATCHED=$(sed -n 's/^PATCHED = "\(.*\)"/\1/p' "$FIX")
OFF=$(( $(sed -n 's/^OFF = //p' "$FIX") ))
sum() { sha256sum "$1" | cut -d' ' -f1; }
run() { python3 "$FIX" "$1" > "$T/out" 2>&1; }
# left <name> <root>: exit 0, says it leaves it alone, the file as it was, no temp file
left() {
  local g=$2/usr/local/bin/glesgui before=""
  [ -f "$g" ] && before=$(sum "$g")
  run "$2" && ok "$1: exit 0" || bad "$1: exit $? ($(cat "$T/out"))"
  grep -qF "left alone" "$T/out" && ok "$1: says so" || bad "$1: says '$(cat "$T/out")'"
  [ -z "$before" ] || is "$1: unchanged" "$before" "$(sum "$g")"
  is "$1: no temp file" "" "$(ls "$2/usr/local/bin" 2>/dev/null | grep -F .dlzmod-new)"
}

echo "== without the dump"
r=$T/none; mkdir -p "$r/usr/local/bin"
left "no glesgui" "$r"
r=$T/link; mkdir -p "$r/usr/local/bin"; echo x > "$r/elsewhere"; ln -s ../../../elsewhere "$r/usr/local/bin/glesgui"
left "a link" "$r"
is "a link: its target unchanged" "x" "$(cat "$r/elsewhere")"
r=$T/small-file; mkdir -p "$r/usr/local/bin"; head -c 1000 /dev/zero > "$r/usr/local/bin/glesgui"
left "another size" "$r"
r=$T/zeros; mkdir -p "$r/usr/local/bin"; truncate -s "$SIZE" "$r/usr/local/bin/glesgui"
left "the stock size, other bytes" "$r"

if [ ! -f "$DUMP" ]; then
  echo "== with the dump: skipped (no $DUMP; WSL: install/mount-ro.sh)"
else
  echo "== with the dump"
  is "the dump's glesgui is the stock one" "$STOCK" "$(sum "$DUMP")"
  r=$T/stock; g=$r/usr/local/bin/glesgui; mkdir -p "$r/usr/local/bin"
  cp "$DUMP" "$g"; chmod 750 "$g"
  run "$r" && ok "stock: exit 0" || bad "stock: exit $? ($(cat "$T/out"))"
  grep -qF "#188" "$T/out" && ok "stock: says it patched" || bad "stock: says '$(cat "$T/out")'"
  is "stock: the patched hash" "$PATCHED" "$(sum "$g")"
  is "stock: mode kept" "750" "$(stat -c %a "$g")"
  is "stock: no temp file" "" "$(ls "$r/usr/local/bin" | grep -F .dlzmod-new)"
  is "stock: only the one instruction differs" "$((OFF + 1)) 377 17
$((OFF + 2)) 345 346" "$(cmp -l "$DUMP" "$g" | awk '{print $1, $2, $3}')"
  run "$r" && ok "again: exit 0" || bad "again: exit $?"
  is "again: silent" "" "$(cat "$T/out")"
  is "again: unchanged" "$PATCHED" "$(sum "$g")"

  r=$T/cut; g=$r/usr/local/bin/glesgui; mkdir -p "$r/usr/local/bin"
  cp "$DUMP" "$g"; head -c 5000 /dev/urandom > "$g.dlzmod-new"
  run "$r" && ok "after a power cut: exit 0" || bad "after a power cut: exit $?"
  is "after a power cut: patched" "$PATCHED" "$(sum "$g")"
  is "after a power cut: no temp file" "" "$(ls "$r/usr/local/bin" | grep -F .dlzmod-new)"

  r=$T/other; g=$r/usr/local/bin/glesgui; mkdir -p "$r/usr/local/bin"
  cp "$DUMP" "$g"; printf 'X' | dd of="$g" bs=1 seek=100 conv=notrunc 2> /dev/null
  left "the stock bytes, another hash" "$r"

  if [ "$(id -u)" != 0 ]; then echo "  (not root: the no-room case is skipped)"
  else
    r=$T/small; mkdir -p "$r"; mount -t tmpfs -o size=$(( SIZE / 1048576 + 8 ))m tmpfs "$r"
    g=$r/usr/local/bin/glesgui; mkdir -p "$r/usr/local/bin"; cp "$DUMP" "$g"
    left "no room" "$r"
    is "no room: still stock" "$STOCK" "$(sum "$g")"
  fi
fi

[ "$F" = 0 ] && echo "ALL OK" || { echo "$F FAILED"; exit 1; }
