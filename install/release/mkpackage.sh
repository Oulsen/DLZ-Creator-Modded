#!/bin/bash
# Build the release package (run as root in WSL: the initramfs needs a /dev/console node).
#
# The package is one initramfs that carries everything the installer needs, so U-Boot loads a
# single file and it is all in RAM before the card is touched (notes/installer.md):
#   /init, /bin/busybox, /dev/console
#   /pkg/VERSION, /pkg/package.env
#   /pkg/install-card.sh  the real install's write path, sourced by /init
#   /pkg/probe.sh         the backup of a mixer the mod does not support (analysis only), with a hardware report
#   /pkg/boards.txt       Mackie bootloaders known to be safe next to the installer's own boot (backup gate)
#   /pkg/mod/     card-core.sh and what it calls (patch.py, app-mod/, server-mod/, sd-system/, ...)
#   /pkg/layers/  our boot-visual layers (mklayers.py, Pillow: rendered here, composed on the device)
#   /pkg/ui/      ui.py + glyphs.bin (mkglyphs.py)
#   /pkg/manifest sha256 of every file under /pkg (sha256sum -c format, checked by /init)
# Output: <out>/<name>/{initrd.cpio.gz, package.env, manifest} (manifest = sha256 of the other two),
# <out>/<name>.tar of that directory and <out>/<name>.tar.sig, the ed25519 signature over the whole
# tar (the drop-in update checks it before it opens anything). <name> is
# dlzmod-<version>-dev-<commit> by default, signed with the dev key (not at all with uncommitted
# changes or new files: <commit>+dirty, for PC rehearsals only); RELEASE=1 gives
# dlzmod-<version>, signed with the release key, and needs a clean tree (a release must be
# rebuildable from its commit). The private keys (mkkeys.sh) are in DLZMOD_SIGNING_KEYS, a folder
# outside the repo; the signature is checked against the public key the cards get: install/keys/ for
# the release keys; for the dev key DLZMOD_SIGNING_KEYS/dev.pub when it is there (your own,
# mkkeys.sh), else install/keys/dev.pub. A release package always carries install/keys/dev.pub
# (rebuildable from its commit; release cards do not install the dev key anyway).
# SOURCE_DATE_EPOCH (default: last commit time) makes the output reproducible.
#
# package.env is read by name, also by updaters already on cards: add keys, never rename or drop one.
# Values without spaces or quotes (read with sed, never sourced). MODEL=XS is for updaters from before
# the full-size support (they compare it with the card's model); newer ones read MODELS (comma list).
#
# Usage: DLZMOD_SIGNING_KEYS=<folder> [RELEASE=1 [RELEASE_KEY=release2]] [DLZMOD_SIGNING_PASS=...]
#        mkpackage.sh [out dir, default build/release]
# Needs: python3 with Pillow, fonts-dejavu-core, cpio, gzip, dpkg-deb, curl, qemu-arm, openssl
set -euo pipefail
umask 022

REPO=$(cd "$(dirname "$0")/../.." && pwd)
OUT=${1:-$REPO/build/release}
INST=$REPO/install
. "$INST/release/vendor.sh"

VERSION=$(python3 -c 'import sys; sys.path.insert(0, sys.argv[1]); from modversion import read_version; print(read_version())' "$INST")
export SOURCE_DATE_EPOCH=${SOURCE_DATE_EPOCH:-$(git -C "$REPO" -c safe.directory="$REPO" -c core.autocrlf=true log -1 --format=%ct)}
[[ $SOURCE_DATE_EPOCH =~ ^[0-9]+$ ]] || { echo "SOURCE_DATE_EPOCH must be seconds since 1970" >&2; exit 1; }
COMMIT=$(git -C "$REPO" -c safe.directory="$REPO" -c core.autocrlf=true rev-parse --short HEAD)
git -C "$REPO" -c safe.directory="$REPO" -c core.autocrlf=true diff --quiet HEAD -- install VERSION || COMMIT="$COMMIT+dirty"
# new files count too (git diff does not see them): a release must be rebuildable from its commit
untracked=$(git -C "$REPO" -c safe.directory="$REPO" ls-files --others --exclude-standard -- install VERSION)
[ -z "$untracked" ] || COMMIT="${COMMIT%+dirty}+dirty"
if [ "${RELEASE:-}" = 1 ]; then
  case $COMMIT in *+dirty) echo "RELEASE=1 needs a clean tree (install/ or VERSION has changes or new files)" >&2; exit 1 ;; esac
  BUILD=release
  CHANNEL=release
  NAME=dlzmod-$VERSION
else
  BUILD=dev-$COMMIT
  CHANNEL=dev
  NAME=dlzmod-$VERSION-$BUILD
