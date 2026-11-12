#!/bin/bash
# Run the mixer's web UI on this PC (Git Bash + Windows Node): Mackie's server.js from a private
# copy of /srv in dumps/sandbox, via shim.js (no shell commands, localhost only).
# shim.js takes the absolute paths in server.js (/srv, /root/.dlzlite, /tmp, /dev/disk/by-id) into the
# sandbox folder (DLZ_SANDBOX_ROOT): no drive letter, nothing extra in Explorer.
#
# Usage: dev/ui-sandbox.sh   then open http://127.0.0.1/: an XS / Full-size switch (which restarts
# the sandbox as the other model) above Mackie's page, which is http://127.0.0.1/index.html alone
# DLZ_FULLSIZE=1: the full-size DLZ Creator's UI (no /root/.dlzlite), in its own copy
# dumps/sandbox-full (first run: a copy of dumps/sandbox/srv). Each start patches the copy it runs with
# the mod of this checkout (install/patch.py, from the kept .orig).
# The shim serves index.html with #INT forced: the on-device layout (knob panel on the right)
# instead of the remote-control layout a browser normally gets. Screenshots: ui-sandbox/shot.js.
# First run copies /srv from the dump (WSL distro Ubuntu, install/mount-ro.sh). No DSP, no faders:
# the UI and the state/preset logic work, meters and audio do not.
set -euo pipefail

REPO=$(cd "$(dirname "$0")/.." && pwd)
SB=$REPO/dumps/sandbox

if [ ! -f "$SB/srv/server.js" ]; then
  mkdir -p "$SB"   # cp -r into a missing folder would make the folder itself the copy of srv
  WREPO=/mnt/${REPO:1:1}${REPO:2}
  MSYS_NO_PATHCONV=1 wsl -d Ubuntu -u root -e bash -c \
    "mountpoint -q /mnt/dlz || bash $WREPO/install/mount-ro.sh; cp -r /mnt/dlz/srv $WREPO/dumps/sandbox/"
fi
FULL=${DLZ_FULLSIZE:-}
# The dev page's model switch (http://127.0.0.1/, #277): the shim ends with code 75 and the
# loop starts the other model; any other end (Ctrl+C, sandbox.sh stop) ends this script too.
while :; do
  sb=$SB
  if [ "$FULL" = 1 ]; then
    # Git Bash's cp cannot make node_modules/.bin's symlinks (CLI helpers, not used by the server)
    [ -f "$SB-full/srv/server.js" ] || { mkdir -p "$SB-full" && cp -r "$SB/srv" "$SB-full/" 2>/dev/null || true; }
    [ -f "$SB-full/srv/server.js" ] || { echo "copy to $SB-full failed" >&2; exit 1; }
    sb=$SB-full
  fi
  mkdir -p "$sb/root" "$sb/tmp" "$sb/dev/disk/by-id"
  if [ "$FULL" = 1 ]; then rm -f "$sb/root/.dlzlite"; else touch "$sb/root/.dlzlite"; fi
  # Every start (a switch too) runs this branch's mod: patch.py patches from the kept .orig (made on
  # its first run), so both models' copies stay current and a failed patch stops the start
  python "$REPO/install/patch.py" app "$sb/srv/app.js" > /dev/null
  python "$REPO/install/patch.py" server "$sb/srv/server.js" > /dev/null
  echo "patched $sb with this branch's mod"
  # what was patched in, for the dev page (the shim cannot ask git: it blocks every program)
  export DLZ_SANDBOX_BRANCH DLZ_SANDBOX_COMMIT DLZ_SANDBOX_DIRTY
  DLZ_SANDBOX_BRANCH=$(git -C "$REPO" rev-parse --abbrev-ref HEAD 2>/dev/null || echo '?')
  DLZ_SANDBOX_COMMIT=$(git -C "$REPO" rev-parse --short HEAD 2>/dev/null || echo '?')
  DLZ_SANDBOX_DIRTY=
  [ -z "$(git -C "$REPO" status --porcelain -- install/app-mod install/server-mod install/patch.py 2>/dev/null)" ] || DLZ_SANDBOX_DIRTY=1

  cd "$sb/srv"
  echo "open http://127.0.0.1/ (Ctrl+C to stop)"
  code=0
  DLZ_SANDBOX_LOOP=1 DLZ_SANDBOX_ROOT=$(cygpath -w "$sb") \
    node -r "$(cygpath -w "$REPO/dev/ui-sandbox/shim.js")" server.js || code=$?
  [ "$code" = 75 ] || exit "$code"
  if [ "$FULL" = 1 ]; then FULL=; else FULL=1; fi
done
