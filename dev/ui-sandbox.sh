#!/bin/bash
# Run the mixer's web UI on this PC (Git Bash + Windows Node): Mackie's server.js from a private
# copy of /srv in dumps/sandbox, via shim.js (no shell commands, localhost only).
# The sandbox folder is mapped to its own drive letter, so the absolute paths in server.js
# (/srv, /root/.dlzlite, /tmp, /dev/disk/by-id) all resolve inside it.
#
# Usage: dev/ui-sandbox.sh [drive letter, default S]   then open http://127.0.0.1/
# DLZ_FULLSIZE=1: the full-size DLZ Creator's UI (no /root/.dlzlite), in its own copy
# dumps/sandbox-full (first run: a copy of dumps/sandbox/srv, mod patches included)
# The shim serves index.html with #INT forced: the on-device layout (knob panel on the right)
# instead of the remote-control layout a browser normally gets. Screenshots: ui-sandbox/shot.js.
# First run copies /srv from the dump (WSL distro Ubuntu, install/mount-ro.sh). No DSP, no faders:
# the UI and the state/preset logic work, meters and audio do not.
set -euo pipefail

REPO=$(cd "$(dirname "$0")/.." && pwd)
SB=$REPO/dumps/sandbox
DRIVE=${1:-S}

if [ ! -f "$SB/srv/server.js" ]; then
  mkdir -p "$SB"   # cp -r into a missing folder would make the folder itself the copy of srv
  WREPO=/mnt/${REPO:1:1}${REPO:2}
  MSYS_NO_PATHCONV=1 wsl -d Ubuntu -u root -e bash -c \
    "mountpoint -q /mnt/dlz || bash $WREPO/install/mount-ro.sh; cp -r /mnt/dlz/srv $WREPO/dumps/sandbox/"
fi
if [ "${DLZ_FULLSIZE:-}" = 1 ]; then
  # Git Bash's cp cannot make node_modules/.bin's symlinks (CLI helpers, not used by the server)
  [ -f "$SB-full/srv/server.js" ] || { mkdir -p "$SB-full" && cp -r "$SB/srv" "$SB-full/" 2>/dev/null || true; }
  [ -f "$SB-full/srv/server.js" ] || { echo "copy to $SB-full failed" >&2; exit 1; }
  SB=$SB-full
fi
mkdir -p "$SB/root" "$SB/tmp" "$SB/dev/disk/by-id"
if [ "${DLZ_FULLSIZE:-}" = 1 ]; then rm -f "$SB/root/.dlzlite"; else touch "$SB/root/.dlzlite"; fi

if [ -e "/${DRIVE,,}" ] || subst | grep -qi "^$DRIVE:"; then
  echo "drive $DRIVE: is already in use, pass another letter" >&2
  exit 1
fi
subst "$DRIVE:" "$(cygpath -w "$SB")"
trap 'subst "$DRIVE:" //D' EXIT

cd "/${DRIVE,,}/srv"
echo "open http://127.0.0.1/ (Ctrl+C to stop)"
node -r "$(cygpath -w "$REPO/dev/ui-sandbox/shim.js")" server.js
