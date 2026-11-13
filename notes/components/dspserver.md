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
  works; a reboot fixes it. dspserver connects to `ws://localhost:80/socket.io/` after `Done.`; it
  does retry, like faderlink: libhv's reconnect from 100 ms, doubling to 1 s, unlimited, and its
  connect callback sends `INIT` on every connect, retries included [static, #257]. The `open` line
  is the attempt, not a made link; a failed retry logs `cnt=2`. Why a dspserver done first still
  lost is open. What normally saves it is its
  own "Waiting for graphics" (it polls for Weston/glesgui, ~16 s into a normal boot). On the first
  boot after a flash, `dlzmod-grow-data` delayed both server.js and dspserver by ~8 s; by then the
  graphics were up, dspserver was `Done.` within 8 s, in the same second as `Server started`, and
  lost [device: two failed first boots, with and without dspserver ordered after the grow]. Fix:
  `dspserver.service.d/dlzmod.conf` runs `dlzmod-wait-hub` first (waits until something listens on
  port 80, then for glesgui's graphics, #239; max 50 s in all, then starts anyway). A crash-restart of evolve-node alone might still leave
  dspserver without its state [guess].
- **A restart while the mixer runs: silent once, with sound once** [device]: an earlier
  `systemctl restart dspserver` (stock binary, server.js up) left every output silent (main L/R,
  both headphones) with moving meters, and `systemctl restart evolve-node` did not bring it back;
  only a reboot did. On 2026-11-11 (XS dev card at develop `9dfd5b9`, #257) the same restart kept
  the sound (Bluetooth on 5/6, heard). It ran the full codec setup again, PH0 pulse included: the
  network log lacks those lines only because it lost them (below, "The restart's lines"). What
  differed the first time is not known; it may have been a start that was silent already. Whether a
  restart brings the sound back in a silent start is not tested yet (#257).
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
  "Initial I2C scan") are the full-size's branch of the same setup, taken without `/root/.dlzlite`
  [static, #257; "The start's codec setup" below].
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
- **The codec pins** (#257) [static]: GPIO port H, read and written through the `/dev/mem` mapping
  (base + `0x2090c` = `PH_DAT` at `0x01C2090C`; the PIO controller is at `0x01C20800`). dspserver's
  own start (`0x19fa0`) makes PH0 and PH1 outputs driven low and PH2 an input with pull-up; no other
  Mackie program touches PH0-PH2 (faderlink only PH12), and no kernel driver claims PH0-PH5 (pinctrl
  debugfs [device]).
- **The start's codec setup** (`0x3a56c`, called from `0x1c97c`, which a function pointer at
  `0x222aa0` points to) [static]: logs the old/new CPU, DDR and GPU PLLs (it changes them: `old CPU PLL:
  90001410`, `new CPU PLL: 90001510` in every start's log [device]), drives PH0 low for 50 ms, then by
  the `/root/.dlzlite` flag: **XS**: PH0 high, 20 ms, AKM DAC (`0x22`) and ADC (`0x26`), the
  `/root/post-i2c.js` hook, 50 ms, PH1 high, the THAT preamps, `Audio initialisation is done.`; **full-size**:
  PH0 high, 20 ms, PH1 high, an I2C bus scan, the Everest CODECs, the Sabre DAC and ADCs, the same hook.
  So PH0 is likely the codecs' reset and PH1 an enable [guess]. Neither branch reads PH2. Each AKM or
  Sabre chip's setup first looks for an override script (`/root/akmdac-i2c.js`, `/root/akmadc-i2c.js`,
  `/root/sabredac-i2c.js`, `/root/sabreadc1-i2c.js`, `/root/sabreadc2-i2c.js`); none exists on the dump.
- **The AKM repair loop: PH2 low sets the codecs up again** (XS) [static]: dspserver's main loop
  (`0x19304`) turns every 10 ms (`usleep 10000` at `0x19330`); while it is not stopping (flag
  `0x2a250c`, read by `0x33880`) and on the XS (the `/root/.dlzlite` flag), each turn calls `0x38288`
  (at `0x19440`). That returns at once while PH2 is high; while PH2 is low it sets up the AKM DAC and
  ADC again, logging `Initialising AKM DAC...` / `ADC...` again. So PH2 reads as a hardware "codecs need
  setting up" signal [guess]: it was high whenever the loop ran so far (no second setup in any start,
  below) and long after the setup [device: see below]; whether it is low before the setup, the pin log
  (#261) will show. No kernel
  or Mackie program drives PH2, so another chip on the board holds it low and lets go [guess: the GD32
  or the codec]. If a codec lost its settings while PH2 stayed high, this repair would not run and
  the outputs would stay silent until a reboot [guess, a candidate for the silent starts]. A repair
  leaves an extra `Initialising AKM` pair in the log: none so far, one setup per start in the network
  logs of 2026-10-28, -29 and 2026-11-11 and the `syslog-last-boots` copies of #196 and #239 [device].
- **The restart's lines were lost in the network log** [device]: the restarted dspserver of 2026-11-11
  shows `DLZ Lite detected`, then the kernel's `set_cpus_allowed_ptr` dump cut off after 15 of its 26
  lines, then `Audio initialisation is done.`; every other start in the same log has the 6 PLL and 2
  AKM lines in between. A burst of ~24 lines was dropped (UDP, `docs/DEVELOPMENT.md` "Dev card: test
  builds over Wi-Fi"), so a missing line in the network log proves nothing; the journal or the boot
  log copy on DLZDATA does.
- **PH0, PH1 and PH2 high after the setup** [device, XS dev card, 2026-11-11]: `PH_DAT` read `0x1007`
  (PH0, PH1, PH2 and PH12 high; PH0/PH1 outputs, PH2 input with pull-up) 75 s into a start with sound
  and 2.4 h into another. The dev card logs these pins from each start until the shutdown (#261,
  #287; a read every ~4 ms), to compare starts with sound and silent ones; on the full-size the same
  logger runs, but what PH2 means there is not known.
- **Silent outputs with moving meters also come without either cause above** (see also glesgui's
  stop, below, which fits one of them) [device, XS dev card, 2026-11-04]: no sound while the meters moved, yet all three chips initialised without an
  I2C error and dspserver, faderlink and evolve-node had 0 restarts. A reboot usually clears it
  [user], this time it did not. In the saved state `m.mute` was 0 and the master gate bypassed; the
  running graph had no limiter (`dlzmod.lim.*` keys left in the state from an earlier #59 drop-in
  have no binding). It stayed silent after that reboot, before any probe ran or anyone logged in;
  stock then had sound, and the next card start did too. That card's `mixergraph-dlzlite.js` is
  byte-identical to a clean `patch.py graph` of the dump, so the graph is not the cause. The state
  of the silent starts was not kept and the journal does not survive a restart, but
  `dlzmod-logs/syslog-last-boots*.txt` keeps the last four starts' syslog. The silent start had the
  ~7.5 s preamp step (#147) and the working one after it had not, yet so does about 1 start in 3 with
  sound, and an earlier start that ended up silent had not: no link shown. Service order, faderlink's
  log and restarts did not differ. The stop below fits the 09:10 start; the first start of that day, with a
  normal step, stays unexplained, and when its silence began was not established.
- The FPGA loaded on the first try in all 769 starts of that syslog [device].
- **glesgui stops dspserver at every start, and two silent starts fell in that window** (#239): glesgui runs
  `killall -STOP /usr/local/bin/dspserver` twice during its graphics start (`main` `0x15df0`, unconditional) and
  `-CONT` on the main loop's 10th turn [static]. Silent starts 2026-11-04 09:10 and 10:58: the chips' init began at
  ~20.3 s, then the THAT step took ~8 s, ending at ~28.4 s [device]. Starts with sound (09:28, 10:47): `DLZ Lite
  detected` itself came at ~28 s and all chips took ~0.4 s. So in both the stop covers ~20-28 s; what differs is
  whether it lands before the chip init or in the middle of it [guess that the stop is what holds it]. Most
  likely explains #147's ~7.5 s step instead of CMA, though #147's "each wake-up ~110 ms late" does not fit a
  single stop and needs checking. Why that leaves the outputs silent is unknown [guess: chips set up, then
  ~8 s without the audio stream]. Also open: the first start that day was silent with a normal step, and #147
  counted such slow starts as having sound (was it checked each time?).
- **The wait for it** (#239, `dlzmod-wait-hub`) [device, XS dev card at `2e1a822`, 2026-11-04]: dspserver starts once
  glesgui holds `/dev/dri`, seen 0.8 s before its `Context renderer string`. 15 starts of 15 with sound, the THAT step
  at most ~1 s and never begun before the context, no I2C errors, the wait about 12 s by the clock (9-13 s) and never given up. The chips are
  ready ~29.3 s after power-on, ~0.8 s later than the ~28.5 s before. On the system log's one-second clock. It only
  helps at a start: a glesgui restart while dspserver runs still stops it, as stock does [static]. A dying
  glesgui can still hold `/dev/dri`, so a dspserver start during a glesgui restart may not wait [guess].
- **Silent with the wait in place: dspserver's link to server.js dropped** (#257) [device, XS daily card, v0.5.0,
  2026-11-09]: one silent start out of the 5 in its syslog. The wait worked (port 80 after 3.2 s, graphics after
  13.4 s), the chips initialised normally without I2C errors. Only difference: ~50 ms after dspserver's websocket
  `open`, `reconnect... cnt=1, delay=100` and `Disconnected websocket.`, then no more dspserver lines for the
  whole start. No drop in the 4 starts with sound, nor in 9 starts of the dev card's network log (2026-11-03).
  server.js logs nothing about the connection. A longer wait does not help here: the wait had already
  ended normally.
- **The drop is not the cause** (#257) [device, XS dev card, 2026-11-11]: dspserver's retry connects
  (above: no `cnt=2`), and drops also come on stock (2 in 18 connects in the factory syslog), mostly when
  glesgui stops dspserver. Apart from D-Bus, dspserver's only socket is that websocket, and glesgui and
  node open no `/dev/mem`, `/proc/d2help` or shared memory, so the screen's meters only reach it through
  that link; in the silent starts all meters moved, pre and post fader [user]. Stopping dspserver for
  3 s and 10 s (`kill -STOP`/`-CONT`, as glesgui does) stops sound and meters, then both come back, with
  no drop and no watchdog line. So neither the link nor dspserver's processing loses it: the sound is
  lost on the codec path after the mix, or never reaches the mixer. Open: in daily use the sound comes from the PC over USB (its own chip, `hardware.md`); a USB
  link that comes up half-working (cf. #88) would silence the computer's audio while Bluetooth and
  mics work. Whether the USB channel's meter moved in the silent starts is not known.

## Audio loop and headroom

- **Block** [device]: 128 frames at 48 kHz, 2.667 ms, 375 blocks/s, timed with the CPU counter
  (CNTVCT, 24.00 MHz against the wall clock; user-space reads allowed, clocksource
  `arch_sys_counter`).
- **The wait is a spin** [static + device]: each block function spins on bit 9 of an audio register
  until the next half of the buffer is ready (the loop sits in the two block functions that
  `dspLoopThreadC2` and `dspLoopThreadC3` call; anchors in `dev/dsp-headroom.py`). The work passes
  between the two threads ~20 times per 30 s. So `top` shows core 3 busy ~99% whatever the load
  (`system.md`, "Load average").
- **Headroom** [device, XS, `dev/dsp-headroom.sh`]: the share of each block spent waiting, 30 s each,
  one mic channel with EQ, gate, compressor and de-esser. Measured after a restart of dspserver,
  that time with the outputs silent but the meters moving ("A restart while the mixer runs",
  above); that the load equals a normal run is a guess.

  | State | Mean waiting | Worst block left |
  |---|---|---|
  | Mixer page, mic muted | 60.4 % | 31.1 % |
  | EQ page, Spectrum on, mic muted | 58.2 % | 34.8 % |
  | EQ page, mic muted | 65.5 % | 43.9 % |
  | EQ page, mic open | 58.9 % | 32.3 % |
  | EQ page, mic open, its processing bypassed | 59.8 % | 32.7 % |

  "Worst block" is the shortest wait in the last 4096-8192 blocks (11-22 s). A muted channel is
  skipped: opening the mic costs ~6.6 points, its processing ~1. The screen's data costs as much:
  Spectrum ~7 points, the mixer page's meters ~5 more than the EQ page. Normal use leaves ~59 %
  on average and ≥31 % in the worst block: no case for overclocking (#5), and extra graph blocks
  (limiter, a fuller compressor or de-esser) cost little next to that [guess, from the ~1 point of
  a processed channel].

  The fourth EQ band (#25) [device, XS, 2026-11-05]: EQ page, Spectrum on, every channel unmuted, EQ
  on everywhere; mic 1 also had bands 1-3 on, all other channels only band 4.

  | State | Mean waiting | Worst block left |
  |---|---|---|
  | EQ on, band 4 flat | 59.1 % | 28.2 % |
  | EQ on, band 4 at +6 dB on 14 blocks | 56.6 % | 31.6 % |

  The spectrum with 20 bands (#217) [device, XS, 2026-11-05]: the same setup, 30 s each, with mic 1's EQ
  off so that only the Spectrum switch differs: off 63.7 % / 34.8 %, on 59.8 % / 28.4 %, so ~3.9 points
  on average and ~6.4 in the worst block; EQ on and Spectrum on 59.3 % / 27.9 %. That is level with the
  10 bands of the row above, though the worst block moves between 28 and 32 % across runs. Why twice
  the bands cost no visible extra is not known; the older "~7 points" also held the screen's data.
  Only while an EQ page is open with Spectrum on. The full-size has the same blocks for it, but its
  load has not been measured [guess: about the same cost, since a tap reads one channel].

  An active `EqBand` costs ~0.18 points of a block (~5 µs), and an earlier run with 3 active blocks
  gave the same rate (60.8 → 60.3 %). A flat band costs nothing measurable. The 4 master blocks of
  the USB and NDI mix-minus did not run, so all 18 would cost ~3.2 points. The worst block does not
  follow the band: it went up with the band on, and moved between 28 and 32 % across these runs.
  Every band of all channels on (56 active on these channels, 17 here) was not measured: at the same
  rate about 50 % waiting [guess]. Bands of channels with their EQ on but gain 0 stay skipped, so a
  normal mixer sits well above that.

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
- Stopped by server.js before updates; SIGSTOP'd by glesgui at every graphics start and SIGCONT'd on its 10th main-loop turn (#239); also during touch calibration
- `Requires=faderlink`, so restarting faderlink also restarts dspserver

## Mod angles

- **`/root/post-i2c.js`**: an optional script the binary already looks for. API from the prelude:
  `sys.writeI2C(addr, reg, val)` (returns false on failure), `sys.delay(ms)`, `sys.msleep(ms)`, and
  helpers `w(addr, reg, val)` (throws on failure), `delay(ms)`, `msleep(ms)`. No read function.
  Still to test live: that it runs, and whether the codec scripts replace or add to the built-in init.
- `mixergraph-dlzlite.js` defines the whole audio graph; see [mixergraph.md](mixergraph.md) for the
  engine, the block catalogue and the routing. Overwritten by `dspserver` package updates.
- dspserver also changes the CPU, DDR and GPU PLLs at start ("old/new CPU PLL" log lines).
