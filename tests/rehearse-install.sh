#!/bin/bash
# Milestone 4 rehearsal on the PC (run as root in WSL from the repo root, dump mounted by mount-ro.sh):
# install-card.sh's steps verbatim, under the pinned busybox as on the device (its applets first in
# PATH, run through binfmt), with the read-only dump as the eMMC, a sparse 8 GiB file as the card and
# the dump's own rootfs as the chroot with the stock tools. Output: the card image given as $1.
# DLZMOD_UUID / SOURCE_DATE_EPOCH from the environment reach card-core.sh (for comparing with a PC build).
set -u
R=$PWD
OUT=${1:?usage: rehearse-install.sh <card image out> [pkg dir]}
PKGDIR=${2:-$(ls -td build/release/dlzmod-*+dirty | grep -v tar$ | head -1)}
# the installer's modprobe runs in the dump's chroot (the device's modules): load WSL's own dm-snapshot
# first, a fresh WSL has it as a module (CONFIG_DM_SNAPSHOT=m)
modprobe dm_snapshot || { echo "dm_snapshot: modprobe failed"; exit 1; }
LP=$(grep " /mnt/dlz " /proc/mounts | cut -d" " -f1); LD=${LP%p1}
[ -b "$LD" ] || { echo "dump not mounted"; exit 1; }
W=$(mktemp -d)
mkdir -p "$W/bb" && qemu-arm "$R/vendor/busybox.bin" --list | while read -r a; do ln -s "$R/vendor/busybox.bin" "$W/bb/$a"; done
# the card file sits at a path that exists inside the chroot too (/mnt/m4card on ext4; in the chroot a
# tmpfs over the dump's empty /mnt holds the bind mount):
# card-core.sh checks the loop's backing file from inside the chroot
C=/mnt/m4card
mkdir -p $C && rm -f $C/card.img && truncate -s 10G $C/card.img
SDL=$(losetup -P -f --show $C/card.img)
echo "eMMC (dump, read-only): $LD  card: $SDL  package: $PKGDIR"

