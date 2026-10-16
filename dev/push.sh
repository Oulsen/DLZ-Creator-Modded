#!/bin/bash
# Push a dev build to a dev card over Wi-Fi (Git Bash): build the package in WSL, copy it into the
# card's DLZDATA/dlzmod-update/ over SSH, wait for the mixer's next start and show the update's
# report. The card applies it at startup like any drop-in update (notes/updates.md, "Drop-in update"): signature,
# checks, sandbox. Nothing else on the mixer is changed (DLZDATA, read-only while the mixer runs, is
# writable only for the copy).
#
# Usage: bash dev/push.sh [--restart]                 build HEAD into build/push, push it, wait for
#                                                     the next start, show the result
#        bash dev/push.sh [--restart] <package>.tar   push a package built before (its .tar.sig next to
#                                                     it), e.g. an older build of the same version while bisecting
# The mixer is switched off and on by hand (the switch on the back): a restart from software (--restart,
# systemctl reboot) often hangs on the loading screen with the current Mackie software (#81).
#
# Needs a dev card (docs/DEVELOPMENT.md, "Dev card"): it trusts your dev key, Wi-Fi on, SSH kept on
# after a restart, your SSH key in its authorized_keys. Settings in dev/push.env (git-ignored, see
# dev/push.env.example), read by name, never sourced. Only a committed tree is signed (mkpackage.sh):
# commit first, WIP commits on the feature branch are fine (squashed in the PR).
# Before the next start the package is checked here as the card will: the signature against the card's
# own dev.pub, CHANNEL=dev, REINSTALL=no, not older than the card's version.
set -euo pipefail

REPO=$(cd "$(dirname "$0")/.." && pwd)
CONF=$REPO/dev/push.env
OUT=$REPO/build/push
KNOWN=$HOME/.config/dlzmod-push/known_hosts

die() { echo "push: $*" >&2; exit 1; }
conf() { [ -f "$CONF" ] && sed -n "s/^$1=//p" "$CONF" | tail -n 1 | tr -d '\r' || true; }
wslpath_of() { local p; p=$(cygpath -au "$1"); echo "/mnt/${p:1:1}${p:2}"; }   # -a: relative paths too

[ -f "$CONF" ] || die "no dev/push.env: copy dev/push.env.example and fill in the mixer's address"
HOST=$(conf MIXER_HOST)
# an IPv4/IPv6 address or a host name, nothing else (it ends up on ssh's command line)
printf '%s' "$HOST" | grep -Eq '^[A-Za-z0-9][A-Za-z0-9.:-]*$' || die "MIXER_HOST in dev/push.env is not an address or host name"
KEY=$(conf SSH_KEY); KEY=${KEY/#\~/$HOME}
KEYS=$(conf KEYS_DIR); KEYS=${KEYS:-$USERPROFILE/.dlzmod-keys}; KEYS=${KEYS/#\~/$HOME}

mkdir -p "$(dirname "$KNOWN")" "$OUT"
SSHOPTS=(-o BatchMode=yes -o ConnectTimeout=10 -o ServerAliveInterval=5 -o ServerAliveCountMax=3
  -o StrictHostKeyChecking=accept-new -o "UserKnownHostsFile=$KNOWN")
# sshd counts every key an agent offers (MaxAuthTries=3): offer only this one
if [ -n "$KEY" ]; then
  [ -f "$KEY" ] || die "SSH_KEY $KEY not found"
  SSHOPTS+=(-o IdentitiesOnly=yes -i "$KEY")
fi
mixer() { ssh "${SSHOPTS[@]}" "root@$HOST" "$@"; }

RESTART=no
ARGS=()
for a in "$@"; do
  case $a in --restart) RESTART=yes ;; -*) die "unknown option $a" ;; *) ARGS+=("$a") ;; esac
