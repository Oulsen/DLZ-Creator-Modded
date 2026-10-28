#!/bin/bash
# Test rig cache (root in WSL, repo root). The rehearsals run the mixer's own ARM tools under qemu, so
# an install takes minutes: what does not change between reruns is made once and kept in /root/rig.
#   full-size source  a COPY of the dump (the dump is only read) as the factory leaves a full-size:
#                     journal replayed first (else the installer's own replay puts the old /root back),
#                     /root/.dlzlite removed, the GD32 marker of the full-size's firmware
#   cards             one per package and model, made by rehearse-install.sh from that source
# Each cached image takes ~2.5 GB inside WSL's disk (it does not shrink by itself): clean at the end.
# Usage: rig.sh card <XS|full-size> <pkg dir>          prints the cached card (made when missing)
#        rig.sh copy <XS|full-size> <pkg dir> <out>    a scratch copy of it, for tests that change it
#        rig.sh clean
set -u
C=/root/rig
DUMP=/root/dlz/orig.img
FS_SRC=$C/fullsize-src.img
mkdir -p $C
die() { echo "rig: $*" >&2; exit 1; }
# #190: the mixer's busybox starts itself again through /proc/self/exe for a command in a pipe; qemu
# before 8 hands that exec to qemu itself ("qemu: unknown option 'c'"), and the install rehearsal
# then fails at its source check (check-rootfs.sh) without saying why. Checked as the rehearsal runs
# it: busybox's applets through binfmt, the same pipe as that check
qcheck() {
  local b t
  [ -e /proc/sys/fs/binfmt_misc/qemu-arm ] \
    || die "no binfmt registration for ARM programs (apt install qemu-user qemu-user-binfmt; tests/README.md)"
  b=$(readlink -f "$(dirname "$0")/../vendor/busybox.bin")
  [ -f "$b" ] || die "no vendor/busybox.bin (git-ignored): . install/release/vendor.sh && vendor_prepare vendor (docs/DEVELOPMENT.md)"
  t=$(mktemp -d) || die "mktemp failed"
  for a in sh echo grep head; do ln -s "$b" "$t/$a"; done
  if [ "$(PATH=$t "$t/sh" -c "echo 'build 1731' | grep -o 'build [0-9]*' | head -1" 2>&1)" != "build 1731" ]; then
    rm -rf "$t"
    die "this qemu cannot run the mixer's busybox in a pipe ($(qemu-arm --version 2>/dev/null | head -1)): needs qemu 8 or later, Ubuntu 24.04 or later (tests/README.md, #190)"
  fi
  rm -rf "$t"
}
[ "${1:-}" = clean ] || qcheck
modprobe dm_snapshot || die "modprobe dm_snapshot failed"   # the chroot's modprobe looks in the device's modules

full_src() {
  [ -f $FS_SRC ] && return
  echo "rig: making the full-size source (once)" >&2
  local l e
  cp --sparse=always $DUMP $FS_SRC.part || die "copy failed"
  l=$(losetup -P -f --show $FS_SRC.part)
  [ "$(losetup -n -O BACK-FILE $l | tr -d ' ')" = $FS_SRC.part ] || { losetup -d $l; die "loop is not the copy"; }
  e2fsck -fy ${l}p1 > /dev/null 2>&1
  : > /tmp/rig-empty
  # stdout too: card() prints the card's path on stdout, and debugfs's "Allocated inode: N" landed in
  # it on a fresh source (losetup then found no such file, cardbind's full-size checks failed)
  debugfs -w -R "rm /root/.dlzlite" ${l}p1 > /dev/null 2>&1
  debugfs -w -R "rm /root/.gd32-loaded-firmware-dlzlite-154.bin" ${l}p1 > /dev/null 2>&1
  debugfs -w -R "write /tmp/rig-empty /root/.gd32-loaded-firmware-evolve-154.bin" ${l}p1 > /dev/null 2>&1
  e=$(e2fsck -fn ${l}p1 > /dev/null 2>&1; echo $?)
  losetup -d $l; rm -f /tmp/rig-empty
  [ "$e" = 0 ] || die "full-size source: e2fsck -fn rc=$e"
  mv $FS_SRC.part $FS_SRC
}

# the eMMC stand-in for a model at /mnt/dlz (read-only): the dump, or the full-size source
mount_src() {
  if grep -q " /mnt/dlz " /proc/mounts; then
    local lp=$(grep " /mnt/dlz " /proc/mounts | cut -d" " -f1)
    umount /mnt/dlz; losetup -d ${lp%p1} 2>/dev/null
  fi
  if [ "$1" = XS ]; then
    bash install/mount-ro.sh > /dev/null 2>&1 || die "mount-ro.sh failed"
  else
    full_src
    local l=$(losetup -P -r -f --show $FS_SRC)
    mount -o ro,noload ${l}p1 /mnt/dlz || die "full-size source does not mount"
  fi
  sh install/check-rootfs.sh /mnt/dlz "$1" > /dev/null || die "the $1 source does not pass check-rootfs.sh"
}

card() {   # <model> <pkg dir>: prints the card's path
  local m=$1 p=${2%/} out
  case $m in XS|full-size) ;; *) die "model XS or full-size" ;; esac
  [ -d "$p" ] || die "no package dir $p"
  out=$C/$(basename "$p")-$m.img
  if [ ! -f $out ]; then
    echo "rig: making the $m card for $(basename "$p") (once)" >&2
    mount_src $m
    bash tests/rehearse-install.sh $out.part "$p" > $C/$(basename "$p")-$m.log 2>&1
    rm -f $out.part.log
    grep -q "^rc=0" $C/$(basename "$p")-$m.log || { rm -f $out.part; mount_src XS; die "rehearsal failed, see $C/$(basename "$p")-$m.log"; }
    mv $out.part $out
    mount_src XS   # the dump back at /mnt/dlz, as the other scripts expect
  fi
  echo $out
}

case ${1:-} in
  card) card "${2:-}" "${3:-}" ;;
  copy) src=$(card "${2:-}" "${3:-}") || exit 1; cp --sparse=always $src "${4:?out}" && echo "${4}" ;;
  clean) rm -rf $C && echo "rig: cache removed" ;;
  *) die "usage: rig.sh card|copy <XS|full-size> <pkg dir> [out] | clean" ;;
esac
