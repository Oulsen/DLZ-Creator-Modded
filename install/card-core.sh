#!/bin/bash
# Finish a mod card (run as root). Shared by the PC build (build-sd.sh, on a loop device) and the
# on-device installer (in a chroot into the read-only eMMC rootfs, on the SD card), so both build
# the same card; notes/installer.md.
#
# Input: a target block device whose start is a byte copy of the eMMC up to the end of p1 (MBR,
# Mackie's bootloader at 8 KiB, rootfs) and nothing else partitioned, plus our pre-rendered layers
# (mklayers.py output). Steps:
# - checks the target's rootfs is the firmware our patches are made for (check-rootfs.sh), and the
#   same model as the source (DLZMOD_MODEL: the source's /root/.dlzlite must arrive unchanged)
# - adds the FAT32 DLZDATA partition (p2) after the rootfs; the first boot grows it to the full card
#   (DLZDATA_KEEP=1: the on-device installer made it already, at the full card size; it is kept)
# - replays the journal (e2fsck) and gives the rootfs a new UUID so the SD system never mounts the
#   eMMC rootfs
# - composes the boot visuals from the image's own originals and our layers (mkvisuals.sh) for the
#   Weston background /etc/dlz.png and the kernel bootsplash (rebuilds the initrd/uInitrd)
# - brick guards (sd-system): eMMC read-only at boot, no GD32 flashing, no Mackie updates
# - applies our UI mods to /srv/app.js and the media/firmware guards to /srv/server.js (patch.py)
# - optionally adds SSH key access from a config file, see sd.env.example
# Originals are kept next to the modded files as *.orig.
#
# The target must be a loop device backed by a file, or an SD card (/sys/block/*/device/type SD),
# with no partition mounted. The eMMC is never a valid target.
#
# Usage: DLZMOD_MODEL=<XS|full-size> DLZMOD_MIXER_ID=<sha256 of the eMMC's CID|any> [SDCONF=sd.env] [DLZMOD_UUID=<uuid>] [SOURCE_DATE_EPOCH=<s>] [DLZDATA_KEEP=1]
#          card-core.sh <device> <layers dir>
#        (DLZMOD_MODEL: the model check-rootfs.sh found on the source)
#        card-core.sh --preflight   (only check that every tool and file is there; the installer runs
#                                    this in the device chroot before its accept screen)
# DLZMOD_UUID and SOURCE_DATE_EPOCH fix the new rootfs UUID and the build time (tests: two builds
# of the same dump then have the same file trees). DLZMOD_DEV_PUB (build-sd.sh only, ignored next to
# a package.env): the dev key a dev-channel card trusts, instead of the tools' keys/dev.pub.
# Needs: e2fsprogs, dosfstools, fdisk (sfdisk), util-linux, cpio, zstd, ffmpeg, python3 (stdlib)
set -Eeuo pipefail
# set -e stops at the first failing command without a word: name it (the installer shows the last
# log lines on its failure screen)
trap 'echo "card-core.sh: line $LINENO: $BASH_COMMAND (exit $?)" >&2' ERR

PREFLIGHT_ONLY=no
if [ "${1:-}" = --preflight ]; then
  PREFLIGHT_ONLY=yes
else
  DEV=${1:?usage: card-core.sh <device> <layers dir> | --preflight}
  LAYERS=${2:?usage: card-core.sh <device> <layers dir> | --preflight}
  case ${DLZMOD_MODEL:-} in
    XS|full-size) ;;
    *) echo "DLZMOD_MODEL must be the source's model (XS or full-size), not '${DLZMOD_MODEL:-}'" >&2; exit 1 ;;
  esac
  # the mixer the card is bound to (sd-system/dlzmod-cardcheck): the sha256 of its eMMC's CID (the
  # installer), or "any" for a test card built from a dump (build-sd.sh). Never a default: an
  # installer card must not come out unbound by accident
  case ${DLZMOD_MIXER_ID:-} in
    any) ;;
    *) [[ ${DLZMOD_MIXER_ID:-} =~ ^[0-9a-f]{64}$ ]] \
         || { echo "DLZMOD_MIXER_ID must be the sha256 of the eMMC's CID or 'any', not '${DLZMOD_MIXER_ID:-}'" >&2; exit 1; } ;;
  esac
