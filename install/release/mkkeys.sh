#!/bin/bash
# Make a signing key pair for update packages (ed25519, OpenSSL): the private key into a folder
# outside the repo; the public key of a release key into install/keys/, where card-core.sh takes it
# onto every card, the dev key's next to its private key.
#   release   signs releases; every card trusts it
#   release2  the spare release key, kept offline only: every card trusts it too, so if release.pem
#             is ever lost, releases signed with it still reach the cards out there (a leaked key
#             cannot be withdrawn from cards yet: #63)
#   dev       signs test builds; only dev-channel cards trust it (build-sd.sh, or an installer built
#             from a dev package). With DLZMOD_SIGNING_KEYS=<this folder>, mkpackage.sh and
#             build-sd.sh put this dev.pub on the cards instead of install/keys/dev.pub
# The release keys are encrypted (AES-256, a passphrase asked here, twice); the dev key is plain, for
# the quick test loop. Never overwrites a key: a card trusts the public keys it was installed with
# for its whole life. Keep the release keys off this PC as well (USB stick) and their passphrases
# in a password manager, apart from the files; notes/updates.md, "Signing keys".
# Run it in a terminal (Git Bash): the passphrase is read from it, never from the command line.
#
# Usage: mkkeys.sh <private key folder, outside the repo> release|release2|dev
set -euo pipefail

REPO=$(cd "$(dirname "$0")/../.." && pwd -P)
DIR=${1:?usage: mkkeys.sh <private key folder> release|release2|dev}
NAME=${2:?usage: mkkeys.sh <private key folder> release|release2|dev}
case $NAME in release|release2|dev) ;; *) echo "key name must be release, release2 or dev" >&2; exit 1 ;; esac
command -v openssl >/dev/null || { echo "missing: openssl" >&2; exit 1; }

# inside the repo? Checked before anything is made, and again on the resolved folder; case-blind,
# since Windows paths are (umask/chmod do nothing on NTFS: the profile's ACLs protect the keys)
inside() { case $(tr '[:upper:]' '[:lower:]' <<< "$1")/ in "$(tr '[:upper:]' '[:lower:]' <<< "$REPO")"/*) return 0 ;; esac; return 1; }
case $DIR in /*) abs=$DIR ;; *) abs=$(pwd -P)/$DIR ;; esac
! inside "$abs" || { echo "$abs is inside the repo: private keys never go there" >&2; exit 1; }
umask 077
mkdir -p "$DIR"
DIR=$(cd "$DIR" && pwd -P)
! inside "$DIR" || { echo "$DIR is inside the repo: private keys never go there" >&2; exit 1; }
PRIV=$DIR/$NAME.pem
PUB=$REPO/install/keys/$NAME.pub
[ "$NAME" != dev ] || PUB=$DIR/dev.pub
[ ! -e "$PRIV" ] || { echo "$PRIV exists: not overwritten" >&2; exit 1; }
[ ! -e "$PUB" ] || { echo "$PUB exists: not overwritten (cards may trust it already)" >&2; exit 1; }

mkdir -p "$(dirname "$PUB")"
if [ "$NAME" = dev ]; then
  openssl genpkey -algorithm ed25519 -out "$PRIV"
  (umask 022 && openssl pkey -in "$PRIV" -pubout | tr -d '\r' > "$PUB") \
    || { rm -f "$PRIV" "$PUB"; echo "public key not written: nothing kept" >&2; exit 1; }
else
  # passed to openssl in its environment only (not visible in ps like an argument)
  read -rsp "passphrase for $NAME.pem: " DLZMOD_KEYPASS < /dev/tty; echo
  read -rsp "again: " again < /dev/tty; echo
  [ "$DLZMOD_KEYPASS" = "$again" ] || { echo "the passphrases differ: nothing made" >&2; exit 1; }
  [ -n "$DLZMOD_KEYPASS" ] || { echo "empty passphrase: nothing made" >&2; exit 1; }
  export DLZMOD_KEYPASS
  openssl genpkey -algorithm ed25519 -aes256 -pass env:DLZMOD_KEYPASS -out "$PRIV"
  (umask 022 && openssl pkey -in "$PRIV" -passin env:DLZMOD_KEYPASS -pubout | tr -d '\r' > "$PUB") \
    || { rm -f "$PRIV" "$PUB"; echo "public key not written: nothing kept" >&2; exit 1; }
  unset DLZMOD_KEYPASS again
fi
[ -s "$PUB" ] || { rm -f "$PRIV" "$PUB"; echo "public key not written: nothing kept" >&2; exit 1; }
echo "private key: $PRIV (never in the repo; release keys: a copy off this PC, passphrase in a password manager)"
if [ "$NAME" = dev ]; then
  echo "public key:  $PUB (set DLZMOD_SIGNING_KEYS=$DIR for mkpackage.sh and build-sd.sh)"
else
  echo "public key:  $PUB (commit this)"
fi
