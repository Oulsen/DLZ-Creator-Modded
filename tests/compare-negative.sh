#!/bin/bash
# #49 negative tests of the used-blocks compare (ic_verify), on the PC (root in WSL, repo root, dump
# mounted by mount-ro.sh), in rehearse-install.sh's environment: the pinned busybox, the dump's rootfs as the
# chroot, a tmpfs /dev with a loop mirror, a loop file as the card. One copy (ic_copy), then for each
# case a fresh snapshot (ic_snap_up), a change to the card, ic_verify, the change undone. Each case
# must give the expected result, and leave no snapshot, no compare pipe and no hung process behind.
# Usage: compare-negative.sh [pkg dir]
set -u
R=$PWD
PKGDIR=${1:-$(ls -td build/release/dlzmod-*+dirty | grep -v tar$ | head -1)}
modprobe dm_snapshot || { echo "dm_snapshot: modprobe failed"; exit 1; }   # the chroot's modprobe looks in the device's modules
LP=$(grep " /mnt/dlz " /proc/mounts | cut -d" " -f1); LD=${LP%p1}
[ -b "$LD" ] || { echo "dump not mounted"; exit 1; }
W=$(mktemp -d)
mkdir -p "$W/bb" && qemu-arm "$R/vendor/busybox.bin" --list | while read -r a; do ln -s "$R/vendor/busybox.bin" "$W/bb/$a"; done
C=/mnt/m4card
mkdir -p $C && rm -f $C/card.img && truncate -s 10G $C/card.img
SDL=$(losetup -P -f --show $C/card.img)
echo "eMMC (dump, read-only): $LD  card: $SDL  package: $PKGDIR"

