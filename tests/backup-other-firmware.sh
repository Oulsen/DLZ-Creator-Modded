#!/bin/bash
# #46 dump rehearsal on the PC (root in WSL, repo root, dump mounted): probe.sh's report, the
# bootloader check and the backup of a "not supported" mixer onto a fake installer card (MBR, 64 MiB
# FAT32 DLZINSTALL at 1 MiB like mkinstaller.sh, mounted at /sd for the log), under the pinned busybox,
# with the dump as the eMMC and its rootfs as the chroot. Then checks the result from outside.
# Usage: tests/backup-other-firmware.sh <pkg dir> [card MiB, default 10240]
set -u
R=$PWD
PKGDIR=${1:?pkg dir}
MIB=${2:-10240}
LP=$(grep " /mnt/dlz " /proc/mounts | cut -d" " -f1); LD=${LP%p1}
[ -b "$LD" ] || { echo "dump not mounted"; exit 1; }
W=$(mktemp -d)
mkdir -p "$W/bb" && qemu-arm "$R/vendor/busybox.bin" --list | while read -r a; do ln -s "$R/vendor/busybox.bin" "$W/bb/$a"; done
C=/mnt/m13card
mkdir -p $C && rm -f $C/card.img && truncate -s ${MIB}M $C/card.img
printf 'label: dos\nstart=2048, size=131072, type=c\n' | sfdisk --quiet $C/card.img
SDL=$(losetup -P -f --show $C/card.img)
for i in 1 2 3 4 5 6 7 8 9 10; do [ -b ${SDL}p1 ] && break; sleep 0.5; done
[ -b ${SDL}p1 ] || { echo "${SDL}p1 missing"; losetup -d $SDL; exit 1; }
mkfs.vfat -F 32 -s 1 -n DLZINSTALL ${SDL}p1 >/dev/null && mkdir -p $W/fat && mount ${SDL}p1 $W/fat && echo installer > $W/fat/marker.txt && umount $W/fat
echo "eMMC (dump, read-only): $LD  installer card: $SDL ($MIB MiB)  package: $PKGDIR"
# two more cards for the pre-offer checks: too small (1.5 GiB), and one cut off after the table write
# (p2 from the end of p1 to the end of the card in the table, no file system on it)
rm -f $C/small.img $C/half.img && truncate -s 1536M $C/small.img && truncate -s 6144M $C/half.img
printf 'label: dos\nstart=2048, size=131072, type=c\n' | sfdisk --quiet $C/small.img
printf 'label: dos\nstart=2048, size=131072, type=c\nstart=133120, type=c\n' | sfdisk --quiet $C/half.img
SL2=$(losetup -P -f --show $C/small.img); SL3=$(losetup -P -f --show $C/half.img)
sleep 1; echo "small card: $SL2  half-made card: $SL3"

cat > "$W/run.sh" <<EOF
export PATH=$W/bb:/bin:/sbin:/usr/bin:/usr/sbin
LOG=/sd/dlzmod-logs/install-1.txt
log() { echo "[\$(cut -d' ' -f1 /proc/uptime)] \$*" >> "\$LOG"; echo "  \$*"; }
gb10() { echo "\$(( (\$1 * 1048576 + 50000000) / 1000000000 )).\$(( (\$1 * 1048576 + 50000000) / 100000000 % 10 ))"; }
mkdir -p /sd/dlzmod-logs
EMMC=$LD SD=$SDL CH=/mnt/dlz PKG=/mnt/dlz/tmp/pkg VERSION=rehearsal BUILD=pc
src="source: DLZ Creator full-size, evolve-node 3297 (build 1794), GD32 marker missing"
model="DLZ Creator full-size, evolve-node 3297 (build 1794)"
. /mnt/dlz/tmp/pkg/install-card.sh
. /mnt/dlz/tmp/pkg/probe.sh
echo "== bootloader: \$(pr_bootloader)"
echo "== known as: \$(pr_known || echo NONE)"
pr_report > $W/hardware.txt 2>> "\$LOG" && echo "== report: \$(wc -l < $W/hardware.txt) lines"
pr_dump_ready && echo "== ready 1: plan \$PR_PLAN" || echo "== ready 1: NOT READY: \$PR_WHY"
t=\$(cut -d' ' -f1 /proc/uptime)
pr_dump | tail -3
[ -e /tmp/pr-dump-ok ] || { echo "DUMP FAILED"; tail -8 "\$LOG"; exit 1; }
echo "== dump ok in \$(awk -v a=\$t -v b=\$(cut -d' ' -f1 /proc/uptime) 'BEGIN{printf "%.0f", b-a}') s, folder \$(cat /tmp/pr-dir)"
echo "== a power loss left backup-2/*.part behind"
mount -t vfat -o iocharset=ascii,flush \${SD}p2 \$CH\$PR_DUMP && mkdir \$CH\$PR_DUMP/backup-2 && echo x > \$CH\$PR_DUMP/backup-2/emmc-user.img.zst.part && umount \$CH\$PR_DUMP
echo "== second run (DLZDUMP reused, stale .part cleared, backup-2)"
pr_dump | tail -1
[ -e /tmp/pr-dump-ok ] && echo "== second dump ok, folder \$(cat /tmp/pr-dir)" || { echo "SECOND DUMP FAILED"; tail -5 "\$LOG"; exit 1; }
echo "== abort: a half-written backup-3 is cleaned up"
mount -t vfat -o iocharset=ascii,flush \${SD}p2 \$CH\$PR_DUMP && mkdir \$CH\$PR_DUMP/backup-3 && echo x > \$CH\$PR_DUMP/backup-3/emmc-user.img.zst.part
pr_dump_abort
echo "   folders on DLZDUMP: \$(ls \$CH\$PR_DUMP/ | tr '\n' ' ')"
umount \$CH\$PR_DUMP
pr_dump_ready && echo "== ready 2: plan \$PR_PLAN" || echo "== ready 2: NOT READY: \$PR_WHY"
echo "== small card (1.5 GiB)"
SD=$SL2
pr_dump_ready && echo "== ready small: plan \$PR_PLAN" || echo "== ready small: NOT READY: \$PR_WHY"
echo "== half-made card (p2 in the table, no file system)"
SD=$SL3
pr_dump_ready && echo "== ready half: plan \$PR_PLAN" || echo "== ready half: NOT READY: \$PR_WHY"
pr_dump_part && echo "== half: label now \$(chroot \$CH /usr/sbin/blkid -p -o value -s LABEL \${SD}p2)"
pr_dump_ready && echo "== ready half after: plan \$PR_PLAN" || echo "== ready half after: NOT READY: \$PR_WHY"
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
  mkdir -p /sd && mount -t vfat -o iocharset=ascii,flush ${SDL}p1 /sd || { echo 'installer FAT mount failed'; exit 1; }
  mkdir /mnt/dlz/tmp/i && (cd /mnt/dlz/tmp/i && zcat $R/$PKGDIR/initrd.cpio.gz | cpio -idm --quiet) && mv /mnt/dlz/tmp/i/pkg /mnt/dlz/tmp/pkg
  $W/bb/sh $W/run.sh > $W/run.out 2>&1; echo \"rc=\$?\"; cat $W/run.out
  cp /sd/dlzmod-logs/install-1.txt $W/install.log
  umount /sd
