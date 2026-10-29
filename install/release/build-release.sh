#!/bin/bash
# The PC's release build (WSL, as root, from the repo root), in the pinned build environment
# (buildenv.sh: Docker Desktop): the RELEASE=1 package and the installer image around it, unsigned
# (UNSIGNED=1, no key or passphrase on the PC): GitHub builds and signs the release files from the
# tag (#158); release.sh compare checks that this build of the same commit has the same bytes and
# that GitHub's signature fits them. Output in build/release: dlz-installer-vX.Y.Z.img and
# dlzmod-vX.Y.Z.tar. Then a dev installer image of the same commit (dev key from <dev keys folder>)
# in build/devcard, so a new dev card starts at this version instead of updating from an old one
# (build/devcard is this step's own folder: emptied first, so it holds only the newest dev image).
# Each step starts with a "== " line; the last line is "Done: ...", "RELEASE BUILD FAILED" or
# "DEV IMAGE FAILED". Run by build-release.cmd (double-click) and release.sh build (Claude Code).
#
# Usage: build-release.sh <dev keys folder>
# Exit: 0 done, 1 the release build failed, 2 only the dev image failed
set -uo pipefail

REPO=$(cd "$(dirname "$0")/../.." && pwd)
cd "$REPO" || exit 1
KEYS=${1:?usage: build-release.sh <dev keys folder>}
VER=$(tr -d '\r\n' < VERSION)

# root in WSL does not own the repo on /mnt: git refuses it without safe.directory
echo "== 1/2 release build $VER of $(git -c safe.directory="$REPO" rev-parse --short HEAD) (unsigned, to compare with GitHub's)"
if ! env RELEASE=1 UNSIGNED=1 bash install/release/buildenv.sh bash -c \
    'rm -rf build/release && bash install/release/mkpackage.sh && bash install/release/mkinstaller.sh "build/release/dlzmod-$0"' "$VER"; then
  echo; echo "RELEASE BUILD FAILED, see above"; exit 1
fi
echo
echo "== 2/2 dev installer image of the same commit, in build/devcard"
if ! env DLZMOD_SIGNING_KEYS="$KEYS" bash install/release/buildenv.sh bash -c \
    'rm -rf build/devcard && bash install/release/mkpackage.sh build/devcard && bash install/release/mkinstaller.sh $(ls -d build/devcard/dlzmod-"$0"-dev-*/) build/devcard' "$VER"; then
  echo; echo "DEV IMAGE FAILED, see above: the release build itself is done"; exit 2
fi
echo
echo "Done: build/release/dlz-installer-$VER.img and dlzmod-$VER.tar, the dev image in build/devcard"
