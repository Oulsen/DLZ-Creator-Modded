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
    cpio zstd dosfstools e2fsprogs fdisk openssl curl ffmpeg
  ```

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
   `bash .claude/skills/ui-sandbox/sandbox.sh stop`: it leaves Node on ports 80/89 and a mapped drive
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
| `.github/` | Issue templates (bug, feature, help with an install), the pull request template, `CODEOWNERS` (who reviews) and the checks GitHub runs on every push and pull request (`workflows/checks.yml`: unit tests, key guards, updater checks, the SSH skill's read-only guard, script syntax) |
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
| `stage2-backup.txt` | U-Boot | Full eMMC backup in 64 MiB chunks; backlight toggles per chunk, powers off when done. Reads the eMMC's data (switching to its boot areas sets a register that resets at power-off), writes to the SD card |
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
| `release/mkpackage.sh` | WSL (root) | Build the release package `build/release/dlzmod-vX.Y.Z.tar`: one initramfs with the installer, `card-core.sh` and helpers, layers and screens, checked by an inner manifest; signed into `.tar.sig` (ed25519 over the whole tar: dev key, `RELEASE=1` release key, `RELEASE_KEY=release2` the spare; `DLZMOD_SIGNING_KEYS` = folder with the private keys, passphrase asked once or `DLZMOD_SIGNING_PASS`). Uncommitted changes: not signed |
| `release/mkkeys.sh` | Git Bash / WSL | Make a signing key pair (`release`, the offline spare `release2`, or `dev`; release keys passphrase-encrypted): private key into a folder outside the repo, public key into `keys/`. Never overwrites: cards trust the keys they were installed with for good |
| `keys/` | - | Public keys of the update signatures; `card-core.sh` puts `release.pub` and `release2.pub` on every card, and a dev key on cards built from a dev package or `build-sd.sh` (your own `dev.pub` from `DLZMOD_SIGNING_KEYS`, else `keys/dev.pub`) |
| `release/mkinstaller.sh` | WSL (root) | Build the flashable installer image around a package (`--dry-run`: writes nothing on the device). Development builds are named `-dev-<commit>`; `RELEASE=1` (clean tree only) gives the release name |
| `release/build-release.cmd` | Windows (double-click) | The release build in one step: `RELEASE=1` package signed with the release key (asks its passphrase in its own window) and the installer image around it, in WSL; keys from `%USERPROFILE%\.dlzmod-keys` (or `DLZMOD_KEYS_WIN`) |
| `release/vendor.sh`, `release/uboot-safe.py`, `release/mkglyphs.py`, `release/mklogo.py` | WSL | Pinned U-Boot/busybox downloads (Debian sha256); U-Boot's built-in defaults made safe (SD card only, no USB, the Banana Pi's Ethernet switched off in its device tree); font atlas for the installer screens; the MODDED sticker with the version for the installer screens |
| `installer/` | device | Installer U-Boot script (`boot.txt`), `/init` (checks, eMMC lock, accept screen, dry run, real install), `install-card.sh` (the write steps: `DLZDATA` first at the full card size, copy and compare with the eMMC backup made from the same read (`DLZDATA/dlzmod-backup/`), new UUID, partition table, `card-core.sh`, bootloader last; on a failure before `DLZDATA` exists, a small `DLZLOG` partition with the log) `ui.py` (screens and touch, stdlib only), busybox applet list, and for a mixer the mod does not support `probe.sh` (hardware report; the backup for analysis on other firmware, eMMC user area only, onto a `DLZDUMP` partition) with `boards.txt` (the bootloaders the backup is offered for) |
| `card-core.sh` | WSL (root) / device | Finishes a card (shared with the on-device installer): checks that every tool and mod file is there before writing, refuses any target but a loop device or an SD card, and a card whose model differs from the source's (`DLZMOD_MODEL`), then new rootfs UUID, the mixer the card is bound to (`DLZMOD_MIXER_ID`: sha256 of the eMMC's CID from the installer, `any` from `build-sd.sh`), `DLZDATA` partition (or the installer's, `DLZDATA_KEEP=1`), brick guards, boot visuals, UI and server mods (`apply-mod.sh`), optional SSH key for test cards. `DLZMOD_UUID` / `SOURCE_DATE_EPOCH` make builds reproducible |
| `check-rootfs.sh` | WSL / device | Is a mounted rootfs the supported firmware (evolve-node 3297) on an XS or a full-size, with the GD32 marker of that model's firmware? Optionally: is it the expected model? |
| `cpio-replace.py` | any | Replace one file in a cpio initrd, every other entry kept byte for byte (the bootsplash) |
| `apply-mod.sh` | WSL / device | The mod's own changes to a rootfs (guards and units, app/server patches, mod defaults, Mackie's factory Wi-Fi network and SSH access removed once), shared by `card-core.sh` and the drop-in update so both apply the same files; every file written atomically and only when it differs |
| `sd-system/` | device | Installed by `card-core.sh`: eMMC read-only unit (and a udev rule that locks it whenever it appears), first-boot `DLZDATA` grower, boot log copy to `DLZDATA/dlzmod-logs/`, dspserver start guard (waits for server.js), drop-ins that stop GD32 flashing and Mackie updates, the card bound to its mixer (`dlzmod-cardcheck` before Mackie's FPGA loader: the flag matches the GD32 marker, both match the eMMC's own (read-only), and the eMMC's CID hash matches `/etc/dlzmod/mixer-id`, else no FPGA load, faderlink or dspserver and a red popup), the drop-in update (`dlzmod-update`: a package in `DLZDATA/dlzmod-update/` is checked and applied at startup, only with a valid signature from a key the card trusts; its steps run in a sandbox on a copy, then only allowlisted files are placed), USB Wi-Fi ids the stock driver lacks, an eject rule for Realtek sticks that start as a driver CD, and an SSH drop-in that gives each card its own host keys, slows down password guessing and starts SSH only when turned on from the screen (off again after a restart unless kept on) |
| `mount-ro.sh` | WSL (root) | Mount a dump's rootfs read-only |
| `patch.py` | any | `patch.py app <app.js>`: our UI mods (`app-mod/dlzmod.js` + anchor patches). `patch.py server <server.js>`: our server mods (`server-mod/dlzmod-server.js` + anchor patches): FORMAT SD and firmware updates refused, free and unique recording names, the update popup, Wi-Fi and SSH for the Mod page's Network panel, control from other devices only when switched on and paired with a PIN (HTTP, socket.io and port 89 on loopback; the Remote Control panel), and Mackie's file commands checked (deleting and renaming only from the mixer's own screen and paired devices, recordings only in their folders, preset folders and names checked, no shell for file names, the kept `*.orig` originals not served), recordings downloaded by paired computers (read only, nothing read while recording) and every client's recording list refreshed after a recording, rename or delete |
| `server-mod/test-dlzmod-server.js` | Node | Unit tests for the server mod: recording names, update popup, Network panel, pairing (PIN, pause, cookie, Origin, which files other devices get), file command checks, the recordings download and list refresh (`node install/server-mod/test-dlzmod-server.js`) |
| `app-mod/test-dlzmod.js` | Node | Unit tests for the app mod, with stand-ins for Mackie's UI: the recordings download, meters, the header setting, the Mod page's tabs, Wi-Fi, SSH and Remote Control (states, passwords, the network list), the PIN pad, the update and card popups (`node install/app-mod/test-dlzmod.js`) |

### `dev/`: develop mods on a PC

| Tool | Runs on | Purpose |
|---|---|---|
| `ui-sandbox.sh` | Git Bash + Node | Run the mixer UI on this PC at http://127.0.0.1/ in the on-device layout (copy of `/srv` in `dumps/sandbox`, shell commands blocked, localhost only); `DLZ_FULLSIZE=1` shows the full-size DLZ Creator's UI from its own copy (`dumps/sandbox-full`); `DLZ_SANDBOX_REMOTE=1` makes http://localhost/ another device on the network; `DLZ_FAKE_MEDIA=sd` (`usb`, `sd,usb`) a pretend SD card / USB stick with a few recordings |
| `push.sh` | Git Bash + WSL | Build HEAD, push it over Wi-Fi to a dev card as a drop-in update, wait for the mixer to be switched off and on (`--restart`: from software, #81) and show the update's report ("Dev card" below); settings in `dev/push.env` (git-ignored, from `push.env.example`) |
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
python install/dumper/mksdimg.py vendor/u-boot-sunxi-with-spl.bin build/dlz-sdboot.img
python install/dumper/mkscr.py -n "DLZ stage2" install/dumper/stage2-backup.txt build/boot.scr
python install/dumper/mkenv.py vendor/u-boot-sunxi-with-spl.bin build/uboot.env boot_targets=mmc0 \
  "bootcmd=run distro_bootcmd; poweroff" bootdelay=-2 preboot= stdin=serial
```

