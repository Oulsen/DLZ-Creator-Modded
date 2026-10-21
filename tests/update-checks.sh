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
tags=$(git -c safe.directory="$PWD" tag -l 'v*')
[ -n "$tags" ] || bad "no v* tags here (a shallow clone? git fetch --depth=1 origin '+refs/tags/v*:refs/tags/v*')"
for t in $tags; do
  old=$(git -c safe.directory="$PWD" show "$t:$NEW" 2>/dev/null) || { bad "$t has no $NEW"; continue; }
  out=$(gate "$old" "$NEW") && ok "the $t updater accepts this one (the tags here: $(echo $tags); newer ones: git fetch --tags)" \
    || bad "the $t updater refuses this one: $out"
done
# the check itself must be able to fail: this copy's own gate against copies that drop a gate string
# or change the guard list
# (a refusal is exit 1; 2 = this copy's own gate was not found, which must not count as a refusal)
cur=$(cat "$NEW")
out=$(gate "$cur" "$NEW") && ok "this copy's own gate accepts itself" || bad "this copy's own gate on itself: $out"
# a check dropped from the code only: the gate block's own list still names it (it must not count)
codesub() {   # codesub <text> <replacement>: in $NEW, outside the gate block
  awk -v a="$1" -v b="$2" -v s='if grep -qx usr/local/sbin/dlzmod-update <<< "$changed"; then' '
    function rep(t,   i) { while ((i = index(t, a)) > 0) t = substr(t, 1, i - 1) b substr(t, i + length(a)); return t }
    $0 == s { blk = 1 }
    !blk { $0 = rep($0) }
    { print }
    blk && /^fi$/ { blk = 0 }' "$NEW"
}
codesub '--reuid=65533' '--reuid=0' > "$TMP/no-gate"
grep -qF -- '--reuid=65533' "$TMP/no-gate" && grep -c -- '--reuid=65533' "$TMP/no-gate" | grep -qx 1 \
  || bad "the control copy is not what it should be (the gate list keeps the string, the code loses it)"
out=$(gate "$cur" "$TMP/no-gate"); [ $? = 1 ] && ok "a copy that drops a check from its code (its gate list unchanged) is refused: $out" || bad "a copy that drops a check from its code: not refused ($out)"
codesub '/device/type" 2>/dev/null)" = SD' '/device/type" 2>/dev/null)" = XX' > "$TMP/no-sd"
out=$(gate "$cur" "$TMP/no-sd"); [ $? = 1 ] && ok "a copy without the rehearsal-settings refusal (#84) is refused: $out" || bad "a copy without the #84 refusal: not refused ($out)"
codesub '[ "$APPROVED" = yes ] || wait_for_approval' '[ "$APPROVED" = yes ] || true' > "$TMP/no-ask"
out=$(gate "$cur" "$TMP/no-ask"); [ $? = 1 ] && ok "a copy that installs without Install on the screen (#65) is refused: $out" || bad "a copy without the approval gate: not refused ($out)"
codesub 'if [ "$(cat "$STATE/approved" 2>/dev/null)" = "$SUM" ]' 'if true' > "$TMP/any-ok"
out=$(gate "$cur" "$TMP/any-ok"); [ $? = 1 ] && ok "a copy that takes any approval (#65) is refused: $out" || bad "a copy that takes any approval: not refused ($out)"
sed 's/^if grep -qx usr\/local\/sbin\/dlzmod-update <<< "\$changed"; then$/if true; then/' "$NEW" > "$TMP/no-block"
out=$(gate "$cur" "$TMP/no-block"); [ $? = 1 ] && ok "a copy without the check of its own next copy is refused: $out" || bad "a copy without the check of its next copy: not refused ($out)"
sed '/^GUARDS="/s/^GUARDS="./GUARDS="0/' "$NEW" > "$TMP/guards"
out=$(gate "$cur" "$TMP/guards"); [ $? = 1 ] && ok "a copy with a changed guard list is refused: $out" || bad "a copy with a changed guard list: not refused ($out)"

