#!/bin/bash
# SSH to the mixer (the mod card's system) from WSL, read-only by default.
#
#   bash dlz-ssh.sh host <ip or name>       store the mixer's address (WSL ~/.config, kept)
#   bash dlz-ssh.sh pass                    store the session's password, read from stdin (WSL /tmp only)
#   bash dlz-ssh.sh key [<private key>]     use an SSH key instead (a dev card's, as dev/push.sh does);
#                                           default: SSH_KEY from dev/push.env in the current folder
#   bash dlz-ssh.sh run '<command>'         run a read-only command on the mixer
#   bash dlz-ssh.sh get <remote> <local>    copy a file from the mixer to the PC
#   bash dlz-ssh.sh show                    the stored address, and how this session logs in
#   bash dlz-ssh.sh forget [--all]          remove password, key, askpass, known hosts (--all: the address too)
#
# The address lives in ~/.config/dlz-mixer-ssh/host (WSL, outside the repo; another mixer or network:
# store the new one). The password or a copy of the key, the askpass helper and the host keys live in
# a private folder from mktemp -d in /tmp (mode 700, its path in ~/.config/dlz-mixer-ssh/tmpdir); the
# password never goes on a command line, not even this script's. The key is copied because WSL's ssh
# refuses a key file on a Windows drive (its mode shows as 777); a stored key is used before a
# password. Host keys: every install makes a new card with new keys.
# "run" lets only reading commands through (guard, below) unless DLZ_SSH_WRITE=1 is set, which is
# only done after the user confirmed that exact command in the current turn (SKILL.md).
set -u
CONF=$HOME/.config/dlz-mixer-ssh
HOSTF=$CONF/host
TMPF=$CONF/tmpdir

# The read-only guard of "run" is an allowlist, not a list of known writes (those always miss one).
# The command is split as the shell splits it (quotes, backslashes) into simple commands at ; | && ||
# and newlines; each must be a program from READ_CMDS, or one of the programs seg_ok checks the
# arguments of, by its bare name or from /bin, /sbin, /usr/bin or /usr/sbin. Refused outright: a
# command inside another or a group (` $( ( ) { }), a variable or $'..' outside single quotes, an
# unquoted < or >, except > to /dev/null and 2>&1, and a single & (background). The checked programs
# also refuse unquoted * ? [ (a glob can expand to more names or to an option). A refused read is a
# false positive: widen the list, with a case in test-guard.sh.
# READ_CMDS have no option that writes a file or runs a program
READ_CMDS=' cat head tail tac nl ls stat grep egrep fgrep zcat wc md5sum sha1sum sha256sum cmp diff strings od hexdump base64 cut paste tr fold rev basename dirname readlink realpath which uptime uname nproc id whoami who last pwd free df du ps pgrep pidof vmstat lsblk findmnt lsusb lsmod lsof getconf dpkg-query echo printf true false sleep cd test [ '

# opts_ok <no-value flags> <word>...: every option is a flag from the list or --name=value, so no
# option takes the next word as its value and hides the real verb behind it (-p status reboot; also
# not -pX: in a cluster like -ap the p takes the next word)
opts_ok() {
  local flags=" $1 " a
  shift
  for a; do
    case $a in
      --*=*) ;;
      -*) case $flags in *" $a "*) ;; *) return 1 ;; esac ;;
    esac
  done
}

