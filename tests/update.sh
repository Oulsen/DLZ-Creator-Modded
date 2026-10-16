#!/bin/bash
# Drop-in update rehearsal (root in WSL, repo root): on a card image from rehearse-install.sh, the card's
# own installed /usr/local/sbin/dlzmod-update runs in a chroot of the card's rootfs (ARM via qemu
# binfmt: the card's bash, python3, tar, cpio), DLZDATA bind-mounted in. Crafted packages are the real
# one with one change inside and every manifest made again (as mkpackage does), so only the check
# under test can stop them. Signed (#11): the card's trusted keys are swapped for throwaway test keys
# made here (release + dev, as on a developer card), and every package is signed with them; the real
# keys are never used. The card's own keys from the install are checked against install/keys first.
# Usage: update.sh <card.img> <package .tar>
set -u
# own mount namespace, private: WSL's mounts are shared, and unmounting the chroot's /dev bind
# recursively took WSL's own /dev/pts with it (WSL hung)
if [ -z "${M7_NS:-}" ]; then M7_NS=1 exec unshare -m --propagation private bash "$0" "$@"; fi
IMG=${1:?card image}; PKG=$(readlink -f "${2:?package tar}")
HERE=$(cd "$(dirname "$0")" && pwd)
REPO=$(dirname "$HERE")
W=$(mktemp -d)
F=0
ok() { echo "  ok: $*"; }; bad() { echo "  FAIL: $*"; F=$((F + 1)); }
L=$(losetup -P -f --show "$IMG")
for i in 1 2 3 4 5 6 7 8 9 10; do [ -b ${L}p2 ] && break; sleep 0.5; done
R=$W/root D=$W/data
mkdir -p $R $D && mount ${L}p1 $R && mount ${L}p2 $D || { echo "mount failed"; losetup -d $L; exit 1; }
mkdir -p $R/mnt/dlzdata && mount --bind $D $R/mnt/dlzdata && mount -t proc proc $R/proc && mount -t tmpfs tmpfs $R/tmp && mount --rbind /dev $R/dev   # /dev (and /dev/fd) as on the device
# as on the mixer [device]: binfmt_misc mounted under /proc (hidden by the sandbox's fresh
# /proc), a tmpfs /run holding daemon sockets
mount -t binfmt_misc binfmt_misc $R/proc/sys/fs/binfmt_misc || echo "WARNING: no binfmt_misc mount: the hidden-mount case is not tested"
mount -t tmpfs tmpfs $R/run && python3 -c "import socket,sys; socket.socket(socket.AF_UNIX).bind(sys.argv[1])" $R/run/fake.sock
cleanup() { umount -R $R/dev 2>/dev/null; umount $R/proc/sys/fs/binfmt_misc $R/run 2>/dev/null; umount $R/tmp $R/proc $R/mnt/dlzdata 2>/dev/null; rmdir $R/mnt/dlzdata 2>/dev/null; umount $R $D; losetup -d $L; rm -rf $W; }
trap cleanup EXIT
# every run: no temp files of the updater left in the card's /tmp afterwards (its report, work and
# restore folders)
# (the chroot has no /sys: the refusal of the rehearsal settings on an SD card, #84, never fires
# here; it is shown on the mixer, notes/updates.md "Rehearsal settings")
run() {
  chroot $R /usr/bin/env DLZMOD_DATA=/mnt/dlzdata /usr/local/sbin/dlzmod-update > $W/run.out 2>&1; echo "rc=$?" >> $W/run.out; sed 's/^/    | /' $W/run.out
  ls $R/tmp | grep -q '^dlzmod-' && { bad "temp files left in /tmp: $(ls $R/tmp | grep '^dlzmod-' | tr '\n' ' ')"; rm -rf $R/tmp/dlzmod-*; }
}
U=$D/dlzmod-update
reports() { ls $D/dlzmod-logs/ 2>/dev/null | grep -c '^update-'; }
last() { ls $D/dlzmod-logs/update-*.txt 2>/dev/null | sort -V | tail -1; }
said() { grep -qF "$1" "$(last)"; }   # in the newest report only
sha() { sha256sum "$1" | cut -d' ' -f1; }
ST=$R/var/lib/dlzmod-update
K=$R/usr/local/share/dlzmod-keys
TK=$W/tk; mkdir -p $TK
for k in release release2 dev other; do openssl genpkey -algorithm ed25519 -out $TK/$k.pem 2>/dev/null && openssl pkey -in $TK/$k.pem -pubout -out $TK/$k.pub; done
sign() { openssl pkeyutl -sign -inkey $TK/${2:-dev}.pem -rawin -in "$1" -out "$1.sig"; }   # sign <tar> [key]
put() { cp "$1" "$1.sig" $U/; }   # a package and its signature onto DLZDATA
key() { cat "$1" "$1.sig" | sha256sum | cut -d' ' -f1; }   # the updater's record of a try
setchan() { sed -i "s/^CHANNEL=.*/CHANNEL=$1/" package.env; }   # in craft code: pkg/ and the outer folder

# craft <name> <code in the unpacked pkg/ dir> [<code in the outer folder>]
craft() {
  local c=$W/craft-$1 top
  mkdir -p $c && tar -xf "$PKG" -C $c && top=$(ls $c)
  mkdir $c/r && (cd $c/r && zcat ../$top/initrd.cpio.gz | cpio -idm --quiet)
  (cd $c/r/pkg && eval "$2" && find . -type f ! -name manifest | LC_ALL=C sort | sed 's#^\./##' | xargs sha256sum > manifest)
  (cd $c/r && find . | LC_ALL=C sort | cpio -o -H newc --quiet | gzip -9 > ../$top/initrd.cpio.gz)
  (cd $c/$top && eval "${3:-:}" && sha256sum initrd.cpio.gz package.env > manifest)
  tar -cf $W/$1.tar -C $c $top
  sign $W/$1.tar ${SIGNKEY:-dev}
  echo $W/$1.tar
}
refused() {   # refused <name> <expected text>: the package stays, the card is unchanged
  [ -e $U/$1.tar ] && ok "$1: package kept" || bad "$1: package gone"
  said "NOT INSTALLED" && said "$2" && ok "$1: refused ($2)" || bad "$1: not refused with '$2'"
  [ "$(sha $R/srv/app.js)" = "$APP" ] && [ "$(sha $R/srv/server.js)" = "$SRV" ] && ok "$1: app/server unchanged" || bad "$1: app/server changed"
  rm -f $U/$1.tar $U/$1.tar.sig
}

