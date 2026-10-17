#!/bin/bash
# Update upload rehearsal (#114; root in WSL, repo root, the dump mounted at /mnt/dlz): the server mod's
# upload (DLZMOD_updateUpload, through tests/upload-rig.js) runs on the mixer's own node (the dump's,
# under qemu) against a real FAT image, mounted read-only under /tmp/mnt as server.js mounts DLZDATA:
# real remounts, /proc/mounts, fsync, renames and the read-only remount after it (DLZMOD_roLater).
# Cases: an upload that replaces an older update; a full card; an upload cut off; power cuts. A power
# cut is a copy of the image taken while an upload writes: what the card holds when the power goes at
# that moment (what is still in the filesystem's cache is lost). In none may the update folder hold a
# package the updater would take for complete when it is not: no package, or one whole with its own
# signature. Each card must be read-only again after the upload and pass fsck.fat.
# Usage: bash tests/upload.sh
set -u
# own mount namespace, private (as update.sh): /tmp/mnt here is a tmpfs of its own, so the read-only
# remount (every writable FAT medium under /tmp/mnt) only ever sees the test card
if [ -z "${M7_NS:-}" ]; then M7_NS=1 exec unshare -m --propagation private bash "$0" "$@"; fi
HERE=$(cd "$(dirname "$0")" && pwd)
REPO=$(dirname "$HERE")
DUMP=${DUMP:-/mnt/dlz}
[ -x "$DUMP/usr/bin/node" ] || { echo "no dump at $DUMP: wsl -d Ubuntu -u root -e bash install/mount-ro.sh"; exit 2; }
for t in mkfs.vfat fsck.fat curl losetup qemu-arm awk; do command -v $t > /dev/null || { echo "missing: $t"; exit 2; }; done
LIB=$DUMP/usr/lib/arm-linux-gnueabihf
# everything this run sets up, undone at its end however it ends: the server, the mounts, the loop
# devices (the card's and a snapshot's), the card images
SPID=""; LOOP=""; SLOOP=""; TMPFS=""
cleanup() {
  [ -z "$SPID" ] || { kill $SPID 2> /dev/null; wait $SPID 2> /dev/null; }
  umount $W/s 2> /dev/null; umount $MP 2> /dev/null
  [ -z "$SLOOP" ] || losetup -d $SLOOP 2> /dev/null
  [ -z "$LOOP" ] || losetup -d $LOOP 2> /dev/null
  [ -z "$TMPFS" ] || umount /tmp/mnt 2> /dev/null
  rm -rf $W
}
W=$(mktemp -d /root/upload-rh.XXXXXX)   # the card images: on WSL's disk, deleted at the end
MP=/tmp/mnt/dlzdata
trap cleanup EXIT
F=0
ok() { echo "  ok: $*"; }; bad() { echo "  FAIL: $*"; F=$((F + 1)); }
mkdir -p /tmp/mnt && mount -t tmpfs tmpfs /tmp/mnt && TMPFS=1 || { echo "no tmpfs on /tmp/mnt"; exit 2; }
U=$MP/dlzmod-update
ST=$W/state
PORT=8114
mkdir -p $MP $ST $W/s

# the files: an older update already on the card, and the new one (any bytes: the upload does not
# check the signature, the updater does at the next start)
NEW=dlzmod-v9.9.9.tar
head -c 64 /dev/urandom > $W/new.sig
pkg() { head -c $(($1 * 1024 * 1024)) /dev/urandom > $W/new.tar; cat $W/new.sig $W/new.tar > $W/body; }
echo old-package > $W/old.tar; head -c 64 /dev/zero > $W/old.sig

