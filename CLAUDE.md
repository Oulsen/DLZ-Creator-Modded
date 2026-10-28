# DLZ Creator Modded

Reverse engineering and modding the Mackie DLZ Creator and DLZ Creator XS (Allwinner A40i,
Armbian/Ubuntu 22.04 armhf; one firmware for both, the factory marks an XS with `/root/.dlzlite`).
Mods run from a microSD clone of the eMMC; the eMMC stays stock. Our dump and test mixer are an XS;
the full-size runs the same firmware (build 1731); one owner's full-size installed and ran v0.1.0
(`notes/hardware.md`, "Full-size DLZ Creator").

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
  skill has run: on a PR that changes what runs on the mixer, after `/cr` and its fixes and before
  the drop-in and the merge (below); on an image, spike or card, for what no merged PR's review
  covered (build scripts, the card, the installer, a spike): as much review as the change's risk tier
  asks for (no agent for tests-covered changes and other mod logic, which Claude reads against the
  skill's brick checklist; 1 blind brick reviewer for a sensitive path; 2 reviewers, all at once,
  for new write paths and boot routes; the brick angle is part of every review), claims verified,
  findings fixed or consciously accepted. Reviews are kept lean (Pro plan): no more agents than the
  tier asks, `model: sonnet` unless the skill names Opus.
- Card rehearsals (`tests/README.md`: card images, minutes each) only for what the mixer must not
  be the first to try: failure, restore and power-cut paths, new write paths, the brick angles. What
  a normal run on the mixer shows (a name, a text, a screen, an update or install that goes through)
  is tested on the mixer itself, after the fast tests, the sandbox and the device review. Say why
  before starting a rehearsal.
- `VERSION` is the mod version shown in Settings and on the installer's screens (`v0.1.0` .. `v9.99.99`);
  bumped in `develop` right after a release (below); a new version is released only when
  functionality is added or changed, not for cosmetic tweaks.
- The install guide (`docs/INSTALL.md`) shows the installer's screens (`docs/images/install/`, with
  the version sticker). When an installer text, its look or `VERSION` changes: copy changed texts
  into `dev/installer-mockup.py`, re-render with `--no-sheet docs/images/install`, and read the guide
  against the change. `--check docs/images/install` (WSL) says whether the screens are current.
- The roadmap lives on GitHub: every bug and feature is an issue in `Oulsen/DLZ-Creator-Modded`
  on the board https://github.com/users/Oulsen/projects/2 (life cycle, labels and milestones:
  `docs/DEVELOPMENT.md` "GitHub workflow"). Title `(DLZ FEATURE|DLZ BUG|MOD FEATURE|MOD BUG|DEV) ...`
  in plain language, no technical terms (DLZ FEATURE = something the mod lets the mixer do, MOD
  FEATURE = the mod itself: install, updates, safety, support; DLZ BUG = stock Mackie
  behaviour, MOD BUG = caused by the mod; DEV = our own tools: tests, reviews, the dev card, build
  and release scripts, CI, features and bugs alike, never in the changelog; a new feature request
  starts as DLZ FEATURE until triage says otherwise; the type label matches the prefix:
  `dlz-feature`, `dlz-bug`, `mod-feature`, `mod-bug`, `dev`), or
  `(ANALYSIS) ...?` for an idea that first needs research (label `analysis`); lasting knowledge lives
  in the topic notes and the body points to it, work details of one issue go into its own body (a
  collapsed `<details>` block under "Technical notes"). There is no backlog file: to-dos are issues,
  progress is the board. A new
  roadmap item = a new issue (with `gh`, after the user agrees); when work starts or finishes, move
  its card on the board (Todo, Next Version, In progress; after the merge close the issue with
  "Fixed in develop, comes with vX.Y.Z." and move it to Fixed in develop; Released at the
  release). Never post Mackie code or dump secrets in issues. A defect found in what
  the release being worked on brings (not shipped yet) is simply fixed, without an issue; a defect
  in a released version, or in stock Mackie behaviour, gets a `MOD BUG` / `DLZ BUG` issue.
- Never commit to `main` or `develop` directly: every change on its own branch from `develop`, a PR
  into `develop` (`/pr`, squash-merged by the user); a release is a PR `develop` → `main`,
  fast-forwarded by the user with `git push origin <commit>:main` (never the merge button), so `main`
  and `develop` stay one commit (`docs/DEVELOPMENT.md`, "Branches" and "Releases"). Every PR: `/pr`
  → `/cr` → fixes → the user merges. Right after `/pr`, start `/cr` on the opened PR (the
  `code-reviewer` agent with `model: sonnet`), so the whole diff is read; a docs-only PR gets no
  agent, Claude reads it for consistency and correctness instead; findings fixed as new commits on
  the PR or named in the PR description, before the merge; Claude checks the fixes itself, no
  second agent pass. Only a PR that changes the mod or anything else that runs on the mixer adds two
  steps before the merge: the device review on the PR's final diff, then a drop-in of its branch on
  the dev card (`dev/push.sh`) that the user looks at; a fix from either is a new commit on the PR,
  which the device review reads again at its tier. Docs and DEV PRs skip both (`docs/DEVELOPMENT.md`,
  "Review" and "On the mixer before the merge"). The release PR `develop` → `main` too: once the milestone's
  issues are done, one final `/cr` on it before the fast-forward ("Releases", step 2).
- Right after a release, bump `VERSION` in `develop` as its own PR (`docs/vX.Y.Z-bump`), before any
  other change of the new cycle; a feature or fix branch never bumps (`docs/DEVELOPMENT.md`,
  "Version bump"). The bump PR opens a `## vX.Y.Z` section in `CHANGELOG.md` (newest version first);
  every PR that finishes a milestone issue adds its title there as a bullet, in the order DLZ
  FEATURE, DLZ BUG, MOD FEATURE, MOD BUG, no DEV (the release PR and the release notes use the same
  order, as sections). The same PR updates the README's "What the mod does" (the current mod, by group)
  when it changes what the mod does.
- `dumps/` and `build/` are private and git-ignored. Never commit Mackie binaries, dumps or `.upd`
  files; in notes, describe Mackie code and point to it (file, function, search string), never paste
  it. Names, paths, settings, message fields and `patch.py`'s anchors are fine; copied code lines are not.
- Never write secrets from the dump into notes or output (password hashes, SSH keys, Wi-Fi
  credentials, the `lock` value, personal emails in `package.json`): state presence only.

## UI sandbox (the dev page, http://127.0.0.1/)

- "The dev page" / "the sandbox" = Mackie's mixer UI running on this PC in the device layout, with
  the mod's patches. Start, re-patch, screenshots and stop: the `ui-sandbox` skill
  (`.claude/skills/ui-sandbox/`). Always stop it with the skill's `stop`: ending the background
  task alone leaves node.exe on ports 80/89.
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
