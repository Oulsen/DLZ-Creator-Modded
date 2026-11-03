#!/bin/bash
# One tap-to-screen capture on the mixer (dev/tapprobe.py) and its report. Git Bash, from the repo
# root. Nothing is written on the mixer. Usage: bash dev/tapprobe.sh <seconds> <capture.csv>
set -euo pipefail
secs=${1:?seconds}
out=${2:?capture file}
case $secs in ''|*[!0-9]*) echo "seconds: a number" >&2; exit 2 ;; esac
b64=$(base64 -w0 dev/tapprobe.py)
MSYS_NO_PATHCONV=1 DLZ_SSH_WRITE=1 WSLENV=DLZ_SSH_WRITE wsl -d Ubuntu -e bash .claude/skills/mixer-ssh/dlz-ssh.sh run \
  "python3 -c 'import base64,sys; sys.argv=[\"tapprobe\",\"probe\",\"$secs\"]; exec(compile(base64.b64decode(\"$b64\"),\"tapprobe\",\"exec\"))'" > "$out"
python dev/tapprobe.py report "$out"
