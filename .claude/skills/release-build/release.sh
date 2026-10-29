#!/bin/bash
# Release build helper (Git Bash on Windows, from the repo root). See SKILL.md.
#   release.sh build   check the tree is committed, then run the build here (build-release.sh in WSL),
#                      its output also in build/release-build.log, and check after it
#   release.sh open    the same build in a new PowerShell window (build-release.cmd)
#   release.sh check   is build/release's package + installer image from HEAD, clean and fresh, and
#                      still origin/develop's tip? and build/devcard's dev image of the same commit?
#   release.sh ready   right before main is moved (Releases, step 3): the build is origin/develop's
#                      tip and main can fast-forward to it
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

committed() {
  [ -z "$(git status --porcelain -- install VERSION)" ] && return 0
  echo "install/ or VERSION has uncommitted changes or new files: commit first (RELEASE=1 refuses +dirty)"
  git status --short -- install VERSION
  return 1
}

# the build's commit ($1) must still be origin/develop's tip: a merge into develop during the release
# would otherwise reach main untested (v0.3.0: #175 landed during the build)
at_develop() {
  git fetch -q origin || { echo "git fetch origin failed: cannot tell whether develop moved"; return 1; }
  local full dev
  full=$(git rev-parse --verify -q "$1^{commit}") || { echo "unknown commit $1"; return 1; }
  dev=$(git rev-parse origin/develop)
  [ "$full" = "$dev" ] && { echo "origin/develop is the build's commit"; return 0; }
  if git merge-base --is-ancestor "$full" "$dev"; then
    echo "DEVELOP MOVED: origin/develop (${dev:0:7}) is past the build ($1), merged since:"
    git log --oneline "$full..$dev" | sed 's/^/  /'
  else
    echo "NOT DEVELOP: origin/develop (${dev:0:7}) does not hold the build's commit $1"
  fi
  return 1
}

case ${1:-} in
build)
  committed || exit 1
  keys=${DLZMOD_KEYS_WIN:-$USERPROFILE/.dlzmod-keys}
  repo_wsl=$(wsl -d Ubuntu -e wslpath -a "$(cygpath -w "$REPO")" | tr -d '\r')
  keys_wsl=$(wsl -d Ubuntu -e wslpath -a "$(cygpath -w "$keys")" | tr -d '\r')
  [ -n "$repo_wsl" ] || { echo "WSL distro Ubuntu not found"; exit 1; }
  mkdir -p build
  log=build/release-build.log
  echo "release build $VER from $HEAD, its output also in $log" | tee "$log"
  MSYS_NO_PATHCONV=1 wsl -d Ubuntu -u root --cd "$repo_wsl" -e bash install/release/build-release.sh "$keys_wsl" 2>&1 | tee -a "$log"
  rc=${PIPESTATUS[0]}
  # 2: only the dev image failed, the release files are checked all the same
  case $rc in 0|2) ;; *) exit "$rc" ;; esac
  echo; echo "== check" | tee -a "$log"
  bash "$REPO/.claude/skills/release-build/release.sh" check 2>&1 | tee -a "$log"
  exit "${PIPESTATUS[0]}"
  ;;
open)
  committed || exit 1
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
  at_develop "$commit" || ok=0
  [ $ok = 1 ] && echo "OK: release build of $HEAD (next: device-review on this build, then flashing)" || exit 1
  ;;
ready)
  env="$REL/dlzmod-$VER/package.env"
  [ -f "$env" ] || { echo "no build here: $env (release.sh build)"; exit 1; }
  commit=$(sed -n 's/^COMMIT=//p' "$env" | tr -d '\r')
  case $commit in *+dirty) echo "DIRTY: this build is never released"; exit 1 ;; esac
  at_develop "$commit" || { echo "NOT READY: main stays where it is (back to step 1 with develop's tip)"; exit 1; }
  full=$(git rev-parse "$commit^{commit}")
  git merge-base --is-ancestor origin/main "$full" \
    || { echo "NOT READY: origin/main is not behind the build, no fast-forward"; exit 1; }
  echo "READY: main can move to the build's commit: git push origin $full:main"
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
  # the update file as ci-build.sh decides it, from this PC's package: a drop-in unless it reinstalls
  # below this very version; signed on a release tag, unsigned on a test tag
  below=$(sed -n 's/^REINSTALL_BELOW=//p' "$env" | tr -d '\r')
  ok=1
  files=("dlz-installer-$VER.img")
  if [ "$below" != "$VER" ]; then
    files+=("dlzmod-$VER.tar")
    [ -f "$t/dlzmod-$VER.tar" ] || { echo "MISSING: dlzmod-$VER.tar (this package is a drop-in)"; ok=0; }
    case $TAG in
      *-test*) [ ! -f "$t/dlzmod-$VER.tar.sig" ] || { echo "a test draft with a .sig"; ok=0; } ;;
      *) [ -f "$t/dlzmod-$VER.tar.sig" ] || { echo "MISSING: dlzmod-$VER.tar.sig"; ok=0; } ;;
    esac
  else
    [ ! -f "$t/dlzmod-$VER.tar" ] && [ ! -f "$t/dlzmod-$VER.tar.sig" ] \
      || { echo "the draft has the update file, but this package needs a new install"; ok=0; }
  fi
  for f in "${files[@]}"; do
    [ -f "$t/$f" ] || continue
    if cmp -s "$REL/$f" "$t/$f"; then echo "same bytes: $f"; else echo "DIFFERENT: $f (GitHub's build is not this PC's)"; ok=0; fi
  done
  if [ -f "$t/dlzmod-$VER.tar.sig" ]; then
    tr -d '\r' < install/keys/release.pub > "$t/pub.pem"
    if openssl pkeyutl -verify -pubin -inkey "$t/pub.pem" -rawin -in "$REL/dlzmod-$VER.tar" -sigfile "$t/dlzmod-$VER.tar.sig" >/dev/null; then
      echo "signature: verifies with install/keys/release.pub over this PC's tar"
    else
      echo "SIGNATURE DOES NOT VERIFY with install/keys/release.pub"; ok=0
    fi
  fi
  [ $ok = 1 ] || { echo "do not publish"; exit 1; }
  case $TAG in *-test*) echo "OK: draft $TAG is this PC's build of ${tagged:0:7}; a test: never publish, delete it (gh release delete $TAG --cleanup-tag)"; exit 0 ;; esac
  echo "OK: draft $TAG is this PC's build of ${tagged:0:7}; replace the notes' first line, edit the highlights (they go to Discord), then publish"
  ;;
*)
  sed -n '2,12p' "$0"; exit 1 ;;
esac
