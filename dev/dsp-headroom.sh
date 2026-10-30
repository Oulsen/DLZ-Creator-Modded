#!/bin/bash
# The audio headroom on a dev card (#5, Q19), from the PC (Git Bash): runs a measuring copy of
# dspserver (dev/dsp-headroom.py) and reads how much of each audio block its thread spends waiting.
# Dev card only, never shipped. Nothing is written to the card: the copy lives on a tmpfs of its own,
# bind-mounted over /usr/local/bin/dspserver (same path, same unit), so a restart of the mixer, or
# `off`, brings the stock dspserver back. Each `on` and `off` restarts dspserver: the audio stops for
# a few seconds.
#
# Usage: bash dev/dsp-headroom.sh on              patch, mount, restart dspserver, check it counts
#        bash dev/dsp-headroom.sh read [SECONDS]  two readings SECONDS apart (default 10)
#        bash dev/dsp-headroom.sh off             the stock dspserver again (or switch the mixer off and on)
#
# Settings: MIXER_HOST and SSH_KEY in dev/push.env, as for dev/push.sh.
set -euo pipefail

REPO=$(cd "$(dirname "$0")/.." && pwd)
CONF=$REPO/dev/push.env
KNOWN=$HOME/.config/dlzmod-push/known_hosts

die() { echo "dsp-headroom: $*" >&2; exit 1; }
conf() { [ -f "$CONF" ] && sed -n "s/^$1=//p" "$CONF" | tail -n 1 | tr -d '\r' || true; }

[ -f "$CONF" ] || die "no dev/push.env: copy dev/push.env.example and fill in the mixer's address"
HOST=$(conf MIXER_HOST)
printf '%s' "$HOST" | grep -Eq '^[A-Za-z0-9][A-Za-z0-9.:-]*$' || die "MIXER_HOST in dev/push.env is not an address or host name"
KEY=$(conf SSH_KEY); KEY=${KEY/#\~/$HOME}
mkdir -p "$(dirname "$KNOWN")"
SSHOPTS=(-o BatchMode=yes -o ConnectTimeout=10 -o ServerAliveInterval=5 -o ServerAliveCountMax=3
  -o StrictHostKeyChecking=accept-new -o "UserKnownHostsFile=$KNOWN")
if [ -n "$KEY" ]; then
  [ -f "$KEY" ] || die "SSH_KEY $KEY not found"
  SSHOPTS+=(-o IdentitiesOnly=yes -i "$KEY")
fi
mixer() { ssh "${SSHOPTS[@]}" "root@$HOST" "$@"; }
# the script to the mixer's /run (RAM) before each command: after a restart it is gone
put() { mixer 'cat > /run/dlzmod-headroom.py' < "$REPO/dev/dsp-headroom.py"; }

ON='set -eu
D=/run/dlzmod-headroom B=/usr/local/bin/dspserver
if grep -q " $B " /proc/self/mountinfo; then echo "already on"; exit 0; fi
# the stub reads the CPU counter from user space: only allowed when the kernel runs the arch timer
grep -qw arch_sys_counter /sys/devices/system/clocksource/clocksource0/available_clocksource \
  || { echo "no arch_sys_counter clocksource: the counter may trap, not patching"; exit 1; }
mkdir -p $D
grep -q " $D " /proc/self/mountinfo || mount -t tmpfs -o size=8m,mode=0700 dlzmod-headroom $D
python3 /run/dlzmod-headroom.py patch $B $D/dspserver
mount --bind $D/dspserver $B
systemctl restart dspserver'

# the running copy is busy: a lazy unmount, then the restart starts the stock file
OFF='D=/run/dlzmod-headroom B=/usr/local/bin/dspserver
grep -q " $B " /proc/self/mountinfo && umount -l $B
systemctl restart dspserver
grep -q " $D " /proc/self/mountinfo && umount -l $D
rm -f /run/dlzmod-headroom.py
echo "stock dspserver: $(systemctl is-active dspserver)"'

case ${1:-} in
  on)
    put
    mixer "$ON" || die "not switched on"
    echo "waiting 20 s for dspserver to start"
    sleep 20
    if ! mixer 'python3 /run/dlzmod-headroom.py read 5'; then
      echo "the measuring dspserver does not count: back to the stock one" >&2
      mixer "$OFF"
      exit 1
    fi ;;
  read)
    s=${2:-10}
    [[ $s =~ ^[0-9]+$ ]] && [ "$s" -ge 1 ] && [ "$s" -le 600 ] || die "SECONDS: 1 to 600"
    put
    mixer "python3 /run/dlzmod-headroom.py read $s" ;;
  off)
    mixer "$OFF" ;;
  *)
    sed -n 's/^# Usage: /  /p; s/^#        /  /p' "$0"; exit 2 ;;
esac
