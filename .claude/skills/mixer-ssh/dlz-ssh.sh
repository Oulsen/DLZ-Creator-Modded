#!/bin/bash
# SSH to the mixer (the mod card's system) from WSL, read-only by default.
#
#   bash dlz-ssh.sh host <ip or name>       store the mixer's address (WSL ~/.config, kept)
#   bash dlz-ssh.sh pass                    store the session's password, read from stdin (WSL /tmp only)
#   bash dlz-ssh.sh run '<command>'         run a read-only command on the mixer
#   bash dlz-ssh.sh get <remote> <local>    copy a file from the mixer to the PC
#   bash dlz-ssh.sh show                    the stored address, and whether a password is stored
#   bash dlz-ssh.sh forget [--all]          remove password, askpass, known hosts (--all: the address too)
#
# The address lives in ~/.config/dlz-mixer-ssh/host (WSL, outside the repo; another mixer or network:
# store the new one). The password, the askpass helper and the host keys live in a private folder from
# mktemp -d in /tmp (mode 700, its path in ~/.config/dlz-mixer-ssh/tmpdir); the password never goes on
# a command line, not even this script's. Host keys: every install makes a new card with new keys.
# "run" refuses commands that look like writes (see WRITE_RE) unless DLZ_SSH_WRITE=1 is set, which is
# only done after the user confirmed that exact command in the current turn (SKILL.md).
set -u
CONF=$HOME/.config/dlz-mixer-ssh
HOSTF=$CONF/host
TMPF=$CONF/tmpdir

# a command word or construct that changes state; checked after removing harmless redirections
# Only where a command starts: at the beginning, after ; & | ( ` or $(, after if/then/do/else/!, or
# behind a launcher (xargs, exec, find -exec, env, sudo, timeout, ...); with or without a path. A unit
# name like flash-fpga as an argument (systemctl status flash-fpga) is not a command
CMDPOS='(^|[;&|(`!]|(^|[^[:alnum:]_.-])(if|then|do|else|xargs|exec|-exec|-execdir|-ok|env|nohup|nice|ionice|timeout|time|sudo|chroot|watch|stdbuf)([[:space:]][^;&|]*)?[[:space:]])[[:space:]]*([^[:space:];&|()]*/)?'
# arguments that make a reading command write, wherever they stand
ARG_RE='[[:space:]](-delete|-fprint[0-9]*|-fls)([[:space:]]|$)'
WRITE_RE=$CMDPOS'(rm|mv|cp|dd|tee|install|ln|touch|mkdir|rmdir|truncate|shred|chmod|chown|chattr|mkfs[.a-z0-9]*|fsck[.a-z0-9]*|e2fsck|tune2fs|resize2fs|debugfs|mount|umount|swapon|swapoff|reboot|poweroff|shutdown|halt|init|telinit|apt|apt-get|dpkg|pip|pip3|npm|kill|killall|pkill|sysctl|hwclock|timedatectl|hostnamectl|nmcli|iw|ip[[:space:]]+(link|addr|route)[[:space:]]+(add|del|set|change|replace|flush)|blockdev|sfdisk|fdisk|parted|wipefs|losetup|dmsetup|mmc|openocd|gwprog|flash-[a-z0-9]*|crontab|passwd|chpasswd|useradd|usermod|scp|rsync|wget|curl|python3?|node|perl|bash|sh|busybox|sed[[:space:]]+-i|systemctl[[:space:]]+(start|stop|restart|reload|try-restart|enable|disable|mask|unmask|daemon-reload|isolate|kill|reset-failed|set-property|edit)|journalctl[[:space:]]+.*--(vacuum|rotate|flush))([.][[:alnum:]]+)?([[:space:]]|$|[;&|)])'

