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
  differed the first time is not known; it may have been a start that was silent already. **In a
  silent start a restart does not bring the sound back** [device, XS dev card, 2026-11-13, #257]: the
  full codec setup ran again without errors (PH0 pulse, AKM DAC/ADC, THAT), the outputs stayed
  silent; a reboot of the mixer brought the sound back. The same in the fourth silent start
  (2026-11-17, "A fourth silent start", below): restart silent, reboot with sound.
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
  and PI1 (data) (but the bit-bang routines `0x365c4` and `0x37068` toggle bit 13 of `PI_DAT` as the
  clock, with PI13 made an output, and set PI0 high only once at the I2C init: the clock may be PI13
  [static, to check on the device]), the THAT preamps through a 3-wire serial write on PI15/PI16 (chip selects), PI17
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
  until the next start [device: an owner's XS, "A DAC that does not answer" below]. AKM DAC = I2C
  `0x22`, AKM ADC = `0x26` [device]. Those are 8-bit address bytes: the write helper (`0x370f8`) sends `addr & 0xFE`, then register and
  value, so the chips sit at 7-bit `0x11` and `0x13`, AKM's usual range [static].
- **The AKM writes** [static]: no read-back or check (a failed write only logs), no soft mute and no
  power-down register written. DAC (`0x38090`): reg `0x0A` = `0x8D`, `0x00` = `0x0D`, `0x02` = `0x04`.
  ADC (`0x38170`): `0x00` = `0xFF`, `0x01` = `0x00`, `0x02` = `0x34`, `0x03` = `0x40`, `0x04` = `0x00`,
  `0x01` = `0x01` (reset held, then released). By the register maps the DAC is likely an AK4458/AK4438
  (8 channels) and the ADC an AK5558 [guess]. The repair loop (`0x38288`) writes the same two
  sequences, without a PH0 pulse.
- **The audio clocks are dspserver's own** [static]: the kernel has no I2S driver (the I2S nodes in the
  device tree are disabled). `0x33da0`, before PH0 goes low, muxes the I2S0 pins on port B, writes
  PLL_AUDIO (CCU `+0x08`) = `0x80047F18` (~24.576 MHz [guess]) without waiting for its lock bit (bit
  28; a 5 ms sleep only), sets the I2S0/I2S1 module clocks (`+0xB0`/`+0xB4`), ungates and releases
  them (`+0x68`, `+0x2D0`, bits 12-13) and enables MCLK out. So MCLK is set up before the codecs'
  reset is released; whether it is locked and present at the pin is not checked. `0x32f50` also sets
  up the on-chip codec (CCU `+0x140`). PI12 (`clk_out_a` by the device tree) is made an input at start
  and read when I2S stops: likely not a codec clock.
- **Other lines dspserver drives** [static]: at start (`0x19fa0`) PI14 output high, PH0/PH1 outputs low,
  PH2 input with pull-up, PI12 input, PI15-PI18 outputs high (THAT), PI0 high at the I2C init. On exit
  (`0x348a8`, called from the main loop at `0x19454` once its stop flag is set) PI14 and PH0 go low.
  So PI14 looks like an output enable or mute release [guess], and a restart already cycles PI14, PH0
  and PH1. Nothing else in dspserver touches PH0-PH2; faderlink's PH12 is the Bluetooth bring-up (with
  PG5-PG7 as its UART).
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
  the outputs would stay silent until a reboot [guess]. A silent start did have a short PH2 low,
  before the loop ran (below, "A silent start in the pin log"), but setting the codecs up again did
  not help there, so lost codec settings alone do not explain it. A repair
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
  lost on the codec path after the mix, or never reaches the mixer.
