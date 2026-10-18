# Node backend: server.js, app.js, data.js (`/srv`)

Owned by package `evolve-node` 3297. Overview and protocol: [architecture.md](../architecture.md).

## Files

| File | Size | What |
|---|---|---|
| `server.js` | 849 KB | Hub (service `evolve-node`). Webpack bundle: express + socket.io + data.js; app logic at the end (~offset 661000–709676) |
| `app.js` | 793 KB | The UI (service `evolve-app`), one line, runs in a browser *and* headless under jsdom |
| `data.js` | 14 KB | Shared definitions (`module.exports=`), inlined into both bundles: LITE detection, `chConfig`, enums (`E_PLAYER_STATE`, `E_PAD_MODE`, `E_FX_TYPE` ...), value scaling, colour tables, `createSrvData()`, `setLiteMode()` |
| `srv_data.json` | 98 KB | Live state (flat dict) |
| `index.html` | | Browser entry: loads `libs/socket.io.js` + `app.js` on a 1024x600 canvas |
| `emu.html` / `emu.js` | | "HW EMU" build with an emulated front panel and a "Connect to IP" prompt |
| `demo*.html`, `site_demo.js`, `server_demo*.js` | | Offline marketing demo (ports 8090/8091), not started by systemd |
| `presets_factory/` | | Factory presets: `ch comp del ds eq gate rev` |
| `presets/` | | User presets: `eq gate rev snaps` (not owned by the package) |
| `bankPlayer/default/` | | Default sample WAVs; `loaded/` is the working copy |
| `srv.sh` | | Dev leftover: runs server.js in `screen` |

All [static].

## server.js

- Listens on **:80** (express + socket.io, `allowEIO3`) and **:89** (raw TCP), no host argument,
  so both bind to all interfaces.
- Routes: `GET /app.js` reads app.js fresh and prepends `window.LITE_MODE = 0|1`; everything else
  is `express.static(/srv)`; unknown paths redirect to `/`.
- No auth (`basic-auth-connect` is a dependency but unused).
- Message dispatcher `la()` (~@704176), command table `pa` (~@685501), state setter
  `globalThis.setDataKey` (~@677337), state save `Et()` (~@675402), startup load `_t()` (~@673346),
  preset read with user → factory fallback `Tt()` (~@676012). Offsets are approximate and only
  valid for build 1731.
- Shell-outs (`promisify(exec)`): `systemctl stop|restart dspserver`, `systemctl start upgraderun`,
  `systemctl restart evolve-app` (RESTART_GUI), `lsblk -OJ`, mount/umount under `/tmp/mnt/<dev>`,
  `parted`/`mkfs.vfat`/`dd` (FORMAT_*), `ip addr show eth0` every 5 s → key `ip`.
- Watches `/dev/disk/by-id` for media hot-plug; offers any `*evolveupdate*.upd` found on media.
- Commands: `pa[cmd](args, id, msg, send)`; `send` answers that client only; a returned
  `{rootResponse}` goes to that client, `{broadcastResponse}` to all. `la()` logs every incoming
  command with its args through `g()`, which prints only at `VERBOSITY >= 2` (unset on the mixer,
  default 1) [static]: mod code must never log a password itself.

### Network panel (mod)

The mod's Wi-Fi and SSH command (`DLZMOD_NET`) and its screen-only gate: [../mod.md](../mod.md),
"Network panel: Wi-Fi and SSH".

## State persistence

- In-memory dict, initialised by `createSrvData()` and merged with `srv_data.json` on start;
  transient keys reset, `version` always taken from the code.
- Saved every 3 s when dirty: write `srv_data.json.tmp` → `mv` → `sync -d`.
- To edit offline: stop `evolve-node` first, or it overwrites your changes within 3 s.
- Snapshot (`presets/snaps/*.json`) = flat dict of full keys (~733); channel preset = flat dict of
  relative keys (`eq.b1.freq` ...).

## Media and recording (server.js)

All [static].