gethost() {
  host=$(cat "$HOSTF" 2>/dev/null)
  [ -n "$host" ] || { echo "no mixer address stored: ask the user, then bash dlz-ssh.sh host <ip or name>" >&2; exit 2; }
  echo "[mixer: root@$host]" >&2
}
# the session's private folder: only the one recorded in $TMPF, and only while it is a real folder
# (no link) owned by us with mode 700; otherwise "new" makes a fresh one and records it
privdir() {   # privdir [new]
  D=$(cat "$TMPF" 2>/dev/null)
  if [ -n "$D" ] && [ -d "$D" ] && [ ! -L "$D" ] && [ -O "$D" ] && [ "$(stat -c %a "$D")" = 700 ]; then :
  elif [ "${1:-}" = new ]; then
    D=$(mktemp -d /tmp/dlz-ssh.XXXXXXXX) && mkdir -p "$CONF" && printf '%s\n' "$D" > "$TMPF" \
      || { echo "no private folder could be made in /tmp" >&2; exit 2; }
  else D=; return 1
  fi
  PASS=$D/pass ASK=$D/askpass KNOWN=$D/known-hosts
}
askpass() {
  privdir && [ -s "$PASS" ] || { echo "no password stored: bash dlz-ssh.sh pass (password on stdin)" >&2; exit 2; }
  printf '#!/bin/sh\ncat %s\n' "$PASS" > "$ASK" && chmod 700 "$ASK"
}
sshopts() {
  echo -o StrictHostKeyChecking=accept-new -o UserKnownHostsFile=$KNOWN -o ConnectTimeout=10 \
    -o PreferredAuthentications=password -o PubkeyAuthentication=no -o NumberOfPasswordPrompts=1
}

case ${1:-} in
  host)
    # an IPv4/IPv6 address or a host name, nothing else (it ends up on ssh's command line)
    printf '%s' "${2:-}" | grep -Eq '^[A-Za-z0-9][A-Za-z0-9.:-]*$' || { echo "usage: dlz-ssh.sh host <ip or name>" >&2; exit 2; }
    mkdir -p "$CONF" && printf '%s\n' "$2" > "$HOSTF" && echo "mixer address stored: $2 ($HOSTF)" ;;
  pass)
    # never as an argument: that would put it in the process list and the shell history
    [ $# = 1 ] || { echo "usage: dlz-ssh.sh pass, with the password on stdin (never as an argument)" >&2; exit 2; }
    if [ -t 0 ]; then read -rsp "mixer password: " pw; echo >&2; else IFS= read -r pw || [ -n "$pw" ]; fi
    [ -n "$pw" ] || { echo "no password read" >&2; exit 2; }
    privdir new
    umask 077; printf '%s' "$pw" > "$PASS" && echo "password stored in $D (WSL /tmp only)" ;;
  show)
    echo "address: $(cat "$HOSTF" 2>/dev/null || echo none)"
    privdir && [ -s "$PASS" ] && echo "password: stored for this session" || echo "password: none" ;;
  run)
    cmd=${2:?command}
    if [ "${DLZ_SSH_WRITE:-0}" != 1 ]; then
      # harmless redirections out first: to /dev/null, and fd duplication like 2>&1
      check=$(printf '%s' "$cmd" | sed -E 's/[0-9]*>+[[:space:]]*\/dev\/null//g; s/[0-9]*>&[0-9]+//g')
      if printf '%s' "$check" | grep -q '>' || printf '%s' "$check" | grep -Eq "$WRITE_RE" \
         || printf '%s' "$check" | grep -Eq "$ARG_RE"; then
        echo "REFUSED (looks like a write or a program that could write): $cmd" >&2
        echo "Only after the user confirms this exact command: DLZ_SSH_WRITE=1 bash dlz-ssh.sh run ..." >&2
        exit 3
      fi
    fi
    gethost; askpass
    # shellcheck disable=SC2046
    SSH_ASKPASS=$ASK SSH_ASKPASS_REQUIRE=force DISPLAY=: ssh $(sshopts) "root@$host" "$cmd" < /dev/null ;;
  get)
    remote=${2:?remote file}; local=${3:?local file}
    gethost; askpass
    # shellcheck disable=SC2046
    SSH_ASKPASS=$ASK SSH_ASKPASS_REQUIRE=force DISPLAY=: scp $(sshopts) "root@$host:$remote" "$local" < /dev/null ;;
  forget)
    privdir && rm -rf "$D"; rm -f "$TMPF"; echo "password, askpass and known hosts removed"
    [ "${2:-}" = --all ] && rm -f "$HOSTF" && echo "address removed" ;;
  *)
    sed -n '2,16p' "$0"; exit 2 ;;
esac