cat > "$W/run.sh" <<EOF
export PATH=$W/bb:/bin:/sbin:/usr/bin:/usr/sbin
# every case makes a fresh snapshot, and e2fsck -fy stamps the superblock with the time: a fixed
# clock (e2fsprogs' own test hooks, 1.46.5 has both) makes the snapshots identical, so only the
# change of each case counts. The installer compares against the snapshot it copied from
export E2FSCK_TIME=1700000000 E2FSPROGS_FAKE_TIME=1700000000
LOG=$W/install.log
: > \$LOG
log() { echo "\$*" >> "\$LOG"; }
gb10() { echo "\$(( (\$1 * 1048576 + 50000000) / 1000000000 )).\$(( (\$1 * 1048576 + 50000000) / 100000000 % 10 ))"; }
EMMC=$LD
SD=$SDL
CH=/mnt/dlz
p1_start=\$(cat /sys/block/${LD#/dev/}/${LD#/dev/}p1/start)
p1_size=\$(cat /sys/block/${LD#/dev/}/${LD#/dev/}p1/size)
copy_mib=\$(( (p1_start + p1_size + 2047) / 2048 ))
VERSION=rehearsal BUILD=pc model='DLZ Creator XS (dump)'
. $R/install/installer/install-card.sh
OFF=\$((p1_start * 512))
F=0
ic_guard > /dev/null && ic_clear && ic_data || { echo "setup FAILED"; tail -5 \$LOG; exit 1; }
rm -f /tmp/ic-copy-ok; ic_copy > /dev/null; [ -e /tmp/ic-copy-ok ] || { echo "copy FAILED"; tail -5 \$LOG; exit 1; }
FS=\$(cat \$CH/tmp/ic-snap-fs)
# blocks to change, from the snapshot ic_copy left up: a data block of a file, a free block, the
# group descriptor block (block 1 with 4 KiB blocks)
DATA=\$(chroot \$CH /usr/sbin/debugfs -R "bmap /etc/passwd 0" \$IC_SNAP_DEV 2>/dev/null | tr -dc 0-9)
FREE=\$(chroot \$CH /usr/sbin/debugfs -R "ffb 1 300000" \$IC_SNAP_DEV 2>/dev/null | tr -dc 0-9)
ic_snap_down
echo "blocks: data \$DATA (of /etc/passwd), free \$FREE, file system \$FS sectors of p1 \$p1_size"
[ -n "\$DATA" ] && [ -n "\$FREE" ] || { echo "block lookup FAILED"; exit 1; }
# flip <byte offset on the card>: one byte xor 0xff (twice = undone)
flip() {
  b=\$(dd if=\$SD bs=1 skip=\$1 count=1 2>/dev/null | od -An -tu1 | tr -d ' ')
  printf "\\\\\$(printf %03o \$(( b ^ 255 )))" | dd of=\$SD bs=1 seek=\$1 count=1 conv=notrunc 2>/dev/null
  sync
}
# killcard: wait for the compare's card-side e2image and kill it. Under qemu (binfmt) its command
# line starts with the qemu wrapper, so ic_pid_of's prefix match (right on the device) misses it here:
# any command line naming "e2image -ra -o", but not the bash whose script text names it
killcard() {
  i=0
  while [ \$i -lt 600 ]; do
    for pd in /proc/[0-9]*; do
      [ -r \$pd/cmdline ] || continue
      c=\$({ tr '\\000' ' ' < \$pd/cmdline; } 2>/dev/null)
      case "\$c" in *bash*) continue ;; *"e2image -ra -o "*) sleep 2; kill \${pd#/proc/} && echo "      (card-side e2image killed: \${pd#/proc/})"; return ;; esac
    done
    sleep 0.2; i=\$((i + 1))
  done
  echo "      (card-side e2image never seen)"
}
# case <name> <expected: pass|fail> <change command> <undo command>
case_() {
  ic_snap_up > /dev/null || { echo "  \$1: snapshot FAILED"; F=\$((F + 1)); return; }
  eval "\$3"
  rm -f /tmp/ic-verify-ok
  s=\$(cut -d' ' -f1 /proc/uptime)
  ic_verify > /dev/null
  e=\$(cut -d' ' -f1 /proc/uptime)
  [ -e /tmp/ic-verify-ok ] && got=pass || got=fail
  eval "\$4"
  left=""
  chroot \$CH /usr/bin/env DM_DISABLE_UDEV=1 /sbin/dmsetup info \$IC_SNAP > /dev/null 2>&1 && left="\$left snapshot"
  [ -e \$CH/tmp/ic-cmpf ] && left="\$left pipe"
  [ -n "\$(ic_pid_of '/sbin/e2image ')" ] && left="\$left e2image"
  t=\$(awk -v a=\$s -v b=\$e 'BEGIN{printf "%.0f", b-a}')
  if [ "\$got" = "\$2" ] && [ -z "\$left" ]; then echo "  ok: \$1: \$got (\$t s)"
  else echo "  FAIL: \$1: \$got, expected \$2\${left:+, left behind:\$left} (\$t s)"; F=\$((F + 1)); fi
  [ "\$got" = fail ] && grep "copy differs" \$LOG | tail -1 | cut -c1-160 | sed 's/^/      log: /'
}
case_ "a nothing changed"            pass ":" ":"
case_ "b a byte of a file's data"    fail "flip \$((OFF + DATA * 4096 + 100))" "flip \$((OFF + DATA * 4096 + 100))"
case_ "c a byte of a free block"     pass "flip \$((OFF + FREE * 4096 + 100))" "flip \$((OFF + FREE * 4096 + 100))"
case_ "d a byte of the group table"  fail "flip \$((OFF + 4096 + 40))" "flip \$((OFF + 4096 + 40))"
case_ "e the card's superblock magic" fail "flip \$((OFF + 1024 + 56))" "flip \$((OFF + 1024 + 56))"
case_ "f the card side killed"       fail "killcard &" ":"
case_ "g a byte of p1 behind the fs" fail "flip \$((OFF + FS * 512 + 10))" "flip \$((OFF + FS * 512 + 10))"
case_ "h a byte of a backup superblock" fail "flip \$((OFF + 32768 * 4096 + 1024 + 100))" "flip \$((OFF + 32768 * 4096 + 1024 + 100))"
ic_bk_release
[ \$F = 0 ] && echo "ALL NEGATIVE TESTS PASSED" || echo "\$F TEST(S) FAILED"
EOF

cat > "$W/devsetup.sh" <<'EOF'
D=/mnt/dlz/dev
mount -t tmpfs -o mode=755 tmpfs $D || exit 1
for n in /dev/*; do
  [ -L "$n" ] && continue
  { [ -b "$n" ] || [ -c "$n" ]; } && cp -a "$n" $D/
done
( while [ -d "$2" ]; do
    for n in /dev/loop*; do
      [ -b "$n" ] || continue
      [ "$(stat -c %t:%T "$n")" = "$(stat -c %t:%T "$D/${n#/dev/}" 2>/dev/null)" ] || { rm -f "$D/${n#/dev/}"; cp -a "$n" $D/ 2>/dev/null; }
    done
    for n in $D/loop*; do [ -e "/dev/${n#$D/}" ] || rm -f "$n"; done
    sleep 0.05
  done ) &
sed -n '/^ln -sf \/proc\/self\/fd /,/stderr$/p' "$1/install/installer/init" | sed 's# /dev/# /mnt/dlz/dev/#g' > "$2/devlinks.sh"
sh "$2/devlinks.sh"
EOF

unshare -m --propagation private bash -c "
  mount -t tmpfs tmpfs /mnt/dlz/tmp && bash $W/devsetup.sh $R $W && mount -t proc proc /mnt/dlz/proc && mount -t sysfs sysfs /mnt/dlz/sys || { echo 'chroot setup failed'; exit 1; }
  mount -t tmpfs tmpfs /mnt/dlz/mnt && mkdir /mnt/dlz/mnt/m4card && mount --bind $C /mnt/dlz/mnt/m4card
  R=$R; mkdir -p /mnt/dlz$R/vendor && touch /mnt/dlz$R/vendor/busybox.bin && mount --bind $R/vendor/busybox.bin /mnt/dlz$R/vendor/busybox.bin
  mkdir /mnt/dlz/tmp/i && (cd /mnt/dlz/tmp/i && zcat $R/$PKGDIR/initrd.cpio.gz | cpio -idm --quiet) && mv /mnt/dlz/tmp/i/pkg /mnt/dlz/tmp/pkg
  $W/bb/sh $W/run.sh
"
cp "$W/install.log" build/compare-negative.log
dmsetup ls | grep -q ic-snap && { echo "LEFT BEHIND: ic-snap"; dmsetup remove ic-snap; }
losetup -d "$SDL"
rm -f $C/card.img && rmdir $C
rm -rf "$W"
