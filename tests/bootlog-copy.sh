#!/bin/bash
# Boot log copy rehearsal (#136; root in WSL, repo root, the dump mounted at /mnt/dlz): the server mod's
# copy of the boot log to DLZDATA (DLZMOD_bootlogCopy, through tests/bootlog-rig.js) runs on the
# mixer's own node (the dump's, under qemu) against a real FAT image, mounted read-only under /tmp/mnt
# as server.js mounts DLZDATA: real remounts, /proc/mounts, fsync, renames and the read-only remount
# after it (DLZMOD_roLater). Cases: a copy that replaces the last one (moved to .prev); power cuts
# while one writes (a copy of the image every ~0.2 s: what the card holds when the power goes then).
# No power cut may leave FAT errors or a syslog-last-boots.txt that is not whole; the card must be
# read-only again after each copy and pass fsck.fat.
# Usage: bash tests/bootlog-copy.sh
set -u
# own mount namespace, private (as upload.sh): /tmp/mnt here is a tmpfs of its own
if [ -z "${M7_NS:-}" ]; then M7_NS=1 exec unshare -m --propagation private bash "$0" "$@"; fi
HERE=$(cd "$(dirname "$0")" && pwd)
REPO=$(dirname "$HERE")
DUMP=${DUMP:-/mnt/dlz}
[ -x "$DUMP/usr/bin/node" ] || { echo "no dump at $DUMP: wsl -d Ubuntu -u root -e bash install/mount-ro.sh"; exit 2; }
for t in mkfs.vfat fsck.fat losetup qemu-arm awk; do command -v $t > /dev/null || { echo "missing: $t"; exit 2; }; done
LIB=$DUMP/usr/lib/arm-linux-gnueabihf
SPID=""; LOOP=""; SLOOP=""; TMPFS=""
cleanup() {
  [ -z "$SPID" ] || { kill $SPID 2> /dev/null; wait $SPID 2> /dev/null; }
  umount $W/s 2> /dev/null; umount $MP 2> /dev/null
  [ -z "$SLOOP" ] || losetup -d $SLOOP 2> /dev/null
  [ -z "$LOOP" ] || losetup -d $LOOP 2> /dev/null
  [ -z "$TMPFS" ] || umount /tmp/mnt 2> /dev/null
  rm -rf $W
}
W=$(mktemp -d /root/bootlog-rh.XXXXXX)   # the card images: on WSL's disk, deleted at the end
MP=/tmp/mnt/dlzdata
trap cleanup EXIT
F=0
ok() { echo "  ok: $*"; }; bad() { echo "  FAIL: $*"; F=$((F + 1)); }
mkdir -p /tmp/mnt && mount -t tmpfs tmpfs /tmp/mnt && TMPFS=1 || { echo "no tmpfs on /tmp/mnt"; exit 2; }
L=$MP/dlzmod-logs
RUN=$W/run
mkdir -p $MP $RUN $W/s
echo "150.00 300.00" > $W/uptime

# the last copy on the card (and one before it), and the new boot log
echo "older copy" > $W/older.txt; echo "last copy" > $W/last.txt
newlog() { head -c $(($1 * 1024 * 1024)) /dev/urandom | base64 -w 100 > $W/new.txt; }

# card <MiB>: a fresh FAT32 DLZDATA with the two older copies, mounted read-only at $MP
card() {
  [ -z "$LOOP" ] || { umount $MP 2> /dev/null; losetup -d $LOOP; }
  rm -f $W/card.img; truncate -s ${1}M $W/card.img
  mkfs.vfat -F 32 -s 1 -n DLZDATA $W/card.img > /dev/null || { echo "mkfs.vfat failed"; exit 1; }
  LOOP=$(losetup -f --show $W/card.img)
  mount -o rw $LOOP $MP && mkdir -p $L && cp $W/last.txt $L/syslog-last-boots.txt && cp $W/older.txt $L/syslog-last-boots.prev.txt &&
    umount $MP && mount -o ro $LOOP $MP || { echo "card setup failed"; exit 1; }
}
mode() { awk -v m=$MP '$2 == m { split($4, o, ","); print o[1] }' /proc/mounts; }
ro_again() {
  for i in $(seq 1 40); do [ "$(mode)" = ro ] && { ok "read-only again ($((i / 2)) s)"; return; }; sleep 0.5; done
  bad "still $(mode) 20 s after the copy"
}
fsck_ok() {
  umount $MP
  if fsck.fat -n $LOOP > $W/fsck.out 2>&1; then ok "fsck.fat: clean"; else bad "fsck.fat: $(tr '\n' ' ' < $W/fsck.out | cut -c1-300)"; fi
  mount -o ro $LOOP $MP
}
copies() { grep -c "boot log copied" $W/server.log; }
# copy: the new boot log into the rig's /run folder (renamed in, as dlzmod-bootlog does); waits for the server's line
copy() {
  local n; n=$(copies)
  cp $W/new.txt $RUN/.part && mv -f $RUN/.part $RUN/syslog-last-boots.txt
  for i in $(seq 1 120); do [ "$(copies)" -gt "$n" ] && return 0; grep -q "boot log copy:" $W/server.log && break; sleep 0.25; done
  return 1
}

