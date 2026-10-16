# The real install (milestone 4): build the mod card on the SD card from the eMMC. Sourced by /init
# (busybox sh); also by the PC rehearsal, which sets the same variables to loop devices.
#
# Needs: EMMC SD (block device paths: the locked eMMC and the card), CH (chroot with the stock tools and
# our package in $CH/tmp/pkg), p1_start p1_size (eMMC p1, sectors) copy_mib (end of p1 in MiB, rounded
# up), log(), ui(), and nothing of the card mounted.
#
# Write order (notes/installer.md, design decision 8): the card cannot boot until the very last step,
# so a power cut at any moment leaves a card the boot ROM skips and the mixer starts stock:
#   1 clear the card's first 4 MiB (MBR + bootloader area); then a partition table with only DLZDATA
#     (p2, FAT32, the rest of the card after the copy's place), which receives the eMMC backup
#   2 a snapshot of the eMMC's p1 (read-only loop, copy-on-write store in RAM) with its journal
#     replayed; the blocks its file system uses to the same place on the card, the same view into
#     the backup; then read the copy back and compare by the used blocks; check the backup
#   3 on the raw copy, through a loop device (p1 is not in the table yet): replay the journal and set
#     a new UUID, so two disks with the eMMC's UUID never exist at the same time
#   4 the eMMC's p1 entry into the table, then card-core.sh (DLZDATA kept, guards, patches, visuals)
#   5 last: Mackie's bootloader (eMMC sectors 1-8191) to the card, read back and compare
# Needs also: model (the mixer, for the backup's README.txt)
# Every step returns 1 on any error; /init then shows the failure, nothing more is written.

IC_CHUNK=64   # MiB per copy step

# dd with a record-count check: ic_dd <block size> <count> <dd args...>. dd past the end of a device
# returns short without an error, so a full count in and out is required
ic_dd() {
  _bs=$1 _n=$2
  shift 2
  _st=$(dd "$@" bs="$_bs" count="$_n" 2>&1 >/dev/null) || { log "dd failed ($*): $_st"; return 1; }
  case "
$_st" in
    *"
$_n+0 records in
$_n+0 records out"*) return 0 ;;
  esac
  log "dd short ($*): $_st"
  return 1
}

# fail closed: the card must be the SD card (or, on the PC, a loop device on a regular file), not the
# eMMC, nothing of it mounted, and the eMMC must be read-only
ic_guard() {
  _n=${SD##*/}
  [ -b "$SD" ] && [ -b "$EMMC" ] && [ "$SD" != "$EMMC" ] || { log "guard: not two different block devices"; return 1; }
  case $_n in
    mmcblk[0-9]) [ "$(cat "/sys/block/$_n/device/type" 2>/dev/null)" = SD ] || { log "guard: $SD is not an SD card"; return 1; }
      # the same card as at the first check (CID = maker + serial, IC_CID set by /init when it found
      # the card): a card swapped before the OK or during the install must not get the rest of it
      _cid=$(cat "/sys/block/$_n/device/cid" 2>/dev/null)
      [ -n "$_cid" ] || { log "guard: $SD has no CID"; return 1; }
      [ -n "${IC_CID:-}" ] || { log "guard: no card identity from the first check"; return 1; }
      [ "$_cid" = "$IC_CID" ] || { log "guard: a different card is in the slot (its CID changed)"; return 1; } ;;
    loop[0-9]*)
      _bf=$(cat "/sys/block/$_n/loop/backing_file" 2>/dev/null)
      [ -f "$_bf" ] || { log "guard: $SD is not backed by a regular file"; return 1; } ;;
    *) log "guard: $SD is neither an SD card nor a loop device"; return 1 ;;
  esac
  [ "$(blockdev --getro "$EMMC")" = 1 ] || { log "guard: $EMMC is writable"; return 1; }
  if grep -q "^$SD" /proc/mounts; then log "guard: part of $SD is mounted"; return 1; fi
  [ "$p1_start" = 8192 ] || { log "guard: p1 does not start at sector 8192"; return 1; }
  log "guard ok: card $SD, eMMC $EMMC read-only"
}

# 1. card not bootable and without partitions from here on. The SPL header (8 KiB, sector 16) goes
# first, on its own: one 4 MiB write leaves the order on the card to the page cache, and a power cut
# could keep the old SPL with half its U-Boot (the SPL would hang instead of the boot ROM skipping)
ic_clear() {
  rm -f /tmp/ic-clear-ok
  ic_dd 512 48 if=/dev/zero of="$SD" seek=16 conv=fsync || return 1
  ic_dd 1048576 4 if=/dev/zero of="$SD" conv=fsync || return 1
  # a failed reread would leave the installer card's old partitions in the kernel
  blockdev --rereadpt "$SD" >> "$LOG" 2>&1 || { log "step 1: partition table reread failed"; return 1; }
  # sysfs, not /dev: the reread drops the partitions there at once, devtmpfs nodes go a moment later
  [ ! -e "/sys/class/block/${SD##*/}p1" ] || { log "step 1: ${SD}p1 still present after clearing"; return 1; }
  : > /tmp/ic-clear-ok   # ic_rescue_log may only touch a card without a bootloader
  log "step 1: first 4 MiB of the card cleared"
}

# ic_le32 <n>: n as 4 bytes, little-endian (MBR fields)
ic_le32() { for _k in 0 1 2 3; do printf "\\$(printf %03o $(( ($1 >> (8 * _k)) & 255 )))"; done; }
# ic_counts <dd stderr file> <n>: dd copied n full records in and out
ic_counts() {
  case "
$(cat "$1" 2>/dev/null)" in
    *"
$2+0 records in
$2+0 records out"*) return 0 ;;
  esac
  log "dd short or failed: $(head -c 200 "$1" 2>/dev/null)"
  return 1
}

# ic_reread: the kernel rereads the card's partition table; a few tries, as it can be busy (EBUSY)
# for a moment after partitions were in use. Callers check the result in sysfs, which decides
ic_reread() {
  for _t in 1 2 3; do
    blockdev --rereadpt "$SD" >> "$LOG" 2>&1 && return 0
    log "partition table reread try $_t failed"
    sleep 1
  done
  return 1
}
# ic_dderr: dd's own messages from a failed chroot pipeline (they went to these files)
ic_dderr() {
  for _f in "$@"; do
    [ -s "$CH/tmp/$_f" ] && log "  $_f: $(head -c 200 "$CH/tmp/$_f" | tr '\n' ' ')"
  done
  return 0
}

# The eMMC backup on DLZDATA/dlzmod-backup: emmc-user.img.zst (the whole user area: MBR, bootloader,
# rootfs and the rest) and README.txt. Written as *.part, renamed once checked. Not the eMMC's boot
# areas (boot0/1): reading them makes the kernel switch the eMMC's partition access, a write to its
# EXT_CSD register, and they are empty on the XS. Mounted inside the chroot's /tmp, where the stock
# zstd writes it (finish() releases card mounts there; ic_bk_release before anything else wants the
# card unmounted)
IC_BK=/tmp/ic-bk   # in the chroot
ic_bk_release() {
  if grep -q " $CH$IC_BK " /proc/mounts; then
    sync
    umount "$CH$IC_BK" || { log "backup: DLZDATA could not be unmounted"; return 1; }
  fi
  return 0
}
# ic_zst <device> <block size> <skip> <count> <file in the chroot, appended>: one range of the eMMC
# into the backup (reads only)
ic_zst() {
  chroot "$CH" /usr/bin/bash -c 'set -o pipefail; dd if="$1" bs="$2" skip="$3" count="$4" iflag=fullblock 2> /tmp/ic-zrd | zstd -q -1 -T2 -c >> "$5"' \
    _ "$@" 2>> "$LOG" || { log "backup: reading or compressing $1 ($3+$4 x $2) failed"; ic_dderr ic-zrd; return 1; }
  ic_counts "$CH/tmp/ic-zrd" "$4"
}