## Prepare a card

1. Flash `build/dlz-sdboot.img` with balenaEtcher.
2. Format the 16 GiB partition as FAT32 (formatting does not touch the bootloader).
3. Copy `build/boot.scr` and `build/uboot.env` to the card root. `uboot.env` keeps U-Boot on the SD
   card and stops it from waiting at a prompt (no autoboot delay, no USB keyboard): without it, a
   missing or failing `boot.scr` makes U-Boot boot the eMMC's own system with the wrong device tree.

The mixer writes the user area as `emmc_<block>.bin` (the start block in hex: 64 MiB chunks, then
1 MiB for the tail), the two boot partitions as `emmcboot<N>_<block>.bin`, and powers off when done
(`done2.txt`). Join the user area in block order (WSL, in a copy of the card's files):

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
3. Make a key only for the dev card, without a passphrase, and add it once (Git Bash):
   `ssh-keygen -t ed25519 -N '' -C dlz-dev-card -f ~/.ssh/dlz-dev`, then `ssh-copy-id -o
   IdentitiesOnly=yes -i ~/.ssh/dlz-dev.pub root@<mixer>` with the SSH password from step 2
   (`IdentitiesOnly`: the mixer allows 3 tries, and an SSH agent with several keys uses them up
   before the password). Without a passphrase `push.sh` and the `mixer-ssh` skill (`dlz-ssh.sh key`)
   log in unattended, also from Claude Code; the file gives root on the dev card, so it stays on
   your PC and the card is a development card only. Not needed for a `build-sd.sh` card with an SSH
   key.
4. `cp dev/push.env.example dev/push.env` and fill in the mixer's address and your key. The script
   never asks for anything: a key with a passphrase goes into `ssh-agent` first, and the dev key is
   used as `mkkeys.sh` makes it (without a passphrase).

**The loop** (Git Bash, repo root):

```bash
git commit -m "WIP ..."   # only a committed tree is signed; WIP commits disappear in the squash merge
bash dev/push.sh          # build in WSL, check, copy; switch the mixer off and on; it prints update-N-<version>.txt
```

Every push needs a new start of the mixer: not during a recording. `push.sh` asks for it and waits:
switch it off and on with the switch on the back. `--restart` restarts it from software instead, but
with the current Mackie software that often hangs on the loading screen (#81). Before that, `push.sh` checks the
package the way the card will: the signature against the card's own `dev.pub` (a release card, or
one built with another dev key, stops here), `CHANNEL=dev`, `REINSTALL=no`, not older than the
card's version, and not a file the card refused before. The mixer software keeps DLZDATA mounted
read-only and writable only while it records: `push.sh` stops when it finds it writable, else makes
it writable for the copy and read-only again after it. Earlier packages in `dlzmod-update/` are
removed (more than one is never installed). After the new start it waits for the
updater's report, prints it and says from the report whether the package was installed. Packages
stay in `build/push/`.

**Back to an older build** of the same version (bisecting): equal versions install, so check out
the older commit and push again, or push its package from before: `bash dev/push.sh
build/push/dlzmod-v0.2.0-dev-<commit>.tar`. A refused file is not tried again; a new build is a new
file.

Not covered: changes that need a full install (`REINSTALL=yes`: guards, the updater's gates, boot
visuals, the card layout). Each pushed build is a build on the mixer: `device-review` at the tier
the change asks for. The release gate stays: a release candidate still gets a fresh install from
the installer image and an update from a card running the previous release.

## GitHub workflow

The roadmap is the issues on GitHub and the board
([project 2](https://github.com/users/Oulsen/projects/2)). Notes hold the lasting knowledge; an
issue's technical notes point to the note section instead of copying it.

- **Issue titles** in plain language, with a type prefix: `(DLZ FEATURE)` something the mod lets
  the mixer do, `(DLZ BUG)` stock Mackie behaviour, `(MOD FEATURE)` the mod itself (install, updates, safety,
  support, development), `(MOD BUG)` caused by the mod, `(ANALYSIS) ...?` an idea that first needs
  research, phrased as a question (it ends in a decision, and a feature issue if yes). New feature
  requests start as `(DLZ FEATURE)`; triage corrects the prefix.
- **Bugs vs. unfinished work**: a defect in what the release being worked on brings (not shipped
  yet) is simply fixed, without an issue. A defect in a released version gets a `MOD BUG` issue,
  never a reopen, so each issue stays in the changelog of the version it shipped in. Stock behaviour
  gets a `DLZ BUG` issue whenever it is found.
- **Labels**: the type, matching the title prefix (`dlz-feature`, `dlz-bug`, `mod-feature`, `mod-bug`,
  `analysis`); `roadmap` (our own plan, puts the issue on the board); `needs-info` (waiting for
  information from outside); `release` (release chores, never in the changelog); `triage` (a new
  community report, not looked at yet). Progress is not a label but the board's Status.
- **Milestones are versions** (`v0.1.0`, `v0.2.0`, ...), plus `Later` for planned work without a
  version; an issue moves to a version milestone once it is planned.
- **Issue body**: "What's wrong" / "What it adds" (plain, changelog tone), "Done when" (checklist,
  tested), "Technical notes" (short: approach, risk, device-review tier, pointer to the notes; long
  work details in a collapsed `<details>` block), "Related". The note rules above apply.
- **Life cycle** (board Status):

  ```
  Todo ──planned for the next version──> Next Version ──work starts──> In progress
  ──PR merged (Refs #N), issue closed──> Fixed in develop ──release on main──> Released
  ```

  "Next Version" holds the next milestone's issues that have not started; after a release the
  following milestone's issues move into it. The mixer test is part of the work on the branch (the
  dev card, `dev/push.sh`), before the PR. What can only be seen later (an install log on the next
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
  PR opens, the maintainer runs one review pass by an AI reviewer on the opened PR (`/cr` or
  `/code-review`, Claude Code review commands), so the whole diff that will be merged is read,
  including changes made after a device review (for docs: consistency with the other docs and
  correctness; for code: bugs, failure paths, what the tests cannot see). Findings are fixed as new
  commits on the PR, or named in the PR description as accepted, before the merge; fixes that add
  new logic or touch other code get one more pass on the PR, wording and fixes that only do what a
  finding asked do not. The release PR `develop` → `main` only carries reviewed changes, and still
  gets one final `/cr` pass on the whole release diff before the fast-forward (how the PRs fit
  together); besides that its check is the changelog section, the list of released issues and that
  the release files are the tested ones; it is fast-forwarded, not merged with the button
  ("Releases"). A change that runs on the mixer still
  gets its device review, once per image (`.claude/skills/device-review`).
- **Releases**: a PR `develop` → `main`, **fast-forwarded**, not merged with GitHub's button: its
  merge methods all add commits (a merge commit, or rewritten copies), which would leave `develop`
  behind `main`. Nothing is merged into `develop` from the release build until the push, so the built
  commit, `develop`'s tip and the PR's head are one commit. In order:
  1. Make the release build from `develop`'s tip and test it (its `package.env` names that commit).
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
  5. An annotated tag `vX.Y.Z` on that commit. Then a GitHub release with the `CHANGELOG.md` section as notes
  (grouped under the section headings of "`CHANGELOG.md`" below, without the title prefixes),
  followed by the GPL source note from the README's "Legal" (U-Boot and busybox versions and their
  Debian source links, at the tag; update it when `vendor.sh` pins new ones), and the tested
  release files attached: the installer image with a `SHA256SUMS`, and the update file (`.tar` +
  `.tar.sig`, in `SHA256SUMS` too) only when the release installs as a drop-in from the previous one
  ([notes/updates.md](../notes/updates.md), "Release files"). The notes start with how to get it:
  "Update from vX.Y.Z: copy the update files" or "Full install with the installer image (copy your
  recordings off the card first)". Check the release by downloading its files again
  (`gh release download`) and running `sha256sum -c SHA256SUMS`.
- **Version bump**: right after a release, `VERSION` goes to the next version in `develop` as its own
  PR (`docs/vX.Y.Z-bump`), before any other change of the new cycle, so every branch builds the same
  version and the dev card takes any of them. Feature and fix branches never bump
  ([notes/updates.md](../notes/updates.md), "Versions and channels").
- **`CHANGELOG.md`**: the bump PR opens a `## vX.Y.Z` section (with the milestone's issues already
  in `develop`, if any); every PR that finishes a milestone issue adds its title as a bullet there,
  and the release PR checks the section against the milestone. Bullets ordered `DLZ FEATURE`,
  `DLZ BUG`, `MOD FEATURE`, `MOD BUG` (no `ANALYSIS`, no `release`): what changes on the mixer first,
  then the mod itself. The release PR (`#N: <title>` lines) and the release notes use the same
  order, as sections ("DLZ features", "DLZ bugs fixed", "Mod features", "Mod bugs fixed"; empty
  ones left out). The README's "What the mod does" follows: it describes the current mod, so the PR
  that brings a new feature or stock fix puts it into its group there.
- **Community**: questions, bug reports and support go through issues, with templates for a bug,
  a feature and help with an install (GitHub Discussions are off); anyone can file, the maintainer sets labels, milestones and board columns. Triage of a report:
  accept (`triage` off, `roadmap` on, a milestone), need more (`needs-info`), no (closed as "not
  planned"), duplicate (closed with a link). Chat: the Discord linked in the README; bugs found there
  still become issues.
