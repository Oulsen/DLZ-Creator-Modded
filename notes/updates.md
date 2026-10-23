# Updates and releases

How the mod reaches a mixer and how it is updated there: the release files, the drop-in update and
its sandbox, versions and channels, the signing keys, and the parts that are designed but not built.
Code: `install/sd-system/dlzmod-update` (the updater on the card), `install/apply-mod.sh` (shared with
`card-core.sh`), `install/release/mkpackage.sh`, `install/release/mkkeys.sh`. Tests:
`tests/update.sh`. Confidence tags: see [architecture.md](architecture.md).

## Release files

A release has up to two downloads, built in one step from the same **package**
(`install/release/build-release.cmd` → `mkinstaller.sh` + `mkpackage.sh`), and a `SHA256SUMS` for them:

| File | Contents | For |
|---|---|---|
| `dlz-installer-vX.Y.Z.img` | Debian U-Boot + `uboot.env` + `boot.scr` + the package | A new install: write to a card, boot, install |
| `dlzmod-vX.Y.Z.tar` + `.tar.sig` | The package: installer initramfs + all mod files (patches, services, layers), and its signature | An update of an existing mod card |
| `SHA256SUMS` | The sha256 of every file above that the release publishes, made at the release from the tested files (`sha256sum` in `build/release`, two spaces before the name) | Checking a download |

What installs and what updates is always the same code. Neither is ever named like a Mackie `.upd`.

