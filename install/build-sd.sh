#!/bin/bash
# Build an SD-bootable copy of a DLZ eMMC dump (run as root on Linux/WSL): a test card from the PC.
#
# Prepares the input for the card core and runs it; the on-device installer does the same with
# the eMMC and the SD card (notes/installer.md):
# - refuses any source other than the firmware our patches are made for, on the DLZ Creator or XS
#   (check-rootfs.sh, before copying)
# - copies the dump to <output.img> and attaches it as a loop device
# - renders our boot-visual layers (mklayers.py, Pillow; no version on them, #97)
# - card-core.sh does the rest: DLZDATA partition, new rootfs UUID, visuals, brick guards, UI and
#   server mods, optional Wi-Fi/SSH from a config file (see sd.env.example)
#
# The card trusts the release keys and a dev key: your own when DLZMOD_SIGNING_KEYS holds a dev.pub
# (mkkeys.sh dev), else install/keys/dev.pub.
#
# Usage: [DLZMOD_SIGNING_KEYS=<key folder>] [SDCONF=sd.env] [DLZMOD_UUID=<uuid>] [SOURCE_DATE_EPOCH=<s>]
#        build-sd.sh <emmc-user.img> <output.img>
# Needs: e2fsprogs, dosfstools, fdisk (sfdisk), cpio, zstd, ffmpeg, python3 with Pillow, fonts-dejavu-core,
# openssl (own dev key only)
set -euo pipefail

SRC=$1
OUT=$2
TOOLS=$(cd "$(dirname "$0")" && pwd)
DEVPUB=$TOOLS/keys/dev.pub
if [ -n "${DLZMOD_SIGNING_KEYS:-}" ] && [ -f "$DLZMOD_SIGNING_KEYS/dev.pub" ]; then
  DEVPUB=$DLZMOD_SIGNING_KEYS/dev.pub
fi
grep -q "^-----BEGIN PUBLIC KEY-----" "$DEVPUB" && ! grep -q "PRIVATE KEY" "$DEVPUB" \
  || { echo "$DEVPUB is not a public key" >&2; exit 1; }
# your own dev.pub must be the dev.pem's next to it: a card that trusts a key whose private half is
# elsewhere refuses every update you sign
if [ "$DEVPUB" != "$TOOLS/keys/dev.pub" ] && [ -f "$DLZMOD_SIGNING_KEYS/dev.pem" ] \
   && ! grep -q "ENCRYPTED" "$DLZMOD_SIGNING_KEYS/dev.pem"; then
  command -v openssl >/dev/null || { echo "missing: openssl" >&2; exit 1; }
  [ "$(openssl pkey -in "$DLZMOD_SIGNING_KEYS/dev.pem" -pubout)" = "$(tr -d '\r' < "$DEVPUB")" ] \
    || { echo "$DEVPUB is not the public key of $DLZMOD_SIGNING_KEYS/dev.pem" >&2; exit 1; }
fi
echo "dev key on the card: $DEVPUB"

CHK=$(mktemp -d)
LAYERS=$(mktemp -d)
SRC_LOOP=
LOOP=
WROTE=no
DONE=no
cleanup() {
  mountpoint -q "$CHK" && umount "$CHK"
  [ -z "$SRC_LOOP" ] || losetup -d "$SRC_LOOP"
  [ -z "$LOOP" ] || losetup -d "$LOOP"
  rm -rf "$CHK" "$LAYERS"
  # a half-built image must not be flashed by mistake
  [ "$WROTE" = no ] || [ "$DONE" = yes ] || { rm -f "$OUT"; echo "build failed: $OUT removed" >&2; }
}
trap cleanup EXIT

# a typo must never overwrite (or, on failure, delete) the dump or anything that is not an image
[ -f "$SRC" ] || { echo "$SRC is not a file" >&2; exit 1; }
if [ "$SRC" -ef "$OUT" ]; then
  echo "output is the source dump: refusing" >&2
  exit 1
fi
if [ -e "$OUT" ] && { [ ! -f "$OUT" ] || [ -L "$OUT" ]; }; then
  echo "$OUT exists and is not a plain file: refusing" >&2
  exit 1
fi

SRC_LOOP=$(losetup -P -r -f --show "$SRC")
mount -o ro,noload "${SRC_LOOP}p1" "$CHK"
src=$(sh "$TOOLS/check-rootfs.sh" "$CHK")
echo "$src"
model=${src#source: DLZ Creator }; model=${model%%,*}   # XS or full-size: card-core checks the copy against it
umount "$CHK"
losetup -d "$SRC_LOOP"
SRC_LOOP=

# cp would overwrite an image that an older loop device still has attached (maybe mounted)
if [ -e "$OUT" ] && [ -n "$(losetup -j "$OUT")" ]; then
  echo "$OUT is still attached to a loop device (losetup -j): refusing" >&2
  exit 1
fi

python3 "$TOOLS/mklayers.py" "$LAYERS"
WROTE=yes
cp --sparse=always "$SRC" "$OUT"
LOOP=$(losetup -P -f --show "$OUT")
# a dev-channel card: it trusts the dev key besides the release keys (card-core.sh, install_update_keys)
# a dump has no eMMC CID: the card is not bound to one mixer (dlzmod-cardcheck still compares the
# flag and GD32 marker with the eMMC of the mixer it starts in: never in the other model)
DLZMOD_CHANNEL=dev DLZMOD_DEV_PUB=$DEVPUB DLZMOD_MODEL=$model DLZMOD_MIXER_ID=any \
  bash "$TOOLS/card-core.sh" "$LOOP" "$LAYERS"
DONE=yes
echo "done: $OUT"