- **A silent start in the pin log: only the output side is dead** (#257) [device, XS dev card,
  2026-11-13]: main L/R and headphones silent, every meter moving, the mics' meters too (so the AKM
  ADC works). USB is not the cause: a tone into USB 1-2 came back on the main-mix return 1-2
  (`dev/usbloop.py check`), so USB in, the mix and USB out worked. The start's log was normal: wait-hub
  (port 80 after 2.9 s, graphics after 12.2 s), one codec setup at 29.6 s without I2C errors,
  dspserver's link without a drop. **The pin log (#261) shows PH2 low for ~11 ms at 30.87 s**, ~1.2 s
  after the setup, while dspserver still waited for the graphics (`Done.` at 33.4 s), so its repair
  loop was not running yet and did not set the codecs up again. The 4 starts before it in the saved
  syslogs (with sound, as far as the user remembers) have no PH2 low after the setup. Around that
  moment the screen came up (glesgui `Client connected.`) and DLZDATA went read-only again, but both
  happen at the same time in starts with sound too; nothing else was logged. Restarting dspserver
  (a full codec setup) did not bring the sound back (above), so PH2 is likely a sign of something
  else on the board dropping out (power, a reset on the analog side, the GD32) that the A40i cannot
  set right again [guess]. That start's pin log read every 5-8 ms and stopped at 120 s; since #287
  it runs the whole session and reads every ~4 ms (the kernel's tick), so a pulse later in a
  session is caught too, one shorter than ~4 ms can still fall between two reads.
- **Two silent starts, the same drop** (#257) [device, XS dev card, 2026-11-14]: the second silent
  start with the pin log looked the same: outputs silent, meters moving, a USB tone back on the
  main-mix return at -29 dBFS; normal start log (one codec setup at 29.3 s, no I2C errors, no
  drop of the link); **PH2 low for ~12 ms at 30.46 s**, ~1.2 s after the setup, before dspserver's
  `Done.`; no PH2 low in the 52 min after it. The card's syslog holds 8 starts with the pin log:
  PH2 low after the setup in both silent ones and in none of the 6 with sound (sound confirmed by
  the user). So the drop marks a silent start; whether it causes it is open. Nothing else was
  logged around it (no kernel line, no power message); by glesgui's own clock its first frame
  came ~360 ms after the drop. Leads [guess]: the screen (the display driver may switch panel and
  backlight off and on when glesgui takes over, a current surge) and the power side (AXP221, whose
  interrupt had fired 3 times in that session, when is not known). #293 widens the pin log to every pin, the screen and the
  power chip. **Stock has the symptom too** [user report, 2026-11-14]: an owner on build 1731
  without the mod had silent outputs with moving meters, standalone too, starting mid-session
  together with a USB disconnect on Windows, and a reboot did not bring it back. Their logs on the
  mod later showed a different cause: a DAC that does not answer (below).
- **Cold starts: the third silent start, the first cold one** (#257) [device, XS dev card,
  2026-11-16]: the mixer had been off ~13 h (the clock jumped 13.4 h at the NTP sync). The DAC
  answered (one setup at 30.8 s, no retries); **PH2 low for 18 ms at 31.77 s**, ~1 s after the
  setup and ~2-3 s before `Done.`; the pin log (every pin since #293) saw no other pin change in
  that second, and its "PH2 low" snapshot (screen, power chip, regulators, clocks, I2S) matches the
  one at the setup. `sched: RT throttling activated` at 33.3 s is in starts with sound too. The
  mixer stayed silent for the 7.5 h it ran. **The CPU was at 29 °C** at the setup; the 3 other
  starts in the card's syslog with temperatures were at 63-72 °C, with sound and no PH2 low after
  the setup, and so was a power cycle right after this one (warm, 66 °C: no drop, sound). Two
  dspserver restarts in a session were at 74 °C; in one of them PH2 went low ~140 ms after its
  setup, whether the sound stayed is not known. The owner's silent starts are the first start of
  the day, after 12-16 h off [user report]. So a cold board is the lead for #257 [guess: 2 cold
  silent starts, this one and the fourth (next point, 28 °C), against warm starts with sound; the
  saved logs hold no temperature for the 2026-11-14 silent starts]. Mechanism unknown; a cold crystal, PLL or regulator settles more slowly, and the
  setup waits a fixed 5 ms after PLL_AUDIO without its lock bit (above) [guess]. Mackie's repair
  loop (PH2 low → set the AKM chips up again) only runs after `Done.`, so it does not see the drop;
  it redoes less than the restart that did not help twice ("A restart while the mixer runs").
  - The USB tone did not come back on the return in this start nor in the warm one after it: mix-minus
    was on for the computer channel (the user's setting), not a symptom.
  - Next silent start, before switching off, each step tried only if the one before left it
    silent (after the fourth start, next point): one login (drop, temperature); A: restart
    faderlink, evolve-node, glesgui and dspserver (everything but the FPGA and the processor);
    B: stop dspserver and faderlink, `systemctl restart flash-fpga` (the boot's own FPGA load),
    start them again (sound back = the FPGA; the mod could do this after a drop instead of a
    reboot); C: `reboot` (known to help). B is a one-time exception to the "no `flash-fpga` over
    SSH" rule, approved by the maintainer for this test. Each step is a write: the user confirms it.
    Done in the fifth silent start (below): A left it silent, **B brought the sound back**.
- **A fourth silent start, the second cold one: nothing the processor sees changes at the drop**
  (#257) [device, XS dev card, v0.7.0-dev, 2026-11-17, a cold start]: one codec setup (PH0 → PH1
  76 ms, DAC answered, no I2C retry), `Audio initialisation is done.` at 30.38 s, glesgui `Client
  connected` at 30.62 s, **PH2 low for ~21 ms at 31.465 s**, before dspserver's `Done.`. Across the
  drop, every pin of ports A-I, backlight, display state, the PLLs (audio locked) and the power chip's
  interrupt count (3, unchanged since 18.6 s, as in starts with sound) stay the same; no kernel line.
  **I2S0 was not streaming yet at the drop** (`txcnt=0` at the setup and at the drop, also after the
  restart below; the stream starts later), so the DAC had MCLK but no audio frames when PH2 dropped.
  **A minute in, the stream runs as in starts with sound** (I2S0 `ctl=107`, TX and RX ~2400-2800
  words per 10 ms, as in the saved 60 s snapshots of 4 other starts, 3 of them without a PH2 drop):
  the processor feeds the stream normally and what stays dead is behind it. The kernel's regulator clean-up (`dc5ldo`, `vdd1v2-sata`,
  `vdd2v5-sata` off at ~34 s) comes in every start, those with sound too: not the cause. The
  mid-session restart with a drop ~140 ms after its setup (previous point) was at 8660.60 s
  (setup) and 8660.74 s (drop) of its start.
  - **The plan's steps in this start** (#257): the USB tone came back at -29.0 dBFS (only the analog
    outputs dead, as before). `systemctl restart dspserver` at ~417 s: a clean setup (DAC answered,
    PH0 → PH1 89 ms), **PH2 low ~12 ms at 418.656 s, inside the setup** (after the AKM writes, before
    PH1 high), still silent, tone still back on USB. `reboot` (power stays on): **sound back**, one
    setup at 28.5 s, no PH2 drop, CPU 47 °C at the setup against 28 °C in the cold start. So a power
    cycle is not needed; what a reboot does and a dspserver restart does not (the whole A40i reset:
    every pin to its reset state, MCLK and the I2S clocks off for ~28 s instead of PH0 low for 1.8 s;
    whatever else a reboot resets on the board) brings the outputs back [device]. Which of those it
    is is open.
  - **What a reboot does that a restart does not** (2026-11-17):
    - **The FPGA is reloaded**: `flash-fpga.sh` only runs `gwprog <bitstream> -force` [static]. A
      splitter must sit between the processor and the DAC: the XS graph (`mixergraph-dlzlite.js`) puts
      HP1 (`aout[0]`,`[4]`), HP2 (`[8]`,`[12]`), Master (`[16]`,`[20]`) and the 14 USB returns
      (`aout[2]`,`[3]`,`[6]`,`[7]` ... `[30]`) into one 32-slot TDM array, and the processor runs only
      I2S0 (I2S1 idle in every snapshot) [static + device]. So one stream feeds the DAC and the USB chip, and the FPGA most
      likely splits it [guess, now well supported]. In a silent start the USB part of that stream
      works and the DAC part does not. `gwprog`'s "pin:DONE"/"pin:READY" are FPGA status bits read
      over JTAG, not GPIOs: PH2 is not the loader's [static].
    - **The clocks stop only for a reboot**: dspserver's exit (`0x348a8`) only drives PI14 and PH0 low; its I2S setup
      (`0x3d2f4`) writes I2S0 `CTL=0x100` (clock generator on) and nothing in it turns MCLK or the I2S
      module clocks off [static]; the restart's snapshot read `clkd=111` (MCLK out) [device]. So MCLK
      and the bit clocks run straight through a restart and stop only for a reboot.
    - **Two power-chip rails come back on**: DLDO4 (2.5 V, named `vdd2v5-sata` in Mackie's device tree)
      and ELDO3 (1.2 V, `vdd1v2-sata`) are on again after a reboot and switched off by the kernel's
      regulator clean-up at ~34-38 s; DC5LDO stays off [device]. They go off in starts with sound too,
      so they do not feed the live audio path; what they feed on this board is not known.
    - Not checked: whether a reboot resets the GD32 (no known reset line; faderlink drives only PH12).
      Not needed for the sound: the FPGA reload alone brings it back (next point).
- **A fifth silent start, the third cold one: an FPGA reload brings the sound back** (#257) [device,
  XS dev card, 2026-11-19, a cold start]: CPU 27.7 °C when the pin log started, 31 °C at the setup.
  One codec setup (PH0 → PH1 76 ms, DAC answered, no I2C retry), `Audio initialisation is done.` at
  31.88 s, glesgui `Client connected` at 32.87 s, **PH2 low for ~29 ms at 32.958 s** (1.34 s after
  the setup, 88 ms after `Client connected`, before `Done.` at 35.5 s); no other pin change in that
  window, power chip interrupts (3), regulators, PLLs (audio locked) and backlight unchanged, I2S0 not
  streaming yet at the drop (`txcnt=0`), streaming normally a minute in. The same pattern as the
  fourth start. The USB tone came back at -28.6 dBFS (only the analog outputs dead). The plan's steps:
  - **A** (`systemctl restart faderlink evolve-node glesgui dspserver`, ~573 s): a clean setup at
    580.4-580.6 s (DAC answered, PH0 → PH1 84 ms, no PH2 drop), still silent. **Windows lost the USB
    audio device** (Status Error, no playback or recording devices) after this restart and kept it
    lost until after B; the owner's stock report (silent outputs together with a USB disconnect on
    Windows, above) may be the same link.
  - **B** (`systemctl stop dspserver faderlink; systemctl restart flash-fpga; systemctl start
    faderlink dspserver`, ~728 s; flash-gd32 stays active with `RemainAfterExit`, so its `Requires`
    did not run it again): `flash-fpga.sh` erased the FPGA's SRAM and loaded the bitstream in ~3.3 s
    (user code `7E20` before and after), a clean setup at 734.6 s (no PH2 drop), **sound back** on
    the analog outputs [user], USB audio back on Windows, tone on the return at -28.6 dBFS.
  - So **the FPGA holds what stays dead** in a #257 start [device: A, which redoes everything but
    the FPGA, did not help; B, which adds only the FPGA load, did]. No reboot, no power cycle and no
    GD32 reset are needed. A mod repair: after a PH2 drop in the start (or a silent DAC path), stop
    dspserver and faderlink, reload the FPGA, start them again [guess: works the same way each time;
    one start so far]. Why a cold FPGA (or the PH2 event) leaves its DAC side dead is still open.
- **A DAC that does not answer: a second cause, not #257** [device, an owner's XS, v0.6.0 and
  v0.6.1 with Diagnostics on, 9 starts]:
  - In 8 of 9 starts the first DAC write got no acknowledgement: `i2c: retrying address 22` ~100
    times in ~55 ms, then `Couldn't initialise AKM DAC (possibly dead)`. The one start where it
    answered at once was the only one the owner heard sound in, for the whole start (YouTube
    playing).
    Nothing set the DAC up again later in a start: no PH2 drop, no second setup, also not in a
    36-minute start. Stock is the same: with the card out (Mackie's own software from the eMMC) one
    start had sound and the next card start was silent again [user report].
  - Everything the processor drives is the same in good and failed starts: all pin snapshots (ports
    A-I, before and after the setup), PLL_AUDIO locked, I2S0/I2S1 running, screen and power chip, and
    the same as on our dev card. The ADC on the same bit-banged bus and PH0 pulse answers every time,
    and so do the THAT preamps. So the bus and the shared reset work; the fault is in or around the
    DAC (its supply, a joint, the chip) [guess], or a timing only this board misses [guess: the
    setup writes PLL_AUDIO and waits 5 ms without checking its lock bit]. CPU temperature at the
    setup was 73-78 °C in good and failed starts alike.
  - Pin log, ms between the setup's steps:

    | | PH2 → PH0 high | PH0 → PH1 high | DAC | PH2 low after the setup |
    |---|---|---|---|---|
    | Dev card, #257 silent start | 116 | 84 | answered | yes, +1.16 s |
    | Dev card, 5 starts with sound | 120-155 | 60-88 | answered | no |
    | Owner, start with sound | 124 | 84 | answered | no |
    | Owner, 6 silent starts | 120-124 | 106-148 | no answer | no |

    The lead-up is the same everywhere. The longer PH0 → PH1 gap is the failed DAC's retries (the
    DAC setup sits between the two), a result, not a cause; a gap above ~100 ms marks a DAC that did
    not answer in a log that only has the pin lines.
  - So two faults give the same symptom: in #257 the DAC answers (103 DAC setups in the dev card's
    logs, no I2C error) and the sound goes ~1.2 s later with the PH2 drop; here the DAC is never set
    up and PH2 never drops. On a healthy XS it is rare: one factory boot in the dump's syslog
    ("A chip that does not answer", above).
  - Open: whether a `systemctl restart dspserver` (the setup again, PLL already locked) gets an
    answer. Yes = timing, and the mod could retry at a failed setup; no = hardware, a case for
    Mackie service. In #257 a restart did not help in two silent starts (above).
