# What the mod changes on the card

Everything the mod adds to or changes in the copy of Mackie's system on the card, per topic, with
the accepted risks. The ground rules and brick risks behind it: [modding-guide.md](modding-guide.md).
Updates and releases: [updates.md](updates.md). The installer that builds the card:
[installer.md](installer.md). Mackie's own behaviour: [architecture.md](architecture.md),
[system.md](system.md) and `components/`. Confidence tags: see [architecture.md](architecture.md).

Where it lives: `install/card-core.sh` builds the card (used by the installer, `build-sd.sh` and the
update package), `install/apply-mod.sh` places the mod's files (shared with the drop-in update),
`install/patch.py` patches `server.js`, `app.js` and the XS audio graph (`mixergraph-dlzlite.js`) by
string anchor (each patch has a label, e.g. "firmware:", "files:", "network:", "eq spectrum:"),
`install/server-mod/dlzmod-server.js`, `install/app-mod/dlzmod.js` and `install/graph-mod/dlzmod-graph.js`
hold the mod's own code that the patches call, `install/sd-system/` the units and udev rules.

## Units and rules on the card (`install/sd-system/`)

| File | What it does |
|---|---|
| `dlzmod-emmc-ro` + `.service`, `60-dlzmod-emmc-ro.rules` | The eMMC and its boot partitions read-only before any other service, and again the moment an MMC device appears later (it is probed asynchronously). Guards |
| `dlzmod-cardcheck` (from the `flash-fpga` drop-in) | The card gate below. Guard |
| `flash-gd32`, `upgradedaemon`, `upgraderun` drop-ins | Mackie's GD32 flasher and both updaters never run from the card. Guards |
| `dlzmod-grow-data` + `.service` | First boot: grows `DLZDATA` to fill the card; later boots stop at once (`/var/lib/dlzmod/dlzdata-ready`) |
| `dlzmod-update` + `.service` | The drop-in update ([updates.md](updates.md)) |
| `dlzmod-clock` + `dlzmod-clock.service` | Gives the kernel the time zone's offset (#9, `zone`: `hwclock --systz --utc`) before the floor and again when the offset changes (summer time; see "Time zone"). Keeps the clock going forward over a power-off (#1): `dlzmod-clock.service` saves the time to `/etc/fake-hwclock.data` every minute and once more at its stop (a TERM, in the same process, so two saves never race; written next to it, then renamed). The floor, once per start: `dlzmod-update` calls `dlzmod-clock floor` on DLZDATA while it has it mounted read-only (its own mount, unmounted by its exit trap), before the mixer software; it moves the clock just past the newest file there when that is at most 2 min ahead (written after the last save, which is at most a minute old; further ahead = written elsewhere, a computer in another time zone or with a fast clock, ignored); it reads the file times raw from DLZDATA's folders in one pass (#234), falling back to `find` for what it cannot read; a search over 10 s gives no answer (how long it takes: "Clock", "The floor's search time"). Not a unit of its own: one with the default dependencies waits for `basic.target` (~16 s) and, ordered before Mackie's units (`DefaultDependencies=no`, ~9.5 s), would hold them back as long (#141), and the updaters on the cards refuse a unit without them (`shape_ok`). Cards updated from v0.3.0 or older get the floor from the first start of the new updater on. fake-hwclock stays stock: its load at sysinit, and its in-place save at a clean shutdown after ours (a power cut in that moment leaves an empty file: the clock then stays at systemd's build time, as stock; no drop-in for it, because the updaters on the cards only accept drop-ins for the units in their allowlist, `allowed` in `dlzmod-update`). A forward-only clock, not the right time ([system.md](system.md), "Clock") [static; `tests/clock.sh`]. On the dev card [device, 2026-10-28]: after each of 3 power-offs within seconds of a recording, fake-hwclock loaded the last save and the floor moved the clock 7, 34 and 55 s past the new recording, which sorted after the older ones; the floor took 0.5-0.8 s, the updater was done at ~11.6 s and Mackie's node processes started at ~11.7 s, before `basic.target` (~14.8 s), as without the floor; the saver ran from ~15 s and saved every minute; online, chrony then stepped the remaining 17-43 s |
| `dlzmod-bootlog` + `.service` | The syslog of the last 4 SD-system starts (this one included, with its report), for `DLZDATA/dlzmod-logs/`, readable in any card reader ([modding-guide.md](modding-guide.md), "Dev loop"). Not a step of the start since #136: `dlzmod-bootreport` starts it at its end; it writes only to `/run/dlzmod-bootlog/`, and server.js copies the file to the card (`DLZMOD_bootlogCopy`, like the update upload: through the queue of remounts, not while recording, temp file, fsync, renames, read-only again after it). Before, it mounted DLZDATA itself at ~10 s, where starts hang (#81): a start that froze during the copy left a broken FAT chain in its own file, and the next start's rename hit `fat_free_clusters: deleting FAT entry beyond EOF`, the kernel set DLZDATA read-only, and the script still logged "wrote" [device] |
| `dlzmod-netlog` + `.service` | For development cards (#136; installed on every card, idle without its setting file): the journal of the start (RAM, kernel lines included) sent line by line over UDP to a PC, so a start that hangs before its log reaches the card leaves one on the PC. Off without `/var/lib/dlzmod/netlog` (`<IPv4> <port>`, written by `dev/netlog.sh`); waits for a route (Wi-Fi at ~15-25 s), then sends everything since the start and follows. The kernel has no netconsole (`CONFIG_NETCONSOLE` not set) [static] |
| `dlzmod-bootreport` + `.service` | One report per start in the syslog (so in the next boot log copy), written once the start is done (the script waits at least 90 s, at most 5 min from its own start a few seconds after `basic.target`; not ordered after `multi-user.target`, so a start that hangs between `basic.target` and it still gets a report naming the waiting jobs; a hang before `basic.target`, or power off within those first 90 s, gets none, #180) at the lowest priority, `Type=exec` so nothing waits for it: `systemd-analyze` times, the critical chain of `multi-user.target`/`dspserver`/`glesgui`, the 15 slowest units, each mixer and dlzmod service's start, restarts and state, failed units, the audio chips' start from dspserver's own lines (they are priority info, so a chip that does not answer is not among the warnings; lines that differ only in their numbers, like the retries, collapse into one and a count; the first 30 lines, then the failure lines whatever comes before them), the start's warnings and errors (first 100, without the bodies of kernel stack dumps: their `CPU: ... Tainted` line stays). Its lines start with `dlzmod-bootreport` (#136). On the device [device]: the report comes ~2.5 min after power-on, because the start counts as done only when the stock `systemd-networkd-wait-online` gives up (2 min; the mixer itself is up at ~24 s); ~180 lines, all in the syslog (no rate limit hit); the stack dump filter took one start's warnings from 142 lines to 48 |
| `dspserver` drop-in: line-buffered stdout | `LD_PRELOAD` of coreutils' `libstdbuf.so` with `_STDBUF_O=L` (what `stdbuf -oL` does; stock's `ExecStart` kept), so dspserver's own lines reach the log as they are written ([components/dspserver.md](components/dspserver.md), "Log and audio chip start") (#136). Works on the device: the chip start lines are in the log at ~27 s of every start [device] |
| `dlzmod-wait-hub` (from the `dspserver` drop-in) | dspserver waits until server.js listens on port 80, then until glesgui is past its stops (#239, its `/dev/dri` file; 50 s at most in all). If dspserver is done before server.js, the mixer has no audio and ignores REC until a restart, although dspserver does retry its connection (#257, `components/dspserver.md`). Stock gets the order by luck of timing; a slow first boot flips it [device] |
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
- **Sample names** (#104): a take the sample recorder keeps gets `RS_<number>.wav` in
  `Recorded_Samples`, the number above every `RS_<n>` in that folder, in any letter case
  (`DLZMOD_sampleName`, the same picker as the recordings, `DLZMOD_pickNumbered`); no animal, a pad
  refers to its sample by path and the name is not shown. When the folder cannot be read the take is
  not stored: the recorder is set back as stock's `SAMPLE_REC_RESET` does and the pad keeps what it
  had. [device: with `zzz_RS_0001` and `RS_0002` in the folder a kept take became `RS_0003` (stock:
  `RS_0002`, overwritten), `RS_0002` untouched, the pad plays the new take, the card read-only again
  10 s after the store; static: unit tests, `zzz_RS_0001` and `rs_0005` next to `RS_0001` give
  `RS_0006`; an unreadable folder not tried on the mixer]. Stock's weak spots: [components/node-backend.md](components/node-backend.md),
  "Sample recorder names".
- **Date and time in recording names** (#14): `REC_0042_otter_2026-10-11_1430`, the start of the
  recording in the mixer's zone, after the animal (the number stays first). A switch on Settings,
  Recording / Routing, "Date & Time in Name" (`dlzmod.recDate`, off by default; a fourth row under
  Mackie's three, the rows 52 px apart instead of 64; the panel's reset button turns it off with
  them; a short yellow bar left of the label marks it as the mod's, `DLZMOD_stockMark`, ground rule 9).
  The date goes in only when the clock was set this start, from the internet, by hand or from a
  paired device (`DLZMOD_clockSource`, see "Clock"); with only the time saved at the last power-off
  (#1), which can be days behind, the name stays `REC_NNNN_animal`. A paired device whose time is
  within 5 s of the mixer's sets nothing, so after a short power-off without internet the name can
  stay without a date although the clock is right. chronyc gets 1 s at the start of a recording,
  then it starts without the date (`DLZMOD_recStamp`); chronyc is asked at most every 10 s, so a
  recording started in that time after such a slow answer has no date either, even when chrony is
  in sync by then. [device: with the switch on and the clock from the internet, a recording got
  `REC_0005_wombat_2026-10-28_2013.wav` in local time (CET), numbered after the older
  `REC_0004_gorilla`; static: unit tests; PC sandbox: the switch, its reset, and names up to
  `REC_0007_woodpecker_2026-10-28_1430.wav` whole in the Media list].
- **Player title line without `DLZ|Creator - `** (#193): the title line (`player.name`, set by
  dspserver when a track loads, 530 px, shortened in the middle by Mackie's `shortenMid`) shows
  "artist - title", the file name when there is no title. dspserver's recorder writes an INFO chunk
  with the artist `DLZ|Creator` (with the `|`) and `ISFT Lavf58.76.100`, no title, into every
  recording, so stock reads `DLZ|Creator - REC_00..bat_2026-10-28_2013` [device; static: the string
  next to `StereoMtkRecorder` in `/usr/local/bin/dspserver`]. The mod drops that one prefix on the
  title line only (`DLZMOD_trackName`, an app.js patch on `trackName`); other files keep their
  artist, the files themselves are unchanged. [device: a recording plays with its own name on the
  title line; PC sandbox: `REC_10000_hippopotamus_2026-10-28_1430`
  fits whole; with the prefix, `REC_0042_hippopotamus` (no date) fits too, a name with the date is
  shortened in the middle]
- **Recordings go to the SD card by default** (`settings.rec.toUSB` off in the card's state).
- **About's "Device IP Address"** asks `eth0`, then `wlan0`.
- **Look and meters** (`app.js`): see "Mod settings" below.

## The sound behind the EQ curve (#131)

The EQ page shows the channel's sound behind the EQ curve, on both models: the analyser and the taps
go into `mixergraph-dlzlite.js` and `mixergraph.js` alike (the full-size has mics 3 and 4 and player 3
instead of the virtual channels, `DLZMOD_rtaCode`) [XS: device; full-size: `tests/graph-check.js` and the
sandbox, not yet on a mixer, so its processor load is unknown]. A **Spectrum** switch on every EQ
page, under Mackie's EQ switch (which moves up in its box for it, patched `PageEQ.initWidgets` and
`paint`), turns it on or off for all channels at once: hub key `dlzmod.spectrum`, off by default on both models (its load on a full-size is not known); off,
no channel is measured (`dlzmod.rta` 0, the graph's spectrum blocks bypassed) and nothing is drawn
[sandbox]. `dlzmod.rta` is saved with the other keys, so a mixer switched off on an EQ page starts with
it set; the first VU message on the screen with no EQ page open clears it (`DLZMOD_rtaVu`) [static].

- **Graph** (`graph-mod/dlzmod-graph.js`, patched into `mixergraph-dlzlite.js` and `mixergraph.js`): the mod's first
  change to the audio engine. A mono buffer of its own (`dlzmodRta`), cleared at the start of each
  cycle; a tap (`GainWithLinMixTo`, stereo -6 dB per side) right after each channel's EQ, behind
  Mackie's "dynin" meter, bypassed unless hub key `dlzmod.rta` names that channel; at the end, before
  the file's own `compileGraph(graph)`, per half-octave band (22.4 Hz - 16 kHz, 20 bands, #217) a copy, a
  high-pass a quarter octave below the centre and a low-pass a quarter octave above (`EqBand` `T_HP` and
  `T_LP`, Q 0.707, bypassed with no channel measured) and a `MaxMeter`, reported as the VU group
  `dlzmod.rta`. `EqBand`'s own band-pass (`T_BP`, which Mackie never uses) read silence on every band
  [device]. Each tap is a nested list, so Mackie's next block keeps its buffer.
  `tests/graph-check.js` (from `tests/patches.sh`) builds both graphs in a stand-in for dspserver's
  prelude: Mackie's 583 blocks (XS) or 676 (full-size) unchanged and in order, the mod's 95 writing
  only its own two buffers [static; the spectrum follows the EQ on the mixer: device].
- A channel with **Bypass All Processing** on (its Setup page, `<prefix>procBypass`) skips its EQ,
  high-pass and dynamics in Mackie's graph: EQ changes are neither heard nor seen in the spectrum
  there. Stock behaviour, easy to miss: the EQ page does not show it [device: 9/10].
- **Which channel** (`dlzmod.rta`: 0 none, 1-2 mics, 3-4 players, 5-6 virtual, 7 samples, 8 master;
  `DLZMOD_rtaCode`): set by the mixer's own screen when its EQ page opens, changes channel or closes
  (PageEQ `onShow`/`sync`/`onHide`, patched), and 0 at `startGUI`. The server takes it from the
  screen only (`DLZMOD_keyAllowed`); a browser shows the spectrum when its EQ page has the screen's
  channel. In `DLZMOD_keys` (so app.js knows it and the card's state has it from the install), not a
  setting [sandbox: 3 for channel 3/4, 8 for LR, 0 after leaving the page].
- **Drawing**: every VU message (`parseVuData`, patched) goes to `DLZMOD_rtaVu`: the band bytes
  (Mackie's VU scale, 1/80 per dB) as 128 points over the curve's 20 Hz - 20 kHz, interpolated in dB
  between bands (Catmull-Rom, never beyond the two nearest bands), on a **fixed scale** of its own,
  -60 to 0 dBFS, as analysers have (Pro-Q: 60, 90 or 120 dB, set by hand). An automatic scale, tried
  in #131 and #217, moved the whole picture and put it against the top when music started. That is the target of an animation of the mod's own (`DLZMOD_rtaTick`), which moves the EQ widget's spectrum data
  (`rtaData`, as Mackie's `setRTA` would set it) 80 % of the way per 100 ms of real time, a step
  every 33 ms like the meters' tick; on silence (judged on the message itself, not
  the average) or no message for 300 ms it sinks to the bottom and goes. With `rtaOverlay` off the
  widget draws it with the curve; Mackie's overlay layer is not used. Drawn by the mod's
  `DLZMOD_rtaPaint` instead of Mackie's `paintRTA`: a 4 pixel line at the points' exact height, no
  fill (its cost below) [device]. Averaged like a meter (`DLZMOD_rtaSmooth`: in dB, up in about 0.1 s, down in about
  0.3 s; 0.4 s both ways felt late on the mixer, 0.05 s and 0.2 s with a quicker glide jumpy; before that: peaks held, falling 20 dB/s, which a
  steady dip drowned in). The
  bands soften an EQ change (2nd-order filters, neighbours leak in), and more bands do not help: a
  -15 dB cut at 4 kHz Q 4 on pink noise reads -2.9 dB with 10 bands, -3.2 with 20 or 30, -3.3 with 60;
  twice the filters per band, -4.6 [static: a simulation of the filters]. So `DLZMOD_rtaEqShape`
  draws the EQ from the curve Mackie's widget has (`graphPoints`): the curve as a band sees it comes
  off on the sound's scale and the curve goes on, on its own scale (at 60 dB alone a cut looked half as
  deep [device: "moves, but does not reflect what it is doing"]); not with the EQ bypassed or
  `procBypass` on, and fading out under -54 dBFS, so a boost never shows sound that is not there. So a
  cut dips as far as the curve; its shape is calculated, not measured. The audio's cost:
  [components/dspserver.md](components/dspserver.md). Each frame
  redraws the whole EQ widget (grid, curve, knobs). A redraw for something else or a touch within 66 ms counts
  as that step's frame, so the picture keeps moving while a knob turns without adding to it [device].
- **What limits its frames** (#217) [device, XS, GPU trace, 2026-11-05, music, hands off]: not the
  processor (glesgui ~10 % of a core, cores 0-2 mostly idle) and not the mod (28 frames/s sent, none
  skipped) but the graphics chip, 96 % busy. A frame is ~23 ms of Xwayland and Weston whatever it
  shows, plus glesgui's job: ~46 ms with Mackie-style fill (14 frames/s), ~16.5 ms with line only, 1 or
  3 px, or nothing at all (~22 frames/s, the ceiling for this page). The same fill as 63 convex slices
  took ~20-25 ms, measured with a finger on the screen, so not cleanly; line only won on the look.
  glesgui merges frames that arrive while it is busy, so sending more than it shows is harmless.
  A faster processor would not help (#5); the GPU clock is fixed at 408 MHz.
  So a frame is drawn only when a point moved a pixel since the last one. A touch anywhere on the screen
  (`Events.eventPointerDown/Move/Up` wrapped, `DLZMOD_rtaHookTouch`; app.js's touch input from glesgui
  and a browser's mouse call them on `Events` by name at each event [static]) or a redraw for something
  else (a knob, a dragged dot; `eq.update` wrapped) within 66 ms counts as the step's frame, and none is
  drawn while the screen program is behind (`DLZMOD_rtaBacklog`): app.js writes each frame into glesgui's
  pipe without waiting (`wstream.write`, its return value ignored), so frames glesgui cannot keep up
  with pile up in app.js's memory and the screen falls further behind the longer it lasts [static; the
  lag that grew with the spectrum on: device]; more than 16 KiB waiting (`wstream.writableLength`)
  skips the spectrum's frames until it has caught up.
  Tried and dropped: the spectrum alone on Mackie's top sheet (the overlay layer, `rtaOverlay` on): the mod sent 28
  frames a second, 36 ms apart, yet the screen lagged far more, as on the mixer every clear of the
  top sheet clears all of it and glesgui lays the whole sheet over the screen for each frame
  ([components/node-backend.md](components/node-backend.md)) [device]. Colours
  (`DLZMOD_rtaColor`): the meters' colour of the look on screen (theme or own fader colour, #21),
  85 %, High contrast 100 %, set at each message so a change of look shows
  at once; Mackie's own greys were too dim [sandbox].

## The fourth EQ band (#25)

On both models the EQ page has a fourth band. Knobs, sound and old presets tested on the XS [device,
dev-c34a68f]; on the full-size only the page, in the sandbox.

- **Graph**: patch.py adds `b4` to all 10 lists of bands in `mixergraph-dlzlite.js` (the only
  anchor that occurs more than once, with its count in `GRAPH_PATCHES`): 18 `EqBand`s more, each right
  after its band 3, peak like bands 1-3. Skipped while its gain is 0. `tests/graph-check.js` checks
  each one against its band 3 and runs its other checks without them. Heard on the mixer
  [device]. Processor load: ~0.18 points per active band, ~3.2 for all 18 [device, 14 measured],
  table in [components/dspserver.md](components/dspserver.md).
- **Full-size**: `patch.py graph-full` puts the same band in the 9 lists of `mixergraph.js`. Both
  files are patched on every card, the model's own one runs. `tests/graph-check.js`
  checks it against the stock file. It never ran on a full-size: its load is not measured and a
  mistake would show there first [static].
- **EQ page**: band 4 is one more line in `bandsConfig`, in the spare colour of `Color.eqBands`; the
  widget's drawing and touch loop over the bands. `patch.py` changes what counts three: the panel's
  title and key lists, `eqBand` <-> selected band.
- **Knobs**: as for bands 1-3, knob 1 the HP filter, 2-4 frequency, gain and Q of the selected band,
  chosen by touch on the XS. faderlink has no `eq.b4.*`, so with band 4 selected `DLZMOD_eqKnobs`
  puts knobs 2-4 on the stand-ins (`faderlink.md`, "Knob stand-ins"). On the XS the real knobs move
  it [device], so `a.1.pan`, `f.0.pan` and `f.1.pan` work as stand-ins too.
- **The full-size's fifth knob**: `eqBand` is now four bands of 0.25. faderlink moves it 0.1833 a click
  within 0.1333-0.8667, so turning passes every band, from any band's own value, one or two clicks
  each [static, from faderlink's numbers].
- **Keys**: both copies of Mackie's state defaults in `server.js` and the one in `app.js` loop over four
  bands, with the same conversions; the default is flat at 10 kHz. `srv_data.json` is merged over the
  defaults, so a mixer that has run before gets the keys at its next start. New presets and snapshots
  contain the band. The EQ page's Reset sets it flat (`$DEFAULTS.eq`).
- **Old presets and snapshots** set nothing on keys they do not have, so band 4 would stay as it was.
  A preset without it goes flat in `DLZMOD_eqOld` (a wrap of `Data.apply`, every preset passes there), a
  snapshot in `DLZMOD_snapEq` (server, `SNAP_LOAD`), per channel. Only the gain is set.

## Headphones: solo and the computer send per headphone (#60)

Stock, solo replaces only headphone 1's sound, and every headphone's Send to USB writes USB out 3/4,
so the screen allows one at a time ([components/mixergraph.md](components/mixergraph.md), "Features
in the graph"). Both models; the full-size has 4 headphones. Graph checked by `tests/graph-check.js`,
the page in the sandbox (XS and full-size) [static]; sound not heard on a mixer yet.

- **Hear Solo**: a switch per headphone on its page (PageAux, under Color), key `a.N.dlzmodSolo`. The
  graph's headphone source (one `CopyFrom` per side) asks `@a.N.dlzmodSolo` where stock asks
  `N == 0`. The key is in the three copies of Mackie's aux defaults (two in `server.js`, one in
  `app.js`), on for headphone 1, off for the others, so stock behaviour is the default; a graph
  binding with an unset key would never apply and leave that headphone's source at its default, so
  the defaults matter (`srv_data.json` is merged over them: a mixer that has run before gets the key
  at its next start). A snapshot saved before #60 has no such key, and loading sets only the keys
  it has; `DLZMOD_snapEq` (server, as for band 4) gives each headphone in it stock's value.
- **Send to USB**: headphone N writes USB out `3+2N`/`4+2N` (`DLZMOD_hpUsbOut` in
  `graph-mod/dlzmod-graph.js`): 1 on 3/4 as stock, 2 on 5/6, full-size 3 on 7/8 and 4 on 9/10. The
  PC always gets all 14 channels; outside "record to computer" Mackie's strips write silence to
  USB 3-12 earlier in each cycle, so a send that is off stays silent, and "record to computer" still
  switches the sends off. The page's switch is no longer greyed out while another headphone's send is
  on, and its label names the pair (`DLZMOD_hpUsbLabel`). Who used headphone 2's send before now
  finds it on USB 5/6. Send to NDI stays one headphone at a time (one NDI output).

## Ducking: which mics, which strips, how deep and how fast (#18)

Stock, mic 1 is the only trigger (-25 dB) and every other strip ducks by -15 dB, with nothing
adjustable; its "Auto-Ducking" setting (`settings.rec.autoDucking`) exists but stock never shows it
([components/mixergraph.md](components/mixergraph.md), "Features in the graph";
[components/node-backend.md](components/node-backend.md), "Ducking"). Both models. Graph checked by
`tests/graph-check.js`, the page in the sandbox (XS and full-size) [static]; not heard on a mixer yet.

- **Where**: the pad editor's Ducking page (Pads, a pad in Control mode, Ducking), in place of stock's
  one line of text, as the Fade page holds Fade's settings and Mute Group its row of channels (the
  maintainer's choice; Settings → Recording / Routing is full since #14). Mackie's widgets and
  colours, the mod's mark on each row: Depth and Threshold sliders, Speed (Slow / Normal / Fast),
  Always on (stock's `settings.rec.autoDucking`: ducking without a pad, the pad stays lit), a Trigger
  row (the mics) and a Ducked row (every strip, labelled as on the Overview: the samples are 7/8 on
  the XS, 11/12 on the full-size). A mic that triggers is never ducked itself: its Ducked switch is
  greyed out meanwhile.
- **Knobs** (`DLZMOD_padKnobs`, also #272 for Fade): stock leaves the knobs next to the screen on the
  Overview's (`app.mixer.setKnobs`, the pad editor's onShow) on every Control mode. On the Ducking
  page knob 1 moves the depth and knob 2 the threshold (1/80 of the range a step), through the
  stand-ins of #238 (faderlink's table has no `dlzmod.*` keys). On the Fade page knob 1 moves the
  pad's fade-out time and knob 2 its fade-in time, on the pad's own `B.x.y.ctrl.fade.out` / `.in`,
  which faderlink's table has (as stock's sample editor puts a sample's fades on the knobs). 3 and 4
  dark; in `Color.main`: the panel in the owner's accent (#21), the LED rings in Mackie's own blue (every `K.N.color` goes out as Mackie's colour, `DLZMOD_ledColor`). Set once per mode and pad
  from the Control page's sync, 150 ms later so the page's own frame goes out first (in the same
  tick, the rings changed well before the screen on the mixer [user, 2026-11-12]) (again would put the stand-ins back to their middle); another mode,
  or the page out of sight once stock's code is done (its onHide, checked a tick later: stock's setMode hides and shows the page on every sync of the editor), gives the Overview's back, but only while the panel still holds
  that list, so a page that set its own knobs meanwhile keeps them [static, sandbox; not turned on a
  mixer yet].
- **Keys**: `dlzmod.duck.depth` (0..1 = -30..-5 dB, 0.6 = stock's -15), `dlzmod.duck.threshold`
  (0..1 = -45..-5 dB, 0.5 = stock's -25), `dlzmod.duck.speed` (0 slow: attack/release/hold
  1000/2000/1500 ms; 1 = each block's stock times: mics 500/500/250, the rest the plugin's
  1000/1000/1000; 2 fast: 50/250/250), `dlzmod.duck.src.N` (mic N triggers; mic 1 on),
  `dlzmod.duck.on.<strip>` (`i.N`, `p.N`, `v.N`, `s`; all on). The graph holds depth and threshold to 0..1 (a browser can set any value) and takes stock's for one that is not a number; `tests/graph-check.js` checks that every key the graph binds is in the defaults. Global, like the setting next to
  them: `DLZMOD_duckDefaults` puts them into Mackie's defaults right after `settings.rec.autoDucking`
  (both copies in `server.js`), so they are set from the start (a graph binding with an unset key
  never applies: the strips would never duck), snapshots leave them out (they skip
  `createGlobalData`'s keys) and a factory reset sets them back. Both models' keys on both (10
  strips, 4 mics); a model never reads the others.
- **The graph** (`graph-mod/dlzmod-graph.js`): dspserver's `AutoDuckSource` overwrites its group's
  flag on every cycle (mixergraph.md, "DSP block catalogue"), so two sources would not add up.
  Instead each mic is mixed (0 dB, bypassed unless it triggers) into the mod's buffer
  `dlzmodDuckKey`, where stock's source sat (after the fader and auto mix), the buffer is cleared at
  the start of each cycle, and one `AutoDuckSource` on it follows the mic loop, before the strips it
  ducks. Two mics both just under the threshold can add up to above it. A ducked mic runs before
  that source and follows the previous cycle's flag (a few samples later than stock's mic 2). Every
  `AutoDuck` takes its enable, depth and times from the keys.

## Any source on any stereo channel (#24)

Stock, each stereo strip has 2 or 3 sources of its own (XS: 3/4 line 3/4 or Disk, 5/6 line 5/6 or
Bluetooth, 9/10 and 11/12 USB 1/2, USB 3/4 or NDI; full-size: 5/6 and 7/8 their line input or USB
1/2, 3/4, 9/10 Bluetooth, Disk or NDI), and the mix-minus and intercom rules in the graph test those
src values strip by strip ([components/mixergraph.md](components/mixergraph.md), "Source
selection"). Both models have the same 7 stereo sources, and the mod gives every stereo strip all of
them. Both models; graph checked by `tests/graph-check.js`, the page in the sandbox (XS, full-size;
Pro and Standard layouts) [static]; not heard on a mixer yet.

- **Where**: the Setup page's Channel Source is one button, in the look of Preset above it (the
  source's icon, its name, the arrow), opening a list of the 7 (Network only where Mackie offers NDI,
  `HAVE_NDI`) with the strip's own lit; a tap sets it and closes (the maintainer's choice over a grid
  of buttons). Pro and Standard layouts (`player` and `input2` widgets); EZ shows no sources, its
  Channel Setup is Mackie's assistant. The Mix-Minus switch shows on every stereo strip (stock: not
  on the XS's 3/4) and is greyed out on a local source (a line input, Disk), as stock for its own.
  A virtual channel's default icon follows its source.
- **Keys**: `<strip>.dlzmodSrc` (`p.N`, `v.N`): the pool id 0..6 (first line input, second, USB 1/2,
  USB 3/4, Disk, Bluetooth, NDI; `DLZMOD_srcPool` in the graph, `DLZMOD_srcList` in the app, the same
  order), or -1 = "as Mackie's `src` says". A choice the strip has in stock is set as Mackie's `src`
  (and -1), only another one as `dlzmodSrc`, so a version without #24 (Go Back, #269) or a snapshot
  from before it still finds a valid `src` and the stock routing. In the three copies of Mackie's
  channel defaults (players, virtual channels), so the graph's bindings apply from the start and a
  mixer that has run before keeps its sources (-1). Per channel, in snapshots and channel presets
  like `src`. A snapshot without it: -1 (`DLZMOD_snapEq`). Any stock code that sets `src` (the setup
  assistant) puts the strip back on that stock source (`DLZMOD_srcSetHook`, a wrap of `Data.set`:
  only the screen's own changes pass there, the server's come in by `Data.put`); a channel preset
  holds `src` before `dlzmodSrc`, so a new one keeps the own source and an old one gives stock's.
- **Graph** (`graph-mod/dlzmod-graph.js`, `patch.py` "sources: ..."): every strip's input
  (`DLZMOD_srcBuf`: Bluetooth silent while nothing is connected, stock's rule for its Bluetooth strip,
  now on any strip), Mackie's global flags `btMixMinus`, `usbMixMinus`, `ndiMixMinus` and the NDI
  receiver's enable (some strip on that kind of source), and every send's mute (Bluetooth, USB and
  NDI outs, main mix, reverb/delay, headphones) are rewritten on the kind of the strip's source
  ('' local, `b`, `u`, `n`: the letters of the intercom keys), not on the strip. What stock does for
  its Bluetooth strip is done for any strip on Bluetooth, the same for USB and NDI. One stock
  difference kept per model: in a headphone's intercom mode the XS mutes local sources there, the
  full-size does not, nor its NDI strip (`DLZMOD_muteAux`). Two strips on one source both get it (as
  stock with USB). On the XS the NDI receiver runs after the players, so a player on NDI hears the
  cycle before (a few ms) [static].
- **Mark**: the mod's yellow bar left of the source button on every channel that has one (Pro and
  Standard, `DLZMOD_srcMark`), and on the pads also by Keep Pads, Trim and Mix-Minus.
- **Checked** (`tests/graph-check.js`): every rewritten expression is run against stock's over all
  key values with `dlzmodSrc` -1 (~190,000 cases on the XS, ~100,000 on the full-size); every strip on
  each of the 7 against the stock strip that has that source; the global flags by kind; no stock
  rule on `src` left; the key only on the strips whose `src` stock reads.

### The pads channel's source (#275)

Stock's pads channel (samples, `s.`: XS 7/8, full-size 11/12) has no source, trim or mix-minus: its
sound is the 48 pad players, the preview and the censor tone. The mod lets it take one of the 7 too.
Built with #24; graph checked, the page in the sandbox (XS; Pro and Standard) [static]; not heard on
a mixer yet, and the side knob not turned on one.

- **Where**: Mackie's player panel shows on the pads' Setup page too (stock: empty there): the source
  button ("Pads only" first in its list, the default; the button reads "Pads + USB 1/2" while Keep
  Pads is on, "USB 1/2" when off), **Keep Pads** right under it (on: pads and source, off: the source
  alone; greyed out without a source), Trim with its meter, and Mix-Minus (greyed out without a
  source or on a local one). In Standard the same in `input2`, Mix-Minus in Mackie's `misc` panel.
- **Keys** (Mackie's three copies of the pads' defaults; snapshots and channel presets like the
  others): `s.dlzmodSrc` (-1 none, the default), `s.dlzmodPads` (1), `s.mixminus` (0), `s.trim`
  (Mackie's trim helper, as the players': -10 dB). A snapshot without them: Pads only, Keep Pads on.
- **Knob**: knob 1 next to the screen is the pads' Trim on the Setup page (and on Mackie's other
  list with a Trim knob), as on a player. faderlink's table has `p.N.trim` and `v.N.trim` but no
  `s.trim` [static, faderlink's strings], so it goes through the #238 stand-ins
  (`DLZMOD_srcTrimKnobs`). Mackie's `haveTrim` stays as it is: it would also put a gain slider and a
  meter for the pads on other pages.
- **Graph** (`DLZMOD_padSrc`, after the pads' `CopyFrom`, both models): a `Gain` on the channel that
  silences the pads (`DLZMOD_padsOff`: a source set, Keep Pads off, but never while the censor bleep
  or its tone plays, both on the pads' buffer); then on the mod's own buffers the source through a
  DC filter, the trim and a meter (`vuSmpGainL/R`, the VU group `smp.gain`, which app.js already reads
  for a channel's trim meter; stock has none for the pads), mixed in at 0 dB only while a source is
  set and muted while the bleep runs. So the source shares the pads' EQ, dynamics, fader, sends and
  ducking. The pads' sends follow the source's kind (`DLZMOD_padMuteExpr`, mix-minus on
  `s.mixminus`), as a stereo strip on that source; without one or on a local one, stock's pads rules
  (a headphone's intercom mix mutes the pads on both models). Mix-minus keeps the whole channel, pads
  too, out of the caller's return. The gate and the mix are the mod's only blocks that write a buffer
  of Mackie's; `graph-check.js` checks them where they are and the pads' 16 (XS) / 20 (full-size)
  sends against stock: as the stock strip with a remote source, as stock's pads with a local one.

### The pads channel's mute on the screen (#276)

On both models the pads have only a solo button, no mute (XS: a knob, full-size: a fader; only LR
has a mute button of its own) [maintainer, photo of the full-size]. Stock's XS gives LR a mute and
9/10, 11/12 a mute and solo on the screen, shown while the strip is selected on the Overview; the
full-size has none. Both models; sandbox (XS, full-size) [static]; a real tap not tried yet (the
sandbox's synthetic taps reach no on-screen strip button, Mackie's LR mute neither; pressing it in
code toggles `s.mute`).

- `DLZMOD_padsMute` (from the strip's `initWidgets`, `patch.py` "pads: ...") makes LR's button
  (`E1ToggleButton`, postfix `mute`, 48×38, 5 px above the name plate) for the samples strip, not for
  the Aux page's copy (`noMarks`). `DLZMOD_padsMuteLayout` (the strip's sync) raises the meters and
  fader marks by Mackie's 61 px while the strip is selected on the Overview, else stock's 25 / 21. An
  XS pads strip without a knob (#23) has the screen fader's layout, which shows it the same way.
- Mackie's `SELECT` syncs the newly and the last selected strip on the Overview on the XS only; the
  full-size now does too when one of them is the pads strip (`DLZMOD_padsSel`).

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
- **Mod**: version, "Automatic Update Check" (#55), update status (an update waiting on the card,
  with "Install Update..." on the mixer's own screen, #65; a new release found, with Check for
  Updates... / Download Update...: [updates.md](updates.md), "Check for Updates"), "Go Back..." next
  to What's New on the mixer's own screen while the version before the last update can be put back
  ("Don't Go Back" once chosen; #56, [updates.md](updates.md), "Going back"), credits.

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
  `hand` and `device` are also written to `/run/dlzmod-clock-how` (`DLZMOD_clockKeep`: temp file,
  rename) and read back when the server starts (#208): `/run` is a tmpfs, so a restart of the mixer
  software keeps them (the date in recording names, no browser's time over a time set by hand) and a
  power-off clears them; `internet` is not written, chronyc is asked again. A file that cannot be
  written only logs: the clock is set all the same [static; unit test]. On the dev card [device,
  2026-11-02]: `/run` is a tmpfs (`findmnt`, 100 MB); with chrony stopped, the clock set by hand
  wrote `hand`, and after `systemctl restart evolve-node` the file was still there and the next
  recording got the date (`REC_0006_penguin_2026-11-02_0952`).
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
  step back stopped every frame for the length of the step [static]. patch.py gives that timer
  `DLZMOD_frameNow` (`performance.timeOrigin + now()`; app.js runs as `node app.js` (jsdom without
  its own `requestAnimationFrame`) and leaves node's own `performance` in place). The other
  `Date.now()` uses in app.js (a double tap, a swipe's speed) misread at most once. Stock rarely
  steps back much: its saved time is always behind; with a time set by hand, a phone's time or the
  #1 floor it can.
- **Touch after a step back** (#188): Mackie's `glesgui` polls the touch panel at most every 20 ms
  by the wall clock (`system_clock::now()`, its touch poller at `0x22264`), so after a step back no
  touch reaches the app for the length of the step, while the screen keeps drawing [static,
  disassembly]. On the dev card [device, 2026-10-28, dev-e621027]: offline start, clock set 5 min
  ahead by hand at 52 s, Wi-Fi stick in, chrony stepped it back 323 s at 75 s; the screen kept
  drawing (the brightness knob's value changed on it), touch came back after about 5 minutes, and
  the card said "Set from the internet". The earlier run (dev-7c89412, step back 91.6 s at 62 s,
  "the screen stood still", restarted by hand) had both waits; which one the user saw is not known.
  A step forward does neither. The fix (#188) is in glesgui itself: `dlzmod-glesgui` points that
  call at the steady clock ([glesgui.md](components/glesgui.md)). A new card gets it from
  `card-core.sh`; an updated one from `dlzmod-update` at a start without an update file (not in the
  update's sandbox: its stage is in RAM, glesgui is 42 MB), used from glesgui's next start. Only a
  glesgui with the stock hash is changed; at later starts it reads only 4 bytes [static; tests/glesgui.sh].
  On the dev card [device, 2026-10-28, dev-6e44350]: the start after the drop-in patched it at
  19.5 s (~8 s, once; Mackie's node processes started at 19.8 s instead of ~12 s); glesgui started
  0.04 s later (no ordering between the two: by chance) and so already ran the patched file
  (`/proc/<pid>/exe` not "(deleted)"); later starts silent. Then
  offline, the clock set 5 min ahead, Wi-Fi in: chrony stepped back 292.6 s at 87 s and touch kept
  working. The rest of glesgui, dspserver and faderlink waits on nothing a step can stall (#144,
  [glesgui.md](components/glesgui.md), "Nothing else waits on the wall clock") [static].
- **The floor's search time** (#209): `find -printf '%T@'` stats every file, and on FAT each stat
  of a name not yet cached reads its folder from the start, so the time grows with the square of
  the files in one folder. All recordings go into one folder (`DLZ_Creator_XS_Recordings`, up to
  `REC_9999`; a multitrack take is one 14-channel WAV, split every ~17 min). On the PC [WSL, FAT32
  image, cold cache]: names alone take the same at 0 and 5,000 files (~120 ms, mostly process
  start); with times, +0.1 s at 1,000 files, +0.4 s at 2,000, +2.6 s at 5,000, past the 10 s limit
  at 20,000; 5,000 spread over 10 folders +0.3 s. The mixer's Cortex-A7 is many times slower than
  the PC, so a folder of a few thousand takes reached the 10 s limit at every start (measured below);
  on the cards seen so far (≤ ~10 files) it took 0.5-1.5 s, nearly all
  fixed cost. On the mixer [device, 2026-11-11, dev card XS, 3,000 empty files in
  `DLZ_Creator_XS_Recordings`]: `find` with times took 15.4 s with the folder already cached, so
  at a start the old floor ran into its 10 s limit and gave no answer. What the floor gains is
  small since the minute saver: at most the minute between the last save and the power-off. Decided: keep the floor, but make its time not grow with the number
  of recordings (#234). Since #234 the floor reads the times raw (`fattimes` in `dlzmod-clock`, a
  python3 `-I -S` stdlib reader): the boot sector, then every folder's cluster chain once, read-only
  from the device mounted at DLZDATA (`/proc/self/mounts`, vfat only), taking each entry's flags,
  start cluster and write time, no names (deleted entries, long-name parts and the volume label
  skipped, folders followed, `.`/`..` not). The times as the kernel gives them: FAT's local fields
  less the offset `zone` gave the kernel (`hwclock --systz`; 0 when that failed, as systemd leaves
  it), out-of-range fields as `fat_time_fat2unix` takes them. FAT16 and FAT32. A damaged folder
  chain is read up to the damage, as the kernel's readdir does, and a chain over FAT's 2 MiB folder
  maximum (a loop or cross-link) is cut there, both logged; a folder whose start cluster is out of
  range is left out. FAT12, a broken boot sector or a read error (exit 2, logged) fall back to
  `find` in what is left of the 10 s limit; a raw read over the limit gives no answer and no `find`
  after it. (`dlzmod-update` mounts DLZDATA as `vfat` only: an exFAT DLZDATA is not mounted, #16.)
  On the PC [WSL, FAT32 with 512-byte clusters, loop mount, cold cache]: 0 / 5,000 / 20,000 files
  in one folder ~55 / 54 / 69 ms raw against 45 ms / 6.9 s / 111 s with `find`; the raw times equal
  the kernel's for 301 files (long names, a deleted file, nested folders, 1980 to 2033) [static;
  `tests/clock.sh`]. On the mixer [device, 2026-11-11, dev card XS]: the whole floor (its log
  line's ms) took 740 and 480 ms with 92 files on the card (the old floor: 950 ms on the same card),
  1,110 ms with 3,000 more in the recordings folder; after a recording and a switch-off within the
  minute, the floor moved the clock 44 s forward, past the new recording.
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
mixer's own screen (#65), which since #207 asks right after the upload. Nothing is checked or installed live: the next start finds the files [PC:
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
- **Then** (#207): once both files are in place and synced, the server writes their question to
  `pending` (`DLZMOD_uploadAsk`, `DLZMOD_writeDurable` on the card's ext4 system: their record, the
  updater's `SUM`, hashed as they stream in, and the version from the package's name) and sends it to
  the mixer's screen; the answer says "Tap Install on the mixer's screen, then switch the mixer off
  and on." Install and one switch off and on install it. Before #207 the first start only asked, and
  the start after the Install installed it. The record names exactly these two files: changed or
  replaced on the card since, they are asked about again. The very files that failed before
  (`failed`) get no question, which would install nothing; the answer says they are not tried again.
  A power cut between the files and the
  question leaves the files without it: the start asks. A question that cannot be saved: logged, the
  answer says the start asks [static; unit tests].

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
