# faderlink, GD32 MCU and GOWIN FPGA (control surface)

Owned by package `faderlink` 521 (binary, flash scripts, firmware, bitstreams). All [static] unless tagged.

## faderlink (`/usr/local/bin/faderlink`, 856 KB)

- C++, libhv + nlohmann::json; log tags `<< FADER`, `<< WS`
- **GD32** over UART `$GD32_TTY` (unit sets `/dev/ttyS2` = uart5), 115200 baud, one JSON line per event (see Knobs)
- **Bluetooth module** over `/dev/ttyS1` (uart3)
- Opens `/dev/mem` ("Unable to map memory") in a static initialiser, before `main`: 8 MB of peripheral
  registers from `0x01c00000`, probably GPIO/PWM [guess for the use, static for the mapping]
- Backlight: writes `/sys/devices/platform/backlight/backlight/backlight/brightness`
- Hub: socket.io EIO3 client to `ws://localhost:80`. Handles keys like `settings.brightness.*`,
  `B.%d.%d.colorhex`, `B.%d.%d.blink`, `B.x.y.fx.del.feedback`
- First boot: sets hostname `mackie-dlz-creator(-xs)` (sed on `/etc/hosts` + `hostnamectl`,
  marker `/root/.sethostname`), Bluetooth name (marker `/root/.bt-name-set-v2`)
- Markers read: `/root/.dlzlite`, `/tmp/.bt-was-disabled-startup`

### Keys it uses

