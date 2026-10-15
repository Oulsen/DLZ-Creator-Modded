# The backup ("dump") of a mixer the mod does not support, for analysis only, with a hardware report
# next to it (notes/installer.md, design decision 9; #46). Sourced by /init after install-card.sh
# (ic_zst, ic_bk_check, ic_counts), once the eMMC is locked and mounted in the chroot.
#
# Needs: emmc sd (disk names), EMMC SD CH (as for install-card.sh), PKG, LOG, log(), src (the
# check-rootfs.sh line), VERSION BUILD.

# pr_bootloader: "spl=<sha256> uboot=<sha256>" of Mackie's bootloader on the eMMC (read only): the eGON
# SPL at 8 KiB (its header's length) and the legacy uImage at 40 KiB (64-byte header + data size);
# "-" for a part that is not there
pr_bootloader() {
  _spl=- _ub=-
  if [ "$(dd if="$EMMC" bs=1 skip=8196 count=8 2>/dev/null)" = eGON.BT0 ]; then
    _len=$(od -An -j8208 -N4 -tu4 "$EMMC" | tr -d ' ')   # little-endian, as the A40i
    if [ -n "$_len" ] && [ "$_len" -gt 0 ] && [ "$_len" -le 262144 ]; then
      _spl=$(dd if="$EMMC" bs=512 skip=16 count=$(( (_len + 511) / 512 )) 2>/dev/null | head -c "$_len" | sha256sum | cut -d' ' -f1)
    fi
  fi
  if [ "$(od -An -j40960 -N4 -tx1 "$EMMC" | tr -d ' ')" = 27051956 ]; then
    _usz=$(( 0x$(od -An -j40972 -N4 -tx1 "$EMMC" | tr -d ' ') ))   # big-endian in the uImage header
    if [ "$_usz" -gt 0 ] && [ "$_usz" -le 4194304 ]; then
      _ub=$(dd if="$EMMC" bs=1024 skip=40 count=$(( (64 + _usz + 1023) / 1024 )) 2>/dev/null | head -c $((64 + _usz)) | sha256sum | cut -d' ' -f1)
    fi
  fi
  echo "spl=$_spl uboot=$_ub"
}

