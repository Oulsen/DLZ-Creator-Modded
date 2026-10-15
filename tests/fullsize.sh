#!/bin/bash
# #50 rehearsals (root in WSL, repo root): the installer flow (rehearse-install.sh) on the XS dump, then on a
# full-size test image: a sparse COPY of the dump with /root/.dlzlite removed and the GD32 marker of the
# full-size's firmware instead of the XS's (what the factory leaves on a full-size, flash-gd32.sh). The
# dump itself is only read (cp); debugfs -w runs only on the copy's own loop device. Each card is then
# checked with check-rootfs.sh against the source's model, and the wrong model must be refused.
# Usage: fullsize.sh <pkg dir>
set -u
R=$PWD
PKG=${1:?usage: fullsize.sh <pkg dir>}
DUMP=/root/dlz/orig.img
FS=/root/m15-fullsize.img
OUT=/root/m15-card.img

cardcheck() {   # <card image> <expected model> <wrong model>
  local l; l=$(losetup -P -r -f --show "$1"); mkdir -p /mnt/m15c
  mount -o ro,noload "${l}p1" /mnt/m15c
  echo "card: $(sh install/check-rootfs.sh /mnt/m15c "$2" 2>&1 | head -2 | tr '\n' ' ') rc=${PIPESTATUS[0]}"
  sh install/check-rootfs.sh /mnt/m15c "$3" > /dev/null 2>&1 && echo "card as $3: ACCEPTED (wrong)" || echo "card as $3: refused (right)"
  e2fsck -fn "${l}p1" > /dev/null 2>&1; echo "card p1 e2fsck -fn rc=$?"
  umount /mnt/m15c; losetup -d "$l"; rmdir /mnt/m15c
}

if [ "${SKIP_XS:-}" != 1 ]; then
echo "=== XS (the dump)"
grep -q " /mnt/dlz " /proc/mounts || bash install/mount-ro.sh > /dev/null 2>&1
bash tests/rehearse-install.sh "$OUT" "$PKG" 2>&1 | tail -22
cardcheck "$OUT" XS full-size
rm -f "$OUT" "${OUT%.img}.log"
fi

echo "=== full-size (test image from a copy of the dump)"
umount /mnt/dlz
cp --sparse=always "$DUMP" "$FS"
L=$(losetup -P -f --show "$FS")
[ "$(losetup -n -O BACK-FILE "$L" | tr -d ' ')" = "$FS" ] || { echo "loop is not the copy: stop"; exit 1; }
: > /tmp/m15-empty
# the dump's journal still holds older blocks of /root: replay it first, or the installer's own replay
# (e2fsck -fy on its snapshot) puts the old directory back over the edits below (first run: the
# marker vanished on the card, and card-core.sh refused it)
e2fsck -fy "${L}p1" > /dev/null 2>&1; echo "test image journal replayed: e2fsck rc=$?"
debugfs -w -R "rm /root/.dlzlite" "${L}p1"
debugfs -w -R "rm /root/.gd32-loaded-firmware-dlzlite-154.bin" "${L}p1"
debugfs -w -R "write /tmp/m15-empty /root/.gd32-loaded-firmware-evolve-154.bin" "${L}p1"
losetup -d "$L"
L=$(losetup -P -r -f --show "$FS")
mount -o ro,noload "${L}p1" /mnt/dlz
echo "test image: $(sh install/check-rootfs.sh /mnt/dlz 2>&1 | tr '\n' ' ')"
bash tests/rehearse-install.sh "$OUT" "$PKG" 2>&1 | tail -22
cardcheck "$OUT" full-size XS
umount /mnt/dlz; losetup -d "$L"
rm -f "$OUT" "${OUT%.img}.log" "$FS" /tmp/m15-empty
bash install/mount-ro.sh > /dev/null 2>&1 && echo "dump mounted again: $(sh install/check-rootfs.sh /mnt/dlz)"
