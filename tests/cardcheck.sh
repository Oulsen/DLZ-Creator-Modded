#!/bin/bash
# The card's gate before Mackie's FPGA loader (install/sd-system/dlzmod-cardcheck), in a fake tree:
# the card's /root, a sysfs with the eMMC (and an SD card, a boot part), the eMMC's system partition
# as a small ext4 image read by debugfs, /etc/dlzmod/mixer-id. Runs the script with dash (sh on the
# card) for each case and checks pass/refuse and the screen text. The last case reads the real dump's
# partition with the device's own debugfs (qemu). Root in WSL, repo root; the dump mounted at /mnt/dlz
# for that last case.
# Usage: tests/cardcheck.sh
set -u
SRC=install/sd-system/dlzmod-cardcheck
T=$(mktemp -d /tmp/cardcheck.XXXXXX)
trap 'rm -rf "$T"' EXIT
ok=0 bad=0
CID="15010044454d4f2d4d4d000000000000"
HASH=$(printf '%s\n' "$CID" | sha256sum | cut -d' ' -f1)
XSM=.gd32-loaded-firmware-dlzlite-154.bin
FSM=.gd32-loaded-firmware-evolve-154.bin

# <name> <card: XS|full-size|dirflag> <card markers> <emmc: XS|full-size|none|garbage> <emmc markers> <mixer-id|-> <expect: pass|text> [debugfs]
run() {
  local name=$1 card=$2 cm=$3 em=$4 emm=$5 id=$6 expect=$7 dbg=${8:-debugfs} c=$T/c
  rm -rf "$c"; mkdir -p "$c/root" "$c/sys/mmcblk0/device" "$c/dev" "$c/run" "$c/etc/dlzmod" "$c/eroot/root"
  echo SD > "$c/sys/mmcblk0/device/type"; : > "$c/dev/mmcblk0p1"
  case $card in XS) : > "$c/root/.dlzlite" ;; dirflag) mkdir "$c/root/.dlzlite" ;; esac
  for m in $cm; do : > "$c/root/$m"; done
  [ "$id" = - ] || echo "$id" > "$c/etc/dlzmod/mixer-id"
  if [ "$em" != none ]; then
    mkdir -p "$c/sys/mmcblk1boot0/device" "$c/sys/mmcblk1/device"
    echo MMC > "$c/sys/mmcblk1boot0/device/type"; echo 00 > "$c/sys/mmcblk1boot0/device/cid"
    echo MMC > "$c/sys/mmcblk1/device/type"; echo "$CID" > "$c/sys/mmcblk1/device/cid"
    case $em in
      garbage) head -c 4M /dev/zero > "$c/dev/mmcblk1p1" ;;
      /*) ln -s "$em" "$c/dev/mmcblk1p1" ;;
      *) [ "$em" = XS ] && : > "$c/eroot/root/.dlzlite"
         for m in $emm; do : > "$c/eroot/root/$m"; done
         mkfs.ext4 -q -d "$c/eroot" "$c/dev/mmcblk1p1" 8M ;;
    esac
  fi
  sed -e "s|^R=/root|R=$c/root|; s|^SYS=/sys/block|SYS=$c/sys|; s|^DEV=/dev|DEV=$c/dev|" \
      -e "s|^NOTE=/run/|NOTE=$c/run/|; s|^WAIT=10|WAIT=1|; s|^READ_TIMEOUT=20|READ_TIMEOUT=1|; s|/etc/dlzmod/mixer-id|$c/etc/dlzmod/mixer-id|g" \
      -e "s|debugfs -c|$dbg -c|" "$SRC" > "$c/check"
  out=$(dash "$c/check" 2>&1); rc=$?
  note=$(cat "$c/run/dlzmod-cardcheck" 2>/dev/null)
  if [ "$expect" = pass ]; then
    if [ $rc = 0 ] && [ -z "$note" ]; then ok=$((ok+1)); echo "  ok: $name"
    else bad=$((bad+1)); echo "  FAIL: $name (rc=$rc, $out)"; fi
  else
    if [ $rc = 1 ] && grep -qF "$expect" <<< "$note"; then ok=$((ok+1)); echo "  ok: $name (refused: $note)"
    else bad=$((bad+1)); echo "  FAIL: $name (rc=$rc, note '$note', $out)"; fi
  fi
}

run "XS card in its own XS" XS "$XSM" XS "$XSM" "$HASH" pass
run "full-size card in its own full-size" full-size "$FSM" full-size "$FSM" "$HASH" pass
run "developer card (any) in the same model" XS "$XSM" XS "$XSM" any pass
run "card for another mixer (other CID hash)" XS "$XSM" XS "$XSM" "$(echo other | sha256sum | cut -d' ' -f1)" "made for another mixer."
run "no mixer-id" XS "$XSM" XS "$XSM" - "does not say which mixer"
run "no eMMC (only the SD card)" XS "$XSM" none "" "$HASH" "cannot find the mixer's internal storage"
run "eMMC unreadable" XS "$XSM" garbage "" "$HASH" "cannot read the mixer's internal storage"
run "card flag and marker disagree" XS "$FSM" XS "$XSM" "$HASH" "software does not match"
run "two markers on the card" XS "$XSM $FSM" XS "$XSM" "$HASH" "software does not match"
run "no marker on the card" XS "" XS "$XSM" "$HASH" "software does not match"
run ".dlzlite a directory on the card (Mackie tests -f)" dirflag "$XSM" XS "$XSM" "$HASH" "software does not match"
run "XS developer card in a full-size" XS "$XSM" full-size "$FSM" any "another model of DLZ Creator"
run "full-size developer card in an XS" full-size "$FSM" XS "$XSM" any "another model of DLZ Creator"
run "bound XS card, GD32 moved on by a Mackie update" XS "$XSM" XS ".gd32-loaded-firmware-dlzlite-160.bin" "$HASH" "firmware has changed"
run "bound XS card, eMMC with an extra marker" XS "$XSM" XS "$XSM .gd32-loaded-firmware-dlzlite-160.bin" "$HASH" "firmware has changed"
run "bound XS card, eMMC without a marker" XS "$XSM" XS "" "$HASH" "firmware has changed"

printf '#!/bin/sh\nexec sleep 8\n' > "$T/hang"; chmod +x "$T/hang"
start=$(date +%s)
run "the eMMC read hangs (given up after READ_TIMEOUT, not waited for)" XS "$XSM" XS "$XSM" "$HASH" "cannot read the mixer's internal storage" "$T/hang"
took=$(( $(date +%s) - start ))
if [ "$took" -le 4 ]; then ok=$((ok+1)); echo "  ok: the hang cost ${took} s (READ_TIMEOUT 1)"
else bad=$((bad+1)); echo "  FAIL: the hang cost ${took} s"; fi
start=$(date +%s%N)
run "own mixer, timed" XS "$XSM" XS "$XSM" "$HASH" pass
echo "  (own mixer, incl. making its test image: $(( ($(date +%s%N) - start) / 1000000 )) ms)"

if mountpoint -q /mnt/dlz; then
  P=$(findmnt -no SOURCE /mnt/dlz)
  L=/mnt/dlz/usr/lib/arm-linux-gnueabihf
  cat > "$T/devdebugfs" <<EOF
#!/bin/sh
QEMU_LD_PREFIX=/mnt/dlz LD_LIBRARY_PATH=$L exec qemu-arm /mnt/dlz/sbin/debugfs "\$@"
EOF
  chmod +x "$T/devdebugfs"
  run "the dump as the eMMC, the device's debugfs, developer card" XS "$XSM" "$P" "" any pass "$T/devdebugfs"
  run "the dump as the eMMC, full-size developer card" full-size "$FSM" "$P" "" any "another model of DLZ Creator" "$T/devdebugfs"
else
  echo "  (dump not mounted: the dump cases skipped)"
fi
echo "cardcheck: ok $ok, FAIL $bad"
[ "$bad" = 0 ]
