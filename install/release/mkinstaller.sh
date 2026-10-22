#!/bin/bash
# Build the flashable installer image around a package from mkpackage.sh (run as root in WSL:
# loop device + mount for filling the FAT partition).
#
# Card: Debian U-Boot at 8 KiB (built-in defaults made safe: SD card only, no USB, no GMAC; uboot-safe.py), MBR, one FAT32 partition already formatted and filled, so the
# user flashes it with Etcher/Rufus and nothing else (no format or copy step to forget):
#   boot.scr      install/installer/boot.txt (dry run: dlzmod.dryrun=1 on the kernel command line)
#   uboot.env     U-Boot limited to the SD card, no autoboot delay, no keyboard/USB input, so it
#                 never falls through to the eMMC's own boot.scr and never stops at a prompt
#   dlzmod/       the package: initrd.cpio.gz, package.env, manifest
# Output: <out>/dlz-installer-<version>[-dev-<commit>][-dryrun][-placeholder].img
#
# Usage: [ALLOW_PLACEHOLDER=1] mkinstaller.sh [--dry-run] <package dir> [out dir, default build/release]
# A package whose /init or ui.py is still a placeholder is refused unless ALLOW_PLACEHOLDER=1
# (for inspecting the build only; such an image is never flashed).
set -euo pipefail

REPO=$(cd "$(dirname "$0")/../.." && pwd)
DRYRUN=no
if [ "${1:-}" = --dry-run ]; then DRYRUN=yes; shift; fi
PKG=${1:?usage: mkinstaller.sh [--dry-run] <package dir> [out dir]}
OUT=${2:-$REPO/build/release}
PART_MIB=64
. "$REPO/install/release/vendor.sh"

(cd "$PKG" && sha256sum -c --quiet manifest) || { echo "$PKG does not match its manifest: refusing" >&2; exit 1; }
# package.env: KEY=value lines written by mkpackage.sh, read without sourcing
pkgval() { sed -n "s/^$1=//p" "$PKG/package.env"; }
VERSION=$(pkgval DLZMOD_VERSION)
[[ $VERSION =~ ^v[0-9]\.[0-9]{1,2}\.[0-9]{1,2}$ ]] || { echo "package.env: bad version '$VERSION'" >&2; exit 1; }
NAME=dlz-installer-$VERSION
BUILD=$(pkgval BUILD)
[ "$BUILD" = release ] || NAME=$NAME-$BUILD
# the image takes its boot route (boot.txt, mkscr/mkenv/mksdimg, the safe U-Boot) from this tree: a
# release image only from the clean commit its package was built from, as mkpackage.sh's RELEASE=1
if [ "$BUILD" = release ]; then
  git=(git -C "$REPO" -c safe.directory="$REPO" -c core.autocrlf=true)
  head=$("${git[@]}" rev-parse HEAD) || { echo "release image: git cannot read $REPO" >&2; exit 1; }
  if ! "${git[@]}" diff --quiet HEAD -- install VERSION \
     || [ -n "$("${git[@]}" ls-files --others --exclude-standard -- install VERSION)" ]; then
    echo "release image needs a clean tree (install/ or VERSION has changes or new files)" >&2
    exit 1
  fi
  pkgcommit=$(pkgval COMMIT)
  if ! [[ $pkgcommit =~ ^[0-9a-f]{7,40}$ ]] \
     || [ "$("${git[@]}" rev-parse --verify -q "$pkgcommit^{commit}")" != "$head" ]; then
    echo "package was built from commit '$pkgcommit', this tree is at ${head:0:12}:" \
      "check out the package's commit or rebuild the package" >&2
    exit 1
  fi
fi
[ "$DRYRUN" = yes ] && NAME=$NAME-dryrun
if [ "$(pkgval PLACEHOLDER)" != no ]; then
  [ "${ALLOW_PLACEHOLDER:-}" = 1 ] || { echo "package has a placeholder /init or ui.py (milestone 3): refusing" >&2; exit 1; }
  NAME=$NAME-placeholder
fi
# an /init that can only do dry runs must not ship as an image that looks like a real installer
if [ "$DRYRUN" = no ] && [ "$(pkgval DRYRUN_ONLY)" != no ]; then
  echo "package can only do dry runs (milestone 3): build it with --dry-run" >&2
  exit 1
fi
export SOURCE_DATE_EPOCH=${SOURCE_DATE_EPOCH:-$(date -u -d "$(pkgval BUILT)" +%s)}

vendor_prepare "$REPO/vendor"
UBOOT=$REPO/vendor/u-boot-safe.bin   # Debian U-Boot with safe built-in defaults (uboot-safe.py)

work=$(mktemp -d)
loop=""
img=""
cleanup() {
  mountpoint -q "$work/fat" 2>/dev/null && umount "$work/fat"
  [ -z "$loop" ] || losetup -d "$loop"
  rm -rf "$work"
  [ -z "$img" ] || rm -f "$img.part"
}
trap cleanup EXIT

extra=""
[ "$DRYRUN" = yes ] && extra="dlzmod.dryrun=1"
[ "$(grep -c '@EXTRA_ARGS@' "$REPO/install/installer/boot.txt")" = 1 ] || { echo "boot.txt: @EXTRA_ARGS@ not found once" >&2; exit 1; }
sed "s/@EXTRA_ARGS@/$extra/" "$REPO/install/installer/boot.txt" > "$work/boot.txt"
mkdir -p "$work/files/dlzmod"
python3 "$REPO/install/dumper/mkscr.py" -n "DLZ Creator Modded installer" "$work/boot.txt" "$work/files/boot.scr"
python3 "$REPO/install/dumper/mkenv.py" "$UBOOT" "$work/files/uboot.env" \
  "boot_targets=mmc0" "bootcmd=run distro_bootcmd; poweroff" "bootdelay=-2" "preboot=" "stdin=serial"
cp "$PKG/initrd.cpio.gz" "$PKG/package.env" "$PKG/manifest" "$work/files/dlzmod/"

mkdir -p "$OUT"
img=$OUT/$NAME.img
python3 "$REPO/install/dumper/mksdimg.py" "$UBOOT" "$img.part" --part-mib "$PART_MIB"
loop=$(losetup -f --show -o $((1024 * 1024)) --sizelimit $((PART_MIB * 1024 * 1024)) "$img.part")
mkfs.vfat -F 32 -s 1 -n DLZINSTALL -i "$(printf '%08X' $(( SOURCE_DATE_EPOCH & 0xFFFFFFFF )))" "$loop" >/dev/null
mkdir -p "$work/fat"
mount -t vfat "$loop" "$work/fat"
cp -r "$work/files/." "$work/fat/"
sync
(cd "$work/fat/dlzmod" && sha256sum -c --quiet manifest) || { echo "copy on the FAT does not match the manifest" >&2; exit 1; }
find "$work/fat" -type f -printf '  %P (%s bytes)\n' | sort
umount "$work/fat"
losetup -d "$loop"
loop=""
# the files' times on the FAT: SOURCE_DATE_EPOCH instead of the build's clock (same package, same image)
python3 "$REPO/install/release/fat-fixtimes.py" "$img.part" $((1024 * 1024)) "$SOURCE_DATE_EPOCH"
mv "$img.part" "$img"
echo "installer image: $img ($(stat -c %s "$img") bytes, dry run: $DRYRUN)"
