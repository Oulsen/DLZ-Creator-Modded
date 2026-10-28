# Modding guide

How to make a mod without rediscovering the system. Read [architecture.md](architecture.md) first.

## Ground rules

1. **Mod only the SD copy.** Never write to the eMMC. Card out = stock firmware.
2. **Never run Mackie updaters while booted from SD.** They would rewrite the SD copy (and
   `kernelupdate` replaces the whole `/boot` and dtb dir).
3. **Leave the GD32 alone**: don't delete `/root/.gd32-loaded-*`, don't touch
   `firmware-*.bin`, `flash-gd32.sh`, `/etc/openocd.cfg`. A failed SWD flash can brick the
   control surface. The FPGA is reloaded every boot, so it is less risky, but leave it alone too.
4. **Never add or remove `/root/.dlzlite`**: it is the factory's mark of an XS, and it picks the GD32
   and FPGA firmware. Removed on an XS, the GD32/FPGA would get the full-size DLZ firmware; added on a
   full-size, the XS firmware. `check-rootfs.sh` checks it against the GD32 marker on every install,
   card build and update ([architecture.md](architecture.md), "One firmware, two products"). On the card,
   `dlzmod-cardcheck` runs before Mackie's FPGA loader at every start: flag ↔ marker, both ↔ the
   eMMC's own (debugfs, read-only: catches the other model, also on `any` cards, and a GD32 moved on
   by a Mackie update after the install), and the eMMC's
   CID hash ↔ `/etc/dlzmod/mixer-id` (a card moved to another mixer, even of the same model, would
   load its bitstream onto another board, next to a GD32 the card never flashed). A failure keeps
   flash-fpga, faderlink and dspserver off [device: passes on its own mixer; the refusals are
   PC-tested only (`tests/cardcheck.sh`)].
5. **FORMAT SD would wipe the boot card**: it targets `/dev/mmcblk0` hardcoded (MBR, bootloader,
   partitions) [static]. On the mod card server.js refuses it and the button is hidden (`patch.py`).
   Never re-enable it.
6. Leave the UART devices (ttyS1 Bluetooth, ttyS2 GD32) to faderlink.
7. Every mod must be reproducible from a clean dump via `install/build-sd.sh`.
8. **Power off before pulling the card.** The system writes to it all the time (`srv_data.json`
   every 3 s, logs); pulling it while running can corrupt the SD's ext4 (the eMMC is never at risk).
9. **Integrate like stock**: a mod feature lives where a stock user would look
   for it (ducking with the channel/effect it acts on, hide header with the display settings,
   meter choice near the meters), drawn with Mackie's own widgets, fonts, colours and wording, and
   only present on the mod card. The Mod tab keeps what is about the mod itself (version, about,
   startup log, update, start the original firmware once) and experiments. A new feature may start
   in the Mod tab for a first test version, then moves to its stock place once it works. Each
   setting in a stock screen gets a small, consistent mod marker (for bug reports and support).
   Every injection is one more `app.js` anchor: check the stock screen plus the new setting in the
   sandbox with a screenshot.

## Brick risks

Anything that lives only on the card cannot brick the device: a broken build, a corrupt ext4, a bad
`boot.scr` or a formatted card means pull the card (stock boots) and reflash it. The FPGA is
reloaded from file every boot. Only state shared between stock and mod can outlive the card:

| Risk | How | Guard (built, on every mod card) |
|---|---|---|
| **GD32 reflashed** (highest) | A Mackie update installed while booted from SD runs as root and can bring new GD32 firmware; `flash-gd32` then flashes it next boot, and stock runs against a GD32 it does not expect (its marker on the eMMC still names the old firmware). Same if a mod deletes the `/root/.gd32-loaded-*` marker. A failed SWD flash can brick the control surface | On the card: drop-ins replace the `ExecStart` of `upgradedaemon`, `upgraderun` and `flash-gd32`
with `/bin/true` (not a mask: faderlink and flash-fpga require flash-gd32) (the clone's GD32 firmware already matches); `server.js` refuses `FIRMWARE_UPDATE` and the UI hides it. `build-sd.sh` and the dumper check `.dlzlite` and the marker. `upgradedaemon` also takes signed updates over the LAN (`POST /upgrade` on all interfaces), switching it off closes that too |
| **eMMC written** | The modded system is root and sees the eMMC; a bug in our own code (updater, share, recordings) could write to it. Mackie's code does not: FORMAT only targets vfat media, and the eMMC is not mounted on the card, so stock's file commands (which reach any path on mounted file systems, #47) cannot touch it [static] | Early unit on the card: `blockdev --setro` on the eMMC (found by `device/type` = `MMC`) and `force_ro=1` on its boot partitions, before any other service. Same lock as the installer. Plus a udev rule (`60-dlzmod-emmc-ro.rules`) that locks it the moment it appears, if it is probed after that unit ran. Stops accidental writes; root can undo it |

**Wrong PMIC voltages** are not a mod risk: the installer boots Mackie's own kernel and device
tree from the eMMC (`install/installer/boot.txt`), the mod card runs the clone's copy of them, and the
SD dumper is a U-Boot script (no kernel). Nothing of the mod declares PMIC regulators [static]. A
mod that brings its own kernel or device tree brings the risk back: regulator constraints that
exclude the current voltage make the kernel set another one at boot.

Not bricks, still guard: mods touching the audio graph or codec I²C scripts can produce very loud
output (clamp levels; ears and speakers at stake). Last-resort unbrick path: the UBOOT button,
likely FEL (unconfirmed, [hardware.md](hardware.md)).

## Version and boot visuals

- `VERSION` (repo root) is the mod version: `vMAJOR.MINOR.PATCH`, max `v9.99.99` (enforced by
  `install/modversion.py`; a longer one widens the sticker picture on the installer's screens and
  shortens their title line). It is
  bumped in `develop` right after a release ([updates.md](updates.md), "Versions and channels"), and
  a new version is released only when functionality is added or changed, not for cosmetic tweaks;
  it shows on the installer's screens, the Settings → DLZ Creator Modded page and the update popup.
  Always write the full form (`v0.1.0`, not `v0.1`).
- **Not on the card's start screens** (kernel splash, Weston background; #97): those are made only
  when a card is built, and a drop-in update cannot change them (`notes/updates.md`, "Drop-in
  update"), so an updated card would keep showing the version it was installed with.
- What each version changed: [CHANGELOG.md](../CHANGELOG.md).
- `build-sd.sh` regenerates both boot images from the image's own originals on every build, in two
  steps: `mklayers.py` renders our parts (one shared layout for both images, Pillow, PC only) and
  `mkvisuals.sh` (called by `card-core.sh`) puts the device's own logo underneath and recolours the spinner (ffmpeg + stdlib
  python3; runs on the device too, for the dumper). Change the design in `mklayers.py`, not in two
  places.
- The Weston background is not a boot step but what shows whenever glesgui is not drawing: during
  boot, during a glesgui restart, and after the card was pulled while running. Hence its hint line.

## Mod settings (Settings → DLZ Creator Modded page)

Where a setting belongs: ground rule 9 (stock place first, the Mod tab for the mod itself and first
tests). The storage and widget pattern below is the same wherever the setting is drawn.

The pattern, as used by "Hide header" (`install/app-mod/dlzmod.js`):

- A setting is a hub key named `dlzmod.*`, stored like Mackie's own keys: the hub saves any key in
  `srv_data.json`, keeps unknown keys across restarts (it merges the saved file over its defaults)
  and broadcasts them to every client. A factory reset drops them, so defaults must be the stock
  behaviour.
- app.js refuses keys its `Data` store does not know (`Data.set` logs `[NOT IN DATA]`): add each key
  with its default to `DLZMOD_keys()`.
- UI: Mackie's `Switcher` with `key: "dlzmod.…"` writes the key. React to changes with
  `Data.regWidget(key, callback)` (also fires when a browser changes it) and in the switch's
  `onToggleON/OFF`.
- The key is global: a browser remote sees the same setting as the device.
- Not for state the server owns (Wi-Fi, SSH on the Network panel): those come from the server mod
  as messages (`DLZMOD_NET_STATE`), so nothing is broadcast or saved in `srv_data.json`.
- Layout: sub-tabs Display / Colors / Time / Network / Remote / Mod (Mackie `ToggleButton`, 149 x 44 every 153 px, mod
  yellow when active, or the owner's colour: `DLZMOD_accent()`, #21), 8 px gap, then that sub-page's
  cards, 388 px high. Unlike Mackie's pages
  (829 x 392) the page fills Settings with 12 px margins: 914 x 440, laid out for the header shown
  (464 px under the tab bar, measured in the sandbox); with it hidden,
  Mackie's centring splits the extra 30 px. Display = Screen (290) + Meters (612); Network = Wi-Fi +
  SSH cards (451 each) inside `page.network`, a paint-less container so `page.network.update()`
  still repaints both; Colors = one card (theme, background and colour swatches; a tap applies at once); Remote Control = one card (switch, warning, address, PIN, Forget, #45); Mod =
  one card (version, update hint or refusal in red, credits). A new
  setting goes on the sub-page it belongs to; a new topic gets a sub-tab, not a squeezed row.
- Segmented controls (`SwitchBox`) and buttons on these pages are sized for fingers: 46-56 px high.
- Header specifics: `app.setPage` shows the header on every page switch (patched to ask
  `DLZMOD_headerHidden()`); hidden widgets count as 0 px in anchors, so everything moves up.
  Hiding it also hides the red pad indicators and "DEMO MODE"; toasts (`showToast` draws in the
  header) then show in the mod's message bar (#58, below). The right knob panel gets 30 px of empty
  space at the bottom.
- Drawing over everything without moving it: the foreground layer, as Mackie's popups do. A widget
  with `setOverlay(true)` draws on the overlay canvas, so pages that draw all the time (meters) do
  not paint over it [sandbox], and joins the UI's modal list (`app.mWidgets`) [static]. Modal
  widgets close easily: `app.setPage` and Escape run `closeModals` first, and a tap that none of them
  takes closes every one with `autoCloseModal` (the default) [static]. `closeModals` destroys while
  it iterates the list, so a modal widget after a destroyed one is skipped [static]. For something
  that must outlive a page switch, `setOverlay(true, true)`: the overlay canvas, not the modal
  list [static, sandbox]; with `ignoreEvents` it takes no taps, the widget below gets them. Closing
  either kind leaves it drawn on the device until what is below draws again, and clears the whole
  foreground layer there ("PC sandbox", below: a closed popup): draw both again. Used by the message
  bar (`DLZMOD_messageBar`).

## Where to hook in (least to most invasive)

| Goal | Hook | Survives a Mackie package update? | Notes |
|---|---|---|---|
| Control/automate the mixer, bridge to other gear (MIDI, OSC, HTTP API ...) | **Own daemon as a client on TCP :89** (newline JSON) | Yes | Sees every state change, can set any key / call any command. Best first mod |
| Same, from a laptop | socket.io on `:80` from the LAN | Yes | No install on the device at all |
| Change presets/defaults | JSON in `/srv/presets_factory/<type>/`, `/srv/presets/` | Factory dir: no; user dir: yes | Plain flat JSON |
| Change UI behaviour/look | Patch `/srv/app.js` by string anchor | No (evolve-node) | `systemctl restart evolve-app` to reload |
| Change hub logic (new commands, auth) | Patch `/srv/server.js` | No (evolve-node) | Restart evolve-node; offsets change per build |
| Codec/I2C tweaks after init | `/root/post-i2c.js` (QuickJS, `sys.writeI2C`) | Yes (not a package file) | API known (see components/dspserver.md); [guess] that it runs, verify live |
| Audio routing/processing | `/usr/local/share/evolve-a1/mixergraph-dlzlite.js` | No (dspserver) | See [components/mixergraph.md](components/mixergraph.md); restart `dspserver` |
| Boot visuals | `bootsplash.armbian`, `/etc/dlz.png` | No (glesgui) | Generated by `build-sd.sh`, see "Version and boot visuals" |
| Own renderer/overlay | `/tmp/glesgui` FIFO + WS :8011 | Yes | Advanced; app.js owns the FIFO normally |

Prefer **add-ons next to Mackie's files** (own systemd unit, own files under e.g. `/opt/dlzmod/`)
over editing Mackie files. They survive package updates, and they are ours to publish.

## Not possible

Looked into and not doable on this hardware or within the ground rules:

- **More computer channels** (each app on its own strip): the XS reads only 2 stereo USB pairs from
  the computer, and both are already selectable on the virtual strips; per-app routing is done on
  the computer (Q22 would show whether there are more playback channels).
- **Bluetooth headphones or speakers as a monitor, a Bluetooth headset as input/output**: the
  Bluetooth module (an Actions ATS2853 speaker chip with Mackie's own firmware) is a phone-side
  sink with its own protocol and no connect-out command in faderlink, not a Linux Bluetooth stack;
  a USB dongle with BlueZ would have no audio path (no ALSA), and Bluetooth latency is too high for
  live monitoring (Q25).
- **The card as a USB drive on the computer**: the USB port to the computer is not Linux's (no OTG in
  the device tree, [hardware.md](hardware.md)); file access has to go over the network.
- **A faster SD slot** (UHS): needs a switchable 1.8 V supply, which means changing the PMIC setup.
- **Updating a mod card from the installer image**: writing the image erases the card first
  ([updates.md](updates.md)).
- **A restore tool that writes a dump back to the eMMC**: against the first ground rule (the eMMC is
  never written). Recovery is pulling the card: stock boots.

## Recipe for a mod

1. **Pick the hook** from the table above; check the component page under `components/`.
2. **Prototype from a PC** where possible: a port-89/socket.io client on the laptop needs no
   reflash at all. For UI (`app.js`) and hub (`server.js`) changes, use the PC sandbox below.
3. **Prototype on the device** over SSH (turned on from the Mod page), editing the card's copy live.
4. **Fold it into `install/`** (app patches in `patch.py` / `app-mod/`, server code in `server-mod/`,
   units and rules in `sd-system/`), so a clean dump plus `card-core.sh` (used by `build-sd.sh`, the
   installer and the update package) reproduces it. Keep originals as `*.orig`.
5. **Rebuild, flash, test**, then document the mod: what it changes, which files, the
   confidence of each assumption.

## Dev loop

```bash
# WSL (Ubuntu) as root
B=/mnt/c/path/to/DLZ-Creator-Modded              # this repo, as seen from WSL
bash $B/install/mount-ro.sh                       # dump rootfs read-only at /mnt/dlz
bash $B/install/build-sd.sh /root/dlz/orig.img $B/build/dlz-sd-$(cat $B/VERSION).img
# flash build/dlz-sd-vX.Y.Z.img with balenaEtcher, cancel the Windows format prompt
```

Name images after the version (`build/dlz-sd-v0.1.0.img`), never a generic `sd.img`: balenaEtcher
remembers the last file, so an unversioned name makes it easy to flash an old build. Check
the version on the Mod page before testing. An older version is rebuilt from a
detached worktree of its commit (`git worktree add --detach build/wt-vX.Y.Z <commit>`) with that
worktree's own `install/build-sd.sh`.

**Pick the shortest loop that really tests the change**: a mod change that only
touches what the drop-in update applies (app and server patches, sd-system units and rules) goes
onto an existing mod card through `DLZDATA/dlzmod-update/` (a few minutes: card into the PC, copy,
card back, boot) instead of a full install (~10-15 minutes). A full install is still done whenever the
test needs it: changes to the installer, the write path, the boot visuals or anything the update
does not cover, and before a release.

The drop-in: build the package (`install/release/mkpackage.sh` in WSL; from a committed tree it is
signed with the dev key, a tree with changes gives an unsigned `+dirty` package that cards refuse),
copy **both** `build/release/dlzmod-vX.Y.Z-*.tar` and its `.tar.sig` into `DLZDATA/dlzmod-update/`
on the card (Explorer is fine), start the mixer with the card. The files are gone afterwards and
`dlzmod-logs/update-N-<version>.txt` says what happened. A device review is still needed before it goes onto
the card: it changes what runs on the mixer. On a dev card the same drop-in goes over Wi-Fi without
taking the card out: `bash dev/push.sh` builds, checks, copies, waits for the mixer to be switched off and on, and prints the report
(`docs/DEVELOPMENT.md`, "Dev card").

With SSH on, small iterations can be `scp` + `systemctl restart <unit>` instead of a package.

Reading the card's logs without SSH: once a start has finished (~2.5 min after power-on, after its
`dlzmod-bootreport` block), the syslog of the last 4 SD-system starts lands in
`DLZDATA/dlzmod-logs/syslog-last-boots.txt` (the previous copy as `.prev.txt`), readable in any card
reader: `dlzmod-bootlog` (install/sd-system) puts it in `/run`, server.js copies it through its
queue of remounts (`DLZMOD_bootlogCopy`, #136), so nothing mounts DLZDATA a second time and nothing
writes to the FAT while a start can still hang (#81). A start that hangs is in the copy of the next
start that finishes. Its own log reaches the card's syslog (ext4) up to ~15 s before the hang:
`dlzmod-bootreport` writes the syslog through every 10-15 s while it waits. Only boots of the SD
system are copied (sections with `dlzmod-grow-data`, which runs at every boot), not the dump's own
history. Always on. Each start that ran ~2 min or longer holds a `dlzmod-bootreport` block (times,
what the start waited for, services, failed units, warnings and errors): search for
`report of this start` (#136).

A dev card can also send each start's log to the PC as it happens (`dlzmod-netlog`, #136): `bash
dev/netlog.sh on` once, then `powershell -ExecutionPolicy Bypass -File dev/netlog.ps1` writes it to
`build/device-logs/netlog-*.txt`. It covers a start that freezes before its log reaches the card, as
long as Wi-Fi came up (~15-25 s) and the freeze leaves the network running.

Fallback, the whole rootfs: on Linux, mount partition 1 read-only and read `/var/log/syslog`
(`wsl --mount` does not support USB card readers, `0x8007000f`). rsyslog persists across reboots
(the journal is empty); timestamps restart from the fake-hwclock time, so split boots on
`Booting Linux on physical CPU`.

### PC sandbox (no device needed)

`bash dev/ui-sandbox.sh` (Git Bash) runs Mackie's `server.js` with Windows Node on a copy of
`/srv` in `dumps/sandbox/`, and serves the browser UI in XS mode.

- **Device layout by default.** In a browser app.js runs as a remote control
  (`EXTERNAL = !$ENV.isNode`): no knob panel on the right, so tabs and pages get 86 px more width
  and the nav bar shows an empty slot. The shim makes http://127.0.0.1/ always open with `#INT`
  (on-device layout). A design that fits in remote mode can overflow on the device (Settings is
  938 px wide there). On a real mixer, phone/laptop browsers stay in remote mode; check mods there too.
- **Why remote mode has no knob panel** [static, app.js]: the panel (`RightPanel`) is not only a
  display, it assigns the physical knobs. Each page passes its knob list to `SET_KNOBS`, and
  `RightPanel.setData` writes `K.0-3.key/color/blink` (and `setUser`/`resetUser` the user knob `K.4`)
  to the hub, which faderlink uses to drive the knobs and LED rings ([faderlink.md](components/faderlink.md)).
  These are shared hub keys: a panel in a browser would point the mixer's knobs at whatever page the
  browser shows. So `SET_KNOBS`, `setData` and `setUser` all do nothing when `EXTERNAL`, and app.js
  puts a 0-wide `Widget` where `RightPanel` would go (search `debugAlias:"panel"`). `#EXT` / `#INT`
  in the URL override the choice. A browser panel would have to be display-only (read `K.N.key`,
  never write it).
- **Phones: touch misses and the screen does not fit** (#52) [static, reproduced in the sandbox with
  headless Chrome, Android UA, 915x412 touch emulation; Chrome on Android: "touch does nothing"].
  `index.html` centres the canvas with `left/top: 50%` + `transform: translate(-50%,-50%)`.
  `Events.mouse` takes `offsetX/Y` (follows the transform: right), `Events.touch` takes
  `pageX - target.offsetLeft` (`offsetLeft` ignores transforms), so every touch lands exactly half
  a canvas up-left of the finger (tap at UI 512,300 → app.js sees 0,0; 210,474 → -303,174): taps on
  the top or left half hit nothing, others hit the wrong control. Scaling: the upscale branch in
  app.js only runs below 1000x600 *canvas* units, and the canvas is 1024x600, so a phone gets the
  full 1024x600 CSS px box, centred and cut off on all sides (tab bar, names, pads off-screen),
  with zoom blocked (`user-scalable=no`). Reproduced in the sandbox in remote mode (no `#INT`, no
  stretch) with Chrome's DevTools protocol: `Emulation.setTouchEmulationEnabled`, a mobile viewport,
  `Input.dispatchTouchEvent` vs `Input.dispatchMouseEvent` at the same spot, and a wrapper around
  `Events.eventPointerDown` that logs the coordinates app.js receives.
- Fonts match: the browser registers the same three Proxima Nova weights glesgui has
  (300/400/600). Stick to weights 300-600.
- The panel has non-square pixels (7" 1024x600, 0.1506 x 0.1432 mm): the device shows everything
  5.2% wider. The shim stretches the canvas the same way (`scaleX(1.052)`), so the sandbox matches a
  straight-on photo of the device (1.80:1) [device: photo measurement]. Layout stays 1024x600 px.
- Remaining device differences: a few `$ENV.isNode` text offsets/fonts, NanoVG vs browser
  anti-aliasing, and canvas calls glesgui lacks (e.g. `setLineDash`).
- A closed popup stays on the device's screen until the page below it draws again [device: up to
  3 s on the Mod page's Network panel, until its status redraw, #67]. On the device, closing one
  clears the whole foreground layer (`clearFgRect`) and asks for a frame (`needDrawFrame`) [static],
  yet that frame still shows it (why: open-questions.md, 34); pages with meters draw all the time and
  hide it.
  The mod draws the Mod page right after every `PopupWindow` closes (`DLZMOD_hookPopups`) and after
  the keyboard [device: gone at once after the SSH warning, keyboard, spinner and result message].
- Screenshots without touching your own browser:
  `node dev/ui-sandbox/shot.js build/shots/x.png [x,y taps...]` (headless Chrome, `#INT`,
  taps in UI pixels, e.g. `905,60` = Settings gear).

- `dev/ui-sandbox/shim.js` blocks every shell command (server.js would otherwise run
  mkfs/dd/parted/mount/systemctl), only allows the `mv`/`sync` of the state save, and binds 80/89 to
  localhost. Never run server.js outside the shim, and never as root in WSL.
- **A phone on the network, on this PC** (#45): `DLZ_SANDBOX_REMOTE=1 bash dev/ui-sandbox.sh`. Then
  http://localhost/ plays another device (the shim gives that connection the address 192.0.2.10 and
  leaves `index.html` to Mackie's server, so it opens in remote mode), while http://127.0.0.1/ stays
  the mixer's screen. Turn "Control from other devices" on in the screen's Remote tab and pair
  the localhost tab with the PIN; the browser keeps a cookie per host, so the two stay apart. Still
  this PC only. Without clicking: `node dev/ui-sandbox/pair.js` turns it on from the screen's side
  (port 89), pairs with the PIN as localhost and prints the token; `DLZ_SHOT_URL=http://localhost/
  DLZ_SHOT_COOKIE=<token> node dev/ui-sandbox/shot.js ...` then shoots the paired browser UI, and
  `DLZ_SHOT_DOWNLOADS=<folder>` keeps what it downloads.
- **A pretend SD card and/or USB stick**: `DLZ_FAKE_MEDIA=sd` (or `usb`, `sd,usb`) in front of the
  start. The shim reports a FAT partition in `lsblk`, lets server.js "mount" it at
  `/tmp/mnt/mmcblk0p2` / `sda1` (a folder in the sandbox folder, seeded once with a few short silent
  recordings, a `*.unfinished` one and a sub-folder), answers its remounts and `df`, and its look for
  a firmware file (`find ... *.upd`: unguarded in server.js, an error there ends the server).
  `/proc/mounts` lists them read-only for the mod's read-only watcher. Mackie's `wavfinalizer` stays
  blocked. Off by default: other screens expect no media.
- Works: the whole UI, state changes, presets/snapshots, port-89 clients (state persists in the
  sandbox's `srv_data.json`). Not there: dspserver, faderlink, glesgui, so no audio or hardware
  buttons, and no media without `DLZ_FAKE_MEDIA`. Meters show moving fake levels that follow the
  faders and mutes (`dev/ui-sandbox/fake-vu-live.js`, injected by the shim; off with
  `http://127.0.0.1/?novu`): on a fresh copy most channels are muted or their faders down (the dump's
  state), so only a few meters move until they are opened.
- Patch `dumps/sandbox/srv/app.js` and reload the browser; restart the script for `server.js`.
  Reset: delete `dumps/sandbox/` and run the script again (it re-copies `/srv` from the dump). A
  worktree has no `dumps/`: the first start there copies a fresh `/srv` (patch it with `repatch`
  before the first start).
- Observed [static, sandbox]: the hub does not echo a key write back to its sender; writing
  `i.0.mute` produced a broadcast with a different value (mute groups?), not yet understood.

Useful service restarts:

| Restart | Effect |
|---|---|
| `evolve-app` | UI reloads, audio keeps running |
| `evolve-node` | Hub restarts; app.js, dspserver and faderlink reconnect [guess] |
| `dspserver` | Audio drops briefly |
| `faderlink` | Also restarts dspserver (`Requires=`) |

## Things that will bite you

- **A widget that hides itself in `getState` never comes back.** Mackie's `internalUpdate` runs
  `getState` only while the widget is visible, so `this.visible = ...` there works for the state the
  page was built in and not after a change (the "Show PIN" button stayed away after Remote Control was
  switched on) [device]. Toggle `enabled` in `getState`, or call `setVisible` from code that runs
  anyway (the panel's paint, a `Data.regWidget` callback). The sandbox only shows it when the test
  starts in the other state.
- **The mixer is switched off by cutting the power**, and the card's root is ext4 in writeback mode
  with `commit=10`: anything mod code writes is lost (or left empty after a rename) when the mixer is
  switched off within seconds. Flush every state file the moment it matters: write a temp file,
  fsync it, rename, fsync the folder (`DLZMOD_updateNoteSeen`; shell: `sync <file>` before `mv`,
  then `sync`) [device: the update popup came back after OK + reboot].
- **WSL unmounts `/mnt/dlz` when the distro idles out.** Keep a process running
  (`wsl -d Ubuntu -u root -e sleep 7000`) or remount with `install/mount-ro.sh`.
- **WSL's mounts are shared**: a chroot's `mount --rbind /dev` undone with `umount -R` also unmounts
  WSL's own `/dev/pts`, and every later `wsl` call then prints nothing (fix: `wsl --shutdown`). Test
  harnesses that mount anything run under `unshare -m --propagation private` (tests/rehearse-install.sh,
  tests/update.sh).
- From Git Bash, prefix WSL calls with `MSYS_NO_PATHCONV=1` or `/mnt/...` paths get mangled;
  always pass `-d Ubuntu` (Docker Desktop's `docker-desktop` distro can be the default).
- server.js saves state every 3 s: stop `evolve-node` before editing `srv_data.json`.
- **bash ignores `set -e` in anything whose status is tested**: `if ( set -e; a; b )`, `f && g`,
  `f || x` with `f` a function or subshell. A failing `a` does not stop it; `b` runs and decides the
  status. Run such a block as a plain command and test `$?` after it (sd-system/dlzmod-update).
- In `sh`, every variable a function sets is global (busybox ash has `local`, but our scripts use
  `_name`): a helper that sets `_n` overwrites the caller's `_n`.
- `od` prints a repeated line as `*`: use `od -v` when comparing its output.
- bash's `<(...)` needs `/dev/fd`; where it is missing the command reads nothing and often still
  "succeeds" (the installer's bare devtmpfs, a chroot without /dev). Never build a safety
  check on it, and make checks fail closed: count what was compared, refuse when the count is off
  (sd-system/dlzmod-update's guard comparison).
- The bundles are minified: anchor patches on strings (state keys, command names), never on offsets.
- A Mackie `Widget` without its own `paint` draws a random debug colour: give touch areas and
  containers `paint: function () {}`.
- A hidden widget's children still take touches: anything drawn over other widgets must be a
  `PopupWindow` (modal: the page behind takes no touches; a tap outside closes it, as stock).
  Close such a popup before `askInput`, or it stays over Mackie's keyboard page.
- `askInput`'s callback runs before the keyboard page closes (`accept`: `onValue`, then `close` →
  `pageBack`): a popup opened in it goes with the page. Open it in a `setTimeout` [device:
  the SSH spinner never showed].
- `Switcher.onup` picks `onToggleON/OFF` from `value` after `setVal`: a switch without a hub key
  needs a `setVal` that sets `value` (the SSH switch shows the server's state through `getState`).
