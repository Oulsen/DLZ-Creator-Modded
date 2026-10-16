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
| `dlzmod-bootlog` + `.service` | Copies the syslog of the last 3 SD-system boots to `DLZDATA/dlzmod-logs/` before the mixer software starts (~2.2 s), readable in any card reader ([modding-guide.md](modding-guide.md), "Dev loop") |
| `dlzmod-wait-hub` (from the `dspserver` drop-in) | dspserver waits until server.js listens on port 80 (at most 45 s). dspserver connects once and never retries: if it is first, the mixer has no audio and ignores REC until a restart. Stock gets the order by luck of timing; a slow first boot flips it [device] |
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
  - loading samples from a path and formatting the USB stick: only from the screen
    (`DLZMOD_SCREEN_ONLY`)
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

Sub-tabs Display / Network / Remote Control / Mod; layout and how to add a setting:
[modding-guide.md](modding-guide.md), "Mod settings". Every default on these tabs equals stock.

- **Hide header** (#31): more room; also hides the toasts, the red pad indicators and "DEMO MODE".
- **Meters** (#38), key `dlzmod.meterMode`: 0 Mackie (default), 1 Both, 2 Before fader. In Both,
  a dim second bar shows the level after the gain, before the fader (`.gain`), using the second bar
  `VUMeter` has but stock never turns on, and the clip light follows it; `dlzmod.preColor` (green /
  grey) and `dlzmod.preLevel` (strong / soft) set its look. `dlzmod.meterMarks`: yellow and red zones
  at the stops of `Color.vuGrad`, dB notches on every strip meter and numbers beside LR (painted by
  wrapping the LR fader's `paint`); off = Mackie's plain meters. The scale is dB-linear over 80 dB with
  0 dBFS at the top [device: test tones at -6 and -30 dBFS].
- **Network** (#12, #44): Wi-Fi and SSH, below.
- **Remote Control** (#45, #48): control from phones, tablets and computers, off by default; below.
- **Mod**: version, update status, credits.

## Network panel: Wi-Fi and SSH

- One command `DLZMOD_NET {op}` (`status`, `scan`, `connect`, `forget`, `ssh`, `sshKeep`); answers go
  to that screen only. One change at a time.
- **Changes only from the mixer itself**, also for paired devices (#45): a phone must not set the
  root password or pair more devices. server.js's socket.io and TCP
  connections stamp their send function with `dlzmodLocal` (peer 127.0.0.1 or ::1); the screen
  (app.js in jsdom) connects to 127.0.0.1. Other devices get an empty status (no network name,
  address or SSH state; the Mod page there says "on the mixer's own screen") and nothing is run
  for them.
- Children run at normal priority (`chrt -o 0 nice -n 20`): evolve-node runs SCHED_FIFO 20 and they
  would inherit it.
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
keeps the mixer itself as stock and lets other devices in only when asked [static; tried in the PC
sandbox, not yet on the mixer]:

- **Who is the mixer itself**: connections from 127.0.0.1 / ::1 (the screen on port 89; dspserver and
  faderlink over socket.io on port 80). Nothing changes for them.
- **Off by default** (a fresh card has no state file): another device gets a page saying where to turn
  it on, socket.io refuses its handshake (`allowRequest`).
- **On** (Settings → DLZ Creator Modded → Remote Control, asks first; only from the screen): the panel
  shows the address(es) to open and a 6-digit PIN, hidden as dots until "Show PIN" (30 s; the screen
  is often on camera). A browser without a pairing gets the mod's PIN page;
  the right PIN sets a random 32-byte token as cookie `dlzmod_pair` (`HttpOnly`, `SameSite=Strict`,
  400 days). A random PIN pairs one device: a new PIN shows after each pairing. Or the owner's own
  PIN ("Own PIN...", 6 digits; one digit six times and straight runs like 123456 or 987654 are
  refused): it stays, for pairing several devices without the screen, until "Random PIN", a new own
  PIN or switching off. Wrong PINs, counted for all devices together: after 5 a pause of 60 s,
  doubling up to 15 min, on the panel too.
- **Paired**: the browser loads only the UI's own files (`/`, `index.html`, `app.js`, `style.css`,
  `favicon.ico`, `libs/`, `fonts/`, `img1x/`), not `srv_data.json`, the presets or anything else in
  `/srv`. Before pairing only the PIN page's own files: the model's logo (`img1x/DLZ_XS.png` /
  `DLZ_Creator.png`) and Proxima Nova Regular and Semibold (`DLZMOD_loginFileOk`); the page is in
  Mackie's look with the mod's yellow marker at the bottom; socket.io takes it with the cookie and, from a browser, only with the mixer's own page as
  `Origin` (a web page elsewhere cannot drive the mixer). The connection is checked once more when it
  opens and stamped `dlzmodPaired`: deleting and renaming come back (#48), the Network panel's changes
  do not.
- **Off and "Forget all devices"** forget every pairing and drop paired connections at once. Off also
  drops an own PIN (on again starts random); Forget makes a random PIN new and keeps an own one (the
  popup says to change it if others know it).
- **On the card**: `/var/lib/dlzmod-remote/state.json` (folder 700, file 600, durable write): on, the
  PIN, whether it is the owner's own, and the sha256 of each token (at most 16). An update keeps it. The PIN goes only to the screen
  (the Network status), never into a hub key or a log line.
- **Port 89** listens on 127.0.0.1 and ::1 only (`DLZMOD_listen89`): its only client is the screen.
  That also ends the unbounded line buffer there as a network problem.
- **Accepted**: plain HTTP, so a token can be sniffed on the same network (the panel says "only on a
  network you trust"); a paired device gets the whole live state over socket.io, as stock's browser UI
  needs it (the System Lock PIN included); stock's preset and snapshot commands have no size or count
  limit, also for paired devices; someone on the network can keep the pairing paused with wrong PINs
  (15 min at most per round).

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