done
[ ${#ARGS[@]} -le 1 ] || die "one package at most"
set -- "${ARGS[@]+"${ARGS[@]}"}"

# 1. the package: built now from HEAD, or one given on the command line
if [ $# -ge 1 ]; then
  TAR=$(cygpath -u "$1")   # a D:\... path too (tar reads "D:" as a remote host)
  [ -f "$TAR" ] || die "$1 not found"
else
  [ -z "$(git -C "$REPO" status --porcelain -- install VERSION)" ] \
    || die "uncommitted changes in install/ or VERSION: commit first (an unsigned build is refused by the card)"
  echo "== build $(git -C "$REPO" rev-parse --short HEAD) in WSL"
  LOG=$OUT/build.log
  MSYS_NO_PATHCONV=1 wsl -d Ubuntu -u root --cd "$(wslpath_of "$REPO")" -e \
    env "DLZMOD_SIGNING_KEYS=$(wslpath_of "$KEYS")" bash install/release/mkpackage.sh build/push > "$LOG" 2>&1 \
    || { tail -n 20 "$LOG" >&2; die "build failed (full log: build/push/build.log)"; }
  NAME=$(sed -n 's#^package: .*/\(dlzmod-[^/ ]*\)\.tar .*#\1#p' "$LOG" | tail -n 1)
  [ -n "$NAME" ] || die "no package name in build/push/build.log"
  TAR=$OUT/$NAME.tar
fi
SIG=$TAR.sig
NAME=$(basename "$TAR" .tar)
# a plain name only: it goes into the commands below
[[ $NAME =~ ^dlzmod-v[A-Za-z0-9._+-]+$ ]] || die "$TAR: not a dlzmod-v*.tar package"
[ -f "$SIG" ] || die "no $SIG: the package is not signed (built from a tree with uncommitted changes?)"
ENV=$(tar -xOf "$TAR" "$NAME/package.env" | tr -d '\r') || die "no $NAME/package.env in $TAR"
penv() { sed -n "s/^$1=//p" <<< "$ENV" | tail -n 1; }
PVER=$(penv DLZMOD_VERSION)
[ "$(penv CHANNEL)" = dev ] || die "$NAME is not a dev build (CHANNEL=$(penv CHANNEL))"
[ "$(penv REINSTALL)" = no ] || die "$NAME needs a full install (REINSTALL=$(penv REINSTALL)): the drop-in refuses it"
echo "== package $NAME ($(stat -c %s "$TAR") bytes)"

# 2. the card: reachable, a dev card whose key signed this package, DLZDATA mounted, not newer
echo "== mixer root@$HOST"
STATE=$(mixer 'echo "data=$(findmnt -rno TARGET -S LABEL=DLZDATA | head -n 1)"
  echo "version=$(cat /var/lib/dlzmod-update/version 2>/dev/null)"
  echo "report=$(cat /var/lib/dlzmod-update/last-report 2>/dev/null) $(stat -c %i /var/lib/dlzmod-update/last-report 2>/dev/null)"
  echo "failed=$(cat /var/lib/dlzmod-update/failed 2>/dev/null)"
  echo "boot=$(cat /proc/sys/kernel/random/boot_id)"' | tr -d '\r') \
  || die "no SSH login on $HOST (address, Wi-Fi, SSH kept on, your key in authorized_keys, a key with a passphrase in ssh-agent? A new install has new host keys: delete $KNOWN)"
st() { sed -n "s/^$1=//p" <<< "$STATE"; }
DATA=$(st data); CVER=$(st version); REPORT_BEFORE=$(st report); BOOT=$(st boot)
# the updater remembers a refused file by the hash of the package and its signature (at most 65
# bytes of it), and stays silent about it at every later start: no restart for that
SUM=$({ cat "$TAR"; head -c 65 "$SIG"; } | sha256sum | cut -d' ' -f1)
[ "$(st failed)" != "$SUM" ] || die "the card refused this exact file before and does not try it again: push a new build"
# a plain path only: it goes into the commands below
printf '%s' "$DATA" | grep -Eq '^/[A-Za-z0-9/_.-]+$' || die "DLZDATA is not mounted on the mixer (findmnt: '$DATA')"
U=$DATA/dlzmod-update
echo "   card version ${CVER:-unknown}, DLZDATA at $DATA"
if [ -n "$CVER" ] && [ "$(printf '%s\n%s\n' "$CVER" "$PVER" | sort -V | head -n 1)" != "$CVER" ]; then
  die "$PVER is older than the card's $CVER: the card refuses it"
fi
mixer 'cat /usr/local/share/dlzmod-keys/dev.pub' > "$OUT/card-dev.pub" 2>/dev/null \
  || die "the card has no dev key: not a dev card (a card from the release image trusts only the release keys)"
MSYS_NO_PATHCONV=1 wsl -d Ubuntu -e openssl pkeyutl -verify -pubin -inkey "$(wslpath_of "$OUT/card-dev.pub")" \
  -rawin -in "$(wslpath_of "$TAR")" -sigfile "$(wslpath_of "$SIG")" > /dev/null 2>&1 \
  || die "the signature does not match the card's dev key: card built with another dev key (KEYS_DIR?)"
echo "   signature matches the card's dev key"

# 3. copy: earlier packages out (the updater takes every dlzmod-*.tar, more than one is never
# installed), under a temporary name first and renamed only when complete (a cut connection ends
# the remote cat normally), the .sig last (without it the card does not try the tar), checked, flushed.
# server.js keeps DLZDATA mounted read-only and makes it read-write only while it writes itself, a
# recording (notes/open-questions.md, Q28): read-write now means it is busy, so stop (checked and
# remounted in one command, no recording can start in between); otherwise read-write for the copy
# and read-only again after it, however the script ends (the trap: an error, Ctrl-C, a closed window)
echo "== copy to $U/"
RW=0
rodata() {
  RW=0
  mixer "sync; mount -o remount,ro '$DATA'" \
    || { echo "push: DLZDATA could not be made read-only again (a recording started?)" >&2; return 1; }
}
trap '[ "$RW" = 0 ] || rodata' EXIT
trap 'exit 130' INT TERM HUP
# armed before the call: a connection lost after the remote remount still makes it read-only again;
# only the two answers that say nothing was remounted disarm it
RW=1
RC=0
mixer "case \$(findmnt -rno OPTIONS -T '$DATA' | head -n 1) in
  ro|ro,*) mount -o remount,rw '$DATA' ;;
  rw|rw,*) exit 3 ;;
  *) exit 4 ;;
esac" || RC=$?
case $RC in
  0) ;;
  3) RW=0; die "DLZDATA is mounted read-write on the mixer (a recording?): push when it is done" ;;
  4) RW=0; die "DLZDATA's mount on the mixer could not be read" ;;
  *) die "DLZDATA could not be made writable on the mixer" ;;