fi
SDCONF=${SDCONF:-}
TOOLS=$(cd "$(dirname "$0")" && pwd)
SPLASH_PATH=usr/lib/firmware/bootsplash.armbian

die() { echo "$*" >&2; exit 1; }
# which update keys the card gets (install_update_keys): the package's CHANNEL next to the tools (the
# installer), else DLZMOD_CHANNEL=dev from build-sd.sh; anything else fails closed, never "dev" by
# default (a lost package.env must not make a release card trust the dev key). Prints the channel,
# or the reason and returns 1.
update_channel() {
  local env=$TOOLS/../package.env channel
  if [ -f "$env" ]; then
    channel=$(sed -n 's/^CHANNEL=//p' "$env")
  elif [ "${DLZMOD_CHANNEL:-}" = dev ]; then
    channel=dev
  else
    echo "no package.env next to the tools and DLZMOD_CHANNEL is not dev: update keys unknown"; return 1
  fi
  case $channel in release|dev) echo "$channel" ;; *) echo "package.env: bad CHANNEL '$channel'"; return 1 ;; esac
}
# progress marker on stdout, one per step below: the installer turns these into its progress bar
# (install-card.sh, ic_core); the PC build just shows them
CORE_STEPS=8
step() { echo "DLZMOD-STEP $1/$CORE_STEPS $2"; }
# no __pycache__ next to the tools: on the device they must not write anywhere but the target
export PYTHONDONTWRITEBYTECODE=1

if [ "$PREFLIGHT_ONLY" = no ]; then
  BUILD_TIME=${SOURCE_DATE_EPOCH:-$(date +%s)}
  [[ $BUILD_TIME =~ ^[0-9]+$ ]] || die "SOURCE_DATE_EPOCH must be seconds since 1970"
  NEW=${DLZMOD_UUID:-$(cat /proc/sys/kernel/random/uuid)}
  [[ $NEW =~ ^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$ ]] || die "DLZMOD_UUID is not a lowercase UUID"
  for f in layout.env marker.png splash.png; do
    [ -f "$LAYERS/$f" ] || die "layers dir $LAYERS has no $f"
  done
fi

