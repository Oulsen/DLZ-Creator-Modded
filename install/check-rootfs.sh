#!/bin/sh
# Check that a mounted DLZ rootfs is the firmware our patches are made for: evolve-node 3297
# (firmware 1.2.0 build 1731), whose app.js the anchors in patch.py match, on the DLZ Creator XS or
# the full-size DLZ Creator. Mackie ships one image for both; the factory marks an XS with an empty
# /root/.dlzlite (notes/architecture.md, "One firmware, two products"), which also picks the GD32
# firmware: flash-gd32.sh flashes firmware-dlzlite-154.bin (XS) or firmware-evolve-154.bin
# (full-size) and leaves /root/.gd32-loaded-<that file>. The card never flashes the GD32
# (sd-system/flash-gd32.service.d), so the clone must carry exactly the marker its model's firmware
# leaves: a marker of the other model, of another version, or more than one means a mixer in a state
# we do not know, refused. Used on the source before copying (build-sd.sh, the installer), on the
# target before patching (card-core.sh, with the source's model) and on the card before an update
# (dlzmod-update). Needs only sh, awk, grep and ls (runs on the PC and in the device chroot).
#
# Usage: check-rootfs.sh <mounted rootfs> [expected model: XS | full-size]
# Prints one "source: ..." line; exit 1 = not supported (reason on stderr)
set -eu

SUPPORTED_EVOLVE_NODE=3297
GD32_FIRMWARE_VERSION=154
root=$1
expect=${2:-}

model=full-size; fw=evolve
if [ -f "$root/root/.dlzlite" ]; then model=XS; fw=dlzlite; fi
want=.gd32-loaded-firmware-$fw-$GD32_FIRMWARE_VERSION.bin
node=$(awk '/^Package: evolve-node$/ {f=1} f && /^Version:/ {print $2; exit}' "$root/var/lib/dpkg/status" 2>/dev/null || true)
build=$(grep -o 'build [0-9]*' "$root/srv/srv_data.json" 2>/dev/null | head -1 || true)
markers=$(cd "$root/root" 2>/dev/null && ls -d .gd32-loaded-* 2>/dev/null || true)
gd32=$(echo "$markers" | head -1)
nmarkers=$(echo "$markers" | grep -c . || true)
gd32_note=""
if [ -n "$gd32" ] && { [ "$nmarkers" != 1 ] || [ "$gd32" != "$want" ]; }; then gd32_note=" does not match"; fi
echo "source: DLZ Creator $model, evolve-node ${node:-?} (${build:-build ?}), GD32 marker ${gd32:-missing}$gd32_note"
if [ "$node" != "$SUPPORTED_EVOLVE_NODE" ]; then
  echo "not supported: our patches are for the DLZ Creator and DLZ Creator XS with evolve-node" \
    "$SUPPORTED_EVOLVE_NODE (firmware 1.2.0 build 1731). Nothing built." >&2
  exit 1
fi
if [ -n "$expect" ] && [ "$expect" != "$model" ]; then
  echo "this is a DLZ Creator $model, but the source was a DLZ Creator $expect (/root/.dlzlite differs):" \
    "refusing" >&2
  exit 1
fi
if [ -z "$gd32" ]; then
  echo "no /root/.gd32-loaded-* marker in the source: refusing (see notes/modding-guide.md, Brick risks)" >&2
  exit 1
fi
if [ -n "$gd32_note" ]; then
  echo "GD32 marker(s) $(echo "$markers" | tr '\n' ' ')do not match the $model ($want): refusing" \
    "(see notes/modding-guide.md, Brick risks)" >&2
  exit 1
fi
