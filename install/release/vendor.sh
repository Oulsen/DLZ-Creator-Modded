# Pinned third-party downloads for the installer (sourced by mkpackage.sh / mkinstaller.sh).
# Debian trixie armhf packages; the sha256s are the ones in Debian's own Packages index.
# Files land in vendor/ (git-ignored); a file that does not match is refused,
# never used. GPL: the release notes link the Debian source packages (u-boot, busybox).

UBOOT_DEB_URL=https://deb.debian.org/debian/pool/main/u/u-boot/u-boot-sunxi_2025.01-3+deb13u1_armhf.deb
UBOOT_DEB_SHA256=c34a1e756612a10ba3fa2abe4bdc6c0dd685cc472628879b0fe153251073c36a
# Banana Pi M2 Ultra build: same R40 SoC and DRAM setup as the DLZ board (proven on the device)
UBOOT_BIN_PATH=usr/lib/u-boot/Bananapi_M2_Ultra/u-boot-sunxi-with-spl.bin
UBOOT_BIN_SHA256=b6eab7e3b4b6436a6995e5402d38e2d20657d7bea94f8a8f71030733d1c42d23
# the same with safe built-in defaults (uboot-safe.py: SD card only, no USB start, GMAC off in its device tree) for our cards
UBOOT_SAFE_SHA256=dd38ed5c80fc3f3c031afa5873d1e46e54e97a99d151061841b83f61b8130dfa

BUSYBOX_DEB_URL=https://deb.debian.org/debian/pool/main/b/busybox/busybox-static_1.37.0-6+b9_armhf.deb
BUSYBOX_DEB_SHA256=8b35210e08d559ecc0ddb660dd96f6f9694f69eb27f1dc608f5eeda56d94509e

# <url> <sha256> <file>: download if missing, then verify (also a file that was already there)
vendor_fetch() {
  local url=$1 sha=$2 file=$3
  if [ ! -f "$file" ]; then
    mkdir -p "$(dirname "$file")"
    curl -fL -o "$file.part" "$url"
    mv "$file.part" "$file"
  fi
  if ! echo "$sha  $file" | sha256sum -c --quiet; then
    echo "$file does not match the pinned sha256: refusing (delete it to download again)" >&2
    return 1
  fi
}

# <vendor dir>: makes <dir>/u-boot-sunxi-with-spl.bin (Debian's), <dir>/u-boot-safe.bin (what goes on
# our cards) and <dir>/busybox.bin, all verified
vendor_prepare() {
  local dir=$1 work
  vendor_fetch "$UBOOT_DEB_URL" "$UBOOT_DEB_SHA256" "$dir/u-boot-sunxi.deb"
  vendor_fetch "$BUSYBOX_DEB_URL" "$BUSYBOX_DEB_SHA256" "$dir/busybox-static.deb"
  work=$(mktemp -d)
  dpkg-deb -x "$dir/u-boot-sunxi.deb" "$work/uboot"
  dpkg-deb -x "$dir/busybox-static.deb" "$work/busybox"
  cp "$work/uboot/$UBOOT_BIN_PATH" "$dir/u-boot-sunxi-with-spl.bin"
  cp "$work/busybox/usr/bin/busybox" "$dir/busybox.bin"
  rm -rf "$work"
  echo "$UBOOT_BIN_SHA256  $dir/u-boot-sunxi-with-spl.bin" | sha256sum -c --quiet \
    || { echo "U-Boot binary inside the package changed: refusing" >&2; return 1; }
  python3 "$(dirname "${BASH_SOURCE[0]}")/uboot-safe.py" "$dir/u-boot-sunxi-with-spl.bin" "$dir/u-boot-safe.bin" >/dev/null
  echo "$UBOOT_SAFE_SHA256  $dir/u-boot-safe.bin" | sha256sum -c --quiet     || { echo "patched U-Boot does not match the pinned sha256: refusing" >&2; return 1; }
}
