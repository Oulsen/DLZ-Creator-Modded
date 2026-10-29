# dspserver (audio engine)

`/usr/local/bin/dspserver` (2.6 MB), owned by package `dspserver` 1338. All [static] unless tagged.

## What it is

- C++, stripped, crosstool-NG 11.2.0, libhv + nlohmann::json, statically linked libstdc++
- **Embedded QuickJS** (2021-03-27)
- Links ffmpeg (`libavcodec/avformat/avutil/swresample`) and **NDI** (`libndi.so.5`, shipped as
  `libndi.so.5.5.4`); FLAC built in
- **No ALSA** (no libasound). Audio goes through **`/dev/mem` + DMA** (`startDMA`, `dmaLoopThread`,
  "Error: unable to start DMA") [static]. It maps physical `0x01C00000`, 8 MB (the peripherals,
  port I among them: "How it drives the chips" below) [static]
- **No plugin loading**: it imports `dlopen`/`dlsym`, but names no library to load besides its
  linked ones, so the 48 DSP blocks ([mixergraph.md](mixergraph.md)) are all built in. A new
  native block would mean code injection into the binary; anything the existing blocks can do is
  graph JS [static]

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
- Harmless at every boot: kernel stack dumps `set_cpus_allowed_ptr: core 4 is set in the mask`
  (from the kernel's own workqueue code, `worker_attach_to_pool`, once dspserver has set the
  workqueue cpumask; not from an affinity call of dspserver [static]), and
  `Watchdog triggered, thread switching logic requested` [device]

## Log and audio chip start

- **Buffered log** [device]: dspserver writes its own lines through glibc's stdio (`printf`, `puts`,
  `fwrite` from the shared `libc.so.6`), block-buffered into the journal pipe, so they reach the
  syslog only when ~4 KB have piled up. In the card's syslog (769 boots, the dump's history included) the chip start lines showed
  up once, 18 min after that start, after a recording; on other boots they never did (a switch-off
  loses the buffer). ffmpeg's lines (stderr) are not affected. The mod line-buffers stdout from the
  `dspserver` drop-in (`LD_PRELOAD=/usr/libexec/coreutils/libstdbuf.so _STDBUF_O=L`; proven on the PC
  with the dump's own `sed` under qemu: without it the lines of a killed process are lost) (#136).
  On the device the chip start lines now come at ~27 s of every start, `Done.` at ~30 s [device].
- **XS start order** [device]: `DLZ Lite detected` → old/new CPU, DDR and GPU PLL → `Initialising AKM
  DAC...` → `Initialising AKM ADC...` → `Initialising THAT preamps...` → `Audio initialisation is
  done.` → `THAT[n] = ...`. No bus scan line on the XS. The other chips' messages (Sabre, Everest,
  "Initial I2C scan") belong to other board variants [guess].
- **How it drives the chips** [static]: no kernel driver. It maps physical `0x01C00000` (8 MB) from
  `/dev/mem` and toggles port I pins itself: the AKM chips through a bit-banged I2C on PI0 (clock)
  and PI1 (data), the THAT preamps through a 3-wire serial write on PI15/PI16 (chip selects), PI17
  (clock) and PI18 (data). The DTB's kernel users of those pins (i2c3, spi1, uart2) are disabled;
  the touch (TWI1) and the PMIC (TWI0) are on other buses. The chip init runs in a thread pinned to
  core 3 at SCHED_FIFO 99. Before it, dspserver waits until `Xwayland` and `glesgui` processes exist
  (`pidof` every 0.2 s, "Waiting for graphics to initialise..."), so ordering glesgui after
  dspserver's init would deadlock. No readiness signal (no sd_notify, file or socket); only its log.
- **The THAT step is 66 `usleep(500)` calls** [static], nothing else. The kernel runs a periodic
  4 ms tick on every core (`CONFIG_HZ=250`, `hres_active: 0` in `/proc/timer_list` [device]), so
  each sleep takes one tick: 0.20-0.26 s.
- **~7.5 s when it meets the graphics start** (#147) [device]: with the early start (#141) the step
  took 7.2-7.9 s in 4 of 13 starts with the Wi-Fi stick and 6-7 of 11 without it, each time when it
  began within ±0.05 s of glesgui's `Initialising graphics...`; it then ended 1.41-1.54 s after
  `Graphics initialised. Opening GUI...`. Begun ≥0.19 s earlier it took 0.20-0.26 s; in the stock
  order (preamps after the graphics start) it was never slow. Not Wi-Fi, no retry (the step has
  none): each of the 66 wake-ups comes ~110 ms late. Likely the graphics start's contiguous memory
  allocations (CMA; `alloc_contig_range: ... PFNs busy`, `pgmigrate_fail` in `/proc/vmstat`) moving
  pages or keeping core 3 busy in the kernel (`PREEMPT_VOLUNTARY`) [guess]. Not fixed: the audio is
  still ready before the mixer view (~27 s against 28-29 s), and the only clean fix (hold glesgui's
  graphics start until `Audio initialisation is done.`) needs a wrapper around Mackie's GUI.
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
