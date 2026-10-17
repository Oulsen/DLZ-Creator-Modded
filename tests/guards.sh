#!/bin/bash
# The build tools' refusals around the update keys, in seconds: no root, no dump, no card image (also
# on GitHub). Each case gives a tool bad input and checks that it stops with its message before it
# builds or writes anything, plus the good cases that do not need a build:
# - mkkeys.sh: no key folder inside the repo, never overwrites, a dev key pair next to each other
# - mkpackage.sh and build-sd.sh: DLZMOD_SIGNING_KEYS/dev.pub must be a public key and the one of
#   the dev.pem next to it
# - card-core.sh (install_update_keys, run on its own): which keys a card gets per channel;
#   DLZMOD_DEV_PUB only without a package.env, never a private key
# - mkinstaller.sh: a release package's image only from a clean tree at the package's COMMIT
# Needs: Linux or WSL (not Git Bash: the tools it checks run there), bash, openssl, git, python3.
# Usage: bash tests/guards.sh (from anywhere)
set -uo pipefail

REPO=$(cd "$(dirname "$0")/.." && pwd)
T=$(mktemp -d)
trap 'rm -rf "$T"' EXIT
F=0
ok() { echo "  ok: $*"; }; bad() { echo "  FAIL: $*"; F=$((F + 1)); }
# expect <name> <text the tool must say> <command...>: refused (non-zero) with that text
expect() {
  local name=$1 text=$2 rc; shift 2
  "$@" > "$T/out" 2>&1; rc=$?
  if [ $rc != 0 ] && grep -qF -- "$text" "$T/out"; then ok "$name"
  else bad "$name (rc=$rc, expected \"$text\")"; sed 's/^/    | /' "$T/out"; fi
}
keys_before=$(cd "$REPO" && git status --porcelain -- install/keys; sha256sum install/keys/*.pub)

echo "== mkkeys.sh"
MK=$REPO/install/release/mkkeys.sh
expect "a key folder inside the repo is refused" "inside the repo" bash "$MK" "$REPO/build/guards-keys" dev
[ ! -e "$REPO/build/guards-keys" ] && ok "and nothing made there" || bad "a folder was made in the repo"
bash "$MK" "$T/own" dev > "$T/out" 2>&1 && [ -s "$T/own/dev.pem" ] && [ -s "$T/own/dev.pub" ] \
  && ok "dev: dev.pem and dev.pub in the key folder" || { bad "dev key pair not made"; sed 's/^/    | /' "$T/out"; }
[ "$(openssl pkey -in "$T/own/dev.pem" -pubout | tr -d '\r')" = "$(tr -d '\r' < "$T/own/dev.pub")" ] \
  && ok "dev.pub belongs to dev.pem" || bad "dev.pub does not belong to dev.pem"
expect "an existing key is never overwritten" "not overwritten" bash "$MK" "$T/own" dev
bash "$MK" "$T/other" dev > /dev/null 2>&1 || bad "second dev key pair not made"

# bad key folders: dev.pub from another pair, a private key as dev.pub
mkdir -p "$T/mismatch" "$T/private"
cp "$T/own/dev.pem" "$T/mismatch/" && cp "$T/other/dev.pub" "$T/mismatch/"
cp "$T/own/dev.pem" "$T/private/" && cp "$T/own/dev.pem" "$T/private/dev.pub"

echo "== mkpackage.sh (dev channel)"
# tools it checks for before the keys, which these cases never reach: stubs where missing
mkdir -p "$T/stub"
for c in cpio dpkg-deb curl qemu-arm mknod; do
  command -v "$c" > /dev/null || printf '#!/bin/sh\necho "stub %s must not run" >&2; exit 99\n' "$c" > "$T/stub/$c"
done
chmod +x "$T/stub/"* 2> /dev/null
PK() { PATH=$T/stub:$PATH DLZMOD_SIGNING_KEYS=$1 bash "$REPO/install/release/mkpackage.sh" "$T/pkg-out"; }
expect "dev.pub of another key pair is refused" "is not the public key of" PK "$T/mismatch"
expect "a private key as dev.pub is refused" "is not a public key" PK "$T/private"
[ ! -e "$T/pkg-out" ] && ok "and no package started" || bad "mkpackage wrote $T/pkg-out"

echo "== build-sd.sh (before the dump is read)"
BS() { DLZMOD_SIGNING_KEYS=$1 bash "$REPO/install/build-sd.sh" "$T/no-dump.img" "$T/card.img"; }
expect "dev.pub of another key pair is refused" "is not the public key of" BS "$T/mismatch"
expect "a private key as dev.pub is refused" "is not a public key" BS "$T/private"
expect "own key pair accepted (stops at the missing dump)" "no-dump.img is not a file" BS "$T/own"
grep -qF "dev key on the card: $T/own/dev.pub" "$T/out" && ok "and it is the card's dev key" || bad "own dev key not chosen"
expect "no own key: the repo's (stops at the missing dump)" "no-dump.img is not a file" BS ""
grep -qF "dev key on the card: $REPO/install/keys/dev.pub" "$T/out" && ok "and it is install/keys/dev.pub" || bad "repo dev key not chosen"
[ ! -e "$T/card.img" ] && ok "no card image written" || bad "build-sd wrote a card image"

echo "== card-core.sh: install_update_keys"
# the two functions on their own, on a copy of the tools' keys; TOOLS/../package.env as the installer has it
fns=$(sed -n '/^die() {/p; /^update_channel() {/,/^}/p; /^install_update_keys() {/,/^}/p' "$REPO/install/card-core.sh")
[ "$(grep -c '() {' <<< "$fns")" = 3 ] || bad "card-core.sh's functions not found"
mkdir -p "$T/core/tools/keys"
cp "$REPO/install/keys/"*.pub "$T/core/tools/keys/"
# keys <package.env CHANNEL or "none"> [env...]: runs it, prints the card's key files and dev.pub's sum
keys() {
  local chan=$1; shift
  rm -rf "$T/core/mnt" "$T/core/package.env"; mkdir -p "$T/core/mnt"
  [ "$chan" = none ] || echo "CHANNEL=$chan" > "$T/core/package.env"
  env "$@" TOOLS="$T/core/tools" MNT="$T/core/mnt" bash -c "$fns"'
    install_update_keys > /dev/null || exit 1
    ls "$MNT/usr/local/share/dlzmod-keys" | tr "\n" " "
    [ ! -f "$MNT/usr/local/share/dlzmod-keys/dev.pub" ] || sha256sum < "$MNT/usr/local/share/dlzmod-keys/dev.pub" | cut -c1-16'
}
sum() { tr -d '\r' < "$1" | sha256sum | cut -c1-16; }
r=$(keys release 2>&1); [ "$r" = "release.pub release2.pub " ] && ok "release package: release keys only" || bad "release package: $r"
r=$(keys release DLZMOD_DEV_PUB="$T/own/dev.pub" DLZMOD_CHANNEL=dev 2>&1)
[ "$r" = "release.pub release2.pub " ] && ok "release package: DLZMOD_CHANNEL / DLZMOD_DEV_PUB from outside ignored" || bad "release package with env: $r"
r=$(keys dev DLZMOD_DEV_PUB="$T/own/dev.pub" 2>&1)
[ "$r" = "dev.pub release.pub release2.pub $(sum "$REPO/install/keys/dev.pub")" ] \
  && ok "dev package: its own dev.pub, DLZMOD_DEV_PUB ignored" || bad "dev package: $r"
r=$(keys none DLZMOD_CHANNEL=dev DLZMOD_DEV_PUB="$T/own/dev.pub" 2>&1)
[ "$r" = "dev.pub release.pub release2.pub $(sum "$T/own/dev.pub")" ] \
  && ok "build-sd (no package.env): DLZMOD_DEV_PUB on the card" || bad "build-sd own key: $r"
r=$(keys none DLZMOD_CHANNEL=dev 2>&1)
[ "$r" = "dev.pub release.pub release2.pub $(sum "$REPO/install/keys/dev.pub")" ] \
  && ok "build-sd without own key: the repo's dev.pub" || bad "build-sd repo key: $r"
r=$(keys none DLZMOD_CHANNEL=dev DLZMOD_DEV_PUB="$T/own/dev.pem" 2>&1)
grep -q "is not a public key" <<< "$r" && ok "a private key as DLZMOD_DEV_PUB is refused" || bad "private key: $r"
r=$(keys none 2>&1)
grep -q "update keys unknown" <<< "$r" && ok "no package.env and no DLZMOD_CHANNEL: refused" || bad "no channel: $r"
r=$(keys beta 2>&1)
grep -q "bad CHANNEL" <<< "$r" && ok "an unknown CHANNEL is refused" || bad "bad channel: $r"

echo "== mkinstaller.sh (release package)"
# a copy of the tool in its own small git repo; every package says PLACEHOLDER=yes, so a package that
# passes the commit check stops at the next refusal, before any download or loop device
R=$T/inst-repo
mkdir -p "$R/install/release" "$R/install/installer"
cp "$REPO/install/release/mkinstaller.sh" "$REPO/install/release/vendor.sh" "$R/install/release/"
cp "$REPO/install/installer/boot.txt" "$R/install/installer/"
cp "$REPO/VERSION" "$R/"
g() { git -C "$R" -c user.name=guards -c user.email=guards@localhost -c core.autocrlf=false -c commit.gpgsign=false "$@" > /dev/null; }
g init -q && g add -A && g commit -qm one && g commit -q --allow-empty -m two
# pkg <BUILD> <COMMIT>: a package directory with a manifest that matches
pkg() {
  rm -rf "$T/ipkg"; mkdir -p "$T/ipkg"
  echo initrd > "$T/ipkg/initrd.cpio.gz"
  printf 'DLZMOD_VERSION=%s\nBUILD=%s\nCOMMIT=%s\nPLACEHOLDER=yes\nBUILT=2026-01-01T00:00:00Z\n' \
    "$(tr -d '\r' < "$REPO/VERSION")" "$1" "$2" > "$T/ipkg/package.env"
  (cd "$T/ipkg" && sha256sum initrd.cpio.gz package.env > manifest)
}
MI() { env -u ALLOW_PLACEHOLDER bash "$R/install/release/mkinstaller.sh" "$T/ipkg" "$T/inst-out"; }
head=$(git -C "$R" rev-parse --short HEAD)
pkg release "$head"; expect "clean tree at the package's commit accepted (stops at the placeholder)" "placeholder" MI
pkg release "$(git -C "$R" rev-parse HEAD)"; expect "the full commit hash accepted too" "placeholder" MI
pkg release "$(git -C "$R" rev-parse --short HEAD~1)"; expect "a package from another commit is refused" "package was built from commit" MI
pkg release "$head+dirty"; expect "a +dirty commit is refused" "package was built from commit" MI
pkg release HEAD; expect "a commit name that is not a hash is refused" "package was built from commit" MI
pkg release ""; expect "a package without COMMIT is refused" "package was built from commit" MI
echo "# changed" >> "$R/install/installer/boot.txt"
pkg release "$head"; expect "a changed boot.txt is refused" "needs a clean tree" MI
pkg "dev-$head+dirty" "$head+dirty"; expect "a dev package's image may come from a changed tree" "placeholder" MI
g checkout -q -- install/installer/boot.txt
touch "$R/install/new-file"
pkg release "$head"; expect "a new file under install/ is refused" "needs a clean tree" MI
rm "$R/install/new-file"
rm -rf "$R/.git"
pkg release "$head"; expect "a tree git cannot read is refused" "git cannot read" MI
[ ! -e "$T/inst-out" ] && ok "no image started" || bad "mkinstaller wrote $T/inst-out"

echo "== the repo"
[ "$(cd "$REPO" && git status --porcelain -- install/keys; sha256sum install/keys/*.pub)" = "$keys_before" ] \
  && ok "install/keys unchanged" || bad "install/keys changed"

echo
[ $F = 0 ] && echo "ALL GUARD CHECKS PASSED" || { echo "$F GUARD CHECK(S) FAILED"; exit 1; }