esac
mixer "mkdir -p '$U' && rm -f '$U'/dlzmod-*.tar '$U'/dlzmod-*.tar.sig '$U'/.push-part" \
  || die "cannot write to $U on the mixer"
put() {
  mixer "cat > '$U/.push-part' && [ \"\$(stat -c %s '$U/.push-part')\" = $(stat -c %s "$1") ] \
    && mv -f '$U/.push-part' '$U/$2' || { rm -f '$U/.push-part'; exit 1; }" < "$1"
}
put "$TAR" "$NAME.tar" || die "copying the package failed"
put "$SIG" "$NAME.tar.sig" || { mixer "rm -f '$U/$NAME.tar'" || true; die "copying the signature failed"; }
# hashes only: Git Bash marks binary files with '*', the mixer does not
SUMS=$(mixer "cd '$U' && sha256sum '$NAME.tar' '$NAME.tar.sig' && sync" | tr -d '\r' | cut -d' ' -f1) \
  || die "the copy on the mixer could not be checked"
[ "$SUMS" = "$(sha256sum "$TAR" "$SIG" | cut -d' ' -f1)" ] || die "copy on the mixer differs from $TAR"
# never ask for a power cut while DLZDATA is writable: a recording may be running
rodata || die "do not switch the mixer off now; the package is in place and goes in at its next start (after the recording)"

# 4. the next start (switched off and on by hand, or --restart), then the updater's report
if [ "$RESTART" = yes ]; then
  echo "== restart"
  mixer 'systemctl reboot' || true
else
  echo "== switch the mixer off and on now (the switch on the back); waiting for its next start"
fi
START=$(date +%s)
sleep 15
NOW=""
until NOW=$(mixer 'cat /proc/sys/kernel/random/boot_id' 2>/dev/null | tr -d '\r') && [ -n "$NOW" ] && [ "$NOW" != "$BOOT" ]; do
  [ $(( $(date +%s) - START )) -lt 600 ] || die "the mixer is not back on SSH after 10 minutes (the package stays on the card and goes in at its next start: no need to push it again)"
  sleep 5
done
echo "   back on SSH after $(( $(date +%s) - START )) s"
START=$(date +%s)   # the waits below count from the new start
nolog() {
  echo "push: $1; the updater's own log:" >&2
  mixer 'journalctl -b -u dlzmod-update --no-pager | tail -n 30' >&2 || true
  exit 1
}
# a new report: last-report is replaced (mv) for every one, so its inode changes even if the
# name came again (the updater numbers on from the highest update-N)
NEWREP=""
while :; do
  NEWREP=$(mixer 'echo "$(cat /var/lib/dlzmod-update/last-report 2>/dev/null) $(stat -c %i /var/lib/dlzmod-update/last-report 2>/dev/null)"' \
    | tr -d '\r' || true)
  [ -n "${NEWREP% *}" ] && [ "$NEWREP" != "$REPORT_BEFORE" ] && break
  [ $(( $(date +%s) - START )) -lt 360 ] || nolog "no new update report"
  sleep 5
done
REPORT=${NEWREP% *}
# a plain name only: it goes into the command below
[[ $REPORT =~ ^update-[0-9]+(-[A-Za-z0-9._+-]+)?\.txt$ ]] || die "unexpected report name '$REPORT'"

# 5. the result, from the report itself (DLZDATA may be mounted again only a little later)
TEXT=""
until TEXT=$(mixer "d=\$(findmnt -rno TARGET -S LABEL=DLZDATA | head -n 1); [ -n \"\$d\" ] && cat \"\$d/dlzmod-logs/$REPORT\"" \
    2>/dev/null | tr -d '\r') && [ -n "$TEXT" ]; do
  [ $(( $(date +%s) - START )) -lt 420 ] || nolog "$REPORT could not be read (DLZDATA not mounted?)"
  sleep 5
done
echo "== $REPORT"
echo "$TEXT"
NEWV=$(mixer 'cat /var/lib/dlzmod-update/version 2>/dev/null' | tr -d '\r' || true)
if grep -q '^INSTALLED: ' <<< "$TEXT"; then
  echo "== installed: card version ${NEWV:-unknown}"
elif grep -q '^NOT INSTALLED this time' <<< "$TEXT"; then
  echo "== NOT installed this time (not the package's fault): the card tries it again at the next start"
  exit 1
else
  echo "== NOT installed (the report above says why): the card does not try this file again, push a new build"
  exit 1
fi
