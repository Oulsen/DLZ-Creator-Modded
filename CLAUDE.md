# DLZ Creator Modded

Reverse engineering and modding the Mackie DLZ Creator and DLZ Creator XS (Allwinner A40i,
Armbian/Ubuntu 22.04 armhf; one firmware for both, the factory marks an XS with `/root/.dlzlite`).
Mods run from a microSD clone of the eMMC; the eMMC stays stock. Our dump and test mixer are an XS;
the full-size runs the same firmware (build 1731) but is untested.

## Read first

- `notes/architecture.md`: how the software fits together (start here)
- `notes/modding-guide.md`: ground rules, hook points, dev loop
- `notes/system.md`, `notes/components/*.md`, `notes/hardware.md`, `notes/mod.md`, `notes/updates.md` for details
- `notes/open-questions.md` before assuming anything tagged **[guess]**

Keep these notes current: when a fact is learned or verified, update the note and its confidence
tag (**[device]** / **[static]** / **[guess]**) instead of leaving it in the conversation.

## Hard rules

- Never write to the eMMC or to the dump. Analysis is read-only (`install/mount-ro.sh`).
- Never run Mackie updaters from SD; never touch the GD32 (firmware, markers, openocd); never
  add or remove `/root/.dlzlite` (it picks the GD32/FPGA firmware per model).
- Every mod must be reproducible via `install/build-sd.sh` from a clean dump.
- Nothing new or changed runs on the mixer or lands on a card (mod changes, `install/**`, U-Boot
  scripts, `uboot.env`, initramfs, installer, spikes, rebuilt images) before the `device-review`
  skill has run, once per image that goes onto the mixer: as much review as the change's risk tier
  asks for (no agent where the tests and the sandbox fully show the change, 1 combined reviewer for
  other logic, up to 2 informed + 2 blind, all at once, for new write paths and boot routes; the
  brick angle is part of every review), claims verified, findings fixed or consciously accepted.
- `VERSION` is the mod version shown on the boot screens and in Settings (`v0.1.0` .. `v9.99.99`);
  bump it only when functionality is added or changed, not for cosmetic tweaks.
- The install guide (`docs/INSTALL.md`) shows the installer's screens (`docs/images/install/`, with
  the version sticker). When an installer text, its look or `VERSION` changes: copy changed texts
  into `dev/installer-mockup.py`, re-render with `--no-sheet docs/images/install`, and read the guide
  against the change. `--check docs/images/install` (WSL) says whether the screens are current.
- The roadmap lives on GitHub: every bug and feature is an issue in `Oulsen/DLZ-Creator-Modded`
  on the board https://github.com/users/Oulsen/projects/2 (life cycle, labels and milestones:
  `docs/DEVELOPMENT.md` "GitHub workflow"). Title `(DLZ FEATURE|DLZ BUG|MOD FEATURE|MOD BUG) ...`
  in plain language, no technical terms (DLZ FEATURE = something the mod lets the mixer do, MOD
  FEATURE = the mod itself: install, updates, safety, support, development; DLZ BUG = stock Mackie
  behaviour, MOD BUG = caused by the mod; a new feature request starts as DLZ FEATURE until triage
  says otherwise; the type label matches the prefix: `dlz-feature`, `dlz-bug`, `mod-feature`,
  `mod-bug`), or
  `(ANALYSIS) ...?` for an idea that first needs research (label `analysis`); lasting knowledge lives
  in the topic notes and the body points to it, work details of one issue go into its own body (a
  collapsed `<details>` block under "Technical notes"). There is no backlog file: to-dos are issues,
  progress is the board. A new
  roadmap item = a new issue (with `gh`, after the user agrees); when work starts or finishes, move
  its card on the board. Never post Mackie code or dump secrets in issues. A defect found in what
  the release being worked on brings (not shipped yet) is simply fixed, without an issue; a defect
  in a released version, or in stock Mackie behaviour, gets a `MOD BUG` / `DLZ BUG` issue.
- Never commit to `main` or `develop` directly: every change on its own branch from `develop`, a PR
  into `develop` (`/pr`, squash-merged by the user); a release is a PR `develop` → `main`,
  fast-forwarded by the user with `git push origin <commit>:main` (never the merge button), so `main`
  and `develop` stay one commit (`docs/DEVELOPMENT.md`, "Branches" and "Releases"). After the PR is
  open, `/cr` (or `/code-review`) reviews the PR itself, docs-only PRs too, so changes made after
  the device review are caught; findings fixed as new commits on the PR or named in the PR body,
  before the merge (`docs/DEVELOPMENT.md`, "Review").
- With every version bump, write a `## vX.Y.Z` section in `CHANGELOG.md` (newest version first)
  from the milestone's issues: their titles as bullets, in the order DLZ FEATURE, DLZ BUG, MOD
  FEATURE, MOD BUG (the release PR and the release notes use the same order, as sections). Update the README's "What the mod does" (the current mod, by
  group) in the same bump.
- `dumps/` and `build/` are private and git-ignored. Never commit Mackie binaries, dumps or `.upd`
  files; in notes, describe Mackie code and point to it (file, function, search string), never paste
  it. Names, paths, settings, message fields and `patch.py`'s anchors are fine; copied code lines are not.
- Never write secrets from the dump into notes or output (password hashes, SSH keys, Wi-Fi
  credentials, the `lock` value, personal emails in `package.json`): state presence only.

## UI sandbox (the dev page, http://127.0.0.1/)

- "The dev page" / "the sandbox" = Mackie's mixer UI running on this PC in the device layout, with
  the mod's patches. Start, re-patch, screenshots and stop: the `ui-sandbox` skill
  (`.claude/skills/ui-sandbox/`). Always stop it with the skill's `stop`: ending the background
  task alone leaves node.exe on ports 80/89 and the sandbox drive mapped.
- Details and limits: `notes/modding-guide.md`, section "PC sandbox".

## Working with the dump (WSL)

- The rootfs lives in `/root/dlz/orig.img` in WSL distro **Ubuntu** (not the default
  `docker-desktop`). Mount, from the repo root: `wsl -d Ubuntu -u root -e bash install/mount-ro.sh`
  → `/mnt/dlz`.
- From Git Bash, set `MSYS_NO_PATHCONV=1` or `/mnt/...` paths get mangled.
- WSL drops the mount when the distro idles out: keep it alive with a background
  `wsl -d Ubuntu -u root -e sleep 7000`, or remount.
- Available in WSL: strings, readelf, objdump, file, python3 (Pillow), debugfs, dtc, qemu-user, ffmpeg,
  dosfstools. Not: node, rg, jq.
- Device binaries from the dump run under emulation, read-only:
  `QEMU_LD_PREFIX=/mnt/dlz LD_LIBRARY_PATH=$L/blas:$L/lapack:$L qemu-arm /mnt/dlz/usr/bin/<tool>` with
  `L=/mnt/dlz/usr/lib/arm-linux-gnueabihf` (blas/lapack are absolute `/etc/alternatives` links).
- Bundles `/srv/server.js` and `/srv/app.js` are minified one-liners: search with
  `grep -o ".\{40\}ANCHOR.\{40\}"`, never print whole lines.