echo "== installed on the card"
for f in usr/local/sbin/dlzmod-update etc/systemd/system/dlzmod-update.service etc/systemd/system/multi-user.target.wants/dlzmod-update.service etc/udev/rules.d/90-dlzmod-usb-wifi.rules var/lib/dlzmod-update/version; do
  { [ -e $R/$f ] || [ -L $R/$f ]; } && ok "$f" || bad "$f missing"
done
grep -q "012e ff 2357 012d" $R/etc/udev/rules.d/90-dlzmod-usb-wifi.rules && ok "udev rule with the reference id" || bad "udev rule old"
[ -f $U/README.txt ] && ok "dlzmod-update/README.txt from the install" || bad "no dlzmod-update/README.txt"
APP=$(sha $R/srv/app.js); SRV=$(sha $R/srv/server.js)
# a dev-channel card (the rehearsal installs from a dev package): the repo's release keys, and the
# package's dev key (mkpackage.sh: your own from DLZMOD_SIGNING_KEYS, else install/keys/dev.pub)
[ "$(ls -A $K | tr '\n' ' ')" = "dev.pub release.pub release2.pub " ] && ok "card trusts release + release2 + dev" || bad "card keys: $(ls -A $K | tr '\n' ' ')"
for k in release release2; do cmp -s $K/$k.pub <(tr -d '\r' < $REPO/install/keys/$k.pub) && ok "$k.pub as in install/keys" || bad "$k.pub differs from install/keys"; done
PDEV=$(tar -xOf "$PKG" --wildcards '*/initrd.cpio.gz' | zcat | cpio -i --quiet --to-stdout '*pkg/mod/keys/dev.pub')
[ -n "$PDEV" ] && cmp -s $K/dev.pub <(printf '%s\n' "$PDEV") && ok "dev.pub as in the package" || bad "dev.pub differs from the package's"
cmp -s $K/dev.pub <(tr -d '\r' < $REPO/install/keys/dev.pub) && echo "  (dev key: install/keys/dev.pub)" || echo "  (dev key: your own, not install/keys/dev.pub)"
# from here on the throwaway keys; the real package re-signed with the test dev key
cp $TK/release.pub $TK/release2.pub $TK/dev.pub $K/
cp "$PKG" "$W/${PKG##*/}"; PKG=$W/${PKG##*/}; sign $PKG

echo "== 1: nothing to do"
n0=$(reports); run; [ "$(reports)" = "$n0" ] && ok "no report" || bad "a report for nothing"

echo "== 2: the same package as installed"
# a report from before v0.2.0 (no version in its name) with a gap below it: the next one comes after it
mkdir -p $D/dlzmod-logs && : > $D/dlzmod-logs/update-20.txt
put "$PKG"; run
[ ! -e $U/${PKG##*/} ] && [ ! -e $U/${PKG##*/}.sig ] && said "INSTALLED: " && said "signature: dev key" && ok "installed, package and signature deleted" || bad "not installed"
# named like the package (dlzmod-v0.1.0-dev-abc1234 -> update-21-v0.1.0-dev-abc1234.txt), the popup's name the same
PTOP=$(tar -tf "$PKG" | head -n 1 | cut -d/ -f1)
[ "$(basename "$(last)")" = "update-21-${PTOP#dlzmod-}.txt" ] && ok "report named $(basename "$(last)")" || bad "report name: $(basename "$(last)"), expected update-21-${PTOP#dlzmod-}.txt"
[ "$(cat $ST/last-report)" = "$(basename "$(last)")" ] && ok "last-report names it" || bad "last-report: $(cat $ST/last-report)"
rm -f $D/dlzmod-logs/update-20.txt
[ "$(sha $R/srv/app.js)" = "$APP" ] && ok "app.js unchanged (same package)" || bad "app.js changed"

echo "== 3: a package that really changes something (dlzmod.js)"
P=$(craft dlzmod-vchanged "printf '\n// dlzmod update test\n' >> mod/app-mod/dlzmod.js"); put $P; run
said "INSTALLED: " && [ ! -e $U/dlzmod-vchanged.tar ] && ok "installed, package deleted" || bad "not installed"
grep -q "dlzmod update test" $R/srv/app.js && ok "app.js has the new code" || bad "app.js without the new code"
APP=$(sha $R/srv/app.js)

echo "== 3b: a card on v0.1.0's updater takes this package (by its own gate and sandbox), then the new one takes the next"
OLDU=$(git -C $REPO -c safe.directory=$REPO show v0.1.0:install/sd-system/dlzmod-update 2>/dev/null)
NEWU=$(tar -xOf "$PKG" --wildcards '*/initrd.cpio.gz' | zcat | cpio -i --quiet --to-stdout '*pkg/mod/sd-system/dlzmod-update')
if [ -z "$OLDU" ] || [ -z "$NEWU" ]; then bad "no v0.1.0 tag here (git fetch --tags) or no updater in the package"
else
  printf '%s\n' "$OLDU" > $R/usr/local/sbin/dlzmod-update
  # v0.1.0 names its report update-N.txt with the lowest free N: not the highest, so found by the listing
  before=$(ls $D/dlzmod-logs)
  put $(craft dlzmod-vfrom010 "printf '\n// from v0.1.0 test\n' >> mod/app-mod/dlzmod.js"); run
  rep=$(ls $D/dlzmod-logs | grep -vxF -f <(printf '%s\n' $before) | head -n 1)
  [ -n "$rep" ] && grep -qF "INSTALLED: " "$D/dlzmod-logs/$rep" && grep -q "from v0.1.0 test" $R/srv/app.js \
    && ok "installed by the v0.1.0 updater ($rep)" || bad "the v0.1.0 updater did not install it (report: ${rep:-none})"
  if [ "$(cat $R/usr/local/sbin/dlzmod-update)" = "$NEWU" ]; then ok "the card's updater is now the package's"
  else   # the cases below test the package's updater, not v0.1.0's
    bad "the card kept another updater (the package's put back for the cases below)"
    printf '%s\n' "$NEWU" > $R/usr/local/sbin/dlzmod-update; chmod 755 $R/usr/local/sbin/dlzmod-update
  fi
  put $(craft dlzmod-vfromnew "printf '\n// by the new updater\n' >> mod/app-mod/dlzmod.js"); run
  said "INSTALLED: " && grep -q "by the new updater" $R/srv/app.js && ok "the next package installed by the new updater" || bad "the new updater did not install the next one"
fi
APP=$(sha $R/srv/app.js)

if [ -z "${QUICK:-}" ]; then   # QUICK=1: only the install, a good update, model/marker and guards
echo "== 4: damaged package (one byte), then the next start"
cp "$PKG" $U/dlzmod-vbad.tar
python3 -c "import sys; f=open(sys.argv[1],'r+b'); f.seek(4000); b=f.read(1); f.seek(4000); f.write(bytes([b[0]^1]))" $U/dlzmod-vbad.tar
sign $U/dlzmod-vbad.tar; run; said "damaged" && ok "refused: damaged" || bad "not refused"
n1=$(reports); run; grep -q "not tried again" $W/run.out && [ "$(reports)" = "$n1" ] && ok "not retried, no new report" || bad "retried or new report"
rm $U/dlzmod-vbad.tar $U/dlzmod-vbad.tar.sig

echo "== 5: two packages, then the next start"
cp "$PKG" $U/dlzmod-va.tar; cp "$PKG" $U/dlzmod-vb.tar; run
said "more than one" && ok "refused" || bad "not refused"
n1=$(reports); run; [ "$(reports)" = "$n1" ] && ok "no second report" || bad "a report at every start"
rm $U/dlzmod-va.tar $U/dlzmod-vb.tar

echo "== 6: apply fails halfway (units changed, patches not run)"
cp $R/etc/systemd/system/dlzmod-bootlog.service $W/bootlog.before
put $(craft dlzmod-vfail6 "echo '# changed' >> mod/sd-system/dlzmod-bootlog.service && sed -i 's/^apply_patches() {/apply_patches() { false/' mod/apply-mod.sh") $U/; run
said "a step failed" && said "nothing on the card was changed" && ok "failed, nothing placed" || bad "not refused cleanly"
cmp -s $R/etc/systemd/system/dlzmod-bootlog.service $W/bootlog.before && ok "changed unit put back" || bad "unit not put back"
rm -f $U/dlzmod-vfail6.tar $U/dlzmod-vfail6.tar.sig

echo "== 7: apply fails after the patches"
put $(craft dlzmod-vfail7 "printf '\n// should not stay\n' >> mod/app-mod/dlzmod.js && sed -i 's/^set_mod_defaults() {/set_mod_defaults() { false/' mod/apply-mod.sh") $U/; run
said "nothing on the card was changed" && ok "refused, nothing placed" || bad "not refused cleanly"
[ "$(sha $R/srv/app.js)" = "$APP" ] && ok "app.js as before the update" || bad "app.js CHANGED"
rm -f $U/dlzmod-vfail7.tar $U/dlzmod-vfail7.tar.sig

fi
if [ -e $R/root/.dlzlite ]; then wrong=full-size; else wrong=XS; fi   # a package made for the other model only
echo "== 9: made for the $wrong only"
put $(craft dlzmod-vmodel "sed -i 's/^MODELS=.*/MODELS=$wrong/' package.env" "sed -i 's/^MODELS=.*/MODELS=$wrong/' package.env") $U/; run; refused dlzmod-vmodel "made for the $wrong"

echo "== 9b: the card's GD32 marker is not its model's (the package's check-rootfs.sh on the card)"
if [ -e $R/root/.dlzlite ]; then mine=dlzlite other=evolve; else mine=evolve other=dlzlite; fi
mv $R/root/.gd32-loaded-firmware-$mine-154.bin $R/root/.gd32-loaded-firmware-$other-154.bin
put $(craft dlzmod-vmarker "true") $U/; run; refused dlzmod-vmarker "does not pass the package's check"
mv $R/root/.gd32-loaded-firmware-$other-154.bin $R/root/.gd32-loaded-firmware-$mine-154.bin
rm -f $U/dlzmod-vmarker.tar $U/dlzmod-vmarker.tar.sig

echo "== 12: apply puts an extra drop-in next to the GD32 guard"
put $(craft dlzmod-vextra "cat $HERE/fixtures/extra-dropin.sh >> mod/apply-mod.sh") $U/; run
said "flash-gd32.service.d/zz.conf, which an update may not" && ok "refused before placing" || bad "not refused"
[ "$(ls -A $R/etc/systemd/system/flash-gd32.service.d)" = dlzmod.conf ] && ok "extra drop-in removed" || bad "EXTRA DROP-IN LEFT: $(ls -A $R/etc/systemd/system/flash-gd32.service.d)"
rm -f $U/dlzmod-vextra.tar $U/dlzmod-vextra.tar.sig

if [ -z "${QUICK:-}" ]; then   # QUICK=1: only the install, a good update, model/marker and guards
echo "== 13: a try cut off by a power cut, then the next start (fails): the first snapshot comes back"
P=$(craft dlzmod-vcut "sed -i 's/^apply_patches() {/apply_patches() { false/' mod/apply-mod.sh"); S=$(key $P)
# the state after the cut-off first try: its snapshot (of the clean card) taken, then app.js half written
sed -n '/^SNAP_GLOBS=/,/dlzmod-keys\/\*"$/p;/^snap_list() {/,/^}/p' $R/usr/local/sbin/dlzmod-update > $R/tmp/snap.sh
chroot $R /bin/bash -c '. /tmp/snap.sh; ROOT=; snap_list > /var/lib/dlzmod-update/previous.list && tar -cpf /var/lib/dlzmod-update/previous.tar -C / -T /var/lib/dlzmod-update/previous.list'
echo "$S" > $ST/inprogress
echo "// half written" >> $R/srv/app.js
put $P; run
said "was interrupted: keeping the snapshot" && ok "kept the first snapshot" || bad "took a new snapshot"
[ "$(sha $R/srv/app.js)" = "$APP" ] && ok "app.js as before the cut-off try" || bad "app.js NOT as before"
rm -f $U/dlzmod-vcut.tar $U/dlzmod-vcut.tar.sig

echo "== 15: apply puts a drop-in for every service into /usr/lib/systemd/system/service.d"
put $(craft dlzmod-vextra2 "cat $HERE/fixtures/extra-dropin2.sh >> mod/apply-mod.sh") $U/; run
said "service.d/zz.conf, which an update may not" && ok "refused before placing" || bad "not refused"
[ ! -e $R/usr/lib/systemd/system/service.d/zz.conf ] && ok "global drop-in removed" || bad "GLOBAL DROP-IN LEFT"
rm -f $U/dlzmod-vextra2.tar $U/dlzmod-vextra2.tar.sig

echo "== 16: a failed update that brings a new copy of the update script: the old one stays"
UPD0=$(sha $R/usr/local/sbin/dlzmod-update)
put $(craft dlzmod-vself "echo '# a new copy' >> mod/sd-system/dlzmod-update && sed -i 's/^set_mod_defaults() {/set_mod_defaults() { false/' mod/apply-mod.sh") $U/; run
said "nothing on the card was changed" && ok "refused, nothing placed" || bad "not refused cleanly"
[ "$(sha $R/usr/local/sbin/dlzmod-update)" = "$UPD0" ] && ok "update script unchanged" || bad "UPDATE SCRIPT REPLACED by a failed package"
rm -f $U/dlzmod-vself.tar $U/dlzmod-vself.tar.sig

echo "== 17: a package cut off 3 times (3 tries used): restored and given up"
P=$(craft dlzmod-vhang "printf '\n// hang test\n' >> mod/app-mod/dlzmod.js"); S=$(key $P)
chroot $R /bin/bash -c '. /tmp/snap.sh; ROOT=; snap_list > /var/lib/dlzmod-update/previous.list && tar -cpf /var/lib/dlzmod-update/previous.tar -C / -T /var/lib/dlzmod-update/previous.list'
echo "$S" > $ST/inprogress; echo "$S 3" > $ST/tries
echo "// half written" >> $R/srv/app.js
put $P; run
said "stopped 3 times" && said "it never finished" && ok "given up" || bad "not given up"
[ "$(sha $R/srv/app.js)" = "$APP" ] && ok "app.js as before" || bad "app.js NOT restored"
[ ! -e $ST/tries ] && [ ! -e $ST/inprogress ] && ok "counters cleared" || bad "counters left"
rm -f $U/dlzmod-vhang.tar $U/dlzmod-vhang.tar.sig

echo "== 19: a cut-off try left a drop-in next to the GD32 guard, the package was removed since: repaired anyway"
chroot $R /bin/bash -c '. /tmp/snap.sh; ROOT=; snap_list > /var/lib/dlzmod-update/previous.list && tar -cpf /var/lib/dlzmod-update/previous.tar -C / -T /var/lib/dlzmod-update/previous.list'
echo "some-old-package" > $ST/inprogress
printf '[Service]\nExecStart=/bin/false\n' > $R/etc/systemd/system/flash-gd32.service.d/zz.conf
run
said "after a try that was cut off" && said "previous files restored" && ok "repaired without a package" || bad "not repaired"
[ "$(ls -A $R/etc/systemd/system/flash-gd32.service.d)" = dlzmod.conf ] && [ ! -e $ST/inprogress ] && ok "drop-in gone, marker cleared" || bad "drop-in or marker left"

echo "== 21: no signature file, then the next start, then the signature added"
P=$(craft dlzmod-vnosig "printf '\n// nosig test\n' >> mod/app-mod/dlzmod.js"); cp $P $U/; run
said "no signature file" && [ -e $U/dlzmod-vnosig.tar ] && ok "not installed, package kept" || bad "unsigned package not refused"
{ [ ! -e $ST/failed ] || [ "$(cat $ST/failed)" != "$(key $P)" ]; } && ok "not marked as failed" || bad "marked as failed"
n1=$(reports); run; [ "$(reports)" = "$n1" ] && ok "no second report" || bad "a report at every start"
cp $P.sig $U/; run
said "INSTALLED: " && grep -q "nosig test" $R/srv/app.js && ok "installed once the signature is there" || bad "not installed with its signature"
APP=$(sha $R/srv/app.js)

echo "== 22: signed with a key the card does not trust, then the right signature"
P=$(SIGNKEY=other craft dlzmod-vother "printf '\n// other key test\n' >> mod/app-mod/dlzmod.js"); put $P; run
said "not signed with a key this card trusts" && [ -e $U/dlzmod-vother.tar ] && ok "refused, package kept" || bad "foreign key accepted"
[ "$(sha $R/srv/app.js)" = "$APP" ] && ok "app.js unchanged" || bad "app.js changed"
sign $U/dlzmod-vother.tar; run
said "INSTALLED: " && ok "the same file with a good signature is tried again and installed" || bad "not retried with a good signature"
APP=$(sha $R/srv/app.js)

echo "== 23: changed after signing (one byte)"
cp "$PKG" $W/vafter.tar; sign $W/vafter.tar
python3 -c "import sys; f=open(sys.argv[1],'r+b'); f.seek(4000); b=f.read(1); f.seek(4000); f.write(bytes([b[0]^1]))" $W/vafter.tar
cp $W/vafter.tar $U/dlzmod-vafter.tar; cp $W/vafter.tar.sig $U/dlzmod-vafter.tar.sig; run; refused dlzmod-vafter "not signed with a key this card trusts"

echo "== 27: a release package (release key, CHANNEL=release) on the developer card"
P=$(SIGNKEY=release craft dlzmod-vrel "printf '\n// release test\n' >> mod/app-mod/dlzmod.js; setchan release" "setchan release"); put $P; run
said "INSTALLED: " && said "signature: release key" && grep -q "release test" $R/srv/app.js && ok "installed" || bad "release package not installed"
APP=$(sha $R/srv/app.js)

echo "== 29: an update that adds a trusted key: caught, put back"
KS=$(cd $K && sha256sum *)
P=$(craft dlzmod-vkey "printf '\n// key test\n' >> mod/app-mod/dlzmod.js; printf 'echo evil > \"\$MNT/usr/local/share/dlzmod-keys/evil.pub\"\n' >> mod/apply-mod.sh"); put $P; run
said "dlzmod-keys/evil.pub, which an update may not" && ok "refused before placing" || bad "key change not refused"
[ "$(cd $K && sha256sum *)" = "$KS" ] && ok "keys as before" || bad "KEYS CHANGED: $(ls -A $K)"
[ "$(sha $R/srv/app.js)" = "$APP" ] && ok "app.js as before" || bad "app.js NOT restored"
rm -f $U/dlzmod-vkey.tar $U/dlzmod-vkey.tar.sig

echo "== 30: an update that replaces the dev key: caught, put back"
P=$(craft dlzmod-vkey2 "printf 'cp \"\$MNT/usr/local/share/dlzmod-keys/release.pub\" \"\$MNT/usr/local/share/dlzmod-keys/dev.pub\"\n' >> mod/apply-mod.sh"); put $P; run
said "dlzmod-keys/dev.pub, which an update may not" && [ "$(cd $K && sha256sum *)" = "$KS" ] && ok "refused, keys as before" || bad "KEY REPLACEMENT NOT REFUSED"
rm -f $U/dlzmod-vkey2.tar $U/dlzmod-vkey2.tar.sig

echo "== 31: a package.env key this version does not know (a later version's): ignored"
P=$(craft dlzmod-vfuture "printf '\n// future test\n' >> mod/app-mod/dlzmod.js; echo FUTURE_FIELD=something >> package.env" "echo FUTURE_FIELD=something >> package.env"); put $P; run
said "INSTALLED: " && ok "installed" || bad "unknown key refused"
APP=$(sha $R/srv/app.js)

echo "== 33: update keys per channel (card-core.sh): package.env wins; none only with DLZMOD_CHANNEL=dev (build-sd.sh); else refused"
F33=$W/k33; mkdir -p $F33/tools/keys; cp $REPO/install/keys/*.pub $F33/tools/keys/
sed -n '/^update_channel() {/,/^}/p;/^install_update_keys() {/,/^}/p' $REPO/install/card-core.sh > $F33/fn.sh
for ch in release dev none builddev bad envwins; do
  rm -f $F33/package.env; mkdir -p $F33/mnt; envch=""
  case $ch in
    none) ;;
    builddev) envch=dev ;;
    bad) echo CHANNEL=beta > $F33/package.env ;;
    envwins) echo CHANNEL=release > $F33/package.env; envch=dev ;;
    *) echo CHANNEL=$ch > $F33/package.env ;;
  esac
  got=$(DLZMOD_CHANNEL=$envch bash -c 'die() { echo "DIE $*" >&2; exit 1; }; . "$1"; MNT=$2; TOOLS=$3; install_update_keys > /dev/null; ls -A "$MNT/usr/local/share/dlzmod-keys" | tr "\n" " "' _ $F33/fn.sh $F33/mnt $F33/tools 2>&1)
  case $ch in
    release|envwins) want="release.pub release2.pub " ;;
    bad) want="DIE package.env: bad CHANNEL 'beta'" ;;
    none) want="DIE no package.env next to the tools and DLZMOD_CHANNEL is not dev: update keys unknown" ;;
    *) want="dev.pub release.pub release2.pub " ;;
  esac
  [ "$got" = "$want" ] && ok "$ch: $want" || bad "$ch: got '$got', want '$want'"
  rm -rf $F33/mnt
done

echo "== 35: a different file's try was cut off; a refused file must not clear its marker"
chroot $R /bin/bash -c '. /tmp/snap.sh; ROOT=; snap_list > /var/lib/dlzmod-update/previous.list && tar -cpf /var/lib/dlzmod-update/previous.tar -C / -T /var/lib/dlzmod-update/previous.list'
echo "other-package" > $ST/inprogress
echo "# half applied by the cut-off file" > $R/etc/udev/rules.d/99-dlzmod-halfa.rules
P=$(craft dlzmod-vearly ":"); echo x >> $P.sig; put $P; run; refused dlzmod-vearly "not an ed25519 signature"
[ "$(cat $ST/inprogress 2>/dev/null)" = other-package ] && ok "the other file's marker kept" || bad "OTHER FILE'S MARKER CLEARED"

echo "== 34: then a good file: the cut-off file's leftovers go first, then the new snapshot and the install"
P=$(craft dlzmod-vafterother "printf '\n// after other test\n' >> mod/app-mod/dlzmod.js"); put $P; run
said "an earlier update file was cut off" && said "INSTALLED: " && ok "rolled back first, then installed" || bad "not rolled back or not installed"
[ ! -e $R/etc/udev/rules.d/99-dlzmod-halfa.rules ] && ok "the cut-off file's leftover removed" || bad "LEFTOVER KEPT"
[ ! -e $ST/inprogress ] && ok "marker cleared" || bad "marker left: $(cat $ST/inprogress)"
tar -tf $ST/previous.tar 2>/dev/null | grep -q halfa && bad "LEFTOVER IN THE NEW SNAPSHOT" || ok "new snapshot without the leftover"
APP=$(sha $R/srv/app.js)

echo "== 36: signed with the spare release key (release2), CHANNEL=release, on a release card"
mv $K/dev.pub $W/dev.pub.kept
P=$(SIGNKEY=release2 craft dlzmod-vspare "printf '\n// spare key test\n' >> mod/app-mod/dlzmod.js; setchan release" "setchan release"); put $P; run
said "INSTALLED: " && said "signature: release2 key" && grep -q "spare key test" $R/srv/app.js && ok "installed with the spare key" || bad "spare-signed release not installed"
mv $W/dev.pub.kept $K/dev.pub
APP=$(sha $R/srv/app.js)

echo "== 38: a cut-off try had already written its (newer) version: the check uses the snapshot's"
chroot $R /bin/bash -c '. /tmp/snap.sh; ROOT=; snap_list > /var/lib/dlzmod-update/previous.list && tar -cpf /var/lib/dlzmod-update/previous.tar -C / -T /var/lib/dlzmod-update/previous.list'
echo "other-newer-package" > $ST/inprogress
VKEEP=$(cat $ST/version); echo v9.9.9 > $ST/version
P=$(craft dlzmod-vsnapver "printf '\n// snapshot version test\n' >> mod/app-mod/dlzmod.js"); put $P; run
said "INSTALLED: " && ! said "older" && ok "not refused as older than the cut-off try's version" || bad "refused by the cut-off try's version"
[ "$(cat $ST/version)" = "$VKEEP" ] && ok "version back to the package's ($VKEEP)" || bad "version is $(cat $ST/version)"
APP=$(sha $R/srv/app.js)

echo "== 39: two files, removed, then the same two again: reported again"
cp "$PKG" $U/dlzmod-va.tar; cp "$PKG" $U/dlzmod-vb.tar; run; said "more than one" && ok "reported" || bad "not reported"
case $(basename "$(last)") in update-*-unknown-version.txt) ok "report named without a version: $(basename "$(last)")" ;; *) bad "report name: $(basename "$(last)")" ;; esac
rm $U/dlzmod-va.tar $U/dlzmod-vb.tar; run
[ ! -e $ST/multiple ] && ok "marker cleared with nothing there" || bad "marker kept"
n1=$(reports); cp "$PKG" $U/dlzmod-va.tar; cp "$PKG" $U/dlzmod-vb.tar; run
[ "$(reports)" != "$n1" ] && said "more than one" && ok "reported again" || bad "silent the second time"
rm $U/dlzmod-va.tar $U/dlzmod-vb.tar

echo "== 40: the package's steps write outside the stage (an absolute path): read-only, refused"
put $(craft dlzmod-vabs "printf 'echo evil > /etc/dlzmod-evil\n' >> mod/apply-mod.sh"); run
said "a step failed" && [ ! -e $R/etc/dlzmod-evil ] && ok "write refused, nothing on the card" || bad "WROTE OUTSIDE THE STAGE"
rm -f $U/dlzmod-vabs.tar $U/dlzmod-vabs.tar.sig

echo "== 41: the steps try to make the system writable again: no capabilities"
put $(craft dlzmod-vremount "printf 'mount -o remount,rw /\n' >> mod/apply-mod.sh"); run
said "a step failed" && said "nothing on the card was changed" && ok "remount refused" || bad "REMOUNT NOT REFUSED"
rm -f $U/dlzmod-vremount.tar $U/dlzmod-vremount.tar.sig

echo "== 42: the steps leave a process behind that writes later: it dies with the sandbox"
put $(craft dlzmod-vlate "printf '\n// late test\n' >> mod/app-mod/dlzmod.js; printf '( sleep 4; echo late > \"\$MNT/srv/late.txt\"; echo late > /tmp/dlzmod-late ) &\n' >> mod/apply-mod.sh"); run
said "INSTALLED: " && ok "installed" || bad "not installed"
sleep 6
[ ! -e $R/srv/late.txt ] && [ ! -e $R/tmp/dlzmod-late ] && ! pgrep -f "sleep 4" > /dev/null && ok "no leftover process, nothing written late" || bad "A LEFTOVER PROCESS RAN"
APP=$(sha $R/srv/app.js)

echo "== 43: a new boot.scr, even a proper U-Boot script image: refused (only a full install brings one)"
cp -p $R/boot/boot.scr $W/boot.scr.kept
printf '\x27\x05\x19\x56test boot script' > $W/new-boot.scr
put $(craft dlzmod-vbootscr "cp $W/new-boot.scr mod/new-boot.scr; printf 'cp \"\$TOOLS/new-boot.scr\" \"\$MNT/boot/boot.scr\"\n' >> mod/apply-mod.sh"); run
refused dlzmod-vbootscr "the update changes /boot/boot.scr, which an update may not"
cmp -s $R/boot/boot.scr $W/boot.scr.kept && ok "boot.scr as before" || bad "BOOT.SCR CHANGED"

echo "== 44: a boot.scr that is not a U-Boot script image: refused the same way (by the allowlist, whatever it holds)"
put $(craft dlzmod-vbadscr "printf 'cp /etc/hostname \"\$MNT/boot/boot.scr\"\n' >> mod/apply-mod.sh"); run
refused dlzmod-vbadscr "the update changes /boot/boot.scr, which an update may not"
cmp -s $R/boot/boot.scr $W/boot.scr.kept && ok "boot.scr as before" || bad "BOOT.SCR CHANGED"

echo "== 44b: boot.scr removed: refused"
put $(craft dlzmod-vnoscr "printf 'rm -f \"\$MNT/boot/boot.scr\"\n' >> mod/apply-mod.sh"); run
refused dlzmod-vnoscr "the update changes /boot/boot.scr, which an update may not"
cmp -s $R/boot/boot.scr $W/boot.scr.kept && ok "boot.scr as before" || bad "BOOT.SCR CHANGED"

echo "== 45: a new update script with another guard list: refused"
UPD0=$(sha $R/usr/local/sbin/dlzmod-update)
put $(craft dlzmod-vguards "sed -i '/^GUARDS=\"/s/^GUARDS=\"f/GUARDS=\"0/' mod/sd-system/dlzmod-update"); run
refused dlzmod-vguards "changes the guard list"
[ "$(sha $R/usr/local/sbin/dlzmod-update)" = "$UPD0" ] && ok "update script unchanged" || bad "UPDATE SCRIPT REPLACED"

echo "== 46: a new update script without the capability drop: refused"
put $(craft dlzmod-vnodrop "sed -i 's/--bounding-set=-all/--bounding-set=+all/' mod/sd-system/dlzmod-update"); run
refused dlzmod-vnodrop "lacks a check (--bounding-set=-all)"

echo "== 47: a fifo in the stage: refused"
put $(craft dlzmod-vfifo "printf 'mkfifo \"\$MNT/srv/fifo\"\n' >> mod/apply-mod.sh"); run
refused dlzmod-vfifo "made special files"

echo "== 48: a wants link with the wrong target: refused"
put $(craft dlzmod-vlink2 "printf 'ln -sfn /bin/sh \"\$MNT/etc/systemd/system/multi-user.target.wants/dlzmod-x.service\"\n' >> mod/apply-mod.sh"); run
refused dlzmod-vlink2 "puts something unexpected at /etc/systemd/system/multi-user.target.wants/dlzmod-x.service"
[ ! -e $R/etc/systemd/system/multi-user.target.wants/dlzmod-x.service ] && ok "no link placed" || bad "LINK PLACED"

echo "== 49: the sandbox's walls from the inside: its own uid, no user namespaces, no sockets, nothing writable"
cat > $W/walls.sh <<'EOF'
[ "$(id -u):$(id -g)" = 65533:65533 ] || exit 41
if unshare -U -r true 2>/dev/null; then exit 42; fi
[ ! -e /run/fake.sock ] && [ ! -e /run/systemd ] && [ ! -e /tmp/.X11-unix ] || exit 43
touch /run/x 2>/dev/null && exit 44
touch /dev/x 2>/dev/null && exit 45
touch /tmp/x 2>/dev/null && exit 46
touch /run/pkg/x 2>/dev/null && exit 47
[ "$(ls /dev | tr '\n' ' ')" = "null random urandom zero " ] || exit 48
grep -q '^CapEff:[[:space:]]*0*$' /proc/self/status || exit 49
true
EOF
UNS0=$(cat /proc/sys/user/max_user_namespaces)
put $(craft dlzmod-vwalls "cp $W/walls.sh mod/walls.sh; printf '. \"\$TOOLS/walls.sh\"\n' >> mod/apply-mod.sh"); run
said "INSTALLED: " && ok "every wall held (uid 65533, no userns, no sockets, nothing writable, 4 device nodes, no caps)" \
  || bad "A WALL FAILED: $(grep -o 'exit [0-9]*' "$(last)" | head -1) (41 uid, 42 userns, 43 sockets, 44-47 writable, 48 /dev, 49 caps)"
[ "$(cat /proc/sys/user/max_user_namespaces)" = "$UNS0" ] && ok "user namespaces back on afterwards ($UNS0)" || bad "max_user_namespaces left at $(cat /proc/sys/user/max_user_namespaces)"
APP=$(sha $R/srv/app.js)

echo "== 50: patches that do not fit this firmware (patch.py --check fails, in the sandbox)"
put $(craft dlzmod-vnofit "sed -i '1i import sys\nif \"--check\" in sys.argv: sys.exit(1)' mod/patch.py"); run
refused dlzmod-vnofit "does not fit this firmware"

echo "== 51: a file with a space in its name: refused before anything is placed"
put $(craft dlzmod-vspace "printf 'touch \"\$MNT/usr/local/sbin/dlzmod-a b\"\n' >> mod/apply-mod.sh"); run
refused dlzmod-vspace "a file with an odd name"
[ ! -e "$R/usr/local/sbin/dlzmod-a b" ] && [ -e $R/usr/local/sbin/dlzmod-emmc-ro ] && ok "nothing placed or deleted" || bad "PLACED OR DELETED"

echo "== 52: the steps change a guard after writing it (sources unchanged): refused"
put $(craft dlzmod-vguardlate "printf 'record_version() { echo \"# x\" >> \"\$MNT/etc/systemd/system/flash-gd32.service.d/dlzmod.conf\"; }\n' >> mod/apply-mod.sh"); run
refused dlzmod-vguardlate "changed a safety guard"

echo "== 53: a new link in sysinit.target.wants: refused (only the eMMC lock's own link may be there)"
put $(craft dlzmod-vsysinit "printf 'ln -sfn /etc/systemd/system/dlzmod-x.service \"\$MNT/etc/systemd/system/sysinit.target.wants/dlzmod-x.service\"\n' >> mod/apply-mod.sh"); run
refused dlzmod-vsysinit "which an update may not"

echo "== 54: a try cut off while placing, its file removed since, guards fine: put back at the next start"
chroot $R /bin/bash -c '. /tmp/snap.sh; ROOT=; snap_list > /var/lib/dlzmod-update/previous.list && tar -cpf /var/lib/dlzmod-update/previous.tar -C / -T /var/lib/dlzmod-update/previous.list'
echo "gone-package" > $ST/inprogress
echo "// half placed" >> $R/srv/app.js
run
said "is no longer there" && said "previous files restored" && ok "restored without a package" || bad "not restored"
[ "$(sha $R/srv/app.js)" = "$APP" ] && [ ! -e $ST/inprogress ] && ok "app.js as before, marker cleared" || bad "half-placed app.js kept"

echo "== 55: the eMMC lock's udev rule is on the card (a guard)"
cmp -s $R/etc/udev/rules.d/60-dlzmod-emmc-ro.rules $REPO/install/sd-system/60-dlzmod-emmc-ro.rules && ok "60-dlzmod-emmc-ro.rules as in the repo" || bad "eMMC udev rule missing or different"

# helpers the crafted packages source at the end of apply-mod.sh (MNT = the stage)
cat > $W/x-mmcw.sh <<'EOF'
{ printf '\047\005\031\126'; head -c 60 /dev/zero; printf 'setenv a 1\nmmc write 0x42000000 0 100\n'; } > "$MNT/boot/boot.scr"
EOF
cat > $W/x-early.sh <<'EOF'
printf '[Unit]\nDefaultDependencies=no\n[Service]\nExecStart=/bin/true\n' > "$MNT/etc/systemd/system/dlzmod-early.service"
EOF
cat > $W/x-setrw.sh <<'EOF'
echo 'SUBSYSTEM=="block", RUN+="/usr/sbin/blockdev --setrw /dev/%k"' > "$MNT/etc/udev/rules.d/99-dlzmod-x.rules"
EOF
cat > $W/x-suid.sh <<'EOF'
cp /bin/true "$MNT/usr/local/sbin/dlzmod-suid" && chmod 4755 "$MNT/usr/local/sbin/dlzmod-suid"
EOF
with() { echo "cp $W/$1 mod/$1; printf '. \"\$TOOLS/$1\"\n' >> mod/apply-mod.sh"; }

echo "== 56: a boot.scr that writes the eMMC: refused (by the allowlist, as 43-44b; kept for the day boot.scr gets a content check again)"
put $(craft dlzmod-vmmcw "$(with x-mmcw.sh)"); run
refused dlzmod-vmmcw "the update changes /boot/boot.scr, which an update may not"

echo "== 57: a new unit that starts before the eMMC lock (DefaultDependencies=no): refused"
put $(craft dlzmod-vearlyunit "$(with x-early.sh)"); run
refused dlzmod-vearlyunit "puts something unexpected at /etc/systemd/system/dlzmod-early.service"

echo "== 58: a udev rule that makes the eMMC writable again: refused"
put $(craft dlzmod-vsetrw "$(with x-setrw.sh)"); run
refused dlzmod-vsetrw "puts something unexpected at /etc/udev/rules.d/99-dlzmod-x.rules"

echo "== 59: a setuid file: refused"
put $(craft dlzmod-vsuid "$(with x-suid.sh)"); run
refused dlzmod-vsuid "puts something unexpected at /usr/local/sbin/dlzmod-suid"

echo "== 60: the progress marker cannot be written: not installed this time, then installed"
P=$(craft dlzmod-vprogress "printf '\n// marker test\n' >> mod/app-mod/dlzmod.js")
mkdir $ST/inprogress.new; put $P; run
said "NOT INSTALLED this time" && said "progress marker not written" && ok "stopped before the steps" || bad "not stopped at the marker"
[ -e $U/dlzmod-vprogress.tar ] && [ ! -e $ST/inprogress ] && [ "$(sha $R/srv/app.js)" = "$APP" ] \
  && ok "package kept, no marker, app.js unchanged" || bad "package gone, marker set or app.js changed"
rmdir $ST/inprogress.new; run
said "INSTALLED: " && grep -q "marker test" $R/srv/app.js && ok "installed at the next start" || bad "not installed at the next start"
APP=$(sha $R/srv/app.js)
rm -f $U/dlzmod-vprogress.tar $U/dlzmod-vprogress.tar.sig   # left only when this case failed

echo "== 61: a step that exits with 3 is a failed step, not a firmware that does not fit"
put $(craft dlzmod-vexit3 "sed -i 's/^record_version() {/record_version() { exit 3/' mod/apply-mod.sh"); run
refused dlzmod-vexit3 "a step failed (exit 3)"

echo "== 62: a cut-off try whose snapshot cannot be unpacked: restore incomplete, no temp folder left"
for f in previous.tar previous.list; do cp $ST/$f $W/$f.keep 2>/dev/null; done
chroot $R /bin/bash -c '. /tmp/snap.sh; ROOT=; snap_list > /var/lib/dlzmod-update/previous.list'
echo "not a tar" > $ST/previous.tar
echo "gone-package" > $ST/inprogress
run
said "RESTORE INCOMPLETE" && ok "restore incomplete reported" || bad "no RESTORE INCOMPLETE"
rm -f $ST/inprogress   # the snapshot pair as it was before this case
for f in previous.tar previous.list; do [ -e $W/$f.keep ] && mv $W/$f.keep $ST/$f || rm -f $ST/$f; done

echo "== 63: stops before DLZDATA (not on an SD card): no report file left in /tmp"
chroot $R /usr/local/sbin/dlzmod-update > $W/run.out 2>&1
grep -q "not on an SD card" $W/run.out && ok "stopped: not on an SD card" || bad "did not stop at the SD check: $(cat $W/run.out)"
ls $R/tmp | grep -q '^dlzmod-update-report' && bad "report file left in /tmp" || ok "no report file left"
fi
echo "== 14: guards still as installed after all this"
for f in flash-gd32 upgradedaemon upgraderun; do
  cmp -s $R/etc/systemd/system/$f.service.d/dlzmod.conf $REPO/install/sd-system/$f.service.d/dlzmod.conf && ok "$f guard" || bad "$f GUARD CHANGED"
done
find $R/etc $R/srv $R/usr/local/sbin $R/var/lib/dlzmod-update -name '*.dlzmod-new' 2>/dev/null | grep -q . && bad "temp files left" || ok "no temp files left"

echo
[ $F = 0 ] && echo "ALL UPDATE CHECKS PASSED" || echo "$F UPDATE CHECK(S) FAILED"
