#!/bin/bash
# Run from anywhere in WSL or Linux: bash .claude/skills/mixer-ssh/test-guard.sh (after every change to
# the guard; CI runs it too). Exits 1 when a case goes wrong.
# The wrapper's read-only guard, offline: an empty HOME = no stored address, so a command that passes
# the guard stops at "no mixer address stored" and never connects.
S=$(dirname "$(readlink -f "$0")")/dlz-ssh.sh
export HOME=$(mktemp -d)
export DLZ_NETLOG_DIR=$HOME/netlog   # no network log here; the early-start cases make their own
fail=0
t() {   # t <expected allowed|REFUSED> <command>, or t <expected> get <remote> <local>
  if [ "$2" = get ]; then out=$(bash "$S" get "$3" "$4" 2>&1); else out=$(bash "$S" run "$2" 2>&1); fi
  case $out in *REFUSED*) r=REFUSED ;; *"no mixer address"*) r=allowed ;; *) r="?? $out" ;; esac
  [ "$r" = "$1" ] && m=ok || { m=WRONG; fail=1; }
  printf '%-5s %-8s %s\n' "$m" "$r" "${*:2}"
}
# reads
t allowed 'systemctl is-active flash-fpga faderlink dspserver evolve-node 2>&1 | paste -sd" " -'
t allowed 'systemctl status flash-gd32 --no-pager'
t allowed 'journalctl -b --no-pager -o cat -u dlzmod-cardcheck 2>/dev/null | tail -3'
t allowed 'dmesg | grep -c "EXT4-fs error\|Trying to write"'
t allowed 'cat /proc/stat; sleep 5; cat /proc/stat'
t allowed 'ls -la /root 2>/dev/null; cat /etc/os-release'
t allowed 'grep -rn rm /etc/fstab'
t allowed 'find /var/log -maxdepth 1 -name "*.log"'
t allowed 'systemd-analyze blame | head -15'
t allowed 'ls /usr/bin/python3 /usr/sbin/mount'
t allowed 'free -m; cat /proc/swaps; vmstat 1 6'
t allowed 'lsblk -o NAME,LABEL,SIZE,RO,MOUNTPOINT && findmnt -rno TARGET -S LABEL=DLZDATA'
t allowed 'systemctl list-units --state=failed --no-pager || systemctl'
t allowed 'journalctl -u ssh -n 20 --no-pager --since "-1h"'
t allowed 'dmesg -T | tail -20'
t allowed 'top -bn1 | head -15'
t allowed 'ip -br addr; ip route show; ip link'
t allowed 'ss -ltnp'
t allowed 'date; date +%s; hostname; uptime'
t allowed "sed -n '100,200p' /var/log/syslog"
t allowed "sed -n '\$p' /var/log/syslog"
t allowed "awk '{print \$1, \$NF}' /proc/loadavg"
t allowed 'sort -n /tmp/x | uniq -c'
t allowed 'stat -c %a /root; md5sum /srv/app.js; file /srv/server.js'
t allowed '/usr/bin/cat /etc/hostname'
t allowed 'grep -a "x$" /var/log/syslog | tail -5'
t allowed 'systemd-analyze critical-chain evolve-node.service'
t allowed 'ls /tmp >> /dev/null 2>&1; echo done'
t allowed 'grep "<error>" /var/log/syslog; awk '"'"'$3>1'"'"' /proc/loadavg'
t allowed 'ls /var/log/*.log; cat /proc/[0-9]/stat'
t allowed 'blkid -p /dev/mmcblk0p1; mount; pgrep -a node; dpkg-query -W openssh-server'
t allowed 'systemctl show --property=ActiveState --value dspserver; systemctl status --lines=5 ssh'
t allowed get /var/log/syslog build/device-logs/syslog
t allowed get '~/install-3.txt' build/device-logs/install3.txt
# writes and launchers
t REFUSED 'rm -rf /tmp/x'
t REFUSED '/bin/rm /tmp/x'
t REFUSED 'cat x; rm y'
t REFUSED 'true && mount -o remount,rw /'
t REFUSED 'echo hi > /root/x'
t REFUSED 'cat a | tee b'
t REFUSED 'systemctl restart dspserver'
t REFUSED 'find /tmp -name x -delete'
t REFUSED 'find /tmp -name x -exec rm {} \;'
t REFUSED 'ls | xargs rm'
t REFUSED 'sudo reboot'
t REFUSED 'timeout 5 dd if=/dev/zero of=/tmp/x'
t REFUSED 'if true; then poweroff; fi'
t REFUSED 'x=$(rm a)'
t REFUSED '/usr/local/bin/flash-gd32.sh'
t REFUSED 'python3 -c 1'
t REFUSED 'sh -c "echo"'
t REFUSED 'sed -i s/a/b/ f'
t REFUSED 'kill 1'
t REFUSED 'free -m; swapon --show'
# what the denylist of v0.1.0 let through (back-review, #107)
t REFUSED 'mke2fs /dev/mmcblk0p2'
t REFUSED 'mkswap /dev/mmcblk0p2'
t REFUSED 'blkdiscard /dev/mmcblk0'
t REFUSED 'e2label /dev/mmcblk0p1 x'
t REFUSED 'mkdosfs /dev/mmcblk0p2'
t REFUSED 'unlink /etc/fstab'
t REFUSED 'gzip /var/log/syslog'
t REFUSED 'tar -xf a.tar -C /'
t REFUSED 'sort -o /etc/fstab /tmp/x'
t REFUSED 'sort -no /etc/fstab /tmp/x'
t REFUSED 'sort --compress-program=reboot /tmp/x'
t REFUSED 'find / -name x -fprintf /etc/fstab %p'
t REFUSED 'systemctl reboot'
t REFUSED 'systemctl poweroff'
t REFUSED 'systemctl --no-block halt'
t REFUSED 'fw_setenv bootcmd x'
t REFUSED 'ip l set wlan0 down'
t REFUSED 'ip l s wlan0 down'
t REFUSED 'ip -batch /tmp/x'
t REFUSED 'ip addr flush dev wlan0'
t REFUSED 'date -s 2020-01-01'
t REFUSED 'date --set=2020-01-01'
t REFUSED 'eval rm /x'
t REFUSED 'command rm /x'
t REFUSED 'setsid reboot'
t REFUSED 'su -c reboot'
t REFUSED 'dash -c reboot'
t REFUSED "awk 'BEGIN{system(\"reboot\")}'"
t REFUSED "awk 'BEGIN{\"reboot\" | getline}'"
t REFUSED "awk 'BEGIN{print 1 > \"/etc/fstab\"}'"
t REFUSED 'awk -f /tmp/prog'
t REFUSED "awk '{printf \"%s\", \$0 >> \"/etc/fstab\"}' /x"
t REFUSED "awk '\$3>1 {print \$1 > \"/x\"}' /y"
t REFUSED '{ rm -rf /x; }'
t REFUSED 'case a in a) rm x;; esac'
t REFUSED 'if false; then :; elif true; then rm x; fi'
t REFUSED 'while rm x; do :; done'
t REFUSED 'until rm x; do :; done'
t REFUSED '\rm /x'
t REFUSED 'r\m /x'
t REFUSED 'echo x >/dev/nullX'
t REFUSED 'echo x 2>/dev/null.d/x'
# more ways around a list of programs
t REFUSED 'ls & rm x'
t REFUSED 'ls |& tee x'
t REFUSED 'cat <(rm x)'
t REFUSED 'cat < /etc/fstab'
t REFUSED 'cat "$(reboot)"'
t REFUSED 'cat `reboot`'
t REFUSED "cat \$'\\x41'"
t REFUSED 'X=1 cat /x'
t REFUSED '$SHELL -c reboot'
t REFUSED 'cat $HOME/x'
t REFUSED '/tmp/cat /x'
t REFUSED '/usr/bin/../../tmp/cat /x'
t REFUSED 'cat x; (rm y)'
t REFUSED 'ls '"'"'unclosed'
t REFUSED "sed -n '1p;w /etc/fstab' /x"
t REFUSED "sed -n '1e reboot' /x"
t REFUSED 'sed s/a/b/ /x'
t REFUSED 'uniq /tmp/a /etc/fstab'
t REFUSED 'hostname evil'
t REFUSED 'file -C -m /tmp/x'
t REFUSED 'dmesg -c'
t REFUSED 'dmesg -TC'
t REFUSED 'dmesg --clear'
t REFUSED 'ss -K dst 1.2.3.4'
t REFUSED 'ss -D /tmp/x'
t REFUSED 'top -n1'
t REFUSED 'journalctl --vacuum-size=1M'
t REFUSED 'journalctl --rot'
t REFUSED 'journalctl --flush'
t REFUSED 'journalctl --cursor-file=/etc/fstab'
t REFUSED 'systemd-analyze log-level debug'
t REFUSED 'systemctl set-environment X=1'
t REFUSED 'systemctl daemon-reexec'
t REFUSED 'xargs rm < /tmp/x'
t REFUSED 'tee /x'
t REFUSED 'cp /a /b'
t REFUSED $'cat /x\nrm /y'
# the review of #113: a cache file, globs bash expands before the program sees them, an option value
# taken as the verb, text behind an fd duplication
t REFUSED 'blkid -c /etc/fstab'
t REFUSED 'blkid --cache-file=/etc/fstab'
t REFUSED 'uniq /tmp/log*'
t REFUSED 'sort /tmp/[ab]'
t REFUSED 'find /tmp/? -name x'
t REFUSED 'systemctl -p status reboot'
t REFUSED 'systemctl -H status reboot'
t REFUSED 'systemctl -ap status reboot'
t REFUSED 'systemctl -pActiveState show'
t REFUSED 'systemd-analyze -M blame log-level debug'
t REFUSED 'cat /etc/hostname 2>&1marker bar'
t REFUSED 'cat /x >/dev/null>y'
t REFUSED 'cat /x 2>/dev/null&rm y'
t REFUSED 'mount -o remount,rw /'
t REFUSED 'cat x>y'
t REFUSED 'cat x<y'
# the second pass: the glob flag is per simple command; awk's other output forms; what can still
# stand before a verb
t allowed 'ls /tmp/*; sort -n /tmp/x'
t REFUSED 'sort -n /tmp/x; uniq /tmp/a*'
t REFUSED "awk '{print>\"/x\"}' /y"
t REFUSED "awk '{printf(\"%s\",\$0)>\"/x\"}' /y"
t REFUSED "awk '{print | \"sh\"}' /y"
t REFUSED "awk -vx=1 -W exec /tmp/p"
t allowed "awk -v x=1 '\$1 > x' /proc/loadavg"
t REFUSED 'systemctl -- reboot'
t REFUSED 'systemctl - reboot'
t REFUSED 'systemctl --property ActiveState reboot'
t REFUSED 'systemctl --host=other status'
t REFUSED 'systemctl -M c status'
t allowed 'systemctl --no-pager --full status ssh'
t allowed 'who; last -n 5; pgrep -l node; pidof dspserver'
t allowed 'grep "a > b" /x; grep "<" /x'
# get: the remote name goes through the mixer's shell with the old scp protocol
t REFUSED get '/tmp/x;reboot' build/device-logs/x
t REFUSED get '/tmp/$(reboot)' build/device-logs/x
t REFUSED get '/tmp/a b' build/device-logs/x
t REFUSED get '-oProxyCommand=x' build/device-logs/x
t REFUSED get /var/log/syslog 'other-host:/tmp/x'
t REFUSED get /var/log/syslog '-r'
# no login in the first 5 minutes of a start, by the network log's last line (uptime) and its age
e() {   # e <expected early|allowed> <description> [env...]
  out=$(env "${@:3}" bash "$S" run uptime 2>&1)
  case $out in *"no login in the first"*) r=early ;; *"no mixer address"*) r=allowed ;; *) r="?? $out" ;; esac
  [ "$r" = "$1" ] && m=ok || { m=WRONG; fail=1; }
  printf '%-5s %-8s %s\n' "$m" "$r" "$2"
}
mkdir -p "$DLZ_NETLOG_DIR"
e allowed "no network log"
printf '[    0.000000] host kernel: Booting Linux\n[   95.123456] host x: a line\n' > "$DLZ_NETLOG_DIR/netlog-1.txt"
e early   "95 s up, written just now"
e allowed "95 s up, but the user agreed"              DLZ_SSH_EARLY=1
touch -d '-240 seconds' "$DLZ_NETLOG_DIR/netlog-1.txt"
e allowed "95 s up, written 4 min ago (over 300 s now)"
touch -d '-11 minutes' "$DLZ_NETLOG_DIR/netlog-1.txt"
e allowed "a log quiet for 11 min says nothing"
printf '[  451.313965] host x: a line\n' > "$DLZ_NETLOG_DIR/netlog-2.txt"
e allowed "the newest file: 451 s up"
sleep 1; printf 'not a journal line\n' > "$DLZ_NETLOG_DIR/netlog-3.txt"
e allowed "a file without an uptime says nothing"
printf '[   40.100000] host x: a line\nnot a journal line\n' > "$DLZ_NETLOG_DIR/netlog-3.txt"
e early   "a last line without an uptime: the journal line before it (40 s)"
printf '[ 4000.100000] host x: a line\n===== new start of the mixer =====\n[    0.000000] host kernel: Booting Linux\n[   20.5] host x: a line\n' > "$DLZ_NETLOG_DIR/netlog-3.txt"
e early   "a new start after an old one in the same file: its own uptime (20 s)"
sleep 1; printf '[   12.5] host x: a line\n' > "$DLZ_NETLOG_DIR/netlog-4.txt"
out=$(bash "$S" get /var/log/syslog build/device-logs/x 2>&1)
case $out in *"no login in the first"*) m=ok ;; *) m=WRONG; fail=1 ;; esac
printf '%-5s %-8s %s\n' "$m" early "get too"
rm -f "$DLZ_NETLOG_DIR"/netlog-*
# the key login, offline too: stored as a private copy, shown, refused when it is no usable key, forgotten
k() {   # k <description> <expected text in the output> <command...>
  out=$("${@:3}" 2>&1)
  case $out in *"$2"*) m=ok ;; *) m=WRONG; fail=1 ;; esac
  printf '%-5s %-8s %s\n' "$m" key "$1"
}
ssh-keygen -q -t ed25519 -N '' -f "$HOME/id" && ssh-keygen -q -t ed25519 -N 'secret' -f "$HOME/id-pp" && echo x > "$HOME/notakey"
chmod 777 "$HOME/id"   # as a key on a Windows drive shows in WSL; ssh-keygen refuses such a file itself
k "no key file"                  "no key file at"                 bash "$S" key "$HOME/missing"
k "not a key"                    "not a private key"              bash "$S" key "$HOME/notakey"
k "a key with a passphrase"      "not a private key"              bash "$S" key "$HOME/id-pp"
k "no refused copy left behind"  "nothing"                        bash -c "ls \$(cat '$HOME/.config/dlz-mixer-ssh/tmpdir')/key* 2>/dev/null || echo nothing"
k "no dev/push.env here"         "usage: dlz-ssh.sh key"          bash -c "cd '$HOME' && bash '$S' key"
k "stored"                       "key stored in /tmp/dlz-ssh."    bash "$S" key "$HOME/id"
D=$(cat "$HOME/.config/dlz-mixer-ssh/tmpdir")
[ "$(stat -c %a "$D/key")" = 600 ] && cmp -s "$D/key" "$HOME/id" && m=ok || { m=WRONG; fail=1; }
printf '%-5s %-8s %s\n' "$m" key "a private copy (mode 600)"
k "shown"                        "login: key stored"              bash "$S" show
# the last SSH_KEY line wins, as in dev/push.sh
mkdir -p "$HOME/repo/dev" && printf 'MIXER_HOST=x\nSSH_KEY=%s\nSSH_KEY=%s\r\n' "$HOME/missing" "$HOME/id" > "$HOME/repo/dev/push.env"
k "from dev/push.env (CRLF, last line)" "key stored in /tmp/dlz-ssh." bash -c "cd '$HOME/repo' && bash '$S' key"
k "a Git Bash path (/x/...)"     "no key file at /mnt/x/no/such"  bash "$S" key /x/no/such
k "a Git Bash path (/X/...)"     "no key file at /mnt/x/no/such"  bash "$S" key /X/no/such
# one way to log in at a time: a password replaces the key, a key the password
k "a password replaces the key"  "password: stored"               bash -c "printf 'pw\n' | bash '$S' pass >/dev/null && bash '$S' show"
[ ! -e "$D/key" ] && m=ok || { m=WRONG; fail=1; }
printf '%-5s %-8s %s\n' "$m" key "the key copy is gone"
: > "$D/askpass"   # as a run with the password leaves it
k "a key replaces the password"  "login: key stored"              bash -c "bash '$S' key '$HOME/id' >/dev/null && bash '$S' show"
[ ! -e "$D/pass" ] && [ ! -e "$D/askpass" ] && m=ok || { m=WRONG; fail=1; }
printf '%-5s %-8s %s\n' "$m" key "the password is gone"
k "forgotten"                    "password, key, askpass"         bash "$S" forget
[ ! -e "$D" ] && m=ok || { m=WRONG; fail=1; }
printf '%-5s %-8s %s\n' "$m" key "the private folder is gone"
rm -rf "$HOME"
[ $fail = 0 ] && echo "ALL OK" || { echo "SOME WRONG"; exit 1; }
