#!/bin/bash
# Fast checks of the drop-in updater (install/sd-system/dlzmod-update): no card image, no dump, no
# root, seconds instead of minutes; runs in CI and on any PC with bash and git.
#   bash tests/update-checks.sh
# The rehearsals on card images (tests/update.sh) stay the proof for what only a card shows.
set -u
cd "$(dirname "$0")/.." || exit 2
NEW=install/sd-system/dlzmod-update
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
fail=0
ok() { echo "ok    $*"; }
bad() { echo "FAIL  $*"; fail=1; }

# 1. Every released updater accepts this copy. A card in the field runs its own updater, which places
# a new copy of itself only if that copy keeps its guard list and its gate strings (the block "the
# new copy of this script" in the updater). The block is cut from each tag's updater and run as is.
#   gate <tag's updater text> <candidate file>: prints the refusal, exit 1 when refused
gate() {
  local GUARDS block new=$2
  GUARDS=$(sed -n '/^GUARDS="/,/"$/p' <<< "$1" | sed 's/^GUARDS="//; s/"$//')
  block=$(awk '/^if grep -qx usr\/local\/sbin\/dlzmod-update <<< "\$changed"; then$/ { on = 1; next }
               on && /^fi$/ { exit } on' <<< "$1")
  [ -n "$GUARDS" ] && [ -n "$block" ] || { echo "its gate was not found"; return 2; }
  ( refuse() { echo "$*"; exit 1; }; eval "$block" )
}
tags=$(git tag -l 'v*')
[ -n "$tags" ] || bad "no v* tags here (a shallow clone? git fetch --depth=1 origin '+refs/tags/v*:refs/tags/v*')"
for t in $tags; do
  old=$(git show "$t:$NEW" 2>/dev/null) || { bad "$t has no $NEW"; continue; }
  out=$(gate "$old" "$NEW") && ok "the $t updater accepts this one" || bad "the $t updater refuses this one: $out"
done
# the check itself must be able to fail: this copy's own gate against copies that drop a gate string
# or change the guard list
cur=$(cat "$NEW")
sed 's/--reuid=65533/--reuid=0/' "$NEW" > "$TMP/no-gate"
out=$(gate "$cur" "$TMP/no-gate") && bad "a copy without a gate string passes" || ok "a copy without a gate string is refused: $out"
sed '/^GUARDS="/s/^GUARDS="./GUARDS="0/' "$NEW" > "$TMP/guards"
out=$(gate "$cur" "$TMP/guards") && bad "a copy with a changed guard list passes" || ok "a copy with a changed guard list is refused: $out"

[ $fail = 0 ] && echo "ALL OK" || { echo "SOME FAILED"; exit 1; }
