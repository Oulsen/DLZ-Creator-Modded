# Tests

PC rehearsals of what runs on the mixer. They run the mixer's own ARM programs from the eMMC dump under
qemu (binfmt), so they test the exact binaries the mixer uses, at a fraction of the speed. Output and
logs go to `build/` (git-ignored); card images go to `/root` in WSL and are deleted afterwards.

## What they need

- WSL distro **Ubuntu** 24.04 or later, as root, from the repo root, with qemu 8 or later and its
  binfmt registration (`qemu-user` + `qemu-user-binfmt`; 22.04's qemu 6.2 cannot run the mixer's
  busybox in a pipe, `rig.sh` stops on it, #190), e2fsprogs, dosfstools, cpio, zstd, openssl, python3
- The dump: `/root/dlz/orig.img`, mounted read-only at `/mnt/dlz` by `install/mount-ro.sh` (the dump
  is only ever read; the full-size tests work on a copy). Keep WSL alive while they run
  (`wsl -d Ubuntu -u root -e sleep 7000` in the background): an idle WSL drops the mount
- A package to test: `install/release/mkpackage.sh` (a working tree with changes builds an unsigned
  `+dirty` package; the tests that need signatures make their own throwaway keys)

## The tests

| Script | What it does | Time |
|---|---|---|
| `rig.sh` | Cache: the full-size source (a copy of the dump without `/root/.dlzlite`, with the full-size's GD32 marker) and one card per package and model, made once. `card` / `copy` / `clean` (~2.5 GB each inside WSL's disk: `clean` at the end) | once per package |
| `rehearse-install.sh` | The installer's write steps (`install-card.sh`) on the dump as the eMMC and a loop file as the card: copy, compare, backup, card build, bootloader. The progress lines are timed (`<card>-prog-*.txt` next to the log): a mean gap over 6 s or one over 20 s fails (slow progress rounds once slowed the copy on the mixer by half), and so does a shown time left far from the real one (#66) | ~2.5 min |
| `update.sh` | The drop-in update on a card, what only a card shows: installs (each start approved as the screen's Install would; case 3a without it: asked first, #65), the sandbox, placing and putting back, power cuts and retries, the card's own OpenSSL and tar on a few signature cases, cards on v0.1.0's and v0.2.0's updaters refusing the package (a full install since v0.3.0), the new updater placing missing #140 and #141 drop-ins at a start, withdrawing a key (#63: only by the updater, kept when the package fails, nothing undoes it) (these need the `v*` tags: `git fetch --tags` in a clone). `QUICK=1`: only the install, good updates (the v0.1.0 and v0.2.0 refusals included), model/marker and guards. `CASES=3c,75`: only those cases (each sets up what it needs; a name the file does not have is a FAIL), for the rounds of a fix; `SHARD=2/4`: every 4th case from the 2nd on (`cardbind.sh` runs the parts side by side). Each case header carries the time since the start, and the end of the log the time per case: nearly all of it is the updater under qemu (an install ~15 s, a refusal ~3-6 s), crafting the packages a few seconds in all. The package checks that need no card are in `update-checks.sh`. Runs side by side are fine: the updater calls take turns on a lock in `/tmp`, as they switch the PC's own user namespace setting off and on (#122); a run that starts with that setting at 0 stops with a FAIL (left by an earlier run). `UNS_PRIVATE=<value>` (`cardbind.sh`'s parts) leaves the lock out: the caller holds the PC's setting at 0 for the whole run, and the run's updater switches its own file, bound over the setting in its chroot | ~18-20 min in one run, quick ~3 min; a single case seconds to a minute |
| `compare-negative.sh` | The install's compare must catch planted faults (a data byte, the group table, a backup superblock, p1's tail, a killed card side) and pass harmless ones | ~6 min |
| `fullsize.sh` | The install on the XS dump and on a full-size test image; each card checked as its own model and refused as the other (`SKIP_XS=1`: full-size only) | ~8 min |
| `guards.sh` | The build tools' refusals around the update keys, no root, dump or image needed (GitHub runs it too): `mkkeys.sh` (no key folder in the repo, never overwrites), `mkpackage.sh` and `build-sd.sh` (an own `dev.pub` must be a public key and match its `dev.pem`), `card-core.sh`'s key install per channel (`DLZMOD_DEV_PUB` only without a `package.env`), `mkinstaller.sh` (a release package's image only from a clean tree at the package's commit) | ~2 s |
| `clock.sh` | The clock saver (`dlzmod-clock`, #1) without a card or root (GitHub runs it too): the save in fake-hwclock's format, atomic, the old file kept when it cannot write; the start's choice of time from DLZDATA's files (just past the newest one up to 2 min ahead, nothing otherwise, nothing from a search over its limit); `zone` running only `hwclock --systz --utc` (a stand-in), also before `floor`; `floor` on a folder through a stand-in `date` (only `date -s` caught); `run` saving at once and, at a TERM, once more and ending at once, giving the kernel the zone at its start and again when the offset changes (a stand-in `date +%z`). Never sets the clock or this computer's time zone | ~2 s |
| `bootreport.sh` | The report of each start (`dlzmod-bootreport`) with stand-ins for `systemd-analyze`, `systemctl`, `journalctl` and `sleep`, no root, dump or image needed (GitHub runs it too): a normal start (each section, the caps, the service lines, the audio chips' lines), a kernel stack dump (its body left out and counted, its CPU line and other warnings kept), a chip that does not answer (shown, its 99 retries as one line and a count, also when they are numbered and alternate between two addresses; shown after 40 other lines, past the cap of 30), a start that finishes late (polled every 15 s) and one that never finishes (gives up after 5 min, names the waiting jobs, still reports); the syslog written through while it waits, the boot log started at the end. Then the boot log itself (`dlzmod-bootlog`): the last 4 SD-system starts, oldest first, without the stock ones, only the final file in its `/run` folder, no mount | ~1 s |
| `bootlog-copy.sh` | The boot log copy to DLZDATA (#136, `DLZMOD_bootlogCopy` through `bootlog-rig.js`) on the mixer's own node against a real FAT image mounted read-only under `/tmp/mnt` as server.js mounts DLZDATA: a copy that moves the last one to `.prev`, read-only again after it, and power cuts (copies of the image every ~0.2 s while it writes and after it), each judged (the old pair, the new pair, or the last one only as `.prev`) and checked with `fsck.fat`. Found that a rename over an existing `.prev` needs a sync of the renamed file: without it a power cut left `.prev` pointing at free clusters | ~1 min |
| `netlog.sh` | A dev card's network log (`dlzmod-netlog`) with stand-ins for `ip` and `journalctl` and a UDP receiver on loopback, no root, dump or image needed (GitHub runs it too): off without its file, odd files refused, waits for the route, every line its own datagram (backslashes kept), quiet when nobody listens | ~2 s |
| `estimates.sh` | The install's copy step time left (`steady()` in `install-card.sh`) replayed on the v0.2.0 install on the mixer, one round every 2 s to the end of the copy, with the installer's own whole-install formula (`copyall()`), and that `ic_copy_tick` carries the shown end from round to round (its text): in the middle of the copy too, the step's and the whole install's time at most 1.5 times the real one (plus half a minute), and a control without `steady()` must fail (#128); no root, dump or image needed (GitHub runs it too). `VERBOSE=1` lists every time, `AWK="qemu-arm vendor/busybox.bin awk"` runs it on the device's awk (WSL) | ~1 s |
| `release-notes.sh` | The notes of a GitHub release (`install/release/release-notes.sh`, run by the tag's workflow): the `CHANGELOG.md` section grouped and in order, prefixes off, issue numbers by exact title, the README's GPL paragraph with its links at the tag, a test tag `vX.Y.Z-testN`, and the stops (no version tag, `VERSION` another one, no or an empty section, a bullet without a DLZ/MOD prefix, no GPL paragraph); and the repo's own section; no root, dump or image needed (GitHub runs it too) | ~1 s |
| `update-checks.sh` | The drop-in updater without a card, no dump or image, as a normal user (refuses root; GitHub runs it too, after fetching the `v*` tags). Every released updater's own gate for a new copy of itself (guard list, gate strings, parses), cut from its tag and run on this one, with controls that it can refuse; that each one's allowlist and shape check (`allowed`, `shape_ok`) take every file and link the sd-system step installs over that version's updater (so without the drop-ins it does not know, as on a card), so a new file cannot make the cards refuse the update, with controls that both can refuse; every function defined before its first use. Then the updater in checks-only mode (`DLZMOD_CHECK_ONLY=1`: signature, package, model, firmware, version and guard checks, then it stops) on a fixture tree, against packages built here like `mkpackage.sh` does and signed with throwaway keys: good ones pass, ~40 crafted ones are refused with the right reason (the withdrawn keys and `REINSTALL_BELOW` too, #63), a real run on the fixture that stops at the question for the screen shows the withdrawal list written and kept, and no checks-only run changes a file | ~15 s |
| `patches.sh` | The patches on the dump's own `app.js` and `server.js`, no card: every anchor once (`patch.py --check`), the patched files (and the mod's own JS) parse by the mixer's own node under qemu, with the originals as a control, and the patched `server.js` keeps the refusals the updater checks for; the Time tab's zones (#9) are in the mixer's tzdata with their real winter offset | ~6 s |
| `cardcheck.sh` | The card's gate before the FPGA loader (`dlzmod-cardcheck`) in a fake tree: own mixer, other mixer, other model (also `any` cards), the eMMC's firmware moved on, no or unreadable eMMC; the last cases read the dump with the device's own debugfs | ~30 s |
| `cardbind.sh` | The default run for both models: the gate, one card per model from the rig cache (binding, gate files, model accepted and the other refused), then the update tests on copies side by side: XS all in 4 parts and full-size quick (#145), with the PC's user namespace setting held at 0 meanwhile (taken under the update tests' lock, put back at the end) and each part's updater switching its own copy of it. `SHARDS=N`: N parts; `SHARDS=1`: one XS run whose updater switches the PC's own setting, as on the mixer (once on a release candidate). `FULL=1` adds the full-size rehearsal from a fresh source (when the install's write path changes, and on a release candidate) | ~6 min with cached cards, ~5 min more to make them for a new package; `SHARDS=1` ~20 min |
| `backup-other-firmware.sh` | The backup for a mixer on other firmware (#46): hardware report, bootloader check, the backup onto a fake installer card, checked from outside | ~5 min |
| `upload.sh` | The update upload from a computer (#114, `DLZMOD_updateUpload` through `upload-rig.js`) on the mixer's own node against a real FAT image mounted read-only under `/tmp/mnt` as server.js mounts DLZDATA: real remounts, `/proc/mounts`, fsync and renames, read-only again after it. An upload replacing an older update, a full card (507), an upload cut off, and power cuts: copies of the image every ~0.2 s while one writes and after its answer, each mounted and judged (no package, the old pair or the whole new pair; after the answer always the new pair), each card checked with `fsck.fat` | ~2 min |

`fixtures/` holds files the update test puts into crafted packages.

## Which checks for which change

The card rehearsals take minutes each: they are for what the mixer must not be the first to try (a
failure, restore or power-cut path, a new write path, the brick angles: anything that could leave a card half-changed
or not starting). What a normal run on the mixer shows (a name, a text, a screen, an update or
install that goes through) is tested on the mixer itself (`dev/push.sh`, an install), after the fast
checks, the sandbox and the device review. Say why before starting a rehearsal.

| Change | Run |
|---|---|
| Notes, docs, issues | nothing (GitHub's checks run on the PR anyway) |
| The server mod | `node install/server-mod/test-dlzmod-server.js`; the UI sandbox for what is visible |
| The app mod | `node install/app-mod/test-dlzmod.js` for its logic (what is shown, enabled, sent or asked), the UI sandbox for what it looks like |
| The updater's checks (`dlzmod-update` before its snapshot), `package.env`, keys | `update-checks.sh` (seconds) |
| The updater's apply, place or restore, the sandbox, `apply-mod.sh`, units | `update-checks.sh`, then `update.sh` with `CASES=` for the cases the change is about (rounds of a fix), and `cardbind.sh` once for the PR |
| What the updater says or names (report texts, file names) | `update-checks.sh` for the checks' texts (it writes no report); the push to the mixer shows the report and its name |
| `patch.py` anchors, the app or server mod's JS | `patches.sh` (seconds) and the UI sandbox |
| The installer's write steps, `card-core.sh`, `build-sd.sh` | `rehearse-install.sh`, `fullsize.sh`, `compare-negative.sh` as the write path asks, then `cardbind.sh` |
| The installer's time left | `estimates.sh` (seconds), then `rehearse-install.sh` (busybox, round gaps); the install on the mixer shows the real times (its `progress:` lines) |
| The installer's texts, screens and log names | `dev/installer-mockup.py --check` (screens); the install on the mixer shows the rest |
| The card's gate (`dlzmod-cardcheck`) | `cardcheck.sh`, `cardbind.sh` |
| The report of each start (`dlzmod-bootreport`) and the boot log (`dlzmod-bootlog`) | `bootreport.sh` (seconds); the mixer shows the real report ~2 min after a start |
| A dev card's network log (`dlzmod-netlog`, `dev/netlog.*`) | `netlog.sh` (seconds); then on the dev card with `dev/netlog.ps1` |
| The release notes, the tag's workflow (`release-notes.sh`, `.github/workflows/release.yml`) | `release-notes.sh` (seconds); then a test tag `vX.Y.Z-testN` on GitHub (its draft and tag deleted afterwards) |
| The server mod's writes to DLZDATA (the update upload, the boot log copy) | the server mod's unit tests, then `upload.sh` / `bootlog-copy.sh` |

`update-checks.sh` in WSL, where the default user is root: as `nobody`, from the repo root:
`setpriv --reuid=65534 --regid=65534 --clear-groups env HOME=/tmp bash tests/update-checks.sh`.

## Typical runs

```bash
# one package, then the cached cards for both models
bash install/release/mkpackage.sh
P=$(ls -td build/release/dlzmod-*+dirty | grep -v tar$ | head -1)
bash tests/rig.sh copy XS $P /root/upd.img && bash tests/update.sh /root/upd.img $P.tar > build/update-XS.log 2>&1
QUICK=1 bash tests/update.sh "$(bash tests/rig.sh copy full-size $P /root/upd-f.img)" $P.tar > build/update-full-size.log 2>&1
rm -f /root/upd.img /root/upd-f.img
# a round of a fix: only the cases it is about, on a fresh copy
CASES=3c,75 bash tests/update.sh "$(bash tests/rig.sh copy XS $P /root/upd.img)" $P.tar > build/update-XS.log 2>&1; rm -f /root/upd.img
bash tests/rig.sh clean   # when done testing
```

The update test runs the card's own programs (bash, OpenSSL, tar, python3, the small tools) under
qemu, and stays that way: a native busybox or the PC's tools in the chroot would make it faster, but
it would then test other programs than the ones the mixer runs (the card's OpenSSL checks the
signatures, its tar and cpio unpack the package, its python3 runs `patch.py`). The time is won by
running the cases side by side instead (`cardbind.sh`) and by running only the cases a fix is about
(`CASES=`).

Keep full logs and filter them afterwards: a filter in the pipe can hide the line that failed. Never
edit a test script while it runs (bash reads scripts as it goes). The app and server mods' unit tests
run on Windows too: `node install/server-mod/test-dlzmod-server.js`, `node install/app-mod/test-dlzmod.js`.
