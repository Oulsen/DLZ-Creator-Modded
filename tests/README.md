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
| `rehearse-install.sh` | The installer's write steps (`install-card.sh`) on the dump as the eMMC and a loop file as the card: copy, compare, backup, card build, bootloader. The progress lines are timed (`<card>-prog-*.txt` next to the log): a mean gap over 6 s or one over 20 s fails (slow progress rounds once slowed the copy on the mixer by half) | ~2.5 min |
| `update.sh` | The drop-in update on a card, what only a card shows: installs, the sandbox, placing and putting back, power cuts and retries, the card's own OpenSSL and tar on a few signature cases, a card on v0.1.0's updater taking the package. `QUICK=1`: only the install, good updates (v0.1.0 included), model/marker and guards. The package checks that need no card are in `update-checks.sh` | ~9 min, quick ~2 min |
| `compare-negative.sh` | The install's compare must catch planted faults (a data byte, the group table, a backup superblock, p1's tail, a killed card side) and pass harmless ones | ~6 min |
| `fullsize.sh` | The install on the XS dump and on a full-size test image; each card checked as its own model and refused as the other (`SKIP_XS=1`: full-size only) | ~8 min |
| `guards.sh` | The build tools' refusals around the update keys, no root, dump or image needed (GitHub runs it too): `mkkeys.sh` (no key folder in the repo, never overwrites), `mkpackage.sh` and `build-sd.sh` (an own `dev.pub` must be a public key and match its `dev.pem`), `card-core.sh`'s key install per channel (`DLZMOD_DEV_PUB` only without a `package.env`) | ~2 s |
| `update-checks.sh` | The drop-in updater without a card, no dump or image, as a normal user (refuses root; GitHub runs it too, after fetching the `v*` tags). Every released updater's own gate for a new copy of itself (guard list, gate strings, parses), cut from its tag and run on this one, with controls that it can refuse; every function defined before its first use. Then the updater in checks-only mode (`DLZMOD_CHECK_ONLY=1`: signature, package, model, firmware, version and guard checks, then it stops) on a fixture tree, against packages built here like `mkpackage.sh` does and signed with throwaway keys: good ones pass, ~25 crafted ones are refused with the right reason, and no run changes a file | ~15 s |
| `patches.sh` | The patches on the dump's own `app.js` and `server.js`, no card: every anchor once (`patch.py --check`), the patched files (and the mod's own JS) parse by the mixer's own node under qemu, with the originals as a control, and the patched `server.js` keeps the refusals the updater checks for | ~6 s |
| `cardcheck.sh` | The card's gate before the FPGA loader (`dlzmod-cardcheck`) in a fake tree: own mixer, other mixer, other model (also `any` cards), the eMMC's firmware moved on, no or unreadable eMMC; the last cases read the dump with the device's own debugfs | ~30 s |
| `cardbind.sh` | The default run for both models: the gate, one card per model from the rig cache (binding, gate files, model accepted and the other refused), then the update tests on copies in parallel (XS all, full-size quick). `FULL=1` adds the full-size rehearsal from a fresh source (when the install's write path changes, and on a release candidate) | ~17 min, ~10 with cached cards |
| `backup-other-firmware.sh` | The backup for a mixer on other firmware (#46): hardware report, bootloader check, the backup onto a fake installer card, checked from outside | ~5 min |

`fixtures/` holds files the update test puts into crafted packages.

## Which checks for which change

| Change | Run |
|---|---|
| Notes, docs, issues | nothing (GitHub's checks run on the PR anyway) |
| The server mod | `node install/server-mod/test-dlzmod-server.js`; the UI sandbox for what is visible |
| The updater's checks (`dlzmod-update` before its snapshot), `package.env`, keys | `update-checks.sh` first (seconds); then `update.sh` on a card before the device |
| The updater's apply, place or restore, the sandbox, `apply-mod.sh`, units | `update-checks.sh`, then `update.sh` (XS) and `QUICK=1` on the full-size, or `cardbind.sh` |
| `patch.py` anchors, the app or server mod's JS | `patches.sh` first (seconds); the UI sandbox; `update.sh` before the device (patching runs in its sandbox) |
| The installer, `card-core.sh`, `build-sd.sh` | `rehearse-install.sh`, `fullsize.sh`, `compare-negative.sh` as the write path asks, then `cardbind.sh` |
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
edit a test script while it runs (bash reads scripts as it goes). The server mod's unit tests run on
Windows too: `node install/server-mod/test-dlzmod-server.js`.
