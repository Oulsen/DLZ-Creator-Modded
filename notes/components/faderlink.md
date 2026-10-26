# faderlink, GD32 MCU and GOWIN FPGA (control surface)

Owned by package `faderlink` 521 (binary, flash scripts, firmware, bitstreams). All [static] unless tagged.

## faderlink (`/usr/local/bin/faderlink`, 856 KB)

- C++, libhv + nlohmann::json; log tags `<< FADER`, `<< WS`
- **GD32** over UART `$GD32_TTY` (unit sets `/dev/ttyS2` = uart5). Protocol/baud unknown
- **Bluetooth module** over `/dev/ttyS1` (uart3)
- Opens `/dev/mem` ("Unable to map memory"), probably GPIO/PWM [guess]
- Backlight: writes `/sys/devices/platform/backlight/backlight/backlight/brightness`
- Hub: socket.io EIO3 client to `ws://localhost:80`. Handles keys like `settings.brightness.*`,
  `B.%d.%d.colorhex`, `B.%d.%d.blink`, `B.x.y.fx.del.feedback`
- First boot: sets hostname `mackie-dlz-creator(-xs)` (sed on `/etc/hosts` + `hostnamectl`,
  marker `/root/.sethostname`), Bluetooth name (marker `/root/.bt-name-set-v2`)
- Markers read: `/root/.dlzlite`, `/tmp/.bt-was-disabled-startup`

### Keys it uses

- **Faders**: a fixed table `i.0.mix i.1.mix i.2.mix i.3.mix p.0.mix p.1.mix p.2.mix s.mix m.mix`
  (shared with the full-size model). No `v.N.mix`, so the XS virtual strips have no hardware fader
  [static]. Which entries the XS faders use, and whether faderlink also *reads* these keys back
  (e.g. fader pickup), needs a capture (open question 3).
- **Knobs**: app.js's knob panel writes `K.N.key` (the hub key knob N drives), `K.N.color` (LED ring
  colour) and `K.N.blink` for N = 0-3, plus `K.4`. The panel only sends the key name; faderlink picks
  a value transform itself (`keyDataTransform`, strings `eqBand`, `log`; logs
  "keyDataTransform not found: %s" otherwise) and writes the key [static]. So knobs can drive any key
  faderlink has a transform for; whether an own `dlzmod.*` key works is open (question 29).
- A per-channel parameter table (`i.N.pan gain eq.b1-3.* eq.hp.* gate.* comp.* ds.* aux.N.* fx.N.value`),
  probably the transform lookup for those keys [guess].
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
