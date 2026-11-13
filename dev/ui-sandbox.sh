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
#        dev/ui-sandbox.sh patch <sandbox folder>   only that patch (sandbox.sh repatch)
# The shim serves index.html with #INT forced: the on-device layout (knob panel on the right)
# instead of the remote-control layout a browser normally gets. Screenshots: ui-sandbox/shot.js.
# First run copies /srv from the dump (WSL distro Ubuntu, install/mount-ro.sh). No DSP, no faders:
# the UI and the state/preset logic work, meters and audio do not.
set -euo pipefail

REPO=$(cd "$(dirname "$0")/.." && pwd)
SB=$REPO/dumps/sandbox
# sandbox.sh stop sets it: a model switch under way (no node.exe on 80/89 for a moment) ends here too.
# Only a fresh one counts: a stop with no sandbox running leaves it behind, and a later switch (this
# session's or another's) must not end on that (#285); a switch takes seconds, a stop waits 4 s
STOP=/tmp/dlz-sandbox.stop
stop_now() {   # true (and the flag gone) when a stop came during the last minute; a stale flag is removed
  [ -e "$STOP" ] || return 1
  local age=$(( $(date +%s) - $(stat -c %Y "$STOP" 2>/dev/null || echo 0) ))
  rm -f "$STOP"
  [ "$age" -lt 60 ]
}

# The mod of this checkout onto a sandbox copy: patch.py patches from the kept .orig (made on its first
# run), so it can run any number of times and a failed patch stops a start. Then what was patched in,
# for the dev page (dlzmod-sandbox.json in the folder: the shim cannot ask git, it blocks every program).
patch_copy() {
  local sb=$1 branch commit dirty=false
  python "$REPO/install/patch.py" app "$sb/srv/app.js" > /dev/null
  python "$REPO/install/patch.py" server "$sb/srv/server.js" > /dev/null
  branch=$(git -C "$REPO" rev-parse --abbrev-ref HEAD 2>/dev/null || echo '?')
  commit=$(git -C "$REPO" rev-parse --short HEAD 2>/dev/null || echo '?')
  [ -z "$(git -C "$REPO" status --porcelain -- install/app-mod install/server-mod install/patch.py 2>/dev/null)" ] || dirty=true
  printf '{"branch":"%s","commit":"%s","dirty":%s,"patched":"%s"}\n' \
    "$branch" "$commit" "$dirty" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$sb/dlzmod-sandbox.json"
  echo "patched $sb with the mod of $branch @ $commit$([ $dirty = true ] && echo ' + uncommitted changes')"
}
if [ "${1:-}" = patch ]; then
  [ -f "${2:-}/srv/app.js" ] || { echo "no sandbox copy in ${2:-?}" >&2; exit 1; }
  patch_copy "$2"
  exit 0
fi

if [ ! -f "$SB/srv/server.js" ]; then
  mkdir -p "$SB"   # cp -r into a missing folder would make the folder itself the copy of srv
  WREPO=/mnt/${REPO:1:1}${REPO:2}
  MSYS_NO_PATHCONV=1 wsl -d Ubuntu -u root -e bash -c \
    "mountpoint -q /mnt/dlz || bash $WREPO/install/mount-ro.sh; cp -r /mnt/dlz/srv $WREPO/dumps/sandbox/"
fi
rm -f "$STOP"
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
  patch_copy "$sb"
  stop_now && { echo "stopped during a model switch"; exit 0; }

  cd "$sb/srv"
  echo "open http://127.0.0.1/ (Ctrl+C to stop)"
  code=0
  DLZ_SANDBOX_LOOP=1 DLZ_SANDBOX_ROOT=$(cygpath -w "$sb") \
    node -r "$(cygpath -w "$REPO/dev/ui-sandbox/shim.js")" server.js || code=$?
  [ "$code" = 75 ] || exit "$code"
  if [ "$FULL" = 1 ]; then FULL=; else FULL=1; fi
done
