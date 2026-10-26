#!/bin/bash
# Release build helper (Git Bash on Windows, from the repo root). See SKILL.md.
#   release.sh open    check the tree is committed, then open build-release.cmd in a new PowerShell window
#   release.sh check   is build/release's package + installer image from HEAD, clean and fresh?
#                      and build/devcard's dev image of the same commit?
#   release.sh compare <tag>
#                      after the tag's workflow attached its build to the draft (#158): the draft's
#                      files are this PC's build byte for byte, their SHA256SUMS fit, and the
#                      signature (release tags) verifies with install/keys/release.pub over our tar
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
  ps=pwsh; command -v pwsh > /dev/null || ps=powershell   # PowerShell 7 if installed, else Windows PowerShell
  cmd.exe //c start "DLZ release build" $ps -NoExit -Command "& '$win'" || exit 1
  echo "opened: release build $VER from $HEAD in a new PowerShell window (unsigned: GitHub signs at the tag)"
  ;;
check)
  ok=1
  env="$REL/dlzmod-$VER/package.env"
  img="$REL/dlz-installer-$VER.img"
  for f in "$env" "$REL/dlzmod-$VER.tar" "$img"; do
    [ -f "$f" ] || { echo "missing: $f"; ok=0; }
  done
  [ $ok = 1 ] || exit 1
  commit=$(sed -n 's/^COMMIT=//p' "$env" | tr -d '\r')
  echo "version $VER, package commit $commit, HEAD $HEAD"
  case $commit in *+dirty) echo "DIRTY: never onto the mixer"; ok=0 ;; esac
  [ "$commit" = "$HEAD" ] || { echo "STALE: the package is not from HEAD"; ok=0; }
  ct=$(git log -1 --format=%ct HEAD)
  for f in "$REL/dlzmod-$VER.tar" "$img"; do
    [ "$(stat -c %Y "$f")" -ge "$ct" ] || { echo "OLDER than the HEAD commit: $f"; ok=0; }
  done
  [ "$img" -nt "$REL/dlzmod-$VER.tar" ] || { echo "the image is older than the package"; ok=0; }
  ls -l --time-style=+%H:%M "$REL/dlzmod-$VER.tar" "$img" | awk '{print "  " $6 "  " $5 "  " $7}'
  # the dev image of the same commit, for a new dev card (not a release file: it stays on the PC)
  dev=build/devcard/dlz-installer-$VER-dev-$commit.img
  if [ -f "$dev" ] && [ "$(stat -c %Y "$dev")" -ge "$ct" ]; then echo "  dev image: $dev"
  else echo "  note: no dev image of $commit in build/devcard (the build's last step failed?); the release files are not affected"; fi
  [ $ok = 1 ] && echo "OK: release build of $HEAD (next: device-review on this build, then flashing)" || exit 1
  ;;
compare)
  TAG=${2:?usage: release.sh compare <tag>}
  [ "${TAG%%-test*}" = "$VER" ] || { echo "the tag $TAG is not VERSION ($VER)"; exit 1; }
  env="$REL/dlzmod-$VER/package.env"
  [ -f "$env" ] || { echo "no build here: $env (release.sh open)"; exit 1; }
  commit=$(sed -n 's/^COMMIT=//p' "$env" | tr -d '\r')
  tagged=$(git rev-parse --verify -q "$TAG^{commit}") || { echo "no tag $TAG here: git fetch --tags"; exit 1; }
  [ "$(git rev-parse --verify -q "$commit^{commit}" 2>/dev/null)" = "$tagged" ] \
    || { echo "this build is of $commit, the tag $TAG of ${tagged:0:7}: build the tagged commit"; exit 1; }
  [ "$(gh release view "$TAG" --json isDraft --jq .isDraft 2>/dev/null)" = true ] \
    || { echo "no draft release $TAG (the tag's workflow makes it; a published release is never checked from here)"; exit 1; }
  t=$(mktemp -d); trap 'rm -rf "$t"' EXIT
  gh release download "$TAG" --dir "$t" || exit 1
  [ -f "$t/SHA256SUMS" ] || { echo "the draft has no SHA256SUMS: has its build job finished? (gh run list --workflow release.yml)"; exit 1; }
  (cd "$t" && sha256sum -c SHA256SUMS) || { echo "CHECKSUMS DO NOT MATCH: do not publish"; exit 1; }
  # exactly the files SHA256SUMS names, and the image always
  want=$( (sed 's/^[0-9a-f]*  //' "$t/SHA256SUMS"; echo SHA256SUMS) | sort); have=$(ls "$t" | sort)
  [ "$want" = "$have" ] || { echo "the draft holds other files than SHA256SUMS names:"; echo "$have"; exit 1; }
  grep -q "  dlz-installer-$VER.img\$" "$t/SHA256SUMS" || { echo "the draft has no installer image"; exit 1; }
  ok=1
  for f in "dlz-installer-$VER.img" "dlzmod-$VER.tar"; do
    [ -f "$t/$f" ] || continue
    cmp -s "$REL/$f" "$t/$f" && echo "same bytes: $f" || { echo "DIFFERENT: $f (GitHub's build is not this PC's)"; ok=0; }
  done
  if [ -f "$t/dlzmod-$VER.tar.sig" ]; then
    tr -d '\r' < install/keys/release.pub > "$t/pub.pem"
    openssl pkeyutl -verify -pubin -inkey "$t/pub.pem" -rawin -in "$REL/dlzmod-$VER.tar" -sigfile "$t/dlzmod-$VER.tar.sig" >/dev/null \
      && echo "signature: verifies with install/keys/release.pub over this PC's tar" \
      || { echo "SIGNATURE DOES NOT VERIFY with install/keys/release.pub"; ok=0; }
  else
    case $TAG in
      *-test*) ;;
      *) grep -q "dlzmod-$VER.tar" "$t/SHA256SUMS" && { echo "the draft has the update file but no .sig"; ok=0; } ;;
    esac
  fi
  [ $ok = 1 ] || { echo "do not publish"; exit 1; }
  case $TAG in *-test*) echo "OK: draft $TAG is this PC's build of ${tagged:0:7}; a test: never publish, delete it (gh release delete $TAG --cleanup-tag)"; exit 0 ;; esac
  echo "OK: draft $TAG is this PC's build of ${tagged:0:7}; replace the notes' first line, edit the highlights (they go to Discord), then publish"
  ;;
*)
  sed -n '2,9p' "$0"; exit 1 ;;
esac
