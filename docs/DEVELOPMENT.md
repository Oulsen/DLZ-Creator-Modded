# Developing DLZ Creator Modded

Reverse engineering and modding the Mackie DLZ Creator and DLZ Creator XS, booting from microSD so
the internal eMMC firmware stays untouched. Both models run one firmware; the factory marks an XS
with an empty `/root/.dlzlite`, which switches the UI, the audio graph and the GD32/FPGA firmware to
the XS ([notes/architecture.md](../notes/architecture.md), "One firmware, two products"). Our dump
and test mixer are an XS. For users: [README.md](../README.md).

## How it works

The DLZ runs Linux on an Allwinner A40i (R40 family). The chip's boot ROM tries the microSD
slot before the internal eMMC, so a card with a bootloader at 8 KiB takes over the boot.
Card out = stock Mackie firmware.

U-Boot used: Debian `u-boot-sunxi` 2025.01-3+deb13u1, `Bananapi_M2_Ultra` build (the DLZ board
is derived from the Banana Pi M2 Ultra, DRAM settings work as-is).

## Getting started

Everything in git is enough to start: Mackie's software comes from your own mixer, through the
backup the installer makes.

**What you need**

- A DLZ Creator XS or DLZ Creator on firmware 1.2.0 build 1731 (Settings → About), a microSD card of
  16 GB or more and a card reader