# Everything the steps below call or read, checked before the first write: a missing piece must
# not show up halfway through rewriting the card
preflight() {
  local c f missing=""
  for c in sfdisk blockdev mkfs.vfat e2fsck tune2fs blkid mount umount mountpoint zstd cpio ffmpeg \
      python3 sed grep awk install split cmp date sync touch mktemp readlink basename head tr cp ln \
      rm rmdir mkdir chmod stat sleep cat sh openssl unshare setpriv; do
    command -v "$c" >/dev/null || missing="$missing $c"
  done
  for f in check-rootfs.sh mkvisuals.sh logobbox.py bootsplash.py patch.py modversion.py \
      cpio-replace.py apply-mod.sh app-mod/dlzmod.js server-mod/dlzmod-server.js \
      sd-system/dlzmod-emmc-ro sd-system/dlzmod-grow-data sd-system/dlzmod-bootlog \
      sd-system/dlzmod-bootreport sd-system/dlzmod-bootreport.service \
      sd-system/dlzmod-netlog sd-system/dlzmod-netlog.service \
      sd-system/dlzmod-wait-hub sd-system/dlzmod-update sd-system/dlzmod-update.service \
      sd-system/dlzmod-emmc-ro.service sd-system/dlzmod-grow-data.service \
      sd-system/dlzmod-bootlog.service sd-system/flash-gd32.service.d/dlzmod.conf \
      sd-system/dlzmod-cardcheck sd-system/flash-fpga.service.d/dlzmod.conf \
      sd-system/upgradedaemon.service.d/dlzmod.conf sd-system/upgraderun.service.d/dlzmod.conf \
      sd-system/dspserver.service.d/dlzmod.conf sd-system/90-dlzmod-usb-wifi.rules \
      sd-system/dlzmod-zerocd-eject sd-system/70-dlzmod-wifi-zerocd.rules \
      sd-system/ssh.service.d/dlzmod.conf sd-system/60-dlzmod-emmc-ro.rules keys/release.pub keys/release2.pub keys/dev.pub \
      sd-system/glesgui.service.d/dlzmod.conf sd-system/evolve-node.service.d/dlzmod.conf sd-system/evolve-app.service.d/dlzmod.conf; do
    [ -f "$TOOLS/$f" ] || missing="$missing $f"
  done
  [ -n "$missing" ] && die "missing, nothing written:$missing"
  local channel
  channel=$(update_channel) || die "$channel, nothing written"
  python3 -c 'import sys; sys.exit(sys.version_info < (3, 8))' || die "python3 is older than 3.8, nothing written"
  python3 -c 'import sys; sys.path.insert(0, sys.argv[1]); from modversion import read_version; read_version()' \
    "$TOOLS" || die "VERSION missing or invalid, nothing written"
  local filters
  filters=$(ffmpeg -hide_banner -filters 2>/dev/null) || die "ffmpeg does not run, nothing written"
  for f in overlay colorchannelmixer lutrgb crop scale format hflip vflip color; do
    grep -qE "^ [.A-Z|]+ $f +" <<< "$filters" || missing="$missing $f"
  done
  [ -n "$missing" ] && die "ffmpeg lacks filters, nothing written:$missing"
  return 0
}
preflight
if [ "$PREFLIGHT_ONLY" = yes ]; then
  echo "preflight ok: all tools, mod files and ffmpeg filters present"
  exit 0
fi

# A loop device backed by an image file, or an SD card; never the eMMC (device type MMC), a
# partition, a loop over a block device or over a file on the eMMC, or anything in use (mounted,
# swap, holders). Every check fails closed. $DEV is resolved once; all writes use that name.
check_target() {
  local name back type d dn bdev bdisk mounted
  [ -b "$DEV" ] || die "target $DEV is not a block device"
  name=$(basename "$(readlink -f "$DEV")")
  [ -d "/sys/block/$name" ] || die "target $DEV is not a whole disk: refusing"
  case $name in
    loop[0-9]*)
      back=$(cat "/sys/block/$name/loop/backing_file" 2>/dev/null) || die "target $DEV: no loop backing file"
      [ -f "$back" ] && [ ! -L "$back" ] || die "target $DEV: loop over '$back', only image files are allowed"
      # the file's filesystem must not live on an eMMC
      bdev=$(stat -c '%d' "$back")
      bdisk=$(readlink -f "/sys/dev/block/$(( bdev >> 8 & 0xfff )):$(( (bdev & 0xff) | (bdev >> 12 & 0xfff00) ))" 2>/dev/null || true)
      case $bdisk in
        */mmcblk[0-9]*)
          bdisk=${bdisk%/mmcblk[0-9]*p[0-9]*}
          type=$(cat "$bdisk/device/type" 2>/dev/null || echo unknown)
          [ "$type" = SD ] || die "target $DEV: image file is on an $type device: refusing"
          ;;
      esac
      ;;
    mmcblk[0-9]*)
      type=$(cat "/sys/block/$name/device/type" 2>/dev/null) || die "target $DEV is not a whole mmc disk"
      [ "$type" = SD ] || die "target $DEV is an $type device, not an SD card: refusing"
      ;;
    *) die "target $DEV is neither a loop device nor an SD card: refusing" ;;
  esac
  DEV=/dev/$name
  [ -b "$DEV" ] || die "$DEV is missing"
  [ -d "/sys/block/$name/${name}p1" ] && [ -b "${DEV}p1" ] \
    || die "target $DEV has no partition 1 (loop devices need losetup -P)"
  # in use = mounted (by device number, whatever name the mount shows), swap, or held (dm, md, loop)
  mounted=$(awk '{ print $3 }' /proc/self/mountinfo) && [ -n "$mounted" ] \
    || die "cannot read /proc/self/mountinfo: refusing"
  for d in "/sys/block/$name" "/sys/block/$name/${name}"p*; do
    [ -d "$d" ] || continue
    dn=$(cat "$d/dev") && [ -n "$dn" ] || die "cannot read $d/dev: refusing"
    grep -qxF "$dn" <<< "$mounted" && die "target $DEV: ${d##*/} is mounted: refusing"
    [ -z "$(ls -A "$d/holders" 2>/dev/null)" ] || die "target $DEV: ${d##*/} is in use by $(ls "$d/holders"): refusing"
    grep -q "^/dev/${d##*/} " /proc/swaps 2>/dev/null && die "target $DEV: ${d##*/} is swap: refusing"
  done
  return 0
}
check_target

