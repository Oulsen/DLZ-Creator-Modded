#!/bin/bash
# The updater's copy of the card's start-up script (#221: BOOT_CMD, BOOT_SUM, BOOT_KNOWN in
# sd-system/dlzmod-update) against the one that ships (sd-system/boot.cmd; while there is none,
# BOOT_CMD and BOOT_SUM are empty). Used by mkpackage.sh and tests/update-checks.sh.
#   bootscr-check.sh <dlzmod-update> <boot.cmd>: prints what is wrong, exit 1; or "ok ...", exit 0
set -u
U=${1:?dlzmod-update}; CMD=${2:?boot.cmd}
no() { echo "$*"; exit 1; }
# the updater's own lines, run as they are: the text, its sum, the known list and the image maker
code=$(sed -n -e '/^BOOT_KNOWN="/,/"$/p' -e '/^BOOT_SUM="/p' -e "/^BOOT_CMD=\$(cat << 'BOOT_EOF'$/,/^)$/p" \
  -e '/^boot_image() {/,/^}$/p' "$U")
eval "$code"
[ -n "${BOOT_KNOWN:-}" ] && declare -F boot_image > /dev/null || no "BOOT_KNOWN, BOOT_CMD or boot_image not found"
[ "$(sed -n '1s/ .*//p' <<< "$BOOT_KNOWN")" = 19ddc05aab827c44cb055cdde67142c5e68594d5167cf341ce589161ab7867e8 ] \
  || no "BOOT_KNOWN does not start with the stock script's sum (the stock copy is kept by it)"
grep -qvE '^[0-9a-f]{64} [^ ]' <<< "$BOOT_KNOWN" && no "BOOT_KNOWN: a line that is not '<sha256> <what>'"
if [ ! -e "$CMD" ]; then
  [ -z "$BOOT_CMD" ] && [ -z "$BOOT_SUM" ] || no "BOOT_CMD or BOOT_SUM set, but there is no ${CMD##*/} to ship"
  echo "ok no start-up script to place yet"; exit 0
fi
[ -n "$BOOT_CMD" ] && [ "$BOOT_CMD" = "$(cat "$CMD")" ] || no "BOOT_CMD does not match ${CMD##*/}"
grep -q "^$BOOT_SUM " <<< "$BOOT_KNOWN" && no "BOOT_SUM is also in BOOT_KNOWN"
t=$(mktemp); trap 'rm -f "$t"' EXIT
boot_image "$t" || no "boot_image failed (python3?)"
sum=$(sha256sum < "$t" | cut -d' ' -f1)
[ "$sum" = "$BOOT_SUM" ] || no "BOOT_SUM is not the sha256 of the image of BOOT_CMD ($sum)"
echo "ok start-up script $sum"
