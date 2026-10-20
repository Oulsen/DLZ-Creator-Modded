#!/bin/bash
# Turn the network log of a dev card on or off (Git Bash): from the next start (and at once, for this
# one) the card sends its journal line by line to this PC (install/sd-system/dlzmod-netlog), where
# dev/netlog.ps1 writes it into build/device-logs/. For starts that hang before their log reaches the
# card (#81). Writes or removes the card's /var/lib/dlzmod/netlog over SSH; the PC's address is the
# one the card sees for this SSH login. Settings in dev/push.env, as for push.sh.
#
# Usage: bash dev/netlog.sh on [port]   (default 5140)
#        bash dev/netlog.sh off
#        bash dev/netlog.sh status
set -euo pipefail

REPO=$(cd "$(dirname "$0")/.." && pwd)
CONF=$REPO/dev/push.env
KNOWN=$HOME/.config/dlzmod-push/known_hosts

die() { echo "netlog: $*" >&2; exit 1; }
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

case ${1:-} in
  on)
    PORT=${2:-5140}
    [[ $PORT =~ ^[0-9]{1,5}$ ]] && [ "$PORT" -ge 1 ] && [ "$PORT" -le 65535 ] || die "port $PORT: 1-65535"
    # SSH_CLIENT: this PC's address as the card sees it, only an IPv4 one (dlzmod-netlog takes no
    # other); the file written whole (temp, sync, rename)
    mixer "set -e; set -- \$SSH_CLIENT; case \$1 in ''|*[!0-9.]*) echo \"noipv4 \$1\"; exit 0 ;; esac;
      mkdir -p /var/lib/dlzmod; echo \"\$1 $PORT\" > /var/lib/dlzmod/netlog.new;
      sync /var/lib/dlzmod/netlog.new; mv -f /var/lib/dlzmod/netlog.new /var/lib/dlzmod/netlog; sync /var/lib/dlzmod;
      systemctl restart dlzmod-netlog.service > /dev/null 2>&1 && echo now || echo next; cat /var/lib/dlzmod/netlog" \
      | { read -r when addr
          [ "$when" != noipv4 ] || die "the card sees this PC as '$addr', not an IPv4 address; set MIXER_HOST in dev/push.env to the mixer's IPv4 address. Nothing written"
          read -r ip port
          [ -n "${ip:-}" ] || die "the card did not take it"
          [ "$when" = now ] && when="from now on and" || when="from the next start (the unit is not loaded yet) and"
          echo "netlog: on, the card sends to $ip:$port $when at every start"; }
    echo "netlog: listen with: powershell -ExecutionPolicy Bypass -File dev/netlog.ps1 -Port $PORT"
    ;;
  off)
    mixer "systemctl stop dlzmod-netlog.service; rm -f /var/lib/dlzmod/netlog; sync /var/lib/dlzmod"
    echo "netlog: off"
    ;;
  status)
    mixer "cat /var/lib/dlzmod/netlog 2> /dev/null || echo off; systemctl is-active dlzmod-netlog.service || true"
    ;;
  *) die "usage: bash dev/netlog.sh on [port] | off | status" ;;
esac