# every function in the updater is defined before any line uses it (the live-only eMMC check once
# called `later` before its definition: bash said "command not found" and went on)
n=0
for fn in $(grep -oE '^[a-z_]+\(\) \{' "$NEW" | cut -d'(' -f1); do
  def=$(grep -nE "^$fn\(\) \{" "$NEW" | head -1 | cut -d: -f1)
  use=$(sed 's/[[:space:]]#.*$//' "$NEW" | grep -nE "(^|[^a-z_\$])$fn([^a-z_(]|$)" | grep -v ':\s*#' | grep -v 'trap ' | head -1 | cut -d: -f1)
  n=$((n + 1))
  [ -z "$use" ] || [ "$use" -ge "$def" ] || bad "$fn used on line $use before its definition on line $def"
done
[ $n -gt 10 ] && ok "function order ($n functions)" || bad "function order: only $n functions found"

# its copy of the scheduling drop-ins (#140, placed on a card an older updater left without them) is
# the text that ships, for each unit, and this updater's allowlist takes them
sched=$(sed -n "/^SCHED_CONF=\$(cat << 'SCHED_EOF'$/,/^SCHED_EOF$/p" "$NEW" | sed '1d;$d')
for u in glesgui evolve-node evolve-app; do
  [ -n "$sched" ] && [ "$sched" = "$(cat "install/sd-system/$u.service.d/dlzmod.conf")" ] \
    && ok "SCHED_CONF matches sd-system/$u.service.d/dlzmod.conf" || bad "SCHED_CONF differs from sd-system/$u.service.d/dlzmod.conf"
  grep -qF "$u.service.d:dlzmod.conf" "$NEW" && ok "allowlist takes $u.service.d/dlzmod.conf" || bad "allowlist lacks $u.service.d/dlzmod.conf"
done

# 2. Checks only (DLZMOD_CHECK_ONLY=1): this updater's checks of steps 1 and 2 (signature, package
# shape, model, firmware, version, guards) on a fixture tree, against packages made here the way
# mkpackage.sh lays them out, signed with throwaway keys. Never as root: the mode writes nothing, and
# a run that is not in it must not get far.
[ "$(id -u)" != 0 ] || { bad "runs as a normal user only (not root)"; exit 1; }
for c in openssl cpio gzip tar sha256sum; do command -v $c > /dev/null || { bad "needs $c"; exit 1; }; done
TK=$TMP/keys; mkdir -p "$TK"
for k in release release2 dev other; do
  openssl genpkey -algorithm ed25519 -out "$TK/$k.pem" 2> /dev/null && openssl pkey -in "$TK/$k.pem" -pubout -out "$TK/$k.pub" \
    || { bad "no ed25519 key from openssl"; exit 1; }
done
GUARDS=$(sed -n '/^GUARDS="/,/"$/p' "$NEW" | sed 's/^GUARDS="//; s/"$//')
GUARD_SRC=$(sed -n '/^GUARD_SRC="/,/"$/p' "$NEW" | sed 's/^GUARD_SRC="//; s/"$//' | tr '\n' ' ')
SERVER_MARKERS=$(sed -n "/^SERVER_MARKERS='/,/'\$/p" "$NEW" | sed "s/^SERVER_MARKERS='//; s/'\$//")
VER=$(tr -d '\r\n' < VERSION)
R=$TMP/root D=$TMP/data U=$TMP/data/dlzmod-update