"
cp $W/hardware.txt build/backup-other-firmware-hardware.txt; cp $W/install.log build/backup-other-firmware.log
echo "== checks from outside"
F=0
ok() { echo "  ok: $*"; }; bad() { echo "  FAIL: $*"; F=$((F+1)); }
sfdisk -d $C/card.img | grep start=
mkdir -p $W/m && mount -o ro ${SDL}p1 $W/m && { [ "$(cat $W/m/marker.txt)" = installer ] && ok "installer FAT untouched (marker), log there: $(ls $W/m/dlzmod-logs)" || bad "installer FAT changed"; umount $W/m; }
mount -o ro ${SDL}p2 $W/m || bad "DLZDUMP does not mount"
ls -la $W/m $W/m/backup-1
zstd -q -dc $W/m/backup-1/emmc-user.img.zst | cmp - /root/dlz/orig.img && ok "backup-1 unpacks to orig.img exactly" || bad "backup-1 differs"
[ -e $W/m/backup-2/emmc-user.img.zst ] && ok "backup-2 there" || bad "no backup-2"
ls $W/m/backup-*/ | grep -q part$ && bad ".part left" || ok "no .part files"
[ -e $W/m/backup-3 ] && bad "empty backup-3 left" || ok "aborted backup-3 folder removed"
ls $W/m/backup-*/ | grep -q "emmc-boot" && bad "boot areas in the backup" || ok "no boot-area files"
grep -q "discord.gg/Qa2fjzVbGp" $W/m/backup-1/README.txt && ok "README: Discord link" || bad "README: no Discord link"
grep -q "lock PIN" $W/m/backup-1/README.txt && ok "README: lock PIN wording" || bad "README: no lock PIN wording"
grep -qi "password" $W/m/backup-1/README.txt && bad "README says password" || ok "README: no 'password'"
[ -s $W/m/backup-1/hardware.txt ] && ok "hardware.txt next to the backup" || bad "no hardware.txt"
cat $W/m/backup-1/README.txt
umount $W/m
grep -v "^(read-only" build/backup-other-firmware-hardware.txt | grep -i -E "serial|([0-9a-f]{2}:){5}[0-9a-f]{2}|uuid" && bad "report has serial/MAC/UUID-like text" || ok "report: no serial/MAC/UUID-like text"
grep -q "unfinished backup of an earlier run deleted" build/backup-other-firmware.log && ok "stale .part of a cut-off run cleared" || bad "stale .part not cleared"
grep -q "== ready 1: plan new" $W/run.out && ok "ready on a fresh card: plan new" || bad "ready 1 not 'plan new'"
grep -q "== ready 2: plan reuse" $W/run.out && ok "ready with DLZDUMP: plan reuse" || bad "ready 2 not 'plan reuse'"
grep -q "== ready small: NOT READY: Not enough room" $W/run.out && ok "small card refused before the offer, with the room needed" || bad "small card not refused"
grep -q "== ready half: plan repair" $W/run.out && ok "half-made card: plan repair" || bad "half-made card not 'repair'"
grep -q "== half: label now DLZDUMP" $W/run.out && ok "half-made card repaired (DLZDUMP)" || bad "half-made card not repaired"
grep -q "== ready half after: plan reuse" $W/run.out && ok "repaired card then reused" || bad "repaired card not reused"
losetup -d $SDL $SL2 $SL3
rm -f $C/card.img $C/small.img $C/half.img; rmdir $C; rm -rf $W
[ $F = 0 ] && echo "ALL CHECKS PASSED" || echo "$F CHECK(S) FAILED"