# pr_known: the name of the known bootloader in boards.txt that the eMMC holds byte for byte; rc 1 = none
pr_known() {
  _bl=$(pr_bootloader)
  _s=${_bl#spl=}; _s=${_s%% *}; _u=${_bl##*uboot=}
  [ "$_s" != - ] && [ "$_u" != - ] || return 1
  awk -v s="$_s" -v u="$_u" '!/^#/ && $2 == s && $3 == u { print $1; f = 1; exit } END { exit !f }' "$PKG/boards.txt"
}

# pr_report: the hardware report on stdout. Read-only; never serial numbers (SoC, eMMC, card), MAC
# addresses, UUIDs, passwords or the owner's files: the report is meant to be shared
pr_report() {
  echo "DLZ Creator Modded installer $VERSION ($BUILD): hardware report"
  echo "(read-only; without serial numbers, MAC addresses or passwords)"
  echo
  echo "mixer: ${src#source: }"
  echo "kernel: $(uname -r) ($(uname -v))"
  echo "device tree: model '$(tr -d '\000' < /proc/device-tree/model 2>/dev/null)', compatible '$(tr '\000' ' ' < /proc/device-tree/compatible 2>/dev/null)'"
  echo "cpu: $(grep -m1 -E '^(Hardware|model name)' /proc/cpuinfo | cut -d: -f2- | sed 's/^ *//'), $(grep -c '^processor' /proc/cpuinfo) cores"
  echo "memory: $(grep '^MemTotal' /proc/meminfo | sed 's/  */ /g')"
  echo
  echo "bootloader on the eMMC: $(pr_bootloader); known as: $(pr_known || echo 'not known')"
  dd if="$EMMC" bs=1048576 count=1 2>/dev/null | chroot "$CH" /usr/bin/grep -a -o -E 'U-Boot (SPL )?20[0-9][0-9]\.[0-9][0-9][ -~]{0,60}' \
    | head -n 4 | sed 's/^/  /'
  for f in etc/armbian-release boot/armbianEnv.txt; do
    echo "/$f:"
    grep -E '^(BOARD|BOARD_NAME|BOARDFAMILY|LINUXFAMILY|BRANCH|VERSION|ARCH|fdtfile|overlay_prefix|overlays)=' "$CH/$f" 2>/dev/null | sed 's/^/  /'
  done
  echo "Mackie device trees in /boot/dtb: $(ls "$CH/boot/dtb/" 2>/dev/null | grep -i -E 'mackie|evolve|dlz' | tr '\n' ' ')"
  echo
  echo "regulators (as the kernel sees them: name, now, allowed range, state):"
  for r in /sys/class/regulator/regulator.*; do
    [ -e "$r/name" ] || continue
    echo "  ${r##*/}: $(cat "$r/name") $(cat "$r/microvolts" 2>/dev/null || echo -) uV [$(cat "$r/min_microvolts" 2>/dev/null || echo -)..$(cat "$r/max_microvolts" 2>/dev/null || echo -)] $(cat "$r/state" 2>/dev/null)"
  done
  echo
  echo "storage:"
  for d in /sys/block/mmcblk*; do
    echo "  ${d##*/}: type $(cat "$d/device/type" 2>/dev/null || echo -), $(cat "$d/size") sectors, name $(cat "$d/device/name" 2>/dev/null || echo -), maker $(cat "$d/device/manfid" 2>/dev/null || echo -), date $(cat "$d/device/date" 2>/dev/null || echo -)"
    for p in "$d/${d##*/}"p*; do
      [ -e "$p/start" ] && echo "    ${p##*/}: start $(cat "$p/start"), $(cat "$p/size") sectors, $(chroot "$CH" /usr/sbin/blkid -p -o value -s TYPE "/dev/${p##*/}" 2>/dev/null)"
    done
  done
  echo
  echo "i2c devices: $(for i in /sys/bus/i2c/devices/*/name; do [ -e "$i" ] && { _i=${i%/name}; printf '%s=%s ' "${_i##*/}" "$(cat "$i")"; }; done)"
  echo "modules: $(cut -d' ' -f1 /proc/modules | tr '\n' ' ')"
}

# --- the backup of a mixer the mod does not support, onto the installer card: a FAT32 partition
# DLZDUMP in slot 2, from the end of the installer's partition (p1, DLZINSTALL, left as it is, with the
# bootloader) to the end of the card. Writes this card only; the eMMC is only read.
PR_DUMP=/tmp/ic-dump   # in the chroot
PR_DISCORD=https://discord.gg/Qa2fjzVbGp   # the README's contact link

# fail closed: the card is the SD card (same CID as at the first check), the eMMC read-only, slot 2
# empty or our DLZDUMP, nothing of the card mounted but the installer's own FAT (the log)
pr_guard() {
  [ -b "$SD" ] && [ -b "$EMMC" ] && [ "$SD" != "$EMMC" ] || { log "dump guard: not two different block devices"; return 1; }
  case ${SD##*/} in
    mmcblk[0-9])
      [ "$(cat "/sys/block/${SD##*/}/device/type" 2>/dev/null)" = SD ] || { log "dump guard: $SD is not an SD card"; return 1; }
      _cid=$(cat "/sys/block/${SD##*/}/device/cid" 2>/dev/null)
      [ -n "$_cid" ] || { log "dump guard: $SD has no CID"; return 1; }
      [ -n "${IC_CID:-}" ] || { log "dump guard: no card identity from the first check"; return 1; }
      [ "$_cid" = "$IC_CID" ] || { log "dump guard: a different card is in the slot"; return 1; } ;;
    loop[0-9]*)   # the PC rehearsal: a loop device over an image file
      [ -f "$(cat "/sys/block/${SD##*/}/loop/backing_file" 2>/dev/null)" ] || { log "dump guard: $SD is not backed by a regular file"; return 1; } ;;
    *) log "dump guard: $SD is neither an SD card nor a loop device"; return 1 ;;
  esac
  [ "$(blockdev --getro "$EMMC")" = 1 ] || { log "dump guard: $EMMC is writable"; return 1; }
  if grep "^$SD" /proc/mounts | grep -v "^${SD}p1 /sd " | grep -q .; then log "dump guard: part of $SD is mounted"; return 1; fi
  log "dump guard ok: card $SD, eMMC $EMMC read-only"
}

# Space the backup can use: one zstd file on FAT32, so never more than 4 GiB (the XS's 7.3 GiB user
# area gives 1.25 GiB); the eMMC's size if that is smaller, plus 64 MiB for the README and report
pr_need_mib() {
  _e=$(( $(cat "/sys/block/${EMMC##*/}/size") / 2048 ))
  [ "$_e" -le 4096 ] || _e=4096
  echo $((_e + 64))
}

# pr_dump_plan (reads only): where DLZDUMP goes and what to do. Sets _start/_size (sectors) and
# PR_PLAN = new (slot 2 empty: made), reuse (our DLZDUMP), repair (slot 2 is exactly where we put it but
# holds no file system yet: a run cut off between the table write and mkfs.vfat); rc 1 = no plan, the
# reason in PR_WHY (shown on screen)
pr_dump_plan() {
  PR_PLAN="" PR_WHY="The card's partitions are not as the installer left them: flash the installer again"
  _sdn=${SD##*/}
  _s1=$(cat "/sys/class/block/${_sdn}p1/start" 2>/dev/null) _z1=$(cat "/sys/class/block/${_sdn}p1/size" 2>/dev/null)
  [ -n "$_s1" ] && [ -n "$_z1" ] || { log "dump: the installer's partition is missing"; return 1; }
  _start=$(( (_s1 + _z1 + 2047) / 2048 * 2048 ))
  _size=$(( $(cat "/sys/block/$_sdn/size") - _start ))
  if [ -e "/sys/class/block/${_sdn}p2" ]; then
    _lab=$(chroot "$CH" /usr/sbin/blkid -p -o value -s LABEL "${SD}p2" 2>/dev/null)
    _typ=$(chroot "$CH" /usr/sbin/blkid -p -o value -s TYPE "${SD}p2" 2>/dev/null)
    if [ "$_lab" = DLZDUMP ] && [ "$_typ" = vfat ]; then
      PR_PLAN=reuse
    elif [ "$(cat "/sys/class/block/${_sdn}p2/start")" = "$_start" ] && [ "$(cat "/sys/class/block/${_sdn}p2/size")" = "$_size" ] \
         && [ -z "$_lab" ] && { [ -z "$_typ" ] || [ "$_typ" = vfat ]; }; then
      PR_PLAN=repair
    else
      log "dump: the card has another second partition (label '$_lab', type '$_typ'), left alone"
      return 1
    fi
    [ ! -e "/sys/class/block/${_sdn}p3" ] || { log "dump: the card has a third partition, left alone"; return 1; }
  else
    ic_dd 512 1 if="$SD" of=/tmp/ic-mbr || return 1
    [ "$(od -An -j510 -N2 -tx1 /tmp/ic-mbr | tr -d ' \n')" = 55aa ] || { log "dump: the card has no MBR"; return 1; }
    [ "$(od -v -An -j462 -N48 -tx1 /tmp/ic-mbr | tr -d ' \n' | tr -d 0)" = "" ] || { log "dump: slots 2-4 of the card's table are not empty"; return 1; }
    PR_PLAN=new
  fi
  [ "$_size" -le 4294967295 ] || { PR_WHY="The card is too big (over 2 TB)"; log "dump: card too big for an MBR partition table"; return 1; }
  _need=$(pr_need_mib)
  if [ "$PR_PLAN" = reuse ]; then
    # free space on the existing DLZDUMP (mounted read-only for a moment)
    mkdir -p "$CH$PR_DUMP" && mount -t vfat -o ro "${SD}p2" "$CH$PR_DUMP" || { log "dump: DLZDUMP could not be mounted to check it"; return 1; }
    _free=$(( $(chroot "$CH" /usr/bin/df -k --output=avail "$PR_DUMP" | tail -n 1) / 1024 ))
    umount "$CH$PR_DUMP" || { log "dump: DLZDUMP could not be unmounted"; return 1; }
  else
    _free=$((_size / 2048))
  fi
  log "dump: plan $PR_PLAN, p2 at sector $_start, $_free MiB free, needs $_need MiB"
  [ "$_free" -ge "$_need" ] || {
    PR_WHY="Not enough room on the card: $(gb10 $_free) GB free, needs $(gb10 $_need) GB. Copy older backups off DLZDUMP, or use a bigger card"
    return 1
  }
}

# pr_dump_ready (before the backup is offered, writes nothing): the tools it needs in the mixer's
# system, a card it may write to and enough room; rc 1 = not possible, the reason in PR_WHY
pr_dump_ready() {
  PR_WHY="The installer cannot write to this card (see the log)"
  pr_guard || return 1
  for _t in /usr/bin/bash /usr/bin/zstd /usr/bin/partx /usr/sbin/mkfs.vfat /usr/sbin/blkid /usr/bin/df /usr/bin/grep; do
    [ -x "$CH$_t" ] || { PR_WHY="The mixer's software lacks a tool the backup needs ($_t)"; log "dump: $_t missing in the mixer's system"; return 1; }
  done
  pr_dump_plan
}

# pr_dump_part: DLZDUMP in slot 2 as planned: new (one 512-byte write of sector 0, then the kernel is
# told about p2 alone: p1 stays mounted for the log, then mkfs.vfat), repair (mkfs.vfat only) or reuse
pr_dump_part() {
  pr_guard || return 1
  pr_dump_plan || { log "dump: $PR_WHY"; return 1; }
  case $PR_PLAN in
    reuse) log "dump: DLZDUMP already on the card, used again"; return 0 ;;
    repair) log "dump: p2 holds no file system yet (an earlier run was cut off): formatted as DLZDUMP" ;;
  esac
  if [ "$PR_PLAN" = repair ]; then
    chroot "$CH" /usr/sbin/mkfs.vfat -F 32 -n DLZDUMP "${SD}p2" >> "$LOG" 2>&1 || { log "dump: mkfs.vfat failed"; return 1; }
    return 0
  fi
  _m=/tmp/ic-mbr
  { printf '\000\376\377\377\014\376\377\377'; ic_le32 $_start; ic_le32 $_size; } > /tmp/ic-slot2
  [ "$(wc -c < /tmp/ic-slot2)" = 16 ] || return 1
  dd if=/tmp/ic-slot2 of=$_m bs=1 seek=462 conv=notrunc 2>/dev/null || return 1
  ic_dd 512 1 if=$_m of="$SD" conv=fsync || return 1
  chroot "$CH" /usr/bin/partx -a -n 2 "$SD" >> "$LOG" 2>&1 || { log "dump: partx could not add p2"; return 1; }
  _i=0
  while [ ! -b "${SD}p2" ] && [ $_i -lt 20 ]; do sleep 0.5; _i=$((_i + 1)); done
  [ "$(cat "/sys/class/block/${_sdn}p2/start" 2>/dev/null)" = "$_start" ] || { log "dump: p2 did not show up as written"; return 1; }
  chroot "$CH" /usr/sbin/mkfs.vfat -F 32 -n DLZDUMP "${SD}p2" >> "$LOG" 2>&1 || { log "dump: mkfs.vfat failed"; return 1; }
  log "dump: DLZDUMP made: p2 at sector $_start, $((_size / 2048)) MiB"
}

# pr_dump_abort (fail()): an unfinished backup holds the mixer's settings, so its *.part files are not
# left on the card; finish() unmounts DLZDUMP afterwards (a card mount in the chroot's /tmp)
pr_dump_abort() {
  grep -q " $CH$PR_DUMP " /proc/mounts || return 0
  if ls "$CH$PR_DUMP"/backup-*/*.part > /dev/null 2>&1; then
    rm -f "$CH$PR_DUMP"/backup-*/*.part && log "dump: unfinished backup deleted" || log "dump: unfinished backup could not be deleted"
  fi
  rmdir "$CH$PR_DUMP"/backup-* 2>/dev/null   # only the empty ones: no leftover folder
  sync
}

# pr_dump: the eMMC's user area (64 MiB parts) into DLZDUMP/backup-<n>, then checked like the
# install's backup; stdout: progress for ui serve; /tmp/pr-dump-ok at the end, PR_DIR = the folder
# name. Never the boot areas boot0/1: reading them makes the kernel switch the eMMC's partition access
# (CMD6, a write to EXT_CSD[179]), as for the install's backup
pr_dump() {
  trap '' PIPE
  rm -f /tmp/pr-dump-ok
  printf '0\tPreparing the card\n' 2>/dev/null
  pr_dump_part || return 1
  mkdir -p "$CH$PR_DUMP" && mount -t vfat -o iocharset=ascii,flush "${SD}p2" "$CH$PR_DUMP" || { log "dump: DLZDUMP could not be mounted"; return 1; }
  # a run cut off by a power loss left *.part files (the mixer's settings): not kept, and their room
  # is needed
  if ls "$CH$PR_DUMP"/backup-*/*.part > /dev/null 2>&1; then
    rm -f "$CH$PR_DUMP"/backup-*/*.part && log "dump: unfinished backup of an earlier run deleted"
  fi
  rmdir "$CH$PR_DUMP"/backup-* 2>/dev/null
  _k=1
  while [ -e "$CH$PR_DUMP/backup-$_k" ]; do _k=$((_k + 1)); done
  PR_DIR=backup-$_k
  echo "$PR_DIR" > /tmp/pr-dir
  _dir=$PR_DUMP/$PR_DIR
  mkdir "$CH$_dir" || return 1
  _tot=$(cat "/sys/block/${EMMC##*/}/size")   # sectors
  _mib=$((_tot / 2048))
  _d=0
  _t0=$(cut -d' ' -f1 /proc/uptime)
  while [ $_d -lt $_mib ]; do
    _c=$IC_CHUNK
    [ $((_d + _c)) -gt $_mib ] && _c=$((_mib - _d))
    ic_zst "$EMMC" 1048576 $_d $_c "$_dir/emmc-user.img.zst.part" || return 1
    _d=$((_d + _c))
    awk -v d=$_d -v t=$_mib -v a="$_t0" -v b="$(cut -d' ' -f1 /proc/uptime)" -v gb="$(gb10 $_d) of $(gb10 $_mib) GB" 'BEGIN {
      s = b - a; if (s < 0.1) s = 0.1; l = (t - d) * s / d
      printf "%d\tSaving: %s, %s\n", d * 90 / t, gb, (l < 60) ? "less than a minute left" : sprintf("about %d min left", int((l + 30) / 60)) }' 2>/dev/null
  done
  _r=$((_tot - _mib * 2048))   # a last part smaller than 1 MiB
  if [ "$_r" -gt 0 ]; then
    ic_zst "$EMMC" 512 $((_mib * 2048)) $_r "$_dir/emmc-user.img.zst.part" || return 1
  fi
  printf '90\tChecking the backup\n' 2>/dev/null
  ic_bk_check "$_dir" "Made by the installer for analysis only: the mod does not support this mixer (the internal storage" || return 1
  {
    echo
    echo "To help find out whether the mod can support this mixer: upload this folder (Google Drive,"
    echo "OneDrive, WeTransfer or similar) and send the link privately via Discord:"
    echo "$PR_DISCORD (never post the link in public)."
  } >> "$CH$_dir/README.txt" || { log "dump: README.txt not completed"; return 1; }
  pr_report > "$CH$_dir/hardware.txt" 2>/dev/null
  sync
  umount "$CH$PR_DUMP" || { log "dump: DLZDUMP could not be unmounted"; return 1; }
  printf '100\tSaved\n' 2>/dev/null
  : > /tmp/pr-dump-ok
}