- **What the research ruled out, and what is left** (#257, 2026-11-14):
  - Not phantom power: it is the `i.N.phantom` key (server.js keeps it in `/srv/srv_data.json`; the
    dump has mic 1 on), which dspserver turns into bit `0x10000` of the THAT shadow word (`0x3471c`)
    and writes with the preamps; `THAT[0]` changes from `0x300030` to `0x310b30` 4.5-5.7 s after
    `Audio initialisation is done.` [device, older logs], so ~3.5 s after the PH2 drop.
  - Not the PLL step: `0x3a56c` raises the CPU from 1008 to 1056 MHz at a fixed voltage and switches
    PLL_DDR0 (480 MHz) and PLL_GPU (408 MHz) on [static, field layout from mainline `ccu-sun8i-r40`],
    in every start, ≥1.3 s before the drop, and touches neither PLL_AUDIO nor `clk_out_a`.
  - Not the AKM chips alone: a restart pulses PH0 and writes them again (and cycles PI14 and PH1,
    above) without bringing the sound back. So nothing the processor is known to drive reaches what
    stays dead [static + device].
  - Not the GD32 link: faderlink forwards only fader, LED, lock, brightness and recording keys; the
    GD32 firmware's strings have no audio, codec, power or reset message [static, strings only].
    server.js, glesgui and the units have no GPIO or `/dev/mem` use; glesgui sets no backlight
    (faderlink writes it from `settings.brightness.screen`).
  - Left [guess, superseded 2026-11-19: an FPGA reload alone brings the sound back, so the FPGA is
    what stays dead, "A fifth silent start" above]: the output side behind the DAC (output stage,
    mute circuit or their supply) stays off after a short event, and only a power-off resets it. The full-size has a separate analog board
    ([hardware.md](../hardware.md), "Sources"); the XS is not opened yet. Closest event to the drop:
    glesgui's `Client connected` and the state push that follows (LED and button brightness to the
    GD32), a load step on the board's supply. Whether the processor still streams to the DAC in a
    silent start the pin log's snapshots now show (#293: the I2S sample counters).
  - Logs cannot tell a cold start from a reboot by shutdown lines: none in any log, the rear switch
    cuts the power. Nearly every start is cold.
  - Online (2026-11-14): no public report of this symptom; USB-only disconnect reports exist (Windows
    10 losing the device after a power cycle, the XS's USB audio under Linux 6.8+).

## Audio loop and headroom

**DSP budget**: what each feature that adds work to the audio core leaves free, measured with
`dev/dsp-headroom.sh` on the dev card (share of each block spent waiting: mean / worst block). A PR
that adds blocks to the audio graph measures before and after and adds a row (`docs/DEVELOPMENT.md`,
"On the mixer before the merge"). The worst block moves between ~28 and 32 % across runs of the
same setup, so smaller differences are noise. **Threshold**: the worst block below 15 % free on
either model means first making the graph cheaper (lighter blocks, switching unused ones off), and
only then reopening #5 (a higher processor speed). The other cores (screen, node, NDI, Bluetooth)
are not in this table: their load and memory over long sessions are #8 (planned: a line every
minute in the dev card's pin log).

| Feature | Model | Mean waiting | Worst block left | Source |
|---|---|---|---|---|
| Normal use, mixer page, mic muted | XS | 60.4 % | 31.1 % | #226 |
| Normal use, EQ page, mic open | XS | 58.9 % | 32.3 % | #226 |
| 4th EQ band at +6 dB on 14 blocks (#25) | XS | 56.6 % | 31.6 % | 2026-11-05 |
| Spectrum with 20 bands on, EQ page (#217) | XS | 59.8 % | 28.4 % | 2026-11-05 |
| Master limiter (-1 dB) and master gate on, mixer page, mic muted (#59) | XS | 56.5-57.3 % | 27.3-30.5 % | 2026-11-17 |
| Any | full-size | not measured | not measured | |

The details of each measurement follow.

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
- **Master limiter and gate** (#59) [device, XS dev card, build `9543ec4`, 2026-11-17]: both on,
  mixer page, mic muted, two 30 s readings: 57.3 / 56.5 % mean, 30.5 / 27.3 % worst block left,
  against 60.4 / 31.1 % without them. So ~3-4 points of mean headroom; the worst block stays in the
  run-to-run spread. 10 s readings right after `on` showed 21-23 %: their window still held
  dspserver's start, so only readings ≥22 s after `on` count.

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