# KEY=value lines; values are taken literally (no shell expansion), one pair of quotes is stripped
SSH_PUBKEY=""
SSH_DROP_VENDOR_KEYS=no
SSH_PASSWORD_LOGIN=""   # unset: "no" with a key (set below), else "yes" (SSH is off then anyway)
load_config() {
  local key val
  while IFS= read -r line || [ -n "$line" ]; do
    line=${line%$'\r'}
    [[ $line =~ ^[[:space:]]*(#|$) ]] && continue
    key=${line%%=*}
    val=${line#*=}
    if [[ $val =~ ^\"(.*)\"$ || $val =~ ^\'(.*)\'$ ]]; then
      val=${BASH_REMATCH[1]}
    fi
    case $key in
      SSH_PUBKEY|SSH_DROP_VENDOR_KEYS|SSH_PASSWORD_LOGIN)
        printf -v "$key" '%s' "$val" ;;
      # Wi-Fi is set on the mixer's screen now (Mod page, Network): an older sd.env still builds
      WIFI_SSID|WIFI_PSK|WIFI_KEYMGMT)
        echo "note: $key in $1 is ignored, set Wi-Fi on the mixer's screen (Mod page, Network)" >&2 ;;
      *) echo "unknown key in $1: $key" >&2; exit 1 ;;
    esac
  done < "$1"
}

if [ -n "$SDCONF" ]; then
  load_config "$SDCONF"
  if [ -n "$SSH_PUBKEY" ]; then
    grep -q "PRIVATE KEY" "$SSH_PUBKEY" && { echo "SSH_PUBKEY is a private key, use the .pub file" >&2; exit 1; }
    grep -qE '^(ssh-(ed25519|rsa)|ecdsa-sha2-nistp[0-9]+) ' "$SSH_PUBKEY" || { echo "SSH_PUBKEY is not a public key" >&2; exit 1; }
  fi
  if [ "$SSH_DROP_VENDOR_KEYS" = yes ] && [ -z "$SSH_PUBKEY" ]; then
    echo "SSH_DROP_VENDOR_KEYS=yes needs SSH_PUBKEY, or nobody can log in" >&2
    exit 1
  fi
fi
# a developer key turns SSH on at every start: then no password login unless sd.env asks for it
# (root's password is still the factory one, the same on every mixer)
[ -n "$SSH_PASSWORD_LOGIN" ] || { [ -n "$SSH_PUBKEY" ] && SSH_PASSWORD_LOGIN=no || SSH_PASSWORD_LOGIN=yes; }

PART=${DEV}p1
DATA=${DEV}p2
MNT=$(mktemp -d)
WORK=""
cleanup() {
  mountpoint -q "$MNT" && umount "$MNT"
  rmdir "$MNT"
  [ -z "$WORK" ] || rm -rf "$WORK"
}
trap cleanup EXIT

# Refuse before writing anything (the source was checked too, this guards the core on its own)
step 1 "checking the mixer's software"
mount -o ro,noload "$PART" "$MNT"
rc=0
sh "$TOOLS/check-rootfs.sh" "$MNT" "$DLZMOD_MODEL" || rc=$?
umount "$MNT"
[ "$rc" = 0 ] || exit 1

# DLZDATA goes into the free space after the rootfs (Mackie's eMMC leaves ~159 MiB), at most
# 256 MiB: on a real card the rest of the card is free, and 512-byte clusters (-s 1) stop working
# above ~128 GiB. The card's first boot grows it to the full card (sd-system/dlzmod-grow-data)
DATA_MIN_SECTORS=131072   # 64 MiB
DATA_MAX_SECTORS=524288   # 256 MiB
data_partition() {  # prints "<start> <size>" in sectors
  local parts p1_start p1_size start total size
  parts=$(sfdisk -d "$DEV" | grep -c 'start=' || true)
  if [ "$parts" != 1 ]; then
    echo "expected one partition on $DEV, found $parts: refusing" >&2
    exit 1
  fi
  read -r p1_start p1_size < <(sfdisk -d "$DEV" | sed -n 's/.*start= *\([0-9]*\), size= *\([0-9]*\).*/\1 \2/p')
  start=$(( (p1_start + p1_size + 2047) / 2048 * 2048 ))
  total=$(blockdev --getsz "$DEV")
  if [ $(( total - start )) -lt $DATA_MIN_SECTORS ]; then
    echo "only $(( (total - start) / 2048 )) MiB free after the rootfs, DLZDATA needs 64 MiB: refusing" >&2
    exit 1
  fi
  size=$(( total - start ))
  [ "$size" -le $DATA_MAX_SECTORS ] || size=$DATA_MAX_SECTORS
  echo "$start $size"
}
# DLZDATA_KEEP=1 (the on-device installer): DLZDATA is already there, made at the full card size
# before the copy because it holds the eMMC backup; it must be p2, right after the rootfs, and
# labelled DLZDATA. It gets no .dlzmod-fresh marker, so the first boot leaves it alone
keep_data() {
  local parts p1_start p1_size start
  parts=$(sfdisk -d "$DEV" | grep -c 'start=' || true)
  [ "$parts" = 2 ] || die "expected the rootfs and DLZDATA on $DEV, found $parts partitions: refusing"
  read -r p1_start p1_size < <(sfdisk -d "$DEV" | sed -n 's/.*start= *\([0-9]*\), size= *\([0-9]*\).*/\1 \2/p')
  start=$(( (p1_start + p1_size + 2047) / 2048 * 2048 ))
  [ -b "$DATA" ] || die "$DATA is missing"
  [ "$(cat "/sys/class/block/${DATA##*/}/start")" = "$start" ] || die "$DATA does not start right after the rootfs (sector $start): refusing"
  [ "$(blkid -p -o value -s LABEL "$DATA" 2>/dev/null)" = DLZDATA ] || die "$DATA is not labelled DLZDATA: refusing"
}

# sfdisk asks the kernel to re-read the table; if the partition node does not show up, retry
# with blockdev
wait_for_part() {
  local i
  for i in 1 2 3 4 5 6 7 8 9 10; do
    [ -b "$1" ] && return 0
    sleep 1
  done
  return 1
}
if [ "${DLZDATA_KEEP:-}" = 1 ]; then
  keep_data
  step 2 "recordings partition"
  echo "DLZDATA: p2 kept as the installer made it, $(( $(blockdev --getsize64 "$DATA") / 1048576 )) MiB"
else
  read -r DATA_START DATA_SIZE < <(data_partition) && [ -n "$DATA_SIZE" ] || exit 1
  step 2 "recordings partition"
  echo "start=$DATA_START, size=$DATA_SIZE, type=c" | sfdisk --quiet --append "$DEV"
  if ! wait_for_part "$DATA"; then
    blockdev --rereadpt "$DEV"
    wait_for_part "$DATA" || die "$DATA did not appear after adding it"
  fi

  # The .dlzmod-fresh marker allows the first boot to grow and reformat DLZDATA, exactly once
  mkfs.vfat -F 32 -s 1 -n DLZDATA "$DATA" >/dev/null
  # iocharset=ascii: the kernel's default (iso8859-1) is a module, and the installer's initramfs
  # has no modprobe to load it on demand, so a plain vfat mount fails there
  mount -t vfat -o iocharset=ascii "$DATA" "$MNT"
  touch "$MNT/.dlzmod-fresh"
  umount "$MNT"
  echo "DLZDATA: p2 at sector $DATA_START, $(( $(blockdev --getsize64 "$DATA") / 1048576 )) MiB (grows to the full card on first boot)"
fi

# e2fsck: 0 = clean, 1/2 = errors corrected; anything higher is a real problem
step 3 "checking the file system"
rc=0
e2fsck -fy "$PART" || rc=$?
if [ "$rc" -gt 2 ]; then
  echo "e2fsck failed ($rc)" >&2
  exit 1
fi

# OLD = the UUID the copied files point to, i.e. the source's (the eMMC rootfs). The filesystem's own
# UUID is the same on the PC path; the installer has already changed it on the raw copy (so two disks
# with the eMMC's UUID never exist at once), so it is not used to find what to replace
step 4 "giving the copy its own id"
FS_UUID=$(blkid -s UUID -o value "$PART")
mount -o ro "$PART" "$MNT"
OLD=$(sed -n 's/^rootdev=UUID=//p' "$MNT/boot/armbianEnv.txt")
umount "$MNT"
# the same UUID as the eMMC rootfs would let the card's kernel mount the eMMC rootfs
[[ $OLD =~ ^[0-9a-f-]{36}$ ]] && [ "$NEW" != "$OLD" ] || die "new rootfs UUID must differ from the source's ($OLD)"
tune2fs -U "$NEW" "$PART" >/dev/null
echo "rootfs UUID: $OLD -> $NEW$([ "$FS_UUID" = "$OLD" ] || echo " (filesystem had $FS_UUID)")"

mount "$PART" "$MNT"

sed -i "s/$OLD/$NEW/g" "$MNT/boot/armbianEnv.txt" "$MNT/etc/fstab"
if grep -rIl "$OLD" "$MNT/boot" "$MNT/etc" 2>/dev/null; then
  echo "old UUID still referenced in the files above" >&2
  exit 1
fi
grep -q "rootdev=UUID=$NEW" "$MNT/boot/armbianEnv.txt" || die "armbianEnv.txt has no rootdev=UUID=$NEW"
grep -q "^UUID=$NEW " "$MNT/etc/fstab" || die "fstab has no UUID=$NEW line"

install_ssh() {
  local keys=$MNT/root/.ssh/authorized_keys
  if [ -n "$SSH_PUBKEY" ]; then
    mkdir -p "$MNT/root/.ssh"
    chmod 700 "$MNT/root/.ssh"
    [ -f "$keys" ] && { [ -f "$keys.orig" ] || cp -a "$keys" "$keys.orig"; }
    if [ "$SSH_DROP_VENDOR_KEYS" = yes ]; then
      : > "$keys"
    fi
    tr -d '\r' < "$SSH_PUBKEY" >> "$keys"
    chmod 600 "$keys"
    # remove_factory_access (apply-mod.sh) turned SSH off; with the developer's own key it stays on
    ln -sfn /lib/systemd/system/ssh.service "$MNT/etc/systemd/system/multi-user.target.wants/ssh.service"
    # and at every start: ssh.service.d/dlzmod.conf starts sshd only with a marker, this is the
    # Mod page's "Keep on after a restart" one (DLZMOD_sshPaths in dlzmod-server.js)
    mkdir -p "$MNT/var/lib/dlzmod-ssh"
    chmod 700 "$MNT/var/lib/dlzmod-ssh"
    : > "$MNT/var/lib/dlzmod-ssh/keep-on"
    chmod 600 "$MNT/var/lib/dlzmod-ssh/keep-on"
    echo "ssh: key added ($(grep -c . "$keys") key(s) in authorized_keys), SSH on"
  fi
  if [ "$SSH_PASSWORD_LOGIN" = no ]; then
    # sshd uses the first value it reads; the Include sits above Mackie's PermitRootLogin yes
    cat > "$MNT/etc/ssh/sshd_config.d/10-dlzmod.conf" <<'EOF'
PasswordAuthentication no
KbdInteractiveAuthentication no
PermitRootLogin prohibit-password
EOF
    echo "ssh: password login disabled"
  fi
}

# Swap the bootsplash inside a zstd initrd and rewrite the uImage header of uInitrd. Only the
# splash entry changes (cpio-replace.py, mtime = build time), so a fixed SOURCE_DATE_EPOCH gives
# the same bytes from the same tools.
replace_initrd_splash() {
  local initrd=$1 uinitrd=$2 splash=$3 work
  work=$(mktemp -d)
  WORK=$work
  zstd -dc "$initrd" > "$work/orig.cpio"
  python3 "$TOOLS/cpio-replace.py" "$work/orig.cpio" "$work/new.cpio" "$SPLASH_PATH" "$splash" "$BUILD_TIME"
  zstd -q -1 -T0 < "$work/new.cpio" > "$work/initrd"
  cp "$work/initrd" "$initrd"

  python3 - "$uinitrd" "$initrd" "$BUILD_TIME" <<'PY'
import struct, sys, zlib
uinitrd, initrd, build_time = sys.argv[1], sys.argv[2], int(sys.argv[3])
hdr = bytearray(open(uinitrd, "rb").read(64))
data = open(initrd, "rb").read()
struct.pack_into(">III", hdr, 4, 0, build_time, len(data))
struct.pack_into(">I", hdr, 24, zlib.crc32(data) & 0xFFFFFFFF)
struct.pack_into(">I", hdr, 4, zlib.crc32(bytes(hdr)) & 0xFFFFFFFF)
open(uinitrd, "wb").write(bytes(hdr) + data)
PY

  zstd -dc "$initrd" | (cd "$work" && rm -rf check && mkdir check && cd check && cpio -idm --quiet "$SPLASH_PATH")
  cmp "$work/check/$SPLASH_PATH" "$splash"
  # same file list as the original (into files: a failure inside <(...) would not stop the script,
  # and two empty lists would compare equal)
  cpio -t --quiet < "$work/orig.cpio" > "$work/list.orig"
  zstd -dc "$initrd" | cpio -t --quiet > "$work/list.new"
  [ -s "$work/list.orig" ] && [ -s "$work/list.new" ] || { echo "initrd file list empty" >&2; exit 1; }
  cmp "$work/list.orig" "$work/list.new"
  rm -rf "$work"
  WORK=""
}

# The layers come pre-rendered (Pillow on the PC); composing runs here, stdlib + ffmpeg only
install_visuals() {
  local initrd kver
  [ -f "$MNT/etc/dlz.png.orig" ] || cp -a "$MNT/etc/dlz.png" "$MNT/etc/dlz.png.orig"
  [ -f "$MNT/$SPLASH_PATH.orig" ] || cp -a "$MNT/$SPLASH_PATH" "$MNT/$SPLASH_PATH.orig"

  sh "$TOOLS/mkvisuals.sh" "$MNT/etc/dlz.png.orig" "$MNT/$SPLASH_PATH.orig" "$LAYERS" \
    "$MNT/etc/dlz.png" "$MNT/$SPLASH_PATH"
  for initrd in "$MNT"/boot/initrd.img-*; do
    kver=${initrd##*/initrd.img-}
    replace_initrd_splash "$initrd" "$MNT/boot/uInitrd-$kver" "$MNT/$SPLASH_PATH"
    echo "bootsplash replaced in initrd/uInitrd for $kver"
  done
}

# Recordings default to the card (DLZDATA) instead of a USB stick: stock's own default is microSD,
# the dump's saved state has USB, and on the XS the single USB port is wanted for the Wi-Fi stick.
set_rec_default_sd() {
  local f=$MNT/srv/srv_data.json
  if [ "$(grep -c '"settings\.rec\.toUSB": *[01]' "$f")" != 1 ]; then
    echo "srv_data.json: settings.rec.toUSB not found exactly once, left as is" >&2
    return 0
  fi
  [ -f "$f.orig" ] || cp -p "$f" "$f.orig"
  sed -i 's/"settings\.rec\.toUSB": *1/"settings.rec.toUSB": 0/' "$f"
  echo "srv_data.json: recordings default to microSD (settings.rec.toUSB=0)"
}

# install_sd_system, apply_patches, set_mod_defaults: shared with the drop-in update on the card
. "$TOOLS/apply-mod.sh"

# The keys the drop-in update accepts packages from (sd-system/dlzmod-update), fixed here for the
# card's whole life: not in apply-mod.sh, so no update changes them. A release install trusts the
# release key and its offline spare (release2) only; a dev-channel card (an installer built from a
# dev package, or build-sd.sh, which says so with DLZMOD_CHANNEL=dev) trusts the dev key too: the
# package's (mkpackage.sh put your own there when DLZMOD_SIGNING_KEYS had one), or for build-sd.sh
# DLZMOD_DEV_PUB when set.
install_update_keys() {
  local d=$MNT/usr/local/share/dlzmod-keys channel keys k src
  channel=$(update_channel) || die "$channel"
  keys="release release2 dev"
  [ "$channel" = dev ] || keys="release release2"
  rm -rf "$d"
  mkdir -p "$d"
  for k in $keys; do
    src=$TOOLS/keys/$k.pub
    # DLZMOD_DEV_PUB only without a package.env (build-sd.sh), as DLZMOD_CHANNEL: the installer's
    # environment can come from the kernel command line, so a package always uses its own keys/
    if [ "$k" = dev ] && [ -n "${DLZMOD_DEV_PUB:-}" ] && [ ! -f "$TOOLS/../package.env" ]; then
      src=$DLZMOD_DEV_PUB
    fi
    { [ -f "$src" ] && grep -q "^-----BEGIN PUBLIC KEY-----" "$src" && ! grep -q "PRIVATE KEY" "$src"; } \
      || die "$src is not a public key"
    tr -d '\r' < "$src" > "$d/$k.pub"
    chmod 644 "$d/$k.pub"
  done
  sync
  echo "update keys: $keys"
}

step 5 "boot screens"
install_visuals
step 6 "safety guards"
install_sd_system
install_update_keys
# the mixer this card belongs to (dlzmod-cardcheck, before the FPGA loader); updates never change it
mkdir -p "$MNT/etc/dlzmod"
echo "$DLZMOD_MIXER_ID" > "$MNT/etc/dlzmod/mixer-id"
sync
echo "bound to: $([ "$DLZMOD_MIXER_ID" = any ] && echo "any mixer (developer card)" || echo "this mixer's eMMC")"
step 7 "mixer software changes"
apply_patches
set_rec_default_sd
set_mod_defaults
record_version
mark_version_shown
install_ssh

step 8 "finishing"
date -u -d "@$BUILD_TIME" +"%Y-%m-%dT%H:%M:%SZ" > "$MNT/root/.sd-build"
sync
echo "card done: $DEV"