# fixture(): a fresh card tree as the installer leaves it, as far as these checks read it: the trusted
# keys (release + release2 + dev, a developer card), the XS mark and its GD32 marker, the firmware,
# the installed version, the guards, the update unit and its links, server.js's refusals
fixture() {
  rm -rf "$R" "$D"; mkdir -p "$R/root" "$R/var/lib/dpkg" "$R/var/lib/dlzmod-update" "$R/srv" \
    "$R/usr/local/share/dlzmod-keys" "$R/usr/local/sbin" "$R/etc/systemd/system/sysinit.target.wants" \
    "$R/etc/systemd/system/multi-user.target.wants" "$U"
  cp "$TK/release.pub" "$TK/release2.pub" "$TK/dev.pub" "$R/usr/local/share/dlzmod-keys/"
  : > "$R/root/.dlzlite"; : > "$R/root/.gd32-loaded-firmware-dlzlite-154.bin"
  printf 'Package: evolve-node\nStatus: install ok installed\nVersion: 3297\n' > "$R/var/lib/dpkg/status"
  echo '{"version": "1.2.0 build 1731"}' > "$R/srv/srv_data.json"
  echo "$VER" > "$R/var/lib/dlzmod-update/version"
  local i=0 sum f src
  while read -r sum f; do
    i=$((i + 1)); src=$(echo $GUARD_SRC | cut -d' ' -f$i)
    mkdir -p "$(dirname "$R/$f")" && cp "install/$src" "$R/$f"
  done <<< "$GUARDS"
  ln -s /etc/systemd/system/dlzmod-emmc-ro.service "$R/etc/systemd/system/sysinit.target.wants/dlzmod-emmc-ro.service"
  ln -s /etc/systemd/system/dlzmod-update.service "$R/etc/systemd/system/multi-user.target.wants/dlzmod-update.service"
  cp install/sd-system/dlzmod-update.service "$R/etc/systemd/system/"
  install -m 755 "$NEW" "$R/usr/local/sbin/dlzmod-update"
  printf '%s\n' "$SERVER_MARKERS" > "$R/srv/server.js"
}
# mkpkg <name> [<code in pkg/>] [<code in the outer folder>]: $TMP/<name>.tar and .sig, signed with
# the key in SIGNKEY (default dev); the code hooks run before the manifests are made (as update.sh's craft)
setchan() { sed -i "s/^CHANNEL=.*/CHANNEL=$1/" package.env; }
mkpkg() {
  local b=$TMP/build-$1 top=dlzmod-$VER-dev-test
  rm -rf "$b"; mkdir -p "$b/r/pkg/mod/app-mod" "$b/r/pkg/mod/server-mod" "$b/r/pkg/mod/keys" "$b/$top"
  local m=$b/r/pkg/mod
  for f in card-core.sh check-rootfs.sh apply-mod.sh patch.py modversion.py; do cp "install/$f" "$m/"; done
  cp install/app-mod/dlzmod.js "$m/app-mod/"; cp install/server-mod/dlzmod-server.js "$m/server-mod/"
  cp -r install/sd-system "$m/sd-system"
  cp "$TK/release.pub" "$TK/release2.pub" "$TK/dev.pub" "$m/keys/"
  echo "$VER" > "$b/r/pkg/VERSION"
  printf '%s\n' "DLZMOD_VERSION=$VER" MODEL=XS MODELS=XS,full-size EVOLVE_NODE=3297 REINSTALL=no PLACEHOLDER=no \
    DRYRUN_ONLY=no BUILT=2026-01-01T00:00:00Z COMMIT=test BUILD=dev-test CHANNEL=dev > "$b/r/pkg/package.env"
  (cd "$b/r/pkg" && eval "${2:-:}" && find . -type f ! -name manifest | LC_ALL=C sort | sed 's#^\./##' | xargs sha256sum > manifest) || return 1
  (cd "$b/r" && find . | LC_ALL=C sort | cpio -o -H newc --quiet) | gzip -9 -n > "$b/$top/initrd.cpio.gz"
  cp "$b/r/pkg/package.env" "$b/$top/package.env"
  (cd "$b/$top" && eval "${3:-:}" && sha256sum initrd.cpio.gz package.env > manifest) || return 1
  tar --format=ustar -cf "$TMP/$1.tar" -C "$b" "$top" && rm -rf "$b"
  sign "$TMP/$1.tar" "${SIGNKEY:-dev}"
}
sign() { openssl pkeyutl -sign -inkey "$TK/$2.pem" -rawin -in "$1" -out "$1.sig"; }
put() { cp "$TMP/$1.tar" "$U/dlzmod-$1.tar"; [ ! -e "$TMP/$1.tar.sig" ] || cp "$TMP/$1.tar.sig" "$U/dlzmod-$1.tar.sig"; }
flip() { printf "$(printf '\\%03o' $(( $(od -An -tu1 -j4000 -N1 "$1") ^ 1 )))" | dd of="$1" bs=1 seek=4000 conv=notrunc 2> /dev/null; }
# a fingerprint of everything in the trees (names, sizes, modes, times, content) and the updater's
# temp files: a checks-only run must leave all of it as it was
tree() { (cd "$TMP" && find root data -printf '%p %s %m %T@ %l\n' | LC_ALL=C sort; find root data -type f -exec sha256sum {} + | LC_ALL=C sort)
  ls /tmp | grep '^dlzmod-' || true; }