- **Accepted media**: `lsblk -OJ`; a card/stick only counts as `INSERTED` when its `fstype` is
  `vfat`, anything else (exFAT, NTFS, ext4) shows as `NOTSUPPORTED`. Mounted under `/tmp/mnt/<dev>`
  with `ro,noatime` (+ `flush` for vfat), remounted `rw` when a recording starts.
- **Read-write remounts**: "permanent" (log `RW (Perm)`) at a recording or sample recording start,
  and at every start when a recordings folder exists (to finish `*.wav.unfinished` files with
  `wavfinalizer`); "temporary" (`RW (TEMP)`) for a rename or delete, with the back-to-read-only
  function 60 s later. That function waits for running renames/deletes, runs `sync` and logs
  `back to RO1` / `DONE RO`, but never runs `mount -o remount,ro`, and the end of a recording does
  not call it at all: stock, a medium with a recordings folder stays `rw` from the start until
  switched off, so the next start finds the FAT volume "not properly unmounted" [device]. Its
  "permanent" flag compares a mount point with a device path and so never matches. The mod
  remounts read-only itself (#98; [mod.md](../mod.md), "Media back to read-only").
- **FAT's dirty mark is sticky**: the FAT32 boot sector's state byte (offset 0x41, read with
  `od -An -tx1 -j65 -N1 /dev/mmcblk0p2`) is `01` after an unclean switch-off. Linux 5.10 sets it at
  every mount or remount `rw` and clears it at a remount `ro` or unmount, but leaves a volume that
  was already dirty at mount as it is (`fs/fat/inode.c`, `fat_set_state`), and warns "Volume was not
  properly unmounted" at each mount or `rw` remount. So once marked, a card keeps the mark and the
  warning until an fsck (a PC's "Scan and fix") clears it, however cleanly it is used afterwards
  [device: `01` across clean read-only switch-offs, `00` after a Windows scan and from then on].
- **An automatic fsck at startup was tried and dropped** (#98). `fsck.fat -a` (dosfstools 4.2, the
  card's own) truncates a file whose directory entry is shorter than its cluster chain, the usual
  shape of a recording cut off by a power cut (size 0 or the last flushed size), and frees the tail:
  `-f` only keeps chains no entry points to, as `FSCKnnnn.REC`. A cross-linked chain makes it free
  clusters of an intact file. It writes everything at the end (the dirty bit cleared next to last,
  FSInfo last) but without fsync, so writeback can store the cleared bit before the repairs. What
  it could repair safely (the mark, the free count, orphaned chains) changes nothing for the mixer,
  and a card it must not repair would stay dirty and be checked at every start (seconds, before the
  mixer software). Owners clear the mark on a computer, recordings copied off first (README, "SD
  cards") [static + PC: the card's fsck.fat under qemu on test images].
- **Scan details**: a rescan runs when `/dev/disk/by-id` changes. Skipped (with their children):
  names starting with `mmcblk1`, mountpoint `/` or `/boot`, EFI partitions. Every other node with an
  `fstype` is a candidate; SD vs USB comes from lsblk `subsystems` (first `:mmc_host:platform` = SD,
  first `:usb:platform` = USB), not from the name. Keys for the UI: `sd`/`usb` (0 removed,
  1 inserted, 2 not supported), `sdCapacity`, `sdAvailable`, `sdTimeLeft`, `sdFormatStatus`.
  Booted from our card: p1 (`/`) is skipped and `DLZDATA` (p2, vfat) becomes "the SD card", so
  recordings land there. A card that is all ext4 shows as REMOVED (Format button disabled)
- **FORMAT** (`FORMAT_SD`/`FORMAT_USB`): no server-side confirmation (the popup is UI only). The
  disk is hardcoded: `mmcblk0` / `sda`. It zeroes the disk's first 32 KiB with `dd` (MBR and the
  Allwinner SPL at 8 KiB), makes a new msdos table with one FAT32 partition over the whole disk
  (`parted`), then runs `mkfs.vfat -I` on the old partition path (server.js, search `FORMAT_SD`). Booted from SD that is the running boot card:
  `patch.py` refuses `FORMAT_SD`, `patch.py` disables the button
- **Firmware**: on insert `find <mnt> -name *.upd`, newest file → `ca()` links it to
  `/tmp/upgrade.upd` and announces `FIRMWARE_FOUND` if newer than the `version` key; result markers
  `/root/.upgrade{success,fail,failcorrupt}`. Both disabled on the card by `patch.py`
- `FACTORY_RESET` only resets the sample banks and `srv_data` keys (keeping `*.mix`); it does not
  touch storage. No reboot/shutdown commands in server.js
- **Recording file name** (`REC_START`): folder `DLZ_Creator_XS_Recordings` (XS) /
  `DLZ_Creator_Recordings` on the chosen medium; the number is the first four-digit `REC_` number
  in a reverse-sorted listing of the folder, plus 1, i.e. the highest name in reverse sort order
  (server.js, search `REC_START`).
  Weak spots:
  - no check that the new name is free before recording starts
  - any shell error makes the helper return 1 (`REC_0001`)
  - the match is case-sensitive while FAT is case-insensitive: a `rec_0004.wav` is not seen, but
    `REC_0004.wav` then opens the same file
  - numbering restarts per card/folder (no device counter, no date), so names repeat across cards
  - after `REC_9999` the zero padding `"0".repeat(-1)` throws, so recording cannot start
  - `-m1` takes the first match in reverse sort order, not the highest number: a name that sorts
    after `REC_` and contains one (e.g. `old_REC_0002.wav`) wins, and the next name can be taken
  - an empty folder and a failed listing both end in the `catch` (grep exits 1 on no match)
  - `A()` does not await `ue()` (the `mkdir -p`), so the listing can run before the folder exists
  Which of these caused a reported overwrite is not known [guess].
  The UI only offers Settings → Recording / Routing → Disk Recording: Stereo / Multitrack + Stereo
  (`settings.rec.mtk`). `settings.rec.poly` has no UI, defaults to 1 and is 1 in the dump (as is
  `mtk`) [static]: multitrack is then one 14-channel WAV (dspserver.md) [device]. Only with `poly=0`
  (hub key only) is the name a folder (`REC_NNNN/track_N.wav`), whose tracks `sa()` renames to the
  channel names 2 s after stop. Stock keeps no counter: the
  folder listing is the only source of the number.
  The mod's recording names (`REC_0042_otter`, counted across both media): [../mod.md](../mod.md),
  "Recording names".
- The path goes to dspserver as key `recFile`; dspserver writes the WAV itself (see
  [dspserver.md](dspserver.md), split at 2 GB).
- **Boot mute** [static]: when the state is loaded and the marker `/tmp/init-done` is missing (every
  boot), server.js sets `Bleep.sample.mute=9` and parks `settings.bt.enabled` at 0. The graph mutes
  every mic, player and virtual strip while that key is non-zero (each strip's `mute` also looks at
  `Bleep.sample.mute`, in `mixergraph-dlzlite.js`); only the master is not held. On `GUI_LOADED` (sent by app.js at the
  end of its init) the handler writes the marker, sleeps 5 s, restores Bluetooth, sleeps 3 s and
  unmutes. So inputs come up ~8 s after the UI: the "mic ~7 s late" seen on the device. Deliberate,
  probably against pops from codecs, preamps and the BT module [guess]. If `GUI_LOADED` never
  arrives, every strip stays muted until reboot [static]. A restart of evolve-node alone skips the
  mute (marker still there).
- **Pads**: `PADPRSD` is ignored while `lock` is set. Pad modes `E_PAD_MODE` SAMPLE/CONTROL/FX;
  control modes `E_PAD_CONTROL_MODE`: `censor mute locals intercom fade ducking` (with
  `ctrl.hold` = momentary vs. latching). A new pad action needs a case here plus the pad editor in
  app.js.
- **Ducking**: the ducking pad sets `pad.ducking` and `autoDucking` (the graph key). The setting
  `settings.rec.autoDucking` sets both to its own value and keeps the ducking pad lit, so ducking can
  already stay on without a pad; what the setting is called in the UI is still to check in the sandbox.
- **NDI name**: key `settings.ndi.devicename` (default "DLZ Creator XS", "DLZ Creator" on the
  full-size). Stock's NDI settings already edit it: the button under the "NDI Output Name" label
  shows the current name and opens the on-screen keyboard; an empty input changes nothing (app.js,
  search `lang.NDI_OUTPUT_NAME`) [static].

## app.js

- Detects Node vs browser. Under Node: builds a JSDOM, fakes `offsetWidth=1024`,
  `DRAW_STREAM=1` (any OS but win32), `NODE_FPS=30`.
- Connects to the hub on **TCP 89** (flags `$NET.usePipeForNode` and `usePipePort` set at startup,
  `initPipe` ~@277848),
  not socket.io. In a browser it uses socket.io to the page host.
- Rendering: wraps the canvas context (`wrapObject`), queues every call/property set as
  `{obj,call,args}`, writes one JSON array per frame + `{"obj":"ctx","call":"drawFrame","args":[]}`
  to the FIFO `/tmp/glesgui`. See [glesgui.md](glesgui.md).
- Input: WebSocket to `ws://127.0.0.1:8011/`; `DOWN_x_y`/`MOVE_x_y`/`UP_x_y` → `Events.eventPointer*`.
- Readable globals survive minification: `$CFG $NET Events Settings DBG UI`. State keys and command
  names are plain strings.

### Flags (top of app.js)

`DEPLOY=1 VUDEMO SITE_DEMO PIPELINE NO_HOME NO_NETWORK EMULATE_SRV_RESPONSE NODE_API NODE_FPS=30
HAVE_NDI=1 HAVE_NDI_FULL=0 HAVE_STREAMING=0 HAVE_TIME=0 OVERLAY_KEYBOARD=0 HAVE_LANGS=1`.
Debug: `DBG={dev,widgets,data,network,events,...}`, `PIPELINE_DEBUG` / `P_DEBUG(ms)`.
Whether the `HAVE_*` flags unlock anything without native support is unknown [guess].
`HAVE_TIME` is only defined; no other use was found [static].

### Look and meters

- One palette object `Color={black, white, red, green, blue, yellow, ..., white15 ... black60}`
  plus ~80 `Color.*` names in use (`Color.knobs`, `Color.vuGrad`, `Color.vuBg`, `Color.gray69` ...).
  Some hex values are also hardcoded outside it (`#ffffff`, `#666666` ...). A theme can override
  `Color` at startup; the hardcoded rest needs extra patches [static].
- `VU_GRADIENT` is off when app.js runs under Node (`$ENV.isNode`): the meter gradient (`Color.vuGrad`, green → yellow → red) is drawn
  only in a browser; the device draws solid `Color.green` [static]. Probably a NanoVG performance
  choice [guess].
- Meter data arrives as the hub's `VU` command (`parseVuData`); the graph offers pre-gain,
  post-gain, dynamics and post-fader groups per strip (see [mixergraph.md](mixergraph.md)). Per
  strip type the message carries `<type>.pre` (before the gain), `.gain` (after the gain, before
  the fader) and `.post` (after the fader), one byte per channel, value = byte / 254 [static].
  Stock draws `.post` as the bar (its clip light follows that bar, `autoClip`), keeps `.pre` as an
  undrawn second value and uses `.gain` only for the selected strip's gain meter on the Setup
  page [static].
- `VUMeter` can draw a second, dimmer bar behind the main one (`havePre`, `fillStylePre`,
  `setValue(main, second)`); stock never turns it on [static]. The mod uses it for its meter modes ([../mod.md](../mod.md), "Mod settings").
- `modVuByDb(v, db)` adds 1/80 per dB, so the meter is dB-linear over 80 dB, with 0 dBFS at the
  top [device: test tones at -6 and -30 dBFS].

## Patchability

- No source maps, mangled locals, one-line app.js. Patching by **string anchor** (state keys,
  command names, flag names) is practical; offsets are not stable across builds.
- Reload: browser = refresh; on-device UI = `systemctl restart evolve-app` (DSP keeps running);
  hub = `systemctl restart evolve-node`.
- The `/app.js` route already prepends code: a natural injection point for flags.