# card <MiB>: a fresh FAT32 DLZDATA with the older update on it, mounted read-only at $MP
card() {
  [ -z "$LOOP" ] || { umount $MP 2> /dev/null; losetup -d $LOOP; }
  rm -f $W/card.img; truncate -s ${1}M $W/card.img
  mkfs.vfat -F 32 -s 1 -n DLZDATA $W/card.img > /dev/null || { echo "mkfs.vfat failed"; exit 1; }
  LOOP=$(losetup -f --show $W/card.img)
  mount -o rw $LOOP $MP && mkdir -p $U && cp $W/old.tar $U/dlzmod-v0.1.0.tar && cp $W/old.sig $U/dlzmod-v0.1.0.tar.sig &&
    echo "Put the update's two files here." > $U/README.txt && umount $MP && mount -o ro $LOOP $MP || { echo "card setup failed"; exit 1; }
}
# post [curl options]: the page's request; prints the status, the answer in $W/answer
post() {
  curl -s -o $W/answer -w '%{http_code}' --max-time 120 -H "Expect:" -H "Content-Type: application/octet-stream" \
    -H "X-Dlzmod-Name: $NEW" --data-binary @$W/body "$@" http://127.0.0.1:$PORT/dlzmod-update-upload
}
mode() { awk -v m=$MP '$2 == m { split($4, o, ","); print o[1] }' /proc/mounts; }
# read-only again after an upload (DLZMOD_roLater: 10 s after the last write, then every 10 s)
ro_again() {
  for i in $(seq 1 40); do [ "$(mode)" = ro ] && { ok "read-only again ($((i / 2)) s)"; return; }; sleep 0.5; done
  bad "still $(mode) 20 s after the upload"
}
temps() { ls -A $U | grep '^\.dlzmod-upload' ; }
# the card unmounted and checked; fsck.fat -n changes nothing
fsck_ok() {
  umount $MP
  if fsck.fat -n $LOOP > $W/fsck.out 2>&1; then ok "fsck.fat: clean"; else bad "fsck.fat: $(tr '\n' ' ' < $W/fsck.out | cut -c1-300)"; fi
  mount -o ro $LOOP $MP
}
old_kept() {
  [ "$(ls $U | tr '\n' ' ')" = "README.txt dlzmod-v0.1.0.tar dlzmod-v0.1.0.tar.sig " ] && cmp -s $U/dlzmod-v0.1.0.tar $W/old.tar &&
    ok "the older update files kept, nothing else" || bad "update folder: $(ls -A $U | tr '\n' ' ')"
  [ -z "$(temps)" ] && ok "no temp files" || bad "temp files left: $(temps | tr '\n' ' ')"
}

echo "== the server (the dump's node: $(QEMU_LD_PREFIX=$DUMP LD_LIBRARY_PATH=$LIB/blas:$LIB/lapack:$LIB qemu-arm $DUMP/usr/bin/node --version))"
QEMU_LD_PREFIX=$DUMP LD_LIBRARY_PATH=$LIB/blas:$LIB/lapack:$LIB qemu-arm $DUMP/usr/bin/node $HERE/upload-rig.js \
  $REPO/install/server-mod/dlzmod-server.js $MP $ST $PORT > $W/server.log 2>&1 &
SPID=$!
for i in $(seq 1 120); do grep -q listening $W/server.log && break; sleep 0.5; done
grep -q listening $W/server.log || { echo "the server did not start:"; cat $W/server.log; exit 1; }

echo "== A: an upload replaces the older update"
card 128; pkg 1
[ "$(mode)" = ro ] && ok "the card read-only before" || bad "the card $(mode) before"
s=$(post)
[ "$s" = 200 ] && grep -q "is on the mixer's card" $W/answer && ok "200: $(head -1 $W/answer)" || bad "answer $s: $(cat $W/answer)"
[ "$(ls $U | tr '\n' ' ')" = "README.txt $NEW $NEW.sig " ] && ok "the update folder: README.txt and the new pair" || bad "update folder: $(ls -A $U | tr '\n' ' ')"
cmp -s $U/$NEW $W/new.tar && cmp -s $U/$NEW.sig $W/new.sig && ok "package and signature byte for byte" || bad "the files differ from what was sent"
[ -z "$(temps)" ] && ok "no temp files" || bad "temp files left: $(temps | tr '\n' ' ')"
ro_again; fsck_ok

echo "== B: the card full"
card 64; pkg 4
mount -o remount,rw $MP && { dd if=/dev/zero of=$MP/filler bs=1M 2> /dev/null; sync; mount -o remount,ro $MP; }
mv_free=$(df -k --output=avail $MP | tail -1)
echo "  (free: ${mv_free} KiB, the package 4096 KiB)"
s=$(post)
[ "$s" = 507 ] && grep -q "SD card is full" $W/answer && ok "507: $(head -1 $W/answer)" || bad "answer $s: $(cat $W/answer)"
old_kept; ro_again; fsck_ok