- **Faders** (the XS's five channel knobs, the full-size's nine faders: [../hardware.md](../hardware.md),
  "Hardware"): the GD32 sends `{"slider.N":position}`, position 0-1. The fader handler (`0x602d0`,
  anchor `"slider."`) takes N (clamped 0-8) and a key from one of two fixed tables, picked by model
  (the flag set at "DLZ Lite detected") [static]:
  - full-size, 9 entries: `i.0.mix i.1.mix i.2.mix i.3.mix p.0.mix p.1.mix p.2.mix s.mix m.mix`
  - XS, 5 entries: `i.0.mix i.1.mix p.0.mix p.1.mix s.mix`; slots 5-8 empty. Knobs 1-5 move Mic 1,
    Mic 2, 3/4, 5/6 and Samples on the screen, in that order [device]
  - So the XS has no hardware control for the master (`m.mix`) and neither model one for the virtual
    strips (`v.N.mix`)
  - The position goes through the key's entry in the knob table (below) to dB, at or below -96 dB
    becomes -200, above 9.995 becomes 10, and goes to the hub as `{"key":%.10f}`. Every move sends
    the absolute position, so a level set on the screen jumps to the control's position at its next
    move (stock) [static]
  - **Nothing is read back** [static]: faderlink stores the move in its own copy of the state with the
    flag that skips the GD32 forward (`0x5a1b4`, second argument 1). A `*.mix` from the hub does pass
    the forward filter below and goes to the GD32 as `{"i.0.mix":value}`, but neither GD32 firmware
    (`firmware-dlzlite-154.bin`, `firmware-evolve-154.bin`) has a `.mix` pattern, only
    `*.blink *.colorhex *.lock *.mute *.solo`: no pickup, no motor
  - The hub gets fader moves over faderlink's socket.io connection (`ws://localhost:80`, libhv's
    WebSocket client, which sends libhv's fixed Chrome 63 `User-Agent`). The only socket.io clients
    from localhost are faderlink and dspserver; the screen (app.js) talks over TCP :89 [device: `ss
    -tnp`]. So a `*.mix` on a local socket.io connection is a fader or channel knob, one over :89 the
    screen (#23)
- **Mute and solo buttons**: the GD32 sends `{"<channel>.mute":v}` / `{"<channel>.solo":v}` for the
  button's own channel, and faderlink passes the line on to the hub unchanged [static: both GD32
  firmwares build these strings]. `v` is the new state, the opposite of what the GD32 last got for
  that key from the hub (its LED): a mute pressed twice sent 0 then 1 on a muted channel, a solo 1 then
  0 [device, XS, read on a paired device's broadcast]
  - XS: knobs 1-4 have mute and solo (`i.0 i.1 p.0 p.1`), knob 5 only solo (`s.solo`) [device]
  - `la()` in `server.js` flips `i.N.mute` / `p.N.mute` whatever the value (a pad can hold a mute
    too: its own count per channel, list `i.0 i.1 p.0 p.1 s v.0 v.1 m` on the XS, `i.0-3 p.0-2 s m`
    on the full-size); `s.mute` and `m.solo` are refused ("not supported", yet the message is still
    passed on to every client); other solos and mutes are stored as sent [static]. The mod keeps
    `s.mute` (the pads' mute, #276), so only `m.solo` stays refused
  - The LEDs show the hub key of the button's own channel (`*.mute`, `*.solo`, `*.colorhex` pass the
    forward filter below) [static]
  - Telling faderlink from dspserver: both connect to `ws://localhost:80/socket.io/` with the same
    `User-Agent` and both send `INIT`; only faderlink sends `{"btStatus":%d, "bt":%d}`, when the hub
    gives it `settings.bt.enabled` (in the state right after it connects) [static: `0x395b0`;
    dspserver has no such string]. The mod (#23) takes the local socket.io connection that sends it
    as faderlink's and sends LED keys to that one only: to dspserver a mute is the channel's sound
- **Knobs**: app.js's knob panel writes `K.N.key` (the hub key knob N drives), `K.N.color` (LED ring
  colour) and `K.N.blink` for N = 0-3, plus `K.4`. The panel only sends the key name; faderlink does
  the rest [static, read with REA/Ghidra, #201]:
  - The GD32 reader (`0x60fa0`, anchor `"FADER >> %s"`, `$GD32_TTY` at 115200 baud) gets one JSON
    line per event. `{"slider.…` goes to the fader handler (`0x602d0`), `{"enc.N":delta}` to the knob
    handler (`0x5f0b8`, anchor "keyDataTransform not found: %s"). Neither is passed on to the hub;
    every other line except the GD32's `INIT` is. So the hub never sees a raw knob turn, only the key it changes.
  - The knob handler takes N (clamped 0-4), reads `K.N.key` from its own copy of the hub state, and
    skips an empty name or one starting with `enc.`. A name starting with `-` turns the direction
    round (the `-` is stripped). Quotes around the name are stripped too.
  - It looks the name up in a fixed table of 1,278 keys (`0x62440`, hash map built on first use over
    the 64-byte entries at `0xf0e50`-`0x104dd0`, filled by the static initialiser `0x14878`). An entry
    holds the name, min, max, a kind and two conversions (to 0-1 and back). A name not in the table
    is logged as "keyDataTransform not found" and the turn is dropped [device: `dlzmod.lim.*`];
    `eqBand` is the one name allowed without an entry.
  - The key also needs a current value in faderlink's copy of the state, or the turn is dropped.
    faderlink stores every number or string key the hub sends (`0x5a1b4`), with no filter, and a key
    of the hub's default state has its value from the start [device: `a.0.pan`].
  - New value: a stepped entry (kind 2, only `i.0-3.gain`) adds `delta × 0.5` to the value, keeping
    the fraction per knob, clamped to the entry's min and max; a continuous entry converts the value
    to 0-1 with the entry's own functions, adds `delta × 0.0125` and converts back; `eqBand` adds
    `delta × 0.1833`, clamped to 0.1333-0.8667. It writes the value into its state and sends
    `{"key":%f}` to the hub.
  - One click is not one step: 4 clicks clockwise moved a 0-1 key by 0.125, 10 steps of 0.0125
    [device, one try on the XS; whether the knob speeds up when turned fast is not known]. So count
    in steps of 0.0125, never in changes.
  - **So a knob can only drive a key in that table** (Q29) [device]. The "not found" lines come late
    and in a batch, in syslog more than in the journal (faderlink's `printf` to a socket is
    buffered): their absence right after a turn says nothing. A turn that reached the hub shows in
    `/srv/srv_data.json` being saved within 3 s.
  - Reading the table: its values are computed at start-up, so it is dumped from a running copy, not
    read from the file. A scratch copy with `main` replaced by a write of `0xf0e50`-`0x104dd0` and
    every other `.init_array` entry a plain return, under qemu on the PC, unprivileged: the `/dev/mem`
    initialiser must not run, least of all as root.
- **Knob stand-ins** (#238, for the mod's own settings) [static unless tagged]: the page points a knob
  at a listed key that does nothing; the server mod turns its changes into steps on the mod's key.
  Four keys, one per knob: `a.0.pan`, `a.1.pan`, `f.0.pan`, `f.1.pan`.
  - They are in the table (continuous, 0-1, default 0.5), neither audio graph binds them (every
    `@key` of both graphs against the table), both models have them (XS 2 auxes and 2 FX, full-size 4
    and 2), no forward filter below matches them, and `la()` in `server.js` gives them no special
    handling. On the XS `a.0.pan` moved from the knob and reached the hub, and `a.1.pan`, `f.0.pan` and `f.1.pan` drive band 4 (#25) [device].
  - Not `i.2.*`/`i.3.*`: real channels on the full-size, whose graph binds their mix, pan and gain.
    Not `a.2.pan`/`a.3.pan`: not on the XS. Not `eqBand`: one key, in use by the EQ page. Keys with
    min = max (`eq.hp.gain`, `eq.hp.q`, `eq.b*.slope`) cannot move.
  - In the mod (#25, band 4 on the EQ page): a panel entry with `stepKey` goes through `DLZMOD_knobs` for
    `SET_KNOBS`, which puts its knob on the stand-in of its place in the list. `DLZMOD_knobCatch` (from
    `la()`'s key loop) drops the change, so it reaches neither the hub's state, the broadcast nor the
    3-second save, and sends the screen `DLZMOD_KNOB` with the steps; `DLZMOD_knobStep` applies them
    to the setting in its 0-1 form, where the laws are. Only from the mixer itself, only while
    `K.N.key` is the stand-in. faderlink's copy goes back to 0.5 when a page takes the knob and past
    a quarter from the middle, not after every change: that would count a fast turn twice. A change
    sent before a reset counts from whichever place it is nearer; a jump of more than 24 steps
    (a faderlink restart) moves nothing.
- **GD32 forward filter** (`0x596e8`): what the hub sends goes on to the GD32 only for keys matching
  `(i|p|a).#.(lock|mix|solo|mute|blink|colorhex)`, `(s|m).(mix|solo|mute|blink|colorhex)`,
  `settings.brightness.*`, `hw_rec`, `hw_amix`, `amix`, `lock`, `(K|P).#.(blink|color)`;
  `B.*.*.(colorhex|blink)` has its own branch. `K.N.key` and pan keys are not among them.
- **Brightness**: `settings.brightness.screen` (PWM backlight; app.js default 1), `.dim` (0.25),
  `.lit` (0.8), `.k`, `.pad`, `.button` [static]. Whether 0 means fully dark is untested.
- **Pad LEDs**: `B.%d.%d.colorhex` / `.blink` → `P.%d.color` / `P.%d.blink` to the GD32.
- `ctrl.fade.in/out`, per-pad `B.x.y.ctrl.fade.*`, `B.temp.N.fx.{del,rev}.mix`, `lock`, `K.*`.

### Bluetooth module (ttyS1)

- Not HCI: faderlink speaks the module's own message protocol (Linux has no BlueZ, only
  `libbluetooth3`) [static]. Framed binary messages (logged as `%02X` hex, "Partial or malformed
  message from BT UART"); no AT commands, no scan/inquiry/connect-to strings [static].
- Chip: **Actions ATS2853** (QFN48, Actions logo) on a small module soldered to the CPU board, next
  to a header labelled `BT USB` (probably the module's own firmware port) [static: FCC internal
  photos of the XS, FCC ID `2AD4XDLZXS`, page 17; fccid.io blocks scripted fetches, save the PDF from
  a browser]. The ATS2853 is a Bluetooth speaker SoC (MIPS, own flash, own DAC/ADC): A2DP 1.3 sink
  (SBC/AAC), AVRCP 1.6, HFP 1.7 hands-free with mSBC, and Actions' own TWS speaker-to-speaker link;
  no plain A2DP source to third-party headphones listed (third-party spec sheets, dasenic.com,
  fcc.report `YMX-ATS2853`) [guess on the exact feature set of Mackie's firmware]. Its firmware is
  Mackie's own build on the module (the UART protocol above); no copy or updater in the dump [static].
  Public specs: Bluetooth 5.0, role "audio receiving" (Mackie spec sheet, retailers).
- Audio: the module sits on its own stereo codec (`cin[0..1]` in, `cout[2..3]` out in the graph);
  the return feed is downmixed to mono +10 dB with mix-minus, a phone-call (HFP) style link [static].
  The UI only offers "make the mixer discoverable, pair from your phone" [static]. So the mixer is a
  sink/hands-free device that phones connect to; nothing in faderlink makes it connect out to a
  speaker or headset. Whether the chip could act as a source with other module firmware is unknown,
  and reflashing it is outside the mod's ground rules [guess].
- Profiles have two roles, and the module plays the speaker/headset side of both: A2DP **sink** (not
  source) and HFP **hands-free** (not audio gateway). A headset or speaker plays that same side, so
  it can't connect to the mixer at all, whatever the quality. The role is compiled into the module
  firmware by Actions' SDK, not picked over the UART, unless Mackie's build has a command for it
  [guess].
- Command set unknown. Ways to list it: disassemble faderlink's BT message builder on the PC
  (read-only, no mixer needed); or trace the UART on the mixer, which has no `strace`, `gdb` or
  `socat`, so a tool would have to be added to the dev card (device review first) or a logic
  analyser put on the UART3 lines.
- Device name: the constant `#DLZ | Creator XS` (full-size: `#DLZ | Creator`), sent once and then
  marker `/root/.bt-name-set-v2` is written [static]. Renaming = a different string plus removing
  the marker; the name lives in the faderlink binary.
- Reports `{"btStatus":%d, "bt":%d}` and `btPairedName`; obeys `settings.bt.enabled`.

## GD32 MCU: `flash-gd32.service` → `flash-gd32.sh`

- Firmware `/usr/local/share/evolve-a1/firmware-dlzlite-154.bin` (XS) or `firmware-evolve-154.bin`
- If `/root/.gd32-loaded-<fw>` is missing: delete all `.gd32-loaded-*`, flash with openocd at
  `0x8000000` (one retry), write the marker
- So: a new firmware filename **or** a deleted marker forces a reflash
- openocd 0.11.0+dev (custom), `/etc/openocd.cfg` with a custom `ringwayswd` SWD adapter

**Leave the GD32 alone** (ground rule, [../modding-guide.md](../modding-guide.md)): a failed SWD flash can brick the control surface.

## GOWIN FPGA: `flash-fpga.service` → `flash-fpga.sh`

- Bitstream `dlzlite-gowin.binx` (XS) or `evolve-gowin.binx`, loaded **every boot** with
  `gwprog <file> -force` (up to 5 tries), then sets `/root/.use-gowin-fpga`
- `/root/.no-fpga-reflash` skips one load (deleted after use)
- `gwprog`: GOWIN JTAG programmer (GW1N/GW1NS/GW2A) bit-banging via `/dev/mem`
- `jam`: Jam STAPL Player 2.5 (also `/dev/mem`), not used by the scripts

The FPGA most likely carries the audio path and USB audio [guess]; it is volatile, so a bad load
is fixed by a reboot.

## `/usr/local/share/evolve-a1/`

| File | Bytes |
|---|---|
| `firmware-dlzlite-154.bin` | 68116 |
| `firmware-evolve-154.bin` | 67836 |
| `dlzlite-gowin.binx` | 442439 |
| `evolve-gowin.binx` | 442439 |
| `mixergraph-dlzlite.js` | 66884 (dspserver package) |
| `mixergraph.js` | 57473 (dspserver package) |
