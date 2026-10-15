---
name: ui-sandbox
description: Start, check, re-patch, screenshot and stop the UI sandbox ("the dev page", "the sandbox", "the dev frontend") - Mackie's mixer UI running on this PC in the device layout at http://127.0.0.1/, with the mod's patches. Use when the user asks to start/open/stop the dev page or sandbox, to look at a UI change on the PC, to take screenshots of the mixer UI for checking, or after changing install/app-mod, install/server-mod or install/patch.py.
---

# ui-sandbox

Mackie's `server.js` and `app.js` (the mod's patches applied) run with Windows Node on a private
copy of the mixer's `/srv` (`dumps/sandbox/`, git-ignored), mapped to its own drive letter so the
absolute paths in `server.js` resolve inside it. Shell commands are blocked and it listens on
127.0.0.1 only (`dev/ui-sandbox/shim.js`). No DSP, no faders: the UI and its state/preset logic work,
real meters and audio do not (moving fake meters do). Details and limits: `notes/modding-guide.md`,
"PC sandbox".

All from the repo root in Git Bash; `S=.claude/skills/ui-sandbox/sandbox.sh`.

## Start

1. `bash $S status`: already running? Then do not start a second one (port 80 and the drive are
   taken; the script would refuse the drive anyway).
2. Start as a **background task**: `bash dev/ui-sandbox.sh` (XS layout), or
   `DLZ_FULLSIZE=1 bash dev/ui-sandbox.sh` (full-size, its own copy `dumps/sandbox-full`). Optional
   argument: another drive letter (default `S`).
3. `bash $S wait`: until http://127.0.0.1/ answers (first start: it copies `/srv` from the dump,
   which needs WSL distro Ubuntu and the read-only mount; that takes a while).
4. `bash $S open`: the page in the user's browser (or tell them the address).

## After a change to the mod

- `install/app-mod/`, `install/server-mod/` or `install/patch.py` changed: `bash $S repatch`
  (`repatch full` for the full-size copy). It always patches from the kept `.orig`, so it can run
  any number of times.
- `app.js` changes: reload the browser. `server.js` changes: `stop`, then start again.

## Screenshots (for checking a UI change)

`node dev/ui-sandbox/shot.js build/shots/<name>.png [x,y taps...]` (headless Chrome; other Chrome:
`CHROME=...`). Taps in UI pixels of the 1024x600 screen, 700 ms apart:

- First a shot without taps: the sandbox keeps its settings between runs, and **Hide header** (the
  mod's option) moves everything 30 px up. No bar above the tabs (Overview, Channel, ...) = hidden
- Header shown: `905,60` Settings gear, `860,116` the Mod tab ("DLZ Creator Modded").
  Header hidden: `905,30` and `860,86` [PC: `905,60` with the header hidden lands on
  the Overview]
- `DLZ_SHOT_EVAL='<js>'` runs JS in the page before the taps, for states the PC cannot produce,
  e.g. `Data.set("sd",1)` (SD card inserted); `DLZ_SHOT_WAIT=<ms>` after it, `DLZ_SHOT_AFTER=<ms>`
  after the last tap
- Look at the PNG with the Read tool before saying a change looks right; `build/` is git-ignored

## Stop

`bash $S stop`, always: ending the background task alone leaves `node.exe` listening on 80/89 and the
drive mapped, and the next start fails on the drive. `stop` ends only a `node.exe` on 80/89 (another
program there is reported and left alone), unmaps the sandbox drive(s) and checks that both are gone.
Then stop the background task too if it is still listed. Stop it when the user is done looking, not
in the middle of their session.

## What it is not

Not the mixer: nothing here reaches a device, so no device review is needed for sandbox runs
themselves. What looks right here still needs the real device for anything that touches DSP,
faders, the SD card, networking or timing.