# 1b. DLZDATA first, before the copy (it receives the backup during the copy): built from the eMMC's
# own sector 0 (boot code, signature) with a new disk id, slot 1 empty (the raw copy is no partition
# until step 4) and slot 2 = FAT32 from the end of the copy's place to the end of the card, in one
# 512-byte write (sfdisk 2.37 puts "partition 2" of an empty table into slot 1 [PC test]).
# Then the first 4 MiB of the eMMC (MBR, bootloader) into the backup. Also the empty dlzmod-update/
# folder, where updates for this card go (sd-system/dlzmod-update)
ic_data() {
  ic_guard || return 1
  _start=$((copy_mib * 2048))
  _size=$(( $(cat "/sys/block/${SD##*/}/size") - _start ))
  [ "$_size" -ge 131072 ] || { log "step 1: less than 64 MiB left for DLZDATA"; return 1; }
  [ "$_size" -le 4294967295 ] || { log "step 1: card too big for an MBR partition table"; return 1; }
  _m=/tmp/ic-mbr
  ic_dd 512 1 if="$EMMC" of=$_m || return 1
  _old=$(od -An -j440 -N4 -tx4 $_m | tr -d ' \n')   # disk id = 4 bytes at 440
  [ -n "$_old" ] || { log "step 1: eMMC disk id unreadable"; return 1; }
  _id=""
  while [ -z "$_id" ] || [ "$_id" = 00000000 ] || [ "$_id" = "$_old" ]; do
    _id=$(od -An -N4 -tx4 /dev/urandom | tr -d ' \n')
  done
  # disk id, 2 zero bytes, slot 1 empty, slot 2 (not active, CHS "beyond 8 GB", type 0c FAT32 LBA,
  # start, size), slots 3-4 empty; the 55 aa signature stays the eMMC's
  { ic_le32 $((0x$_id)); printf '\000\000'; head -c 16 /dev/zero; printf '\000\376\377\377\014\376\377\377'
    ic_le32 $_start; ic_le32 $_size; head -c 32 /dev/zero; } > /tmp/ic-mbr-tail
  [ "$(wc -c < /tmp/ic-mbr-tail)" = 70 ] || { log "step 1: partition table not built"; return 1; }
  dd if=/tmp/ic-mbr-tail of=$_m bs=1 seek=440 conv=notrunc 2>/dev/null || return 1
  [ "$(od -An -j510 -N2 -tx1 $_m | tr -d ' \n')" = 55aa ] || { log "step 1: eMMC sector 0 has no MBR signature"; return 1; }
  ic_dd 512 1 if=$_m of="$SD" conv=fsync || return 1
  ic_reread || log "step 1: partition table reread failed, checking what the kernel has"
  _p2=/sys/class/block/${SD##*/}p2
  _i=0
  while [ ! -b "${SD}p2" ] && [ $_i -lt 20 ]; do sleep 0.5; _i=$((_i + 1)); done
  [ -b "${SD}p2" ] && [ "$(cat "$_p2/start" 2>/dev/null)" = "$_start" ] && [ "$(cat "$_p2/size" 2>/dev/null)" = "$_size" ] \
    || { log "step 1: DLZDATA (p2) did not show up as written"; return 1; }
  [ ! -e "/sys/class/block/${SD##*/}p1" ] || { log "step 1: ${SD}p1 present, slot 1 should be empty"; return 1; }
  # mkfs runs in the chroot: wait for the node as it sees it (the same devtmpfs on the device, a copy
  # that follows a moment later in the PC rehearsal)
  _i=0
  while [ ! -b "$CH${SD}p2" ] && [ $_i -lt 20 ]; do sleep 0.5; _i=$((_i + 1)); done
  chroot "$CH" /usr/sbin/mkfs.vfat -F 32 -n DLZDATA "${SD}p2" >> "$LOG" 2>&1 || { log "step 1: mkfs.vfat failed"; return 1; }
  mkdir -p "$CH$IC_BK" && mount -t vfat -o iocharset=ascii,flush "${SD}p2" "$CH$IC_BK" \
    && mkdir -p "$CH$IC_BK/dlzmod-backup" "$CH$IC_BK/dlzmod-update" || { log "step 1: DLZDATA could not be mounted"; return 1; }
  printf '%s\r\n' "Updates for DLZ Creator Modded go here: copy both update files (dlzmod-vX.Y.Z.tar and" \
    "dlzmod-vX.Y.Z.tar.sig) into this folder, then start the mixer with this card. It is installed at" \
    "startup and then deleted; the result is in dlzmod-logs." > "$CH$IC_BK/dlzmod-update/README.txt" || { log "step 1: dlzmod-update/README.txt not written"; return 1; }
  log "step 1: DLZDATA made: p2 at sector $_start, $((_size / 2048)) MiB, disk id 0x$_id (eMMC: $_old)"
  ic_zst "$EMMC" 1048576 0 4 "$IC_BK/dlzmod-backup/emmc-user.img.zst.part" || return 1
  log "backup: the first 4 MiB of the eMMC saved"
}

# One progress bar for the whole install, in three phases: copy 0-49 %, compare 49-89 %, build
# 89-100 %. The time left covers the whole rest: the current phase from its measured speed blended
# with the device's own times (blend(): the speed so far says little at the start of a step, it once
# foretold 22 min for under 5 [device]), the compare as a share of the copy's time (same card), the
# build as a fixed estimate. The screen shows the time left for this step and for the whole install;
# every ~30 s a progress line goes into the install log, for comparing. [device, used blocks,
# SanDisk Ultra 128 GB: copy 320 s (2322 MiB in use + a 978 MiB backup), compare with the backup's
# unpack 258 s = 81 %, build 37 s; 616 s from the first write]
IC_BAR_COPY=49 IC_BAR_COMPARE=40 IC_BAR_BUILD=11
IC_COMPARE_PCT=81   # compare time as % of the copy time
IC_COPY_MS=130      # copy (and backup) time per MiB in use, ms [device: 277 s and 302 s for 2322 MiB, two cards]
IC_BUILD_SECS=40    # build phase, all 10 parts
IC_BK_PCT=42        # backup size as % of the MiB in use, until the copy can tell (measured: 978 of 2322)
IC_NL='
'
# ic_left <seconds>: "about N min left" / "less than a minute left"
ic_left() {
  awk -v l="$1" 'BEGIN { if (l < 60) print "less than a minute left"; else printf "about %d min left\n", int((l + 30) / 60) }'
}
# ic_size <file>: its size in bytes from its metadata (stat), always a number. Not wc -c: busybox's wc
# reads the whole file, the 978 MiB backup from the card in seconds to minutes [PC, qemu -strace]
ic_size() { stat -c %s "$1" 2>/dev/null || echo 0; }
# ic_written: sectors written to the card so far (its block layer's count: what has reached it, DLZDATA
# included), always a number
ic_written() { awk '{ print $7 + 0 }' "/sys/block/${SD##*/}/stat" 2>/dev/null || echo 0; }

# Each progress round of the copy and the compare is one awk and nothing else: it reads /proc and /sys
# itself, carries the round's state and prints the line. Under the copy's load every process start
# costs ~0.5 s on the mixer: rounds of ~20 of them took ~17 s and slowed the copy by half [device,
# copy 468 s with them, 320 s without]. IC_AWK: the functions the rounds share. rd: a whole file ("" when
# it is gone), key: the number after a "key:" line's start, alive: running and not a zombie (an ended
# child stays one until waited for)
IC_AWK='
function rd(f,   l, s) { s = ""; while ((getline l < f) > 0) s = s l "\n"; close(f); return s }
function key(s, k,   i, a) { i = index("\n" s, "\n" k); if (!i) return 0; split(substr(s, i + length(k)), a, " "); return a[1] + 0 }
function first(s, n,   a) { split(s, a, " "); return a[n] + 0 }
function alive(p,   s, i, j) {
  if (p == "") return 0
  s = rd("/proc/" p "/stat"); if (s == "") return 0
  i = 0; while ((j = index(substr(s, i + 1), ") ")) > 0) i += j
  return substr(s, i + 2, 1) !~ /[ZX]/
}
function mib(b) { return b / 1048576 }
function gb(m) { return sprintf("%.1f", m * 1048576 / 1000000000) }
function max(a, b) { if (a > b) return a; return b }
function min(a, b) { if (a < b) return a; return b }
function lefttxt(l) {
  if (l < 0) return "working out the time left"
  if (l < 60) return "less than a minute left"
  return sprintf("about %d min left", int((l + 30) / 60))
}
function alltxt(l) {
  if (l < 0) return ""
  if (l < 60) return "Less than a minute left for the whole install"
  return sprintf("About %d min left for the whole install", int((l + 30) / 60))
}
# blend(p, t, m): the time left at progress p (0..1) of a step that takes about t seconds on the
# mixer, m the time left from the measured speed (-1: not yet). The measured speed rules near the end,
# the device times near the start, where the speed so far says little (its streams are not even:
# the blocks in use sit near their start)
function blend(p, t, m) { if (p < 0) p = 0; if (p > 1) p = 1; if (m < 0) return t * (1 - p); return (1 - p) * t * (1 - p) + p * m }
# every 15th round (~30 s) the line with its time into the install log, for comparing the estimates
# with the real times afterwards (lg: the log, n: the round)
function logline(lg, n, now, s) { if (lg != "" && n % 15 == 1) { printf "[%.2f] progress: %s\n", now, s >> lg; close(lg) } }
'
# ic_copy_tick [final]: the copy step's line: what has reached the card (its sectors-written count,
# DLZDATA included) and the time left. The bar is that share of a total that is not shown (it holds
# an estimate), that plus what is still to come: the copy's rest (its e2image's writes), the
# backup's rest (its final size extrapolated from zstd's output per MiB in use its e2image has read:
# the zeros of its stream add next to nothing) and the page cache (Dirty + Writeback; the installer's
# only writes are the card's: the eMMC is read-only, the snapshot store is tmpfs). The backup's stream
# is the file system's full size, but not a measure of time: the used blocks sit near its start (in
# the dump 87 % of them in its first 35 %), the zeros after them go fast, so its position since the
# start foretold many times the real time [device: 22 min at the start, the step took under 5]. The
# backup's time left is therefore its e2image's reads (the MiB in use, ~4 % more with the metadata),
# and once those are done the stream's rest at its speed since then (the zero tail costs processor
# time only, while nothing more reaches the card). Reads ic_copy's _t0 _ts (the speed's start, after
# the snapshot) _u _fsm _w0 and the pids _pc (the copy) and _pbe/_pbz (the backup's e2image and zstd,
# from their pid files); keeps _cdone _bdone _pmax _bpart (an ended pid can be reused, the bar never
# goes back, zstd's count goes with it), _tz _bwz (the zero tail's start: time, stream position) and
# _tk (the round). final: the step is done
ic_copy_tick() {
  [ -n "$_pbe" ] || read -r _pbe 2>/dev/null < "$CH/tmp/ic-pid-bke"
  [ -n "$_pbz" ] || read -r _pbz 2>/dev/null < "$CH/tmp/ic-pid-bkz"
  _o=$(awk -v sd="${SD##*/}" -v pc="$_pc" -v pbe="$_pbe" -v pbz="$_pbz" -v u="$_u" -v fsm="$_fsm" \
      -v w0="$_w0" -v t0="$_t0" -v ts="$_ts" -v cdone="$_cdone" -v bdone="$_bdone" -v pmax="$_pmax" \
      -v bpart="$_bpart" -v final="${1:-0}" -v wc=$IC_BAR_COPY -v cp=$IC_COMPARE_PCT -v bs=$IC_BUILD_SECS \
      -v bk=$IC_BK_PCT -v cms=$IC_COPY_MS -v tz="${_tz:-0}" -v bwz="${_bwz:-0}" -v tk="${_tk:-0}" -v lg="${LOG:-}" "$IC_AWK"'
  BEGIN {
    if (fsm < 1) fsm = 1
    now = first(rd("/proc/uptime"), 1); s = now - ts
    card = (first(rd("/sys/block/" sd "/stat"), 7) - w0) / 2048; if (card < 0) card = 0
    m = rd("/proc/meminfo"); dirty = (key(m, "Dirty:") + key(m, "Writeback:")) / 1024
    if (!cdone && !alive(pc)) cdone = 1
    # the backup has ended when both of its processes have (no pid yet: not started)
    if (!bdone && pbe != "" && pbz != "" && !alive(pbe) && !alive(pbz)) bdone = 1
    cw = u
    if (!cdone) cw = min(mib(key(rd("/proc/" pc "/io"), "wchar:")), u)
    br = 0; bw = 0
    if (pbe != "" && alive(pbe)) { b = rd("/proc/" pbe "/io"); br = mib(key(b, "rchar:")); bw = mib(key(b, "wchar:")) }
    else if (pbe != "") { br = u; bw = fsm }
    if (pbz != "" && alive(pbz)) bpart = max(bpart, mib(key(rd("/proc/" pbz "/io"), "wchar:")))
    eb = u * bk / 100
    if (bdone) eb = bpart; else if (br >= 256) eb = bpart * u / br
    if (eb < bpart) eb = bpart
    todo = (u - cw) + (eb - bpart) + dirty
    total = card + todo; if (total < 1) total = 1
    if (final) {
      pm = 1000; total = card; left = 0; wpm = 1000
      printf "%d\n", now - t0 > "/tmp/ic-copy-secs"; close("/tmp/ic-copy-secs")   # for the compare: its estimate
    } else {
      wpm = card * 1000 / total
      pm = min(wpm, 990)   # 100 % only when the step is done
      # the speeds only once they mean something: the first writes wait in the page cache
      wl = -1; if (card >= 100 && s >= 15) wl = todo * s / card
      sl = 0
      if (!bdone) {
        sl = -1; brd = min(br, u)
        if (brd < u) { if (brd >= 256 && s >= 15) sl = (u - brd) * s / brd }
        else {
          # the zero tail: its speed from its own start, a few seconds in
          if (tz <= 0) { tz = now; bwz = bw }
          if (bw >= fsm) sl = 0
          else if (now - tz >= 6 && bw > bwz) sl = (fsm - bw) * (now - tz) / (bw - bwz)
        }
      }
      ml = -1; if (wl >= 0 && sl >= 0) ml = max(wl, sl)
      left = blend(pm / 1000, u * cms / 1000, ml)
    }
    pm = int(max(pm, pmax))
    if (card < 1 && left < 0) txt = "starting"
    else if (cdone && !bdone && wpm >= 980) txt = "finishing the backup, " lefttxt(left)
    # no total: it holds the backup size, an estimate until the backup ends (seconds before the copy
    # does), and it wandered 3.0 -> 4.6 -> 3.5 GB in the rehearsal; the bar and the time left show
    # how far it is. No apostrophes in here: this awk program sits in single quotes
    else txt = gb(card) " GB written, " lefttxt(left)
    all = ""; if (left >= 0) all = alltxt(left + ((now - t0) + left) * cp / 100 + bs)
    tk++; logline(lg, tk, now, "step 1, " int(wc * pm / 1000) " %, " txt ", " all)
    print cdone, bdone, pm, bpart, tz, bwz, tk
    printf "%d\tStep 1 of 3: %s\t%s\n", int(wc * pm / 1000), txt, all }' 2>/dev/null)
  [ -n "$_o" ] || return 0
  # shellcheck disable=SC2086
  set -- ${_o%%"$IC_NL"*}
  _cdone=$1 _bdone=$2 _pmax=$3 _bpart=$4 _tz=$5 _bwz=$6 _tk=$7
  printf '%s\n' "${_o#*"$IC_NL"}" 2>/dev/null
}

# The eMMC's p1 as the card gets it: a device-mapper snapshot over a read-only loop on the eMMC's p1,
# its copy-on-write store a sparse file in the chroot's /tmp (RAM), checked into it (e2fsck -fy). The
# eMMC is only read (the kernel lock from /init plus the read-only loop: the snapshot target never
# writes its origin, the replay's writes land in the RAM store). From this view only the blocks the
# file system uses go to the card (e2image -ra), and the compare reads the same view: the stock
# mixer is switched off by its power switch, so its journal is usually not replayed, and a copy by
# the on-disk bitmaps alone could miss blocks only the journal marks as used. Proven on the PC: the
# used blocks of "copy all, replay" and of this view are bit for bit the same (notes/installer.md,
# "Copy and compare"). Its state lives in $CH/tmp (subshell-proof): ic-snap-loops = origin and store loop.
IC_SNAP=ic-snap
IC_SNAP_DEV=/dev/mapper/$IC_SNAP
# ic_dm_ready: the snapshot target is there. On the mixer dm-snapshot is a module of the running
# (Mackie's) kernel, loaded from the eMMC's /lib/modules (with dm-mod and dm-bufio); whether the
# target is there afterwards decides (the PC rehearsal's kernel has it already, and its modprobe
# finds no modules of its own in the dump). /init calls it before the Install screen, so a missing
# module stops the install before anything is written
ic_dm_ready() {
  _dmt() { chroot "$CH" /usr/bin/env DM_DISABLE_UDEV=1 /sbin/dmsetup targets 2>/dev/null | grep -q '^snapshot '; }
  _dmt || chroot "$CH" /sbin/modprobe dm-snapshot >> "$LOG" 2>&1
  _dmt || { log "no snapshot target (dm-snapshot module did not load)"; return 1; }
  # and the whole thing as the copy will make it, then taken apart again: a read-only loop over the
  # eMMC's p1, checked, a small store and a snapshot of the same form (whether the kernel takes this
  # table on the mixer only the mixer can say: before the Install screen, not after the card is
  # erased). Nothing is written to the snapshot
  _tl=$(chroot "$CH" /usr/sbin/losetup -r -f --show "${EMMC}p1" 2>> "$LOG") || { log "no read-only loop over ${EMMC}p1"; return 1; }
  _tc="" _ok=0
  ic_ro_loop_ok "$_tl" || _ok=1
  if [ $_ok = 0 ]; then
    chroot "$CH" /usr/bin/truncate -s 16M /tmp/ic-snaptest-cow \
      && _tc=$(chroot "$CH" /usr/sbin/losetup -f --show /tmp/ic-snaptest-cow 2>> "$LOG") \
      && chroot "$CH" /usr/bin/env DM_DISABLE_UDEV=1 /sbin/dmsetup create --noudevsync ic-snaptest \
           --table "0 $(blockdev --getsz "$_tl") snapshot $_tl $_tc N 32" >> "$LOG" 2>&1 \
      && [ -b "$CH/dev/mapper/ic-snaptest" ] \
      || { log "the kernel did not make a test snapshot of the eMMC's p1"; _ok=1; }
  fi
  chroot "$CH" /usr/bin/env DM_DISABLE_UDEV=1 /sbin/dmsetup info ic-snaptest > /dev/null 2>&1 \
    && chroot "$CH" /usr/bin/env DM_DISABLE_UDEV=1 /sbin/dmsetup remove --noudevsync ic-snaptest >> "$LOG" 2>&1
  [ -n "$_tc" ] && chroot "$CH" /usr/sbin/losetup -d "$_tc" >> "$LOG" 2>&1
  chroot "$CH" /usr/sbin/losetup -d "$_tl" >> "$LOG" 2>&1
  rm -f "$CH/tmp/ic-snaptest-cow"
  [ $_ok = 0 ] && log "snapshot test: read-only loop and test snapshot of the eMMC's p1 made and removed"
  return $_ok
}
# ic_ro_loop_ok <loop>: read-only, and it advertises no discard or write-zeroes. The read-only flag
# stops writes from user space; discard and write-zeroes requests the kernel makes itself would pass
# a loop that advertises them (5.10). Nothing here sends any, and a loop over an MMC partition should
# advertise none (it takes the MMC's write-zeroes limit, 0): required, so it stays that way.
# The PC rehearsal (BUILD=pc, only it sets that) skips the second part: its "eMMC" is a
# loop over a file, which advertises both
ic_ro_loop_ok() {
  [ "$(blockdev --getro "$1")" = 1 ] || { log "the loop over the eMMC is not read-only"; return 1; }
  if [ "${BUILD:-}" = pc ]; then
    log "rehearsal: discard/write-zeroes check of $1 skipped (a loop over a file advertises both)"
    return 0
  fi
  for _q in discard_max_bytes write_zeroes_max_bytes; do
    [ "$(cat "/sys/block/${1##*/}/queue/$_q" 2>/dev/null)" = 0 ] || { log "the loop over the eMMC allows $_q"; return 1; }
  done
}
ic_snap_up() {
  ic_snap_down
  ic_dm_ready || return 1
  _ol=$(chroot "$CH" /usr/sbin/losetup -r -f --show "${EMMC}p1" 2>> "$LOG") || { log "step 2: read-only loop over ${EMMC}p1 failed"; return 1; }
  echo "$_ol" > "$CH/tmp/ic-snap-loops"
  ic_ro_loop_ok "$_ol" || { log "step 2: the read-only loop over the eMMC is not safe to use"; ic_snap_down; return 1; }
  [ "$(blockdev --getsz "$_ol")" = "$p1_size" ] || { log "step 2: the loop over the eMMC is not p1's size"; ic_snap_down; return 1; }
  chroot "$CH" /usr/bin/truncate -s 512M /tmp/ic-snap-cow || { log "step 2: no room for the snapshot store"; ic_snap_down; return 1; }
  _cl=$(chroot "$CH" /usr/sbin/losetup -f --show /tmp/ic-snap-cow 2>> "$LOG") || { log "step 2: loop over the snapshot store failed"; ic_snap_down; return 1; }
  echo "$_ol $_cl" > "$CH/tmp/ic-snap-loops"
  # no udev in the installer: libdevmapper makes the /dev/mapper node itself. Chunks of 32 sectors
  # (16 KiB): the snapshot splits I/O at chunk size, so 4 KiB pieces through dm, loop and MMC would
  # slow the reads; but each changed 4 KiB block costs a whole chunk in the store (RAM): a full 64 MiB
  # journal of scattered blocks is then at most 16384 x 16 KiB = 256 MiB, inside the chroot's tmpfs
  # (about half of the 1 GB). The dump's check needed 1.6 MB
  chroot "$CH" /usr/bin/env DM_DISABLE_UDEV=1 /sbin/dmsetup create --noudevsync "$IC_SNAP" \
      --table "0 $p1_size snapshot $_ol $_cl N 32" >> "$LOG" 2>&1 && [ -b "$CH$IC_SNAP_DEV" ] \
    || { log "step 2: snapshot not made"; ic_snap_down; return 1; }
  # a full check, not only the journal: e2image skips inodes without links, so an orphan (a file
  # deleted while open, kept for release at the next mount: a power cut leaves them) would reach the
  # card with stale blocks and the backup with zeros where its extent tree was, a root that does not
  # mount (reproduced). -fy replays the journal, releases orphans and fixes
  # what the old raw copy's step 3 fixed on the card: the same e2fsck on the same bytes, now before
  # the copy, so card and backup get a clean file system. Its writes land in the RAM store
  _orph=$(chroot "$CH" /usr/sbin/dumpe2fs -h "$IC_SNAP_DEV" 2>/dev/null | grep -c '^First orphan inode' || true)
  _rc=0
  chroot "$CH" /usr/sbin/e2fsck -fy "$IC_SNAP_DEV" >> "$LOG" 2>&1 || _rc=$?
  [ "$_rc" -le 1 ] || { log "step 2: the check of the snapshot failed (e2fsck $_rc)"; ic_snap_down; return 1; }
  _st=$(chroot "$CH" /usr/bin/env DM_DISABLE_UDEV=1 /sbin/dmsetup status "$IC_SNAP" 2>&1)
  case $_st in *Invalid*|*Overflow*|"") log "step 2: snapshot unusable: $_st"; ic_snap_down; return 1 ;; esac
  # the used part, for the progress: block count minus free blocks, times the block size; and the file
  # system's own size in sectors (e2image streams that much; p1 can be a little bigger: the dump's is
  # one sector more, and the backup takes that rest raw from the eMMC)
  _sz=$(chroot "$CH" /usr/sbin/dumpe2fs -h "$IC_SNAP_DEV" 2>/dev/null | awk -F: '
    /^Block count/ { n = $2 } /^Free blocks/ { f = $2 } /^Block size/ { b = $2 }
    END { if (n > 0 && b > 0) printf "%d %d %d", (n - f) * b / 1048576, n * b / 512, b }')
  IC_USED_MIB=$(echo "$_sz" | cut -d' ' -f1) IC_FS_SECTORS=$(echo "$_sz" | cut -d' ' -f2)
  [ -n "$_sz" ] && [ "${IC_USED_MIB:-0}" -gt 0 ] && [ "${IC_FS_SECTORS:-0}" -gt 0 ] && [ "$IC_FS_SECTORS" -le "$p1_size" ] \
    || { log "step 2: the snapshot's file system size is unknown or bigger than p1 ($_sz)"; ic_snap_down; return 1; }
  echo "$IC_USED_MIB" > "$CH/tmp/ic-snap-used"
  echo "$IC_FS_SECTORS" > "$CH/tmp/ic-snap-fs"
  # the backup superblocks with their group descriptors and reserved GDT blocks: e2image -ra writes
  # only the primary ones, so the card got none (an empty spare, or old data from the card; e2fsck -b
  # failed on the copy; reproduced on the dump's file system), and neither
  # tune2fs nor debugfs rewrites them. ic_copy writes these ranges raw from the snapshot, ic_verify
  # compares them. One "<first block> <count> <block size>" line per backup group
  chroot "$CH" /usr/sbin/dumpe2fs "$IC_SNAP_DEV" 2>/dev/null | awk -v bs="$(echo "$_sz" | cut -d' ' -f3)" '
    function out() { if (p) print s, e - s + 1, bs; p = 0 }
    /^Group [0-9]+:/ { out() }
    /Backup superblock at/ { out(); s = $4; sub(/,/, "", s); split($NF, g, "-"); e = g[2]; p = 1 }
    /Reserved GDT blocks at/ { if (p) { split($NF, r, "-"); if (r[1] == e + 1) e = r[2] } }
    END { out() }' > "$CH/tmp/ic-snap-sbr"
  [ -s "$CH/tmp/ic-snap-sbr" ] || { log "step 2: the snapshot's backup superblocks not found"; ic_snap_down; return 1; }
  log "step 2: snapshot of the eMMC's p1 (read-only loop $_ol, store $_cl), checked (e2fsck -fy $_rc, orphan list before: $_orph, store: $(echo "$_st" | awk '{print $4}') sectors), $IC_USED_MIB MiB in use"
}
# ic_snap_down: snapshot, loops and store gone (best effort, also when nothing was set up). The kernel
# is asked whether the snapshot exists, not /dev: the node is made in the chroot's /dev (the device:
# the same devtmpfs; the PC rehearsal: a copy of its own), and the loops stay busy while it exists
ic_snap_down() {
  chroot "$CH" /usr/bin/env DM_DISABLE_UDEV=1 /sbin/dmsetup info "$IC_SNAP" > /dev/null 2>&1 \
    && chroot "$CH" /usr/bin/env DM_DISABLE_UDEV=1 /sbin/dmsetup remove --noudevsync "$IC_SNAP" >> "$LOG" 2>&1
  for _l in $(cat "$CH/tmp/ic-snap-loops" 2>/dev/null); do chroot "$CH" /usr/sbin/losetup -d "$_l" >> "$LOG" 2>&1; done
  rm -f "$CH/tmp/ic-snap-loops" "$CH/tmp/ic-snap-cow" "$CH/tmp/ic-snap-used" "$CH/tmp/ic-snap-fs" "$CH/tmp/ic-snap-sbr"
  return 0
}
# ic_card_same: the card in the slot is still the one from the first check (CID). read, not cat: it
# runs every round of the copy, and a process start costs ~0.5 s under the copy's load [device]
ic_card_same() {
  case ${SD##*/} in
    mmcblk*) _cid=""; read -r _cid 2>/dev/null < "/sys/block/${SD##*/}/device/cid"; [ "$_cid" = "$IC_CID" ] ;;
  esac
}

# ic_pid_is <pid> <command line start>: that process runs and its command line (spaces for NULs)
# starts with it. In the PC rehearsal the chroot's programs run under qemu (binfmt), whose command line
# starts with "<path>/qemu-arm <program path> ": skipped, so the rehearsal sees the progress too
ic_pid_is() {
  [ -r "/proc/$1/cmdline" ] || return 1
  # the redirection's own error (a process that just ended) silenced too: it would reach the console
  _cl=$({ tr '\000' ' ' < "/proc/$1/cmdline"; } 2>/dev/null)
  case ${_cl%% *} in */qemu-arm) _cl=${_cl#* }; _cl=${_cl#* } ;; esac
  case $_cl in "$2"*) return 0 ;; esac
  return 1
}
# ic_pid_of <command line start>: the pid of a running process whose command line starts with it,
# empty when none (for the progress, and to stop a copy when the card changes)
ic_pid_of() {
  for _pd in /proc/[0-9]*; do
    ic_pid_is "${_pd#/proc/}" "$1" && { echo "${_pd#/proc/}"; return 0; }
  done
}

# 2a. the eMMC's p1 onto the card, used blocks only, from the snapshot (ic_snap_up): e2image -ra
# writes them to p1's place on the card (sector 8192: the same place as on the eMMC) and skips the
# rest, which keeps whatever the card held (the file system never reads it; the compare goes by the
# used blocks too). At the same time the same view streams into the backup (e2image writes the full
# size to a pipe, zeros where nothing is used), compressed after the eMMC's first 4 MiB (step 1);
# after it the rest of the eMMC behind the file system (p1 may end a little later), raw, so the backup
# unpacks to exactly the eMMC's size.
# stdout: progress (ic_copy_tick). The card's CID is checked every 2 s: a different card stops the copy
# at once. No sync per piece: one at the end, and the compare reads it all back from the card. Replaced
# the raw copy of all of p1 (7293 MiB, 708 s with the backup, of which 2.2 GB are in use)
# [device]
ic_copy() {
  trap '' PIPE
  _part=$IC_BK/dlzmod-backup/emmc-user.img.zst.part
  _t0=$(cut -d' ' -f1 /proc/uptime)
  printf '0\tStep 1 of 3: starting\n' 2>/dev/null
  ic_snap_up || return 1
  _u=$IC_USED_MIB _fsm=$((IC_FS_SECTORS / 2048))
  rm -f /tmp/ic-copy-secs
  _w0=$(ic_written) _pbe="" _pbz="" _cdone=0 _bdone=0 _pmax=0 _bpart=0 _tz=0 _bwz=0 _tk=0
  _ts=$(cut -d' ' -f1 /proc/uptime)
  _off=$((p1_start * 512))
  # before each write: the card is still there (a pulled card's name would become a plain file in the
  # RAM /dev) and still the one from the checks (CID).
  ic_card_ok() { [ -b "$SD" ] && ic_card_same; }
  ic_card_ok || { log "step 2: the card is gone or not the one from the checks"; ic_snap_down; return 1; }
  # p1's last MiB zeroed first: e2image writes only used blocks, and an old signature near p1's end
  # (RAID and the like) could make blkid unsure in step 3. The used blocks and p1's tail follow
  _pe=$((p1_start + p1_size))
  ic_dd 512 2048 if=/dev/zero of="$SD" seek=$((_pe - 2048)) || { log "step 2: p1's last MiB on the card not cleared"; ic_snap_down; return 1; }
  # the backup's stream first, so its reader is running when the copy starts. Each of its two programs
  # leaves its pid for the progress (exec keeps the subshell's pid, so no /proc search is needed)
  rm -f "$CH/tmp/ic-pid-bke" "$CH/tmp/ic-pid-bkz"
  chroot "$CH" /usr/bin/bash -c 'set -o pipefail
    { echo $BASHPID > /tmp/ic-pid-bke; exec /sbin/e2image -ra "$1" - 2>> /tmp/ic-e2b; } \
      | { echo $BASHPID > /tmp/ic-pid-bkz; exec zstd -q -1 -T2 -c; } >> "$2"' \
    _ "$IC_SNAP_DEV" "$_part" > /dev/null 2>> "$LOG" &
  _pb=$!
  chroot "$CH" /sbin/e2image -ra -O "$_off" "$IC_SNAP_DEV" "$SD" > /dev/null 2>> "$LOG" &
  _pc=$!
  # until both have ended: the backup's stream (the full size, compressed) can end minutes after the
  # copy [device: the bar stood at 100 % for ~2 min]. Each one's end is kept once seen: a
  # reaped pid can come back as another process
  _pcend=0 _pbend=0
  while :; do
    kill -0 $_pc 2>/dev/null || _pcend=1
    kill -0 $_pb 2>/dev/null || _pbend=1
    [ $_pcend = 1 ] && [ $_pbend = 1 ] && break
    if ! ic_card_same; then
      # the copy may have ended (and been reaped by ash) while the backup still runs: its pid could be
      # someone else's by now
      ic_pid_is $_pc "/sbin/e2image -ra -O " && kill $_pc 2>/dev/null
      for _k in "/sbin/e2image -ra $IC_SNAP_DEV - " "zstd -q -1 -T2 -c "; do
        _kp=$(ic_pid_of "$_k"); [ -n "$_kp" ] && kill "$_kp" 2>/dev/null
      done
      wait $_pc; wait $_pb
      log "step 2: the card in the slot changed (CID), copy stopped"
      ic_snap_down
      return 1
    fi
    ic_copy_tick
    sleep 2
  done
  _rc=0
  wait $_pc || _rc=$?
  _rb=0
  wait $_pb || _rb=$?   # also after a failed copy: nothing may still write DLZDATA when /init frees it
  if [ "$_rc" != 0 ] || [ "$_rb" != 0 ]; then
    log "step 2: copy (e2image $_rc) or backup stream ($_rb) failed: $(tail -c 300 "$CH/tmp/ic-e2b" 2>/dev/null | tr '\n' ' ')"
    ic_snap_down
    return 1
  fi
  ic_copy_tick
  _end=$((p1_start + IC_FS_SECTORS))   # the stream ends with the file system, the rest raw from there
  ic_card_ok || { log "step 2: the card is gone or not the one from the checks"; ic_snap_down; return 1; }
  # the backup superblocks, their group descriptors and reserved GDT blocks raw from the snapshot
  # (e2image wrote only the primary ones; ic_snap_up listed the ranges)
  while read -r _s _n _b; do
    ic_dd "$_b" "$_n" if="$CH$IC_SNAP_DEV" of="$SD" skip="$_s" seek=$((_off / _b + _s)) \
      || { log "step 2: the backup superblocks at block $_s not copied"; ic_snap_down; return 1; }
  done < "$CH/tmp/ic-snap-sbr"
  # p1 behind its file system (the dump: 1 sector) raw from the eMMC, as the raw copy did: no old card
  # data there (an old signature at p1's end could confuse blkid in step 3)
  _tail=$((p1_size - IC_FS_SECTORS))
  if [ "$_tail" -gt 0 ]; then
    ic_dd 512 $_tail if="$EMMC" of="$SD" skip=$_end seek=$_end || { log "step 2: p1's tail behind the file system not copied"; ic_snap_down; return 1; }
  fi
  _rest=$(( $(cat "/sys/block/${EMMC##*/}/size") - _end ))
  if [ "$_rest" -gt 0 ]; then
    # in the largest blocks (up to 1 MiB) that start and length both fill: the same bytes as 512-byte
    # reads, without 327680 of them (the XS: from 7296 MiB, 160 MiB)
    _zb=2048
    while [ $((_end % _zb)) != 0 ] || [ $((_rest % _zb)) != 0 ]; do _zb=$((_zb / 2)); done
    ic_zst "$EMMC" $((_zb * 512)) $((_end / _zb)) $((_rest / _zb)) "$_part" || { ic_snap_down; return 1; }
  fi
  # the page cache onto the card, with the bar moving (it can take minutes [device])
  sync &
  _ps=$!
  while kill -0 $_ps 2>/dev/null; do ic_copy_tick; sleep 2; done
  wait $_ps
  ic_copy_tick 1
  log "step 2: copied the $_u MiB in use of p1's $((p1_size / 2048)) MiB; backup: $(( $(ic_size "$CH$_part") / 1048576 )) MiB so far"
  : > /tmp/ic-copy-ok
}

# The backup check's unpack (ic_bk_check: zstd checks its checksums, the byte count must match) is
# processor work, the compare waits on the card: run alongside the compare, the two only share the
# card's read speed (compare 326 s then check 191 s one after the other [device]).
# ic_bk_count_start <dir in the chroot>: one background unpack per emmc-*.img.zst.part. Its state is in
# files in the chroot's /tmp, not in shell variables, so it holds whichever subshell runs the compare
# and the check (/init: one; the PC rehearsal: one each): ic-bkc.<file> = the byte count, .ok = zstd
# and wc both succeeded, .done = finished either way, .pid = the background process, .zpid = its zstd
# (for the progress: its rchar is how far it has read the file); ic-bkc-t0 = the start (uptime).
# stdout to /dev/null, so the progress pipe to ui serve closes when its writers end
ic_bk_count_start() {
  rm -f "$CH"/tmp/ic-bkc.*
  cut -d' ' -f1 /proc/uptime > "$CH/tmp/ic-bkc-t0"
  for _f in "$CH$1/"emmc-*.img.zst.part; do
    [ -e "$_f" ] || return 0
    _o=/tmp/ic-bkc.${_f##*/}
    chroot "$CH" /usr/bin/bash -c 'set -o pipefail
      { echo $BASHPID > "$2.zpid"; exec zstd -q -dc "$1"; } | wc -c > "$2" && : > "$2.ok"; : > "$2.done"' \
      _ "${_f#$CH}" "$_o" > /dev/null 2>> "$LOG" &
    echo $! > "$CH$_o.pid"
  done
}
# ic_bk_running: an unpack started by ic_bk_count_start has not finished: no .done yet and its process
# still there (one that died without .done counts as finished, failed: no .ok)
ic_bk_running() {
  for _pf in "$CH"/tmp/ic-bkc.*.pid; do
    [ -e "$_pf" ] || continue
    [ -e "${_pf%.pid}.done" ] && continue
    _bp=""; read -r _bp 2>/dev/null < "$_pf"
    [ -n "$_bp" ] && kill -0 "$_bp" 2>/dev/null && return 0
  done
  return 1
}
# ic_bk_count_wait: until they have finished (at once when none were started)
ic_bk_count_wait() {
  while ic_bk_running; do sleep 1; done
  return 0
}
# ic_bk_file: the unpack for the progress (there is one: emmc-user): _bzf its zstd's pid file, _bdonef
# its .done file, _bsz the file's MiB, _bt0 its start; _bz (the pid) is read by ic_cmp_tick
ic_bk_file() {
  _bzf="" _bdonef="" _bz="" _bsz=0 _bf=""
  for _pf in "$CH"/tmp/ic-bkc.*.pid; do
    [ -e "$_pf" ] || continue
    _bf=${_pf##*/ic-bkc.}; _bf=$IC_BK/dlzmod-backup/${_bf%.pid}
    _bzf=${_pf%.pid}.zpid _bdonef=${_pf%.pid}.done
  done
  [ -n "$_bf" ] && _bsz=$(( $(ic_size "$CH$_bf") / 1048576 ))
  _bt0=0; read -r _bt0 2>/dev/null < "$CH/tmp/ic-bkc-t0"
}

# ic_cmp_tick: the line of the compare, and of the backup check after it (ic_bk_finish). The bar follows
# what cmp has been fed: the snapshot side's stream (its e2image's writes into the pipe), of the file
# system's full size, zeros included (the card side's reads ran ahead of it and stopped at the size in
# use while cmp still had minutes to go [device]). The backup's unpack reads the same card
# alongside: bar and time follow whichever of the two is behind (an unpack whose read position is not
# known holds nothing back). The GB count shows from the first round, the time left once there is
# enough to go by (otherwise it says only "starting" for over a minute [device]). Reads ic_verify's
# _t0 _vfs _pcs (the snapshot side's e2image, from its pid file) and ic_bk_file's _bzf _bdonef _bsz
# _bt0, and _cs (the copy's seconds); keeps _cmpdone _vpos _pmax (the bar never goes back) _tk (the
# round). The time left: blend() of the measured one and IC_COMPARE_PCT of the copy's time, the share
# the copy's own line already counted on for the whole install (so that does not jump at the change)
ic_cmp_tick() {
  [ -n "$_cs" ] || read -r _cs 2>/dev/null < /tmp/ic-copy-secs
  [ -n "$_cs" ] || _cs=$(( ${_u:-2322} * IC_COPY_MS / 1000 ))
  [ -n "$_pcs" ] || read -r _pcs 2>/dev/null < "$CH/tmp/ic-pid-cmps"
  [ -n "$_bz" ] || [ -z "$_bzf" ] || read -r _bz 2>/dev/null < "$_bzf"
  _o=$(awk -v pcs="$_pcs" -v vfs="$_vfs" -v cmpdone="${_cmpdone:-0}" -v vpos="${_vpos:-0}" -v pmax="${_pmax:-0}" \
      -v bz="$_bz" -v bsz="$_bsz" -v bt0="$_bt0" -v bdonef="$_bdonef" -v t0="$_t0" \
      -v wc=$IC_BAR_COPY -v wv=$IC_BAR_COMPARE -v bs=$IC_BUILD_SECS -v cp=$IC_COMPARE_PCT -v cs="$_cs" \
      -v tk="${_tk:-0}" -v lg="${LOG:-}" "$IC_AWK"'
  BEGIN {
    if (vfs < 1) vfs = 1
    now = first(rd("/proc/uptime"), 1); s = now - t0
    if (!cmpdone && pcs != "" && !alive(pcs)) cmpdone = 1
    d = vfs
    if (!cmpdone) { d = 0; if (pcs != "") d = min(mib(key(rd("/proc/" pcs "/io"), "wchar:")), vfs) }
    d = max(d, vpos)
    # the unpack runs while its .done file is missing (getline -1; the file is empty when it is there),
    # no pid yet: started, position not known
    run = 0
    if (bdonef != "") { if ((getline x < bdonef) < 0) { run = 1; if (bz != "" && !alive(bz)) run = 0 }; close(bdonef) }
    bm = 1000; bl = 0
    if (run) {
      bm = -1
      pos = 0; if (bz != "") pos = mib(key(rd("/proc/" bz "/io"), "rchar:"))
      if (pos > 0 && bsz > 0 && now - bt0 >= 1) { bm = min(pos * 1000 / bsz, 999); bl = (1000 - bm) * (now - bt0) / bm }
    }
    pm = d * 1000 / vfs; if (bm >= 0 && bm < pm) pm = bm
    pm = int(max(pm, pmax))
    cl = 0; if (!cmpdone) { cl = -1; if (d >= 128 && s >= 15) cl = (vfs - d) * s / d }
    ml = -1
    if (cl >= 0 && !(cmpdone && run && bm < 0)) ml = max(cl, bl)
    left = blend(pm / 1000, cs * cp / 100, ml)
    if (cmpdone && run) txt = "checking the backup, " lefttxt(left)
    else txt = gb(d) " of " gb(vfs) " GB compared, " lefttxt(left)
    all = alltxt(left + bs)
    tk++; logline(lg, tk, now, "step 2, " wc + int(wv * pm / 1000) " %, " txt ", " all)
    print cmpdone, d, pm, tk
    printf "%d\tStep 2 of 3: %s\t%s\n", wc + int(wv * pm / 1000), txt, all }' 2>/dev/null)
  [ -n "$_o" ] || return 0
  # shellcheck disable=SC2086
  set -- ${_o%%"$IC_NL"*}
  _cmpdone=$1 _vpos=$2 _pmax=$3 _tk=$4
  printf '%s\n' "${_o#*"$IC_NL"}" 2>/dev/null
}

# 2b. the copy read back from the card (page cache dropped first, so it comes from the card) and
# compared with the snapshot it was made from; stdout: progress. Each side goes through e2image -ra
# into a stream of p1's full size: the blocks its own file system uses, zeros elsewhere. Equal
# streams mean every block the snapshot uses is on the card unchanged and the card's file system
# uses no other block (the metadata saying which blocks are used is in both streams); the card's
# unused blocks may hold anything. Both e2image runs must end with 0 as well, so two equally failed
# (empty) streams cannot pass. The stock GNU cmp (busybox compares byte by byte, ~40x slower). The
# snapshot is taken down after it, either way
ic_verify() {
  trap '' PIPE
  sync
  echo 3 > /proc/sys/vm/drop_caches
  ic_bk_count_start "$IC_BK/dlzmod-backup"   # the backup check's unpack alongside (from the card too)
  _u=$(cat "$CH/tmp/ic-snap-used" 2>/dev/null)
  _vfs=$(( $(cat "$CH/tmp/ic-snap-fs" 2>/dev/null || echo 0) / 2048 ))
  [ -b "$CH$IC_SNAP_DEV" ] && [ -n "$_u" ] || { log "step 2: no snapshot to compare the card with"; ic_bk_count_wait; ic_snap_down; return 1; }
  _t0=$(cut -d' ' -f1 /proc/uptime)
  printf '%s\tStep 2 of 3: starting\n' $IC_BAR_COPY 2>/dev/null
  rm -f "$CH/tmp/ic-cmp" "$CH/tmp/ic-cmp.rc" "$CH/tmp/ic-cmps.rc" "$CH/tmp/ic-cmpc.rc" "$CH/tmp/ic-pid-cmps"
  # the card side through a named pipe, as a job the chroot's bash waits for: with <(...) bash does
  # not wait, and its exit code could come after it is read (a good copy then
  # failed). If cmp stops early (a difference) or never opens the pipe, the card side may sit in
  # open() or write(): opening and closing the pipe lets it end (EPIPE), at most 10 s, then it is
  # stopped. ic-cmp.rc is written last, after both sides have ended. The snapshot side leaves its pid
  # for the progress (exec in a subshell keeps it; its exit code still reaches ic-cmps.rc)
  chroot "$CH" /usr/bin/bash -c '
    rm -f /tmp/ic-cmpf; mkfifo /tmp/ic-cmpf || { echo 9 > /tmp/ic-cmp.rc; exit 1; }
    { /sbin/e2image -ra -o "$1" "$2" - 2> /dev/null; echo $? > /tmp/ic-cmpc.rc; } > /tmp/ic-cmpf &
    c=$!
    { ( echo $BASHPID > /tmp/ic-pid-cmps; exec /sbin/e2image -ra "$3" - 2> /dev/null ); echo $? > /tmp/ic-cmps.rc; } \
      | /usr/bin/cmp - /tmp/ic-cmpf > /tmp/ic-cmp 2>&1
    r=$?
    i=0
    while kill -0 $c 2> /dev/null && [ $i -lt 50 ]; do exec 3<> /tmp/ic-cmpf; exec 3<&-; sleep 0.2; i=$((i + 1)); done
    kill $c 2> /dev/null
    wait $c
    rm -f /tmp/ic-cmpf
    echo $r > /tmp/ic-cmp.rc' _ $((p1_start * 512)) "$SD" "$IC_SNAP_DEV" > /dev/null 2>> "$LOG" &
  _pv=$! _pcs="" _cmpdone=0 _vpos=0 _pmax=0 _tk=0 _cs=""
  ic_bk_file
  while kill -0 $_pv 2>/dev/null; do ic_cmp_tick; sleep 2; done
  wait $_pv
  _rv=$(cat "$CH/tmp/ic-cmp.rc" 2>/dev/null) _rs=$(cat "$CH/tmp/ic-cmps.rc" 2>/dev/null) _rcd=$(cat "$CH/tmp/ic-cmpc.rc" 2>/dev/null)
  # p1's tail behind the file system (ic_copy wrote it raw): the same on card and eMMC
  _fs=$(cat "$CH/tmp/ic-snap-fs" 2>/dev/null)
  _tail=$((p1_size - ${_fs:-$p1_size}))
  if [ -z "$_fs" ]; then _rv=8
  elif [ "$_tail" -gt 0 ] && [ "$_rv" = 0 ]; then
    _end=$((p1_start + _fs))
    ic_dd 512 $_tail if="$SD" of="$CH/tmp/ic-tail-sd" skip=$_end && ic_dd 512 $_tail if="$EMMC" of="$CH/tmp/ic-tail-emmc" skip=$_end \
      && chroot "$CH" /usr/bin/cmp -s /tmp/ic-tail-sd /tmp/ic-tail-emmc || { _rv=7; echo "p1's tail behind the file system differs" > "$CH/tmp/ic-cmp"; }
    rm -f "$CH/tmp/ic-tail-sd" "$CH/tmp/ic-tail-emmc"
  fi
  # the backup superblocks (ic_copy wrote them raw; e2image skips them, so the streams cannot show
  # them): the same on card and snapshot
  if [ "$_rv" = 0 ]; then
    [ -s "$CH/tmp/ic-snap-sbr" ] || _rv=6
    while [ "$_rv" = 0 ] && read -r _s _n _b; do
      ic_dd "$_b" "$_n" if="$SD" of="$CH/tmp/ic-sb-sd" skip=$((p1_start * 512 / _b + _s)) \
        && ic_dd "$_b" "$_n" if="$CH$IC_SNAP_DEV" of="$CH/tmp/ic-sb-snap" skip="$_s" \
        && chroot "$CH" /usr/bin/cmp -s /tmp/ic-sb-sd /tmp/ic-sb-snap \
        || { _rv=6; echo "the backup superblocks at block $_s differ" > "$CH/tmp/ic-cmp"; }
    done < "$CH/tmp/ic-snap-sbr"
    rm -f "$CH/tmp/ic-sb-sd" "$CH/tmp/ic-sb-snap"
  fi
  ic_snap_down
  if [ "$_rv" != 0 ] || [ "$_rs" != 0 ] || [ "$_rcd" != 0 ]; then
    log "copy differs from the eMMC's p1 (or a read failed): cmp ${_rv:-?}, snapshot side ${_rs:-?}, card side ${_rcd:-?}: $(head -c 300 "$CH/tmp/ic-cmp" 2>/dev/null) (byte offsets within p1, card = second)"
    ic_bk_count_wait   # no unpack left reading DLZDATA when /init releases the card
    return 1
  fi
  _cmpdone=1
  ic_cmp_tick
  log "step 2: the $_u MiB in use compared with the eMMC's p1 (snapshot): equal"
  : > /tmp/ic-verify-ok
}

# 2c. check the backup (ic_bk_check), then DLZDATA unmounted (ic_guard in the next steps wants nothing
# of the card mounted); stdout: progress. The bytes of the copy chunks are the ones the compare just
# found equal to the eMMC
ic_bk_finish() {
  trap '' PIPE
  rm -f /tmp/ic-bk-ok
  # the unpack started with the compare: what is left of it, with the time left from its own speed; the
  # bar goes on from where the compare left it (/init runs both in one shell; the PC rehearsal one each,
  # hence the defaults)
  ic_bk_file
  _cmpdone=1 _pcs="" _vfs=${_vfs:-1} _t0=${_t0:-0}
  while ic_bk_running; do ic_cmp_tick; sleep 2; done
  # what follows (the README, the rename, DLZDATA released with its last writes) has no measure of its
  # own: a line that says so
  printf '%s\tStep 2 of 3: checking the backup, almost done\n' $((IC_BAR_COPY + IC_BAR_COMPARE)) 2>/dev/null
  ic_bk_check "$IC_BK/dlzmod-backup" "Made by the installer while it copied the mixer's software to this card (the internal storage" \
    "The system partition in it is the file system as the mixer would see it after a check (every file and
setting; free space blank), so it is not a byte-for-byte copy. Its start and its end are." || return 1
  ic_bk_release || return 1
  : > /tmp/ic-bk-ok
}
# ic_bk_check <dir in the chroot> <first README line>: each emmc-*.img.zst.part unpacked in full (zstd
# checks its checksums) to exactly the size of what it holds, renamed, and a README.txt next to them
ic_bk_check() {
  _e=${EMMC##*/}
  _t0=$(cut -d' ' -f1 /proc/uptime)
  sync
  echo 3 > /proc/sys/vm/drop_caches   # read back from the card
  _list=""
  ic_bk_count_wait   # an unpack started alongside the compare (ic_bk_count_start): its result is used
  for _f in "$CH$1/"emmc-*.img.zst.part; do
    [ -e "$_f" ] || { log "backup: nothing to check"; return 1; }
    _n=${_f##*/emmc-}; _n=${_n%.img.zst.part}
    [ "$_n" = user ] && _n=$_e || _n=$_e$_n
    _want=$(( $(cat "/sys/block/$_n/size" 2>/dev/null || echo 0) * 512 ))
    _o=$CH/tmp/ic-bkc.${_f##*/}
    if [ -e "$_o.pid" ]; then   # unpacked alongside the compare: its result
      [ -e "$_o.ok" ] && _got=$(cat "$_o") || { log "backup: ${_f##*/} does not unpack"; return 1; }
      _how="alongside the compare"
    else
      _got=$(chroot "$CH" /usr/bin/bash -c 'set -o pipefail; zstd -q -dc "$1" | wc -c' _ "${_f#$CH}" 2>> "$LOG") \
        || { log "backup: ${_f##*/} does not unpack"; return 1; }
      _how="on its own"
    fi
    rm -f "$_o" "$_o.ok" "$_o.done" "$_o.pid" "$_o.zpid"
    [ "$_want" -gt 0 ] && [ "$_got" = "$_want" ] || { log "backup: ${_f##*/} unpacks to $_got bytes, $_n has $_want"; return 1; }
    _fin=${_f%.part}
    mv "$_f" "$_fin" || { log "backup: renaming ${_f##*/} failed"; return 1; }
    _list="$_list
  ${_fin##*/}: $(( $(ic_size "$_fin") / 1048576 )) MiB, unpacks to $_got bytes ($_n)"
  done
  {
    echo "DLZ Creator Modded $VERSION ($BUILD): backup of this mixer's internal storage (eMMC)"
    echo "Mixer: $model"
    echo
    echo "$2"
    echo "is only read, never changed). Unpack with zstd, e.g. zstd -d emmc-user.img.zst:"
    echo "${_list#?}"
    [ -z "${3:-}" ] || { echo; echo "$3"; }
    echo
    echo "It holds everything on the mixer, including your settings, presets and the lock PIN: keep"
    echo "it private, and keep a copy on a computer. Restoring it is not part of DLZ Creator Modded."
  } > "$CH$1/README.txt" || { log "backup: README.txt not written"; return 1; }
  log "backup: checked in $(awk -v a="$_t0" -v b="$(cut -d' ' -f1 /proc/uptime)" 'BEGIN { printf "%.0f", b - a }') s, unpacked $_how:$_list"
}

# 3. journal replay and a new UUID on the raw copy, through a loop device over it
ic_uuid() {
  ic_guard || return 1
  _old=$(chroot "$CH" /usr/sbin/blkid -p -o value -s UUID "${EMMC}p1" 2>/dev/null)
  # its errors go to the log; a few tries in case the card
  # is still settling after the long write and read
  _loop="" _try=1
  while [ -z "$_loop" ] && [ $_try -le 3 ]; do
    _loop=$(chroot "$CH" /usr/sbin/losetup -f --show -o $((p1_start * 512)) --sizelimit $((p1_size * 512)) "$SD" 2>> "$LOG") \
      || { _loop=""; log "step 3: losetup try $_try failed"
           for _l in $(chroot "$CH" /usr/sbin/losetup -j "$SD" -O NAME -n 2>/dev/null); do chroot "$CH" /usr/sbin/losetup -d "$_l"; done
           sleep 1; }
    _try=$((_try + 1))
  done
  if [ -z "$_loop" ]; then
    log "step 3: losetup failed; loop devices: $(ls /dev/loop* 2>&1 | tr '\n' ' ')"
    log "step 3: $(grep -i loop /proc/devices | tr '\n' ' '); card read-only: $(blockdev --getro "$SD" 2>&1)"
    return 1
  fi
  log "step 3: loop device $_loop over the copy (read-only: $(blockdev --getro "$_loop" 2>&1))"
  _rc=0
  chroot "$CH" /usr/sbin/e2fsck -fy "$_loop" >> "$LOG" 2>&1 || _rc=$?
  if [ "$_rc" -ge 4 ]; then
    log "step 3: e2fsck failed ($_rc); loop $_loop read-only: $(blockdev --getro "$_loop" 2>&1)"
    chroot "$CH" /usr/sbin/losetup -d "$_loop"
    return 1
  fi
  chroot "$CH" /usr/sbin/tune2fs -U random "$_loop" >> "$LOG" 2>&1 || { log "step 3: tune2fs failed"; chroot "$CH" /usr/sbin/losetup -d "$_loop"; return 1; }
  _new=$(chroot "$CH" /usr/sbin/blkid -p -o value -s UUID "$_loop" 2>/dev/null)
  chroot "$CH" /usr/sbin/losetup -d "$_loop" || { log "step 3: losetup -d failed"; return 1; }
  sync   # the loop's writes are in the whole card's cache; out before the MBR and the core
  if [ -z "$_new" ] || [ "$_new" = "$_old" ]; then
    log "step 3: new UUID missing or equal to the eMMC's ($_new)"
    return 1
  fi
  log "step 3: journal replayed (e2fsck $_rc), rootfs UUID on the card: $_new (eMMC: $_old)"
}

# 4a. the eMMC's p1 entry (16 bytes at 446) into slot 1 of the card's table from step 1, which keeps
# its disk id and DLZDATA; one 512-byte write. No partitioning tool near the eMMC
ic_mbr() {
  ic_guard || return 1
  _m=/tmp/ic-mbr
  ic_dd 512 1 if="$SD" of=$_m || return 1
  _p2=/sys/class/block/${SD##*/}p2
  _s2=$(cat "$_p2/start" 2>/dev/null) _z2=$(cat "$_p2/size" 2>/dev/null)
  [ -n "$_s2" ] && [ "$(od -An -j446 -N16 -tx1 $_m | tr -d ' \n')" = 00000000000000000000000000000000 ] \
    || { log "step 4: the card's table is not the one from step 1 (DLZDATA only)"; return 1; }
  dd if="$EMMC" bs=1 skip=446 count=16 2>/dev/null | dd of=$_m bs=1 seek=446 conv=notrunc 2>/dev/null
  [ "$(od -An -j446 -N16 -tx1 $_m)" = "$(od -An -j446 -N16 -tx1 "$EMMC")" ] || { log "step 4: the eMMC's p1 entry was not taken over"; return 1; }
  ic_dd 512 1 if=$_m of="$SD" conv=fsync || return 1
  ic_reread || log "step 4: partition table reread failed, checking what the kernel has"
  _i=0
  while [ ! -b "${SD}p1" ] && [ $_i -lt 20 ]; do sleep 0.5; _i=$((_i + 1)); done
  [ -b "${SD}p1" ] || { log "step 4: ${SD}p1 did not appear"; return 1; }
  # the kernel's p1 must be the eMMC's p1 (start 8192), and DLZDATA unchanged
  _p1=/sys/class/block/${SD##*/}p1
  [ "$(cat "$_p1/start" 2>/dev/null)" = 8192 ] || { log "step 4: ${SD}p1 does not start at sector 8192"; return 1; }
  [ "$(cat "$_p1/size" 2>/dev/null)" = "$(cat "/sys/class/block/${EMMC##*/}p1/size" 2>/dev/null)" ] || { log "step 4: ${SD}p1 is not the size of the eMMC's p1"; return 1; }
  [ "$(cat "$_p2/start" 2>/dev/null)" = "$_s2" ] && [ "$(cat "$_p2/size" 2>/dev/null)" = "$_z2" ] || { log "step 4: DLZDATA changed"; return 1; }
  log "step 4: the eMMC's p1 entry added to the card's table"
}

# 4b. the shared card core, in the chroot (its own guard and preflight run again). Its output goes
# to the log; its step markers (DLZMOD-STEP k/n text) become progress lines on stdout, steps 3..10
ic_core() {
  rm -f /tmp/ic-core-ok
  ic_guard || return 1
  { chroot "$CH" /usr/bin/env SDCONF= DLZDATA_KEEP=1 DLZMOD_MODEL="${IC_MODEL:-}" DLZMOD_MIXER_ID="${IC_MIXER_ID:-}" /usr/bin/bash /tmp/pkg/mod/card-core.sh "$SD" /tmp/pkg/layers 2>> "$LOG" \
      && : > /tmp/ic-core-ok; } | while IFS= read -r _l; do
    printf '%s\n' "$_l" >> "$LOG"
    case $_l in
      "DLZMOD-STEP "*/*" "*) _r=${_l#DLZMOD-STEP }; _k=${_r%%/*}; ic_bstep $((_k + 2)) "${_r#* }" ;;
    esac
  done
  [ -e /tmp/ic-core-ok ] || { log "step 4: card-core.sh failed"; return 1; }
  log "step 4: card-core.sh done"
}

# the build phase (the log's steps 3 and 4, the screen's step 3 of 3), the last part of the one bar: ic_bstep <n> <text> prints the line
# for ui serve, part n of IC_BUILD_STEPS (2 here + card-core.sh's 8); the bar moves per part (keep
# the names short: with the longest time text the line fits in one row, dev/installer-mockup.py checks)
IC_BUILD_STEPS=10
ic_bstep() {
  printf '%s\tStep 3 of 3: %s, %s\n' \
    $(( 100 - IC_BAR_BUILD + ($1 - 1) * IC_BAR_BUILD / IC_BUILD_STEPS )) "$2" \
    "$(ic_left $(( IC_BUILD_SECS * (IC_BUILD_STEPS - $1 + 1) / IC_BUILD_STEPS )))" 2>/dev/null
}
# stdout: progress lines; /tmp/ic-build-ok when all went well, else /tmp/ic-build-fail holds the
# message for fail() (which has to run in /init's own shell, not in this pipeline)
ic_build() {
  trap '' PIPE
  rm -f /tmp/ic-build-ok /tmp/ic-build-fail
  ic_bstep 1 "checking the copy"
  ic_uuid || { echo "Preparing the copy failed (see the log)" > /tmp/ic-build-fail; return 1; }
  ic_bstep 2 "partition table"
  ic_mbr || { echo "Partitioning the card failed (see the log)" > /tmp/ic-build-fail; return 1; }
  ic_core || { echo "Building the modded system failed (see the log)" > /tmp/ic-build-fail; return 1; }
  printf '100\tBuilt\n' 2>/dev/null
  : > /tmp/ic-build-ok
}

# On a failure before the bootloader (STAGE=card), when the log has no DLZDATA to go to: a fresh
# partition table on the card with one small FAT partition, DLZLOG, in the gap between the MBR and
# the system copy (sectors 2048-8191: cleared in step 1, the bootloader is not written yet), so the
# log can be read on a PC. The card stays unbootable (no bootloader), and a copy that still has the
# eMMC's UUID loses its partition entry. Writes the card only, after the same guard as the install.
# Mounts DLZLOG at /sd; rc 1 = not possible (the caller keeps the log in RAM)
ic_rescue_log() {
  # only after step 1 cleared the card: before that it may still be the working installer card, and
  # a new partition table + format there would leave its bootloader with nothing to boot
  [ -e /tmp/ic-clear-ok ] || { log "rescue log: step 1 did not finish, the card is left as it is"; return 1; }
  ic_guard || return 1
  printf 'label: dos\nstart=2048, size=6144, type=e\n' \
    | chroot "$CH" /usr/sbin/sfdisk --quiet --wipe never "$SD" >> "$LOG" 2>&1 || { log "rescue log: sfdisk failed"; return 1; }
  blockdev --rereadpt "$SD" >> "$LOG" 2>&1   # sfdisk rereads itself; a second try may meet EBUSY
  _p1=/sys/class/block/${SD##*/}p1
  [ "$(cat "$_p1/start" 2>/dev/null)" = 2048 ] && [ "$(cat "$_p1/size" 2>/dev/null)" = 6144 ] \
    || { log "rescue log: the new partition did not show up"; return 1; }
  _i=0
  while [ ! -b "${SD}p1" ] && [ $_i -lt 20 ]; do sleep 0.5; _i=$((_i + 1)); done
  chroot "$CH" /usr/sbin/mkfs.vfat -F 16 -s 1 -n DLZLOG "${SD}p1" >> "$LOG" 2>&1 || { log "rescue log: mkfs.vfat failed"; return 1; }
  mount -t vfat -o iocharset=ascii,flush "${SD}p1" /sd || { log "rescue log: mount failed"; return 1; }
  mkdir -p /sd/dlzmod-logs || { umount /sd; return 1; }
  log "rescue log: DLZLOG partition made on the card"
}

# 5. the "build done" marker: Mackie's bootloader from the eMMC, sectors 1-8191 (the MBR in sector 0
# stays the card's own), then read back and compare. Back to front: sectors 17-8191 (the rest of the
# SPL and U-Boot) first, sectors 1-16 (with the SPL header at 8 KiB, sector 16) last. The boot ROM
# checks the SPL's checksum and skips the card until the header is complete, so a power cut here
# never leaves a card that starts the SPL with half a U-Boot behind it (the SPL does not check it)
ic_bootloader() {
  ic_guard || return 1
  ic_dd 512 8175 if="$EMMC" of="$SD" skip=17 seek=17 conv=fsync || return 1
  ic_dd 512 16 if="$EMMC" of="$SD" skip=1 seek=1 conv=fsync || return 1
  sync
  echo 3 > /proc/sys/vm/drop_caches
  ic_dd 512 8191 if="$EMMC" of="$CH/tmp/ic-boot" skip=1 || return 1
  if ! dd if="$SD" bs=512 skip=1 count=8191 2>/dev/null | chroot "$CH" /usr/bin/cmp -s - /tmp/ic-boot; then
    log "step 5: bootloader on the card differs from the eMMC"
    return 1
  fi
  rm -f "$CH/tmp/ic-boot"
  log "step 5: bootloader copied and compared: the card is bootable"
}
