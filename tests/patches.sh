#!/bin/bash
# The patches against the dump's own app.js, server.js and XS audio graph, without a card (WSL, root, from the repo root,
# the dump mounted read-only at /mnt/dlz by install/mount-ro.sh; it is only read):
# - every anchor occurs exactly once (patch.py --check, as the installer and the updater run it)
# - the patched files still parse, by the mixer's own node (the dump's, under qemu): the originals
#   first, as a control that the check can read them at all
# - the patched server.js keeps the refusals the updater checks for (its SERVER_MARKERS)
# - the patched audio graph builds Mackie's blocks unchanged, the EQ spectrum's (#131) only on the mod's
#   own buffers (tests/graph-check.js, by the mixer's node)
# - the Time tab's zones (#9, DLZMOD_zoneList) are in the mixer's tzdata, and each row's offset is the
#   zone's winter offset (standard time: the lower of January's and July's, by the mixer's node)
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

for t in app:srv/app.js server:srv/server.js graph:usr/local/share/evolve-a1/mixergraph-dlzlite.js; do
  src=$DUMP/${t#*:}
  t=${t%%:*}
  out=$(python3 install/patch.py --check $t "$src" 2>&1) && ok "$t.js: every anchor once" || bad "$t.js anchors: $out"
  cp "$src" "$TMP/$t.js"
  python3 install/patch.py $t "$TMP/$t.js" > "$TMP/$t.out" 2>&1 || { bad "$t.js: patching failed: $(tail -3 "$TMP/$t.out")"; continue; }
  cmp -s "$TMP/$t.js.orig" "$src" && ! cmp -s "$TMP/$t.js" "$src" && ok "$t.js patched (original kept as .orig)" || bad "$t.js: not patched"
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
# the audio graph as dspserver builds it: Mackie's blocks as they were, the mod's on its own buffers
if [ -f "$TMP/graph.js.orig" ]; then
  if dnode tests/graph-check.js "$TMP/graph.js.orig" "$TMP/graph.js" install/app-mod/dlzmod.js > "$TMP/graph.check" 2>&1; then
    ok "graph.js: $(grep -c '^ok' "$TMP/graph.check") checks of the patched graph (tests/graph-check.js)"
  else
    bad "graph.js: $(grep -v '^ok' "$TMP/graph.check" | head -5)"
  fi
fi
# the mod's own files parse as they are, before they are appended
for f in install/app-mod/dlzmod.js install/server-mod/dlzmod-server.js install/graph-mod/dlzmod-graph.js; do
  dnode --check "$f" > "$TMP/f.check" 2>&1 && ok "$f parses" || bad "$f does not parse: $(head -3 "$TMP/f.check")"
done
# the Time tab's list: the function alone, from the app mod (the rest of it needs Mackie's UI)
sed -n '/^function DLZMOD_zoneList() {$/,/^}$/p' install/app-mod/dlzmod.js > "$TMP/zones.js"
echo 'for (const z of DLZMOD_zoneList()) {
  const off = (m) => new Intl.DateTimeFormat("en-GB", { timeZone: z.zone, timeZoneName: "longOffset" })
    .formatToParts(new Date(Date.UTC(2026, m, 15))).find((x) => x.type === "timeZoneName").value;
  const mins = (o) => o === "GMT" ? 0 : (o[3] === "-" ? -1 : 1) * (+o.slice(4, 6) * 60 + +o.slice(7, 9));
  let std;
  try {
    std = Math.min(mins(off(0)), mins(off(6)));
  } catch (e) {
    console.log(z.zone + " unknown to the node on the mixer");
    continue;
  }
  const label = z.offset === "UTC" ? 0 : mins(z.offset.replace(/^UTC/, "GMT"));
  console.log(z.zone + " " + (std === label ? "ok" : "offset " + z.offset + ", is " + std + " min"));
}' >> "$TMP/zones.js"
if dnode "$TMP/zones.js" > "$TMP/zones.out" 2>&1 && [ -s "$TMP/zones.out" ]; then
  n=0
  while read -r zone res; do
    n=$((n + 1))
    [ "$res" = ok ] || bad "Time tab: $zone: $res"
    head -c 4 "$DUMP/usr/share/zoneinfo/$zone" 2>/dev/null | grep -q TZif || bad "Time tab: $zone is not in the mixer's tzdata"
  done < "$TMP/zones.out"
  ok "Time tab: $n zones checked against the mixer's tzdata and offsets"
else
  bad "Time tab: the zone list does not run: $(head -3 "$TMP/zones.out")"
fi

[ $fail = 0 ] && echo "ALL OK" || { echo "SOME FAILED"; exit 1; }