cat > "$W/run.sh" <<EOF
export PATH=$W/bb:/bin:/sbin:/usr/bin:/usr/sbin
LOG=$W/install.log
: > \$LOG
log() { echo "\$*" >> "\$LOG"; echo "  \$*"; }
gb10() { echo "\$(( (\$1 * 1048576 + 50000000) / 1000000000 )).\$(( (\$1 * 1048576 + 50000000) / 100000000 % 10 ))"; }
EMMC=$LD
SD=$SDL
CH=/mnt/dlz
p1_start=\$(cat /sys/block/${LD#/dev/}/${LD#/dev/}p1/start)
p1_size=\$(cat /sys/block/${LD#/dev/}/${LD#/dev/}p1/size)
copy_mib=\$(( (p1_start + p1_size + 2047) / 2048 ))
VERSION=rehearsal BUILD=pc model='DLZ Creator XS (dump)'
# the source's model as init finds it (check-rootfs.sh on the eMMC rootfs): XS, or full-size on a
# test image without /root/.dlzlite
src=\$(sh $R/install/check-rootfs.sh \$CH) || { echo "source check failed: \$src"; exit 1; }
IC_MODEL=\${src#source: DLZ Creator }; IC_MODEL=\${IC_MODEL%%,*}
echo "source: \$src (model \$IC_MODEL)"
# a loop device has no CID: a fixed stand-in, as init computes it on the device (sha256 of the CID)
IC_MIXER_ID=\$(echo rehearsal-emmc-cid | sha256sum | cut -d' ' -f1)
. $R/install/installer/install-card.sh
# the estimates' device times, for this PC (the copy ~7x faster here: 41 s for 2317 MiB)
IC_COPY_MS=\${REH_COPY_MS:-18} IC_BUILD_SECS=\${REH_BUILD_SECS:-30}
t=\$(cut -d' ' -f1 /proc/uptime)
mark() { cut -d' ' -f1 /proc/uptime > "$W/t-\$1"; }
step() { echo "== \$1 (\$(awk -v a=\$t -v b=\$(cut -d' ' -f1 /proc/uptime) 'BEGIN{printf "%.0f", b-a}') s)"; }
# the progress lines with their time (uptime) in $W/prog-<name>.txt, the last one on stdout
stamp() { awk -v f="$W/prog-\$1.txt" '{ getline u < "/proc/uptime"; close("/proc/uptime"); split(u, a, " "); print a[1] "\t" \$0 > f; last = \$0 } END { close(f); print last }'; }
# a progress round must stay cheap: on the mixer each process start costs ~0.5 s under the copy's load,
# and rounds of ~20 took ~17 s and slowed the copy by half [device]. Here, over the lines
# with a percentage (the log lines in between are not progress), the first gap (setup before the
# loop) left out: the mean gap at most 6 s (a round is 2 s of sleep and one awk, slower under qemu),
# no gap over 20 s (a blind stretch: busybox's wc -c read the 978 MiB backup in full, 35-38 s here)
gaps() { awk -F'\t' -v n="\$1" '\$2 !~ /^[0-9]+\$/ { next } { k++ } k > 2 { d = \$1 - p; g += d; if (d > x) x = d } { p = \$1 } END {
  c = (k > 2) ? k - 2 : 0; m = (c > 0) ? g / c : 0
  printf "  %s: %d progress lines, mean gap %.1f s, longest %.1f s\n", n, k, m, x
  if (c >= 3 && (m > 6 || x > 20)) { print "  " n ": progress rounds too slow or a blind stretch"; exit 1 } }' "$W/prog-\$1.txt"; }
# the shown times left against the real ones (#66): the step's (until its end mark) and the whole
# install's (until the bootloader is on), each line's "about N min" / "less than a minute" (30 s)
# within twice the real time plus a minute, and the real time within twice the shown one plus two
estimates() { awk -F'\t' -v n="\$1" -v e1="\$(cat $W/t-\$1)" -v ea="\$(cat $W/t-all)" '
  function shown(s,   a) { if (s ~ /ess than a minute left/) return 30; if (match(s, /bout [0-9]+ min left/)) { split(substr(s, RSTART + 5), a, " "); return a[1] * 60 } return -1 }
  function check(w, sh, real) { if (sh < 0) return; k++; if (sh > 2 * real + 60 || real > 2 * sh + 120) { bad++; printf "  %s: %s shown %d s, real %d s: %s\n", n, w, sh, real, \$3 } }
  \$2 ~ /^[0-9]+\$/ { check("step", shown(\$3), e1 - \$1); check("whole install", shown(\$4), ea - \$1) }
  END { printf "  %s: %d times left checked against the real ones, %d far off\n", n, k, bad; exit (bad > 0 || k < 4) }' "$W/prog-\$1.txt"; }
step guard;      ic_guard || exit 1
step clear;      ic_clear || exit 1
step data;       ic_data || { tail -5 \$LOG; exit 1; }
step copy;       rm -f /tmp/ic-copy-ok; ic_copy | stamp copy; mark copy; [ -e /tmp/ic-copy-ok ] || { echo "copy FAILED"; exit 1; }
gaps copy || exit 1
step verify;     rm -f /tmp/ic-verify-ok; ic_verify | stamp verify; [ -e /tmp/ic-verify-ok ] || { echo "verify FAILED"; exit 1; }
gaps verify || exit 1
step backup;     rm -f /tmp/ic-bk-ok; ic_bk_finish | tail -1; mark verify; [ -e /tmp/ic-bk-ok ] || { echo "backup FAILED"; tail -5 \$LOG; exit 1; }
step build;      ic_build | tail -12; [ -e /tmp/ic-build-ok ] || { cat /tmp/ic-build-fail; tail -20 \$LOG; exit 1; }
step bootloader; ic_bootloader || exit 1
mark all
step done
estimates copy && estimates verify || exit 1
grep -q "progress: step 1, " \$LOG && grep -q "progress: step 2, " \$LOG || { echo "no progress lines in the install log"; exit 1; }
EOF

# the chroot's /dev as on the device: init's bare devtmpfs has the device nodes but none of udev's
# links (fd, stdin, ...); init then adds its own links, taken from init itself (NODEVFD=1 leaves
# them out: card-core.sh must then fail, as it did on the device without them)
cat > "$W/devsetup.sh" <<'EOF'
D=/mnt/dlz/dev
mount -t tmpfs -o mode=755 tmpfs $D || exit 1
for n in /dev/*; do
  [ -L "$n" ] && continue
  { [ -b "$n" ] || [ -c "$n" ]; } && cp -a "$n" $D/
done
# the device's devtmpfs is live (the kernel adds loop1p1 etc. when a table is read); this copy is
# kept in step for loop devices by a mirror loop (WSL's own devtmpfs already holds udev-style links
# and is shared with WSL, so it cannot stand in for the device's)
( while [ -d "$2" ]; do
    for n in /dev/loop*; do   # new, or the same name with another device number (partitions get dynamic ones)
      [ -b "$n" ] || continue
      [ "$(stat -c %t:%T "$n")" = "$(stat -c %t:%T "$D/${n#/dev/}" 2>/dev/null)" ] || { rm -f "$D/${n#/dev/}"; cp -a "$n" $D/ 2>/dev/null; }
    done
    for n in $D/loop*; do [ -e "/dev/${n#$D/}" ] || rm -f "$n"; done
    sleep 0.05
  done ) &
if [ "${NODEVFD:-}" = 1 ]; then
  echo "/dev without the fd links (NODEVFD=1)"
else
  sed -n '/^ln -sf \/proc\/self\/fd /,/stderr$/p' "$1/install/installer/init" | sed 's# /dev/# /mnt/dlz/dev/#g' > "$2/devlinks.sh"
  [ "$(grep -o 'ln -sf' "$2/devlinks.sh" | wc -l)" = 4 ] || { echo "init's /dev links not found"; exit 1; }
  sh "$2/devlinks.sh" && echo "/dev links as in init: $(ls -l $D/fd | sed 's/.* -> //')"
fi
EOF

unshare -m --propagation private bash -c "
  mount -t tmpfs tmpfs /mnt/dlz/tmp && bash $W/devsetup.sh $R $W && mount -t proc proc /mnt/dlz/proc && mount -t sysfs sysfs /mnt/dlz/sys || { echo 'chroot setup failed'; exit 1; }
  mount -t tmpfs tmpfs /mnt/dlz/mnt && mkdir /mnt/dlz/mnt/m4card && mount --bind $C /mnt/dlz/mnt/m4card
  R=$R; mkdir -p /mnt/dlz$R/vendor && touch /mnt/dlz$R/vendor/busybox.bin && mount --bind $R/vendor/busybox.bin /mnt/dlz$R/vendor/busybox.bin  # busybox can re-exec itself in the chroot, as on the device
  mkdir /mnt/dlz/tmp/i && (cd /mnt/dlz/tmp/i && zcat $R/$PKGDIR/initrd.cpio.gz | cpio -idm --quiet) && mv /mnt/dlz/tmp/i/pkg /mnt/dlz/tmp/pkg
  cmp /mnt/dlz/tmp/i/pkg/../init $R/install/installer/init >/dev/null 2>&1; cmp /mnt/dlz/tmp/pkg/install-card.sh $R/install/installer/install-card.sh && echo 'package install-card.sh = source'
  $W/bb/sh $W/run.sh
  echo \"rc=\$?\"
"
cp "$W/install.log" "${OUT%.img}.log"
for f in "$W"/prog-*.txt; do [ -e "$f" ] && cp "$f" "${OUT%.img}-${f##*/}"; done   # timed progress lines
losetup -d "$SDL"
rm -f "$OUT" && mv $C/card.img "$OUT" && rmdir $C
rm -rf "$W"
echo "log: ${OUT%.img}.log"
