# Architecture

How the DLZ Creator XS software fits together. Firmware v1.2.0 build 1731, from the eMMC dump.

Confidence tags used in all notes:
**[device]** verified on the running mixer · **[static]** verified in the dump (file, strings, code)
· **[guess]** inferred, not yet verified.

## The big picture

Linux is the conductor, not the orchestra: there is **no ALSA sound card** [static: dmesg
"No soundcards found", codec/I2S/SPI disabled in the DTB]. Audio runs through the GOWIN FPGA and
codecs; `dspserver` drives it directly via `/dev/mem` DMA. USB audio to the PC is not Linux either
(no OTG node in the DTB) [guess: FPGA or a separate bridge chip].

`server.js` (Node, service `evolve-node`) is the hub. Everything else is a client of it.

```
                         LAN (all interfaces, no auth!)
                          |  :80 HTTP + socket.io     |  :89 newline-JSON
                          v                           v
 +-----------+   :89    +-----------------------------------+   exec: systemctl, lsblk,
 |  app.js   |--------->|         server.js  (hub)          |   mount, mkfs, ip addr ...
 | (jsdom UI)|<---------|  state: /srv/srv_data.json        |
 +-----------+          +-----------------------------------+
   |      ^                   ^ socket.io EIO3       ^ socket.io EIO3       | files in /tmp
   | FIFO | WS :8011          | ws://localhost:80    | ws://localhost:80    v
   | draw | DOWN/MOVE/UP      |                      |               upgraderun.service
   v      |                +-----------+        +-----------+          -> upgradedaemon -f
 +-----------+             | dspserver |        | faderlink |
 |  glesgui  |             |  QuickJS  |        +-----------+
 | (NanoVG)  |             +-----------+          |ttyS2   |ttyS1
 +-----------+               | /dev/mem DMA       v        v
   ^ Wayland/XWayland        | I2C via JS       GD32 MCU  Bluetooth
 Weston (tty7, DRM, rot 180) v                  (faders,  module
   ^ libinput touch       FPGA / codecs          buttons,
 LVDS 1024x600 + GT911                           LEDs)
```

## Processes

| Service | Binary | Role | Start order |
|---|---|---|---|
| `flash-gd32` | `flash-gd32.sh` (openocd, SWD) | Flash GD32 MCU, only if the marker is missing | 1 |
| `flash-fpga` | `flash-fpga.sh` (gwprog, JTAG) | Load the GOWIN bitstream, every boot | 2 |
| `faderlink` | `/usr/local/bin/faderlink` | Control surface (GD32 UART) + Bluetooth module + backlight + hostname | 3 |
| `dspserver` | `/usr/local/bin/dspserver` | Audio engine, mixer graph in QuickJS, recording, NDI | 4 (`Requires=faderlink`) |
| `weston-mackie` | `weston` | Compositor on tty7 | parallel |
| `glesgui` | `/usr/local/bin/glesgui` | Dumb Canvas2D renderer (`Requires=weston-mackie`) | after weston |
| `evolve-node` | `node /srv/server.js` | Hub: state, presets, media, updates, web UI | multi-user |
| `evolve-app` | `node /srv/app.js` | The actual UI, running headless in jsdom | multi-user |
| `upgradedaemon` | Nim/Prologue web server | Firmware upgrade page, `POST /upgrade` (port unknown) | parallel |
| `upgraderun` | oneshot, not enabled | Started by server.js to install an update | on demand |

