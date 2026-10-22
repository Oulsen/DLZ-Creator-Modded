# Installer

How the on-device installer works and why it is built this way. The installer image is flashed
to an SD card and the mixer boots from it; the installer turns that same card into the mod
card: a copy of the eMMC's system, the mod applied, DLZDATA for recordings and a backup of the eMMC.
The eMMC is only ever read. Code: `install/installer/` (`/init`, `install-card.sh`, `probe.sh`,
`ui.py`), `install/card-core.sh`, `install/release/` (package and image). Every build that goes
onto a card is checked by the `device-review` skill first.

## Boot route

- **Route B (chosen):** Debian's U-Boot on the installer card boots Mackie's own kernel and device
  tree from the eMMC (read-only) with our initramfs. Kernel and PMIC behave exactly as in a stock
  boot, and the download holds no Mackie code [device: proven by a spike, then every install].
- **Route A (rejected): only open-source parts.** Debian's U-Boot, mainline Linux and our own device
  tree. Mainline supports the R40's TCON LCD and `panel-lvds`, so the 1024x600 LVDS panel, the PWM
  backlight (PB2, inverted) and its enable GPIO (PB3) could be described in our own DTS. Not chosen:
  an own DTS has to get the PMIC right (the AXP221's regulator values copied exactly from Mackie's
  DTB, or left undeclared, every unneeded node disabled); wrong constraints make the kernel change
  voltages at boot, a brick risk. Route A also could not ship Mackie's logo (it would have to read
  `/etc/dlz.png` from the eMMC at runtime). The facts an own DTS would need:
  [hardware.md](hardware.md), "Mackie's device tree".

## Design decisions

