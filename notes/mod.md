# What the mod changes on the card

Everything the mod adds to or changes in the copy of Mackie's system on the card, per topic, with
the accepted risks. The ground rules and brick risks behind it: [modding-guide.md](modding-guide.md).
Updates and releases: [updates.md](updates.md). The installer that builds the card:
[installer.md](installer.md). Mackie's own behaviour: [architecture.md](architecture.md),
[system.md](system.md) and `components/`. Confidence tags: see [architecture.md](architecture.md).

Where it lives: `install/card-core.sh` builds the card (used by the installer, `build-sd.sh` and the
update package), `install/apply-mod.sh` places the mod's files (shared with the drop-in update),
`install/patch.py` patches `server.js` and `app.js` by string anchor (each patch has a label, e.g.
"firmware:", "files:", "network:"), `install/server-mod/dlzmod-server.js` and `install/app-mod/dlzmod.js`
hold the mod's own code that the patches call, `install/sd-system/` the units and udev rules.

## Units and rules on the card (`install/sd-system/`)

| File | What it does |
|---|---|
| `dlzmod-emmc-ro` + `.service`, `60-dlzmod-emmc-ro.rules` | The eMMC and its boot partitions read-only before any other service, and again the moment an MMC device appears later (it is probed asynchronously). Guards |
| `dlzmod-cardcheck` (from the `flash-fpga` drop-in) | The card gate below. Guard |
| `flash-gd32`, `upgradedaemon`, `upgraderun` drop-ins | Mackie's GD32 flasher and both updaters never run from the card. Guards |
| `dlzmod-grow-data` + `.service` | First boot: grows `DLZDATA` to fill the card; later boots stop at once (`/var/lib/dlzmod/dlzdata-ready`) |
| `dlzmod-update` + `.service` | The drop-in update ([updates.md](updates.md)) |
| `dlzmod-clock` + `dlzmod-clock.service` | Gives the kernel the time zone's offset (#9, `zone`: `hwclock --systz --utc`) before the floor and again when the offset changes (summer time; see "Time zone"). Keeps the clock going forward over a power-off (#1): `dlzmod-clock.service` saves the time to `/etc/fake-hwclock.data` every minute and once more at its stop (a TERM, in the same process, so two saves never race; written next to it, then renamed). The floor, once per start: `dlzmod-update` calls `dlzmod-clock floor` on DLZDATA while it has it mounted read-only (its own mount, unmounted by its exit trap), before the mixer software; it moves the clock just past the newest file there when that is at most 2 min ahead (written after the last save, which is at most a minute old; further ahead = written elsewhere, a computer in another time zone or with a fast clock, ignored); a search over 10 s gives no answer. Not a unit of its own: one with the default dependencies waits for `basic.target` (~16 s) and, ordered before Mackie's units (`DefaultDependencies=no`, ~9.5 s), would hold them back as long (#141), and the updaters on the cards refuse a unit without them (`shape_ok`). Cards updated from v0.3.0 or older get the floor from the first start of the new updater on. fake-hwclock stays stock: its load at sysinit, and its in-place save at a clean shutdown after ours (a power cut in that moment leaves an empty file: the clock then stays at systemd's build time, as stock; no drop-in for it, because the updaters on the cards only accept drop-ins for the units in their allowlist, `allowed` in `dlzmod-update`). A forward-only clock, not the right time ([system.md](system.md), "Clock") [static; `tests/clock.sh`]. On the dev card [device, 2026-10-28]: after each of 3 power-offs within seconds of a recording, fake-hwclock loaded the last save and the floor moved the clock 7, 34 and 55 s past the new recording, which sorted after the older ones; the floor took 0.5-0.8 s, the updater was done at ~11.6 s and Mackie's node processes started at ~11.7 s, before `basic.target` (~14.8 s), as without the floor; the saver ran from ~15 s and saved every minute; online, chrony then stepped the remaining 17-43 s |
| `dlzmod-bootlog` + `.service` | The syslog of the last 4 SD-system starts (this one included, with its report), for `DLZDATA/dlzmod-logs/`, readable in any card reader ([modding-guide.md](modding-guide.md), "Dev loop"). Not a step of the start since #136: `dlzmod-bootreport` starts it at its end; it writes only to `/run/dlzmod-bootlog/`, and server.js copies the file to the card (`DLZMOD_bootlogCopy`, like the update upload: through the queue of remounts, not while recording, temp file, fsync, renames, read-only again after it). Before, it mounted DLZDATA itself at ~10 s, where starts hang (#81): a start that froze during the copy left a broken FAT chain in its own file, and the next start's rename hit `fat_free_clusters: deleting FAT entry beyond EOF`, the kernel set DLZDATA read-only, and the script still logged "wrote" [device] |
| `dlzmod-netlog` + `.service` | For development cards (#136; installed on every card, idle without its setting file): the journal of the start (RAM, kernel lines included) sent line by line over UDP to a PC, so a start that hangs before its log reaches the card leaves one on the PC. Off without `/var/lib/dlzmod/netlog` (`<IPv4> <port>`, written by `dev/netlog.sh`); waits for a route (Wi-Fi at ~15-25 s), then sends everything since the start and follows. The kernel has no netconsole (`CONFIG_NETCONSOLE` not set) [static] |
| `dlzmod-bootreport` + `.service` | One report per start in the syslog (so in the next boot log copy), written once the start is done (the script waits at least 90 s, at most 5 min from its own start a few seconds after `basic.target`; not ordered after `multi-user.target`, so a start that hangs before it still gets a report naming the waiting jobs) at the lowest priority, `Type=exec` so nothing waits for it: `systemd-analyze` times, the critical chain of `multi-user.target`/`dspserver`/`glesgui`, the 15 slowest units, each mixer and dlzmod service's start, restarts and state, failed units, the audio chips' start from dspserver's own lines (they are priority info, so a chip that does not answer is not among the warnings; lines that differ only in their numbers, like the retries, collapse into one and a count; the first 30 lines, then the failure lines whatever comes before them), the start's warnings and errors (first 100, without the bodies of kernel stack dumps: their `CPU: ... Tainted` line stays). Its lines start with `dlzmod-bootreport` (#136). On the device [device]: the report comes ~2.5 min after power-on, because the start counts as done only when the stock `systemd-networkd-wait-online` gives up (2 min; the mixer itself is up at ~24 s); ~180 lines, all in the syslog (no rate limit hit); the stack dump filter took one start's warnings from 142 lines to 48 |
| `dspserver` drop-in: line-buffered stdout | `LD_PRELOAD` of coreutils' `libstdbuf.so` with `_STDBUF_O=L` (what `stdbuf -oL` does; stock's `ExecStart` kept), so dspserver's own lines reach the log as they are written ([components/dspserver.md](components/dspserver.md), "Log and audio chip start") (#136). Works on the device: the chip start lines are in the log at ~27 s of every start [device] |
| `dlzmod-wait-hub` (from the `dspserver` drop-in) | dspserver waits until server.js listens on port 80 (at most 45 s). dspserver connects once and never retries: if it is first, the mixer has no audio and ignores REC until a restart. Stock gets the order by luck of timing; a slow first boot flips it [device] |
| `glesgui`, `evolve-node`, `evolve-app` drop-ins | Normal scheduling (`other`, priority 0, nice -20 kept) instead of stock's real-time FIFO 20, which let glesgui and node starve the rest of a start ([system.md](system.md), "Scheduling") (#140). An update checked by a v0.2.0 updater leaves them out (its allowlist); the new updater places them at the next start without an update file (also one that went missing), effective the start after ([updates.md](updates.md)) |
| `dlzmod-update`, `dlzmod-grow-data` drop-ins | `DefaultDependencies=no` with `After=sysinit.target` and the shutdown ordering, so these two no longer wait for `basic.target` (the FPGA load) and Mackie's node processes, ordered after them, start when stock starts them: the mixer view ~7-9 s sooner [device] ([system.md](system.md), "Boot and services") (#141). Brought and placed like the scheduling drop-ins; the updater takes them only with its own text |
| `90-dlzmod-usb-wifi.rules`, `70-dlzmod-wifi-zerocd.rules` + `dlzmod-zerocd-eject` | USB Wi-Fi stick support (below) |
| `ssh.service.d/dlzmod.conf` | SSH only when turned on from the screen (below) |

The 8 guards are hash-pinned in the updater: a package that changes one needs a full install.

## Patched in server.js and app.js

- **Firmware updates and Format SD refused** (`server.js`): the card is never wiped from the
  screen (`FORMAT_SD` targets `/dev/mmcblk0`, the boot card) and no Mackie firmware runs from the
  card; the buttons are disabled in `app.js`. Never re-enable either.
- **File commands only from the mixer's own screen** (#47): stock's file commands take paths and
  names from any client and use them as root without a check [static], so any device on the network
  could delete, move, write or read any file, including the mod's own guards. Now:
  - deleting and renaming (recordings, presets, snapshots): from the screen, and from devices paired
    with the PIN (#48, `DLZMOD_PAIRED_FILES`); for those, recordings only inside the recordings
    folders (`DLZ_Creator_Recordings`, `DLZ_Creator_XS_Recordings`) on the SD card or the USB stick
  - loading samples from a path, formatting the USB stick, a factory reset (`FACTORY_RESET`,
    `RESET`) and restarting the screen (`RESTART_GUI`): only from the screen (`DLZMOD_SCREEN_ONLY`).
    `RESTART_GUI` runs `systemctl restart evolve-app`; `evolve-app.service` has `Restart=always` and
    systemd's default start limit (5 in 10 s), so a few in a row leave the screen dark until a power
    cycle [static]
  - the System Lock PIN (key `lock`): set, changed or removed only from the screen
  - installing a mod update (`DLZMOD_UPDATE_APPROVE`, #65) only from the screen, always (also not
    from paired devices): [updates.md](updates.md), "The question before an update"
  - for everyone: preset folders only Mackie's own (`ch comp del ds eq gate rev snaps`), and names
    plain names (no `/`, `\`, NUL, `.` or `..`) where stock uses them raw; saving keeps stock's own
    clean-up, so "AC/DC" and "Vocals..." still save
  - from other devices: a track to play only from the SD card or the USB stick; path-carrying hub
    keys and track names refused; no `PRESET_WRITE` into `snaps` (a snapshot's keys are set by the
    server itself on load, past the key check)
  - `wavfinalizer` runs without a shell (stock put each `*.wav.unfinished` name unquoted into a shell
    command, so a name with `;` ran as root); names with spaces now get finalized too
  - HTTP refuses `*.orig` (the unpatched originals `patch.py` keeps in `/srv`) and the atomic-write
    temp files; unknown commands get `data:false` instead of silence
  Accepted: snapshots are not filtered on load (snapshots saved on the mixer may hold pad sample
  files). `srv_data.json` and the presets are no longer served to other devices (#45, below).
- **Control from other devices** (#45): below, "Remote Control".
- **Media back to read-only** (#98): stock remounts the SD card's DLZDATA or a USB stick `rw` to
  record, rename, delete or finish half-written recordings, and never back
  ([node-backend.md](components/node-backend.md), "Read-write remounts"), so a switch-off could
  damage the card. The mod (`DLZMOD_roLater`, patched into the end of a recording, the sample
  recorder's stop and stock's back-to-read-only function) remounts every writable FAT medium under
  `/tmp/mnt` read-only about 10 s later (a rename or delete: after stock's 60 s), once nothing
  records, is paused or has a sample take still to keep or store (`sample.rec.file` set: the sample
  recorder's state stays at keep/discard after a store) and nothing was remounted `rw` or finalized
  in the last 10 s (counted from when the remount is done); otherwise, and when the kernel refuses
  because a file is still open for writing (EBUSY), it looks again every 10 s. Every remount runs
  through one queue (`DLZMOD_rw`), so a recording that starts during a read-only remount waits for
  it and gets its `rw`; a remount that hangs (a pulled stick) holds the queue up for 40 s at most
  and counts as not done after 35 s for all media together, so the looking goes on without a second
  mount for that medium while the first still hangs. A rename or delete always remounts
  `rw` (stock skipped it while its own flag said writable), and waits for that remount before
  stock's 500 ms (stock did not wait); a failed `rw` remount is logged (`dlzmod: read-write
  remount:`), where stock's un-awaited call would end node 18 as an unhandled rejection. A recording
  refused for want of a free name sends the medium back read-only like a finished one [static]. No stock write needs the old
  always-writable state: server.js writes to the media only through those remounts (record, sample,
  rename, delete, the start's finalizer) and in the multitrack renames 2 s after a stop; its other
  writes go to the system (`/srv` presets, `srv_data.json`, the bank player's defaults) and `/tmp`
  [static, the dump's server.js]. Measured on the XS dev card [device]: read-only again 12-13 s after the start's
  remount, 10.3 s after a recording stopped, 10.2 s after a sample was kept, exactly 60 s after a
  rename or delete (also a rename while already read-only); after a recording and a switch-off the
  next start finds the FAT volume clean (state byte `00`, no warning). Side effect: a rename or delete
  that comes while a read-only remount runs waits for it (the queue's 40 s at most). Not covered: a card already marked dirty stays marked until an fsck
  ([node-backend.md](components/node-backend.md), "FAT's dirty mark is sticky").
- **Recording names** (#27, #34, #35): `REC_<number>_<animal>.wav`, e.g. `REC_0042_otter`. The
  number counts above every `REC_<n>` file or folder, in any letter case, in the recordings folders
  of both media (SD card and USB stick; reading the other medium gives up after 2 s, so a hung stick
  cannot hold a recording back); `REC_10000` follows `REC_9999`; no recording starts when the folder
  cannot be read. The animal comes from 159 short lower-case names (`DLZMOD_animals`), shuffled per
  round: no repeat until the list is used up. The `REC_NNNN` prefix stays first, so stock firmware
  still counts these files. [device: `old_REC_0001` and `rec_0005` next to `REC_0001` give
  `REC_0006` (stock: `REC_0002`); after `REC_9999` comes `REC_10000`; animal names on the SD card;
  counting across SD and USB not yet tested on the mixer]. Stock's weak spots: [components/node-backend.md](components/node-backend.md),
  "Recording file name".
- **Recordings go to the SD card by default** (`settings.rec.toUSB` off in the card's state).
- **About's "Device IP Address"** asks `eth0`, then `wlan0`.
- **Look and meters** (`app.js`): see "Mod settings" below.

## Mod settings (Settings → DLZ Creator Modded)

Sub-tabs Display / Colors / Time / Network / Remote / Mod (a browser: Display / Colors / Time / Mod); layout and how to add a setting:
[modding-guide.md](modding-guide.md), "Mod settings". Every default on these tabs equals stock.

- **Hide header** (#31): more room; also hides the red pad indicators and "DEMO MODE". Mackie's
  messages (toasts: "Saved: …", "Loaded: …", "Renamed", …) still show (#58): for their time (3 s) a
  message-only bar in the header's look lies over the tab bar, up to the gear, on the foreground layer,
  so nothing moves [sandbox]. It stays through a page switch (a snapshot load shows "Loaded: …" and
  goes to the Overview at once), a tap on it goes to the tab below, and it is gone on a full-screen
  page or when Hide header changes [sandbox] (`DLZMOD_messageBar`, wrapping `TopBar.showMessage`). No
  setting of its own: every toast follows something the owner just did.
- **Meters** (#38), key `dlzmod.meterMode`: 0 Mackie (default), 1 Both, 2 Before fader. In Both,
  a dim second bar shows the level after the gain, before the fader (`.gain`), using the second bar
  `VUMeter` has but stock never turns on, and the clip light follows it; `dlzmod.preColor` (green /
  grey) and `dlzmod.preLevel` (strong / soft) set its look. The main L/R meter is before the master
  fader in stock already (no `.gain`, `.post` in front of the fader), so Mackie and Before fader leave
  it as is; in Both its dim bar is that level and the bright bar is computed: the level moved by the
  fader's dB (`modVuByDb(level, VtoMix(m.mix))`, as Mackie's own aux meters do), 0 when muted, as
  Mackie until `m.mix` is known (#134). With the fader above 0 dB the bright bar is longer than the
  dim one; the clip light still follows the level before the fader, so a clip caused by the fader
  alone shows only as a full bright bar. `dlzmod.meterMarks`: yellow and red zones
  at the stops of `Color.vuGrad`, dB notches on every strip meter and numbers beside LR (painted by
  wrapping the LR fader's `paint`); off = Mackie's plain meters. The scale is dB-linear over 80 dB with
  0 dBFS at the top [device: test tones at -6 and -30 dBFS].
- **Colors** (#21): see "Themes and colours" below.
- **Time** (#9, #13): two cards, the time zone and the clock, below.
- **Network** (#12, #44): Wi-Fi and SSH, below.
- **Remote Control** (#45, #48): control from a computer's web browser, off by default; below (phones
  and tablets: Mackie's web UI does not fit them and misses touches, #52).
- **Mod**: version, update status (an update waiting on the card, with "Install Update..." on the
  mixer's own screen, #65), credits.

## Themes and colours (#21)

Settings → DLZ Creator Modded → Colors, three rows; Default in each is the contrast's own:
- **Contrast**: Normal (Mackie's look) or High.
- **Color**, for the faders' knobs, the meters and what is selected: White, Yellow, Orange, Red, Teal,
  Blue, Purple. Mackie's own channel colours, so they sit with the strips' colours as one family,
  except Red (`#e0533f`, calmer than Mackie's clip red); lighter with High contrast; no green, the
  default is green already. Every colour colours the meters, Red too: the clip block above a meter
  then stands out less, the owner's choice [sandbox, device]. A chosen light swatch gets a dark line
  inside its white edge, or the edge does not show on white [device].
- **Background**: Default or Tinted (a dark shade of the chosen colour). A plain black background
  differs too little from Default to be a choice: Default is black with Mackie's dark grey panels
  behind the stereo strips, LR, lists and popups [sandbox].

Keys `dlzmod.theme`, `dlzmod.bgColor`, `dlzmod.faderColor`, 0 = stock; the numbers are saved, so once
released the lists only grow at the end; a number a list does not have shows the default. A tap saves
that choice and the whole screen shows it at once: the screen is the preview, no Apply, no restart
[sandbox, device].

- **How** [static + sandbox]: Mackie's palette is one object, `Color` (100 names, 1223 uses), but
  widgets copy their colours when they are made, so changing `Color` later shows nothing. So, once,
  before `startGUI` builds the pages (patch.py), every palette colour any look changes gets a value
  of its own (`DLZMOD_tokens`: Mackie's colour moved one step in blue until it is no other palette
  colour, no colour a theme swaps in the code and no other such value; also one for the Mod page's
  accent and one for the Overview's background, where Mackie writes `Color.black`). Where every
  colour is set for drawing (on the mixer in `wrapObject`'s property setters, every drawing call to
  glesgui passes there; in a browser on the canvas) a table turns each such value into the chosen
  look's colour, or Mackie's. A change rebuilds the table and repaints (`app.update()`): no restart
  (one would also risk systemd's start limit, 5 restarts within 10 s: dark screen until a power
  cycle). Mackie's look draws every value as Mackie's own colour. `Util.hex2rgba`/`brighter` of such a
  value give a value of their own, so a colour Mackie works out when a page is built (a list's
  selection colour from `Color.main`) follows a change too (`DLZMOD_sum`, at most 256 [static]);
  `Color.vuGrad` is changed in place (the meters keep that list). Colours written
  into the code outside the palette (~460 places, 226 values: greys for text, tracks, strip panels,
  knobs) go through the same table. Checked against the dump's `app.js`: every palette name the looks
  use exists, and no such value equals a colour written anywhere in it [static]. Found per page with a probe in the sandbox that records each colour drawn outside the
  palette and the code that drew it. The FX pages' light panels keep theirs (already dark on light).
- **High contrast** [sandbox]: black behind everything, white text, grey lines, buttons a step above the black
  with an outline (Mackie's own `Button` border, patched on in `paintBody`), selection in a strong
  yellow, meters a lighter green.
- **One piece** [sandbox]: Tinted also moves Mackie's greys on it (buttons, panels, meter
  tracks, tab bars; palette and written into the code) into its hue (`DLZMOD_tint`), and with an own
  colour the panel edges and lines between areas are a soft shade of it. Default leaves
  the greys stock. Channel icons and colours, warnings (mute, clip, +48V) and the knob panel's
  parameter colours (they match the knob rings) stay Mackie's [static].
- **The Mod page** follows the chosen colour everywhere: switches, choices, tabs, the mod's name,
  the line on its panels and status texts; the mod's yellow only without an own colour.
- **Knob LEDs stay Mackie's**: the knob rings' colours (`K.N.color`, to the fader board) are
  `Color` values: each goes out as Mackie's colour it stands for (`DLZMOD_ledColor`). Pad colours
  and Mackie's other colour lists (channels, auxes, samples) are never themed.
- **Only from the mixer's screen**: the server refuses the three keys from other devices (the
  mixer's own look); a browser shows the tab, cannot pick, and follows a change at once.

## Time zone (#9)

- **Why**: FAT keeps local times, and the kernel converts file times with its own offset, which
  stock leaves at 0: recordings showed 1-2 h early on a computer ([system.md](system.md), "Clock").
- **Stored the system's way**: `/etc/localtime` (a link into `/usr/share/zoneinfo`, swapped in with a
  rename) and `/etc/timezone` (written durably), by the server mod (`DLZMOD_time`, one command
  `DLZMOD_TIME {op}`: `status`, `set`; answers to the sender only). A name must be
  `Region/City` (up to three parts, no dots) and a tzdata file (`TZif`) under zoneinfo, not in its
  `right/` (leap seconds, 27 s off) or `posix/` trees and not `Factory`/`posixrules`; `/etc/timezone`
  is written first, so a failure there changes nothing. The zone
  shown is the link's (what the system uses), else `/etc/timezone`'s, else `Etc/UTC` (stock). An
  update keeps both files (the card's `/etc`). Default: stock's UTC.
- **The kernel's offset**: `hwclock --systz --utc`, which only sets `sys_tz` (no clock, no RTC):
  by the server right after a change (failing: the minute loop below gives it a changed offset,
  "Recording times follow it within a minute"), by
  `dlzmod-clock floor` at every start before it compares file times with the clock, and by the
  clock saver's minute loop when `date +%z` changes (summer time). A fixed offset per change, so a
  file written in summer reads an hour off in winter on the mixer itself; a computer shows the
  time it was written in local time either way.
  Media already mounted keep the times of files the kernel had read before a change (it converts a
  FAT time when it reads the file in and keeps it) until they are mounted again or the mixer restarts;
  files written after the change are right [static, device review]. Accepted after the device review
  (tier 4, b86337b, both SAFE TO RUN): `*.dlzmod-new` temp files a power cut can leave in `/etc`
  (the next change removes them, nothing at start reads them); up to a minute of times off by an hour
  at a summer time change; a failed `zone` at start is tried again only when the saver starts.
- **On the dev card** [device, 2026-10-28, dev-eea8374]: Europe/Amsterdam picked on the screen wrote
  the link and `/etc/timezone`; `date` CET, `date -u` an hour earlier; the saver's loop logged
  `kernel time zone: CET (UTC+0100)` within the minute. The next start set CET at 11.2 s, before the
  floor, which then moved the clock 3 s past a recording made in local time (without the zone that
  file would have looked an hour ahead and been left out); chrony stepped the rest at 34 s. The new
  recording's FAT time is the local time it was made: 15:35 in Windows (11, W. Europe Standard Time,
  the card in a card reader); the older ones, written before, stay an hour early.
- **Who**: the status for anyone who asks (the answer to the one who asked); a change from the mixer's own screen and from paired
  devices (`dlzmodPaired`), not from an unpaired browser (pairing off) [static; unit tests].
- **The card**: the zone and its offset (node's ICU, `DLZMOD_tzInfo`; the time there is on the clock
  card), every 3 s while shown; Change... opens a list (`DLZMOD_zonePicker`) the way Windows lists zones: 42 rows
  (`DLZMOD_zoneList`), one per set of clock rules, sorted by winter offset ("UTC+01:00 Amsterdam,
  Berlin, Paris, Rome, Madrid"), 14 per page reading down two columns, opened on the zone set; a row
  sets it at once. Not a bare offset ("GMT+1"): that would not follow summer time. A browser shows
  its own zone (`Intl...timeZone`) with Use This Computer's Zone, which takes any zone the mixer has [sandbox].
  `tests/patches.sh` checks every row against the dump's tzdata and the zone's real winter offset.

## Clock (#13)

- **Why**: without internet the clock only goes forward from the time saved before the last
  power-off (#1, `dlzmod-clock`), so it is not the right time ([system.md](system.md), "Clock").
- **Where it came from this start** (`DLZMOD_clockSource`): `internet` once `chronyc -c tracking`
  gives a leap status other than `Not synchronised` (then it stays so and chronyc is not asked
  again), else `hand` or `device` after a set below, else nothing ("Not checked since the start");
  chronyc at most every 10 s (by uptime, which a clock change does not move) [static; unit tests].
- **By hand** (`DLZMOD_TIME {op: "clock"}`, the screen and paired devices): the picker's date and
  time in the mixer's zone (`DLZMOD_tzEpoch`, the offset of that moment; a time skipped in spring
  comes out an hour later), or a browser's own time (Use This Computer's Time). It may go back: the
  way to correct a clock set too far ahead, which the forward-only fake-hwclock would keep. Refused
  with internet (chrony would only slew it back) and outside 2025-2099.
- **From a browser at connect** (`op: "sync"`, sent by `DLZMOD_connected` after the hub's `INIT` at
  every connect and reconnect, patch.py on `$NET.onConnect`): only from a paired device (the screen
  has the mixer's own clock), only more than 5 s forward, 2025-2099, not with internet and not after
  a time set by hand this start; no answer.
- **Setting it**: `date -u -s @<seconds.ms>`, then `dlzmod-clock save` at once (its minute loop
  would within a minute: a failed save only says "It is saved within a minute"), so the time
  survives a power-off. Not the RTC: the kernel writes it only after an NTP sync (`rtcsync`).
  Online, chrony steps a hand-set time within its first three updates (`makestep 1 3`) [static].
- **A clock that goes back**: waits in the server mod are measured with `DLZMOD_monoNow` (Date.now's
  scale, a clock that never jumps), not `Date.now()`: with the wall clock set back (by hand, or by
  chrony after a phone's time that was ahead) the 10 s before a medium goes read-only again would
  have lasted as long as the jump, and the wrong-PIN pause too [static; unit test, device review].
  The screen too: app.js makes its own frame timer under node (no `requestAnimationFrame` there;
  search `lastRafTimer`), which waits 17 ms minus the time since the last frame by `Date.now()`, so a
  step back stopped every frame for the length of the step. On the dev card [device, 2026-10-28,
  dev-7c89412]: started offline with a time set ahead by hand, the Wi-Fi stick plugged in at 46 s,
  chrony stepped the clock back 91.6 s at 62 s and the screen stood still (restarted by hand a minute
  later). patch.py gives that timer `DLZMOD_frameNow` (`performance.timeOrigin + now()`; app.js runs
  as `node app.js` and leaves node's own `performance` in place). The other `Date.now()` uses in
  app.js (a double tap, a swipe's speed) misread at most once. Stock rarely steps back much: its
  saved time is always behind; with a time set by hand, a phone's time or the #1 floor it can.
- **The card**: the date and time in the zone, where they came from (yellow without a source), and
  in a browser the computer's own; Set... (`DLZMOD_clockPicker`: day, month, year, hour, minute with
  arrows that repeat while held, as Mackie's unused `PageTime`) and, in a browser, Use This
  Computer's Time; both off with internet [sandbox].

## Network panel: Wi-Fi and SSH

- One command `DLZMOD_NET {op}` (`status`, `scan`, `connect`, `forget`, `ssh`, `sshKeep`); answers go
  to that screen only. One change at a time.
- **Changes only from the mixer itself**, also for paired devices (#45): a phone must not set the
  root password or pair more devices. server.js's socket.io and TCP
  connections stamp their send function with `dlzmodLocal` (peer 127.0.0.1 or ::1); the screen
  (app.js in jsdom) connects to 127.0.0.1. Other devices get an empty status (no network name,
  address or SSH state; the Mod page there says "on the mixer's own screen") and nothing is run
  for them.
- Children run at normal priority (`chrt -o 0 nice -n 20`): evolve-node runs nice -20 (and stock's
  SCHED_FIFO 20 on a card the #140 drop-in has not reached yet), which they would inherit.
- **Wi-Fi** through NetworkManager (`nmcli` via `execFile`, no shell). A stick counts when nmcli has
  a `wifi` device. Connect writes a root-only keyfile
  `/etc/NetworkManager/system-connections/dlzmod-wifi-<hex of the name>.nmconnection` (atomic, with
  folder fsync), then `nmcli connection load` + `up`; a failed connect removes it. The password is
  never in an argument, a hub key or a log line. [device: scan, connect, reconnect after a restart,
  the web UI and SSH over Wi-Fi]
- **SSH**: on = `chpasswd` (password on stdin, 8 to 64 characters) + `ssh-keygen -A` (up to 180 s:
  RSA on the A40i) + `systemctl enable --now ssh`; off = `disable --now`. The drop-in also throttles logins
  (`MaxAuthTries=3`, which counts every key an SSH agent offers, `LoginGraceTime=20`,
  `MaxStartups=3:50:10`). The SSH card warns that it
  gives root over the network, for trusted networks only, and not to run `apt upgrade` (#54).
  While an on/off runs, the card says "Setting up…" or "Switching off…" in yellow and its controls
  wait, also once the spinner popup is tapped away (#67): from the tap on (the screen marks its own
  change until the outcome or the popup's time-out), and from the server's status (`sshBusy`,
  `on`/`off`) after a reload. [device: on and off, popup tapped away, at once]
  Other devices' SSH card says "Only on the mixer's own screen", as Wi-Fi's does.
  **Off again after every restart** unless "Keep on after a restart": `ssh.service.d/dlzmod.conf`
  lets sshd start only while `/run/dlzmod-ssh-on` (written when SSH is turned on, gone after a
  restart) or `/var/lib/dlzmod-ssh/keep-on` exists. Neither marker is a hub key; off drops both
  before `systemctl`, so even a failed stop is off at the next start. `ssh.socket` is masked (its
  `ssh@.service` would skip the condition). Mackie's factory SSH access (its keys) is removed on the
  card. [device: on, login as root over Wi-Fi, off after a restart, keep-on]
  Accepted: open sessions survive "off" (stock `KillMode=process`); the root password stays valid
  after SSH is off (console);  after the update that
  brings a changed drop-in, systemd uses the new one only from the next start (no `daemon-reload`).
- **USB Wi-Fi stick**: the mixer has no Wi-Fi of its own (no Wi-Fi node in the DTB, [system.md](system.md)).
  The stock kernel has many USB Wi-Fi drivers and blacklists none [static]. The TP-Link Archer T3U
  (AC1300, RTL8822BU, 2357:012e) is not in the stock `88x2bu` driver's id list, so
  `90-dlzmod-usb-wifi.rules` loads `88x2bu` and adds exactly that id (`new_id`) [device: `wlan0`,
  `unavailable` for ~2 s at boot, then `disconnected`; no USB over-current or disconnects in `dmesg`
  while connected]. Sticks that first show up as a Realtek driver CD (0bda:1a2b) are ejected by
  `70-dlzmod-wifi-zerocd.rules` → `dlzmod-zerocd-eject`, started through `systemd-run --no-block`
  because udevd holds the device open during its event and the kernel refuses the eject until then;
  it retries for 10 s [static: no such stick tried yet]. Ethernet works as on stock.

## Remote Control: control from other devices (#45, #48)

Stock lets anyone on the network control the mixer over both ports, without a login: every setting,
factory reset, formatting, and `srv_data.json` (the System Lock PIN) and the presets as files. The mod
keeps the mixer itself as stock and lets other devices in only when asked [device: off by default,
pairing from a computer's browser with a random and an own PIN, the PIN hidden as dots until Show
PIN, deleting and renaming a recording from the browser, System Lock and Factory Reset only on the
screen, Forget and Off locking the browser out; the screen, faders and audio unchanged]:

- **Who is the mixer itself**: connections from 127.0.0.1 / ::1 (the screen on port 89; dspserver and
  faderlink over socket.io on port 80). Nothing changes for them.
- **Off by default** (a fresh card has no state file): another device gets a page saying where to turn
  it on, socket.io refuses its handshake (`allowRequest`).
- **On** (Settings → DLZ Creator Modded → Remote, asks first; only from the screen): the panel
  shows the address(es) to open and a 6-digit PIN, hidden as dots until "Show PIN" (30 s; the screen
  is often on camera). A browser without a pairing gets the mod's PIN page;
  the right PIN sets a random 32-byte token as cookie `dlzmod_pair` (`HttpOnly`, `SameSite=Strict`,
  400 days). A random PIN pairs one device: a new PIN shows after each pairing. Or the owner's own
  PIN ("Own PIN...", 6 digits on a PIN pad in the layout of Mackie's System Lock; at most two different digits, straight runs like 123456 or 987654,
  repeated blocks like 123123 and doubled digits like 112233 are refused): it stays, for pairing several devices without the screen, until "Random PIN", a new own
  PIN or switching off. Wrong PINs, counted for all devices together: after 5 a pause of 60 s,
  doubling up to 15 min, on the panel too; a successful pairing starts the doubling at 60 s again.
- **Paired**: the browser loads only the UI's own files (`/`, `index.html`, `app.js`, `style.css`,
  `favicon.ico`, `libs/`, `fonts/`, `img1x/`), the recordings (`/dlzmod-rec`, #26, below) and the
  update upload (`/dlzmod-update-upload`, #114, below), not
  `srv_data.json`, the presets or anything else in `/srv`. Before pairing only the PIN page's own
  files: the model's logo (`img1x/DLZ_XS.png` /
  `DLZ_Creator.png`) and Proxima Nova Regular and Semibold (`DLZMOD_loginFileOk`); the page is in
  Mackie's look with the mod's yellow marker at the bottom; socket.io takes it with the cookie and, from a browser, only with the mixer's own page as
  `Origin` (a web page elsewhere cannot drive the mixer). The connection is checked once more when it
  opens and stamped `dlzmodPaired`: deleting and renaming come back (#48), the Network panel's changes
  do not.
- **Only by the mixer's own name**: other devices get in only by an IP address, a `.local` name or
  `localhost` as `Host` (`DLZMOD_hostOk`), else 421 "Open the mixer by its IP address or its .local
  name". Without it a web page could point a name of its own at the mixer (DNS rebinding): `Host`
  and `Origin` then match, and a browser on the network would send PIN guesses for it. A router's
  name for the mixer (`mixer.lan`, `mixer.fritz.box`) is refused for the same reason.
- **Off and "Forget all devices"** forget every pairing and drop paired connections at once. Off also
  drops an own PIN (on again starts random); Forget makes a random PIN new and keeps an own one (the
  popup says to change it if others know it).
- **On the card**: `/var/lib/dlzmod-remote/state.json` (folder 700, file 600, durable write): on, the
  PIN, whether it is the owner's own, and the sha256 of each token (at most 16: the 17th pairing
  drops the oldest). An update keeps it. The PIN goes only to the screen (the Network status), never
  into a hub key or a log line. Every change goes to the card first and into memory after
  (`DLZMOD_pairCommit`): a change that opens up (on, a pairing, an own PIN) only happens once saved;
  off and Forget hold in memory at once, and when the card cannot save them the file is removed (no
  file = off at the next start); if even that fails the screen says the devices may come back after
  a restart.
- **In the browser** (Mackie's `EXTERNAL`, known before the pages are built) the System Lock button,
  both Factory Reset buttons and the mod's Network and Remote sub-tabs are not shown (patch.py,
  `DLZMOD_external`): the server refuses them, and Mackie's web UI would otherwise lock or "reset"
  only itself. A mixer locked on its screen shows the lock in the browser too; tapping it says
  "Only on the mixer's own screen" (`DLZMOD_screenOnly`). Setting an own PIN or a random one
  shows no popup: the panel shows the new PIN.
- **Port 89** listens on 127.0.0.1 and ::1 only (`DLZMOD_listen89`): its only client is the screen.
  That also ends the unbounded line buffer there as a network problem.
- **For a computer, not yet for phones and tablets**: Mackie's web UI does not fit a phone and misses
  touches (#52); the PIN page itself works on a phone.
- **Accepted** (device review of v0.2.0): plain HTTP, so a token can be sniffed on the same network
  and replayed for its 400 days (the panel says "only on a network you trust"); a paired device gets
  the whole live state over socket.io, as stock's browser UI needs it (the System Lock PIN included,
  read only); stock's preset and snapshot commands have no size or count limit, also for paired
  devices; someone on the network can keep the pairing paused with wrong PINs (15 min at most per
  round; paired devices keep working); the #48 path check is textual, so a symlink in a recordings
  folder on an ext4 USB stick could point a paired device's delete elsewhere on the card (needs
  physical access; FAT and exFAT have no symlinks; the screen could do so before); the ::1 listener on
  port 89 is not retried when it fails to bind (the kernel has IPv6, `/etc/hosts` maps ::1); the
  System Lock is a screen overlay plus a block on the hardware buttons (stock's server reads `lock`
  only in `HWREC`, `PADPRSD` and `ALT`), so a paired browser still controls a mixer locked on its
  screen, as stock's open web UI did [static].

## Recordings to a computer (#26)

A paired computer downloads recordings from the Media page, read only [device: the button only in
the browser, one recording and all of a folder, no download while recording, the lists refreshing
in the browser and on the screen after a recording, rename or delete, the card read-only again after
each recording; static (unit tests, PC sandbox) for the rest: a running download cut off when a
recording starts, the 503 while `wavfinalizer` runs, linked folders and files, the error paths]:

- **Where**: a download button on Mackie's Media page, left of Sort, only in a browser
  (`DLZMOD_external`, decided when the page is built: Mackie asks a widget's `getState` only while it
  is visible, so a button hidden from there never comes back). Enabled in a recordings folder
  (`DLZ_Creator_Recordings` / `DLZ_Creator_XS_Recordings` on the SD card or USB stick), greyed
  elsewhere like Rename and Delete; the path label is 424 instead of 520 wide there, so a long path is
  shortened before it reaches the button.
- **What**: nothing (or a folder) selected asks "Download all N recordings (size)?"; a selected
  recording asks "This one" (green) or "All N" (Mackie's blue): Mackie's list cannot be unselected,
  so all stays one tap away (only one recording there: it downloads at once). Each file goes to the
  browser's downloads, 400 ms apart. Not one after
  another: a page cannot see a download finish, and saving into a folder (File System Access) needs
  HTTPS; the browser runs a few at a time per host and each one resumes on its own. Those take the
  browser's connections to the mixer (6 per host over HTTP/1.1): while a large folder downloads,
  another request of that page (the list for a second press) can wait behind them.
- **Server** (`DLZMOD_recHttp`, behind `DLZMOD_remoteHttp`): `GET /dlzmod-rec` lists each mounted
  medium's recordings (name, size, time, newest first) and whether the mixer records;
  `GET /dlzmod-rec/<sd|usb>/<folder>/<name>` sends the file with express's `res.download` (Range,
  ETag, `Content-Disposition`). Each path part is decoded on its own; the folder must be one of
  `DLZMOD_REC_DIRS`, the name plain, not hidden, not `*.unfinished` (a recording still being written)
  and not ending in a dot or space (FAT ignores those on lookup: `x.wav.unfinished.` would open the
  unfinished file). The folder must be a real folder and the file a real file (`DLZMOD_recReal`,
  `lstat`): an ext4 stick could link the recordings folder to `/`. GET and HEAD only.
- **While recording** (`DLZMOD_recNoRead`: `DLZMOD_recBusy`, i.e. recording, paused, the sample
  recorder; or `wavfinalizer` finishing a recording file, after a power cut at the start) nothing is
  read from the media: the list says so (the button shows "The mixer is busy with a recording"), a
  download gets 503 with `Retry-After: 30`, and running downloads are cut off (`DLZMOD_recWatch`,
  checked every second while one runs, so up to a second of reading after a start; the browser can
  resume them). Reading does not keep the media writable: only a file open for writing makes the
  read-only remount (#98) fail [static].
- **Never ends the server**: node 18 ends server.js on an unhandled rejection, so both routes end in
  a `.catch` (500, or the connection closed once the answer has started); a client gone during the
  checks is not watched; a read error halfway (a pulled stick) closes the connection.
- **The mixer's own screen** (127.0.0.1) reaches the routes without pairing, as everything else; it
  has no button.
- **Lists stay current** (`DLZMOD_dirsChanged`): stock reloads a client's Media list only when it
  navigates or gets `UPDATE_DIRS`, which server.js sent only when a medium came or went; a browser
  kept showing a recordings folder without new, renamed or deleted recordings [device: new recordings
  missing until up a folder and back]. The server now also sends `UPDATE_DIRS` through stock's own
  broadcaster (`ee`) after a delete and a rename (patched into `MEDIA_DELETE` / `MEDIA_RENAME`) and 3 s
  after a recording ends (`P()`, once it has its final name); calls close together make one message.
  Every client with the Media page (or the sample browser) open reloads it, the screen too [static:
  PC sandbox, the screen's port-89 connection gets it as well].
- **Accepted** (device review of #26): plain HTTP, so a download can be read on the same network, as
  the remote control itself; a recording renamed or deleted on the screen while it downloads is served
  as it was opened; playing a recording from the card while several download is not held back
  [guess: no dropouts, to be heard on the mixer]; a name that is not valid UTF-8 on the card (the FAT
  mount has no `iocharset`) is left out of the list without a word [guess].

## An update from a computer (#114)

A paired computer sends a mod update to the card; installing it stays the drop-in update's
([updates.md](updates.md), "Drop-in update"): its signature and version checks, and Install on the
mixer's own screen (#65). Nothing is checked or installed live: the next start finds the files [PC:
unit tests on node 18 (the dump's, under qemu) and `tests/upload.sh` (real FAT image, full card, cut-off,
power cuts); the mixer still to come]:

- **Where**: Upload Update... on the Mod page, in the place of Install Update..., only in a browser
  (`DLZMOD_external`); the Updates row then says to upload the `.tar` and `.sig`. The browser's file
  picker takes both files at once; the page checks the pair first (`DLZMOD_uploadCheck`: one
  `dlzmod-*.tar` with a plain name, its own `.tar.sig` of 64 bytes, at most 64 MiB; a copy the
  browser renamed, `(1)`, is refused by name), asks, then sends.
- **One request**: `POST /dlzmod-update-upload`, the body the signature and then the package (a `Blob`
  of the two `File`s, so the browser sends them from disk), the name in `X-Dlzmod-Name`. No multipart
  parser on the mixer. The page shows the mixer's text (`text/plain`); the pairing gate's HTML pages
  (no longer paired, control off) get a sentence instead (`DLZMOD_uploadReply`). One send at a time
  per page; the picker is in the page while open (some browsers drop one outside it).
- **Server** (`DLZMOD_updateUpload(ce("sd"))`, behind `DLZMOD_remoteHttp`, whose path allowlist has
  the one path): POST only; from another device only with the mixer's own page as `Origin`
  (`DLZMOD_originOk`, as the pairing form); the name as the updater's glob takes it
  (`DLZMOD_uploadName`); a `Content-Length` (no chunked body) of more than 64 bytes and at most
  64 bytes + 64 MiB (the updater's `MAX_PKG`). Those are answered at once and the connection closed
  (not an upload of the page's). Refused before anything is touched: while the mixer records
  (`DLZMOD_recNoRead`), while another upload runs, while the updater's `inprogress` is set (a try cut
  off that the next start must finish or put back first), with no SD medium. These, and every failure
  below, are answered only once the rest of the body has come in, thrown away as it comes
  (`DLZMOD_uploadDrain`): a server that closes while a browser still sends makes it show a network
  error instead of the text [static: node's http; to see in a browser with a large file].
- **Write path**: the SD medium (DLZDATA) remounted writable through the mount queue (`DLZMOD_rw`),
  then it must be in `/proc/mounts` as a writable vfat mount (`DLZMOD_uploadMounted`: never a mount
  point left on `/tmp`'s tmpfs, which is RAM). The body streamed to
  `dlzmod-update/.dlzmod-upload.tar.part` (never held in memory: about 120 MB is free), the first 64
  bytes kept apart for the signature; each piece written to its end (`DLZMOD_writeAll`: a nearly full
  card can write less without an error). Only when the whole body is there: the tar synced and its
  size checked, the signature written to its own synced temp file, every `dlzmod-*.tar` and
  `.tar.sig` in the folder removed (never two packages, which the updater refuses), the signature
  renamed and synced again, then the package the same, the folder synced. The sync after each rename
  is needed on FAT: Linux's vfat rename writes the new folder entry with no first cluster and size 0
  and the real ones only when the file's inode is written back (seconds to ~30 s later); the folder's
  own sync does not write it [PC: `tests/upload.sh` without them: every power cut after the answer left
  a 0-byte package]. Any durable rename on DLZDATA needs the same (the mod's other durable writes,
  `DLZMOD_writeDurable`, are all on the ext4 system). A power cut at any point leaves at most hidden temp
  files (removed by the next upload) or a signature without a package: never a package the updater
  takes for a complete update; a package with a signature that does not match it is refused by the
  updater. Other files and folders in `dlzmod-update/` (its README) stay.
- **Failure**: cut off (the computer went away: no answer, no one to give it to; fewer bytes than
  announced), a full card (`ENOSPC`, 507), a failed remount, a medium not in the mount table: the
  temp files removed, a text that nothing was kept. The old update files stay, except after a
  failure between their removal and the new files' renames: then there is none, which the updater
  takes as nothing to do. A recording that starts stops the writing (checked every second while it
  runs, as running downloads), the rest of the body is thrown away and the page gets the text. The
  medium goes back to read-only after every upload (`DLZMOD_roLater`); while one writes, its 10 s
  "recently writable" mark is kept fresh.
- **Never ends the server**: the run ends in a `.catch`, as the recordings' routes.
- **Accepted** (device review of #114, no brick or eMMC path found by any reviewer): a power cut in
  the instant a FAT rename has written the new folder entry but not yet removed the old one leaves two
  entries on one cluster chain, and the next upload's removal of the temp file then frees the
  package's clusters; the damage stays on DLZDATA, a damaged package fails its signature check, and
  both entries normally sit in one sector written at once (recordings carry the same FAT risk). A bad
  package left on the card is copied to `/tmp` and hashed again at every start until it is replaced
  (up to 64 MiB, before the mixer software starts; the same for one copied with a card reader). The
  upload runs inside evolve-node at its high priority (nice -20; real-time before #140), so playback from the card could stutter
  while one writes [guess: to listen for on the mixer]. Node 18's 300 s `requestTimeout` ends a body
  that takes longer (a 64 MiB one below about 1.7 Mbit/s; a real package is about 1 MB), which also
  bounds how long a stalled client keeps the card writable. No free-space check first: a full card is
  `ENOSPC`, cleaned up.
- **Then**: switch off and on; the start finds the package (pending), the screen asks Install, and
  the start after that installs it. The upload changes nothing about an approval: that is bound to
  the package's and signature's sha256, so an Install given for an earlier file does not carry over.

## The card gate (`dlzmod-cardcheck`)

Runs before Mackie's FPGA loader at every start (from the `flash-fpga` drop-in). A card runs only on
the mixer it was made for: the card's XS flag (`/root/.dlzlite`) and GD32 marker
(`/root/.gd32-loaded-*`) must match each other and the eMMC's own, and the eMMC's CID hash must match
`/etc/dlzmod/mixer-id` (written by the installer; cards built with `build-sd.sh` are `any`
and skip only the CID check). The eMMC's `/root` is read with the card's `debugfs -c` (read-only,
no mount, no journal replay; it writes nothing [static: the dump's debugfs under `qemu-arm -strace`]); the `.` entry proves
the read worked. The read runs in the background and is polled for at most 20 s and never waited
for, because a read stuck in the kernel cannot be killed and the FPGA loader has no start timeout.
Any failure keeps flash-fpga, faderlink and dspserver off and says why on the screen (another
mixer, another model, the mixer's firmware changed since the card was made, the eMMC unreadable).

Why: the FPGA bitstream and the GD32 firmware must belong together. A card moved to another mixer,
even of the same model, would load its bitstream next to a GD32 the card never flashed; a Mackie
update after the install can move the GD32 on. [device: passes on its own mixer]; the refusals
and the timing (~0.3 s on the normal path) are tested on the PC (`tests/cardcheck.sh`).
Accepted: the CID hash is not a secret (the serial has little entropy), only not the raw CID; root
over SSH can change the card's flag and marker together (the eMMC comparison still catches it); a
`.dlzlite` symlink on the eMMC reads as full-size and is refused (the factory makes a file).
