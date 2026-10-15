#!/bin/bash
# Release build helper (Git Bash on Windows, from the repo root). See SKILL.md.
#   release.sh open    check the tree is committed, then open build-release.cmd in a new pwsh window
#   release.sh check   is build/release's package + installer image from HEAD, clean, signed, fresh?
set -u
REPO=$(git rev-parse --show-toplevel) || exit 1
cd "$REPO" || exit 1
VER=$(tr -d '\r\n' < VERSION)
REL=build/release
HEAD=$(git rev-parse --short HEAD)

case ${1:-} in
open)
  if [ -n "$(git status --porcelain -- install VERSION)" ]; then
    echo "install/ or VERSION has uncommitted changes or new files: commit first (RELEASE=1 refuses +dirty)"
    git status --short -- install VERSION
    exit 1
  fi
  win=$(cygpath -w "$REPO/install/release/build-release.cmd")
  cmd.exe //c start "DLZ release build" pwsh -NoExit -Command "& '$win'"
  echo "opened: release build $VER from $HEAD in a new PowerShell window (the user types the passphrase there)"
  ;;
check)
  ok=1
  env="$REL/dlzmod-$VER/package.env"
  img="$REL/dlz-installer-$VER.img"
  for f in "$env" "$REL/dlzmod-$VER.tar" "$REL/dlzmod-$VER.tar.sig" "$img"; do
    [ -f "$f" ] || { echo "missing: $f"; ok=0; }
  done
  [ $ok = 1 ] || exit 1
  commit=$(sed -n 's/^COMMIT=//p' "$env" | tr -d '\r')
  echo "version $VER, package commit $commit, HEAD $HEAD"
  case $commit in *+dirty) echo "DIRTY: never onto the mixer"; ok=0 ;; esac
  [ "$commit" = "$HEAD" ] || { echo "STALE: the package is not from HEAD"; ok=0; }
  ct=$(git log -1 --format=%ct HEAD)
  for f in "$REL/dlzmod-$VER.tar" "$REL/dlzmod-$VER.tar.sig" "$img"; do
    [ "$(stat -c %Y "$f")" -ge "$ct" ] || { echo "OLDER than the HEAD commit: $f"; ok=0; }
  done
  [ "$img" -nt "$REL/dlzmod-$VER.tar" ] || { echo "the image is older than the package"; ok=0; }
  ls -l --time-style=+%H:%M "$REL/dlzmod-$VER.tar" "$REL/dlzmod-$VER.tar.sig" "$img" | awk '{print "  " $6 "  " $5 "  " $7}'
  [ $ok = 1 ] && echo "OK: release build of $HEAD (next: device-review on this build, then flashing)" || exit 1
  ;;
*)
  sed -n '2,4p' "$0"; exit 1 ;;
esac