1. **One card core, two wrappers.** `card-core.sh` *finishes a card* whose start is a byte copy of
   the eMMC up to the end of p1 (MBR, Mackie's bootloader at 8 KiB, rootfs): `check-rootfs.sh`,
   DLZDATA, journal replay, new UUID, visuals, sd-system units, `patch.py`, recording default,
   optional Wi-Fi/SSH, build stamp. Two wrappers prepare its input: `build-sd.sh` on the PC (from the
   dump) and the installer on the device.
   - The core refuses any target that is not a loop device backed by a regular file (PC) or a whole
     disk whose `device/type` is `SD`, or that has a partition in use (mounted, swap, holders). The
     eMMC is never a valid target. Every check fails closed [static, tested on the PC]
   - `DLZMOD_UUID` and `SOURCE_DATE_EPOCH` fix the UUID and build time: two builds of the same dump
     give identical file trees, initrd included (the splash is replaced as one cpio entry,
     `cpio-replace.py`; every other entry stays byte-identical to stock) [static, tested on the PC]
2. **Tools from the eMMC: a chroot into its read-only rootfs.** busybox lacks `sfdisk`, `e2fsck`,
   `mkfs.vfat`, `python3`, `ffmpeg`, `zstd`; the stock rootfs has them all [static]. Mounted
   `ro,noload`, a tmpfs over its `/tmp`, `/dev` `/proc` `/sys` bound in. Same tool versions as stock,
   no Mackie binaries in our download.
   - Every chroot call names its tool by absolute path (`mkpackage.sh` refuses bare names): the
     pinned busybox's `chroot` runs its *own* applet for a bare name it knows
     (FEATURE_PREFER_APPLETS), so `chroot "$CH" losetup` was busybox's losetup and `cmp` its
     byte-by-byte cmp [device]. qemu hides this on the PC, so the rehearsal binds the device's busybox
     into the chroot
   - `/init` makes `/dev/fd`, `stdin`, `stdout`, `stderr` itself: on a bare devtmpfs bash's `<(...)`
     fails with `/dev/fd/63: No such file or directory` [device]
   - DLZDATA is mounted with `iocharset=ascii`: the kernel's default charset is a module and the
     initramfs has no `modprobe` [static]
3. **Screens drawn at runtime, stdlib only.** `ui.py` (the chroot's python3, no Pillow) draws into
   `/dev/fb0` from the size it reports, text from a glyph atlas (DejaVu Sans Mono, rendered at
   release time). Rotation 180° for drawing and touch [device]. Each screen is drawn in memory and
   copied in one go (no blinking); one `ui.py serve` process takes all progress lines. A full redraw
   costs ~55 ms on the A40i [device]. `dev/installer-mockup.py` renders every screen for the guide.
4. **Touch:** the Goodix `event*` device, found by name; no touch device = a countdown screen,
   nothing written.
5. **Logs:** in RAM while the card is rewritten, then `DLZDATA/dlzmod-logs/install-N-<version>.txt` with
   `dmesg-N.txt` and the last screen as `screen-N.png`. Before DLZDATA exists, a failure leaves its
   log on a small rescue partition, DLZLOG (Windows may give it no drive letter: Disk Management,
   Change Drive Letter). Every line carries the uptime; the card's maker, OEM, name and date are
   logged, never its serial or full CID (the log is meant to be posted).
6. **Dependencies checked before anything is written, at each layer.** The core checks the 37
   commands it calls, its files, python3 >= 3.8, `VERSION` and the 9 ffmpeg filters it uses. `/init`
   checks its busybox applets (`applets.txt`), the package against its manifest, the eMMC mount, the
   touch and input modules, the chroot and the core's own preflight. Any gap: failure screen,
   nothing written.
7. **Dry-run mode** (`mkinstaller.sh --dry-run`, `dlzmod.dryrun=1`): every check and screen, then a
   full read of the eMMC; nothing written but the log. Used for the first device runs.
8. **Write order: the bootloader goes on last.** A power cut at any moment leaves a card that does
   not boot, so stock starts and the fix is "flash the installer again":
   1. Clear the card's bootloader area and partition table, then write a table with only DLZDATA
      (the eMMC's boot code with a new disk id; DLZDATA from the end of the copy's place to the card's
      end, no `.dlzmod-fresh`, so the first boot does not format it)
   2. Copy the eMMC's p1 (only the blocks its file system uses, from a snapshot; see "Copy and
      compare"), the backup alongside; compare the card with the eMMC; unpack and check the backup
   3. On the copy (not yet in the table): replay the journal, give the rootfs a new UUID, so two
      disks with the eMMC's UUID never exist side by side
   4. Add p1 to the table, run the core with `DLZDATA_KEEP=1`
   5. Last: copy Mackie's bootloader (8 KiB up to p1) from the eMMC, and compare it

   Rests on: the boot ROM skips a card without a valid bootloader and boots the eMMC [device: a card
   with a FAT but zeros at 8 KiB and 128 KiB, stock starts]. The SPL header is cleared first, on its
   own, and written last (sectors 17-8191, then 1-16). Every write step checks the card's CID first
   (a card swapped mid-install) and that the eMMC is read-only.
9. **eMMC backup** to `DLZDATA/dlzmod-backup/` on every install, from the copy's own read:
   `emmc-user.img.zst` (the whole user area: MBR, bootloader, rootfs, the ~160 MiB after p1) and
   `README.txt` (what it holds, the lock PIN wording). 978 MiB for the XS [device], one file far
   below FAT32's 4 GiB; written as `*.part`, renamed after a full unpack with the exact size (7818182656
   bytes) [device]. A failed install deletes a `*.part`. Not the boot areas boot0/boot1: reading them
   makes the kernel switch the eMMC's partition with CMD6, a write to EXT_CSD[179], and they are
   empty on the XS.
   - **Other firmware** (#46; e.g. build 1794, model unknown): no install; `probe.sh` and
     `boards.txt` decide. A hardware report (model, build, device tree, regulator voltages, U-Boot
     environment, kernel, eMMC layout, dmesg; never passwords, presets or keys) goes next to the log.
     A backup onto the installer card (FAT32 `DLZDUMP`, user area only, README with the Discord
     contact) is offered only when the mixer's Mackie bootloader is byte for byte the XS's; anything
     else stops with only the log and the report. `boards.txt` is a filter, not a safety gate: it runs
     after Debian's SPL has set the PMIC. Evidence that the SPL is safe on the full-size: one software
     image and one bootloader package for both models, the XS image ships the full-size's GD32 and
     FPGA files too [static], the full-size's board is an `EVOLVE-A1_A40i` like the XS's [web]
   - The full-size on build 1731 gets the full install (#50); installed and running on an
     owner's full-size (hardware.md, "Full-size DLZ Creator") [device]

## Copy and compare

- **Used blocks only, from a snapshot** (#49): a device-mapper snapshot over a read-only loop on the
  eMMC's p1, its store in RAM. `e2fsck -fy` replays the journal into the store (the mixer is switched
  off hard, so the journal is usually not replayed), and `e2image -ra` copies only the blocks the file
  system uses: 2322 of 7292 MiB. The compare reads the same view. Proven on the PC: the used blocks of
  "copy everything, replay" and of this view are bit for bit the same. The eMMC is only read
  because the loop opens p1 read-only (`losetup -r`) and advertises no discard or write-zeroes
  (`ic_ro_loop_ok`), and the plain `snapshot` target never writes its origin; the kernel lock from
  `/init` and the loop's read-only flag do not cover this path (5.10: they refuse writes from user
  space only, kernel-issued writes from dm or loop only warn) [static]
- **The compare** reads card and eMMC side at the same time (two controllers) into GNU `cmp`, so it
  takes about the card's read time. `tests/compare-negative.sh` plants faults (a data byte, the group
  table, a backup superblock, p1's tail, a killed card side) that it must catch
- **The backup** streams from the same read through `zstd -1`; the eMMC's rest behind the file system
  goes in 1 MiB reads (the largest block size both start and length fill)
- **What bounds the speed:** Mackie's DTB gives the SD slot no UHS, so High Speed, 50 MHz x 4 bit,
  at most 25 MB/s on the bus [static; dmesg "new high speed SDXC card"]; ~13-17 MB/s seen. The raw
  eMMC read is 44 MB/s [device]. The A7 cores: a process start costs ~0.5 s under the copy's load,
  so each progress round is one awk (reads `/proc` and `/sys` itself, pids from pid files written at
  launch), ~3 process starts per round. busybox's `wc -c` reads the whole file [static, strace on the PC]: sizes
  come from `stat -c %s`
- **Progress:** the bar's shares follow measured runs; step 1 shows "X GB written" and the time left,
  no total (the total holds the backup's size, an estimate until the backup ends, and it wandered);
  the compare shows "X of N GB compared". `tests/rehearse-install.sh` times every progress line and
  fails on a mean gap over 6 s or one over 20 s
- **Time left (#66):** the streams that copy, back up and compare are the file system's full size,
  but the blocks in use sit near their start (in the dump 87 % of them in the first 35 % of the
  stream) [static, dumpe2fs], so a speed since the start of a step foretold many times the real time:
  22 min for a step of under 5, the whole install jumping back to 9 min at step 2 [device]. Each step's
  time left is now its measured one blended with the device's own times (130 ms per MiB in use for the
  copy, the compare 81 % of the copy's real time), the measured one weighing more as the step goes on;
  the backup's part follows its reads of the data, then the zero tail at its own speed. The compare
  still goes by its stream position (its zeros cost time on the mixer too). Every ~30-40 s a progress
  line goes into the install log (`progress: step N, ...`; left out of the failure screen's last
  lines); the rehearsal checks every shown time against the real one (shown at most twice the real
  plus a minute, real at most twice the shown plus two) [guess for the mixer until an install's log
  lines say otherwise]
- **Time left in the middle of the copy (#128):** the backup's compression gets little processor time
  beside the copy and speeds up once the copy is done, so its speed so far foretold about three times
  the real rest in the middle of the copy: 14 min shown for 6.6 left [device, v0.2.0 install; the
  cause read back from its shown times, guess until a log with the round's values]. The copy step's
  expected end now comes earlier at once but moves later only by `IC_RISE_PCT` (25 %) of the time
  since the last round, never below half of the round's own estimate (`steady()`). Replayed on that
  install (`tests/estimates.sh`): at most 1.4 times the real time for the step, 1.3 for the whole
  install [static]. Every logged `progress: step 1` line ends with the round's values in brackets
  (copy and backup MiB so far, their own times left, the estimate before `steady()`)

## Endings and power

- The mixer has no soft power-off, only the switch on the back [device]. `poweroff -f` turns screen
  and system off but leaves the button lights on (the GD32 side keeps power), which looks half off.
  So every ending (done, cancelled, failed, no touch) writes dmesg, syncs, releases the card and
  shows "Safe to power off" in large letters (yellow "Wait 10 s, then power off" if the card could
  not be released). The saved `screen-N.png` is taken before the card is released, so it always
  shows "Safe to power off"
- A 45-minute safety timer (`sync; poweroff -f`) covers a hang before anything is written; it is
  stopped before the first write, so it never fires while the card is written. A hang during writes
  says "pull the card": without a bootloader the card cannot boot, stock starts

## Package and image (`install/release/`)

The whole package is one initramfs: U-Boot loads a single file and everything is in RAM before the
card is touched; `/init` checks it against the inner manifest.

```
dlzmod-vX.Y.Z/
  initrd.cpio.gz    /init, /bin/busybox (pinned Debian busybox-static), /dev/console, and /pkg:
                      VERSION         read by modversion.py as mod/../VERSION
                      package.env     version, model, evolve-node build, flags, build time, commit
                      mod/            card-core.sh and its helpers (check-rootfs.sh, cpio-replace.py,
                                      patch.py, modversion.py, mkvisuals.sh, logobbox.py,
                                      bootsplash.py, app-mod/, server-mod/, sd-system/)
                      layers/         marker.png, splash.png, layout.env (mklayers.py)
                      ui/             ui.py, glyphs.bin (mkglyphs.py: DejaVu Sans Mono, 4 sizes)
                      manifest        sha256 of every file under /pkg
  package.env       copy of /pkg/package.env (readable without unpacking)
  manifest          sha256 of initrd.cpio.gz and package.env: pins everything inside
dlzmod-vX.Y.Z*.tar.sig  ed25519 signature over the whole tar, dev key or release key (#11,
                    updates.md "Signing keys")
```

The installer image (`mkinstaller.sh`): Debian U-Boot at 8 KiB, MBR, a 64 MiB FAT32 partition with
`boot.scr` (`install/installer/boot.txt`), `uboot.env` (`mkenv.py`: SD only, no delay, no input)
and the package directory. Pinned downloads (`vendor.sh`, sha256 as in Debian's Packages index):
`u-boot-sunxi` 2025.01-3+deb13u1 (Banana Pi M2 Ultra build: same R40 and DRAM setup) and
`busybox-static` 1.37.0-6+b9. Reproducible with `SOURCE_DATE_EPOCH` (default: the last commit time):
the package `.tar` is byte-identical across builds; the image's FAT entries carry the build time, so
each release publishes the image's sha256. `RELEASE=1` refuses a tree with changes; the image takes
its boot route (`boot.txt`, `mkscr`/`mkenv`/`mksdimg`, the safe U-Boot) from the tree at image time,
so `mkinstaller.sh` builds a release package's image only from a clean tree at the package's
`COMMIT`.

**Safe U-Boot** (`uboot-safe.py`, same-length patches, both uImage CRCs recalculated, the result
pinned by sha256; 48 bytes differ from Debian's binary):
- Built-in defaults: U-Boot reads `uboot.env` from the card, but a card whose FAT cannot be read
  falls back to its defaults, which would try the eMMC next with the Banana Pi device tree and start
  USB on the Banana Pi's power pin. Patched: `boot_targets=mmc0` (SD only; nothing bootable = a
  prompt without input devices, pull the card) and `preboot=echo safe`
- Built-in device tree: the Banana Pi's GMAC `/soc/ethernet@1c50000` is `okay`, and U-Boot's network
  start probes it: PA0-PA16 muxed to the GMAC (on Mackie's board PA13 enables USB0 power, the GMAC is
  disabled, the other PA pins' wiring is unknown) [static, U-Boot v2025.01 source]. Patched to
  `fail`: U-Boot binds only `okay` nodes, so the GMAC, its MDIO and PHY are never probed ("No
  ethernet found." on the console). `uboot-safe.py` walks the FDT and refuses any other change
- What it still does, as stock: the SPL sets the same AXP221 rails and DRAM settings as Mackie's own
  `mackie-evolve-a1_defconfig` (DCDC2 1.1 V, raised by Linux; `dc1sw` on with DCDC1, switched off by
  Linux ~30 s after boot) [static]; the SPL is byte-identical to Debian's. Not as stock, accepted: it
  sets up the SDIO controller `mmc@1c10000` on PG0-PG5 (disabled in Mackie's tree, nothing else uses
  those pins there; patching it sits among the MMC devices the boot needs)
- Accepted: the SPL does not check U-Boot's CRC (a damaged card hangs, never writes), so flashing
  must verify (Etcher does by default); U-Boot's own `poweroff` (only on a load failure in
  `boot.txt`) is unproven on this board
- Only the installer card runs this U-Boot; an installed card boots Mackie's own bootloader

**eMMC protection, in layers:** `/init` locks the eMMC and its boot areas read-only before anything
mounts it (`blockdev --setro`); the rootfs mounts `ro,noload` (ext4 skips orphan cleanup only on a
read-only device); the copy reads through a read-only loop and a snapshot. The kernel lock alone is
advisory in 5.10 for writes from inside the kernel ("Trying to write to read-only block-device" only
warns) [static], so every run's dmesg is checked for that line and "EXT4-fs error".

## Device runs

On a SanDisk Ultra 128 GB (A1, U1) in an XS, times from the first write [device]:

| Install | Total | Copy (and backup) | Compare (and backup check) | Build |
|---|---|---|---|---|
| Current | **526 s** | **277 s** for 2322 MiB in use, 978 MiB backup | **210 s** | 38 s |

The same installer on a Gigastone 4K UHD Video 64 GB (U3) [device]: 553 s in all, the copy 302 s
(+9 %), the compare 212 s: writing is a little slower, reading the same. The installs before the
current one ran on the SanDisk only (the timings below).

What the time depends on:
- Copying only the blocks in use (#49): the whole p1 (7293 MiB) took 555 s for the copy and 931 s
  in all, and 1262 s with the backup. Reading the eMMC alone runs at 44 MB/s (7297 MiB in 167 s)
- Cheap progress rounds: rounds that started 20+ processes each took ~17 s per round and slowed the
  copy to 468 s; with one awk per round a screen comes every ~2 s (135 during the copy)
- Two bugs only the device showed, both at step 3: the busybox chroot applets and the missing
  `/dev/fd` (design decision 2)
- After every install: card gate passed, eMMC and boot0/boot1 read-only, no file system or I/O
  errors; stock boots with the card pulled. The backup unpacks to the eMMC's exact size
- First boot: DLZDATA grows to the card (112 GB here); `dlzmod-grow-data` checks it once and then
  leaves a marker: 1.46 s on the first boot, 0.22 s after, the mixer software starting 1.2 s
  earlier
- Seen, harmless: `set_cpus_allowed_ptr: core 4 is set in the mask` stack dumps from `kblockd`
  (vendor kernel, also in stock boots); "Free blocks count wrong / FILE SYSTEM WAS MODIFIED" is the
  journal replay on the copy

## Rules for the code

- Never rely on `set -e` inside a subshell or function whose status is tested (bash ignores it
  there: a failing step carried on and reported "installed")
- Every function defined before any line uses it (a call before its definition is "command not
  found" and the script carries on; `tests/update-checks.sh` checks this statically for the updater)
- busybox: every variable in a sh function is global; `wc -c` reads the whole file; no background
  jobs in the copy (a qemu-user signal race once crashed the emulated busybox)
- No apostrophes inside the awk programs of `install-card.sh`: they sit in single quotes

## Accepted limits

- A power cut during the first boot's `mkfs.vfat` leaves p2 without the DLZDATA label; later boots
  skip it. Recovery: install again
- A power cut while sectors 1-16 are written could corrupt earlier pages of the same erase block on
  MLC/TLC cards: the card may hang at boot; pulling it gives stock
- On a mod card a failed `dlzmod-emmc-ro` does not stop the boot (stock `server.js` skips
  `mmcblk1*` by name)
- No thermal or cpufreq driver in the installer (the stock system has no working cpufreq either)
- The card's build stamp is 1970 when the installer builds it (no clock at boot); nothing reads it
- One backup file, so an eMMC over 4 GiB of compressed data would fail cleanly (the XS: 978 MiB)

## Open points

- Final screens with many lines drop content line by line from the top; the "Nothing was
  written..." paragraph should get priority over check lines
- `dlzmod-emmc-ro` runs once: a udev rule locking any MMC disk on add would close a late-probe gap
  [guess]
- The card's MBR disk id is the eMMC's (`by-partuuid` names collide; nothing mounts by PARTUUID):
  `sfdisk --disk-id` would fix it
- An update mode in the installer (package check at boot, Install / Later / Revert, boot counter)
  is replaced for v0.1.0 by the drop-in update ([updates.md](updates.md), "Drop-in update")