fi

for c in python3 cpio gzip dpkg-deb curl qemu-arm sha256sum mknod tar openssl; do
  command -v "$c" >/dev/null || { echo "missing: $c" >&2; exit 1; }
done
# the signing key, checked before the build: the matching public key must be the one cards trust.
# A tree with uncommitted changes is never signed: a signed package is root code on every card that
# trusts its key, so only committed code gets one (its tar still serves the PC rehearsals)
# The key: dev for dev builds; release (RELEASE_KEY=release2: the spare, if release.pem is lost or
# leaked) for releases. An encrypted key's passphrase comes from DLZMOD_SIGNING_PASS (CI: a secret)
# or is asked once here; it is kept in an unexported variable and handed to the two openssl calls
# only, never to the rest of the build (curl, dpkg-deb, qemu-arm running firmware binaries, ...).
SIGNPASS=${DLZMOD_SIGNING_PASS:-}
unset DLZMOD_SIGNING_PASS
SIGN=yes
case $COMMIT in *+dirty) SIGN=no ;; esac
KEYNAME=$CHANNEL
if [ "$CHANNEL" = release ]; then
  KEYNAME=${RELEASE_KEY:-release}
  case $KEYNAME in release|release2) ;; *) echo "RELEASE_KEY must be release or release2" >&2; exit 1 ;; esac
fi
for k in release release2 dev; do
  [ -f "$INST/keys/$k.pub" ] || { echo "no public key: $INST/keys/$k.pub (mkkeys.sh)" >&2; exit 1; }
done
# the dev key the package's cards trust: your own next to dev.pem, else the repo's
DEVPUB=$INST/keys/dev.pub
if [ "$CHANNEL" = dev ] && [ -n "${DLZMOD_SIGNING_KEYS:-}" ] && [ -f "$DLZMOD_SIGNING_KEYS/dev.pub" ]; then
  DEVPUB=$DLZMOD_SIGNING_KEYS/dev.pub
  # checked here, signed or not: a dirty package is passed around too, and the card would only find a
  # wrong file halfway through an install. It must be a public key, and the one of the dev.pem next
  # to it (a card that trusts a key whose private half is elsewhere refuses every update you sign)
  grep -q "^-----BEGIN PUBLIC KEY-----" "$DEVPUB" && ! grep -q "PRIVATE KEY" "$DEVPUB" \
    || { echo "$DEVPUB is not a public key" >&2; exit 1; }
  if [ -f "$DLZMOD_SIGNING_KEYS/dev.pem" ] && ! grep -q "ENCRYPTED" "$DLZMOD_SIGNING_KEYS/dev.pem"; then
    [ "$(openssl pkey -in "$DLZMOD_SIGNING_KEYS/dev.pem" -pubout)" = "$(tr -d '\r' < "$DEVPUB")" ] \
      || { echo "$DEVPUB is not the public key of $DLZMOD_SIGNING_KEYS/dev.pem" >&2; exit 1; }
  fi
fi
echo "dev key in the package: $DEVPUB"
PUBKEY=$INST/keys/$KEYNAME.pub
[ "$KEYNAME" != dev ] || PUBKEY=$DEVPUB
PASSIN=()
# openssl with the signing key: the passphrase in its own environment only
keyssl() { DLZMOD_SIGNING_PASS=$SIGNPASS openssl "$@"; }
if [ "$SIGN" = yes ]; then
  SIGNKEY=${DLZMOD_SIGNING_KEYS:?set DLZMOD_SIGNING_KEYS to the folder with the private keys (mkkeys.sh)}/$KEYNAME.pem
  [ -f "$SIGNKEY" ] || { echo "no $KEYNAME signing key: $SIGNKEY" >&2; exit 1; }
  if grep -q "ENCRYPTED" "$SIGNKEY"; then
    if [ -z "$SIGNPASS" ]; then
      # read -p prompts on stderr: to the terminal too, else the prompt is lost with the error
      { read -rsp "passphrase for $KEYNAME.pem: " SIGNPASS < /dev/tty 2> /dev/tty && echo > /dev/tty; } 2>/dev/null \
        || { echo "no terminal to ask the passphrase of $KEYNAME.pem: run in an interactive terminal, or set DLZMOD_SIGNING_PASS" >&2; exit 1; }
    fi
    PASSIN=(-passin env:DLZMOD_SIGNING_PASS)
  fi
  [ "$(keyssl pkey -in "$SIGNKEY" "${PASSIN[@]}" -pubout)" = "$(tr -d '\r' < "$PUBKEY")" ] \
    || { echo "$SIGNKEY does not match $PUBKEY (or a wrong passphrase)" >&2; exit 1; }
