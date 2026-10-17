# Tests

PC rehearsals of what runs on the mixer. They run the mixer's own ARM programs from the eMMC dump under
qemu (binfmt), so they test the exact binaries the mixer uses, at a fraction of the speed. Output and
logs go to `build/` (git-ignored); card images go to `/root` in WSL and are deleted afterwards.

## What they need

- WSL distro **Ubuntu**, as root, from the repo root, with `qemu-user-static` (binfmt), e2fsprogs,
  dosfstools, cpio, zstd, openssl, python3
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
| `update.sh` | The drop-in update on a card, what only a card shows: installs (each start approved as the screen's Install would; case 3a without it: asked first, #65), the sandbox, placing and putting back, power cuts and retries, the card's own OpenSSL and tar on a few signature cases, a card on v0.1.0's updater taking the package. `QUICK=1`: only the install, good updates (v0.1.0 included), model/marker and guards. The package checks that need no card are in `update-checks.sh`. Runs side by side are fine: the updater calls take turns on a lock in `/tmp`, as they switch the PC's own user namespace setting off and on (#122); a run that starts with that setting at 0 stops with a FAIL (left by an earlier run) | ~9 min, quick ~2 min |
| `compare-negative.sh` | The install's compare must catch planted faults (a data byte, the group table, a backup superblock, p1's tail, a killed card side) and pass harmless ones | ~6 min |
| `fullsize.sh` | The install on the XS dump and on a full-size test image; each card checked as its own model and refused as the other (`SKIP_XS=1`: full-size only) | ~8 min |
| `guards.sh` | The build tools' refusals around the update keys, no root, dump or image needed (GitHub runs it too): `mkkeys.sh` (no key folder in the repo, never overwrites), `mkpackage.sh` and `build-sd.sh` (an own `dev.pub` must be a public key and match its `dev.pem`), `card-core.sh`'s key install per channel (`DLZMOD_DEV_PUB` only without a `package.env`), `mkinstaller.sh` (a release package's image only from a clean tree at the package's commit) | ~2 s |
| `update-checks.sh` | The drop-in updater without a card, no dump or image, as a normal user (refuses root; GitHub runs it too, after fetching the `v*` tags). Every released updater's own gate for a new copy of itself (guard list, gate strings, parses), cut from its tag and run on this one, with controls that it can refuse; every function defined before its first use. Then the updater in checks-only mode (`DLZMOD_CHECK_ONLY=1`: signature, package, model, firmware, version and guard checks, then it stops) on a fixture tree, against packages built here like `mkpackage.sh` does and signed with throwaway keys: good ones pass, ~25 crafted ones are refused with the right reason, and no run changes a file | ~15 s |
| `patches.sh` | The patches on the dump's own `app.js` and `server.js`, no card: every anchor once (`patch.py --check`), the patched files (and the mod's own JS) parse by the mixer's own node under qemu, with the originals as a control, and the patched `server.js` keeps the refusals the updater checks for | ~6 s |
| `cardcheck.sh` | The card's gate before the FPGA loader (`dlzmod-cardcheck`) in a fake tree: own mixer, other mixer, other model (also `any` cards), the eMMC's firmware moved on, no or unreadable eMMC; the last cases read the dump with the device's own debugfs | ~30 s |
| `cardbind.sh` | The default run for both models: the gate, one card per model from the rig cache (binding, gate files, model accepted and the other refused), then the update tests on copies in parallel (XS all, full-size quick). `FULL=1` adds the full-size rehearsal from a fresh source (when the install's write path changes, and on a release candidate) | ~17 min, ~10 with cached cards |
| `backup-other-firmware.sh` | The backup for a mixer on other firmware (#46): hardware report, bootloader check, the backup onto a fake installer card, checked from outside | ~5 min |

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
| The updater's apply, place or restore, the sandbox, `apply-mod.sh`, units | `update-checks.sh`, then `update.sh` (XS) and `QUICK=1` on the full-size, or `cardbind.sh` |
| What the updater says or names (report texts, file names) | `update-checks.sh` for the checks' texts (it writes no report); the push to the mixer shows the report and its name |
| `patch.py` anchors, the app or server mod's JS | `patches.sh` (seconds) and the UI sandbox |
| The installer's write steps, `card-core.sh`, `build-sd.sh` | `rehearse-install.sh`, `fullsize.sh`, `compare-negative.sh` as the write path asks, then `cardbind.sh` |
| The installer's texts, screens and log names | `dev/installer-mockup.py --check` (screens); the install on the mixer shows the rest |
| The card's gate (`dlzmod-cardcheck`) | `cardcheck.sh`, `cardbind.sh` |

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
bash tests/rig.sh clean   # when done testing
```

Keep full logs and filter them afterwards: a filter in the pipe can hide the line that failed. Never
edit a test script while it runs (bash reads scripts as it goes). The app and server mods' unit tests
run on Windows too: `node install/server-mod/test-dlzmod-server.js`, `node install/app-mod/test-dlzmod.js`.
