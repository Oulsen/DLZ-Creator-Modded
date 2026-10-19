# dspserver (audio engine)

`/usr/local/bin/dspserver` (2.6 MB), owned by package `dspserver` 1338. All [static] unless tagged.

## What it is

- C++, stripped, crosstool-NG 11.2.0, libhv + nlohmann::json, statically linked libstdc++
- **Embedded QuickJS** (2021-03-27)
- Links ffmpeg (`libavcodec/avformat/avutil/swresample`) and **NDI** (`libndi.so.5`, shipped as
  `libndi.so.5.5.4`); FLAC built in
- **No ALSA** (no libasound). Audio goes through **`/dev/mem` + DMA** (`startDMA`, `dmaLoopThread`,
  "Error: unable to start DMA") [static]. Which registers it maps is unknown

## Inputs

| What | Path | Notes |
|---|---|---|
| Mixer graph | `/usr/local/share/evolve-a1/mixergraph-dlzlite.js` (XS) / `mixergraph.js` | The DSP routing/processing graph, run in QuickJS: see [mixergraph.md](mixergraph.md) |
| Codec init scripts | `/root/{akmadc,akmdac,everest,sabreadc1,sabreadc2,sabredac,post}-i2c.js` | Optional; **none exist** in the dump. Log line "Running post-i2c.js..." after the codec init, before the THAT preamps |
| Hub | socket.io EIO3 client to `ws://localhost:80` | Sends `INIT`, then key/value JSON |
| `/proc/d2help` | read | Purpose unknown |

The codec script names hint at the parts on the board: AKM ADC/DAC, Everest, ESS Sabre ADC/DAC
[guess: different board revisions, `post-i2c.js` = generic hook after codec init].

## Outputs

- `/tmp/stream%02d.wav`, `/tmp/streamBT%c.wav` (recording/streaming buffers), `/tmp/debug`,
  `/tmp/thread_watchdog`
- `/tmp/thread_watchdog`: dspserver runs a `watchdogThread` that logs "Watchdog triggered, thread
  switching logic requested"; glesgui also references the file ("Watchdog file") [static]. An
  internal audio-thread watchdog, not tied to systemd or the hardware watchdog; who writes and who
  reads it is unknown [guess]. On a running SD boot the file did not exist and the journal held one
  "Watchdog triggered" for that boot [device]
- At start: `sched_rt_runtime_us=-1`, IRQ affinity to CPU0, zswap off
- Start order matters [device]: dspserver must find server.js (evolve-node) up when it finishes
  its init (`Waiting for graphics to initialise... Done.`). Normally the server is up ~9 s earlier
  and dspserver then loads the pad samples (`/srv/bankPlayer/default/loaded/*.wav`). When dspserver
  is done first it never loads them: no audio, mic dead, REC_START ignored (no file), while the UI
  works; a reboot fixes it. dspserver connects once to `ws://localhost:80/socket.io/` after
  `Done.` and does not retry (faderlink does) [static + device]. What normally saves it is its
  own "Waiting for graphics" (it polls for Weston/glesgui, ~16 s into a normal boot). On the first
  boot after a flash, `dlzmod-grow-data` delayed both server.js and dspserver by ~8 s; by then the
  graphics were up, dspserver was `Done.` within 8 s, in the same second as `Server started`, and
  lost [device: two failed first boots, with and without dspserver ordered after the grow]. Fix:
  `dspserver.service.d/dlzmod.conf` runs `dlzmod-wait-hub` first (waits until something listens on
  port 80, max 45 s, then starts anyway). A crash-restart of evolve-node alone might still leave
  dspserver without its state [guess].
- Harmless at every boot: a kernel stack dump `set_cpus_allowed_ptr: core 4 is set in the mask`
  (dspserver asks for an affinity mask with a 5th core on this 4-core SoC), and
  `Watchdog triggered, thread switching logic requested` [device]

## Log and audio chip start

- **Buffered log** [device]: dspserver writes its own lines through glibc's stdio (`printf`, `puts`,
  `fwrite` from the shared `libc.so.6`), block-buffered into the journal pipe, so they reach the
  syslog only when ~4 KB have piled up. In the card's syslog (769 boots, the dump's history included) the chip start lines showed
  up once, 18 min after that start, after a recording; on other boots they never did (a switch-off
  loses the buffer). ffmpeg's lines (stderr) are not affected. The mod line-buffers stdout from the
  `dspserver` drop-in (`LD_PRELOAD=/usr/libexec/coreutils/libstdbuf.so _STDBUF_O=L`; proven on the PC
  with the dump's own `sed` under qemu: without it the lines of a killed process are lost) (#136).
- **XS start order** [device]: `DLZ Lite detected` → old/new CPU, DDR and GPU PLL → `Initialising AKM
  DAC...` → `Initialising AKM ADC...` → `Initialising THAT preamps...` → `Audio initialisation is
  done.` → `THAT[n] = ...`. No bus scan line on the XS. The other chips' messages (Sabre, Everest,
  "Initial I2C scan") belong to other board variants [guess].
- **A chip that does not answer does not stop it** [device]: one factory boot in the card's syslog
  (hostname still `mackie-evolve-a1`) shows `i2c: retrying address 22` ×99, `i2c: (!!!) error sending
  data to 0x22`, `Couldn't initialise AKM DAC (possibly dead): failed to send I2C data`, then the same
  for the AKM ADC at `0x26`, and dspserver carried on. Only `Couldn't initialise audio hardware,
  exiting` ends it [static]. So a chip that fails at start gives moving meters and a silent output
  until the next start [guess on the effect]. AKM DAC = I2C `0x22`, AKM ADC = `0x26` [device].
- The FPGA loaded on the first try in all 769 starts of that syslog [device].

## Recordings

- Recordings: the file named by the hub key `recFile` (see [node-backend.md](node-backend.md)).
  `MediaRecorder` splits at **2 GB** on its own ("File size limit reached (2GBs), thus recording
  will be split"), independent of the filesystem; formats `.wav .bwf`. How the split parts are named
  is not known yet.
- Recording format [device]: 48 kHz, 24-bit, `WAVE_FORMAT_EXTENSIBLE`, a `LIST` chunk before
  `data`. Disk Recording = Stereo (`settings.rec.mtk=0`): 2 channels, 288 KB/s, so the 2 GB split
  comes after ~2 h 4 min. Multitrack + Stereo (`mtk=1`, `poly=1`): one 14-channel WAV, ~2 MB/s,
  split after ~17-18 min. The multitrack switch in the PC (USB) section of Settings is a different
  setting and does not change the disk format.

## Related

- `wavfinalizer`: fixes WAV headers with a size field of -1 (unfinished recordings)
- Stopped by server.js before updates; SIGSTOP/SIGCONT'd by glesgui during touch calibration
- `Requires=faderlink`, so restarting faderlink also restarts dspserver

## Mod angles

- **`/root/post-i2c.js`**: an optional script the binary already looks for. API from the prelude:
  `sys.writeI2C(addr, reg, val)` (returns false on failure), `sys.delay(ms)`, `sys.msleep(ms)`, and
  helpers `w(addr, reg, val)` (throws on failure), `delay(ms)`, `msleep(ms)`. No read function.
  Still to test live: that it runs, and whether the codec scripts replace or add to the built-in init.
- `mixergraph-dlzlite.js` defines the whole audio graph; see [mixergraph.md](mixergraph.md) for the
  engine, the block catalogue and the routing. Overwritten by `dspserver` package updates.
- dspserver also changes the CPU, DDR and GPU PLLs at start ("old/new CPU PLL" log lines).