echo "== C: the upload cut off (the computer goes away halfway)"
card 128; pkg 8
n=$(grep -c "update upload:" $W/server.log)
# curl itself in the background (exec), so the kill reaches it and not only a subshell around it
(exec curl -s -o /dev/null --max-time 120 --limit-rate 1M -H "Expect:" -H "Content-Type: application/octet-stream" -H "X-Dlzmod-Name: $NEW" \
  --data-binary @$W/body http://127.0.0.1:$PORT/dlzmod-update-upload) & CP=$!
sleep 3
[ -n "$(temps)" ] && ok "halfway: the package being written to its temp file" || bad "halfway: no temp file (did the upload start?)"
kill -9 $CP 2> /dev/null; wait $CP 2> /dev/null
# the server's own line for this upload: it has seen the cut and cleaned up
for i in $(seq 1 20); do [ "$(grep -c "update upload:" $W/server.log)" -gt "$n" ] && break; sleep 0.5; done
grep "update upload:" $W/server.log | tail -1 | sed 's/^/  (server: /; s/$/)/'
old_kept; ro_again; fsck_ok

echo "== D: power cuts while an upload writes (a copy of the card every ~0.2 s)"
card 128; pkg 16
: > $W/states; : > $W/lost
# snap <when>: the card as it is now, mounted read-only from a copy; its update folder judged
snap() {
  cp --sparse=always $W/card.img $W/snap.img
  SLOOP=$(losetup -r -f --show $W/snap.img)
  fsck.fat -n $SLOOP > $W/snapfsck.out 2>&1
  # a card cut off while mounted writable has the dirty bit set (FAT32 keeps it in the boot sector's
  # byte 65, so the backup boot sector differs there): that alone is no damage. Clusters of a file
  # still being written are lost (allocated, in no folder entry): space, as for any write a power cut
  # stops (a recording too), counted below. FSInfo's free-cluster count is a hint the kernel updates
  # when it likes (FAT32: never to be trusted, fsck counts again). Anything else is damage
  grep -o "Reclaimed [0-9]* unused clusters" $W/snapfsck.out >> $W/lost
  grep -v -iE "^Free cluster summary wrong|^ *Auto-correcting\.? *$|dirty bit|not properly unmounted|^fsck\.fat|^/dev/loop|files, .* clusters|^Leaving filesystem unchanged|^$|differences between boot sector and its backup|mostly harmless|^Differences: \(offset:original/backup\)|^ *65:01/00 *$|Not automatically fixing this|Reclaimed [0-9]* unused clusters|^Automatically removing dirty bit|^Perform changes|^\*\*\* Filesystem was changed" $W/snapfsck.out > $W/snaperr
  [ -s $W/snaperr ] && bad "a power cut here ($1) leaves FAT errors: $(tr '\n' ' ' < $W/snaperr | cut -c1-400)"
  if mount -o ro $SLOOP $W/s 2> /dev/null; then
    local d=$W/s/dlzmod-update tars state
    tars=$(cd $d && ls dlzmod-*.tar 2> /dev/null | tr '\n' ' ')
    case "$tars" in
      "") state=none ;;
      "dlzmod-v0.1.0.tar ") cmp -s $d/dlzmod-v0.1.0.tar $W/old.tar && cmp -s $d/dlzmod-v0.1.0.tar.sig $W/old.sig && state=old || state="BAD old pair" ;;
      "$NEW ") cmp -s $d/$NEW $W/new.tar && cmp -s $d/$NEW.sig $W/new.sig && state=new || state="BAD new pair ($(stat -c %s $d/$NEW) of $(stat -c %s $W/new.tar) bytes)" ;;
      *) state="BAD packages: $tars" ;;
    esac
    umount $W/s
  else
    state="BAD: does not mount"
  fi
  losetup -d $SLOOP; SLOOP=""
  echo "$1 $state" >> $W/states
}
(exec curl -s -o $W/answer -w '%{http_code}' --max-time 300 --limit-rate 3M -H "Expect:" -H "Content-Type: application/octet-stream" \
  -H "X-Dlzmod-Name: $NEW" --data-binary @$W/body http://127.0.0.1:$PORT/dlzmod-update-upload > $W/dstatus) & CP=$!
while kill -0 $CP 2> /dev/null; do snap during; sleep 0.2; done
# after the answer: what the page called done must survive a power cut from here on
for i in 1 2 3 4 5; do snap after; sleep 0.2; done
s=$(cat $W/dstatus)
[ "$s" = 200 ] && ok "the upload itself: 200" || bad "the upload itself: $s $(cat $W/answer)"
echo "  power cuts: $(sort $W/states | uniq -c | awk '{ c = $1; $1 = ""; printf "%s x%s,", $0, c }' | sed 's/,$//')"
grep -q ' BAD' $W/states && bad "a power cut can leave a broken update: $(grep ' BAD' $W/states | sort -u | tr '\n' ';')" || ok "every power cut: no package, the old pair or the whole new pair"
grep -qx 'during old' $W/states && grep -qx 'after new' $W/states && ok "the copies span the switch from the old pair to the new" || bad "the copies did not catch both the old and the new pair"
[ "$(grep -c '^after ' $W/states)" = "$(grep -cx 'after new' $W/states)" ] && ok "after the answer every power cut keeps the whole new pair" || bad "after the answer a power cut loses the new pair"
echo "  (lost space a power cut leaves, as for any write it stops: $(sort -u $W/lost | sed 's/Reclaimed //; s/ unused clusters/ clusters/' | tr '\n' ' '))"
ro_again; fsck_ok

echo
[ "$F" = 0 ] && echo "ALL OK" || echo "$F FAILED"
exit $((F > 0))
