#!/bin/bash
# The updater's copy of the card's start-up script (#221: BOOT_CMD, BOOT_SUM, BOOT_KNOWN in
# sd-system/dlzmod-update) against the one that ships (sd-system/boot.cmd; while there is none,
# BOOT_CMD and BOOT_SUM are empty). Used by mkpackage.sh and tests/update-checks.sh.
#   bootscr-check.sh <dlzmod-update> <boot.cmd>: prints what is wrong, exit 1; or "ok ...", exit 0
#   bootscr-check.sh --code <dlzmod-update>: prints the updater's own lines for them (BOOT_KNOWN,
#     BOOT_SUM, BOOT_CMD, boot_image), to eval (the tests use it too)
set -u
code() {   # each from its own first line to its own last: BOOT_KNOWN to the line ending in ", BOOT_CMD to BOOT_EOF
  awk '/^BOOT_KNOWN="/ { k = 1 } k { print; if (/"$/) k = 0; next }
       /^BOOT_SUM="[0-9a-f]*"$/ { print; next }
       /^BOOT_CMD=\$\(cat << .BOOT_EOF.$/ { c = 1 } c { print; if (/^BOOT_EOF$/) { print ")"; c = 0 }; next }
       /^boot_image\(\) \{/ { f = 1 } f { print; if (/^}$/) f = 0 }' "$1"
}
if [ "${1:-}" = --code ]; then code "${2:?dlzmod-update}"; exit; fi
U=${1:?dlzmod-update}; CMD=${2:?boot.cmd}
no() { echo "$*"; exit 1; }
BOOT_KNOWN="" BOOT_SUM=x BOOT_CMD=""
eval "$(code "$U")"
[ -n "$BOOT_KNOWN" ] && [ "$BOOT_SUM" != x ] && declare -F boot_image > /dev/null || no "BOOT_KNOWN, BOOT_SUM, BOOT_CMD or boot_image not found"
[ "$(sed -n '1s/ .*//p' <<< "$BOOT_KNOWN")" = 19ddc05aab827c44cb055cdde67142c5e68594d5167cf341ce589161ab7867e8 ] \
  || no "BOOT_KNOWN does not start with the stock script's sum (the stock copy is kept by it)"
grep -qvE '^[0-9a-f]{64} [^ ]' <<< "$BOOT_KNOWN" && no "BOOT_KNOWN: a line that is not '<sha256> <what>'"
if [ ! -e "$CMD" ]; then
  [ -z "$BOOT_CMD" ] && [ -z "$BOOT_SUM" ] || no "BOOT_CMD or BOOT_SUM set, but there is no ${CMD##*/} to ship"
  echo "ok no start-up script to place yet"; exit 0
fi
grep -q $'\r' "$CMD" && no "${CMD##*/} has CR line ends (.gitattributes: LF)"
[ -n "$BOOT_CMD" ] && [ "$BOOT_CMD" = "$(cat "$CMD")" ] || no "BOOT_CMD does not match ${CMD##*/}"
grep -q "^$BOOT_SUM " <<< "$BOOT_KNOWN" && no "BOOT_SUM is also in BOOT_KNOWN"
t=$(mktemp); trap 'rm -f "$t"' EXIT
boot_image "$t" || no "boot_image failed (python3?)"
sum=$(sha256sum < "$t" | cut -d' ' -f1)
[ "$sum" = "$BOOT_SUM" ] || no "BOOT_SUM is not the sha256 of the image of BOOT_CMD ($sum)"
echo "ok start-up script $sum"