OUT=$TMP/out
check() {   # check <expected text> [<label>]: a checks-only run, its last line, and nothing changed
  local before; before=$(tree)
  DLZMOD_CHECK_ONLY=1 DLZMOD_ROOT=$R DLZMOD_DATA=$D bash "$NEW" > "$OUT" 2>&1; echo "rc=$?" >> "$OUT"
  if grep -qF -- "$1" "$OUT"; then ok "${2:-$1}"; else bad "${2:-$1}: got $(grep -v '^rc=' "$OUT" | tail -1)"; sed 's/^/    | /' "$OUT"; fi
  [ "$(tree)" = "$before" ] || bad "${2:-$1}: the run changed the trees or left temp files"
}
fresh() { fixture; rm -f "$U"/*; }

echo "-- checks only: the entry guard"
fixture
out=$(DLZMOD_CHECK_ONLY=yes DLZMOD_ROOT=$R DLZMOD_DATA=$D bash "$NEW" 2>&1); rc=$?
[ $rc = 2 ] && ok "another value than 1: refused ($out)" || bad "DLZMOD_CHECK_ONLY=yes: rc $rc, $out"
out=$(DLZMOD_CHECK_ONLY=1 DLZMOD_ROOT=$R bash "$NEW" 2>&1); rc=$?
[ $rc = 2 ] && ok "without DLZMOD_DATA: refused" || bad "without DLZMOD_DATA: rc $rc, $out"
out=$(DLZMOD_CHECK_ONLY=1 DLZMOD_ROOT=/ DLZMOD_DATA=$D bash "$NEW" 2>&1); rc=$?
[ $rc = 2 ] && ok "DLZMOD_ROOT=/: refused" || bad "DLZMOD_ROOT=/: rc $rc, $out"
out=$(DLZMOD_CHECK_ONLY=1 DLZMOD_DATA=$D bash "$NEW" 2>&1); rc=$?
[ $rc = 2 ] && ok "without DLZMOD_ROOT: refused" || bad "without DLZMOD_ROOT: rc $rc, $out"
before=$(tree)
out=$(DLZMOD_CHECK_ONLY=1 DLZMOD_ROOT=$R/.. DLZMOD_DATA=$D bash "$NEW" 2>&1); rc=$?
[ $rc = 0 ] && [ "$(tree)" = "$before" ] && ok "a rehearsal folder that is not / is accepted, nothing written" \
  || bad "DLZMOD_ROOT=$R/..: rc $rc or the trees changed: $out"

echo "-- checks only: a good package passes, and stays"
mkpkg good
fresh; put good; check "CHECKS PASSED" "the package passes"
[ -e "$U/dlzmod-good.tar" ] && [ ! -e "$U/README.txt" ] && [ ! -d "$D/dlzmod-logs" ] && ok "package kept, no README, no report" || bad "DLZDATA written"
fresh; put good; check "signature: dev key" "verified by the dev key"
fresh; check "rc=0" "nothing to check: nothing happens"
[ "$(grep -vc '^rc=' "$OUT")" = 0 ] || bad "nothing to check: it said something: $(grep -v '^rc=' "$OUT" | head -3)"

echo "-- checks only: refused (the package)"
fresh; cp "$TMP/good.tar" "$U/dlzmod-bad.tar"; flip "$U/dlzmod-bad.tar"; sign "$U/dlzmod-bad.tar" dev; check "damaged" "4: one byte changed, signed again"
fresh; cp "$TMP/good.tar" "$U/dlzmod-a.tar"; cp "$TMP/good.tar.sig" "$U/dlzmod-a.tar.sig"; cp "$TMP/good.tar" "$U/dlzmod-b.tar"; cp "$TMP/good.tar.sig" "$U/dlzmod-b.tar.sig"
check "more than one update file" "5: two packages"
mkpkg link "ln -s /etc mod/evil"; fresh; put link; check "links or special files" "8: a link in the initramfs"
mkpkg model "sed -i 's/^MODELS=.*/MODELS=full-size/' package.env" "sed -i 's/^MODELS=.*/MODELS=full-size/' package.env"
fresh; put model; check "made for the full-size, this is the XS" "9: made for the other model"
fresh; mv "$R/root/.gd32-loaded-firmware-dlzlite-154.bin" "$R/root/.gd32-loaded-firmware-evolve-154.bin"; put good
check "does not pass the package's check" "9b: the card's GD32 marker is the other model's"
mkpkg old "echo v0.0.9 > VERSION && sed -i 's/^DLZMOD_VERSION=.*/DLZMOD_VERSION=v0.0.9/' package.env" "sed -i 's/^DLZMOD_VERSION=.*/DLZMOD_VERSION=v0.0.9/' package.env"
fresh; put old; check "older (v0.0.9)" "10: older version"
mkpkg guard "echo 'ExecStart=/usr/local/bin/flash-gd32.sh' >> mod/sd-system/flash-gd32.service.d/dlzmod.conf"
fresh; put guard; check "changes a safety guard" "11: a guard that starts the GD32 flash again"
mkpkg bomb "head -c 70000000 /dev/zero > mod/big"; fresh; put bomb; check "unpacks too big" "18: an initramfs that unpacks past the limit"
fresh; gzip -c "$TMP/good.tar" > "$U/dlzmod-gz.tar"; sign "$U/dlzmod-gz.tar" dev; check "not a plain tar" "20: a compressed tar"
fresh; cp "$TMP/good.tar" "$U/dlzmod-nosig.tar"; check "has no signature file" "21: no signature file"
SIGNKEY=other mkpkg other; fresh; put other; check "not signed with a key this card trusts" "22: a key the card does not trust"
fresh; cp "$TMP/good.tar" "$U/dlzmod-after.tar"; cp "$TMP/good.tar.sig" "$U/dlzmod-after.tar.sig"; flip "$U/dlzmod-after.tar"
check "not signed with a key this card trusts" "23: changed after signing"
fresh; put good; echo x >> "$U/dlzmod-good.tar.sig"; check "not an ed25519 signature" "24: a signature file of the wrong size"
fresh; rm "$R/usr/local/share/dlzmod-keys/dev.pub"; put good; check "not signed with a key this card trusts" "25: a test build on a release card"
SIGNKEY=release mkpkg relasdev; fresh; put relasdev; check "a 'dev' package signed with the release key" "26: release key, marked dev"
SIGNKEY=release mkpkg rel "setchan release" "setchan release"; fresh; put rel; check "CHECKS PASSED" "27: a release package on a developer card"
mkpkg devasrel "setchan release" "setchan release"; fresh; put devasrel; check "a 'release' package signed with the dev key" "28: dev key, marked release"
mkpkg future "echo FUTURE_FIELD=something >> package.env" "echo FUTURE_FIELD=something >> package.env"
fresh; put future; check "CHECKS PASSED" "31: a package.env key this version does not know"
fresh; rm -r "$R/usr/local/share/dlzmod-keys"; put good; check "has no update keys" "32: a card without update keys"
SIGNKEY=release2 mkpkg spare "setchan release" "setchan release"
fresh; rm "$R/usr/local/share/dlzmod-keys/dev.pub"; put spare; check "signature: release2 key" "36: the spare release key on a release card"
fresh; rm "$R/usr/local/share/dlzmod-keys/dev.pub"; put spare; check "CHECKS PASSED" "36: and it passes"
SIGNKEY=release2 mkpkg spareasdev; fresh; put spareasdev; check "a 'dev' package signed with the release key" "37: the spare key, marked dev"
mkpkg missing "rm mod/check-rootfs.sh"; fresh; put missing; check "incomplete: check-rootfs.sh missing" "a package without a file it needs"
mkpkg noparse "echo 'if then' >> mod/apply-mod.sh"; fresh; put noparse; check "its scripts do not parse" "a package whose steps do not parse"
mkpkg reinstall "sed -i 's/^REINSTALL=.*/REINSTALL=yes/' package.env" "sed -i 's/^REINSTALL=.*/REINSTALL=yes/' package.env"
fresh; put reinstall; check "needs a full install" "a package that needs a full install"

echo "-- checks only: the card's side"
fresh; echo "v9.9.9" > "$R/var/lib/dlzmod-update/version"; put good; check "older ($VER) than this card's v9.9.9" "a card on a newer version"
# 38: a cut-off try had written its newer version; the snapshot from before it holds the real one
fresh; echo "v9.9.9" > "$R/var/lib/dlzmod-update/version"; echo other > "$R/var/lib/dlzmod-update/inprogress"
mkdir -p "$TMP/snap/var/lib/dlzmod-update"; echo "$VER" > "$TMP/snap/var/lib/dlzmod-update/version"
tar -cf "$R/var/lib/dlzmod-update/previous.tar" -C "$TMP/snap" var/lib/dlzmod-update/version; echo var/lib/dlzmod-update/version > "$R/var/lib/dlzmod-update/previous.list"
put good; check "CHECKS PASSED" "38: the version from a cut-off try's snapshot counts"
fresh; echo "# x" >> "$R/etc/systemd/system/flash-gd32.service.d/dlzmod.conf"; put good
check "the guards on this card are not as installed" "a card whose guard was changed"
fresh; mkdir -p "$R/etc/systemd/system/flash-gd32.service.d"; echo "[Service]" > "$R/etc/systemd/system/flash-gd32.service.d/zz.conf"; put good
check "the guards on this card are not as installed" "a card with an extra drop-in next to a guard"
fresh; printf 'nothing\n' > "$R/srv/server.js"; put good; check "the guards on this card are not as installed" "a server.js without its refusals"
fresh; rm "$R/root/.dlzlite"; put good; check "does not pass the package's check" "a full-size card with the XS marker"

# DLZDATA/dlzmod-update/README.txt: the installer writes it and the updater replaces any other text, so
# a difference would rewrite it on DLZDATA at the first start of every new card
ru=$(sed -n '/^readme() {/,/^}/p' "$NEW" | grep -o '"[^"]*"')
ri=$(sed -n '/"Updates for DLZ Creator Modded go here/,/README.txt"/p' install/installer/install-card.sh | grep -o '"[^"]*"' | grep -v '\$\|step 1')
[ -n "$ru" ] && [ "$ru" = "$ri" ] && ok "dlzmod-update/README.txt: the installer's text is the updater's" || bad "dlzmod-update/README.txt differs between install-card.sh and the updater"

[ $fail = 0 ] && echo "ALL OK" || { echo "SOME FAILED"; exit 1; }
