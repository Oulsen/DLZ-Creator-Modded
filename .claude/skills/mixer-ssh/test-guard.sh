#!/bin/bash
# Run from anywhere in WSL: bash .claude/skills/mixer-ssh/test-guard.sh (after every change to WRITE_RE/CMDPOS/ARG_RE)
# The wrapper's read-only guard, offline: an empty HOME = no stored address, so a command that passes
# the guard stops at "no mixer address stored" and never connects.
S=$(dirname "$(readlink -f "$0")")/dlz-ssh.sh
export HOME=$(mktemp -d)
fail=0
t() {   # t <expected allowed|REFUSED> <command>
  out=$(bash "$S" run "$2" 2>&1)
  case $out in *REFUSED*) r=REFUSED ;; *"no mixer address"*) r=allowed ;; *) r="?? $out" ;; esac
  [ "$r" = "$1" ] && m=ok || { m=WRONG; fail=1; }
  printf '%-5s %-8s %s\n' "$m" "$r" "$2"
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
rm -rf "$HOME"
[ $fail = 0 ] && echo "ALL OK" || echo "SOME WRONG"
