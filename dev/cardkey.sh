#!/bin/bash
# Put your SSH key on a newly installed dev card (Git Bash), once after every install from a dev
# installer image: the image carries no SSH key (only build-sd.sh cards get one), and each install
# makes new host keys, which push.sh, netlog.sh and plain ssh then refuse as changed. This forgets the
# old card's host key (~/.ssh/known_hosts and push.sh's own list), shows the new one, asks once for the
# SSH password set on the mixer's screen (Settings, DLZ Creator Modded, Network: SSH on) and adds the
# .pub of SSH_KEY to the card's /root/.ssh/authorized_keys (not twice), then checks a key login.
# Settings in dev/push.env, as for push.sh. The mixer-ssh skill keeps its own list: dlz-ssh.sh forget.
#
# Usage: bash dev/cardkey.sh
set -euo pipefail

REPO=$(cd "$(dirname "$0")/.." && pwd)
CONF=$REPO/dev/push.env
KNOWN=$HOME/.config/dlzmod-push/known_hosts

die() { echo "cardkey: $*" >&2; exit 1; }
conf() { [ -f "$CONF" ] && sed -n "s/^$1=//p" "$CONF" | tail -n 1 | tr -d '\r' || true; }

[ -f "$CONF" ] || die "no dev/push.env: copy dev/push.env.example and fill in the mixer's address"
HOST=$(conf MIXER_HOST)
printf '%s' "$HOST" | grep -Eq '^[A-Za-z0-9][A-Za-z0-9.:-]*$' || die "MIXER_HOST in dev/push.env is not an address or host name"
KEY=$(conf SSH_KEY); KEY=${KEY/#\~/$HOME}
[ -n "$KEY" ] || die "SSH_KEY in dev/push.env is empty: make a key for the dev card first (docs/DEVELOPMENT.md, \"Dev card\")"
[ -f "$KEY" ] && [ -f "$KEY.pub" ] || die "SSH_KEY $KEY or its $KEY.pub not found"
# push.sh and the mixer-ssh skill log in unattended: a key with a passphrase would only fail there
ssh-keygen -y -P '' -f "$KEY" > /dev/null 2>&1 || die "$KEY has a passphrase (or cannot be read): the dev card's key is made without one (docs/DEVELOPMENT.md, \"Dev card\")"
PUB=$(tr -d '\r' < "$KEY.pub")
[ "$(printf '%s\n' "$PUB" | grep -c .)" = 1 ] && printf '%s' "$PUB" | grep -Eq '^(ssh-(ed25519|rsa)|ecdsa-sha2-nistp[0-9]+) [A-Za-z0-9+/=]+( .*)?$' \
  || die "$KEY.pub is not one public key"

# the old card's host key, from both lists
for k in "$HOME/.ssh/known_hosts" "$KNOWN"; do
  [ ! -f "$k" ] || ssh-keygen -R "$HOST" -f "$k" > /dev/null 2>&1 || true
  [ ! -f "$k" ] || [ -z "$(ssh-keygen -F "$HOST" -f "$k" 2> /dev/null)" ] || die "could not remove the old host key of $HOST from $k"
done
mkdir -p "$(dirname "$KNOWN")"
SSHOPTS=(-o ConnectTimeout=10 -o StrictHostKeyChecking=accept-new -o "UserKnownHostsFile=$KNOWN")
keylogin() { ssh "${SSHOPTS[@]}" -o BatchMode=yes -o IdentitiesOnly=yes -i "$KEY" "root@$HOST" true 2> /dev/null; }

fp=$(ssh-keyscan -T 10 -t ed25519 "$HOST" 2> /dev/null | ssh-keygen -lf - 2> /dev/null | awk '{print $2}' || true)
[ -n "$fp" ] || die "no ed25519 host key from $HOST on port 22: Wi-Fi and SSH on (Mod page, Network)? Right address in dev/push.env?"
echo "card at $HOST, host key $fp"
if keylogin; then
  echo "cardkey: the card already takes $KEY; nothing to add"
  exit 0
fi

echo "the SSH password from the mixer's screen (Settings, DLZ Creator Modded, Network):"
# the key on stdin, the password only at ssh's own prompt (asked once); the line is added only when it
# is not there, after a newline when the file's last line has none
printf '%s\n' "$PUB" | ssh "${SSHOPTS[@]}" -o PubkeyAuthentication=no -o PreferredAuthentications=password,keyboard-interactive \
  -o NumberOfPasswordPrompts=1 "root@$HOST" \
  'umask 077; mkdir -p ~/.ssh; read -r k; f=~/.ssh/authorized_keys; touch "$f"; grep -qxF "$k" "$f" || { [ ! -s "$f" ] || [ -z "$(tail -c 1 "$f")" ] || echo >> "$f"; printf "%s\n" "$k" >> "$f"; }' \
  || die "could not add the key: see ssh's message above (a wrong password, or SSH off on the mixer's screen)"
keylogin || die "the key was added, but a login with $KEY still fails"
echo "cardkey: done, $KEY logs in; push.sh, netlog.sh and the mixer-ssh skill (dlz-ssh.sh forget, then key) work again"
