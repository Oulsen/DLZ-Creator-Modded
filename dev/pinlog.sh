#!/bin/bash
# Put the codec pin log (dev/pinlog.py, #261) on the dev card or take it off (Git Bash). Once on, it
# runs at every start for its first 120 s and writes to the journal, which the network log
# (dev/netlog.sh) carries to the PC. Dev card only: it never goes into the mod or an installer.
# Writes /usr/local/sbin/dlzdev-pinlog and /etc/systemd/system/dlzdev-pinlog.service over SSH, each
# whole (temp, sync, rename); off removes both. Settings in dev/push.env, as for push.sh.
#
# Usage: bash dev/pinlog.sh on       (from the next start; also one reading now, as a check)
#        bash dev/pinlog.sh off
#        bash dev/pinlog.sh status
set -euo pipefail

REPO=$(cd "$(dirname "$0")/.." && pwd)
CONF=$REPO/dev/push.env
KNOWN=$HOME/.config/dlzmod-push/known_hosts

die() { echo "pinlog: $*" >&2; exit 1; }
conf() { [ -f "$CONF" ] && sed -n "s/^$1=//p" "$CONF" | tail -n 1 | tr -d '\r' || true; }

[ -f "$CONF" ] || die "no dev/push.env: copy dev/push.env.example and fill in the mixer's address"
HOST=$(conf MIXER_HOST)
printf '%s' "$HOST" | grep -Eq '^[A-Za-z0-9][A-Za-z0-9.:-]*$' || die "MIXER_HOST in dev/push.env is not an address or host name"
KEY=$(conf SSH_KEY); KEY=${KEY/#\~/$HOME}
mkdir -p "$(dirname "$KNOWN")"
SSHOPTS=(-o BatchMode=yes -o ConnectTimeout=10 -o StrictHostKeyChecking=accept-new -o "UserKnownHostsFile=$KNOWN")
if [ -n "$KEY" ]; then
  [ -f "$KEY" ] || die "SSH_KEY $KEY not found"
  SSHOPTS+=(-o IdentitiesOnly=yes -i "$KEY")
fi
mixer() { ssh "${SSHOPTS[@]}" "root@$HOST" "$@"; }

BIN=/usr/local/sbin/dlzdev-pinlog
UNIT=/etc/systemd/system/dlzdev-pinlog.service

unit() {
  cat <<'EOF'
[Unit]
Description=dlzdev: log the audio chips' pins during a start (dev card only, #261)
# early and on its own: nothing is ordered after it, so it delays no other unit
DefaultDependencies=no
After=systemd-journald.socket local-fs.target
Conflicts=shutdown.target
Before=shutdown.target

[Service]
Type=exec
ExecStart=/usr/bin/python3 /usr/local/sbin/dlzdev-pinlog
Nice=5
# never on dspserver's core 3
CPUAffinity=0 1 2

[Install]
WantedBy=sysinit.target
EOF
}

# Only ever on a system started from the microSD card: refuses when / is not on an SD card (the
# eMMC reports MMC), so it can never write the mixer's internal memory
CARD_ONLY='src=$(findmnt -no SOURCE /); d=${src#/dev/}; d=${d%p[0-9]*}
  [ "$(cat /sys/block/$d/device/type 2> /dev/null)" = SD ] || { echo "pinlog: / is $src, not on the SD card; nothing written" >&2; exit 3; }'

case ${1:-} in
  on)
    b64bin=$(base64 -w0 "$REPO/dev/pinlog.py")
    b64unit=$(unit | base64 -w0)
    mixer "set -e
      $CARD_ONLY
      echo $b64bin | base64 -d > $BIN.new; chmod 755 $BIN.new; sync $BIN.new; mv -f $BIN.new $BIN
      echo $b64unit | base64 -d > $UNIT.new; sync $UNIT.new; mv -f $UNIT.new $UNIT
      sync /usr/local/sbin /etc/systemd/system
      systemctl daemon-reload; systemctl enable --quiet dlzdev-pinlog.service
      sync /etc/systemd/system/sysinit.target.wants
      python3 $BIN --once || { echo 'pinlog: installed and enabled, but the check reading failed (above)' >&2; exit 4; }" \
      || { [ $? -eq 4 ] && exit 4; exit 1; }
    echo "pinlog: on, from the next start (the line above is one reading now)"
    ;;
  off)
    mixer "set -e; $CARD_ONLY
      systemctl disable dlzdev-pinlog.service 2> /dev/null || true; systemctl stop dlzdev-pinlog.service 2> /dev/null || true
      rm -f $UNIT $BIN; sync /usr/local/sbin /etc/systemd/system /etc/systemd/system/sysinit.target.wants; systemctl daemon-reload"
    echo "pinlog: off"
    ;;
  status)
    mixer "systemctl is-enabled dlzdev-pinlog.service 2> /dev/null || true; journalctl -b --no-pager -u dlzdev-pinlog.service --lines=5 -o cat || true"
    ;;
  *) die "usage: bash dev/pinlog.sh on | off | status" ;;
esac
