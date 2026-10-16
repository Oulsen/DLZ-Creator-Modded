---
name: device-review
description: Review before anything new or changed runs on the mixer or lands on a card - mod changes (patches, app/server mods, sd-system units), card/image builds (build-sd.sh, U-Boot scripts, uboot.env, initramfs, installer, dumper) and spikes. Once per image that goes onto the mixer; the effort follows the risk tier (no agent when the tests and the sandbox cover a change, 1 combined reviewer for other logic, up to 2 informed + 2 blind for new write paths and boot routes). Use before asking the user to flash or boot anything, or when the user says "review this for the device", "device review", "brick check".
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
| 2 | Other mod or installer logic, no sensitive path (patch anchors, units and rules, the updater, the installer's card side, `card-core.sh`, build scripts) | **1 combined reviewer** (works + brick angle), `model: sonnet`, on the diff, the test logs and `facts.md` |
| 3 | A sensitive path: eMMC lock or write paths, U-Boot / `uboot.env` / `boot.scr`, kernel / DTB, the power path (poweroff, PMIC), anything that talks to the GD32 | A + B + blind brick 2B, all at once |
| 4 | A new milestone or spike that writes (to the card's system or anywhere new), or any first device run of a new boot route | Full: A + B + 2A + 2B, all at once |

- Tests move a change down: what fast tests pin (unit tests, `guards.sh`, a rehearsal case that
  fails without the change) needs no agent to read it again. Never below tier 3 for a sensitive path.
- Any brick or eMMC-write finding lifts the change to tier 3 at least. If a fix after the review
  touches a sensitive path, run one more blind brick review (2B) on the fixed build.
- Tier 3 and 4: all reviewers in one parallel wave on the same build (the blind ones do not need
  the informed ones' fixes, and a second wave doubles the wait). General reviewers (2, A, 2A) run with
  `model: sonnet`; brick reviewers (B, 2B) with `model: opus`.

## Procedure

1. **Tests first**, on the build that will be flashed: the unit tests, `tests/guards.sh`, the fast
   checks for the change (`tests/README.md`, "Which checks for which change"), and card rehearsals
   only for what the mixer must not be the first to try (failure, restore and power-cut paths, new
   write paths, the brick angles; say why before starting one); what a normal run on the mixer
   shows is tested there. Tier 1 ends here: report and go.
2. **Prepare once** in `build/review/<build name>/` (git-ignored):
   - `diff.txt`: the diff against the last version that passed on the device, new files included
     (from Git Bash: WSL's git reads the Windows line endings of the notes as changes)
   - the logs of the tests and rehearsals from step 1
   - `facts.md`: what is already verified, each with its source (file:line, command, [device]);
     informed reviewers take these as given unless they find evidence against them
   - tier 3 and 4 only, so no reviewer has to build, unpack or decode anything: the initramfs tree
     and the image's FAT files; `boot.scr.txt` (without its 72-byte header) and `uboot.env.txt`
     (one variable per line) when the image has them; `patched/` (Mackie's `app.js` / `server.js`
     with the mod applied, `.orig` next to them, and `patch.py --check` output) when patches
     changed. Mount the dump read-only and keep WSL alive for the duration.
3. **Review** (`general-purpose` agents, read-only): tier 2 one combined reviewer; tier 3 and 4 the
   informed A and B and the blind ones, all at once. Give informed reviewers the goal, the prepared
   folder, the hard rules and the scope: the diff plus its direct callers, not the whole history.
   Blind reviewers get **no goal, no history, no claims** and no `facts.md`: only the files, the
   unpacked artefacts, binaries and the read-only dump, with the notes flagged as unverified author
   claims.
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

Fill in `<...>` from `CLAUDE.md` and the change at hand. Keep each report under ~900 words
(tier 2: ~600).

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

**Tier 2, combined:** shared block + the goal and how it should work, `facts.md`, the hard rules
(never write the eMMC incl. boot partitions/RPMB/ext_csd, never touch the GD32, no Mackie updaters,
PMIC as stock), then: "First confirm from diff.txt that no sensitive path is touched (eMMC lock or
writes, U-Boot/boot.scr/uboot.env, kernel/DTB, power, GD32): if one is, stop and say so, the change
needs tier 3. Then check that it works as intended on the first run (<areas>), and that nothing in
it can write the eMMC, touch the GD32 or change power, or leave a card half-changed after a power
cut. The tests in the logs already cover <what they cover>: look for what they cannot see. Deliver
ranked findings (blocker / should-fix / nit, file:line, problem, failure scenario, fix described
only, CONFIRMED or PLAUSIBLE), then SAFE TO RUN / SAFE WITH CHANGES / NOT SAFE with one paragraph."

**A, informed general** (tier 3-4): shared block + the goal and how it should work, `facts.md`,
then: "Check whether it will work as intended on the first run: <areas>. Deliver a ranked list
(blocker / should-fix / nit, file:line, problem, failure scenario, fix described only, CONFIRMED or
PLAUSIBLE), then a one-paragraph verdict."

**B, informed brick** (tier 3-4): shared block + goal, hard rules (as in tier 2), `facts.md`, then:
"Find anything that could brick the mixer, damage hardware, write the eMMC or leave it unable to
boot stock. Start with SAFE TO RUN / SAFE WITH CHANGES / NOT SAFE, then ranked findings (brick /
hardware-damage / eMMC-write / low, mechanism, evidence, mitigation, CONFIRMED or PLAUSIBLE), then
what you checked and found safe."

**2A, blind general** (tier 4): shared block + "You get no explanation of the goal on purpose: work
out yourself what the files do, then judge whether they will work and what could go wrong. Question
every assumption, including ones that look obviously fine. The repo's notes and README contain the
authors' own claims: treat them as unverified." Deliver: what it actually does (2-3 sentences),
ranked findings as above, assumptions only the device run can answer, verdict.

**2B, blind brick** (tier 3-4): shared block + "A real device its user cannot afford to brick. No
explanation of the goal on purpose: work out what the files do, then find every way they could
brick the device, damage hardware, modify its internal storage, or leave it unable to boot normally
afterwards. Attack the design, not just the code; assume nothing is safe until checked." Areas:
every write path to the eMMC (U-Boot and its environment, kernel, filesystems, scripts,
failure/fallback paths, races, missing or failing pieces); PMIC and voltages; the GD32, FPGA,
Bluetooth, amplifiers and their buses/GPIOs; what U-Boot and the kernel do on their own;
interruption (power loss, card pulled, hang); does it still boot stock with the card removed;
skipped stock boot steps whose absence matters. Deliver as B.
