#!/bin/bash
# Run a command in the build environment (buildenv/Dockerfile), with the repo at /src: the release
# build on the PC (build-release.sh, from WSL) and on GitHub (.github/workflows/release.yml) is the
# same image, so the same commit gives the same files (#158). The image is built once per Dockerfile
# (its tag is the Dockerfile's hash). As root in the container: mkpackage.sh makes a /dev/console node.
#
# Usage: [DLZMOD_SIGNING_KEYS=<folder>] buildenv.sh <command> [args]
# Passed in by name only (values stay out of the command line): RELEASE, RELEASE_KEY, UNSIGNED,
# DLZMOD_SIGNING_PASS. DLZMOD_SIGNING_KEYS is mounted read-only at /keys.
# From a git worktree (#308): GIT_DIR must name its git folder (<repo>/.git/worktrees/<name>) as a
# path here (release.sh build sets it); the main repo's git folder is mounted read-only at /git.
set -euo pipefail

REPO=$(cd "$(dirname "$0")/../.." && pwd)
DIR=$REPO/install/release/buildenv
[ $# -gt 0 ] || { sed -n '/^# Usage:/,/^set /{/^set /d;s/^# \{0,1\}//;p}' "$0"; exit 1; }
command -v docker >/dev/null || { echo "no docker: start Docker Desktop (WSL integration for this distro)" >&2; exit 1; }
docker info >/dev/null 2>&1 || { echo "docker does not answer: start Docker Desktop and wait until it runs" >&2; exit 1; }

IMAGE=dlzmod-buildenv:$(sha256sum "$DIR/Dockerfile" | cut -c1-16)
# the image's first build takes minutes: its steps are shown (on stderr, apart from the command's output)
if ! docker image inspect "$IMAGE" >/dev/null 2>&1; then
  echo "building the build environment $IMAGE (once per Dockerfile, a few minutes)" >&2
  docker build --progress=plain -t "$IMAGE" "$DIR" >&2
fi

args=(--rm -v "$REPO:/src" -w /src)
for v in RELEASE RELEASE_KEY UNSIGNED DLZMOD_SIGNING_PASS; do args+=(-e "$v"); done
# a worktree's .git file names its git folder by a Windows path, which no Linux git can follow: the
# main repo's git folder goes in read-only (the build only reads git), the worktree's own by name
if [ -f "$REPO/.git" ]; then
  gd=${GIT_DIR:-}
  [ -n "$gd" ] && [ -f "$gd/commondir" ] && [ "$(basename "$(dirname "$gd")")" = worktrees ] \
    || { echo "a git worktree: GIT_DIR must be its git folder (<repo>/.git/worktrees/<name>) as a path here (release.sh build sets it)" >&2; exit 1; }
  common=$(cd "$gd/$(tr -d '\r\n' < "$gd/commondir")" && pwd) || exit 1
  [ "$(cd "$common/worktrees/$(basename "$gd")" && pwd)" = "$(cd "$gd" && pwd)" ] \
    || { echo "GIT_DIR $gd is not in its repo's worktrees folder" >&2; exit 1; }
  args+=(-v "$common:/git:ro" -e "GIT_DIR=/git/worktrees/$(basename "$gd")" -e GIT_WORK_TREE=/src)
fi
if [ -n "${DLZMOD_SIGNING_KEYS:-}" ]; then
  [ -d "$DLZMOD_SIGNING_KEYS" ] || { echo "DLZMOD_SIGNING_KEYS: no folder $DLZMOD_SIGNING_KEYS" >&2; exit 1; }
  args+=(-v "$(cd "$DLZMOD_SIGNING_KEYS" && pwd):/keys:ro" -e DLZMOD_SIGNING_KEYS=/keys)
fi
# a terminal for the passphrase prompt when there is one
[ -t 0 ] && [ -t 1 ] && args+=(-it)
exec docker run "${args[@]}" "$IMAGE" "$@"