All Mackie units run as root with `DefaultDependencies=no`, FIFO priority 20 and nice -20 [static].
The six runtime units (faderlink, dspserver, weston-mackie, glesgui, evolve-node, evolve-app) have
`Restart=always` with no `RestartSec`, start limit or `WatchdogSec`, so systemd's defaults apply:
restart after 100 ms, give up after 5 starts in 10 s [static]. A process that crash-loops stays
dead until reboot; a process that hangs without exiting is never restarted.
No hardware watchdog either, see [system.md](system.md#kernel-and-boot-config).
Kernel cmdline isolates CPU 3 (`isolcpus=3 nohz_full=3 rcu_nocbs=3`), presumably for the DSP [static].

## IPC edge list

| From → To | Channel | Format | Conf. |
|---|---|---|---|
| app.js → glesgui | FIFO `/tmp/glesgui` (created by glesgui) | One JSON array of `{obj,call,args}` per frame + a `drawFrame` line | [static] |
| glesgui → app.js | WebSocket `ws://127.0.0.1:8011/` (glesgui is the server) | Text `DOWN_x_y` / `MOVE_x_y` / `UP_x_y` | [static] |
| app.js ↔ server.js | TCP `localhost:89` (port only, no host: Node 18 tries `::1` first when the mixer has an IPv6 address, so the listener must accept both families) | Newline-delimited JSON | [static] (reproduced under qemu) |
| browser ↔ server.js | socket.io on `:80`, event `"message"` | Same JSON messages | [static] |
| dspserver ↔ server.js | socket.io EIO3 client to `ws://localhost:80` (libhv) | Same JSON, sends `INIT` | [static] |
| faderlink ↔ server.js | socket.io EIO3 client to `ws://localhost:80` (libhv) | Same JSON | [static] |
| faderlink → GD32 | UART `/dev/ttyS2` (uart5, `GD32_TTY` env) | Unknown binary protocol | [static] / [guess] |
| faderlink → BT module | UART `/dev/ttyS1` (uart3) | Unknown | [static] |
| dspserver → audio HW | `/dev/mem` DMA; codecs over I2C from JS | — | [static] |
| server.js → updater | `/tmp/upgradefile.txt` + `systemctl start upgraderun` | File path | [static] |
| glesgui → dspserver | `killall -STOP/-CONT` during touch calibration | Signals | [static] |

## The message protocol (shared by all hub clients)

Every message is JSON, either:

- **State write**: `{"<key>": value, ...}`, e.g. `{"i.0.mute": 1}`. The hub stores it and broadcasts
  `{key: value}` to *every* socket.io and port-89 client (`globalThis.setDataKey`). Port 89 output
  is batched every 10 ms.
- **Command**: `{"cmd": "...", "id": ..., "args": ...}`, dispatched from a table of 60 handlers.

Commands [static]: `INIT BMSG VU GUI_LOADED HWREC PADPRSD ALT LIST SUBSCRIBE TEST RESET`,
`MEDIA_{DIR,DELETE,RENAME,PLAY,PAUSE,STOP,SEEK,SWITCH_TRACK,NEXT,PREV}`,
`REC_{START,PAUSE,CONT,STOP}`, `PRESET_{WRITE,READ,LIST,DELETE,RENAME}`,
`SNAP_{LIST,SAVE,LOAD,DEFAULT_LOAD,DELETE,RENAME}`, `FORMAT_SD FORMAT_USB`,
`BT_PAIR BT_PAIR_DISCONNECT BT_PAIR_CANCEL`, `SAMPLE_{CLEAR,LOAD,PREVIEW_START,PREVIEW_STOP,REC,REC_STOP,REC_STORE,REC_RESET}`,
`PAD_CLEAR STOP_ACTIVE_PADS`, `FIRMWARE_UPDATE` (+ `_SUCCESS_OK _FILE_CORRUPTED_OK _FAILED_OK _CANCELLED`),
`FACTORY_RESET RESTART_GUI NDI_LIST_NETWORK_DEVICE NDI_SAVE AUTO_GAIN_STOP`.

Server-pushed: `INIT FIRMWARE_FOUND FIRMWARE_UPDATE_SUCCESS FIRMWARE_FILE_CORRUPTED
FIRMWARE_UPDATE_FAILED AUTO_GAIN_DONE UPDATE_DIRS`.

Which keys/commands dspserver and faderlink send is not yet known: capture it live with a
port-89 client (see [open-questions.md](open-questions.md)).

## Data model

One flat key/value dictionary with dotted keys (~3650 keys) [static]. Prefixes:

| Prefix | Meaning | Prefix | Meaning |
|---|---|---|---|
| `i.N` | Input channel | `B.bank.pad.*` | Sample pads (8 banks × 6 pads) |
| `p.N` | Player channel | `K.N` | Key LEDs |
| `v.N` | Virtual channel | `pad.*`, `sample.*`, `player.*` | Pad/sampler/player state |
| `s` | Samples bus | `ctrl.*` | Control surface |
| `m` | Master | `fx.*` | FX engines (reverb, delay, telephone, voice) |
| `a.N` | Headphone mix 1/2 | `settings.*` | Device settings |
| `f.N` | FX return (0 delay, 1 reverb) | scalars | `version bank snapshot lock usb* sd* bt* rec* ip` |

Which keys drive the audio, per strip: [components/mixergraph.md](components/mixergraph.md).

Per-channel keys: `mix pan mute solo gain phantom eq.b1-3.* eq.hp.* gate.* comp.* ds.* aux.N.* fx.N.value`.

Channel counts (`chConfig` in `data.js`), selected by `/root/.dlzlite`:

| | hwinput | input | player | virtual | aux | fx | sample | sampleBank |
|---|---|---|---|---|---|---|---|---|
| DLZ Creator | 4 | 4 | 3 | 0 | 4 | 2 | 6 | 8 |
| **XS (LITE)** | 2 | 2 | 2 | 2 | 2 | 2 | 6 | 8 |

Mute-group order on XS: `i.0 i.1 p.0 p.1 s v.0 v.1 m`.

## One firmware, two products

`/root/.dlzlite` (empty file) switches everything to XS mode: server.js, app.js, dspserver
(`mixergraph-dlzlite.js`), faderlink (hostname `mackie-dlz-creator-xs`), flash-gd32
(`firmware-dlzlite-154.bin`) and flash-fpga (`dlzlite-gowin.binx`) [static].
**Do not remove it**: the GD32 and FPGA would get the full-size DLZ firmware.

Who sets it: nothing in the image. Only readers mention it (server.js and app.js via `existsSync`,
`dspserver`, `faderlink`, `flash-gd32.sh`, `flash-fpga.sh`); no package script, unit or the 1.2
update's installer in `/var/updtmp` creates it (the updater only writes `/root/.upgrade*` markers).
Its ext4 crtime is 2023-11-16 18:58:04, two minutes after the packages were installed (evolve-node's
dpkg list 18:56:10) and next to the other one-time markers in `/root` (`.gd32-loaded-*`,
`.sethostname`, `.use-gowin-fpga`): the factory flashes one image for both models and marks a unit
as XS afterwards, with a step that is not on the device [static: debugfs stat on the dump].
The software cannot tell the models apart by itself. A photo of a full-size DLZ Creator's About
page shows build 1731, the same build as the XS. Mackie's support
page and the DLZ Creator product page list "build 1731 or 1794" as up to date without naming models;
what 1794 is (a later factory build?) is unknown.
