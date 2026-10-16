#!/bin/bash
# The patches against the dump's own app.js and server.js, without a card (WSL, root, from the repo root,
# the dump mounted read-only at /mnt/dlz by install/mount-ro.sh; it is only read):
# - every anchor occurs exactly once (patch.py --check, as the installer and the updater run it)
# - the patched files still parse, by the mixer's own node (the dump's, under qemu): the originals
#   first, as a control that the check can read them at all
# - the patched server.js keeps the refusals the updater checks for (its SERVER_MARKERS)
#   bash tests/patches.sh
set -u
cd "$(dirname "$0")/.." || exit 2
DUMP=${DUMP:-/mnt/dlz}
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
fail=0
ok() { echo "ok    $*"; }
bad() { echo "FAIL  $*"; fail=1; }
[ -f "$DUMP/srv/app.js" ] && [ -f "$DUMP/srv/server.js" ] || { echo "no dump at $DUMP: wsl -d Ubuntu -u root -e bash install/mount-ro.sh"; exit 2; }
L=$DUMP/usr/lib/arm-linux-gnueabihf
dnode() { QEMU_LD_PREFIX=$DUMP LD_LIBRARY_PATH=$L/blas:$L/lapack:$L qemu-arm "$DUMP/usr/bin/node" "$@"; }
dnode --version > /dev/null 2>&1 || { echo "the dump's node does not run (qemu-arm?)"; exit 2; }
echo "node: the dump's $(dnode --version)"

for t in app server; do
  out=$(python3 install/patch.py --check $t "$DUMP/srv/$t.js" 2>&1) && ok "$t.js: every anchor once" || bad "$t.js anchors: $out"
  cp "$DUMP/srv/$t.js" "$TMP/$t.js"
  python3 install/patch.py $t "$TMP/$t.js" > "$TMP/$t.out" 2>&1 || { bad "$t.js: patching failed: $(tail -3 "$TMP/$t.out")"; continue; }
  cmp -s "$TMP/$t.js.orig" "$DUMP/srv/$t.js" && ! cmp -s "$TMP/$t.js" "$DUMP/srv/$t.js" && ok "$t.js patched (original kept as .orig)" || bad "$t.js: not patched"
  cp "$TMP/$t.js.orig" "$TMP/orig-$t.js"   # node only reads .js/.cjs/.mjs names
  if dnode --check "$TMP/orig-$t.js" > "$TMP/$t.check" 2>&1; then
    dnode --check "$TMP/$t.js" > "$TMP/$t.check" 2>&1 && ok "$t.js: the patched file parses" || bad "$t.js: the patched file does not parse: $(head -5 "$TMP/$t.check")"
  else
    bad "$t.js: the original does not parse either (the check cannot judge it): $(head -3 "$TMP/$t.check")"
  fi
done
MARKERS=$(sed -n "/^SERVER_MARKERS='/,/'\$/p" install/sd-system/dlzmod-update | sed "s/^SERVER_MARKERS='//; s/'\$//")
[ "$(grep -c . <<< "$MARKERS")" = 3 ] || bad "the updater's SERVER_MARKERS: $(grep -c . <<< "$MARKERS") lines, expected 3"
while IFS= read -r m; do
  grep -qF -- "$m" "$TMP/server.js" && ok "server.js keeps: ${m:0:60}" || bad "server.js lost a refusal: $m"
done <<< "$MARKERS"
# the mod's own files parse as they are, before they are appended
for f in install/app-mod/dlzmod.js install/server-mod/dlzmod-server.js; do
  dnode --check "$f" > "$TMP/f.check" 2>&1 && ok "$f parses" || bad "$f does not parse: $(head -3 "$TMP/f.check")"
done

[ $fail = 0 ] && echo "ALL OK" || { echo "SOME FAILED"; exit 1; }
