#!/bin/bash
# Run a command in the build environment (buildenv/Dockerfile), with the repo at /src: the release
# build on the PC (build-release.sh, from WSL) and on GitHub (.github/workflows/release.yml) is the
# same image, so the same commit gives the same files (#158). The image is built once per Dockerfile
# (its tag is the Dockerfile's hash). As root in the container: mkpackage.sh makes a /dev/console node.
#
# Usage: [DLZMOD_SIGNING_KEYS=<folder>] buildenv.sh <command> [args]
# Passed in by name only (values stay out of the command line): RELEASE, RELEASE_KEY, UNSIGNED,
# DLZMOD_SIGNING_PASS. DLZMOD_SIGNING_KEYS is mounted read-only at /keys.
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
if [ -n "${DLZMOD_SIGNING_KEYS:-}" ]; then
  [ -d "$DLZMOD_SIGNING_KEYS" ] || { echo "DLZMOD_SIGNING_KEYS: no folder $DLZMOD_SIGNING_KEYS" >&2; exit 1; }
  args+=(-v "$(cd "$DLZMOD_SIGNING_KEYS" && pwd):/keys:ro" -e DLZMOD_SIGNING_KEYS=/keys)
fi
# a terminal for the passphrase prompt when there is one
[ -t 0 ] && [ -t 1 ] && args+=(-it)
exec docker run "${args[@]}" "$IMAGE" "$@"
