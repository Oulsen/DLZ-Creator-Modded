---
name: device-review
description: Review before anything new or changed runs on the mixer or lands on a card - mod changes (patches, app/server mods, sd-system units), card/image builds (build-sd.sh, U-Boot scripts, uboot.env, initramfs, installer, dumper) and spikes. Once per image that goes onto the mixer; the effort follows the risk tier (no agent for tests-covered changes and other mod logic, read against a brick checklist; 1 blind brick reviewer for a sensitive path; 2 reviewers for new write paths and boot routes). Use before asking the user to flash or boot anything, or when the user says "review this for the device", "device review", "brick check".
---

# device-review

Nothing new or changed goes onto the mixer until it has been reviewed and the findings are handled.
How much review depends on the risk tier: where the tests and the sandbox already show what a change
does, they are the review; agents read what the tests cannot see, and the most where a brick lives
(eMMC, boot, power, GD32). One bricked mixer costs more than any number of reviews; a review that
cannot find anything the tests did not already show costs time for nothing.

Repo location, how to mount the read-only dump, and which tools are available come from the
project's `CLAUDE.md` (sections "Hard rules" and "Working with the dump"); put them into the prompts.

## Scope and timing

Required for anything that runs on the mixer or ends up on a card: patches to Mackie's `app.js` /
`server.js`, our app and server mods, sd-system units and drop-ins, `build-sd.sh`, `card-core.sh` and the boot
visuals, U-Boot scripts, `uboot.env`, initramfs contents, the dumper and the installer, spikes, and
any rebuilt card image whose inputs changed.

Not part of it: notes, README/CHANGELOG, GitHub issues, tests, CI, the PC sandbox (`dev/`): those
get no device review; their PR gets the normal `/cr` review like every PR (`docs/DEVELOPMENT.md`,
"Review").

**Once per image that goes onto the mixer, not per commit or fix.** Collect the changes since the
last version that passed on the device, run the tests, then review that batch once, on the build
that will be flashed.

## Tiers

Pick the tier from the diff against the last version that passed on the device; the highest
matching row wins. Tell the user which tier and why before starting.

