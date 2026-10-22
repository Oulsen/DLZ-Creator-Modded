#!/bin/bash
# Release build helper (Git Bash on Windows, from the repo root). See SKILL.md.
#   release.sh open    check the tree is committed, then open build-release.cmd in a new pwsh window
#   release.sh check   is build/release's package + installer image from HEAD, clean, signed, fresh?
#                      and build/devcard's dev image of the same commit?
#   release.sh upload <tag> [--with-update]
#                      attach the tested files to the tag's draft release (made by the tag's workflow):
#                      the installer image (and the update .tar + .sig with --with-update) with a
#                      SHA256SUMS, then download them again and check them
set -u
REPO=$(git rev-parse --show-toplevel) || exit 1
cd "$REPO" || exit 1
VER=$(tr -d '\r\n' < VERSION)
REL=${DLZ_RELEASE_DIR:-build/release}
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
  # the dev image of the same commit, for a new dev card (not a release file: it stays on the PC)
  dev=build/devcard/dlz-installer-$VER-dev-$commit.img
  if [ -f "$dev" ] && [ "$(stat -c %Y "$dev")" -ge "$ct" ]; then echo "  dev image: $dev"
  else echo "no dev image of $commit in build/devcard (the build's last step failed?)"; ok=0; fi
  [ $ok = 1 ] && echo "OK: release build of $HEAD (next: device-review on this build, then flashing)" || exit 1
  ;;
upload)
  TAG=${2:?usage: release.sh upload <tag> [--with-update]}
  [ "${TAG%%-test*}" = "$VER" ] || { echo "the tag $TAG is not VERSION ($VER)"; exit 1; }
  files=("dlz-installer-$VER.img")
  [ "${3:-}" = --with-update ] && files+=("dlzmod-$VER.tar" "dlzmod-$VER.tar.sig")
  for f in "${files[@]}"; do [ -f "$REL/$f" ] || { echo "missing: $REL/$f"; exit 1; }; done
  # the files must be the build of the tagged commit (as check says), and the release a draft
  commit=$(sed -n 's/^COMMIT=//p' "$REL/dlzmod-$VER/package.env" | tr -d '\r')
  tagged=$(git rev-parse --short "$TAG^{commit}" 2>/dev/null) || { echo "no tag $TAG here: git fetch --tags"; exit 1; }
  [ "$commit" = "$tagged" ] || { echo "the build is of $commit, the tag $TAG of $tagged: build the tagged commit"; exit 1; }
  [ "$(gh release view "$TAG" --json isDraft --jq .isDraft 2>/dev/null)" = true ] \
    || { echo "no draft release $TAG (the tag's workflow makes it; a published release is never changed from here)"; exit 1; }
  (cd "$REL" && sha256sum "${files[@]}" > SHA256SUMS) || exit 1
  gh release upload "$TAG" --clobber "${files[@]/#/$REL/}" "$REL/SHA256SUMS" || exit 1
  # what GitHub now holds: exactly these files, and their checksums right
  t=$(mktemp -d); trap 'rm -rf "$t"' EXIT
  gh release download "$TAG" --dir "$t" || exit 1
  want=$(printf '%s\n' "${files[@]}" SHA256SUMS | sort); have=$(ls "$t" | sort)
  [ "$want" = "$have" ] || { echo "the draft holds other files than these:"; echo "$have"; exit 1; }
  (cd "$t" && sha256sum -c SHA256SUMS) || { echo "CHECKSUMS DO NOT MATCH: do not publish"; exit 1; }
  echo "OK: draft $TAG has ${files[*]} and SHA256SUMS, checked after download; replace the notes' first line, then publish"
  ;;
*)
  sed -n '2,9p' "$0"; exit 1 ;;
esac
