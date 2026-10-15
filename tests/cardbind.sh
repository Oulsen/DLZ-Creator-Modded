#!/bin/bash
# Card bound to its mixer, both models (root in WSL, repo root, dump mounted). Both models run the same
# firmware (only /root/.dlzlite and the GD32 marker differ), so the full-size gets the quick checks:
# 1. the gate itself (cardcheck.sh, fake tree, ~30 s)
# 2. one card per model from the rig cache (rig.sh: an install rehearsal once per package and model);
#    on each: mixer-id = the rehearsal's stand-in hash, the gate and its FPGA drop-in as in the source,
#    check-rootfs.sh accepts it as its own model and refuses it as the other
# 3. the drop-in update tests, in parallel on scratch copies: XS all cases, full-size QUICK=1
# FULL=1 adds the full-size install rehearsal from a fresh source (fullsize.sh, ~8 min): only when the
# install's write path changes, and once on a release candidate.
# Usage: [FULL=1] [DLZMOD_SIGNING_KEYS=<dev key folder>] cardbind.sh [pkg dir, default: a package of
#        the working tree]
set -u
fails=0
note() { echo "  $1"; case $1 in FAIL*) fails=$((fails+1)) ;; esac; }
PKG=${1:-}
if [ -z "$PKG" ]; then
  echo "=== package"
  bash install/release/mkpackage.sh 2>&1 | grep -E "^package:|NOT SIGNED|rror" | tail -3
  PKG=$(ls -dt build/release/dlzmod-*/ | head -1)
fi
PKG=${PKG%/}
echo "package dir: $PKG"

echo "=== the gate"
bash tests/cardcheck.sh > build/cardbind-gate.log 2>&1 || fails=$((fails+1))
grep -E "FAIL|^cardcheck:" build/cardbind-gate.log

want=$(echo rehearsal-emmc-cid | sha256sum | cut -d' ' -f1)
for m in XS full-size; do
  echo "=== $m card (rig cache)"
  card=$(bash tests/rig.sh card $m "$PKG") || { note "FAIL: no $m card"; continue; }
  other=XS; [ $m = XS ] && other=full-size
  L=$(losetup -P -r -f --show "$card"); mkdir -p /mnt/cbc; mount -o ro,noload "${L}p1" /mnt/cbc
  [ "$(cat /mnt/cbc/etc/dlzmod/mixer-id)" = "$want" ] && note "ok: mixer-id is the installer's hash" \
    || note "FAIL: mixer-id '$(cat /mnt/cbc/etc/dlzmod/mixer-id 2>&1)'"
  cmp -s /mnt/cbc/usr/local/sbin/dlzmod-cardcheck install/sd-system/dlzmod-cardcheck && [ -x /mnt/cbc/usr/local/sbin/dlzmod-cardcheck ] \
    && note "ok: dlzmod-cardcheck installed, executable, same as the source" || note "FAIL: dlzmod-cardcheck"
  cmp -s /mnt/cbc/etc/systemd/system/flash-fpga.service.d/dlzmod.conf install/sd-system/flash-fpga.service.d/dlzmod.conf \
    && note "ok: flash-fpga drop-in installed" || note "FAIL: flash-fpga drop-in"
  sh install/check-rootfs.sh /mnt/cbc $m > /dev/null 2>&1 && note "ok: check-rootfs.sh accepts it as $m" || note "FAIL: refused as $m"
  sh install/check-rootfs.sh /mnt/cbc $other > /dev/null 2>&1 && note "FAIL: accepted as $other" || note "ok: refused as $other"
  umount /mnt/cbc; losetup -d "$L"; rmdir /mnt/cbc
done

echo "=== drop-in update tests (XS all, full-size quick; in parallel)"
X=$(bash tests/rig.sh copy XS "$PKG" /root/cb-XS.img) && F=$(bash tests/rig.sh copy full-size "$PKG" /root/cb-full.img) || note "FAIL: scratch copies"
bash tests/update.sh "$X" "$PKG.tar" > build/cardbind-update-XS.log 2>&1 &
QUICK=1 bash tests/update.sh "$F" "$PKG.tar" > build/cardbind-update-full-size.log 2>&1 &
wait
for l in build/cardbind-update-XS.log build/cardbind-update-full-size.log; do
  r=$(grep -E "^ALL UPDATE CHECKS PASSED|FAIL" "$l" | head -5)
  grep -q "^ALL UPDATE CHECKS PASSED" "$l" && note "ok: ${l#build/} ($(grep -c '^  ok' "$l") ok)" || note "FAIL: ${l#build/}: $r"
done
rm -f /root/cb-XS.img /root/cb-full.img /root/cb-XS.log /root/cb-full.log

if [ "${FULL:-}" = 1 ]; then
  echo "=== full-size install rehearsal from a fresh source"
  SKIP_XS=1 bash tests/fullsize.sh "$PKG" 2>&1 | grep -E "^test image|^== |step [45]|card-core|rc=|^card|FAIL|refus" | tail -12
fi
echo "cardbind: $([ $fails = 0 ] && echo "ALL PASSED" || echo "$fails FAILED")"
[ $fails = 0 ]