# shortflag <arg> <letters>: arg is a short option cluster (-x, -abc) holding one of the letters
shortflag() {
  case $1 in --*) return 1 ;; -?*) case ${1#-} in *["$2"]*) return 0 ;; esac ;; esac
  return 1
}
# seg_ok <word>...: one simple command, its words as the shell will see them
seg_ok() {
  local c=$1 a v b n
  shift
  case $c in */*) [[ $c =~ ^(/usr)?/s?bin/[A-Za-z0-9._-]+$ ]] || return 1; c=${c##*/} ;; esac
  case $READ_CMDS in *" $c "*) return 0 ;; esac
  [ -z "$glob" ] || return 1
  case $c in
    # -c names a cache file, which is written
    blkid) for a; do shortflag "$a" c && return 1; case $a in --c*) return 1 ;; esac; done ;;
    # without arguments it lists the mounts
    mount) [ $# = 0 ] || return 1 ;;
    find) for a; do case $a in -delete|-exec|-execdir|-ok|-okdir|-fprint|-fprint0|-fprintf|-fls) return 1 ;; esac; done ;;
    # -C compiles a magic file into the current folder
    file) for a; do shortflag "$a" C && return 1; case $a in --c*) return 1 ;; esac; done ;;
    sort) for a; do shortflag "$a" o && return 1; case $a in --o*|--com*) return 1 ;; esac; done ;;
    # uniq [INPUT [OUTPUT]]: a second name is written
    uniq) n=0; for a; do case $a in -*) ;; *) n=$((n + 1)) ;; esac; done; [ $n -le 1 ] || return 1 ;;
    date) for a; do shortflag "$a" s && return 1; case $a in --s*) return 1 ;; esac; done ;;
    hostname) case "$*" in ''|-I|-i|-f|-s|-d) ;; *) return 1 ;; esac ;;
    # -c/-C clear the ring buffer, -n/-D/-E change the console
    dmesg) for a; do shortflag "$a" cCnDE && return 1; case $a in --cl*|--rea*|--con*) return 1 ;; esac; done ;;
    # -K kills sockets, -D dumps to a file
    ss) for a; do shortflag "$a" KD && return 1; case $a in --k*|--d*) return 1 ;; esac; done ;;
    # batch mode only (no keys that kill or renice)
    top) b=; for a; do shortflag "$a" b && b=1; done; [ -n "$b" ] || return 1 ;;
    # line ranges only: sed -n 'N,Mp' [file...] (sed's w and e commands write and run)
    sed) [ "${1:-}" = -n ] && [[ ${2:-} =~ ^([0-9]+|\$)(,([0-9]+|\$))?p$ ]] || return 1
         shift 2; for a; do case $a in -*) return 1 ;; esac; done ;;
    # a program that neither runs anything nor writes: only print/printf write (print > "file"), so a
    # > after a print is refused, a comparison before it ($3>1) is not; no program files
    awk) for a; do case $a in -F*|-v) ;; -*|*system*|*getline*|*'|'*|*@*|*print*'>'*) return 1 ;; esac; done ;;
    # -H/-M (another host or container) take a value, so opts_ok refuses them; --host=/--machine= too
    systemctl)
      case "$*" in *--host=*|*--machine=*) return 1 ;; esac
      opts_ok '-a --all -l --full -q --quiet -r --recursive --no-pager --no-legend --plain --value --failed --show-types --reverse --after --before --system' "$@" || return 1
      v=; for a; do case $a in -*) ;; *) v=$a; break ;; esac; done
      case $v in
        ''|status|show|cat|help|is-active|is-enabled|is-failed|is-system-running|list-units|list-unit-files) ;;
        list-sockets|list-timers|list-jobs|list-dependencies|list-paths|list-automounts|get-default|show-environment) ;;
        *) return 1 ;;
      esac ;;
    # not log-level/log-target/service-watchdogs: with an argument they set it
    systemd-analyze)
      opts_ok '-q --quiet --no-pager --system --order --require' "$@" || return 1
      v=; for a; do case $a in -*) ;; *) v=$a; break ;; esac; done
      case $v in ''|time|blame|critical-chain|plot|dot|dump|cat-config|unit-paths|calendar|timespan|timestamp) ;; *) return 1 ;; esac ;;
    # long options also work abbreviated: --rot is --rotate
    journalctl) for a; do case $a in --va*|--rot*|--fl*|--syn*|--rel*|--sm*|--se*|--up*|--cursor-f*) return 1 ;; esac; done ;;
    # ip [-brief, -details, ...] address|route|rule|neigh|link [show|list|get ...]; verbs and objects
    # also work abbreviated (ip l s = link set), so only these exact words
    ip)
      while [ $# -gt 0 ]; do
        case $1 in -4|-6|-s|-stats|-statistics|-d|-details|-o|-oneline|-c|-color|-j|-json|-p|-pretty|-br|-brief|-h|-human) shift ;; *) break ;; esac
      done
      case ${1:-} in a|addr|address|r|route|rule|n|neigh|neighbor|neighbour|l|link) ;; *) return 1 ;; esac
      case ${2:-} in ''|show|list|ls|lst|get) ;; *) return 1 ;; esac ;;
    *) return 1 ;;
  esac
}
# guard <command>: 0 when every simple command in it is on the read-only list
endword() { if [ -n "$inw" ]; then words+=("$w"); fi; w= inw=; }
endseg() { if [ ${#words[@]} -gt 0 ]; then seg_ok "${words[@]}" || return 1; fi; words=() glob=; }
guard() {
  local s ch q= w= inw= glob= i=0 n words=()
  # harmless redirections out first: to /dev/null (2>, >>, &>), and fd duplication like 2>&1; both
  # only as a whole word
  s=$(printf '%s' "$1" | sed -E 's#[0-9]*&?>>?[[:space:]]*/dev/null([[:space:];&|]|$)# \1#g; s#[0-9]*>&[0-9]+([[:space:];&|]|$)# \1#g')
  case $s in *'`'*|*'$('*) return 1 ;; esac
  n=${#s}
  while [ $i -lt $n ]; do
    ch=${s:i:1}; i=$((i + 1))
    if [ "$q" = "'" ]; then
      if [ "$ch" = "'" ]; then q=; else w+=$ch; fi
    elif [ "$q" = '"' ]; then
      case $ch in
        '"') q= ;;
        # a backslash only escapes $ ` " \ inside double quotes; otherwise it stays
        '\') case ${s:i:1} in '$'|'`'|'"'|'\') w+=${s:i:1}; i=$((i + 1)) ;; *) w+=$ch ;; esac ;;
        # a $ before the closing quote is literal; anything else expands
        '$') [ "${s:i:1}" = '"' ] || return 1; w+=$ch ;;
        *) w+=$ch ;;
      esac
    else
      case $ch in
        "'"|'"') q=$ch; inw=1 ;;
        '\') [ $i -lt $n ] || return 1; w+=${s:i:1}; i=$((i + 1)); inw=1 ;;
        # a $ at the end of a word is literal; anything else expands
        '$') if [ $i -lt $n ]; then case ${s:i:1} in [[:space:]]|';'|'|'|'&') ;; *) return 1 ;; esac; fi
             w+=$ch; inw=1 ;;
        $'\n'|';'|'|'|'&')
          if [ "$ch" = '&' ]; then [ "${s:i:1}" = '&' ] || return 1; i=$((i + 1)); fi
          if [ "$ch" = '|' ] && [ "${s:i:1}" = '|' ]; then i=$((i + 1)); fi
          endword; endseg || return 1 ;;
        ' '|$'\t'|$'\r') endword ;;
        '('|')'|'{'|'}'|'<'|'>') return 1 ;;
        '*'|'?'|'[') glob=1; w+=$ch; inw=1 ;;
        *) w+=$ch; inw=1 ;;
      esac
    fi
  done
  [ -z "$q" ] || return 1
  endword; endseg
}

# No login in the first 5 minutes of a start: logins while a start settles coincided with hangs
# (#81, #136). The mixer's uptime without logging in: a dev card's network log (dev/netlog.ps1) writes
# the journal with the uptime in front of every line, so the newest file's last line plus the time
# since it was written. A file quiet for over 10 minutes, or none, says nothing (the skill's rule
# then). DLZ_SSH_EARLY=1 only after the user agreed to a login this early.
early() {
  [ "${DLZ_SSH_EARLY:-0}" != 1 ] || return 0
  local f age up
  f=$(ls -t "${DLZ_NETLOG_DIR:-build/device-logs}"/netlog-*.txt 2> /dev/null | head -n 1)
  [ -n "$f" ] || return 0
  age=$(( $(date +%s) - $(stat -c %Y "$f") ))
  [ "$age" -le 600 ] || return 0
  up=$(tail -n 1 "$f" | sed -n 's/^\[ *\([0-9]*\)\.[0-9]*\].*/\1/p')
  [ -n "$up" ] || return 0
  up=$((up + age))
  [ "$up" -ge 300 ] && return 0
  echo "REFUSED (the mixer started ${up} s ago, by its network log $f): no login in the first 300 s of a start;" >&2
  echo "wait, or read the network log. Only when the user agrees to a login this early: DLZ_SSH_EARLY=1" >&2
  exit 4
}

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
  PASS=$D/pass ASK=$D/askpass KNOWN=$D/known-hosts KEY=$D/key
}
askpass() {
  privdir && { [ -s "$KEY" ] || [ -s "$PASS" ]; } \
    || { echo "no password or key stored: bash dlz-ssh.sh pass (password on stdin) or bash dlz-ssh.sh key" >&2; exit 2; }
  [ -s "$KEY" ] || { printf '#!/bin/sh\ncat %s\n' "$PASS" > "$ASK" && chmod 700 "$ASK"; }
}
sshopts() {
  echo -o StrictHostKeyChecking=accept-new -o UserKnownHostsFile=$KNOWN -o ConnectTimeout=10
  if [ -s "$KEY" ]; then
    # only this key (sshd's MaxAuthTries counts every key an agent offers), never a prompt
    echo -o IdentitiesOnly=yes -i $KEY -o PreferredAuthentications=publickey -o BatchMode=yes
  else
    echo -o PreferredAuthentications=password -o PubkeyAuthentication=no -o NumberOfPasswordPrompts=1
  fi
}
# a key path as dev/push.env or the user writes it: ~ is the Windows user folder (Git Bash's home),
# C:\... or C:/... a Windows path, /c/... a Git Bash path; all mapped into WSL
keypath() {
  case $1 in
    "~"/*) prof=$(cmd.exe /c 'echo %USERPROFILE%' 2>/dev/null | tr -d '\r')
           [ -n "$prof" ] || { echo "the Windows user folder for $1 is unknown" >&2; exit 2; }
           wslpath -u "$prof${1#\~}" ;;
    [A-Za-z]:[\\/]*) wslpath -u "$1" ;;
    /[A-Za-z]/*) printf '/mnt/%s%s\n' "$(printf '%s' "${1:1:1}" | tr 'A-Z' 'a-z')" "${1:2}" ;;
    *) printf '%s\n' "$1" ;;
  esac
}

case ${1:-} in
  host)
    # an IPv4/IPv6 address or a host name, nothing else (it ends up on ssh's command line)
    printf '%s' "${2:-}" | grep -Eq '^[A-Za-z0-9][A-Za-z0-9.:-]*$' || { echo "usage: dlz-ssh.sh host <ip or name>" >&2; exit 2; }
    mkdir -p "$CONF" && printf '%s\n' "$2" > "$HOSTF" && echo "mixer address stored: $2 ($HOSTF)" ;;
  pass)
    # never as an argument: that would put it in the process list and the shell history
    [ $# = 1 ] || { echo "usage: dlz-ssh.sh pass, with the password on stdin (never as an argument)" >&2; exit 2; }
    if [ -t 0 ]; then IFS= read -rsp "mixer password: " pw; echo >&2; else IFS= read -r pw || [ -n "$pw" ]; fi
    [ -n "$pw" ] || { echo "no password read" >&2; exit 2; }
    privdir new
    # the password replaces a stored key (a key is used first, so a key the mixer refuses would stay)
    rm -f "$KEY"
    umask 077; printf '%s' "$pw" > "$PASS" && echo "password stored in $D (WSL /tmp only)" ;;
  key)
    src=${2:-}
    if [ -z "$src" ]; then
      [ -f dev/push.env ] || { echo "usage: dlz-ssh.sh key <private key> (or run it where dev/push.env is)" >&2; exit 2; }
      # read as dev/push.sh reads it: the last line wins
      src=$(sed -n 's/^SSH_KEY=//p' dev/push.env | tail -n 1 | tr -d '\r')
      [ -n "$src" ] || { echo "no SSH_KEY in dev/push.env" >&2; exit 2; }
    fi
    src=$(keypath "$src")
    [ -f "$src" ] || { echo "no key file at $src" >&2; exit 2; }
    privdir new
    # checked on the private copy: ssh-keygen refuses the original on a Windows drive (mode 777).
    # A private key without a passphrase (BatchMode cannot ask for one); nothing of it is printed
    umask 077; cat "$src" > "$KEY.new" || exit 2
    if ssh-keygen -y -P '' -f "$KEY.new" > /dev/null 2>&1; then
      # the key replaces a stored password
      mv -f "$KEY.new" "$KEY" && rm -f "$PASS" "$ASK" && echo "key stored in $D (a copy of $src, WSL /tmp only)"
    else
      rm -f "$KEY.new"; echo "not a private key without a passphrase: $src" >&2; exit 2
    fi ;;
  show)
    echo "address: $(cat "$HOSTF" 2>/dev/null || echo none)"
    if privdir && [ -s "$KEY" ]; then echo "login: key stored for this session"
    elif privdir && [ -s "$PASS" ]; then echo "password: stored for this session"
    else echo "password: none"; fi ;;
  run)
    cmd=${2:?command}
    if [ "${DLZ_SSH_WRITE:-0}" != 1 ] && ! guard "$cmd"; then
      echo "REFUSED (not on the read-only list, or shell syntax the guard does not allow): $cmd" >&2
      echo "Only after the user confirms this exact command: DLZ_SSH_WRITE=1 bash dlz-ssh.sh run ..." >&2
      exit 3
    fi
    early; gethost; askpass
    # a read that never ends (tail -f, journalctl -f, vmstat 1) must not hang the session; a confirmed
    # write is never cut off halfway (the mixer could stop it with a file half written)
    t=${DLZ_SSH_TIMEOUT:-120}
    case $t in ''|*[!0-9]*|0) echo "DLZ_SSH_TIMEOUT must be a number of seconds: $t" >&2; exit 2 ;; esac
    to=(timeout "$t")
    [ "${DLZ_SSH_WRITE:-0}" != 1 ] || to=()
    # shellcheck disable=SC2046
    SSH_ASKPASS=$ASK SSH_ASKPASS_REQUIRE=force DISPLAY=: "${to[@]}" ssh $(sshopts) "root@$host" "$cmd" < /dev/null
    rc=$?
    [ ${#to[@]} = 0 ] || [ $rc != 124 ] || echo "stopped after $t s (DLZ_SSH_TIMEOUT); a follow (-f, -w) or a count-less vmstat does not end" >&2
    exit $rc ;;
  get)
    remote=${2:?remote file}; local=${3:?local file}
    # the remote name goes through the mixer's shell with the old scp protocol (OpenSSH before 9.0),
    # and a local name with a : is another host
    case $remote in -*|*[!A-Za-z0-9_./+~-]*) echo "REFUSED (remote name with characters other than A-Z a-z 0-9 _ . / + ~ -): $remote" >&2; exit 3 ;; esac
    case $local in -*|*:*) echo "REFUSED (local name starting with - or holding a :): $local" >&2; exit 3 ;; esac
    early; gethost; askpass
    # shellcheck disable=SC2046
    SSH_ASKPASS=$ASK SSH_ASKPASS_REQUIRE=force DISPLAY=: scp $(sshopts) "root@$host:$remote" "$local" < /dev/null ;;
  forget)
    # the recorded folder whenever it is a real folder of ours, also one whose mode was changed since
    # (directly in /tmp only: a `*` in case also matches / and .., so those are refused first)
    D=$(cat "$TMPF" 2>/dev/null)
    case $D in
      /tmp/dlz-ssh.*/*|*..*) echo "not removed: the recorded folder $D is not one of ours" >&2 ;;
      /tmp/dlz-ssh.?*) if [ -d "$D" ] && [ ! -L "$D" ] && [ -O "$D" ] && rm -rf "$D"; then
          echo "password, key, askpass and known hosts removed"
        else echo "nothing removed (no folder of ours at $D)"; fi ;;
      *) echo "nothing to remove" ;;
    esac
    rm -f "$TMPF"
    [ "${2:-}" = --all ] && rm -f "$HOSTF" && echo "address removed" ;;
  *)
    sed -n '2,20p' "$0"; exit 2 ;;
esac