fi

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
vendor_prepare "$REPO/vendor"

# busybox must have every applet /init uses (the static ARM binary runs under qemu-arm)
have=$(qemu-arm "$REPO/vendor/busybox.bin" --list)
# Every chroot call names its tool by absolute path: by bare name, busybox's chroot runs its own
# applet when it has one (losetup, cmp, env, sh ...) instead of the mixer's tool [device]
# (any root, any spacing; comment lines skipped; the tool must start with / or "/)
bare=$(grep -nE '(^|[^a-z_-])chroot[[:space:]]+("[^"]*"|[^[:space:]]+)([[:space:]]+[^/"[:space:]]|[[:space:]]+"[^/]|[[:space:]]*\\?$)' \
  "$INST/installer/init" "$INST/installer/install-card.sh" "$INST/installer/probe.sh" | grep -vE '^[^:]+:[0-9]+:[[:space:]]*#' || true)
[ -z "$bare" ] || { echo "chroot by bare tool name (use an absolute path):" >&2; echo "$bare" >&2; exit 1; }
# the drop-in update checks the safety guards against its own list of their sha256: it must match
# the files that ship (a changed guard means a full install for everyone, sd-system/dlzmod-update)
guards=$(sed -n '/^GUARDS="/,/"$/p' "$INST/sd-system/dlzmod-update" | sed 's/^GUARDS="//; s/"$//')
[ "$(grep -c . <<< "$guards")" = 8 ] || { echo "dlzmod-update: GUARDS list not found" >&2; exit 1; }
while read -r sum path; do
  src=$INST/sd-system/${path#etc/systemd/system/}
  src=${src/usr\/local\/sbin\//}
  src=${src/etc\/udev\/rules.d\//}
  [ "$(sha256sum < "$src" | cut -d' ' -f1)" = "$sum" ] || { echo "dlzmod-update: GUARDS hash for $path does not match $src" >&2; exit 1; }
done <<< "$guards"
# its copy of the scheduling drop-ins (#140), which it places on a card an older updater left without
sched=$(sed -n "/^SCHED_CONF=\$(cat << 'SCHED_EOF'$/,/^SCHED_EOF$/p" "$INST/sd-system/dlzmod-update" | sed '1d;$d')
for u in glesgui evolve-node evolve-app; do
  [ -n "$sched" ] && [ "$sched" = "$(cat "$INST/sd-system/$u.service.d/dlzmod.conf")" ] \
    || { echo "dlzmod-update: SCHED_CONF does not match sd-system/$u.service.d/dlzmod.conf" >&2; exit 1; }
done
# and of the early-start drop-ins (#141), which its gate also takes only with that text
early=$(sed -n "/^EARLY_CONF=\$(cat << 'EARLY_EOF'$/,/^EARLY_EOF$/p" "$INST/sd-system/dlzmod-update" | sed '1d;$d')
for u in dlzmod-update dlzmod-grow-data; do
  [ -n "$early" ] && [ "$early" = "$(cat "$INST/sd-system/$u.service.d/dlzmod.conf")" ] \
    || { echo "dlzmod-update: EARLY_CONF does not match sd-system/$u.service.d/dlzmod.conf" >&2; exit 1; }
done
missing=$(grep -v '^#' "$INST/installer/applets.txt" | grep . | grep -vxF -f <(echo "$have") || true)
[ -z "$missing" ] || { echo "busybox lacks applets:" $missing >&2; exit 1; }

root=$work/root
pkg=$root/pkg
mkdir -p "$root/bin" "$root/dev" "$pkg/mod/app-mod" "$pkg/mod/server-mod" "$pkg/layers" "$pkg/ui"
install -m 755 "$REPO/vendor/busybox.bin" "$root/bin/busybox"
install -m 755 "$INST/installer/init" "$root/init"
mknod -m 600 "$root/dev/console" c 5 1

# mod: what card-core.sh needs next to itself (its preflight lists the same files)
for f in card-core.sh check-rootfs.sh mkvisuals.sh; do install -m 755 "$INST/$f" "$pkg/mod/"; done
install -m 644 "$INST/apply-mod.sh" "$pkg/mod/"
for f in cpio-replace.py patch.py modversion.py logobbox.py bootsplash.py; do install -m 644 "$INST/$f" "$pkg/mod/"; done
install -m 644 "$INST/app-mod/dlzmod.js" "$pkg/mod/app-mod/"
install -m 644 "$INST/server-mod/dlzmod-server.js" "$pkg/mod/server-mod/"
cp -r "$INST/sd-system" "$pkg/mod/sd-system"
# fixed modes, not the source's (a tree on /mnt/d shows every file as 755, a Linux clone git's): the
# same package from the same commit anywhere; apply-mod.sh places each file with its own mode
find "$pkg/mod/sd-system" -type d -exec chmod 755 {} + -o -type f -exec chmod 644 {} +
mkdir "$pkg/mod/keys"
for k in release release2; do tr -d '\r' < "$INST/keys/$k.pub" > "$pkg/mod/keys/$k.pub"; done
tr -d '\r' < "$DEVPUB" > "$pkg/mod/keys/dev.pub"
install -m 644 "$REPO/VERSION" "$pkg/VERSION"
install -m 644 "$INST/installer/install-card.sh" "$pkg/install-card.sh"
install -m 644 "$INST/installer/boards.txt" "$pkg/boards.txt"
install -m 644 "$INST/installer/probe.sh" "$pkg/probe.sh"

python3 "$INST/mklayers.py" "$pkg/layers"
python3 "$INST/release/mkglyphs.py" "$pkg/ui/glyphs.bin"
python3 "$INST/release/mklogo.py" "$pkg/ui/logo.bin" --version-file "$REPO/VERSION"
install -m 644 "$INST/installer/ui.py" "$pkg/ui/ui.py"

placeholder=no
grep -lq DLZMOD-PLACEHOLDER "$INST/installer/init" "$INST/installer/ui.py" && placeholder=yes
dryrun_only=no
grep -q DLZMOD-DRYRUN-ONLY "$INST/installer/init" && dryrun_only=yes
cat > "$pkg/package.env" <<EOF
DLZMOD_VERSION=$VERSION
MODEL=XS
MODELS=XS,full-size
EVOLVE_NODE=3297
REINSTALL=no
PLACEHOLDER=$placeholder
DRYRUN_ONLY=$dryrun_only
BUILT=$(date -u -d "@$SOURCE_DATE_EPOCH" +%Y-%m-%dT%H:%M:%SZ)
COMMIT=$COMMIT
BUILD=$BUILD
CHANNEL=$CHANNEL
EOF

find "$root" -name __pycache__ -prune -exec rm -rf {} +
(cd "$pkg" && find . -type f ! -name manifest | LC_ALL=C sort | sed 's#^\./##' | xargs sha256sum > manifest)
find "$root" -exec touch -h -d "@$SOURCE_DATE_EPOCH" {} +
rel=$work/$NAME
mkdir "$rel"
(cd "$root" && find . | LC_ALL=C sort | cpio -o -H newc --reproducible --quiet) | gzip -9 -n > "$rel/initrd.cpio.gz"
cp "$pkg/package.env" "$rel/package.env"
(cd "$rel" && sha256sum initrd.cpio.gz package.env > manifest)
find "$rel" -exec touch -h -d "@$SOURCE_DATE_EPOCH" {} +

mkdir -p "$OUT"
rm -rf "${OUT:?}/$NAME" "$OUT/$NAME.tar" "$OUT/$NAME.tar.sig"
cp -a "$rel" "$OUT/$NAME"
tar -C "$work" --sort=name --mtime="@$SOURCE_DATE_EPOCH" --owner=0 --group=0 --numeric-owner \
  --format=ustar -cf "$OUT/$NAME.tar" "$NAME"
echo "package: $OUT/$NAME.tar ($(stat -c %s "$OUT/$NAME.tar") bytes, $(wc -l < "$pkg/manifest") files," \
  "initrd $(stat -c %s "$rel/initrd.cpio.gz") bytes, commit $COMMIT, placeholder $placeholder)"
if [ "$SIGN" = no ]; then
  echo "NOT SIGNED: uncommitted changes (cards refuse it as an update; commit, then build)"
  exit 0
fi
# ed25519 signatures are deterministic: the same tar and key give the same .sig
tr -d '\r' < "$PUBKEY" > "$work/pub.pem"
keyssl pkeyutl -sign -inkey "$SIGNKEY" "${PASSIN[@]}" -rawin -in "$OUT/$NAME.tar" -out "$work/sig" \
  && openssl pkeyutl -verify -pubin -inkey "$work/pub.pem" -rawin -in "$OUT/$NAME.tar" -sigfile "$work/sig" >/dev/null \
  || { echo "signing failed or the signature does not verify: package removed" >&2; rm -rf "$OUT/$NAME.tar" "${OUT:?}/$NAME"; exit 1; }
cp "$work/sig" "$OUT/$NAME.tar.sig"
echo "signature: $OUT/$NAME.tar.sig ($KEYNAME key); copy both files to DLZDATA/dlzmod-update/"
