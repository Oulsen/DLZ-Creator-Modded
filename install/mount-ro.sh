#!/bin/bash
# Mount the rootfs of an eMMC dump read-only (idempotent; can be sourced or run).
#
# Usage: mount-ro.sh [image] [mountpoint]   (defaults: /root/dlz/orig.img, /mnt/dlz)
IMG=${1:-/root/dlz/orig.img}
MNT=${2:-/mnt/dlz}

if ! mountpoint -q "$MNT"; then
  mkdir -p "$MNT"
  LOOP=$(losetup -P -r -f --show "$IMG")
  mount -o ro,noload "${LOOP}p1" "$MNT"
fi