The update file is published only when the release installs as a drop-in on a card running the
previous release (judged by that release's updater, see "Versions and channels"). A release that
needs a full install (it changes a guard, a file outside the updater's allowlist, or the updater's
own checks; `REINSTALL=yes`) publishes only the image, so nobody tries an update that the card
would refuse; its notes say so. v0.1.0, the first release, is image only. Until the full update
(#56) exists, a full install means copying the recordings off the card first.

**A finished card image is never published**: it contains Mackie's system copied from the eMMC.
Every card is built on its own mixer from that mixer's eMMC (the installer), so only our own files
are distributed.

An update cannot come through the installer image: writing the image erases the card (recordings
included) before the installer runs, and the mixer has one card slot. Keeping recordings across an
update goes through the card itself: the drop-in update below.

### Built where (#68)

Today the PC builds and signs, the files are tested on the mixer and uploaded to the tag's draft.
What a build on GitHub would need [static, rebuilds of v0.2.0 in WSL]:

- **No Mackie file**: the package and the image come from the repo and the two pinned Debian
  packages (`vendor.sh`, sha256-checked); no dump. Debian drops a version from `deb.debian.org`
  once a newer one is out: rebuilding an old tag then needs `snapshot.debian.org` [guess: Debian's
  usual practice, not seen for these two yet].
- **Reproducible**: two builds of the same commit are byte-identical, the package and the image, from
  a Linux clone or the tree on `/mnt/d`, minutes apart. v0.2.0 rebuilt from its tag had the same
  files as the release; its tar and image differed only in what is now fixed (the copied
  `sd-system/` files' modes followed the source tree; the FAT's file times were the build's clock).
- **Same tools needed**: gzip, cpio, Pillow with FreeType, the DejaVu fonts and dosfstools shape the
  bytes. The PC builds in WSL Ubuntu 26.04, GitHub's `ubuntu-latest` runners are older [guess]: a
  byte-for-byte match needs both sides in one pinned build environment (a container image from a
  fixed snapshot). Same-host builds are what was tested; files are copied onto the FAT in a fixed
  order and every FAT time (the label's too) is set in UTC, so the host's directory order and time
  zone do not count.
- **Decision: GitHub signs, after #63.** Signing moves to a GitHub workflow (release key as a
  secret in a protected environment that needs the maintainer's approval) because a leaked key can
  now be withdrawn from cards installed with v0.3.0 or later (#63, "Signing keys"); before that, a
  key stolen from GitHub would have been trusted by every card for life (cards from v0.2.0 and older
  still trust theirs). Until #158 the PC signs. Then the files GitHub builds and signs are the ones tested on
  the mixer (from the draft) and published; the PC's build of the same commit must match them.

## Drop-in update

Most releases only change the mod's own files (app and server patches, sd-system units and rules).
The card applies those in place at startup, without a rebuild from the eMMC.

1. **Courier**: the user copies `dlzmod-vX.Y.Z.tar` and its `.tar.sig` into `DLZDATA/dlzmod-update/`
   (a fixed folder with a README, made by the installer; never the card root, so a stray file among
   the recordings cannot trigger anything), or sends both from a paired computer's browser (Upload
   Update... on the Mod page, #114: [mod.md](mod.md), "An update from a computer"), which puts the
   same two files there and nothing else.
2. **Find** (`dlzmod-update`, before evolve-node, evolve-app and dspserver): exactly one
   `dlzmod-v*.tar` with its `.sig` next to it. Without a `.sig`: reported once, not marked failed, so
   adding the `.sig` later works. More than one tar: nothing is installed.
3. **Check, on a copy in `/tmp`** (tmpfs, ~500 MiB [static: fstab]), before anything in it is read:
   size at most 64 MiB (a real package is ~1 MB); the ed25519 signature against the card's trusted
   keys (a withdrawn one verifies nothing: "Signing keys"), and `CHANNEL` = the channel of the key
   that verified; then the keys the package withdraws (`WITHDRAWN`) onto the card's list; only plain files and folders in the
   tar and in the initramfs inside it (no links, no `..`; the initramfs may hold `dev/console`); both manifests, and the manifest = the file
   list; the card's model in `MODELS`, `EVOLVE_NODE`; not older than the card's version
   (`/var/lib/dlzmod-update/version`); no full install needed (`REINSTALL_BELOW` not above the card's
   version; without it `REINSTALL=no`); and the package's **guards** byte for byte
   as the installed updater knows them (sha256 list `GUARDS` in `dlzmod-update`, checked against the
   files by `mkpackage.sh`). A package that changes a guard needs a full install. Then the one
   piece of package code that runs as root outside the sandbox: its own `check-rootfs.sh` (does
   this card's firmware and GD32 marker pass the new package's check), only after the signature
   check and every other check of this step. It needs root to list `/root` (mode 700:
   `.dlzlite` and the GD32 markers), which the sandbox's uid cannot read; the signature being the
   trust boundary (below) covers it.
   The 8 guards: the drop-ins of `flash-gd32`, `flash-fpga`, `upgradedaemon` and `upgraderun`,
   `dlzmod-emmc-ro` with its unit and the udev rule `60-dlzmod-emmc-ro.rules`, and `dlzmod-cardcheck`.

   **Then the question** (#65): a package that passed every check is applied only after **Install**
   on the mixer's own screen ("The question before an update" below). Without it the updater stops
   here: nothing applied (its signed `check-rootfs.sh` has run, as above), no try counted, no report
   (unless an earlier cut-off try was put back), the package stays, and `pending` tells the screen. A
   try that was cut off goes on without a new Install (its progress marker carries it).
4. **Snapshot** of every file an update may change (once per package: a retry after a power cut
   keeps the one from before the first try).
5. **Stage and sandbox** (below): the package's own steps run on a copy, as an unused uid, and the updater
   compares the result with its allowlist before the card is touched. The patch anchors are checked
   there too (`patch.py --check`, never as root).
6. **Place**: the guards first (flushed), then the rest, the updater's own new copy and unit last,
   each file atomically and only when it differs. Then the installed updater's own checks: the guards'
   exact content, nothing else in the guard drop-in folders, the enable links, the stock units they
   act on unchanged, the `server.js` refusals of Format SD and firmware updates, the keys unchanged.
7. **Result**: success deletes the tar and `.sig` and writes `DLZDATA/dlzmod-logs/update-N-<version>.txt`
   (named like the package, `v0.1.0` or `v0.1.0-dev-c0e3084`; `unknown-version` when it stopped before
   reading the package; N one past the highest, so the newest report has the highest number).
   Failure restores the snapshot and removes what the update added; the files stay, and the same file
   is not tried again until a different one is there. A package gets 3 tries; a failure that is not
   the package's fault (no eMMC seen yet, the sandbox setup failing) is `later` and gives back the try
   that start counted (the earlier ones stay counted).
   A try that a start does not go on with is put back at that start, whatever the folder holds (#108):
   one cut off by a power cut while placing, or one whose put-back failed (`RESTORE INCOMPLETE`: its
   progress marker stays for this). Broken guards or no file: right at the start (as in v0.1.0).
   With a file there, after the eMMC-lock check (a `later` there leaves it for a start that sees the
   eMMC locked): more than one file or a file without `.sig` before they are named, a different file
   or the same file marked failed before that file is checked. A check that refuses a resumed try of
   the same file puts back what it placed first, and so does a `later` on one (its count of 3 starts
   fresh: the cause is not the package).
   Where a start stops before looking at a file (broken guards, more than one file, no `.sig`) and in
   that `later`, a put-back that really put files back keeps the cut-off try's Install for that same
   file (its record: tar + `.sig`), so the next start with only that file begins a fresh try without
   asking again: unless another file's Install is there or that file failed (a marker without its
   snapshot is only cleared: then the screen asks again); a start without any file drops it, as below.
   A put-back that fails is tried once per start (once more after this start placed files) and again
   at the next one; its report is written once (no new report with the same text as the last, not
   counting the `removed`/`placed` lines of the first try). A progress marker without its snapshot
   (nothing placed behind it) is cleared by those put-backs; a start of that same file goes on by it
   with a fresh snapshot [static, PC
   rehearsal: `tests/update.sh` cases 13, 17, 19, 34-35, 62, 64-74].

Not covered by the drop-in (installer only): boot visuals, the installer itself, the card layout,
the guards, the updater's own gates and allowlist, the trusted keys. Such a version is a **full
install**: `install/release/reinstall-below` holds the first version every card must have been
installed with, and `mkpackage.sh` writes `REINSTALL_BELOW=<it>` and `REINSTALL=yes` into every
package from then on. The updaters from before #63 know only `REINSTALL` and refuse it; this one
refuses only a card whose version is below `REINSTALL_BELOW`, so cards installed with that version
(the dev card too) take later builds as drop-ins again. v0.3.0 is one (#63, and #96's allowlist
entry); the file stays until a later full install raises it.

Tested: `tests/update.sh` on a card image (power cut, failure after the patches, the sandbox walls,
placing and putting back, cards on v0.1.0's and v0.2.0's updaters refusing a full-install package,
the #140/#141 drop-ins placed by the new updater at a start, the key withdrawal) and `tests/update-checks.sh`
without one (every released updater's gate for the new copy; the package and card checks: links,
wrong model, older version, a weakened guard, the signing cases), on the PC; installed and refused (one
byte changed, original `.sig`) on the mixer, by the mixer's own OpenSSL 3.0.2 [device].

**Checks only** (`DLZMOD_CHECK_ONLY=1`, for `tests/update-checks.sh`) [static, tested on the PC]: the
updater runs steps 2 and 3 (find, check) on a rehearsal tree and stops before step 4, the snapshot,
with `CHECKS PASSED` or the usual `NOT INSTALLED:` reason. Apart from the package's own
`check-rootfs.sh`, which runs as in step 3 and only reads, it writes nothing outside its own temp
files: no README or report on DLZDATA, the package stays, no start-up repair, the try records in a
temp copy of the state folder (so every run checks afresh). It only starts with `DLZMOD_ROOT` (not
`/`) and `DLZMOD_DATA` both set to folders; any other value of the flag stops it. On the mixer
nothing sets it (the unit's environment is clean, the sandbox's is empty), and if something did,
the updater refuses it first thing ("Rehearsal settings" below).

### The question before an update

An update file is never installed without the person at the mixer agreeing (#65) [static, PC
rehearsal: `tests/update.sh` case 3a]:

- At every start the updater checks the package (steps 2 and 3). Without an approval it writes
  `/var/lib/dlzmod-update/pending`: `<record> <version>`, where the record is the sha256 of the tar
  and its `.sig` together (the same record as `failed` and `tries`) and the version is named as in
  `installed` (`v0.2.0 (dev-c0e3084)`, a release just `v0.2.0`), from the checked `package.env`. Each
  start removes it first, so it is only ever about the package that is there now. A package its
  checks refuse is never offered: it gets the red popup below, as before.
- The server mod sends it to the screen in `GUI_LOADED` (`DLZMOD_UPDATE_ASK`), **only to the mixer's
  own screen** (`dlzmodLocal`), laid out as Mackie's firmware update question (current and new
  version) with **Install** and **Later**. Later closes it; it comes back at every start, and the Mod
  page's Updates row keeps an "Install Update..." button. Other devices see the row with "install it
  on the mixer's own screen" and no button.
- **Install** sends `DLZMOD_UPDATE_APPROVE {sum}`, a screen-only command (`DLZMOD_SCREEN_ONLY` and its
  own check). The server writes the pending record to `approved` (temp file, fsync, rename, folder
  fsync: the next thing the user does is cut the power) and answers "Ready to install vX.Y.Z. Switch
  the mixer off and on."; the update installs while the logo shows (about 12 s in all, of
  which 4 s checks [device]), then the popup below says how it went.
- **Off and on, not a restart from software**: before #140, software restarts on the mod card often
  hung at the next start (#81, `notes/components/glesgui.md`; 10 of 10 went through since), so the
  screen asks for the switch, as `dev/push.sh` does (#87); the switch also resets the parts a
  software restart leaves powered.
- The updater installs only when `approved` holds the record of the file it has just checked: a file
  replaced or changed after Install (another tar or another `.sig`) is asked about again. The approval
  is used up once the snapshot and progress marker are written; a fail before that removes it too,
  and so does a start that finds no file, or one other checked file, in the folder. `later` (not the
  package's fault, e.g. the eMMC not seen yet) keeps it, and so do the starts that stop before the
  checks (more than one file, a file without `.sig`, a file that failed before): accepted, the
  approval names exactly one tar and `.sig`, so it can only ever install the file it was given for.
  The same goes for a cut-off try's Install that a put-back keeps (#108, step 7 above): it is written
  back only for that try's own record, never over another file's Install. It stays until a start
  finds no file or asks about another one; a refused other file in between leaves it, so that same
  file and `.sig`, put back unchanged, installs without asking again: accepted, as above.
- When another file's try was cut off (that file removed since), the files from before that try go
  back at the start, before this file is checked, so they are back while it waits for Install too
  (#108).
- The approval check is one of the gates a new updater copy must keep (by its text, like the other
  gates: it catches a mistake, not a hostile signer).
- An unseen result popup and a new question can open at the same start, one over the other
  (accepted: rare, both still work).
- **Not shown during the install**: the screen keeps Weston's background (the logo) meanwhile.
  Weston and glesgui start in `basic.target`; the updater (a `multi-user` service) starts right
  after `sysinit.target` and `local-fs.target` since #141, so the kernel bootsplash is on screen at
  its start and
  Weston's background takes over during a longer install [static: the units; the screen: guess]. A
  message during the install: #96.

Accepted: a file that someone else puts on the card still runs its package's `check-rootfs.sh` as
root at every start while it waits, after the signature check (the signature is the trust boundary,
as before); while a file waits, every start checks it again (signature, unpack, manifests: a few
seconds before the mixer software starts) until Install or until it is removed; a file refused for
the card it is on is reported once, as before. The update that brings
this updater is installed the old way by the card's older one, without the question.

### The popup after an update

After a start that installed or refused an update, the screen shows it once, in the style of
Mackie's firmware popups (`showMessage`): green "Updated to v… ." or red "The update was not
installed. See dlzmod-logs/update-N-<version>.txt on the card." The last refusal also stays, in red, in the
"Updates" row of the Mod page, and its "Version" row always shows `installed` (the build, as the
popup names it). Same round trip as Mackie's `.upgradesuccess` popup: the server mod
sends `DLZMOD_UPDATE_NOTE` in `GUI_LOADED`; the OK comes back as `DLZMOD_UPDATE_NOTE_OK` and only
then is it marked shown. State in `/var/lib/dlzmod-update/`: `installed` (version + build), `shown`
(written by the OK, fsynced with its folder: without that, a quick power-off after OK brought the
popup back [device]; a fresh install writes it too), `failed` (sha256 of the refused file and its signature together: the same file with another
`.sig` counts as a new try),
`shown-failed`, `last-report`, and for the question before it `pending` and `approved` (above). Not
shown: `later` and "more than one update file".
Accepted: any hub client can send the OK (a few small writes in fixed files); the fsync pauses the
hub for one card flush per tap (audio is dspserver).

## The sandbox and the trust boundary

**The signature is the trust boundary.** A signed package may place `dlzmod-*` scripts, units and the
patched `server.js` (root code by nature), and those run unrestricted from the next start; no sandbox
around the update itself can stop a hostile signer. The sandbox contains a **buggy** package (and a
stolen key's *immediate* reach during the update): it cannot write the card outside the allowlist,
touch the eMMC, GD32 or other hardware, reach the system's daemons, or leave anything running.

- **Stage**: a copy in `/tmp` of every file an update may change plus what the steps read (the patch
  originals); filling it is checked file by file. The package's steps (`apply-mod.sh`:
  `install_sd_system`, `apply_patches`, `set_mod_defaults`, `record_version`, the new updater copy;
  `patch.py --check` first) only ever see the stage. (The one exception: the package's
  `check-rootfs.sh` runs earlier, as root and outside the sandbox: step 3.)
- **Sandbox**: `unshare -m -p -n -f --kill-child --mount-proc` (own mount, pid and network namespaces:
  no network, and whatever they start dies with them). Before dropping root: a fresh empty `/run` and
  `/tmp` (the sockets of systemd, dbus, udev and the display live there; `/run/systemd/private` is
  mode 777 and only checks uid 0 [device]); the stage at `/run/sb`, the package read-only at
  `/run/pkg`; every other mount read-only (`nosuid,nodev`, failing closed), skipping mounts hidden
  under the fresh `/proc`, `/run` or `/tmp` (the mixer has `binfmt_misc` under `/proc/sys/fs`
  [device]); a read-only tmpfs `/dev` with only null, zero, random and urandom. Then `setpriv` to
  uid/gid **65533**, which no account on the card has (not nobody, uid 65534: a process running as
  nobody could reach the stage through `/proc/<pid>/root`, where the same uid is enough for a
  freshly started program [static]; no file on the card belongs to 65533 or 65534 [static, dump]),
  no capabilities, `--no-new-privs`, `env -i`.
- **User namespaces off** (`/proc/sys/user/max_user_namespaces` = 0) while it runs, restored right
  after and at the end. Without that, a capability-less process can make a user namespace, regain
  capabilities in it, mount a fresh sysfs and write `/sys/kernel/uevent_helper`, GPIO or sysrq (the
  mixer's kernel has `CONFIG_USER_NS=y` and `CONFIG_UEVENT_HELPER=y`) [static; the escape was reproduced in a replica].
- **Allowlist**, checked by the installed updater on the stage (one folder level, no subfolders):
  `srv/{app.js,server.js,srv_data.json}`, `var/lib/dlzmod-update/{version,installed}`,
  `usr/local/sbin/dlzmod-*`, `etc/udev/rules.d/*dlzmod*.rules`, `etc/systemd/system/dlzmod-*.service`,
  `ssh.socket`, the `dlzmod.conf` drop-ins of flash-gd32, flash-fpga, upgradedaemon, upgraderun,
  dspserver and ssh, and since v0.3.0 those of glesgui, evolve-node and evolve-app (#140) and of
  dlzmod-update and dlzmod-grow-data (#141), and of weston-mackie (for #96, no package brings one
  yet), `dlzmod-*.service` links in `multi-user.target.wants`, and only
  `dlzmod-emmc-ro.service` in `sysinit.target.wants`. Not `boot/boot.scr` (below). Also refused: names
  with a space, newline, quote or glob character; special files; wrongly shaped links; units with
  `DefaultDependencies=no` (only the eMMC lock's own unit has it), and since v0.3.0 drop-ins with it
  (the allowlist takes only `.service.d` ones), except #141's two early-start drop-ins with exactly the updater's own text (`EARLY_CONF`);
  udev rules with `setrw` or `force_ro=0`; setuid, setgid, sticky or other-writable modes.
  A later version that needs a path outside this list needs a full install, or first an update that
  only brings the newer updater (its own list applies from the next update).
  Or, for a fixed file, the way #140's and #141's drop-ins came: the package's `apply-mod.sh` reads the card's
  updater (in the stage, before its new copy goes in) and leaves the file out when that one's list
  lacks it; the new updater carries the file's text itself (`SCHED_CONF`, `EARLY_CONF`, checked against the shipped
  files by `mkpackage.sh` and `update-checks.sh`) and places it at the next start without an update
  file: only where it is missing (one that is there is left as it is, so a later version's own
  change is not undone; one deleted on purpose comes back, so to try stock scheduling, empty the
  file instead), written next to it and renamed, never while a cut-off try waits to be put
  back or the eMMC is not locked. Only a start without an update file places it: while one waits on
  the card, the placing waits too. A placing that fails says so in the journal only (the boot
  report), not in a report on DLZDATA at every start. systemd read the units before the updater
  ran, so they apply from the start after [static, PC rehearsal: `tests/update.sh` cases 3c, 75].
- **The new updater copy** must keep the installed one's `GUARDS` list exactly and contain its gates
  (signature check, the sandbox's uid, capability drop, user namespaces off, read-only remount, eMMC check, the refusal
  of rehearsal settings on the card, allowlist, key check). A text check: it catches a mistake, not a
  hostile signer. The strings are looked for outside the new copy's own gate block (that block lists
  them all, so before #93 a check dropped from the code was still found there; v0.1.0 cards check
  the update that brings this with their old copy), and a
  copy without that block is refused [static; tests/update-checks.sh, also with the card's mawk].
- **`boot.scr`**: the card keeps Armbian's stock `boot.scr`, and an update cannot place, change or
  remove anything under `boot/` (nothing there is on the allowlist: `boot.scr`, `armbianEnv.txt`,
  the kernel, initrd, DTBs and overlays it loads): a new one comes only with a full install, where
  the installer is reviewed as a boot route. U-Boot runs `boot.scr` before any guard, and a text
  check of a script cannot find every way it could write the eMMC or the PMIC (U-Boot's `mmc`,
  `i2c`, `mw`, `fatwrite`, ...), so the updater no longer places it at all. Like the other checks
  this stops a mistake, not a hostile signer: a signed root script could still rewrite `/boot` after
  the start (the signature is the trust boundary). It holds from the second update on: the update
  that brings this updater is still checked by the card's older one (whose list allowed
  `boot.scr`; no package changes it). Later boot logic (a boot flag, a boot counter) needs a full
  install, or first an update that brings an updater whose own list allows it. The snapshot still
  covers `boot/boot.scr`, so a try that an older updater cut off is put back whole.
- **Rehearsal settings** (`DLZMOD_ROOT`, `DLZMOD_DATA`, `DLZMOD_CHECK_ONLY`) skip the eMMC-lock
  check: the updater refuses them first thing when `/` is on an SD card (the mixer's own system),
  exit 2, nothing done [device: all three set by hand over SSH]. Where the root disk cannot be determined (a rehearsal chroot without `/sys`, a PC) it
  lets them through: the rehearsals need that, and on the mixer the same lookup already finds the
  card for the live path; the eMMC lock itself is a separate guard that runs first.
- **What the eMMC lock is** [static, kernel 5.10 sources]: read-only blocks `write()` on the device
  node and read-write mounts, which is what a bug in our code or Mackie's would do; root can undo it
  (`blockdev --setrw`), and discard/zero-out ioctls and raw MMC commands may not check it. It protects
  against accidents, together with the patched `server.js` refusing Format SD and firmware updates.

Accepted: the signature as the trust boundary; the text-only check of a new updater; a hard kill
during the sandbox leaves user namespaces off until the next start (nothing on the mixer uses them);
transient lack of space while unpacking counts as a failure (`/tmp` is ~500 MiB, a package at most
64 MiB); no lock against two updaters at once (only a manual restart could do that).

## Versions and channels

How the drop-in compares [static]: only `VERSION` counts (`sort -V` against the card's version); the
build (`dev-<commit>`) is never compared. Newer and equal install, older is refused.

- **Equal stays allowed**, so an older build of the same version can go back on (bisecting a
  regression); there is no build counter.
- **`VERSION` is bumped in `develop` right after a release**, as its own small PR (`docs/vX.Y.Z-bump`),
  before any other change of the new cycle: dev builds then read "v0.2.0 dev-…" on the way to 0.2.0,
  never the released number on different code, and every branch builds the same version. A feature
  or fix branch never bumps: with the bump on one unmerged branch, the dev card took that branch's
  builds and refused every other branch's as older (seen in the v0.2.0 cycle). Bumping again before the
  release (0.1.1 → 0.2.0) is fine, also as its own PR into `develop`.
- **No `-rc` suffix**: `sort -V` ranks `v0.2.0-rc1` above `v0.2.0`, so the release would be refused as
  older. `VERSION_RE` (`modversion.py`) blocks it.
- **A release candidate is the `RELEASE=1` build itself.** Its test: a fresh install from the
  installer image, and an update from the **previous public release** (a card running it, the RC as
  drop-in: the jump users make, judged by the old release's updater). Passed: those exact files are
  published. Failed: fix, rebuild under the same version, test again.
- **`package.env`** keys are read by name, and unknown keys are ignored, so later versions can add
  fields without older updaters refusing them. Never rename or drop a key. `MODEL=XS` stays for
  updaters from before the full-size support; newer ones read `MODELS`.
- **`CHANNEL=release|dev`**: release cards trust only the release keys (and so refuse dev builds,
  also strangers' "dev builds"); cards built for development trust the dev key too. The trusted set
  is fixed at install time: a switch that adds a key later would be a road to root.

## Signing keys

Why: not to stop forks (anyone may build their own and install it with their own installer image, a
deliberate act with screens and an accept button), but because a drop-in runs as root at the next
start (since #65 only after Install on the screen, but the person tapping it sees a version, not the
code), and root can undo the eMMC lock. The signature is the only thing between a file on
DLZDATA (a fake download, a card in someone else's reader, later the online update) and the mixer's
internal storage.

- **ed25519 with OpenSSL** on both sides: the mixer's own `openssl` 3.0.2 verifies (`pkeyutl -verify
  -rawin`) [device]; no new tool on the card. The signature covers the whole tar.
- **Three key pairs**, made with `install/release/mkkeys.sh` (never overwrites; refuses a folder inside
  the repo): `release`, `release2` (the spare, kept offline: if `release.pem` is lost, packages
  signed with the spare still reach every card) and `dev`. The release keys are AES-256
  encrypted; the dev key is plain, for the quick test loop.
- **Public keys** in `install/keys/` (committed, LF). `card-core.sh` (`install_update_keys`) puts them
  in `/usr/local/share/dlzmod-keys/`: release cards get `release.pub` + `release2.pub`, dev-channel
  cards `dev.pub` too.
- **Your own dev key**: `mkkeys.sh <folder> dev` writes `dev.pem` and `dev.pub` into that folder, not
  into the repo. With `DLZMOD_SIGNING_KEYS=<folder>`, `mkpackage.sh` (dev channel) and `build-sd.sh`
  put that `dev.pub` on the cards instead of `install/keys/dev.pub`, after checking it is a public key
  and belongs to the `dev.pem` next to it; a release package always carries `install/keys/dev.pub`
  (rebuildable from its commit; release cards do not install it). The installer takes the dev key
  only from its package. A card keeps its keys for life: one built with another dev key needs a new
  install before it takes your signed builds. The channel is never a default: the package's `CHANNEL` (installer), else
  `DLZMOD_CHANNEL=dev` (set by `build-sd.sh`), else the build refuses before anything is written.
  The updater tries `release`, `release2`, `dev`; `release2` counts as the release channel.
- **Private keys** live outside the repo, in the folder `DLZMOD_SIGNING_KEYS` points to. Losing every
  copy of both release keys means no installed card takes an update again (only a fresh install).
  The passphrase is the second lock: keep it apart from the key file.
- **Withdrawing a leaked key** (#63, cards installed with v0.3.0 or later): add its name to
  `install/keys/withdrawn` (`release` or `dev`, one per line; never `release2`) and release with the
  spare key (`RELEASE_KEY=release2`). Every package from then on carries `WITHDRAWN=<names>`:
  - the updater, after the signature and contents checks and before the checks that can refuse the
    package, adds a name to the card's list `/var/lib/dlzmod-update/withdrawn` only for a package
    signed with `release2` (a leaked `release` key cannot withdraw the spare), without waiting for
    Install; from another key's package the name is ignored ("not withdrawn, only the spare release
    key can withdraw a key"), so later release and dev builds carrying the list still install. It
    sticks even when that package is refused later on; the report names a key withdrawn before;
  - a key on the list verifies nothing: "signed with the release key, which was withdrawn on this card";
    a list that cannot be read counts as withdrawing every key;
  - the list only grows: the updater never removes a line, an update's steps cannot write it (not on
    the allowlist, and a removal in the stage is never carried over), and the snapshot never holds it,
    so a put-back cannot bring a key back; a new updater copy must keep the check (its gate strings);
  - the installer (`install_update_keys`) leaves the package's withdrawn keys out and writes the list;
    `build-sd.sh` (no package) reads `install/keys/withdrawn` instead. A full install always makes a
    new card (a fresh copy of the eMMC), so its list is the package's, whatever the card held before;
  - withdrawing `dev` names the channel: it also stops a developer's own dev key (`mkpackage.sh`
    refuses to sign with it, cards leave it out), so the dev card needs a new dev key and a reinstall.

  Accepted: no update adds a key, so after a withdrawal `release2` is the only release key, with no
  new spare until a full install with new keys; an installer image from before the leak still
  trusts the leaked key; a card that does not take the withdrawal update keeps trusting it (whoever
  holds the key can reach it first, and can then replace the updater); the withdrawal package is
  stopped like any other by a second update file in the folder, or by a failed unpack (no room in
  `/tmp`: refused for good, so a new file is needed); nothing checks that `install/keys/withdrawn`
  never shrinks. Cards from v0.2.0 and older trust their keys for life.
- `mkpackage.sh` signs dev builds with the dev key and `RELEASE=1` with the release key
  (`RELEASE_KEY=release2` for the spare), asks an encrypted key's passphrase once (or reads
  `DLZMOD_SIGNING_PASS`, passed only to the two openssl calls), and checks the private key against
  the public key the package's cards will trust first. **A tree with uncommitted changes or new
  files in `install/` or `VERSION` is never signed** (`+dirty`: tar only, for PC rehearsals);
  `RELEASE=1` refuses untracked files too.
- **On GitHub, after #63** ("Built where"): a workflow would write the key from a GitHub secret into
  a temporary folder for `DLZMOD_SIGNING_KEYS` and pass the passphrase as a second secret. An
  Actions secret cannot be read back, so it is not a backup.

Accepted: an older signed build of the same version installs again (equal stays allowed); a large
refused file is copied and hashed at every start until it is removed (a few seconds).

## Not built yet

- **Updates without the card reader** (#55): "Check for updates" on the Mod page (the latest GitHub
  release only, never `main`; downloaded with `curl`, which the stock system has) or a USB stick (the
  upload from a paired computer exists: #114).
  Each only puts the same two files into `DLZDATA/dlzmod-update/`; a release without update files
  (image only, "Release files") is shown as "needs a full install", never downloaded. Rules for it: only the latest-release
  request leaves the mixer (no device ID, serial or usage data); "update available" means strictly
  newer, except that a card on a dev build of version X is offered release X; pre-releases only
  with an explicit opt-in; dev packages never go online; downgrades only by an explicit choice (an
  old package is still validly signed); check what server.js does with files on USB media before
  using a stick (our files never look like a Mackie `.upd`); the download and check code gets a
  security review.
- **Full update and undo** (#56), for what the drop-in cannot do (boot visuals, card layout):
  "Install" on the Mod page sets a one-shot flag on DLZDATA and restarts; the card's `boot.scr` (one
  that comes with a full install: an update cannot change it) sees it and boots the installer path (Mackie's kernel from the eMMC + the package's initramfs) in update
  mode: rebuild the system partition from the eMMC, carry over the state (`srv_data.json`, presets,
  NDI config, Wi-Fi, SSH keys, mod settings), leave DLZDATA untouched. Undo: the previous package
  stays in `dlzmod-update/previous/`; "Revert" rebuilds with it; `boot.scr` counts start attempts on
  DLZDATA and after two failed ones starts update mode with the previous package. Needs Mackie's
  U-Boot features that are only [static] (`fatwrite`, `setexpr`, `fdt`) and an installer booted by
  Mackie's U-Boot (so far only Debian's U-Boot boots it): highest device-review tier.