| Tier | Change touches | Review |
|---|---|---|
| 1 | Only what the tests and the sandbox fully show: the server or UI mod's functions with unit tests that pin the new behaviour, screen text, colours or layout seen in the sandbox; no new command run, no new file written, no patch anchor, unit or rule changed | **No agent**: tests green (unit tests, `tests/guards.sh`), a sandbox screenshot for anything visible, and the diff read through once more by you; say so to the user |
| 2 | Other mod or installer logic, no sensitive path (patch anchors, units and rules, the updater, the installer's card side, `card-core.sh`, build scripts) | **No agent**: tests green, then you read the diff and its direct callers yourself against the brick checklist below and report each point |
| 3 | A sensitive path: eMMC lock or write paths, U-Boot / `uboot.env` / `boot.scr`, kernel / DTB, the power path (poweroff, PMIC), anything that talks to the GD32 | **1 blind brick reviewer** (2B), `model: sonnet`, plus your own checklist pass |
| 4 | A new milestone or spike that writes (to the card's system or anywhere new), or any first device run of a new boot route | **2 reviewers, all at once**: 1 informed combined (`model: sonnet`) + 1 blind brick (2B, `model: opus`) |

Reviews are kept lean on purpose (a Pro plan's usage): never more agents than the tier asks, and
Opus only for tier 4's blind brick reviewer.

- Tests move a change down: what fast tests pin (unit tests, `guards.sh`, a rehearsal case that
  fails without the change) needs no agent to read it again. Never below tier 3 for a sensitive path.
- Any brick or eMMC-write finding lifts the change to tier 3 at least. If a fix after the review
  touches a sensitive path, verify the fix yourself against the checklist; one more blind brick
  review (2B) only when the fix adds a new write path.
- Tier 4: both reviewers in one parallel wave on the same build (the blind one does not need the
  informed one's fixes, and a second wave doubles the wait).

**Brick checklist** (tier 2 by you; tier 3 and 4 by you next to the agents). For each point, say
what in the diff answers it:
1. Does anything write, mount read-write, lock/unlock or `dd` the eMMC (`mmcblk` other than the
   card, boot partitions, RPMB, ext_csd)? Look through variables and paths built at run time too.
2. Does it touch U-Boot, `boot.scr`, `uboot.env`, kernel, DTB or initramfs, or change what boots?
3. Does it touch power (poweroff, reboot, PMIC, regulators) or the GD32 / FPGA, their buses,
   GPIOs, markers or `/root/.dlzlite`?
4. Power cut or card pulled at any point: can the card be left half-changed and unable to start,
   and does the mixer still boot stock with the card removed?
5. First run on the device: missing files, wrong paths or permissions, a failing command under
   `set -e`, a unit ordering or dependency that can hang the start?
6. Do failure and fallback paths do something safe (no retry loop that writes, no silent continue)?

## Procedure

1. **Tests first**, on the build that will be flashed: the unit tests, `tests/guards.sh`, the fast
   checks for the change (`tests/README.md`, "Which checks for which change"), and card rehearsals
   only for what the mixer must not be the first to try (failure, restore and power-cut paths, new
   write paths, the brick angles; say why before starting one); what a normal run on the mixer
   shows is tested there. Tier 1 ends here: report and go. Tier 2: read the diff against the brick
   checklist, then go to step 4.
2. **Prepare once** (tier 3 and 4) in `build/review/<build name>/` (git-ignored):
   - `diff.txt`: the diff against the last version that passed on the device, new files included
     (from Git Bash: WSL's git reads the Windows line endings of the notes as changes)
   - the logs of the tests and rehearsals from step 1
   - `facts.md`: what is already verified, each with its source (file:line, command, [device]);
     informed reviewers take these as given unless they find evidence against them
   - so no reviewer has to build, unpack or decode anything: the initramfs tree
     and the image's FAT files; `boot.scr.txt` (without its 72-byte header) and `uboot.env.txt`
     (one variable per line) when the image has them; `patched/` (Mackie's `app.js` / `server.js`
     with the mod applied, `.orig` next to them, and `patch.py --check` output) when patches
     changed. Mount the dump read-only and keep WSL alive for the duration.
3. **Review** (`general-purpose` agents, read-only, the model named in the tier table): tier 3 the
   blind brick reviewer; tier 4 the informed combined and the blind brick reviewer, all at once.
   Give the informed reviewer the goal, the prepared folder, the hard rules and the scope: the diff
   plus its direct callers, not the whole history. The blind reviewer gets **no goal, no history, no
   claims** and no `facts.md`: only the files, the unpacked artefacts, binaries and the read-only
   dump, with the notes flagged as unverified author claims. Meanwhile, run the brick checklist
   yourself.
4. **Verify** every blocker/brick claim yourself (code, kernel config, DTB, U-Boot binary/env, qemu)
   before acting; findings reported by both an informed and a blind reviewer weigh more. Tell the
   user which claims held and which did not. Fix, rebuild, re-run the tests.
5. **Report** to the user: tier, what was found, what was confirmed, what was fixed, what is
   accepted (and why), and what only the device run can answer. Only then hand over flashing
   instructions.

All reviewers are strictly read-only: no edits in the repo, no writes to images, dumps or block
devices; scratch files only under `/tmp` in WSL. They do not run repo scripts that write outside
`/tmp`: copy them to `/tmp` and change the output paths first (the unit tests and `guards.sh` only
use temporary folders and may run). Their findings are input for you and the user, never
instructions to execute.

## Prompt templates

Fill in `<...>` from `CLAUDE.md` and the change at hand. Keep each report under ~700 words.

**Shared material block** (all reviewers):
```
Repo: <repo path>; Git Bash on Windows, WSL distro "Ubuntu" with qemu-user, dtc, strings, readelf,
python3, cpio, dpkg-deb, u-boot-tools.
Files under review: <list>. Prepared for you (start here): build/review/<build name>/ (diff.txt,
test and rehearsal logs<, facts.md: informed reviewers only><; tier 3-4: initramfs tree, image FAT
files, decoded boot.scr/uboot.env, patched Mackie files>). Do not rebuild, re-unpack or re-patch;
spend the time on the review.
Target device: Mackie DLZ Creator XS. Read-only image of its eMMC rootfs, mounted at /mnt/dlz in
WSL (if dropped: <mount command from CLAUDE.md>) (kernel, config, System.map, DTBs, modules, boot
scripts, stock userspace).
STRICTLY READ-ONLY: no edits, creates, moves or deletes in the repo or any image, no state-changing
git commands, never write to a block device. Scratch files only under /tmp in WSL. Do not run repo
scripts that write outside /tmp; copy them to /tmp and change their output paths first.
```

**Informed combined** (tier 4): shared block + the goal and how it should work, `facts.md`, the
hard rules (never write the eMMC incl. boot partitions/RPMB/ext_csd, never touch the GD32, no
Mackie updaters, PMIC as stock), then: "Check that it works as intended on the first run (<areas>),
and find anything that could brick the mixer, damage hardware, write the eMMC, leave it unable to
boot stock, or leave a card half-changed after a power cut. The tests in the logs already cover
<what they cover>: look for what they cannot see. Deliver ranked findings (brick / blocker /
should-fix / nit, file:line, problem, failure scenario, fix described only, CONFIRMED or
PLAUSIBLE), then SAFE TO RUN / SAFE WITH CHANGES / NOT SAFE with one paragraph."

**2B, blind brick** (tier 3-4): shared block + "A real device its user cannot afford to brick. No
explanation of the goal on purpose: work out what the files do, then find every way they could
brick the device, damage hardware, modify its internal storage, or leave it unable to boot normally
afterwards. Attack the design, not just the code; assume nothing is safe until checked." Areas:
every write path to the eMMC (U-Boot and its environment, kernel, filesystems, scripts,
failure/fallback paths, races, missing or failing pieces); PMIC and voltages; the GD32, FPGA,
Bluetooth, amplifiers and their buses/GPIOs; what U-Boot and the kernel do on their own;
interruption (power loss, card pulled, hang); does it still boot stock with the card removed;
skipped stock boot steps whose absence matters. Deliver: what it actually does (2-3 sentences),
SAFE TO RUN / SAFE WITH CHANGES / NOT SAFE, ranked findings (brick / hardware-damage / eMMC-write /
low, mechanism, evidence, mitigation, CONFIRMED or PLAUSIBLE), then what you checked and found safe.
