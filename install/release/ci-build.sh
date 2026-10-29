#!/bin/bash
# The tag's release build on GitHub (.github/workflows/release.yml, #158): RELEASE=1 package and the
# installer image around it, in the build environment (buildenv.sh), plus a SHA256SUMS; the files
# land in build/release, attach.txt names the ones the draft gets. A release tag signs with the
# release key: DLZMOD_RELEASE_KEY holds the key file's text and DLZMOD_SIGNING_PASS its passphrase
# (the protected environment "release"); the key is written to a temporary folder only for the
# package's build and removed before the installer image. A test tag (vX.Y.Z-testN) builds the
# same files unsigned (UNSIGNED=1): a package no card takes, from whatever branch.
# The spare key (release2) is never on GitHub: a withdrawal release is signed on the PC.
#
# Usage: ci-build.sh <tag>
set -euo pipefail

REPO=$(cd "$(dirname "$0")/../.." && pwd)
cd "$REPO"
TAG=${1:?usage: ci-build.sh <tag>}
VER=$(tr -d '\r\n' < VERSION)
[ "${TAG%%-test*}" = "$VER" ] || { echo "the tag $TAG is not VERSION ($VER)" >&2; exit 1; }

export RELEASE=1
unset RELEASE_KEY UNSIGNED DLZMOD_SIGNING_KEYS
case $TAG in
  *-test*)
    [ -z "${DLZMOD_RELEASE_KEY:-}" ] || { echo "a test tag never gets the release key" >&2; exit 1; }
    export UNSIGNED=1
    ;;
  *)
    [ -n "${DLZMOD_RELEASE_KEY:-}" ] && [ -n "${DLZMOD_SIGNING_PASS:-}" ] \
      || { echo "release tag without DLZMOD_RELEASE_KEY and DLZMOD_SIGNING_PASS (environment release)" >&2; exit 1; }
    keys=$(mktemp -d)
    trap 'rm -rf "$keys"' EXIT
    (umask 077 && printf '%s\n' "$DLZMOD_RELEASE_KEY" > "$keys/release.pem")
    export DLZMOD_SIGNING_KEYS=$keys
    ;;
esac
unset DLZMOD_RELEASE_KEY

rm -rf build/release
# the container builds as root: the files are handed back to the runner's user. Two runs: only the
# package is signed, so only its run gets the passphrase and the key folder (#179); the key is
# removed before the installer image is built.
owner="$(id -u):$(id -g)"
bash install/release/buildenv.sh bash -c \
  'bash install/release/mkpackage.sh && chown -R "$0" build/release' "$owner"
[ -z "${keys:-}" ] || rm -rf "$keys"
unset DLZMOD_SIGNING_PASS DLZMOD_SIGNING_KEYS
bash install/release/buildenv.sh bash -c \
  'bash install/release/mkinstaller.sh "build/release/dlzmod-$0" && chown -R "$1" build/release' \
  "$VER" "$owner"
# the update file only when a card can take it as a drop-in: not when every card must have been
# installed with this very version (REINSTALL_BELOW, install/release/reinstall-below)
files=("dlz-installer-$VER.img")
below=$(sed -n 's/^REINSTALL_BELOW=//p' "build/release/dlzmod-$VER/package.env")
if [ "$below" != "$VER" ]; then
  files+=("dlzmod-$VER.tar")
  [ -n "${UNSIGNED:-}" ] || files+=("dlzmod-$VER.tar.sig")
fi
# attach.txt: what the workflow attaches to the draft, SHA256SUMS last
(cd build/release && sha256sum "${files[@]}" > SHA256SUMS && cat SHA256SUMS \
  && printf '%s\n' "${files[@]}" SHA256SUMS > attach.txt)
