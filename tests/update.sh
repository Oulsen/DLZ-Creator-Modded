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
# timing (#145): each case's time (since the start in its header), how much of it went to the updater
# calls, to waiting for their lock and to crafting packages; the slowest cases at the end
now() { date +%s%N; }
T0=$(now); TC=$T0; CASE=setup; UT=0; UW=0; NU=0
# CASES=3c,75: only these cases (#145; each sets up what it needs, so any of them runs on its own), in
# the order of this file; the setup, the helpers and the end checks (14) always run. QUICK=1: the
# install, good updates (the v0.1.0 and v0.2.0 refusals included), model/marker and guards
[ -n "${QUICK:-}" ] && CASES=${CASES:-1,2,3,3a,3b,3c,3d,9,9b,12}
CASES=${CASES:-}; SEEN=,
# SHARD=2/4: every 4th of the selected cases, from the 2nd on (cardbind.sh runs the parts side by side)
SHARD=${SHARD:-1/1}; NTH=0
case_() {   # case_ [<header>]: ends the timing of the case before; false when this one is not selected
  local t ct id=${1-}
  id=${id%%:*}; [ -z "${id##[0-9]*}" ] || id=setup
  if [ $# != 0 ] && [ "$id" != setup ] && [ "$id" != 14 ]; then
    [ -z "$CASES" ] || [[ ",$CASES," == *",$id,"* ]] || return 1
    NTH=$((NTH + 1)); [ $(((NTH - 1) % ${SHARD#*/})) = $((${SHARD%/*} - 1)) ] || { SEEN=$SEEN$id,; return 1; }
  fi
  t=$(now); ct=$(awk '{s += $1} END {print s + 0}' $W/craft.t 2>/dev/null || echo 0); rm -f $W/craft.t
  echo "$(((t - TC) / 1000000)) $((UT / 1000000)) $((UW / 1000000)) $((ct / 1000000)) $NU $CASE" >> $W/times
  TC=$t; UT=0; UW=0; NU=0; CASE=$id; SEEN=$SEEN$id,
  [ $# != 0 ] || return 0
  echo "== $1   [$(((t - T0) / 60000000000)):$(printf %02d $((((t - T0) / 1000000000) % 60)))]"
  [ "$id" = setup ] || APP=$(sha $R/srv/app.js)   # app.js as this case finds it
}
unknown_cases() {   # the CASES this file does not have (a typo would otherwise test nothing)
  local c; for c in ${CASES//,/ }; do [[ $SEEN == *",$c,"* ]] || echo "$c"; done | tr '\n' ' '
}
times_summary() {   # the whole run, then the 12 slowest cases (seconds)
  awk '{c += $1; u += $2; w += $3; k += $4; n += $5} END {printf "== timing: %.0f s, updater %.0f s in %d calls (lock waits %.0f s), crafting %.0f s, the rest %.0f s\n", c/1000, u/1000, n, w/1000, k/1000, (c-u-w-k)/1000}' $W/times
  echo "   slowest cases (s: all, updater, crafting, calls):"
  sort -rn $W/times | head -12 | awk '{printf "   %-6s %6.1f %6.1f %6.1f %3d\n", $6, $1/1000, $2/1000, $4/1000, $5}'
}
L=$(losetup -P -f --show "$IMG")
for i in 1 2 3 4 5 6 7 8 9 10; do [ -b ${L}p2 ] && break; sleep 0.5; done
R=$W/root D=$W/data
mkdir -p $R $D && mount ${L}p1 $R && mount ${L}p2 $D || { echo "mount failed"; losetup -d $L; exit 1; }
mkdir -p $R/mnt/dlzdata && mount --bind $D $R/mnt/dlzdata && mount -t proc proc $R/proc && mount -t tmpfs tmpfs $R/tmp && mount --rbind /dev $R/dev   # /dev (and /dev/fd) as on the device
# as on the mixer [device]: binfmt_misc mounted under /proc (hidden by the sandbox's fresh
# /proc), a tmpfs /run holding daemon sockets
mount -t binfmt_misc binfmt_misc $R/proc/sys/fs/binfmt_misc || echo "WARNING: no binfmt_misc mount: the hidden-mount case is not tested"
mount -t tmpfs tmpfs $R/run && python3 -c "import socket,sys; socket.socket(socket.AF_UNIX).bind(sys.argv[1])" $R/run/fake.sock
cleanup() { chattr -i $R/srv/app.js 2>/dev/null; umount $R/proc/sys/user/max_user_namespaces 2>/dev/null; umount $R/proc/sys/user/max_user_namespaces 2>/dev/null; umount -R $R/dev 2>/dev/null; umount $R/proc/sys/fs/binfmt_misc $R/run 2>/dev/null; umount $R/tmp $R/proc $R/mnt/dlzdata 2>/dev/null; rmdir $R/mnt/dlzdata 2>/dev/null; umount $R $D; losetup -d $L; rm -rf $W; }
trap cleanup EXIT
# every run: no temp files of the updater left in the card's /tmp afterwards (its report, work and
# restore folders)
# (the chroot has no /sys: the refusal of the rehearsal settings on an SD card, #84, never fires
# here; it is shown on the mixer, notes/updates.md "Rehearsal settings")
# run: a start after Install on the screen (#65): the one package with its .sig approved, as the server
# mod writes it (the cases below test what comes after); run_asking: a start without it
run() { approve; run_asking; }
# the updater switches user namespaces off around its sandbox and back on: the PC's own setting,
# shared by every run on this machine. One lock around each updater call (and each read of the
# setting), so runs side by side (cardbind.sh) take turns there only, and none saves another's 0 (#122)
# (-o: what the updater leaves running does not keep the lock; -w/-E: a run whose updater hangs makes
# the other one fail after 10 min with this reason, not wait for ever)
# UNS_PRIVATE=<value> (cardbind.sh's parts, #145): the caller holds the PC's setting at 0 for the whole
# run (so every sandbox really gets no user namespaces) and this run's updater switches its own file,
# bound over the setting in its chroot and starting at <value>, off and on; no lock then
UNS_LOCK=/tmp/dlzmod-update-test-userns.lock
UNS_PRIVATE=${UNS_PRIVATE:-}
if [ -n "$UNS_PRIVATE" ]; then
  LOCK=(); uns_now() { cat $R/proc/sys/user/max_user_namespaces; }
else
  LOCK=(flock -w 600 -E 75 -o "$UNS_LOCK"); uns_now() { flock -w 600 "$UNS_LOCK" cat /proc/sys/user/max_user_namespaces; }
fi
run_asking() {
  local rc t0 tl
  t0=$(now); rm -f $W/tlock
  # (sh writes the time the lock was taken, for the timing)
  "${LOCK[@]}" sh -c 'date +%s%N > "$0"; exec "$@"' $W/tlock chroot $R /usr/bin/env DLZMOD_DATA=/mnt/dlzdata /usr/local/sbin/dlzmod-update > $W/run.out 2>&1
  rc=$?; tl=$(cat $W/tlock 2>/dev/null || echo $t0)
  UW=$((UW + tl - t0)); UT=$((UT + $(now) - tl)); NU=$((NU + 1))
  [ $rc != 75 ] || bad "waited 10 min for $UNS_LOCK: another run's updater hangs (the updater did not run)"
  echo "rc=$rc" >> $W/run.out; sed 's/^/    | /' $W/run.out
  ls $R/tmp | grep -q '^dlzmod-' && { bad "temp files left in /tmp: $(ls $R/tmp | grep '^dlzmod-' | tr '\n' ' ')"; rm -rf $R/tmp/dlzmod-*; }
}
approve() {
  local t=($U/dlzmod-*.tar)
  if [ ${#t[@]} = 1 ] && [ -f "$t" ] && [ -f "$t.sig" ]; then key "$t" > $ST/approved; else rm -f $ST/approved; fi
}
U=$D/dlzmod-update
reports() { ls $D/dlzmod-logs/ 2>/dev/null | grep -c '^update-'; }
last() { ls $D/dlzmod-logs/update-*.txt 2>/dev/null | sort -V | tail -1; }
said() { grep -qF "$1" "$(last)"; }   # in the newest report only
installed() { said "INSTALLED: " && ! said "NOT INSTALLED"; }   # installed, not "NOT INSTALLED: ..."
sha() { sha256sum "$1" | cut -d' ' -f1; }
ST=$R/var/lib/dlzmod-update
K=$R/usr/local/share/dlzmod-keys
TK=$W/tk; mkdir -p $TK
for k in release release2 dev other; do openssl genpkey -algorithm ed25519 -out $TK/$k.pem 2>/dev/null && openssl pkey -in $TK/$k.pem -pubout -out $TK/$k.pub; done
sign() { openssl pkeyutl -sign -inkey $TK/${2:-dev}.pem -rawin -in "$1" -out "$1.sig"; }   # sign <tar> [key]
put() { cp "$1" "$1.sig" $U/; }   # a package and its signature onto DLZDATA
key() { { cat "$1"; head -c 65 "$1.sig"; } | sha256sum | cut -d' ' -f1; }   # the updater's record of a try (its copy takes 65 bytes of the .sig)
setchan() { sed -i "s/^CHANNEL=.*/CHANNEL=$1/" package.env; }   # in craft code: pkg/ and the outer folder

# craft <name> <code in the unpacked pkg/ dir> [<code in the outer folder>]
craft() {
  local c=$W/craft-$1 top t0
  t0=$(now)
  mkdir -p $c && tar -xf "$PKG" -C $c && top=$(ls $c)
  mkdir $c/r && (cd $c/r && zcat ../$top/initrd.cpio.gz | cpio -idm --quiet)
  (cd $c/r/pkg && eval "$2" && find . -type f ! -name manifest | LC_ALL=C sort | sed 's#^\./##' | xargs sha256sum > manifest)
  (cd $c/r && find . | LC_ALL=C sort | cpio -o -H newc --quiet | gzip -9 > ../$top/initrd.cpio.gz)
  (cd $c/$top && eval "${3:-:}" && sha256sum initrd.cpio.gz package.env > manifest)
  tar -cf $W/$1.tar -C $c $top
  sign $W/$1.tar ${SIGNKEY:-dev}
  echo $(($(now) - t0)) >> $W/craft.t   # (craft runs in $(...): its time goes through a file)
  echo $W/$1.tar
}
refused() {   # refused <name> <expected text>: the package stays, the card is unchanged
  [ -e $U/$1.tar ] && ok "$1: package kept" || bad "$1: package gone"
  said "NOT INSTALLED" && said "$2" && ok "$1: refused ($2)" || bad "$1: not refused with '$2'"
  [ "$(sha $R/srv/app.js)" = "$APP" ] && [ "$(sha $R/srv/server.js)" = "$SRV" ] && ok "$1: app/server unchanged" || bad "$1: app/server changed"
  # #65: a refusal also ends that file's approval (run approves before every start; fail() removes it)
  [ "$(cat $ST/approved 2>/dev/null)" != "$(key $U/$1.tar 2>/dev/null)" ] && ok "$1: no approval left for it" || bad "$1: its approval kept after the refusal"
  rm -f $U/$1.tar $U/$1.tar.sig
}

if case_ "the PC's user namespace setting before this run"; then
# (stopped here when it is 0: the sandbox's own check that it gets no user namespaces would pass on
# the PC's setting, not on the updater's)
if [ -n "$UNS_PRIVATE" ]; then
  [ "$(cat /proc/sys/user/max_user_namespaces)" = 0 ] && [ "$UNS_PRIVATE" != 0 ] && echo "$UNS_PRIVATE" > $W/uns-own \
    && mount --bind $W/uns-own $R/proc/sys/user/max_user_namespaces && ok "the PC's setting held at 0, this run's own at $(uns_now)" \
    || { bad "UNS_PRIVATE: the PC's setting is $(cat /proc/sys/user/max_user_namespaces), not held at 0, or the own one ('$UNS_PRIVATE') not bound"; echo "$F UPDATE CHECK(S) FAILED (stopped before the cases)"; exit 1; }
elif [ "$(uns_now)" != 0 ]; then ok "max_user_namespaces $(uns_now)"
else
  bad "max_user_namespaces is 0 before this run started: left by an earlier run (set it back: the value of /proc/sys/user/max_pid_namespaces)"
  echo "$F UPDATE CHECK(S) FAILED (stopped before the cases)"; exit 1
fi
fi

if case_ "installed on the card"; then
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

fi

# helpers of several cases (a case runs on its own too: CASES=)
NEWU=$(tar -xOf "$PKG" --wildcards '*/initrd.cpio.gz' | zcat | cpio -i --quiet --to-stdout '*pkg/mod/sd-system/dlzmod-update')
if [ -e $R/root/.dlzlite ]; then wrong=full-size; else wrong=XS; fi   # a package made for the other model only
# old: an updater from before REINSTALL_BELOW refuses the package (REINSTALL=yes) and keeps itself
old_refuses() {   # old_refuses <tag> <its updater>
  local before rep
  printf '%s\n' "$2" > $R/usr/local/sbin/dlzmod-update
  # (v0.1.0 names its report update-N.txt with the lowest free N: not the highest, so found by the listing)
  before=$(ls $D/dlzmod-logs 2>/dev/null)
  put $(craft dlzmod-vfrom${1//./} "printf '\n// from $1 test\n' >> mod/app-mod/dlzmod.js"); run
  rep=$(ls $D/dlzmod-logs 2>/dev/null | grep -vxF -f <(printf '%s\n' $before) | head -n 1)
  [ -n "$rep" ] && grep -qF "needs a full install with the installer image" "$D/dlzmod-logs/$rep" && ! grep -q "from $1 test" $R/srv/app.js \
    && [ "$(cat $R/usr/local/sbin/dlzmod-update)" = "$2" ] && ok "the $1 updater refuses it: needs a full install ($rep), itself kept" \
    || bad "the $1 updater did not refuse it (report: ${rep:-none})"
  rm -f $U/dlzmod-vfrom${1//./}.tar $U/dlzmod-vfrom${1//./}.tar.sig
  printf '%s\n' "$NEWU" > $R/usr/local/sbin/dlzmod-update; chmod 755 $R/usr/local/sbin/dlzmod-update
}
# the scheduling (#140) and early-start (#141) drop-ins, all five as shipped (the install places them)
SCHED="glesgui evolve-node evolve-app dlzmod-update dlzmod-grow-data"
sched_as_shipped() { local u; for u in $SCHED; do cmp -s $R/etc/systemd/system/$u.service.d/dlzmod.conf $REPO/install/sd-system/$u.service.d/dlzmod.conf \
  && [ "$(stat -c %a $R/etc/systemd/system/$u.service.d/dlzmod.conf)" = 644 ] || return 1; done; }
sed -n '/^SNAP_GLOBS=/,/"$/p;/^snap_list() {/,/^}/p' $R/usr/local/sbin/dlzmod-update > $R/tmp/snap.sh
KS=$(cd $K && sha256sum *)
halfa() {   # a different file's try cut off after it placed a udev rule
  chroot $R /bin/bash -c '. /tmp/snap.sh; ROOT=; snap_list > /var/lib/dlzmod-update/previous.list && tar -cpf /var/lib/dlzmod-update/previous.tar -C / -T /var/lib/dlzmod-update/previous.list'
  echo "other-package" > $ST/inprogress
  echo "# half applied by the cut-off file" > $R/etc/udev/rules.d/99-dlzmod-halfa.rules
}
cp -p $R/boot/boot.scr $W/boot.scr.kept
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
once() {   # once <name> <code>: P = that package, crafted once for the cases that share it; S = its record
  P=$W/$1.tar; [ -e $P ] || craft "$@" > /dev/null; S=$(key $P)
}
rinc() { once dlzmod-vrinc "printf '\n// rinc test\n' >> mod/app-mod/dlzmod.js"; }   # cases 64-70
keep() { once dlzmod-vkeep "printf '\n// keep test\n' >> mod/app-mod/dlzmod.js"; }   # cases 71 and 74
# #108: a try that was cut off (or whose put-back failed) and that a start does not go on with is put
# back, whatever lies in dlzmod-update; the state each case starts from: a snapshot of the card as
# it is, a progress marker, and app.js half placed
cutoff() {   # cutoff <progress marker>
  chroot $R /bin/bash -c '. /tmp/snap.sh; ROOT=; snap_list > /var/lib/dlzmod-update/previous.list && tar -cpf /var/lib/dlzmod-update/previous.tar -C / -T /var/lib/dlzmod-update/previous.list'
  echo "$1" > $ST/inprogress
  echo "// half placed" >> $R/srv/app.js
}
backnow() {   # backnow <what>: app.js as before the cut-off try, its marker gone
  [ "$(sha $R/srv/app.js)" = "$APP" ] && [ ! -e $ST/inprogress ] && ok "$1: app.js as before, marker cleared" || bad "$1: app.js NOT put back or marker left"
}

if case_ "1: nothing to do"; then
n0=$(reports); run; [ "$(reports)" = "$n0" ] && ok "no report" || bad "a report for nothing"
fi

if case_ "2: the same package as installed"; then
# a report from before v0.2.0 (no version in its name) with a gap below it: the next one comes after it
mkdir -p $D/dlzmod-logs && : > $D/dlzmod-logs/update-20.txt
put "$PKG"; run
[ ! -e $U/${PKG##*/} ] && [ ! -e $U/${PKG##*/}.sig ] && installed && said "signature: dev key" && ok "installed, package and signature deleted" || bad "not installed"
# named like the package (dlzmod-v0.1.0-dev-abc1234 -> update-21-v0.1.0-dev-abc1234.txt), the popup's name the same
PTOP=$(tar -tf "$PKG" | head -n 1 | cut -d/ -f1)
[ "$(basename "$(last)")" = "update-21-${PTOP#dlzmod-}.txt" ] && ok "report named $(basename "$(last)")" || bad "report name: $(basename "$(last)"), expected update-21-${PTOP#dlzmod-}.txt"
[ "$(cat $ST/last-report)" = "$(basename "$(last)")" ] && ok "last-report names it" || bad "last-report: $(cat $ST/last-report)"
rm -f $D/dlzmod-logs/update-20.txt
[ "$(sha $R/srv/app.js)" = "$APP" ] && ok "app.js unchanged (same package)" || bad "app.js changed"
fi

if case_ "3: a package that really changes something (dlzmod.js)"; then
P=$(craft dlzmod-vchanged "printf '\n// dlzmod update test\n' >> mod/app-mod/dlzmod.js"); put $P; run
installed && [ ! -e $U/dlzmod-vchanged.tar ] && ok "installed, package deleted" || bad "not installed"
grep -q "dlzmod update test" $R/srv/app.js && ok "app.js has the new code" || bad "app.js without the new code"
APP=$(sha $R/srv/app.js)
fi

if case_ "3a: asked first (#65): no Install, Later, Install for another file, a file replaced after Install, then Install"; then
label() {   # the version as "pending" names it, from the package's package.env
  local v b
  v=$(tar -xOf "$1" --wildcards '*/package.env' | sed -n 's/^DLZMOD_VERSION=//p'); b=$(tar -xOf "$1" --wildcards '*/package.env' | sed -n 's/^BUILD=//p')
  case $b in ''|release) echo "$v" ;; *) echo "$v ($b)" ;; esac
}
waits() {   # waits <what> <tar>: nothing applied, no report, no try, the question for the screen written
  [ -e $U/${2##*/} ] && [ "$(sha $R/srv/app.js)" = "$APP" ] && [ "$(reports)" = "$n0" ] && ok "$1: nothing applied, package kept, no report" || bad "$1: applied or reported"
  [ ! -e $ST/tries ] && [ ! -e $ST/inprogress ] && ok "$1: no try counted" || bad "$1: a try was counted"
  [ "$(cat $ST/pending 2>/dev/null)" = "$(key $2) $(label $2)" ] && ok "$1: pending: $(cut -c1-12 $ST/pending)... $(cut -d' ' -f2- $ST/pending)" \
    || bad "$1: pending is '$(cat $ST/pending 2>/dev/null)', expected '$(key $2) $(label $2)'"
}
P=$(craft dlzmod-vask "printf '\n// ask test\n' >> mod/app-mod/dlzmod.js"); put $P
rm -f $ST/approved; n0=$(reports)
run_asking; waits "no Install" $P
run_asking; waits "Later: the next start asks again" $P
printf '%064d\n' 0 > $ST/approved; run_asking; waits "Install for another file" $P
[ ! -e $ST/approved ] && ok "another file's approval removed" || bad "another file's approval kept"
key $P > $ST/approved; rm -f $U/dlzmod-vask.tar $U/dlzmod-vask.tar.sig
P2=$(craft dlzmod-vask2 "printf '\n// ask test 2\n' >> mod/app-mod/dlzmod.js"); put $P2
run_asking; waits "replaced by another file after Install" $P2
[ ! -e $ST/approved ] && ok "the replaced file's approval removed" || bad "the replaced file's approval kept"
key $P2 > $ST/approved; run_asking
installed && grep -q "ask test 2" $R/srv/app.js && [ ! -e $U/dlzmod-vask2.tar ] && ok "installed after Install for this file" || bad "not installed after Install"
[ ! -e $ST/approved ] && [ ! -e $ST/pending ] && ok "approval used up, no question left" || bad "approval or question left: $(ls $ST)"
APP=$(sha $R/srv/app.js)
key $P > $ST/approved   # an Install whose file was removed before the next start
n0=$(reports); run_asking; [ "$(reports)" = "$n0" ] && [ ! -e $ST/pending ] && ok "the start after: nothing to ask" || bad "a question or report without a package"
[ ! -e $ST/approved ] && ok "an Install for a file that is gone does not wait for it" || bad "approval kept without its file"
# a package its checks refuse is reported as before (the red popup), never offered
FULL="sed -i 's/^REINSTALL=.*/REINSTALL=yes/; s/^REINSTALL_BELOW=.*/REINSTALL_BELOW=v9.9.9/' package.env"
put $(craft dlzmod-vaskbad "$FULL" "$FULL") $U/; rm -f $ST/approved; run_asking
[ ! -e $ST/pending ] && ok "refused package: no question" || bad "refused package offered: $(cat $ST/pending)"
refused dlzmod-vaskbad "needs a full install"
fi

if case_ "3b: a card on v0.1.0's updater refuses this package (a full install since v0.3.0, #63); the new updater takes the next"; then
OLDU=$(git -C $REPO -c safe.directory=$REPO show v0.1.0:install/sd-system/dlzmod-update 2>/dev/null)
if [ -z "$OLDU" ] || [ -z "$NEWU" ]; then bad "no v0.1.0 tag here (git fetch --tags) or no updater in the package"
else
  old_refuses v0.1.0 "$OLDU"
  put $(craft dlzmod-vfromnew "printf '\n// by the new updater\n' >> mod/app-mod/dlzmod.js"); run
  installed && grep -q "by the new updater" $R/srv/app.js && ok "the next package installed by the new updater" || bad "the new updater did not install the next one"
fi
APP=$(sha $R/srv/app.js)
fi

if case_ "3c: a card on v0.2.0's updater refuses it too; the scheduling (#140) and early-start (#141) drop-ins, missing, placed by the new updater at a start"; then
OLDU=$(git -C $REPO -c safe.directory=$REPO show v0.2.0:install/sd-system/dlzmod-update 2>/dev/null)
if [ -z "$OLDU" ] || [ -z "$NEWU" ]; then bad "no v0.2.0 tag here (git fetch --tags) or no updater in the package"
else
  sched_as_shipped && ok "the install placed them" || bad "the install did not place the scheduling and early-start drop-ins"
  old_refuses v0.2.0 "$OLDU"
  for u in $SCHED; do rm -rf $R/etc/systemd/system/$u.service.d; done
  n1=$(reports); run   # the next start, no update file
  sched_as_shipped && said "placed the scheduling drop-ins of: glesgui evolve-node evolve-app" \
    && said "placed the early-start drop-ins of: dlzmod-update dlzmod-grow-data" && [ "$(reports)" = "$((n1 + 1))" ] \
    && ok "the next start placed them (as shipped, 644), one report" || bad "not placed at the next start"
  n1=$(reports); run; [ "$(reports)" = "$n1" ] && ok "the start after: nothing to place, no report" || bad "a report with nothing to place"
  echo "# changed here" >> $R/etc/systemd/system/glesgui.service.d/dlzmod.conf; rm -f $R/etc/systemd/system/evolve-app.service.d/dlzmod.conf; run
  grep -q "changed here" $R/etc/systemd/system/glesgui.service.d/dlzmod.conf && said "placed the scheduling drop-ins of: evolve-app (" \
    && ok "a missing one put back, one that is there left as it is" || bad "a missing or changed drop-in handled wrong"
  cp $REPO/install/sd-system/glesgui.service.d/dlzmod.conf $R/etc/systemd/system/glesgui.service.d/dlzmod.conf
fi
APP=$(sha $R/srv/app.js)
fi

if case_ "3d: a card on an updater with #140's drop-ins but not #141's: those placed by the update, the early-start ones at the next start"; then
if [ -z "$NEWU" ]; then bad "no updater in the package"
else
  grep -vF 'dlzmod-update.service.d:dlzmod.conf|dlzmod-grow-data.service.d:dlzmod.conf' <<< "$NEWU" > $R/usr/local/sbin/dlzmod-update
  for u in $SCHED; do rm -rf $R/etc/systemd/system/$u.service.d; done
  put $(craft dlzmod-vfrom140 "printf '\n// from a #140 updater\n' >> mod/app-mod/dlzmod.js"); run
  installed && grep -q "from a #140 updater" $R/srv/app.js && ok "installed by the #140 updater" || bad "the #140 updater did not install it"
  [ -z "$(ls -d $R/etc/systemd/system/{dlzmod-update,dlzmod-grow-data}.service.d 2>/dev/null)" ] \
    && [ -f $R/etc/systemd/system/glesgui.service.d/dlzmod.conf ] && ok "scheduling ones placed, early-start ones left out" || bad "wrong drop-ins placed"
  [ "$(cat $R/usr/local/sbin/dlzmod-update)" = "$NEWU" ] && ok "the card's updater is now the package's" \
    || { bad "the card kept another updater"; printf '%s\n' "$NEWU" > $R/usr/local/sbin/dlzmod-update; chmod 755 $R/usr/local/sbin/dlzmod-update; }
  run   # the next start, no update file
  sched_as_shipped && said "placed the early-start drop-ins of: dlzmod-update dlzmod-grow-data (" && ! said "placed the scheduling" \
    && ok "the next start placed only the early-start ones" || bad "early-start drop-ins not placed at the next start"
fi
APP=$(sha $R/srv/app.js)
fi

if case_ "4: damaged package (one byte), then the next start"; then
cp "$PKG" $U/dlzmod-vbad.tar
python3 -c "import sys; f=open(sys.argv[1],'r+b'); f.seek(4000); b=f.read(1); f.seek(4000); f.write(bytes([b[0]^1]))" $U/dlzmod-vbad.tar
sign $U/dlzmod-vbad.tar; run; said "damaged" && ok "refused: damaged" || bad "not refused"
n1=$(reports); run; grep -q "not tried again" $W/run.out && [ "$(reports)" = "$n1" ] && ok "not retried, no new report" || bad "retried or new report"
rm $U/dlzmod-vbad.tar $U/dlzmod-vbad.tar.sig
fi

if case_ "5: two packages, then the next start"; then
cp "$PKG" $U/dlzmod-va.tar; cp "$PKG" $U/dlzmod-vb.tar; run
said "more than one" && ok "refused" || bad "not refused"
n1=$(reports); run; [ "$(reports)" = "$n1" ] && ok "no second report" || bad "a report at every start"
rm $U/dlzmod-va.tar $U/dlzmod-vb.tar
fi

if case_ "6: apply fails halfway (units changed, patches not run)"; then
cp $R/etc/systemd/system/dlzmod-bootlog.service $W/bootlog.before
put $(craft dlzmod-vfail6 "echo '# changed' >> mod/sd-system/dlzmod-bootlog.service && sed -i 's/^apply_patches() {/apply_patches() { false/' mod/apply-mod.sh") $U/; run
said "a step failed" && said "nothing on the card was changed" && ok "failed, nothing placed" || bad "not refused cleanly"
cmp -s $R/etc/systemd/system/dlzmod-bootlog.service $W/bootlog.before && ok "changed unit put back" || bad "unit not put back"
rm -f $U/dlzmod-vfail6.tar $U/dlzmod-vfail6.tar.sig
fi

if case_ "7: apply fails after the patches"; then
put $(craft dlzmod-vfail7 "printf '\n// should not stay\n' >> mod/app-mod/dlzmod.js && sed -i 's/^set_mod_defaults() {/set_mod_defaults() { false/' mod/apply-mod.sh") $U/; run
said "nothing on the card was changed" && ok "refused, nothing placed" || bad "not refused cleanly"
[ "$(sha $R/srv/app.js)" = "$APP" ] && ok "app.js as before the update" || bad "app.js CHANGED"
rm -f $U/dlzmod-vfail7.tar $U/dlzmod-vfail7.tar.sig
fi

if case_ "9: made for the $wrong only"; then
put $(craft dlzmod-vmodel "sed -i 's/^MODELS=.*/MODELS=$wrong/' package.env" "sed -i 's/^MODELS=.*/MODELS=$wrong/' package.env") $U/; run; refused dlzmod-vmodel "made for the $wrong"
fi

if case_ "9b: the card's GD32 marker is not its model's (the package's check-rootfs.sh on the card)"; then
if [ -e $R/root/.dlzlite ]; then mine=dlzlite other=evolve; else mine=evolve other=dlzlite; fi
mv $R/root/.gd32-loaded-firmware-$mine-154.bin $R/root/.gd32-loaded-firmware-$other-154.bin
put $(craft dlzmod-vmarker "true") $U/; run; refused dlzmod-vmarker "does not pass the package's check"
mv $R/root/.gd32-loaded-firmware-$other-154.bin $R/root/.gd32-loaded-firmware-$mine-154.bin
rm -f $U/dlzmod-vmarker.tar $U/dlzmod-vmarker.tar.sig
fi

if case_ "12: apply puts an extra drop-in next to the GD32 guard"; then
put $(craft dlzmod-vextra "cat $HERE/fixtures/extra-dropin.sh >> mod/apply-mod.sh") $U/; run
said "flash-gd32.service.d/zz.conf, which an update may not" && ok "refused before placing" || bad "not refused"
[ "$(ls -A $R/etc/systemd/system/flash-gd32.service.d)" = dlzmod.conf ] && ok "extra drop-in removed" || bad "EXTRA DROP-IN LEFT: $(ls -A $R/etc/systemd/system/flash-gd32.service.d)"
rm -f $U/dlzmod-vextra.tar $U/dlzmod-vextra.tar.sig
fi

if case_ "13: a try cut off by a power cut, then the next start (fails): the first snapshot comes back"; then
P=$(craft dlzmod-vcut "sed -i 's/^apply_patches() {/apply_patches() { false/' mod/apply-mod.sh"); S=$(key $P)
# the state after the cut-off first try: its snapshot (of the clean card) taken, then app.js half written
chroot $R /bin/bash -c '. /tmp/snap.sh; ROOT=; snap_list > /var/lib/dlzmod-update/previous.list && tar -cpf /var/lib/dlzmod-update/previous.tar -C / -T /var/lib/dlzmod-update/previous.list'
echo "$S" > $ST/inprogress
echo "// half written" >> $R/srv/app.js
put $P; rm -f $ST/approved; run_asking   # no new Install (#65): the cut-off try's marker carries it
said "was interrupted: keeping the snapshot" && ok "kept the first snapshot" || bad "took a new snapshot"
[ "$(sha $R/srv/app.js)" = "$APP" ] && ok "app.js as before the cut-off try" || bad "app.js NOT as before"
rm -f $U/dlzmod-vcut.tar $U/dlzmod-vcut.tar.sig
fi

if case_ "15: apply puts a drop-in for every service into /usr/lib/systemd/system/service.d"; then
put $(craft dlzmod-vextra2 "cat $HERE/fixtures/extra-dropin2.sh >> mod/apply-mod.sh") $U/; run
said "service.d/zz.conf, which an update may not" && ok "refused before placing" || bad "not refused"
[ ! -e $R/usr/lib/systemd/system/service.d/zz.conf ] && ok "global drop-in removed" || bad "GLOBAL DROP-IN LEFT"
rm -f $U/dlzmod-vextra2.tar $U/dlzmod-vextra2.tar.sig
fi

if case_ "16: a failed update that brings a new copy of the update script: the old one stays"; then
UPD0=$(sha $R/usr/local/sbin/dlzmod-update)
put $(craft dlzmod-vself "echo '# a new copy' >> mod/sd-system/dlzmod-update && sed -i 's/^set_mod_defaults() {/set_mod_defaults() { false/' mod/apply-mod.sh") $U/; run
said "nothing on the card was changed" && ok "refused, nothing placed" || bad "not refused cleanly"
[ "$(sha $R/usr/local/sbin/dlzmod-update)" = "$UPD0" ] && ok "update script unchanged" || bad "UPDATE SCRIPT REPLACED by a failed package"
rm -f $U/dlzmod-vself.tar $U/dlzmod-vself.tar.sig
fi

if case_ "17: a package cut off 3 times (3 tries used): restored and given up"; then
P=$(craft dlzmod-vhang "printf '\n// hang test\n' >> mod/app-mod/dlzmod.js"); S=$(key $P)
chroot $R /bin/bash -c '. /tmp/snap.sh; ROOT=; snap_list > /var/lib/dlzmod-update/previous.list && tar -cpf /var/lib/dlzmod-update/previous.tar -C / -T /var/lib/dlzmod-update/previous.list'
echo "$S" > $ST/inprogress; echo "$S 3" > $ST/tries
echo "// half written" >> $R/srv/app.js
put $P; rm -f $ST/approved; run_asking
said "stopped 3 times" && said "it never finished" && ok "given up" || bad "not given up"
[ "$(sha $R/srv/app.js)" = "$APP" ] && ok "app.js as before" || bad "app.js NOT restored"
[ ! -e $ST/tries ] && [ ! -e $ST/inprogress ] && ok "counters cleared" || bad "counters left"
rm -f $U/dlzmod-vhang.tar $U/dlzmod-vhang.tar.sig
fi

if case_ "19: a cut-off try left a drop-in next to the GD32 guard, the package was removed since: repaired anyway"; then
chroot $R /bin/bash -c '. /tmp/snap.sh; ROOT=; snap_list > /var/lib/dlzmod-update/previous.list && tar -cpf /var/lib/dlzmod-update/previous.tar -C / -T /var/lib/dlzmod-update/previous.list'
echo "some-old-package" > $ST/inprogress
printf '[Service]\nExecStart=/bin/false\n' > $R/etc/systemd/system/flash-gd32.service.d/zz.conf
run
said "after a try that was cut off" && said "previous files restored" && ok "repaired without a package" || bad "not repaired"
[ "$(ls -A $R/etc/systemd/system/flash-gd32.service.d)" = dlzmod.conf ] && [ ! -e $ST/inprogress ] && ok "drop-in gone, marker cleared" || bad "drop-in or marker left"
fi

if case_ "21: no signature file, then the next start, then the signature added"; then
P=$(craft dlzmod-vnosig "printf '\n// nosig test\n' >> mod/app-mod/dlzmod.js"); cp $P $U/; run
said "no signature file" && [ -e $U/dlzmod-vnosig.tar ] && ok "not installed, package kept" || bad "unsigned package not refused"
{ [ ! -e $ST/failed ] || [ "$(cat $ST/failed)" != "$(key $P)" ]; } && ok "not marked as failed" || bad "marked as failed"
n1=$(reports); run; [ "$(reports)" = "$n1" ] && ok "no second report" || bad "a report at every start"
cp $P.sig $U/; run
installed && grep -q "nosig test" $R/srv/app.js && ok "installed once the signature is there" || bad "not installed with its signature"
APP=$(sha $R/srv/app.js)
fi

if case_ "22: signed with a key the card does not trust, then the right signature"; then
P=$(SIGNKEY=other craft dlzmod-vother "printf '\n// other key test\n' >> mod/app-mod/dlzmod.js"); put $P; run
said "not signed with a key this card trusts" && [ -e $U/dlzmod-vother.tar ] && ok "refused, package kept" || bad "foreign key accepted"
[ "$(sha $R/srv/app.js)" = "$APP" ] && ok "app.js unchanged" || bad "app.js changed"
sign $U/dlzmod-vother.tar; run
installed && ok "the same file with a good signature is tried again and installed" || bad "not retried with a good signature"
APP=$(sha $R/srv/app.js)
fi

if case_ "23: changed after signing (one byte)"; then
cp "$PKG" $W/vafter.tar; sign $W/vafter.tar
python3 -c "import sys; f=open(sys.argv[1],'r+b'); f.seek(4000); b=f.read(1); f.seek(4000); f.write(bytes([b[0]^1]))" $W/vafter.tar
cp $W/vafter.tar $U/dlzmod-vafter.tar; cp $W/vafter.tar.sig $U/dlzmod-vafter.tar.sig; run; refused dlzmod-vafter "not signed with a key this card trusts"
fi

if case_ "27: a release package (release key, CHANNEL=release) on the developer card"; then
P=$(SIGNKEY=release craft dlzmod-vrel "printf '\n// release test\n' >> mod/app-mod/dlzmod.js; setchan release" "setchan release"); put $P; run
installed && said "signature: release key" && grep -q "release test" $R/srv/app.js && ok "installed" || bad "release package not installed"
APP=$(sha $R/srv/app.js)
fi

if case_ "29: an update that adds a trusted key: caught, put back"; then
P=$(craft dlzmod-vkey "printf '\n// key test\n' >> mod/app-mod/dlzmod.js; printf 'echo evil > \"\$MNT/usr/local/share/dlzmod-keys/evil.pub\"\n' >> mod/apply-mod.sh"); put $P; run
said "dlzmod-keys/evil.pub, which an update may not" && ok "refused before placing" || bad "key change not refused"
[ "$(cd $K && sha256sum *)" = "$KS" ] && ok "keys as before" || bad "KEYS CHANGED: $(ls -A $K)"
[ "$(sha $R/srv/app.js)" = "$APP" ] && ok "app.js as before" || bad "app.js NOT restored"
rm -f $U/dlzmod-vkey.tar $U/dlzmod-vkey.tar.sig
fi

if case_ "30: an update that replaces the dev key: caught, put back"; then
P=$(craft dlzmod-vkey2 "printf 'cp \"\$MNT/usr/local/share/dlzmod-keys/release.pub\" \"\$MNT/usr/local/share/dlzmod-keys/dev.pub\"\n' >> mod/apply-mod.sh"); put $P; run
said "dlzmod-keys/dev.pub, which an update may not" && [ "$(cd $K && sha256sum *)" = "$KS" ] && ok "refused, keys as before" || bad "KEY REPLACEMENT NOT REFUSED"
rm -f $U/dlzmod-vkey2.tar $U/dlzmod-vkey2.tar.sig
fi

if case_ "30b: withdrawing the release key (#63): only through the updater, it sticks, nothing undoes it"; then
WL=$ST/withdrawn
P=$(craft dlzmod-vwlself "printf 'echo release > \"\$MNT/var/lib/dlzmod-update/withdrawn\"\n' >> mod/apply-mod.sh"); put $P; run
said "var/lib/dlzmod-update/withdrawn, which an update may not" && [ ! -e $WL ] && ok "an update's own steps cannot write the list" || bad "the list written by an update's steps: $(cat $WL 2>&1)"
rm -f $U/dlzmod-vwlself.tar $U/dlzmod-vwlself.tar.sig
# the spare key's package withdraws, even though its steps then fail: the withdrawal is not put back
WD="setchan release; echo WITHDRAWN=release >> package.env"
P=$(SIGNKEY=release2 craft dlzmod-vwdfail "printf 'exit 1\n' >> mod/apply-mod.sh; $WD" "$WD"); put $P; run
said "WITHDRAWN: the release key" && said "NOT INSTALLED" && [ "$(cat $WL 2>/dev/null)" = release ] \
  && ok "withdrawn, and kept when the rest of the package fails" || bad "withdrawal with a failing package: list $(cat $WL 2>&1)"
[ "$(cd $K && sha256sum *)" = "$KS" ] && ok "the key files themselves untouched" || bad "KEYS CHANGED: $(ls -A $K)"
rm -f $U/dlzmod-vwdfail.tar $U/dlzmod-vwdfail.tar.sig
P=$(SIGNKEY=release craft dlzmod-vwdrel "printf '\n// withdrawn key test\n' >> mod/app-mod/dlzmod.js; setchan release" "setchan release"); put $P; run
refused dlzmod-vwdrel "which was withdrawn on this card"
# an update that removes the list: its steps cannot, the card keeps it; the spare key still installs
P=$(SIGNKEY=release2 craft dlzmod-vwdrm "printf '\n// spare after withdrawal\n' >> mod/app-mod/dlzmod.js; printf 'rm -f \"\$MNT/var/lib/dlzmod-update/withdrawn\"\n' >> mod/apply-mod.sh; $WD" "$WD"); put $P; run
installed && grep -q "spare after withdrawal" $R/srv/app.js && [ "$(cat $WL 2>/dev/null)" = release ] && ! said "WITHDRAWN:" \
  && ok "the spare key installs after it; the list stays (its steps cannot remove it), not withdrawn twice" || bad "after the withdrawal: list $(cat $WL 2>&1)"
APP=$(sha $R/srv/app.js)
# the next update from the new updater copy still refuses the withdrawn key
P=$(SIGNKEY=release craft dlzmod-vwdrel2 "setchan release" "setchan release"); put $P; run
refused dlzmod-vwdrel2 "which was withdrawn on this card"
rm -f $WL   # (the rehearsal's own reset: the cases below sign with the release key)
fi

if case_ "31: a package.env key this version does not know (a later version's): ignored"; then
P=$(craft dlzmod-vfuture "printf '\n// future test\n' >> mod/app-mod/dlzmod.js; echo FUTURE_FIELD=something >> package.env" "echo FUTURE_FIELD=something >> package.env"); put $P; run
installed && ok "installed" || bad "unknown key refused"
APP=$(sha $R/srv/app.js)
fi

if case_ "31b: the audio graph (for v0.5.0): an update may patch it, with its .orig; a failed one is put back"; then
G=$R/usr/local/share/evolve-a1/mixergraph-dlzlite.js
if [ ! -f $G ]; then bad "no $G on the card"
else
  GS=$(sha $G)
  GP="printf 'g=\"\$MNT/usr/local/share/evolve-a1/mixergraph-dlzlite.js\"; [ -f \"\$g.orig\" ] || cp -p \"\$g\" \"\$g.orig\"; printf \"\\\\\\\\n// graph test\\\\\\\\n\" >> \"\$g\"\n' >> mod/apply-mod.sh"
  P=$(craft dlzmod-vgraphfail "$GP; printf 'exit 1\n' >> mod/apply-mod.sh"); put $P; run
  said "NOT INSTALLED" && [ "$(sha $G)" = "$GS" ] && [ ! -e $G.orig ] && ok "a failed graph patch: graph as before, no .orig" || bad "graph after a failed update: $(tail -c 40 $G)"
  rm -f $U/dlzmod-vgraphfail.tar $U/dlzmod-vgraphfail.tar.sig
  P=$(craft dlzmod-vgraph "$GP"); put $P; run
  installed && grep -q "graph test" $G && [ "$(sha $G.orig)" = "$GS" ] && ok "graph patched, .orig the stock file" || bad "graph patch not placed: $(tail -c 40 $G)"
fi
APP=$(sha $R/srv/app.js)
fi

if case_ "33: update keys per channel (card-core.sh): package.env wins; none only with DLZMOD_CHANNEL=dev (build-sd.sh); else refused"; then
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
fi

if case_ "35: a different file's try was cut off, then a file that is refused: the cut-off try is put back first (#108)"; then
halfa
P=$(craft dlzmod-vearly ":"); echo x >> $P.sig; put $P; run; refused dlzmod-vearly "not an ed25519 signature"
said "an earlier update file was cut off" && said "previous files restored" && [ ! -e $R/etc/udev/rules.d/99-dlzmod-halfa.rules ] \
  && [ ! -e $ST/inprogress ] && ok "the cut-off file's leftover removed, its marker cleared" || bad "CUT-OFF TRY NOT PUT BACK before the refusal"
fi

if case_ "34: a different file's try was cut off, then a good file, not yet approved (#65): the leftovers go while it waits; then Install"; then
halfa
P=$(craft dlzmod-vafterother "printf '\n// after other test\n' >> mod/app-mod/dlzmod.js"); put $P; rm -f $ST/approved; run_asking
said "an earlier update file was cut off" && said "previous files restored" && said "waits for Install" && ! installed && ok "rolled back while it waits, not installed" || bad "not rolled back, or installed without Install"
[ ! -e $R/etc/udev/rules.d/99-dlzmod-halfa.rules ] && ok "the cut-off file's leftover removed" || bad "LEFTOVER KEPT"
[ ! -e $ST/inprogress ] && [ "$(cut -d' ' -f1 $ST/pending 2>/dev/null)" = "$(key $P)" ] && ok "marker cleared, the new file asked about" || bad "marker left or no question"
run
installed && grep -q "after other test" $R/srv/app.js && ok "installed after Install" || bad "not installed after Install"
[ ! -e $ST/inprogress ] && ok "marker cleared" || bad "marker left: $(cat $ST/inprogress)"
tar -tf $ST/previous.tar 2>/dev/null | grep -q halfa && bad "LEFTOVER IN THE NEW SNAPSHOT" || ok "new snapshot without the leftover"
APP=$(sha $R/srv/app.js)
fi

if case_ "36: signed with the spare release key (release2), CHANNEL=release, on a release card"; then
mv $K/dev.pub $W/dev.pub.kept
P=$(SIGNKEY=release2 craft dlzmod-vspare "printf '\n// spare key test\n' >> mod/app-mod/dlzmod.js; setchan release" "setchan release"); put $P; run
installed && said "signature: release2 key" && grep -q "spare key test" $R/srv/app.js && ok "installed with the spare key" || bad "spare-signed release not installed"
mv $W/dev.pub.kept $K/dev.pub
APP=$(sha $R/srv/app.js)
fi

if case_ "38: a cut-off try had already written its (newer) version: the check uses the snapshot's"; then
chroot $R /bin/bash -c '. /tmp/snap.sh; ROOT=; snap_list > /var/lib/dlzmod-update/previous.list && tar -cpf /var/lib/dlzmod-update/previous.tar -C / -T /var/lib/dlzmod-update/previous.list'
echo "other-newer-package" > $ST/inprogress
VKEEP=$(cat $ST/version); echo v9.9.9 > $ST/version
P=$(craft dlzmod-vsnapver "printf '\n// snapshot version test\n' >> mod/app-mod/dlzmod.js"); put $P; run
installed && ! said "older" && ok "not refused as older than the cut-off try's version" || bad "refused by the cut-off try's version"
[ "$(cat $ST/version)" = "$VKEEP" ] && ok "version back to the package's ($VKEEP)" || bad "version is $(cat $ST/version)"
APP=$(sha $R/srv/app.js)
fi

if case_ "39: two files, removed, then the same two again: reported again"; then
cp "$PKG" $U/dlzmod-va.tar; cp "$PKG" $U/dlzmod-vb.tar; run; said "more than one" && ok "reported" || bad "not reported"
case $(basename "$(last)") in update-*-unknown-version.txt) ok "report named without a version: $(basename "$(last)")" ;; *) bad "report name: $(basename "$(last)")" ;; esac
rm $U/dlzmod-va.tar $U/dlzmod-vb.tar; run
[ ! -e $ST/multiple ] && ok "marker cleared with nothing there" || bad "marker kept"
n1=$(reports); cp "$PKG" $U/dlzmod-va.tar; cp "$PKG" $U/dlzmod-vb.tar; run
[ "$(reports)" != "$n1" ] && said "more than one" && ok "reported again" || bad "silent the second time"
rm $U/dlzmod-va.tar $U/dlzmod-vb.tar
fi

if case_ "40: the package's steps write outside the stage (an absolute path): read-only, refused"; then
put $(craft dlzmod-vabs "printf 'echo evil > /etc/dlzmod-evil\n' >> mod/apply-mod.sh"); run
said "a step failed" && [ ! -e $R/etc/dlzmod-evil ] && ok "write refused, nothing on the card" || bad "WROTE OUTSIDE THE STAGE"
rm -f $U/dlzmod-vabs.tar $U/dlzmod-vabs.tar.sig
fi

if case_ "41: the steps try to make the system writable again: no capabilities"; then
put $(craft dlzmod-vremount "printf 'mount -o remount,rw /\n' >> mod/apply-mod.sh"); run
said "a step failed" && said "nothing on the card was changed" && ok "remount refused" || bad "REMOUNT NOT REFUSED"
rm -f $U/dlzmod-vremount.tar $U/dlzmod-vremount.tar.sig
fi

if case_ "42: the steps leave a process behind that writes later: it dies with the sandbox"; then
put $(craft dlzmod-vlate "printf '\n// late test\n' >> mod/app-mod/dlzmod.js; printf '( sleep 4; echo late > \"\$MNT/srv/late.txt\"; echo late > /tmp/dlzmod-late ) &\n' >> mod/apply-mod.sh"); run
installed && ok "installed" || bad "not installed"
sleep 6
[ ! -e $R/srv/late.txt ] && [ ! -e $R/tmp/dlzmod-late ] && ! pgrep -f "sleep 4" > /dev/null && ok "no leftover process, nothing written late" || bad "A LEFTOVER PROCESS RAN"
APP=$(sha $R/srv/app.js)
fi

if case_ "43: a new boot.scr, even a proper U-Boot script image: refused (only a full install brings one)"; then
printf '\x27\x05\x19\x56test boot script' > $W/new-boot.scr
put $(craft dlzmod-vbootscr "cp $W/new-boot.scr mod/new-boot.scr; printf 'cp \"\$TOOLS/new-boot.scr\" \"\$MNT/boot/boot.scr\"\n' >> mod/apply-mod.sh"); run
refused dlzmod-vbootscr "the update changes /boot/boot.scr, which an update may not"
cmp -s $R/boot/boot.scr $W/boot.scr.kept && ok "boot.scr as before" || bad "BOOT.SCR CHANGED"
fi

if case_ "44: a boot.scr that is not a U-Boot script image: refused the same way (by the allowlist, whatever it holds)"; then
put $(craft dlzmod-vbadscr "printf 'cp /etc/hostname \"\$MNT/boot/boot.scr\"\n' >> mod/apply-mod.sh"); run
refused dlzmod-vbadscr "the update changes /boot/boot.scr, which an update may not"
cmp -s $R/boot/boot.scr $W/boot.scr.kept && ok "boot.scr as before" || bad "BOOT.SCR CHANGED"
fi

if case_ "44b: boot.scr removed: refused"; then
put $(craft dlzmod-vnoscr "printf 'rm -f \"\$MNT/boot/boot.scr\"\n' >> mod/apply-mod.sh"); run
refused dlzmod-vnoscr "the update changes /boot/boot.scr, which an update may not"
cmp -s $R/boot/boot.scr $W/boot.scr.kept && ok "boot.scr as before" || bad "BOOT.SCR CHANGED"
fi

if case_ "45: a new update script with another guard list: refused"; then
UPD0=$(sha $R/usr/local/sbin/dlzmod-update)
put $(craft dlzmod-vguards "sed -i '/^GUARDS=\"/s/^GUARDS=\"f/GUARDS=\"0/' mod/sd-system/dlzmod-update"); run
refused dlzmod-vguards "changes the guard list"
[ "$(sha $R/usr/local/sbin/dlzmod-update)" = "$UPD0" ] && ok "update script unchanged" || bad "UPDATE SCRIPT REPLACED"
fi

if case_ "46: a new update script without the capability drop: refused"; then
put $(craft dlzmod-vnodrop "sed -i 's/--bounding-set=-all/--bounding-set=+all/' mod/sd-system/dlzmod-update"); run
refused dlzmod-vnodrop "lacks a check (--bounding-set=-all)"
fi

if case_ "47: a fifo in the stage: refused"; then
put $(craft dlzmod-vfifo "printf 'mkfifo \"\$MNT/srv/fifo\"\n' >> mod/apply-mod.sh"); run
refused dlzmod-vfifo "made special files"
fi

if case_ "48: a wants link with the wrong target: refused"; then
put $(craft dlzmod-vlink2 "printf 'ln -sfn /bin/sh \"\$MNT/etc/systemd/system/multi-user.target.wants/dlzmod-x.service\"\n' >> mod/apply-mod.sh"); run
refused dlzmod-vlink2 "puts something unexpected at /etc/systemd/system/multi-user.target.wants/dlzmod-x.service"
[ ! -e $R/etc/systemd/system/multi-user.target.wants/dlzmod-x.service ] && ok "no link placed" || bad "LINK PLACED"
fi

if case_ "49: the sandbox's walls from the inside: its own uid, no user namespaces, no sockets, nothing writable"; then
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
UNS0=$(uns_now)
put $(craft dlzmod-vwalls "cp $W/walls.sh mod/walls.sh; printf '. \"\$TOOLS/walls.sh\"\n' >> mod/apply-mod.sh"); run
installed && ok "every wall held (uid 65533, no userns, no sockets, nothing writable, 4 device nodes, no caps)" \
  || bad "A WALL FAILED: $(grep -o 'exit [0-9]*' "$(last)" | head -1) (41 uid, 42 userns, 43 sockets, 44-47 writable, 48 /dev, 49 caps)"
[ "$UNS0" != 0 ] && [ "$(uns_now)" = "$UNS0" ] && ok "user namespaces back on afterwards ($UNS0)" || bad "max_user_namespaces $UNS0 before, $(uns_now) after (0: switched off, by this run or one before it)"
APP=$(sha $R/srv/app.js)
fi

if case_ "50: patches that do not fit this firmware (patch.py --check fails, in the sandbox)"; then
put $(craft dlzmod-vnofit "sed -i '1i import sys\nif \"--check\" in sys.argv: sys.exit(1)' mod/patch.py"); run
refused dlzmod-vnofit "does not fit this firmware"
fi

if case_ "51: a file with a space in its name: refused before anything is placed"; then
put $(craft dlzmod-vspace "printf 'touch \"\$MNT/usr/local/sbin/dlzmod-a b\"\n' >> mod/apply-mod.sh"); run
refused dlzmod-vspace "a file with an odd name"
[ ! -e "$R/usr/local/sbin/dlzmod-a b" ] && [ -e $R/usr/local/sbin/dlzmod-emmc-ro ] && ok "nothing placed or deleted" || bad "PLACED OR DELETED"
fi

if case_ "52: the steps change a guard after writing it (sources unchanged): refused"; then
put $(craft dlzmod-vguardlate "printf 'record_version() { echo \"# x\" >> \"\$MNT/etc/systemd/system/flash-gd32.service.d/dlzmod.conf\"; }\n' >> mod/apply-mod.sh"); run
refused dlzmod-vguardlate "changed a safety guard"
fi

if case_ "53: a new link in sysinit.target.wants: refused (only the eMMC lock's own link may be there)"; then
put $(craft dlzmod-vsysinit "printf 'ln -sfn /etc/systemd/system/dlzmod-x.service \"\$MNT/etc/systemd/system/sysinit.target.wants/dlzmod-x.service\"\n' >> mod/apply-mod.sh"); run
refused dlzmod-vsysinit "which an update may not"
fi

if case_ "54: a try cut off while placing, its file removed since, guards fine: put back at the next start"; then
chroot $R /bin/bash -c '. /tmp/snap.sh; ROOT=; snap_list > /var/lib/dlzmod-update/previous.list && tar -cpf /var/lib/dlzmod-update/previous.tar -C / -T /var/lib/dlzmod-update/previous.list'
echo "gone-package" > $ST/inprogress
echo "// half placed" >> $R/srv/app.js
run
said "is no longer there" && said "previous files restored" && ok "restored without a package" || bad "not restored"
[ "$(sha $R/srv/app.js)" = "$APP" ] && [ ! -e $ST/inprogress ] && ok "app.js as before, marker cleared" || bad "half-placed app.js kept"
fi

if case_ "55: the eMMC lock's udev rule is on the card (a guard)"; then
cmp -s $R/etc/udev/rules.d/60-dlzmod-emmc-ro.rules $REPO/install/sd-system/60-dlzmod-emmc-ro.rules && ok "60-dlzmod-emmc-ro.rules as in the repo" || bad "eMMC udev rule missing or different"

fi

if case_ "56: a boot.scr that writes the eMMC: refused (by the allowlist, as 43-44b; kept for the day boot.scr gets a content check again)"; then
put $(craft dlzmod-vmmcw "$(with x-mmcw.sh)"); run
refused dlzmod-vmmcw "the update changes /boot/boot.scr, which an update may not"
fi

if case_ "57: a new unit that starts before the eMMC lock (DefaultDependencies=no): refused"; then
put $(craft dlzmod-vearlyunit "$(with x-early.sh)"); run
refused dlzmod-vearlyunit "puts something unexpected at /etc/systemd/system/dlzmod-early.service"
fi

if case_ "57b: a drop-in that starts another unit early (DefaultDependencies=off): refused (#141)"; then
# (in the package's own files: install_sd_system puts them over anything a sourced helper changed)
put $(craft dlzmod-vearlydropin "printf '[Unit]\nDefaultDependencies=off\n' >> mod/sd-system/dspserver.service.d/dlzmod.conf"); run
refused dlzmod-vearlydropin "puts something unexpected at /etc/systemd/system/dspserver.service.d/dlzmod.conf"
fi

if case_ "57c: the updater's early-start drop-in with another text: refused (#141)"; then
put $(craft dlzmod-vearlyedit "sed -i '/^After=sysinit.target\$/d' mod/sd-system/dlzmod-update.service.d/dlzmod.conf"); run
refused dlzmod-vearlyedit "puts something unexpected at /etc/systemd/system/dlzmod-update.service.d/dlzmod.conf"
fi

if case_ "58: a udev rule that makes the eMMC writable again: refused"; then
put $(craft dlzmod-vsetrw "$(with x-setrw.sh)"); run
refused dlzmod-vsetrw "puts something unexpected at /etc/udev/rules.d/99-dlzmod-x.rules"
fi

if case_ "59: a setuid file: refused"; then
put $(craft dlzmod-vsuid "$(with x-suid.sh)"); run
refused dlzmod-vsuid "puts something unexpected at /usr/local/sbin/dlzmod-suid"
fi

if case_ "60: the progress marker cannot be written: not installed this time, then installed"; then
P=$(craft dlzmod-vprogress "printf '\n// marker test\n' >> mod/app-mod/dlzmod.js")
mkdir $ST/inprogress.new; put $P; run
said "NOT INSTALLED this time" && said "progress marker not written" && ok "stopped before the steps" || bad "not stopped at the marker"
[ -e $U/dlzmod-vprogress.tar ] && [ ! -e $ST/inprogress ] && [ "$(sha $R/srv/app.js)" = "$APP" ] \
  && ok "package kept, no marker, app.js unchanged" || bad "package gone, marker set or app.js changed"
rmdir $ST/inprogress.new; run
installed && grep -q "marker test" $R/srv/app.js && ok "installed at the next start" || bad "not installed at the next start"
APP=$(sha $R/srv/app.js)
rm -f $U/dlzmod-vprogress.tar $U/dlzmod-vprogress.tar.sig   # left only when this case failed
fi

if case_ "61: a step that exits with 3 is a failed step, not a firmware that does not fit"; then
put $(craft dlzmod-vexit3 "sed -i 's/^record_version() {/record_version() { exit 3/' mod/apply-mod.sh"); run
refused dlzmod-vexit3 "a step failed (exit 3)"
fi

if case_ "62: a cut-off try whose snapshot cannot be unpacked: restore incomplete, no temp folder left"; then
for f in previous.tar previous.list; do cp $ST/$f $W/$f.keep 2>/dev/null; done
chroot $R /bin/bash -c '. /tmp/snap.sh; ROOT=; snap_list > /var/lib/dlzmod-update/previous.list'
echo "not a tar" > $ST/previous.tar
echo "gone-package" > $ST/inprogress
run
said "RESTORE INCOMPLETE" && ok "restore incomplete reported" || bad "no RESTORE INCOMPLETE"
# tried again at every start, but said once: no new report with the same text
n1=$(reports); run
[ "$(reports)" = "$n1" ] && [ -s $ST/inprogress ] && ok "tried again, no second report" || bad "a report at every start, or the marker gone"
rm -f $ST/inprogress   # the snapshot pair as it was before this case
for f in previous.tar previous.list; do [ -e $W/$f.keep ] && mv $W/$f.keep $ST/$f || rm -f $ST/$f; done
fi

if case_ "64: a failed try whose put-back failed, its file still there: put back at the next start"; then
rinc
cutoff "$S"; echo "$S" > $ST/failed
put $P; run
said "could not all be put back then" && said "previous files restored" && ok "put back with the failed file still there" || bad "not put back"
backnow "failed file"
n1=$(reports); run; [ "$(reports)" = "$n1" ] && ok "no new report once it is back" || bad "a report at every start"
rm -f $U/dlzmod-vrinc.tar $U/dlzmod-vrinc.tar.sig $ST/failed $ST/approved
fi

if case_ "65: a cut-off try of another file, then an update file without its signature: put back"; then
rinc
cutoff other-package
cp $P $U/dlzmod-vnosig2.tar; run
said "has no signature file" && said "previous files restored" && ok "put back, the missing signature named" || bad "not put back"
backnow "unsigned file"
rm -f $U/dlzmod-vnosig2.tar
fi

if case_ "66: a cut-off try of another file, then two update files: put back"; then
rinc
cutoff other-package
put $P; cp $P $U/dlzmod-vrinc2.tar; cp $P.sig $U/dlzmod-vrinc2.tar.sig; run
said "more than one update file" && said "previous files restored" && ok "put back, the two files named" || bad "not put back"
backnow "two files"
rm -f $U/dlzmod-vrinc.tar $U/dlzmod-vrinc.tar.sig $U/dlzmod-vrinc2.tar $U/dlzmod-vrinc2.tar.sig
fi

if case_ "67: a cut-off try of this file, and its own check of the card refuses it now: put back"; then
P2=$(craft dlzmod-vchk "echo 'exit 1' > mod/check-rootfs.sh"); S2=$(key $P2)
cutoff "$S2"
put $P2; rm -f $ST/approved; run_asking   # the marker carries the Install
said "does not pass the package's check" && said "a try of this file placed files" && said "previous files restored" \
  && ok "refused and put back" || bad "refused without putting back"
backnow "refused resumed try"
rm -f $U/dlzmod-vchk.tar $U/dlzmod-vchk.tar.sig
fi

if case_ "68: a start that stops for a reason not the package's gives its try back (the earlier ones stay)"; then
rinc
echo "$S 1" > $ST/tries; mkdir $ST/inprogress.new; put $P; run
said "progress marker not written" && [ "$(cat $ST/tries 2>/dev/null)" = "$S 1" ] && ok "this start's try given back, the earlier one kept" \
  || bad "tries now: $(cat $ST/tries 2>/dev/null || echo gone)"
rmdir $ST/inprogress.new; rm -f $U/dlzmod-vrinc.tar $U/dlzmod-vrinc.tar.sig $ST/tries $ST/approved
fi

if case_ "69: a progress marker without its snapshot, no file there: cleared (nothing was placed behind it)"; then
rinc
for f in previous.tar previous.list; do mv $ST/$f $W/$f.keep69; done
echo "$S" > $ST/inprogress; run
[ ! -e $ST/inprogress ] && ok "marker cleared" || bad "marker without a snapshot kept"
for f in previous.tar previous.list; do mv $W/$f.keep69 $ST/$f; done
fi

if case_ "70: a resumed cut-off try stops for a reason not the package's: put back, Install kept, then installed"; then
rinc
cutoff "$S"; put $P
# the sandbox setup cannot switch user namespaces off this start (a read-only bind over the knob)
echo 15000 > $W/uns
if mount --bind $W/uns $R/proc/sys/user/max_user_namespaces && mount -o remount,bind,ro $R/proc/sys/user/max_user_namespaces; then
rm -f $ST/approved; run_asking   # the marker carries the Install
umount $R/proc/sys/user/max_user_namespaces
said "NOT INSTALLED this time: user namespaces" && said "previous files restored" && ok "stopped and put back" || bad "not put back"
backnow "resumed try stopped"
[ "$(cat $ST/approved 2>/dev/null)" = "$S" ] && ok "its Install kept" || bad "Install not kept"
run_asking   # no new Install
installed && grep -q "rinc test" $R/srv/app.js && ok "installed at the next start without asking again" || bad "not installed at the next start"
APP=$(sha $R/srv/app.js)
else
  umount $R/proc/sys/user/max_user_namespaces 2>/dev/null; bad "case 70 setup: the read-only bind over max_user_namespaces failed (case skipped)"
  rm -f $ST/inprogress   # the cut-off state of this case
fi
rm -f $U/dlzmod-vrinc.tar $U/dlzmod-vrinc.tar.sig   # left only when this case failed
fi

if case_ "71: a cut-off try of this file, then a second file next to it: put back with its Install kept; the copy removed: installed"; then
keep
cutoff "$S"; rm -f $ST/approved
put $P; cp $P $U/dlzmod-vkeep2.tar; cp $P.sig $U/dlzmod-vkeep2.tar.sig; run_asking
said "more than one update file" && said "previous files restored" && ok "put back, the two files named" || bad "not put back"
backnow "same file next to another"
[ "$(cat $ST/approved 2>/dev/null)" = "$S" ] && ok "its Install kept" || bad "Install not kept: $(cat $ST/approved 2>/dev/null || echo none)"
rm -f $U/dlzmod-vkeep2.tar $U/dlzmod-vkeep2.tar.sig; run_asking   # no new Install
installed && grep -q "keep test" $R/srv/app.js && ok "installed without asking again" || bad "not installed"
APP=$(sha $R/srv/app.js)
rm -f $U/dlzmod-vkeep.tar $U/dlzmod-vkeep.tar.sig   # left only when this case failed
fi

if case_ "72: a put-back that fails (app.js cannot be replaced): reported once; tried once per start, also with broken guards"; then
cutoff gone-package3
echo "added" > $R/usr/local/sbin/dlzmod-added   # an update's new file: removed at the first try
chattr +i $R/srv/app.js
n1=$(reports); run
said "RESTORE INCOMPLETE" && said "removed /usr/local/sbin/dlzmod-added" && [ "$(reports)" = "$((n1 + 1))" ] && ok "reported" || bad "no report of the failed put-back"
run; [ "$(reports)" = "$((n1 + 1))" ] && ok "the next start: the same news, no new report (without the removed line)" || bad "a second report for the same failure"
printf '[Service]\nExecStart=/bin/false\n' > $R/etc/systemd/system/flash-gd32.service.d/zz.conf   # guards not as installed
run
[ "$(grep -c 'putting the files from before it back' "$(last)")" = 1 ] && ok "with broken guards: put back once this start, not again on the next path" \
  || bad "put back $(grep -c 'putting the files from before it back' "$(last)") times in one start"
chattr -i $R/srv/app.js; run
said "previous files restored" && [ ! -e $ST/inprogress ] && [ "$(sha $R/srv/app.js)" = "$APP" ] && ok "put back once app.js can be replaced" || bad "not put back afterwards"
[ ! -e $R/etc/systemd/system/flash-gd32.service.d/zz.conf ] && ok "extra drop-in gone" || bad "EXTRA DROP-IN LEFT"
fi

if case_ "73: the start-up put-back fails, the same file goes on and its placing fails too: put back again after placing"; then
P3=$(craft dlzmod-vplace "printf '\n// place test\n' >> mod/app-mod/dlzmod.js"); S3=$(key $P3)
cutoff "$S3"
printf '[Service]\nExecStart=/bin/false\n' > $R/etc/systemd/system/flash-gd32.service.d/zz.conf   # the start-up put-back runs
chattr +i $R/srv/app.js   # it fails, and so does placing app.js
put $P3; run
said "applying failed" && [ "$(grep -c 'putting the files from before it back' "$(last)")" = 2 ] \
  && ok "put back at the start, and once more after placing" || bad "put back $(grep -c 'putting the files from before it back' "$(last)") times (want 2)"
chattr -i $R/srv/app.js; run
said "could not all be put back then" && said "previous files restored" && ok "put back at the next start" || bad "not put back at the next start"
backnow "placing failed after a failed put-back"
rm -f $U/dlzmod-vplace.tar $U/dlzmod-vplace.tar.sig $ST/failed $ST/approved
fi

if case_ "74: a put-back keeps no Install over another file's, and none for a file that failed"; then
keep
cutoff "$S"; echo other-record > $ST/approved
cp $P $U/dlzmod-vkeepa.tar; cp $P.sig $U/dlzmod-vkeepa.tar.sig; cp $P $U/dlzmod-vkeepb.tar; cp $P.sig $U/dlzmod-vkeepb.tar.sig; run_asking
said "previous files restored" && [ "$(cat $ST/approved 2>/dev/null)" = other-record ] && ok "another file's Install not overwritten" || bad "approved now: $(cat $ST/approved 2>/dev/null || echo none)"
rm -f $ST/approved
cutoff "$S"; echo "$S" > $ST/failed; run_asking
said "previous files restored" && [ ! -e $ST/approved ] && ok "no Install kept for a file that failed" || bad "an Install kept for a failed file"
rm -f $U/dlzmod-vkeep[ab].tar $U/dlzmod-vkeep[ab].tar.sig $ST/failed $ST/approved
fi

if case_ "75: a scheduling drop-in missing while a put-back fails (#140): not placed; placed once the files are back"; then
rm -f $R/etc/systemd/system/evolve-app.service.d/dlzmod.conf
cutoff gone-package4; chattr +i $R/srv/app.js; run
said "RESTORE INCOMPLETE" && ! said "placed the scheduling drop-ins" && [ ! -e $R/etc/systemd/system/evolve-app.service.d/dlzmod.conf ] \
  && ok "marker left: nothing placed" || bad "placed while a put-back was pending"
chattr -i $R/srv/app.js; run
said "previous files restored" && said "placed the scheduling drop-ins of: evolve-app (" && sched_as_shipped \
  && ok "put back, then placed in the same start" || bad "not put back, or not placed after it"
backnow "put-back with a drop-in missing"
fi

if case_ "63: stops before DLZDATA (not on an SD card): no report file left in /tmp"; then
chroot $R /usr/local/sbin/dlzmod-update > $W/run.out 2>&1
grep -q "not on an SD card" $W/run.out && ok "stopped: not on an SD card" || bad "did not stop at the SD check: $(cat $W/run.out)"
ls $R/tmp | grep -q '^dlzmod-update-report' && bad "report file left in /tmp" || ok "no report file left"
fi

if case_ "14: guards still as installed after all this"; then
for f in flash-gd32 upgradedaemon upgraderun; do
  cmp -s $R/etc/systemd/system/$f.service.d/dlzmod.conf $REPO/install/sd-system/$f.service.d/dlzmod.conf && ok "$f guard" || bad "$f GUARD CHANGED"
done
find $R/etc $R/srv $R/usr/local/sbin $R/var/lib/dlzmod-update -name '*.dlzmod-new' 2>/dev/null | grep -q . && bad "temp files left" || ok "no temp files left"
fi

case_; times_summary
[ -z "$(unknown_cases)" ] || bad "CASES names cases this file does not have: $(unknown_cases)"
echo
[ $F = 0 ] && echo "ALL UPDATE CHECKS PASSED" || echo "$F UPDATE CHECK(S) FAILED"