echo "== the server (the dump's node: $(QEMU_LD_PREFIX=$DUMP LD_LIBRARY_PATH=$LIB/blas:$LIB/lapack:$LIB qemu-arm $DUMP/usr/bin/node --version))"
card 128
QEMU_LD_PREFIX=$DUMP LD_LIBRARY_PATH=$LIB/blas:$LIB/lapack:$LIB qemu-arm $DUMP/usr/bin/node $HERE/bootlog-rig.js \
  $REPO/install/server-mod/dlzmod-server.js $MP $RUN/syslog-last-boots.txt $W/uptime > $W/server.log 2>&1 &
SPID=$!
for i in $(seq 1 120); do grep -q running $W/server.log && break; sleep 0.5; done
grep -q running $W/server.log || { echo "the server did not start:"; cat $W/server.log; exit 1; }

echo "== A: a copy replaces the last one, which moves to .prev"
newlog 1
[ "$(mode)" = ro ] && ok "the card read-only before" || bad "the card $(mode) before"
copy && ok "copied: $(grep 'boot log copied' $W/server.log | tail -1)" || bad "not copied: $(tail -3 $W/server.log)"
[ "$(ls -A $L | tr '\n' ' ')" = "syslog-last-boots.prev.txt syslog-last-boots.txt " ] && ok "dlzmod-logs: the pair, no temp file" || bad "dlzmod-logs: $(ls -A $L | tr '\n' ' ')"
cmp -s $L/syslog-last-boots.txt $W/new.txt && cmp -s $L/syslog-last-boots.prev.txt $W/last.txt && ok "new byte for byte, the last one as .prev" || bad "the files differ"
ro_again; fsck_ok

echo "== B: power cuts while a copy writes (a copy of the card every ~0.2 s)"
card 128; newlog 24
: > $W/states; : > $W/lost
# snap <when>: the card as it is now, mounted read-only from a copy; its logs folder judged
snap() {
  cp --sparse=always $W/card.img $W/snap.img
  SLOOP=$(losetup -r -f --show $W/snap.img)
  fsck.fat -n $SLOOP > $W/snapfsck.out 2>&1
  # as upload.sh: the dirty bit, FSInfo's free count and lost clusters of a file being written are no damage
  grep -o "Reclaimed [0-9]* unused clusters" $W/snapfsck.out >> $W/lost
  grep -v -iE "^Free cluster summary wrong|^ *Auto-correcting\.? *$|dirty bit|not properly unmounted|^fsck\.fat|^/dev/loop|files, .* clusters|^Leaving filesystem unchanged|^$|differences between boot sector and its backup|mostly harmless|^Differences: \(offset:original/backup\)|^ *65:01/00 *$|Not automatically fixing this|Reclaimed [0-9]* unused clusters|^Automatically removing dirty bit|^Perform changes|^\*\*\* Filesystem was changed" $W/snapfsck.out > $W/snaperr
  [ -s $W/snaperr ] && bad "a power cut here ($1) leaves FAT errors: $(tr '\n' ' ' < $W/snaperr | cut -c1-400)"
  if mount -o ro $SLOOP $W/s 2> /dev/null; then
    local d=$W/s/dlzmod-logs txt=- prev=-
    [ -e $d/syslog-last-boots.txt ] && { txt=other; cmp -s $d/syslog-last-boots.txt $W/last.txt && txt=last; cmp -s $d/syslog-last-boots.txt $W/new.txt && txt=new; }
    [ -e $d/syslog-last-boots.prev.txt ] && { prev=other; cmp -s $d/syslog-last-boots.prev.txt $W/older.txt && prev=older; cmp -s $d/syslog-last-boots.prev.txt $W/last.txt && prev=last; }
    case "$txt/$prev" in
      last/older|-/last|new/last) state="txt=$txt prev=$prev" ;;
      *) state="BAD txt=$txt prev=$prev" ;;
    esac
    umount $W/s
  else
    state="BAD: does not mount"
  fi
  losetup -d $SLOOP; SLOOP=""
  echo "$1 $state" >> $W/states
}
n=$(copies)
cp $W/new.txt $RUN/.part && mv -f $RUN/.part $RUN/syslog-last-boots.txt
for i in $(seq 1 600); do [ "$(copies)" -gt "$n" ] && break; grep -q "boot log copy:" $W/server.log && break; snap during; sleep 0.2; done
[ "$(copies)" -gt "$n" ] && ok "the copy itself: done" || bad "the copy itself: $(tail -2 $W/server.log)"
for i in 1 2 3 4 5; do snap after; sleep 0.2; done
echo "  power cuts: $(sort $W/states | uniq -c | awk '{ c = $1; $1 = ""; printf "%s x%s,", $0, c }' | sed 's/,$//')"
grep -q ' BAD' $W/states && bad "a power cut can leave a broken log: $(grep ' BAD' $W/states | sort -u | tr '\n' ';')" || ok "every power cut: the old pair, or the new one, or the last one only as .prev"
grep -q '^during txt=last' $W/states && ok "the copies caught the old pair while writing" || bad "no copy caught the old pair (too fast to see?)"
[ "$(grep -c '^after ' $W/states)" = "$(grep -c '^after txt=new prev=last' $W/states)" ] && ok "after the copy every power cut keeps the new pair" || bad "after the copy a power cut loses it"
echo "  (lost space a power cut leaves: $(sort -u $W/lost | sed 's/Reclaimed //; s/ unused clusters/ clusters/' | tr '\n' ' '))"
ro_again; fsck_ok

echo
[ "$F" = 0 ] && echo "ALL OK" || echo "$F FAILED"
exit $((F > 0))