- Windows with Git Bash, Node.js 18 or later (the UI sandbox and the app and server mods' unit tests) and
  Chrome (sandbox screenshots; another Chromium with `CHROME=<path>`)
- WSL 2 with the distro **Ubuntu** (Docker Desktop's `docker-desktop` distro can be the default:
  always pass `-d Ubuntu`), with:

  ```bash
  apt install python3 python3-pil fonts-dejavu-core qemu-user qemu-user-static binfmt-support \
    cpio zstd dosfstools mtools e2fsprogs fdisk openssl curl ffmpeg
  ```

- For the release build only: Docker Desktop (`winget install Docker.DockerDesktop`) with WSL
  integration for **Ubuntu** (Settings → Resources → WSL integration). It need not start with
  Windows ("Start Docker Desktop when you sign in" off): start it before a release build. The build
  runs in the pinned build environment (`install/release/buildenv/`), the same as GitHub's

- About 30 GB free in WSL: the dump is 7.8 GB, a card image as much again, and the tests keep
  cached cards (`tests/rig.sh clean` frees them)
- From Git Bash, set `MSYS_NO_PATHCONV=1` for WSL calls, or `/mnt/...` paths get mangled

**First steps**

1. **Get the dump.** Install the mod on the mixer ([INSTALL.md](INSTALL.md)). The card's `DLZDATA`
   part holds `dlzmod-backup/emmc-user.img.zst`, the mixer's internal storage as read during the
   install. In WSL: `mkdir -p /root/dlz && zstd -d <copy>/emmc-user.img.zst -o /root/dlz/orig.img`.
   It unpacks to the eMMC's user area byte for byte. A mixer on other firmware gets the same backup
   from the installer (`DLZDUMP/backup-N/`), for analysis only. Without the installer, the dumper
   card below makes it too.
2. **Mount it read-only**: `wsl -d Ubuntu -u root -e bash install/mount-ro.sh` (repo root) gives
   `/mnt/dlz`. An idle WSL drops the mount: keep `wsl -d Ubuntu -u root -e sleep 7000` running.
3. **Run the tests that need no mixer**: `node install/server-mod/test-dlzmod-server.js` and
   `node install/app-mod/test-dlzmod.js` (Windows),
   `bash tests/guards.sh`, `bash tests/cardcheck.sh` and `bash tests/patches.sh` (WSL, as root),
   `tests/update-checks.sh` (as a normal user: in WSL as `nobody`, see tests/README.md); the rest,
   and which to run for which change: [tests/README.md](../tests/README.md). GitHub runs the unit
   tests, `guards.sh`, `update-checks.sh`, the `mixer-ssh` skill's read-only guard
   (`test-guard.sh`) and a syntax check of every script on each push and pull request
   (`.github/workflows/checks.yml`).
4. **Look at the UI on the PC**: `bash dev/ui-sandbox.sh` (Git Bash) serves the mixer's UI with the
   mod at http://127.0.0.1/ (the first start copies `/srv` from the mount). Always stop it with
   `bash .claude/skills/ui-sandbox/sandbox.sh stop`: it leaves Node on ports 80/89
   otherwise. Details: [notes/modding-guide.md](../notes/modding-guide.md), "PC sandbox".
5. **Make your own dev key** (Git Bash): `bash install/release/mkkeys.sh ~/.dlzmod-keys dev` writes
   `dev.pem` and `dev.pub` into that folder, outside the repo. Set `DLZMOD_SIGNING_KEYS` to it (from
   WSL: `/mnt/c/Users/<you>/.dlzmod-keys`) for every build: packages are signed with your key, and
   cards built with it trust your key, so drop-in updates of your own builds work. A card keeps the
   keys it was built with for life: one built before (or with another key) needs a new install or
   card first.
6. **Build a card** ("Build a modded SD system" below) or a package and the installer around it
   (`install/release/mkpackage.sh`, then `mkinstaller.sh`). Before anything new runs on a mixer, read
   the ground rules and brick risks in [notes/modding-guide.md](../notes/modding-guide.md).

Then read [notes/architecture.md](../notes/architecture.md) and the modding guide; how the work is
organised: "GitHub workflow" below and [CONTRIBUTING.md](../CONTRIBUTING.md).

## Layout

| Path | Contents |
|---|---|
| `install/` | Everything to install the mod: the dumper (`install/dumper/`) and the card build |
| `dev/` | Tools for developing mods on a PC |
| `tests/` | PC rehearsals of the install, the update and the safety checks, with the mixer's own programs under qemu: [tests/README.md](../tests/README.md) |
| `notes/` | Knowledge base, see below |
| `vendor/` | Third-party U-Boot, downloaded in Setup (git-ignored) |
| `build/` | Generated images/scripts (git-ignored) |
| `dumps/` | Data read from the device (git-ignored, never share) |
| `.github/` | Issue templates (bug, feature, help with an install), the pull request template, `CODEOWNERS` (who reviews) and the checks GitHub runs on every push and pull request (`workflows/checks.yml`: unit tests, key guards, updater checks, the SSH skill's read-only guard, the release notes and their Discord message, script syntax), the draft release a version tag makes, with the release files built and signed (`workflows/release.yml`, "Releases" step 5) and the message in Discord when a release is published (`workflows/announce.yml`) |
| `.claude/skills/` | Workflows for Claude Code: the device review, the UI sandbox, SSH to your mixer, the release build |

## Notes

| File | Contents |
|---|---|
| `CHANGELOG.md` | Plain-language changelog: each PR that finishes a milestone issue adds its bullet. The roadmap is on GitHub: [issues](https://github.com/Oulsen/DLZ-Creator-Modded/issues) and the [board](https://github.com/users/Oulsen/projects/2) |
| `notes/architecture.md` | Processes, IPC, message protocol, data model: start here |
| `notes/system.md` | OS layer: boot, network, ports, security, persistence, package ownership |
| `notes/components/` | One page per component: Node backend, glesgui, dspserver, mixer graph, faderlink, firmware update |
| `notes/modding-guide.md` | Ground rules, brick risks, hook points, what is not possible, mod recipe, dev loop, pitfalls |
| `notes/mod.md` | What the mod changes on the card: units and guards, patches, mod settings, Wi-Fi and SSH, the card gate |
| `notes/updates.md` | Release files, the drop-in update and its sandbox, versions and channels, signing keys, update paths not built yet |
| `notes/hardware.md` | Hardware, device tree, boot chain, eMMC layout, SD slot |
| `notes/open-questions.md` | What still needs the live device |
| `notes/installer.md` | The on-device installer: boot route, design decisions, copy and compare, safe U-Boot, device runs |

## Project choices

- **Name** DLZ Creator Modded (also the name of its Settings page); repo
  `github.com/Oulsen/DLZ-Creator-Modded`, shown on the Mod page.
- **License: GPL-3.0** for our own code, notes and artwork: forks stay open, and it fits the GPL
  U-Boot and busybox on the installer card. Mackie's software is not covered, because it is not
  distributed: every card is built on its own mixer from that mixer's eMMC.
- **The installer runs on the mixer**, with Mackie's own kernel and device tree loaded from the eMMC:
  screen, touch, backlight and PMIC behave exactly as in a stock boot, with no device tree of our own
  and no Mackie code in the download ([notes/installer.md](../notes/installer.md)).
- **Versions**: the first public release is v0.1.0; development builds are `vX.Y.Z-dev-<commit>`.
  Bump rules, release candidates and channels: [notes/updates.md](../notes/updates.md).

## Rules for notes and code

The repo is public, so what goes into it is limited by what the project may publish:

- **No Mackie code**: notes describe how Mackie's software behaves and point to it (file, function,
  search string); they never paste it. Names, paths, settings, message fields and `patch.py`'s
  anchors (the strings a patch looks for) are fine. Why this is enough: the project studies its own
  copy of the software to make it work with its own changes (EU Software Directive, art. 5(3)), and
  functionality and data formats are not protected (CJEU C-406/10, SAS Institute); it ships no
  Mackie code and claims nothing beyond that.
- **Nothing from a dump**: no Mackie binaries, dumps or `.upd` files in git (`dumps/`, `build/` and
  `vendor/` are git-ignored); no secrets from a dump in notes, issues or output (password hashes,
  SSH keys, Wi-Fi credentials, the System Lock PIN, personal data): presence only.
- **Confidence tags** on every observation: **[device]** (seen on a mixer), **[static]** (read from
  the firmware or the dump), **[guess]**. A fact that gets verified changes its tag in the note.
- **Notes describe the current state**, not a diary: no dates, no "who decided"; a decision is the
  rule plus its reason. History lives in git, the issues and `CHANGELOG.md`.

## Tools

### `install/dumper/`: make the eMMC backup

| Tool | Runs on | Purpose |
|---|---|---|
| `stage2-backup.txt` | U-Boot | Full eMMC user-area backup in 64 MiB chunks (not the boot areas boot0/boot1, like the installer's backup); backlight toggles per chunk, powers off when done. Only reads the eMMC, writes to the SD card |
| `mkscr.py` | any | Plain-text U-Boot script -> `boot.scr` |
| `mksdimg.py` | any | Dumper card image: U-Boot at 8 KiB + empty FAT32 partition |
| `mkenv.py` | any | `uboot.env` for our cards: U-Boot's default environment with overrides (`boot_targets=mmc0`: never boot the eMMC) |

### `install/`: build the modded card

| Tool | Runs on | Purpose |
|---|---|---|
| `bootsplash.py` | any (PNG frames: Pillow) | Unpack / pack kernel bootsplash files (byte-exact roundtrip); `--raw` frames need no Pillow |
| `mklayers.py` | WSL | Layout of the boot visuals (MODDED sticker, status lines, logo position; no version, #97); renders our layers (no Mackie logo) as RGBA PNGs + `layout.env` |
| `logobbox.py` | WSL / device | Find Mackie's logo in the device's own `/etc/dlz.png` (stdlib + ffmpeg) |
| `mkvisuals.sh` | WSL / device | Compose `/etc/dlz.png` and the kernel bootsplash from the device's originals + our layers (ffmpeg) |
| `modversion.py` | any | Reads and checks the mod version from `VERSION` (`v0.1.0` .. `v9.99.99`) |
| `build-sd.sh` | WSL (root) | Clone a dump into an SD-bootable image: checks the dump, copies it, renders the layers, then runs `card-core.sh` |
| `release/mkpackage.sh` | build environment / WSL (root) | Build the release package `build/release/dlzmod-vX.Y.Z.tar`: one initramfs with the installer, `card-core.sh` and helpers, layers and screens, checked by an inner manifest; signed into `.tar.sig` (ed25519 over the whole tar: dev key, `RELEASE=1` release key, `RELEASE_KEY=release2` the spare; `DLZMOD_SIGNING_KEYS` = folder with the private keys, passphrase asked once or `DLZMOD_SIGNING_PASS`). Uncommitted changes, or `UNSIGNED=1`: not signed |
| `release/mkkeys.sh` | Git Bash / WSL | Make a signing key pair (`release`, the offline spare `release2`, or `dev`; release keys passphrase-encrypted): private key into a folder outside the repo, public key into `keys/`. Never overwrites: cards trust the keys they were installed with for good |
| `keys/` | - | Public keys of the update signatures; `card-core.sh` puts `release.pub` and `release2.pub` on every card, and a dev key on cards built from a dev package or `build-sd.sh` (your own `dev.pub` from `DLZMOD_SIGNING_KEYS`, else `keys/dev.pub`); `keys/withdrawn` (only after a leak, #63): withdrawn keys, `release` or `dev`, in every package's `WITHDRAWN` from then on, and on cards from `build-sd.sh` |
| `release/reinstall-below` | - | The first version every card must have been installed with (a full install, v0.3.0 now): `mkpackage.sh` writes it as `REINSTALL_BELOW` with `REINSTALL=yes`, so older cards refuse the package as a drop-in ([notes/updates.md](../notes/updates.md), "Drop-in update") |
| `release/mkinstaller.sh` | build environment / WSL | Build the flashable installer image around a package (`--dry-run`: writes nothing on the device); the FAT is made and filled inside the image file (dosfstools, mtools: no loop device, mount or root). Development builds are named `-dev-<commit>`; `RELEASE=1` (clean tree only) gives the release name |
| `release/buildenv/`, `release/buildenv.sh` | WSL (Docker Desktop) / GitHub | The pinned build environment of the release files (Debian trixie by digest, every package from one snapshot.debian.org moment) and the wrapper that runs a command in it with the repo at `/src`: the PC and the tag's workflow build in the same image, so the same commit gives the same bytes |
| `release/ci-build.sh` | GitHub | The tag's release build (`workflows/release.yml`): `RELEASE=1` package and installer image in the build environment, signed with the release key from the protected environment `release` (a test tag: unsigned), `SHA256SUMS`, and the files the draft gets (`attach.txt`: the update file only when a card can take it as a drop-in) |
| `release/build-release.cmd` | Windows (double-click) | The PC's release build in one step, in the build environment: the `RELEASE=1` package unsigned (`UNSIGNED=1`, no key on the PC) and the installer image around it, to test on the mixer and compare with GitHub's build of the same commit; then a dev image of that commit (dev key from `%USERPROFILE%\.dlzmod-keys`, or `DLZMOD_KEYS_WIN`) |
| `release/vendor.sh`, `release/uboot-safe.py`, `release/mkglyphs.py`, `release/mklogo.py`, `release/fat-fixtimes.py` | WSL | Pinned U-Boot/busybox downloads (Debian sha256); U-Boot's built-in defaults made safe (SD card only, no USB, the Banana Pi's Ethernet switched off in its device tree); font atlas for the installer screens; the MODDED sticker with the version for the installer screens; the installer image's FAT file times set to `SOURCE_DATE_EPOCH` (same package, same image) |
| `installer/` | device | Installer U-Boot script (`boot.txt`), `/init` (checks, eMMC lock, accept screen, dry run, real install), `install-card.sh` (the write steps: `DLZDATA` first at the full card size, copy and compare with the eMMC backup made from the same read (`DLZDATA/dlzmod-backup/`), new UUID, partition table, `card-core.sh`, bootloader last; on a failure before `DLZDATA` exists, a small `DLZLOG` partition with the log) `ui.py` (screens and touch, stdlib only), busybox applet list, and for a mixer the mod does not support `probe.sh` (hardware report; the backup for analysis on other firmware, eMMC user area only, onto a `DLZDUMP` partition) with `boards.txt` (the bootloaders the backup is offered for) |
| `card-core.sh` | WSL (root) / device | Finishes a card (shared with the on-device installer): checks that every tool and mod file is there before writing, refuses any target but a loop device or an SD card, and a card whose model differs from the source's (`DLZMOD_MODEL`), then new rootfs UUID, the mixer the card is bound to (`DLZMOD_MIXER_ID`: sha256 of the eMMC's CID from the installer, `any` from `build-sd.sh`), `DLZDATA` partition (or the installer's, `DLZDATA_KEEP=1`), brick guards, boot visuals, UI and server mods (`apply-mod.sh`), optional SSH key for test cards. `DLZMOD_UUID` / `SOURCE_DATE_EPOCH` make builds reproducible |
| `check-rootfs.sh` | WSL / device | Is a mounted rootfs the supported firmware (evolve-node 3297) on an XS or a full-size, with the GD32 marker of that model's firmware? Optionally: is it the expected model? |
| `cpio-replace.py` | any | Replace one file in a cpio initrd, every other entry kept byte for byte (the bootsplash) |
| `apply-mod.sh` | WSL / device | The mod's own changes to a rootfs (guards and units, app/server patches, mod defaults, Mackie's factory Wi-Fi network and SSH access removed once), shared by `card-core.sh` and the drop-in update so both apply the same files; every file written atomically and only when it differs |
| `sd-system/` | device | Installed by `card-core.sh`: eMMC read-only unit (and a udev rule that locks it whenever it appears), first-boot `DLZDATA` grower, a report of each start and the boot log for `DLZDATA/dlzmod-logs/` (copied by server.js once the start has finished), a dev card's network log (`dlzmod-netlog`, off without `dev/netlog.sh`), dspserver start guard (waits for server.js), drop-ins that run Mackie's GUI and node processes at normal instead of real-time scheduling (#140; placed by the new updater at the next start where a v0.2.0 updater left them out), drop-ins that stop GD32 flashing and Mackie updates, the card bound to its mixer (`dlzmod-cardcheck` before Mackie's FPGA loader: the flag matches the GD32 marker, both match the eMMC's own (read-only), and the eMMC's CID hash matches `/etc/dlzmod/mixer-id`, else no FPGA load, faderlink or dspserver and a red popup), the drop-in update (`dlzmod-update`: a package in `DLZDATA/dlzmod-update/` is checked and applied at startup, only with a valid signature from a key the card trusts; its steps run in a sandbox on a copy, then only allowlisted files are placed), USB Wi-Fi ids the stock driver lacks, an eject rule for Realtek sticks that start as a driver CD, and an SSH drop-in that gives each card its own host keys, slows down password guessing and starts SSH only when turned on from the screen (off again after a restart unless kept on) |
| `mount-ro.sh` | WSL (root) | Mount a dump's rootfs read-only |
| `patch.py` | any | `patch.py app <app.js>`: our UI mods (`app-mod/dlzmod.js` + anchor patches). `patch.py server <server.js>`: our server mods (`server-mod/dlzmod-server.js` + anchor patches): FORMAT SD and firmware updates refused, free and unique recording names, the update popup, Wi-Fi and SSH for the Mod page's Network panel, control from other devices only when switched on and paired with a PIN (HTTP, socket.io and port 89 on loopback; the Remote Control panel), and Mackie's file commands checked (deleting and renaming only from the mixer's own screen and paired devices, recordings only in their folders, preset folders and names checked, no shell for file names, the kept `*.orig` originals not served), recordings downloaded by paired computers (read only, nothing read while recording) and every client's recording list refreshed after a recording, rename or delete |
| `server-mod/test-dlzmod-server.js` | Node | Unit tests for the server mod: recording names, update popup, Network panel, pairing (PIN, pause, cookie, Origin, which files other devices get), file command checks, the recordings download and list refresh (`node install/server-mod/test-dlzmod-server.js`) |
| `app-mod/test-dlzmod.js` | Node | Unit tests for the app mod, with stand-ins for Mackie's UI: the recordings download, meters, the header setting and the message bar, the Mod page's tabs, Wi-Fi, SSH and Remote Control (states, passwords, the network list), the PIN pad, the update and card popups (`node install/app-mod/test-dlzmod.js`) |

### `dev/`: develop mods on a PC

| Tool | Runs on | Purpose |
|---|---|---|
| `ui-sandbox.sh` | Git Bash + Node | Run the mixer UI on this PC at http://127.0.0.1/ in the on-device layout (copy of `/srv` in `dumps/sandbox`, shell commands blocked, localhost only); `DLZ_FULLSIZE=1` shows the full-size DLZ Creator's UI from its own copy (`dumps/sandbox-full`); `DLZ_SANDBOX_REMOTE=1` makes http://localhost/ another device on the network; `DLZ_FAKE_MEDIA=sd` (`usb`, `sd,usb`) a pretend SD card / USB stick with a few recordings |
| `push.sh` | Git Bash + WSL | Build HEAD, push it over Wi-Fi to a dev card as a drop-in update, wait for the mixer to be switched off and on (`--restart`: from software, #81) and show the update's report ("Dev card" below); settings in `dev/push.env` (git-ignored, from `push.env.example`) |
| `cardkey.sh` | Git Bash | After a new install of the dev card: forget its old host key, add your SSH key with the card's SSH password, check a key login ("Dev card" below) |
| `netlog.sh` / `netlog.ps1` | Git Bash / PowerShell | A dev card's network log ("Dev card" below): `netlog.sh on` (`off`, `status`) makes the card send each start's log to this PC, `netlog.ps1` receives it into `build/device-logs/netlog-*.txt` |
| `ui-sandbox/shot.js` | Node + Chrome | Headless screenshot of the sandbox UI, optionally after taps; also as a paired other device (`DLZ_SHOT_COOKIE`) and keeping its downloads (`DLZ_SHOT_DOWNLOADS`) |
| `ui-sandbox/pair.js` | Node | Pair the sandbox's other device with the PIN, as a real one pairs; prints the token for `shot.js` |
| `ui-sandbox/fake-vu-live.js` | browser | Moving fake meter levels that follow the faders, loaded into the sandbox page by the shim (off with `/?novu`) |
| `installer-shot.py` | WSL (Pillow) | Render an installer screen (`ui.py`) as a PNG, upright, as it will look on the mixer |
| `installer-mockup.py` | WSL (Pillow) | Every screen of a real install as PNGs, an animated spinner and one overview sheet (look checks); `--no-sheet docs/images/install` renders the install guide's screens, `--check docs/images/install` says whether they are current, and fails when a progress line does not fit one row |

WSL setup: "Getting started" above.

## Setup

The installer build downloads and checks its third-party files itself (`install/release/vendor.sh`:
Debian's U-Boot and busybox, pinned sha256, a file that does not match is refused). For the dumper
card below, fetch them once by hand (WSL, repo root):

```bash
. install/release/vendor.sh && vendor_prepare vendor
# vendor/u-boot-sunxi-with-spl.bin (Debian's), vendor/u-boot-safe.bin, vendor/busybox.bin
```

## Build the dumper card

```bash
python install/dumper/mksdimg.py vendor/u-boot-safe.bin build/dlz-sdboot.img
python install/dumper/mkscr.py -n "DLZ stage2" install/dumper/stage2-backup.txt build/boot.scr
python install/dumper/mkenv.py vendor/u-boot-safe.bin build/uboot.env boot_targets=mmc0 \
  "bootcmd=run distro_bootcmd; poweroff" bootdelay=-2 preboot= stdin=serial
```

Both use the safe U-Boot, as the installer image does (`notes/installer.md`, "Safe U-Boot"): its
built-in defaults never boot the eMMC, never start USB and never probe the network, also when
`uboot.env` is missing or its FAT cannot be read.

## Prepare a card

1. Flash `build/dlz-sdboot.img` with balenaEtcher.
2. Format the 16 GiB partition as FAT32 (formatting does not touch the bootloader).
3. Copy `build/boot.scr` and `build/uboot.env` to the card root. `uboot.env` stops U-Boot from
   waiting at a prompt (no autoboot delay, no USB keyboard) and powers the mixer off when `boot.scr`
   fails; without it, a missing or failing `boot.scr` leaves U-Boot at a prompt with no input: pull
   the card.

The mixer writes the user area as `emmc_<block>.bin` (the start block in hex: 64 MiB chunks, then
1 MiB for the tail) and powers off when done (`done2.txt`). Like the installer's backup, it skips the
boot areas boot0/boot1: they are empty on the XS, and selecting them is a write to the eMMC's EXT_CSD
register (`notes/installer.md`). Join the user area in block order (WSL, in a copy of the card's
files):

```bash
for h in $(ls emmc_*.bin | sed 's/^emmc_//; s/\.bin$//' | while read h; do echo $((16#$h)) $h; done \
  | sort -n | cut -d' ' -f2); do cat emmc_$h.bin; done > /root/dlz/orig.img
```

## Build a modded SD system (WSL, as root)

```bash
B=/mnt/c/path/to/DLZ-Creator-Modded              # this repo, as seen from WSL
export DLZMOD_SIGNING_KEYS=/mnt/c/Users/<you>/.dlzmod-keys   # your dev key ("Getting started")
bash $B/install/build-sd.sh /root/dlz/orig.img $B/build/dlz-sd-$(cat $B/VERSION).img
```

The build only accepts the firmware the patches are made for (DLZ Creator or XS, evolve-node 3297 =
firmware 1.2.0 build 1731, with the GD32 marker of its model) and stops before copying anything
else. Before writing to the image it checks that every tool and mod file it needs is there; a failed
build deletes the half-built image.
`DLZMOD_UUID=<uuid> SOURCE_DATE_EPOCH=<seconds>` make two builds of the same dump identical. It generates the boot visuals
from the image's own originals and applies the UI mods; the
version shown in Settings (and on the installer's screens) comes from `VERSION` (bumped in `develop`
right after a release: "Version bump" below). Flash `build/dlz-sd-vX.Y.Z.img` with balenaEtcher (re-select the file
after a rebuild, and never rebuild while a flash is running; cancel Windows' format prompt). Card out = stock firmware. Power off before pulling the card.

### SSH key (optional, test cards only)

Key-based root login, with SSH on from the first start and after every restart. The key is baked
into the image, so this is for test cards; installed cards turn SSH on on the mixer (Settings, DLZ
Creator Modded, Network), where Wi-Fi is set up too (a USB Wi-Fi stick: tested with the TP-Link
Archer T3U, driver `88x2bu` from the stock kernel). Keep the config outside the repo:

```bash
cp $B/install/sd.env.example /root/dlz/sd.env && chmod 600 /root/dlz/sd.env   # fill it in
SDCONF=/root/dlz/sd.env bash $B/install/build-sd.sh /root/dlz/orig.img $B/build/dlz-sd-dev.img
ssh root@mackie-dlz-creator-xs.local   # an XS's name on the network
```

## Dev card: test builds over Wi-Fi

A card that takes new builds of the mod without leaving the mixer: build, push, switch off and on, test.
The push only puts the package and its signature in `DLZDATA/dlzmod-update/`, so every build goes
through the same signature check and sandbox as a user's drop-in update (`notes/updates.md`). It
also writes the approval that the screen's **Install** would (#65, over root SSH), so the next start
installs it without the question.

**Once per card.** A card trusts the keys it was installed with for life, and a card from the
release image trusts only the release keys: use a second microSD for development.

1. Install it from a dev installer image (`install/release/mkpackage.sh` and `mkinstaller.sh`,
   without `RELEASE=1`, with your own `DLZMOD_SIGNING_KEYS`), or build it with `build-sd.sh` and an
   SSH key in `sd.env` (above).
2. On the mixer's screen (Settings, DLZ Creator Modded, Network): connect Wi-Fi, turn SSH on with
   "Keep on after a restart".
3. Make a key only for the dev card, without a passphrase (Git Bash, once):
   `ssh-keygen -t ed25519 -N '' -C dlz-dev-card -f ~/.ssh/dlz-dev`. Without a passphrase `push.sh`
   and the `mixer-ssh` skill (`dlz-ssh.sh key`) log in unattended, also from Claude Code; the file
   gives root on the dev card, so it stays on your PC and the card is a development card only.
4. `cp dev/push.env.example dev/push.env` and fill in the mixer's address and your key. The script
   never asks for anything: a key with a passphrase goes into `ssh-agent` first, and the dev key is
   used as `mkkeys.sh` makes it (without a passphrase).
5. Put the key on the card: `bash dev/cardkey.sh`, in your own Git Bash window (it asks for a
   password, so not through Claude Code). It forgets the old card's host key
   (`~/.ssh/known_hosts` and `push.sh`'s own list), shows the new one, asks once for the SSH password
   from step 2 and adds the key (logging in with the password only: the mixer allows 3 tries, and an
   SSH agent with several keys uses them up before it), then checks a key login. **After every new
   install from an installer image, again steps 2 and 5**: the image carries no SSH key and each
   install makes new host keys, so `push.sh` stops with a changed host key until then. Not needed
   for a `build-sd.sh` card with an SSH key.

**The loop** (Git Bash, repo root). Start the network log listener first (`dev/netlog.ps1`, "A start
that hangs" below) and keep it open for the whole session: the floor of each start, the install and
the timings arrive without a login, a start that hangs still leaves its log, and logins may come 30 s
after the screen instead of a blind 90 s. The card sends to one PC, the last one that ran
`bash dev/netlog.sh on`: on another PC (laptop, desktop) run it again there, and allow the port in
that PC's firewall once.

```bash
git commit -m "WIP ..."   # only a committed tree is signed; WIP commits disappear in the squash merge
bash dev/push.sh          # build in WSL, check, copy; switch the mixer off and on; it prints update-N-<version>.txt
```

Every push needs a new start of the mixer: not during a recording. `push.sh` asks for it and waits:
switch it off and on with the switch on the back. `--restart` restarts it from software instead
(before #140 that often hung on the loading screen; 10 of 10 went through since, #81). Before that, `push.sh` checks the
package the way the card will: the signature against the card's own `dev.pub` (a release card, or
one built with another dev key, stops here), `CHANNEL=dev`, no full install needed (`REINSTALL=no`,
or `REINSTALL_BELOW` and a card at that version with an updater that knows it), not older than the
card's version, and not a file the card refused before. The mixer software keeps DLZDATA mounted
read-only and writable only while it records: `push.sh` stops when it finds it writable, else makes
it writable for the copy and read-only again after it. Earlier packages in `dlzmod-update/` are
removed (more than one is never installed). It logs in to the new start only once it has settled
(with the network log: 30 s after the screen is up; without: 90 s after the mixer has gone away; see
below), then waits for the updater's report, prints it and says from the report whether the package was installed. Packages
stay in `build/push/`.

**A start that hangs** (#81) often never gets its last seconds onto the card. The dev card can send
each start's log to the PC as it happens (`dlzmod-netlog`, from the build that brings it):

```bash
bash dev/netlog.sh on       # once: the card sends to this PC (the address it sees over SSH), port 5140
```

```powershell
powershell -ExecutionPolicy Bypass -File dev/netlog.ps1   # leave it open while the mixer starts
```

It writes `build/device-logs/netlog-<date>-<time>.txt`, with a marker line at each start. It starts
sending once Wi-Fi is up (~15-25 s), then everything since power-on; now and then lines of that burst
get lost (2 starts in 10 lost their first ~30 s: the marker then comes where the uptime goes back). Nothing arrives: allow UDP 5140
in Windows Firewall once (the command is at the top of `netlog.ps1`). `bash dev/netlog.sh off` stops it.
Read logs there rather than over SSH: no login while a start settles (logins then coincided with
hangs). The `mixer-ssh` wrapper and `push.sh` go by the newest network log: a login 30 s after the
screen is up (at 25-33 s), or 300 s into a start whose screen does not come; `push.sh` without a
network log logs in 90 s after the mixer has gone away. From a worktree, point them at the main
checkout's log: `DLZ_NETLOG_DIR=<repo>/build/device-logs`.

**Back to an older build** of the same version (bisecting): equal versions install, so check out
the older commit and push again, or push its package from before: `bash dev/push.sh
build/push/dlzmod-v0.2.0-dev-<commit>.tar`. A refused file is not tried again; a new build is a new
file.

Not covered: changes that need a full install (guards, the updater's gates and allowlist, boot
visuals, the card layout: `install/release/reinstall-below`, [notes/updates.md](../notes/updates.md),
"Drop-in update"); the dev card then gets one fresh install from a dev installer image of that
version, and takes the next builds as drop-ins again. Each pushed build is a build on the mixer: `device-review` at the tier
the change asks for. The release gate stays: a release candidate still gets a fresh install from
the installer image and an update from a card running the previous release.

## GitHub workflow

The roadmap is the issues on GitHub and the board
([project 2](https://github.com/users/Oulsen/projects/2)). Notes hold the lasting knowledge; an
issue's technical notes point to the note section instead of copying it.

- **Issue titles** in plain language, with a type prefix: `(DLZ FEATURE)` something the mod lets
  the mixer do, `(DLZ BUG)` stock Mackie behaviour, `(MOD FEATURE)` the mod itself (install, updates, safety,
  support), `(MOD BUG)` caused by the mod, `(DEV)` our own tools (tests, reviews, the dev card, build
  and release scripts, CI; features and bugs alike, never in the changelog: an owner sees no
  difference), `(ANALYSIS) ...?` an idea that first needs
  research, phrased as a question (it ends in a decision, and a feature issue if yes). New feature
  requests start as `(DLZ FEATURE)`; triage corrects the prefix.
- **Bugs vs. unfinished work**: a defect in what the release being worked on brings (not shipped
  yet) is simply fixed, without an issue. A defect in a released version gets a `MOD BUG` issue,
  never a reopen, so each issue stays in the changelog of the version it shipped in. Stock behaviour
  gets a `DLZ BUG` issue whenever it is found.
- **Labels**: the type, matching the title prefix (`dlz-feature`, `dlz-bug`, `mod-feature`, `mod-bug`,
  `dev`, `analysis`); `roadmap` (our own plan, puts the issue on the board); `needs-info` (waiting for
  information from outside); `release` (release chores, never in the changelog); `triage` (a new
  community report, not looked at yet). Progress is not a label but the board's Status.
- **Milestones are versions** (`v0.1.0`, `v0.2.0`, ...), plus `Later` for planned work without a
  version; an issue moves to a version milestone once it is planned. A version fixes and adds: a
  headline feature with one or two bug fixes, maybe a mod item or an analysis alongside, and at most
  one change that needs the heaviest device review (a new write path or boot route). Small and
  confined (3-5 issues) is fine, up to 10 when needed; more than 10 is a reason to consider
  splitting it. Each milestone's description says in plain words what the version brings.
- **Issue body**: "What's wrong" / "What it adds" (plain, changelog tone), "Done when" (checklist,
  tested), "Technical notes" (short: approach, risk, device-review tier, pointer to the notes; long
  work details in a collapsed `<details>` block), "Related". The note rules above apply.
- **Life cycle** (board Status):

  ```
  Todo ──planned for the next version──> Next Version ──work starts──> In progress
  ──PR merged (Refs #N), issue closed──> Fixed in develop ──release on main──> Released
  ```

  "Next Version" holds the next milestone's issues that have not started; after a release the
  following milestone's issues move into it. The fast tests run before the PR; the mixer test (a
  drop-in of the PR branch on the dev card, `dev/push.sh`) comes after the review and the device
  review, before the merge ("On the mixer before the merge" below). What can only be seen later (an install log on the next
  install) is noted in the issue's "Done when" and checked at the release ("Releases", step 4).
  After the merge the issue is closed by hand with "Fixed in develop, comes with vX.Y.Z." and its
  card goes to "Fixed in develop", so the milestone's progress shows what is done; "Fixed in develop" = in `develop`, not on `main` yet, "Released" =
  on `main`. Work PRs say `Refs #N`: `develop` is not the default branch, so `Fixes #N` would do
  nothing there. The board's "Item closed" workflow is off (it would move a closed card past "Fixed
  in develop").
- **Branches**: `develop` for work and tests, `main` for releases only. Nothing is committed to
  either directly: every change gets its own branch from `develop` (`fix/...`, `feature/...`,
  `docs/...`) and a PR into `develop`, **squash-merged** (one commit per change).
- **Review**: every PR into `develop` gets a review before it is merged, also a small one that only
  changes docs. A contributor's PR: the maintainer reviews it (`.github/CODEOWNERS` requests that
  once the repo is public; a ruleset makes it required). The maintainer's own PRs: right after the
  PR opens, the maintainer runs one review pass by an AI reviewer on the opened PR (`/cr`, the
  Claude Code review command, its reviewer on Sonnet), so the whole diff that will be merged is
  read (bugs, failure paths, what the tests cannot see). A docs-only PR gets no reviewer agent:
  Claude reads it itself for consistency with the other docs and correctness. Findings are fixed as
  new commits on the PR, or named in the PR description as accepted, before the merge; Claude
  checks the fixes itself, without a second reviewer pass. Reviews are kept lean on purpose (a Pro
  plan's usage).
- **On the mixer before the merge**: only for a PR that changes the mod or anything else that runs
  on the mixer (the app or server mod, `patch.py`, units, the updater, `install/**`); docs and DEV
  PRs go straight from the review to the merge. Such a PR goes `/pr` → `/cr` → fixes → device review
  (`.claude/skills/device-review`, at the change's tier, on the PR's final diff) → a drop-in of the
  PR branch on the dev card (`dev/push.sh`, "Dev card" above), where the maintainer looks at it →
  merge. So `develop` only holds changes that were reviewed for the device and seen on the mixer. A
  fix from the device review or the drop-in is a new commit on the PR; the device review reads it
  again at its tier, and the drop-in shows it. A change a drop-in cannot carry (a full install, see
  "Dev card") gets its device review before the merge and is tried with the next dev install image.
  An image (installer, dev or release
  card) still gets a device review for what it adds beyond the merged PRs: build scripts, the card,
  the installer.
- **Release PR**: `develop` → `main` only carries reviewed changes, and still
  gets one final `/cr` pass on the whole release diff before the fast-forward (how the PRs fit
  together); besides that its check is the changelog section, the list of released issues and that
  the release files are the tested ones; it is fast-forwarded, not merged with the button
  ("Releases").
- **Releases**: a PR `develop` → `main`, **fast-forwarded**, not merged with GitHub's button: its
  merge methods all add commits (a merge commit, or rewritten copies), which would leave `develop`
  behind `main`. Nothing is merged into `develop` from the release build until the push, so the built
  commit, `develop`'s tip and the PR's head are one commit. In order:
  1. Make the release build from `develop`'s tip and test it (its `package.env` names that commit;
     the build also leaves a dev installer image of that commit in `build/devcard/`, for a new dev
     card: the `release-build` skill). The PC builds unsigned, in the same build environment as
     GitHub: the image is the one GitHub builds from the tag (step 5 compares them), so the mixer
     test holds for the published files.
  2. Open the release PR `develop` → `main` and review it: a final `/cr` (or `/code-review`) on
     the PR, findings fixed (a fix PR into `develop`, then back to step 1) or named in the PR as
     accepted, before step 3.
  3. The maintainer moves `main` to the PR's head commit:
     `git fetch origin && git push origin <commit>:main` (no `--force`: git refuses anything that is
     not a fast-forward). GitHub then shows the PR as merged, and `main` and `develop` are the same
     commit. The ruleset on `main` needs the maintainer on its bypass list in mode "Always" (not "Pull
     requests only") for this push; force pushes stay blocked.
  4. Check the milestone: `gh issue list --milestone vX.Y.Z --state open` is empty (an open one
     moves to the next milestone or holds the release), and the "Done when" items noted for later
     on its closed issues (an install log seen at the next install) are seen on the release
     candidate and ticked; the `## vX.Y.Z` section of `CHANGELOG.md` lists exactly its closed issues
     (`--state closed`), and the bullet of an issue moved to the next milestone moves with it. Then
     move its cards from "Fixed in develop" to "Released" and close the milestone.
  5. An annotated tag on that commit: `git tag -a vX.Y.Z -m vX.Y.Z <commit> && git push origin vX.Y.Z`.
     The tag's workflow (`.github/workflows/release.yml`) checks it (annotated, on `main`, `VERSION`
     the same, a `## vX.Y.Z` section in `CHANGELOG.md` that is not empty) and makes a **draft**
     release with the notes from `install/release/release-notes.sh`: the section grouped under the
     section headings of "`CHANGELOG.md`" below, without the title prefixes, with the issue numbers,
     then how to check the download and the GPL source note from the README's "Legal" (U-Boot and
     busybox versions and their Debian source links, at the tag; update the README when `vendor.sh`
     pins new ones). Then its job `build-release` waits for the maintainer's approval (the
     environment `release`, GitHub: Actions, the run, "Review deployments"), builds the release files
     in the build environment, signs the package with the release key and attaches them with a
     `SHA256SUMS` (`install/release/ci-build.sh`): the installer image, and the update file (`.tar` +
     `.tar.sig`) only when a card can take it as a drop-in, that is unless `reinstall-below` is this
     version ([notes/updates.md](../notes/updates.md), "Release files"). Then, on the PC, check the
     draft against the tested build of step 1:
     `bash .claude/skills/release-build/release.sh compare vX.Y.Z` downloads the draft, runs
     `sha256sum -c SHA256SUMS`, and checks that its image and tar are the PC's byte for byte and that
     the signature verifies with `install/keys/release.pub`; it refuses a build that is not of the
     tagged commit or a release that is not a draft. A difference means the build environment is not
     the same on both: never publish, find out why. A drop-in release: test the update from the
     draft's `.tar` + `.tar.sig` on the mixer before publishing (the PC's tar is unsigned, cards
     refuse it). Last, on GitHub: replace
     the notes' first line with how to get it ("Update from vX.Y.Z: copy the update files" or "Full
     install with the installer image (copy your recordings off the card first)"; v0.2.0's notes as
     the example), edit the highlights under it for owners (drafted from the DLZ features, DLZ bugs and
     mod bugs: keep what they notice on the mixer, merge and reword in their words), and publish.
     Publishing posts one message in the project's Discord (`.github/workflows/announce.yml`):
     @everyone, the name, the highlights (the `- ` lines before the first `###` heading, as they are
     but without a trailing issue number), how to get it (an update from the version in
     "**Update from vX.Y.Z", else a new install only) and the link (`install/release/announce.jq`); it
     refuses notes that still say "Before publishing, replace this line" or have no highlights (fix
     them, then re-run the failed job; a re-run of a job that posted posts again), skips
     test releases and tags that are not on `main`, and posts nothing without the `DISCORD_WEBHOOK` secret (set once by the maintainer:
     `gh secret set DISCORD_WEBHOOK`; the webhook URL is never in the repo). The release key is in
     the environment `release` (secrets `DLZMOD_RELEASE_KEY`, the key file, and `DLZMOD_SIGNING_PASS`,
     set once by the maintainer, `gh secret set <name> --env release`; it only runs for `v*` tags and
     only after approval); the spare key `release2` never goes to GitHub: a withdrawal release (#63)
     is signed on the PC (`RELEASE_KEY=release2`, [notes/updates.md](../notes/updates.md), "Signing
     keys"). A try: a tag `vX.Y.Z-testN` on any branch makes a draft "vX.Y.Z-testN (test)" with the
     same files unsigned (job `build-test`: no key, no approval; `release.sh compare` works on it
     too); delete the draft and the tag afterwards
     (`gh release delete vX.Y.Z-testN --cleanup-tag`).
- **Version bump**: right after a release, `VERSION` goes to the next version in `develop` as its own
  PR (`docs/vX.Y.Z-bump`), before any other change of the new cycle, so every branch builds the same
  version and the dev card takes any of them. Feature and fix branches never bump
  ([notes/updates.md](../notes/updates.md), "Versions and channels").
- **`CHANGELOG.md`**: the bump PR opens a `## vX.Y.Z` section (with the milestone's issues already
  in `develop`, if any); every PR that finishes a milestone issue adds its title as a bullet there,
  and the release PR checks the section against the milestone. Bullets ordered `DLZ FEATURE`,
  `DLZ BUG`, `MOD FEATURE`, `MOD BUG` (no `ANALYSIS`, `DEV` or `release`; one line each, nothing else in the section: the release notes are made from it, and `release-notes.sh` stops on anything else): what changes on the mixer first,
  then the mod itself. The release PR (`#N: <title>` lines) and the release notes use the same
  order, as sections ("DLZ features", "DLZ bugs fixed", "Mod features", "Mod bugs fixed"; empty
  ones left out). The README's "What the mod does" follows: it describes the current mod, so the PR
  that brings a new feature or stock fix puts it into its section there: one bullet per feature,
  what the owner gets first, then where it is in italics (the Settings → DLZ Creator Modded tab);
  a stock fix as what no longer happens; no versions or internals (a new area gets a new section).
- **Community**: questions, bug reports and support go through issues, with templates for a bug,
  a feature and help with an install (GitHub Discussions are off); anyone can file, the maintainer sets labels, milestones and board columns. Triage of a report:
  accept (`triage` off, `roadmap` on, a milestone), need more (`needs-info`), no (closed as "not
  planned"), duplicate (closed with a link). Chat: the Discord linked in the README; bugs found there
  still become issues.
