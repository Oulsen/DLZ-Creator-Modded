# glesgui and Weston (display)

Owned by package `glesgui` 1338. All [static] unless tagged.

## glesgui (`/usr/local/bin/glesgui`, 42 MB)

A **dumb Canvas2D renderer**: the UI logic lives in `/srv/app.js`, glesgui only paints.

- C++, stripped; GLFW 3.4 (Wayland/X11/EGL backends), NanoVG on GLES2, libhv HTTP/WebSocket
  server, nlohmann::json. libstdc++ linked statically. Window title "EvolveGUI".
- Compiled-in assets: fonts (Proxima Nova, Noto SC/KR, FontAwesome 5 Pro, MaterialIcons) and
  the DLZ_XS / DLZ_Creator PNGs.
- Input: **FIFO `/tmp/glesgui`** (it calls `mkfifo`), newline-separated JSON. Each frame is a JSON
  array of `{obj, call, args}` followed by `{"obj":"ctx","call":"drawFrame","args":[]}`.
  Implements Canvas2D calls (`fillStyle`, `strokeStyle`, `textAlign`, gradients, `drawSVG` ...);
  unknown calls log "unknown command: %s"; `setLineDash` is not implemented.
- Output: WebSocket server on **127.0.0.1:8011** sending touch as `DOWN_x_y` / `MOVE_x_y` / `UP_x_y`.
  The port is only confirmed from the app.js side.
- Runs as an **X11 client of XWayland**: fd 4 connected to `@/tmp/.X11-unix/X0`, no socket to
  Weston's `wayland-1` [device]. Touch path: Weston/libinput → XWayland → GLFW (X11);
  frames take the same detour back (XWayland → Weston composite). GLFW build string `3.4.0 Wayland
  X11 GLX Null EGL OSMesa`, libwayland-client/-cursor/-egl and libdecor are on the rootfs [static],
  and glesgui logs `Uses wayland: no` at start [device], so Mackie had the Wayland path in mind.
  Weston's socket is `wayland-1` (not the default `wayland-0`) and the unit sets only `DISPLAY`, so
  GLFW's Wayland attempt fails and it falls back to X11. **Native Wayland works but is not worth it** [device]:
  `WAYLAND_DISPLAY=wayland-1` (unit's other env, `chrt -f 20`; `systemd-run` rejects
  `CPUSchedulingPriority` here) gives `Uses wayland: yes`, no decorations (libdecor has no
  plugins), app.js reconnects and the UI is usable, but the main meter screen flickers and it did
  not feel faster. Gotcha: after such a run, the stock X11 glesgui hangs at "Opening
  GUI..." with its main thread at 100% CPU, also after a second restart; only a reboot fixed it.
  Touch-down to the new picture on the panel: see "Tap to screen" below.
- **Touch is polled on the wall clock** (#188) [static, disassembly; matches the device]: the
  function at `0x22264` reads `std::chrono::system_clock::now()` (`0xdba74`, `CLOCK_REALTIME`),
  skips the poll when less than 20 ms (by that clock) passed since the last one, else stores the
  time, reads the GLFW button and cursor state and sends it (`0x20d5c`, which drops a repeat of the
  same message). After the clock steps back, no touch reaches app.js for the length of the step,
  while frames still draw [device, 2026-10-28: 323 s back, touch gone ~5 min]. The mod points that
  one call at `steady_clock::now()` (`0xdbab4`, `CLOCK_MONOTONIC`, same return layout): file
  offset `0x12270`, `bl` `eb02e5ff` → `eb02e60f` (`sd-system/dlzmod-glesgui`, only on the stock
  hash, the card's copy only). With it, touch kept working through a 292.6 s step back [device,
  2026-10-28].
- **Nothing else waits on the wall clock** (#144) [static, disassembly + Ghidra on the dump; every
  `clock_gettime`, `gettimeofday`, `time`, timed wait and timer call in glesgui, dspserver and
  faderlink]. Besides the touch poll, glesgui reads `system_clock::now()` (`0xdba74`) in four
  places, three in `main` and one in the calibration gesture:
  - `main` (`0x15df0`) keeps the time of the last drawn frame (`0x1760c`) and, when app.js sent
    none for 251 ms, draws once on its own (`0x16d64`, the prebuilt `drawFrame` command). After a
    step back these extra frames pause for the length of the step (the picture stays, app.js's
    frames still draw); after a step forward one comes at once. It never blocks.
  - The calibration gesture (`0x1f318`, from the touch sender `0x20d5c`): corner taps less than
    400 ms apart are counted; a step at most restarts the count.
  - Everything else is monotonic (`clock_gettime(CLOCK_MONOTONIC)`, GLFW's timer,
    `pthread_cond_clockwait` with clock 1, `timerfd_create(CLOCK_MONOTONIC)`), relative
    (`poll`, `usleep`, `nanosleep`), or bookkeeping in the bundled libhv: log timestamps, the HTTP
    `Date` header, the file cache's expiry, the thread pool's idle mark, `srand(time)`. libhv's
    loop runs its timers on the monotonic clock and re-reads the wall clock when it disagrees with
    `time()`; its wall-clock (cron-like) "period" timers are never set up in any of the three. In
    faderlink and dspserver `htimer_add_period` is not linked (`cron_next_timeout`, `0x751d8` /
    `0x12ea30`, is only called from the timer loop's re-arm); glesgui has it (`0x5f23c`, next to
    `cron_next_timeout` `0x7274c`), but nothing branches to it or holds its address.
  - dspserver's QuickJS has a wall-clock timed wait (`Atomics.wait` with a timeout, `0x17efd8`,
    `CLOCK_REALTIME` + `pthread_cond_timedwait`), but its scripts (`mixergraph*.js`) use no
    `Atomics`, `Date` or timer; faderlink has no timed wait at all.

  So a step forward, the kind a start makes, stalls none of these programs.
- Side effects: a "Screen calibration gesture" runs `ts-calibrate.sh &` and
  `killall -STOP/-CONT /usr/local/bin/dspserver`; forces `/sys/class/drm/*/power/control` to `on`;
  writes `/tmp/thread_watchdog`.

### Tap to screen (#7)

**Read this first: the probe's flip numbers are too low** (#196) [device, XS, dev card at `bdc1510`, 2026-11-04, kernel
trace over 42 taps, 46 page frames]. `dev/tapprobe.py` takes the first flip after glesgui reads a page, and that is
usually the flip of the frame before it. Every "glesgui read → flip", "touch → flip" and `repaint-window` figure below
has this fault, as has the conclusion that the largest stage is in app.js. Measured instead, median ms for a tap:

| Stage | ms |
|---|---|
| Touch → glesgui reads the page | 60 |
| glesgui's CPU, read → GPU job | 16 |
| glesgui's job on the GPU | 75 (58 under 20 KiB, 77 over) |
| Xwayland's jobs after it, to their end | 42 (19 under 20 KiB) |
| Weston's composite | 5 |
| Wait for the vblank | 7 |
| **Touch → page on screen** | **~208** (min 118, over 40 KiB 236) |
| of which glesgui read → flip | 154 (the probe said 28) |

- **Every frame takes three Xwayland GPU jobs**, 18 ms in all, even an empty one (540 of 571 frames), then one Weston job
  of 4.6 ms; glesgui's own empty frame takes 4.6 ms. So nothing reaches the screen in under ~27 ms. A plain full-screen
  pass costs ~4.6 ms here, so a 75 ms page equals about 16 of them.
- **The three jobs** [device, trace, 527 frames]: always in this order, 4.9, 9.25 and 3.7 ms, whatever the frame shows, so
  whole-window passes and not drawing. glesgui's window (`EvolveGUI`, 1024x600) has depth **24**, and Weston's window
  manager has it inside a frame window of the same size with depth **32** [device, `xwininfo`]. Shared buffers are mostly
  32-bit (2.49 MB), Weston's scanout 16-bit (RGB565). glesgui asks for 5/6/5 and gets a 24-bit visual. Likely chain
  [guess, from how Xwayland and Composite work; job-to-step not proven]: Present copies the frame into the window; the
  depth mismatch makes X composite the window into its frame (the 9.25 ms job); Xwayland copies that into the buffer
  it gives Weston. Routes that would drop jobs: native Wayland (no Xwayland at all, see above: flicker, a hang after it,
  never timed), or a 32-bit window for glesgui, which may drop the middle job or more; both untested.
- **Native Wayland, timed** (#196) [device, XS, 2026-11-04, RAM-only drop-in in `/run`, 31 taps, 29 pages]: no Xwayland
  jobs at all. Touch → page on screen 208 → **184 ms** median, glesgui read → flip 154 → **120**; by size read → flip
  under 20 KiB 109 → 131 (8 pages only), 20-40 KiB 153 → 112, over 40 KiB 163 → 129. So ~30-35 ms on bigger pages, not
  more: the page's own GPU job stays ~70 ms and is now the largest stage by far. An empty frame costs ~8 ms of GPU
  against ~27. This is also the most a window change could save. `WAYLAND_DISPLAY` alone keeps X11: GLFW needs
  `XDG_SESSION_TYPE=wayland` and `UnsetEnvironment=DISPLAY`. The meter screen flickers and blacks out after a while,
  and is clean for a couple of seconds after a tab switch; other pages look fine, touch and audio work [user]. Fits
  partial frames drawn on buffers without the last picture: `main` replays commands only for the first frames [guess].
  **It crashed**: glesgui died with SIGSEGV 4 m 23 s into that run, in the system log, cause not known; `Restart=always`
  brought it back. The earlier hang of X11 glesgui after a Wayland run did not show: a power cycle gave a normal start.
- **The page's GPU cost, the shader** (#196) [device, XS, 2026-11-04, `LIMA_DEBUG=pp` and `MESA_SHADER_CACHE_DISABLE=true`
  in a `/run` drop-in; without the second Mesa loads the compiled shader from `/root/.cache/mesa_shader_cache` and prints
  nothing]: glesgui has one NanoVG fragment shader (`EDGE_AA`), compiled to 49 Mali PP instructions. The branches stay
  real branches, so the first idea, that each pixel pays for every path, is wrong. But 20 of the 49 run before the first
  branch, for every pixel of every fill: scissor test and edge mask, ~25 on a solid fill by reading the blocks. A rough
  sum fits the 70 ms: 0.6 Mpixel × ~25 instructions at 408 MHz is ~37 ms for one screen's coverage, more with overdraw
  [guess: cycles per instruction, overdraw and how many of the PP cores work are not measured]. So what costs is the
  per-pixel work of the common solid fill. Idea, untested: a shorter path in the shader text for solid fills without a
  scissor, a patch of a text in glesgui. Turning `EDGE_AA` off is a one-constant route but would lose edge smoothing.
- **Edge smoothing off, timed** (#196) [device, XS, 2026-11-04, a copy in `/dev/shm` (`/run` is `noexec`) with one byte
  changed: the `1` for `0x1d408` at `0x161dc`, file `0x61dc`, 31 taps, 35 pages against 46]: the page's GPU job 75 → **56 ms**,
  touch → page on screen 208 → **193 ms**, by size under 20 KiB 169 → 185, 20-40 KiB 210 → 190, over 40 KiB 236 → 210 (the
  small-page group differs in mix; its GPU job stayed 56-58). The screen looks the same at a glance but worse up close [user], so not to ship as it is. So
  the edge mask is ~25 % of a page's GPU job, not most of it; memory available fell 139 → 90 MB with the copy in RAM.
- **Overdraw of a full redraw** (#196) [sandbox, each draw call painted additively, one channel per kind, 2026-11-04]: mean
  layers per pixel Overview 2.42, Channel 1.99, FX 2.74, Media 2.32, Snapshots 2.30, Pads 1.66. Nearly all fills (strokes
  0.00-0.03, text 0.01-0.03). The GPU times fit ~32-35 ms per layer of the screen [guess: page sizes and pages only roughly
  matched]. Largest fills: every page but Channel a black `fillRect` of 70-77 % of the screen, on top of what the last page
  left, needed unless something cheaper erases it; plain copies on top of one another: FX two black ~70 % fills, Snapshots
  two #141414 ~48 %. Each such layer would be ~20-25 ms on the GPU [guess].
- **Duplicate fills removed, timed** (#196) [device, XS, `2e470b4`, 53 taps, 55 of 55 page frames matched, pages told apart
  by frame size]: `DLZMOD_bgNeeded` leaves out a list's or FX panel's background during a full redraw. GPU job, before →
  after: 14 KiB 80 → 70 ms, 19 KiB 103 → 89, 20 KiB 83 → 75; pages it does not touch stayed put (21 KiB 77, 27 KiB 69, 44 KiB
  79-80, 61 KiB 99-100), so the change is real and the method holds. That is 8-14 ms, about 20 ms for a whole layer of plain
  fill and not the 32-35 above: a page's cost is more than its layers, and the sum over page sizes is only a rough
  guide. Overview, the 61 KiB page, is the slowest at ~100 ms. The screen looks the same [user].
- **Overview replayed, part by part** (#196) [device, XS, `2e470b4`, 2026-11-04; app.js paused, one frame from the sandbox
  (1099 calls, 55 KiB; the mixer's Overview 1205 calls, 61 KiB) and parts of it written to `/tmp/glesgui` 5 times each, GPU
  job from the trace, repeats within 0.2 ms]: `clearRect` alone **23.2 ms**, one full-screen `fillRect` 23.2, four 82.4, whole
  Overview 96.2, without `clearRect` 76.4, without text 93.8, without rectangles over 5000 px 52.1, text with `clearRect` 25.7,
  small shapes alone 29.7. So a full layer is ~20 ms over a base of ~3.5, and **`clearRect` is one such layer in every full
  redraw**, on every page (`UI.clear`, `(0,0,1024,600)`). Overview: base 3.5, clear 20, big rectangles 44, small shapes 26,
  text 2.5. Text is cheap on the GPU but not on the CPU: glesgui's read → GPU job 36 ms, without text 27.
- **The clear removed, timed** (#196) [device, XS, `7d42a22`, 53 taps, 51 of 52 page frames matched, by frame size]: GPU job and
  glesgui read → flip, before → after: 14 KiB 80 → 51 and 147 → 119 ms, 19 KiB 103 → 69 and 172 → 134, 20 KiB 83 → 55 and 160
  → 132, 27 KiB 69 → 49 and 142 → 120, Overview (61 KiB) 99 → 79 and 193 → 182. Median of all pages, whose mix differs: touch →
  page on screen 210 → 197 ms. No pixel changed on 11 screens with magenta painted under the redraw and the clear left out,
  against a control that showed magenta on all of them [sandbox]; the screen looks the same [user]. The strips kept their
  background in that build: the Overview's is a colour of its own (`DLZMOD_ovColor`), so a plain compare said they differ.
- **Each full redraw is two GPU jobs** (#196) [device, XS, `3fe4267`, 33 taps]: the page's, and one of ~24 ms, which is one
  full layer, on every page before and after these patches. The order varies, so take the larger of the two jobs after a
  page read, not the first. Page job before → after all patches: 14 KiB 80 → 51, 18 KiB 103 → 69, 20 KiB 83 → 55, 26 KiB 69 → 49,
  Overview (60 KiB) 99 → 63 ms; the second job stays. It fits `clearFg`'s `fctx.clearRect(0,0,w,h)` in `UI.clear`, the
  overlay's clear [guess, not proven]. Only 5 of the 8 strips left out their background; the other 3 not looked at.
- **No cheap erase in glesgui** (#196) [static, every `bl` in `.text` to the imported stubs]: `glClear` has two calls, once at
  start and once in the calibration gesture (`0x1f318`), none per frame, and `glScissor` has none, so clips run in the
  shader. So a page can only be erased by painting it, through that same shader. `clearRect` and `fillRect` are not plain
  strings in glesgui and their handlers were not found; replayed, `clearRect` paints a full layer (above).
- The page's flip is inferred: the first flip after the Weston job that follows the three Xwayland jobs [device, by
  order; the trace does not show pixels]. 46 of 46 page reads met a heavy glesgui job within 60 ms, 74 heavy jobs in all.
- GPU busy 39 % over the capture: Xwayland 21 %, glesgui 12 %, Weston 6 %. The clock is fixed at 408 MHz, no devfreq
  [device], so no raised clock to be had. No GPU queue in front of pages (median 0).
- **How**: `lima:lima_task_submit`, `gpu_scheduler:drm_run_job`, `drm_sched_process_job`,
  `drm:drm_vblank_event_delivered`, `trace_clock` `mono`, in RAM only. Read the buffer **before** setting the clock back:
  writing `trace_clock` empties it. Kernel 5.10.197-sunxi has no uprobes. Private data: `build/device-logs/196-trace2.*`.

The screen follows a tap 60-190 ms later (to the page flip) while the knob LEDs change at once; same
on stock. No
stage is stuck or busy, the screen's path is just long. Work on it: #196.

- **Stages** [device, 16 tab switches]: touch-down → app.js writes the page 28 / 56 / 92 ms (min /
  median / max); glesgui reads it within 4 ms; glesgui read → page flip 24 / 41 / 104 ms; **touch-down
  → flip 60 / 92 / 188 ms**, growing with the page (14-20 KiB 60-104 ms, Overview's 61 KiB
  168-188 ms). Not in it: scanout (≤16 ms), the LCD and the touch controller. The page goes out on
  touch-down, before the finger lifts. glesgui uses ~70-80 ms CPU for the biggest frame, Xwayland and
  Weston a tick or two.
- **Why the LEDs lead**: their colour (`K.N.color`) leaves app.js in the same page logic and takes the
  short path hub → faderlink → fader board; the screen waits for app.js's next draw tick
  (`NODE_FPS` 30), glesgui's drawing, XWayland, Weston's composite (rotate-180) and the flip [static;
  the LED side not timed].
- **Ruled out**: CPU shortage or a stuck process [device]; draw calls only some pages use (`clip`,
  gradients, `drawImage`: all tabs feel the same) [user]; frame size alone (the keyboard popup is an
  85 KiB frame, bigger than most tab switches, and feels fine) [PC sandbox + user]; the screen
  showing each frame one frame late (static pages get no next frame for 1.5-3 s, yet the busy
  Overview does not switch faster and forcing a redraw with a knob changes nothing) [device + user].
- **The frame loop** (#196) [static, `main` `0x15df0`; Mesa 23.0.4, Xwayland 22.1, Weston 9, renderer
  "Mali400" (lima) [device]]:
  - Each turn: drain the non-blocking FIFO (1 MiB pipe, 2 KiB reads) into a queue of lines, poll
    touch (`0x22264`), parse every queued line into a JSON tree, run all its commands, and on the
    **last** `drawFrame` of the batch end the NanoVG frame, swap (`0xb03f8`), `glFinish`, begin the
    next frame; then `usleep(2000)`. So frames that arrive together already give one swap; a
    skip-to-newest patch would only save painting the older frames' commands.
  - `glFinish` runs on X11 only, after the swap: it delays the next turn (and touch polling), not
    the frame just swapped.
  - **GLX, not EGL**: the program links only `libGL.so.1` and asks for a 2.0 context with GLFW's
    default API, on RGB565. It sets swap interval 1 (`0xb0454`). A swap therefore goes through
    Mesa's GLX path, where `vblank_mode` applies, and Xwayland holds the frame for its next tick
    [guess, from how Mesa and Xwayland work; not measured].
  - On Wayland the window is single-buffered (the double-buffer hint is set off) and each frame's
    commands are kept and replayed after the swap. app.js draws only what changed, so a buffer
    that lacks earlier frames would show as flicker [guess]: this is the likely flicker of the
    native Wayland run above.
  - The two 1024x600 offscreen buffers (`DAT_028d0334`, `DAT_028d0338`) are for the overlay only
    ("Overlay ON"/"OFF"): the switch reads the screen back once (`glReadPixels`); normal frames draw
    straight into the window.
  - **The turn, in order** (#196) [static, `main`]: FIFO, touch poll, parse, commands, the swap's end (`nvgEndFrame`
    `0x56cc8`, swap, `glFinish`), `usleep(2000)`. Touch is polled once a turn, so while a frame is drawn and finished
    the poll waits for it, on top of its 20 ms gate. A lower gate therefore only helps on turns shorter than 20 ms.
  - **A frame of its own** [static]: when 251 ms or more passed since the last swap, each turn adds the `drawFrame`
    parsed at start, without any line from app.js, so glesgui swaps at least ~4 times a second. That sits badly with
    "no next frame for 1.5-3 s" above (flips of `plane-1`): an empty swap may give no new buffer [guess], not measured.
  - **Window** [static]: on X11 double-buffered (hint on), RGB565, 1 stencil bit asked, no multisampling; NanoVG made
    with the antialias flag alone, no stencil strokes (`0x1d408(1)`). Parsing is a SIMD JSON parser, whitespace skipped
    by vector compares, so parsing is an unlikely big cost [guess]. No `glClear` per frame; 25 of 33 taps were full
    redraws anyway (below). Whether a swap also copies the whole buffer back (`loader_dri3`) is not known [guess].
- **Weston** [static, `/etc/weston.ini`]: `repaint-window=15` (Weston's default is 7), so Weston
  composites ~2 ms after each vblank and a commit arriving later waits nearly a whole refresh.
- **Plan** (#196, nothing tried yet; gains are estimates [guess]): (1) `repaint-window` near 7, ~8 ms
  on every frame, if composite + rotate-180 still make the vblank; (2) `vblank_mode=0` in
  `glesgui.service.d/dlzmod.conf`, up to 16 ms; (3) the 33 ms tick: 60 ticks (below, not `NODE_FPS`), or cheaper, draw
  at once after a touch and leave meters at 30 (`$CFG.fps` also scales the meters' fall speed;
  `Util.FpsCtrl` calls `updater`), ~8-16 ms; (4) only if these fall short: touch poll below 20 ms,
  a one-constant patch beside #188's, ~5-8 ms (each poll may be an X round trip). Cheaper frames
  allow more than the spectrum's 10 fps (`DLZMOD_rtaTick`). `/etc/weston.ini` is not on the
  updater's allowlist; `weston-mackie.service.d:dlzmod.conf` is (a route for a config of the mod's own).
- **Replacement renderer, open again**: first rejected because it could win part of 41 ms at most, but that figure
  came from the probe's fault (see "Tap to screen"): glesgui read → flip is 154 ms. It would have to read the same
  FIFO and serve 8011 (so `app.js` stays), match ~100 Canvas2D calls and Mackie's fonts, satisfy dspserver's wait for
  `Xwayland` and `glesgui` processes, keep its own persistent picture for partial frames, turn the picture for the
  upside-down panel, and fall back to stock glesgui, because the screen is the mixer's only UI. Estimates [guess]:
  ~90-140 ms touch → page on screen, the low end only if the page's 75 ms GPU job shrinks.
- **Before/after for #196**: same two captures each time: 40 s with ~16 tab switches (Overview
  included), then 20 s on a channel's EQ page with EQ and spectrum on, music in, ~10 taps.
- **Baseline for #196** [device, XS, dev card at `1b20f09` (#236; `update-39` in `dlzmod-logs`),
  2026-11-04], min / median / max ms:

  | Capture | Touch → app.js writes | app.js write → glesgui read | glesgui read → flip | Touch → flip |
  |---|---|---|---|---|
  | Tab switches (25 of 28 taps used, 14-62 KiB) | 34 / 70 / 326 | 0 / 0 / 13 | 12 / 32 / 89 | 58 / 105 / 382 |
  | EQ page, spectrum on (12 of 12, 10-13 KiB) | 14 / 46 / 68 | 0 / 0 / 0 | 12 / 20 / 28 | 26 / 67 / 95 |

  Tab switches: pages of 14-27 KiB took 58-156 ms, 40-62 KiB 120-382 ms. The largest stage is before
  glesgui, in app.js, and no process is short of CPU (app.js 13 %, glesgui 5 %; with the spectrum
  29 % and 10 %). So step 3 of the plan acts on the larger stage; steps 1 and 2 only on the 20-32 ms.
  In the tab capture one flip followed each page read within 120 ms, so that flip is the page's.
  On the EQ page nearly all reads are pages by the probe's 4 KiB limit: the first read after a tap
  is taken as the answer to it, which its size supports (13 KiB, the spectrum's frames ~23 KiB)
  [guess]. Reading the debugfs state every 4 ms may slow flips a little (it likely takes the display
  locks [guess]): keep the probe the same for before and after.
- **60 frames, not `NODE_FPS` 60** (#196) [static]: `$CFG.fps` also sets the meters' constants, and
  several are per tick (`VUData`'s `VU_SPEED`, `VU_ACC`, the peak's): `NODE_FPS` 60 makes a full-scale
  fall 0.63 s instead of 1.27 s (simulated from those numbers). So `patch.py` leaves `$CFG.fps` at 30
  and only runs `Util.FpsCtrl`, the one call that paces `updater`, at 60. `updater` gives each tick its
  elapsed time in 30-fps frames (0.5 here), which all four `tick` methods use, so speeds stay; only
  `VUData`'s peak moved per tick, now patched to use it. The timer runs on app.js's own
  `requestAnimationFrame` fallback (at least 17 ms apart), so ~58 ticks a second at most. In a browser
  `$CFG.fps` is 60 already: no change there, so the sandbox cannot show this; only the mixer can.
- **After 60 ticks** (#196) [device, XS, dev card at `bb646cf`, 2026-11-04], same captures, total
  min / median / max ms: tab switches 38 / 90 / 477 (52 of 53 taps), EQ page 46 / 66 / 199 (12 of 12).
  Same page sizes, median before → after: 14-27 KiB 91 → 82 ms, 28 KiB and up 166 → 143 ms. On the EQ
  page no gain (touch → app.js writes still 46 ms) and two slow taps (164, 199 ms), one with 116 ms
  from app.js's write to glesgui's read (0 ms in all 12 taps before). CPU app.js
  21 % / 31 %, glesgui 9 % / 13 %, server.js 15 % / 18 % (tabs / EQ), with twice the taps on tabs. Small
  samples of the worst cases: one 477 ms tap, two on the EQ page; chance or load is open.
- **The touch path in glesgui** (#196) [static, `0x22264`, `0x20d5c`, `0x63bec`, `main` `0x15df0`]: no input
  thread. Once per turn of the main loop, at most every 20 ms by the wall clock, the poll runs
  `glfwPollEvents`, reads the button from GLFW's memory, asks for the cursor (GLFW's X11 path; `XQueryPointer`
  is in the program's X11 imports, so a wait for Xwayland's answer [guess]), and sends `DOWN_x_y` straight from
  that thread over the WebSocket, before the turn parses and draws. So a tap that lands mid-turn waits for the
  rest of it: parsing, painting, swap, `glFinish`, `usleep(2000)` (one to two 4 ms kernel ticks, `CONFIG_HZ=250`
  [guess on the length]). Every extra frame adds such turns, which would fit no gain on the EQ page at 60 [guess].
  app.js handles `DOWN` at once when the message arrives (`canvasWebsocket.onmessage` → `Events.eventPointerDown`,
  no debounce or timer) [static]; its share (page build, tick) is not split from glesgui's yet: the probe's
  loopback counter is for that. Fastest touch → app.js write 3-14 ms, median 46: the time looks like waits,
  not work [guess].
- **Where the first stage goes** (#196) [device, the five captures of 2026-11-04], min / median / max ms, split
  by app.js's first small write after the touch (its answer to the hub, so the touch has arrived [guess, supported
  by the noise: the same wait from a moment with no touch is 69-215 ms on the EQ page, 38-45 on tabs):

  | Capture | Touch → app.js reacts | app.js reacts → writes page |
  |---|---|---|
  | Tabs, 30 ticks (n=22) | 2 / 23 / 58 | 12 / 44 / 296 |
  | Tabs, 60 ticks (n=40) | 2 / 21 / 49 | 12 / 47 / 184 |
  | EQ, 30 ticks (n=10) | 15 / 24 / 41 | 12 / 26 / 44 |
  | EQ, 60 ticks (n=9, n=7) | 14 / 24 / 35, 15 / 23 / 46 | 12 / 20 / 32, 12 / 14 / 28 |

  So ~23 ms before app.js in every capture, whatever the ticks: glesgui's polling and what lies before it. On
  tabs the largest share is app.js's own 44-47 ms, which 60 ticks did not change, so it is the page build. A
  second EQ run at 60 ticks gave touch → flip 44 / 55 / 77 ms, no slow tap: the 164 and 199 ms above did not
  come back, so load is not shown as their cause. The loopback packet counter is no use for this: its
  noise equals the wait (45 changes a second).
- **A tab switch in app.js** (#196) [sandbox: Chrome CPU profile, 36 switches over the six tabs, CPU slowed 20x;
  a real canvas, not the mixer's draw stream, so proportions only]: the tap's handler (`Events.mouse`, mostly
  `setPage`) ~22 ms, then the next tick's `_drawAll` ~75 ms, about 3.4 times as much. `setPage` only queues
  `drawAllQueued`; `updater` then repaints every visible widget, so each tab switch sends a full screen, and
  page size drives glesgui's parse and paint too. Nearly all of `_drawAll` is the widgets' own `paint` and
  `internalUpdate`, no single hot spot. The sandbox's meter ticks (`parseVuData`, `btoa`) are its fake feed.
- **A tab switch, stage by stage** (#196) [device, XS, spike `9a16a7e` at 30 ticks, 33 taps, app.js's own clock
  joined to the kernel's touch time], min / median / max ms:

  | Stage | ms |
  |---|---|
  | Touch → app.js gets it (panel, Weston, Xwayland, glesgui's poll) | 4.8 / 17.4 / 35.7 |
  | app.js's handler | 2.6 / 12.5 / 63.8 |
  | Handler's end → the tick starts | 0.3 / 3.4 / 26.8 |
  | Paint (widgets into draw calls) | 6.3 / 17.6 / 81.9 |
  | `JSON.stringify` of the frame | 1.4 / 3.0 / 17.4 |
  | Write | 0.9 / 1.4 / 19.8 |
  | Touch → written | 24 / 64 / 179 |

  Then glesgui read → flip ~28 (probe, same capture; touch → flip 44 / 93 / 265). So no one stage rules. The
  tick wait is small because the handler runs inside it: that is why 60 ticks gained so little. 25 of 33 taps
  were full redraws, 172 / 408 / 1205 draw calls, 8.8 / 20 / 61 KiB. By size, median paint: under 15 KiB 10 ms,
  15-30 KiB 17 ms, over 30 KiB 41 ms, with JSON 2 / 3 / 7 ms: big pages cost in paint, ~55 µs a call.
- **What a full redraw is made of** (#196) [sandbox: native canvas calls hooked during `_drawAll`, state followed
  through `save`/`restore`; Overview 1285 calls against 1205 on the mixer, so the count holds]: Overview 1285, Channel
  1068, Pads 960, Media 512, FX 460, Snapshots 363 calls. Sets that change nothing: only 6-12 % (Overview 129), so
  skipping them would save ~7 ms of paint there at ~55 µs a call [guess], not the big win hoped for. The rest is real
  drawing, spread out: paths 10-39 % (Pads 378, rounded corners built from `lineTo` and `quadraticCurveTo`), `save` +
  `translate` + `restore` 8-16 %, text state 10-21 %. No sign of a one-call rounded rectangle among glesgui's strings
  (only a plain search, its command table not read).
- **`repaint-window` 7, tried** (#196) [device, XS, spike `9a16a7e`, `/etc/weston.ini` edited on the card, Weston's
  log confirms 7 ms, 31 taps against 33]: no gain. Median glesgui read → flip 28 → 26 ms, and by size 24.1 → 23.7
  (14-28 KiB) and 47.8 → 47.8 (over 28 KiB); touch → flip 93 → 94 ms. The meters looked as before [user]; missed flips were not measured. Undone. So that
  stage is not spent waiting for Weston's composite: the ~8 ms estimate was wrong. It grows with the page, so the
  work is more likely glesgui's parse and paint [guess].
- **Panel**: 52 MHz, 1360 × 635 timing in `/etc/weston.ini`: ~60.2 Hz, 16.6 ms a refresh [static].
- **How to measure**: `bash dev/tapprobe.sh <seconds> <capture.csv>` (Git Bash; a confirmed command,
  `python` is not on the SSH wrapper's read-only list). Start it when someone is at the screen: a
  capture without taps gives no stage times. A read-only Python script sent over SSH (nothing written on the mixer),
  polling every 4 ms: touch-downs (`BTN_TOUCH` on `/dev/input/event1`, 16-byte `input_event` on armhf),
  app.js `wchar` and glesgui `rchar` in `/proc/<pid>/io` (`wchar` also counts app.js's hub traffic),
  utime + stime per process, and the page flip: `plane-1`'s `fb=` in
  `/sys/kernel/debug/dri/3/state` (sun4i-drm; `dri/0-2` are vgem, vkms and lima) changes to another
  of Weston's buffers on each flip. A flip shows no content, so the first flip after glesgui's read
  is taken as the new page. In the sandbox, wrapping `app.ctx`'s methods counts the draw calls per
  frame (a tab switch is one frame, 26-99 KiB) [PC sandbox].

### Bad starts after a software restart (#81)

Before #140, a start after a software restart often went wrong; after the switch on the back less
often, but on the dev card not rarely either. Three shapes, maybe one cause. With #140's change a
series of software restarts went through without one (counts below), so the software restart is no
longer a reliable trigger.

- **Counts** on the mod card [device] (cold vs warm from the clock lines, system.md, Clock):
  software restarts 6: 2 fine, 1 GUI stall, 3 frozen. Starts with the switch ~15 (incl. 4 with
  Wi-Fi off and 9 older boot logs): 1 GUI stall, 1 frozen, the rest fine. Later, on v0.2 builds,
  3 more frozen starts with the switch on the dev card (starts not counted), and a fresh v0.2.0 card
  hung in its 2nd of 3 starts. Stock from the eMMC, started with the switch: once or twice in two
  years of use, by the user's account.
- **v0.2's own paths are not needed for a hang** [device]: that fresh card had never had an update,
  upload or Wi-Fi, and no recordings folder (so no read-write remount and no #98 read-only remount
  at start), and hung anyway. What it ran at start is what v0.1.0 runs too, and stock [static].
  Whether v0.2 makes the later freezes more likely is open.
- **Frozen** [device]: the syslog stops mid-boot (~13-45 s in, cut mid-line, NUL bytes after it)
  although the mixer runs on for minutes: ping answers, sshd accepts but drops logins during the key
  exchange, the screen shows the spinner or a UI without touch, then the spinner stops. The SD card
  is set up the same on warm and cold starts ("high speed SDXC", no UHS); no MMC or I/O errors
  before the cut. Where the syslog stops is not when it froze: the last ~10-40 s never reach the card
  (system.md, "Filesystem and persistence"); a start that hung after its boot log copy (10.4 s)
  left no line at all.
- **Spinner stops and stays** [device]: the boot spinner stops turning and stays on screen, nothing
  follows. In a good start Weston takes the display over right after the boot log copy (~10 s) and
  needs ~6.6 s to load its GL renderer and bring up the Mali-400 before it draws [device]. So this
  hang sits at Weston's GL/GPU start, the kernel's spinner stopping when Weston takes the display
  [guess]; the frozen start whose log
  ended as Weston started, the GUI stalls (GL context creation) and glesgui's "Failed to init
  OpenGL" at ~11 s on a full-size (open-questions.md, 35) point the same way [guess].
- **GUI stall** [device]: between glesgui's "Graphics initialised. Opening GUI..." and "Context
  renderer string" (GLFW creating its X11 window and GL context through XWayland). Normally 1-3 s
  apart; in a stall 90 s (then it went on by itself and the UI came up) or more than 2.5 min.
  Fingerprint while it stalls: glesgui has 3 threads instead of 4 (no libhv epoll thread), port 8011
  is not listening, so node logs `[WS TO GLESGUI] CONNECTING` every 3 s; the main thread is `R`,
  `/proc/<tid>/syscall` reads `running`, more system than user time, and over 3 s it took ~11,500
  minor and 48 major page faults, ~600 reads and ~500 voluntary context switches: busy, not frozen.
  SSH logins can fail during the key exchange while it lasts. No strace/gdb/perf on the rootfs.
  A third stall on the XS dev card (v0.3.0-dev, a start with the switch, right after a start that
  stuck on the spinner and left no line): "Opening GUI" at ~17 s, no context in the 2.5 min until it
  was switched off; everything else came up (dspserver, the audio chips, node, the boot report:
  no failed or restarted mixer service) [device]. A fourth on the same card (the first start after a
  chkdsk of DLZDATA, no SSH login during it): "Opening GUI", then a clock step at ~33 s, no context
  until it was switched off; the next start came up [device].
- **A freeze after the UI was up** [device]: the start that installed a drop-in update showed the UI,
  then froze (screen stuck); its syslog on the card ends at ~60 s, at an SSH login, with no error
  line (no I/O error, OOM or hung task), and a second login at ~130 s stalled. Another shape than the
  GUI stall; whether the login triggers it or only coincides, the card's log cannot say.
- **Cause of the frozen shape: real-time starvation (#140)** [device]: glesgui and both node
  processes run `SCHED_FIFO` 20 (system.md, "Scheduling"), with no time kept back for normal
  processes, and glesgui waits for its window with `sched_yield`, which only gives way to other
  real-time tasks [static]. In a frozen start with the switch the network log went silent after
  "Opening GUI" at 32 s: for 5.5 min almost nothing else ran (systemd, the log, NetworkManager, the
  mod's DLZDATA remount; faderlink's websocket timed out), ping answered; in the second glesgui got
  its context (377 s) everything went on. Its main thread had used ~65 % of a core over that run.
  With the three units at normal scheduling (nice -20 kept, dspserver unchanged), counted on the dev
  card with the switch, no SSH: before 9 starts, screen at 34-37 s, 1 slow (47 s), 1 GUI stall
  (130 s, the rest of the system ran: not starvation), 1 frozen (377 s); after 10 starts, screen at
  29.4-31.2 s, 1 start whose log stopped right after the context at 31 s (not known whether it froze
  or only the log stopped; switched off after ~1.5 min). dspserver's "Watchdog triggered" lines
  dropped from 8-10 per start to 1-6. 25 more starts with the change (network log, #141's in 15 of
  them): screen at 25-33 s in 24, one GUI stall (screen at 241 s, the start after one that installed
  an update) with no SSH login at all during it, so not caused by one; the logins in these starts all
  came at 168 s or later [device]. The tools now log in 30 s after the screen (#143).
  Then a series on the dev card with the change, mixer idle, network log: 10 software restarts
  (`systemctl reboot` over SSH, ~3-9 min apart) and 6 with the switch, all fine: screen at 25-26 s,
  UI connected at 28-32 s, systemd's start finished at 2 min 24.7-26.5 s; no stall, no freeze
  [device]. Before the change the same software restart froze 3 of 6 starts.
- **Lead for what is left** [guess]: a software restart leaves the GPU/display, touch, the USB Wi-Fi,
  the USB audio chip and the FPGA side powered, so something starts in a state a cold start never
  gives it; the GPU, given the GL/GPU start above, first of all. The
  rare cold-start cases say it is not only that.
- **Not the trigger on its own** [device]: chrony stepping the clock while glesgui opens its
  window. All four GUI stalls had a step in that window (the third: +4.2 days at 32.8 s, while
  stalled; the fourth: at ~33 s, after "Opening GUI"), but a cold start with a +234 s step in the
  same window went through normally, and so did the start right after the third stall (step at
  37.8 s, after the context at 30.4 s) and a start with the step at 32.4 s, 0.2 s before "Opening
  GUI" (context at 33.5 s); a step adding to it is not ruled out. In the 9 starts before #140's
  change, the slow ones were those with the step ≤1.3 s before "Opening GUI" (4 of 5), the good
  ones ≥1.6 s before (4 of 4); with the change the context comes before the step in 9 of 10.
  No wall-clock wait in glesgui, dspserver or faderlink explains it (#144, "Nothing else waits on
  the wall clock" above): the steps at the start go forward, and the only waits a step can lengthen
  need a step back. So the correlation, if real, works through something else, outside these
  three programs (Xwayland/Weston, app.js under node, the load around the step) [guess]. Testable
  only if starts stall at the screen again (none since #140, and since #1 the step is only as long
  as the mixer was off): hold chrony's step back until the context is there, then count stalls.
- **If one comes back**: the dev card's journal reaches the PC as it happens, the whole start from
  the kernel's first line, without a login (`dlzmod-netlog`, `dev/netlog.sh`; the kernel has no
  netconsole) [device]; a start that hangs is left alone a few minutes (ping, does the log go on?),
  then read in the network log.

### Mod angles

- Change what is drawn: patch app.js, not glesgui. The one-instruction patch (#188, above) is the
  exception: a fixed instruction, checked against the stock hash before and after.
- Your own renderer/overlay: a process can write to the FIFO (if app.js is stopped) and serve 8011.
- Capture the full draw-call list live (tee the FIFO) before relying on it.

## Weston (`weston-mackie.service`)

- `weston -c /etc/weston.ini --tty 7`, DRM backend, `rgb565`, `xwayland=true`
- Output `LVDS-1`, 1024x600 @ ~60 Hz, `transform=rotate-180` (panel is mounted upside down)
- Background `/etc/dlz.png` (the "later splash"), shown until glesgui draws
- libinput `touchscreen_calibrator=true`, helper `/usr/local/bin/save-calibration.sh`
  (writes `LIBINPUT_CALIBRATION_MATRIX` to `/etc/udev/rules.d/touchscreen.rules`)
- Env for both: `MESA_LOADER_DRIVER_OVERRIDE=sun4i-drm`, `XDG_RUNTIME_DIR=/run/user/0`
- Its first step `ExecStartPre=/bin/chvt 7` is not a fixed wait: started at ~9 s (stock order) it
  ends at 16.8-19.8 s; started at 12.5 s it ends at 19.3-19.6 s; started at 21.5 s it took 2.3 s
  [device: network logs and the #96 spike]. So ordering Weston after the mod's update step
  (`After=dlzmod-update.service`, #96) does not move the mixer view (26.9-27.3 s)
- Until Weston takes the display, the panel shows `/dev/fb0` (`sun4i-drmdrmfb`, 32 bpp, 1024x600,
  virtual 1024x1800, fb row 0 at the bottom of the upside-down panel): with the bootsplash `off`,
  whatever is drawn there stays on screen [device: #96 spike]

## Boot visuals (in order)

1. Kernel bootsplash `/usr/lib/firmware/bootsplash.armbian` (in the initrd), see [hardware.md](../hardware.md).
   Can only draw its pictures: a 640x260 logo picture centred on screen plus the spinner animation.
2. Weston background `/etc/dlz.png`: shown whenever glesgui is not drawing, not only at boot
3. glesgui UI

Reading a frozen screen: **logo during use** = Weston is alive but glesgui is not running (crashed,
or gave up after 5 restarts in 10 s); **last UI frame frozen** = glesgui is alive but app.js stopped
sending frames, or the whole system hung (no watchdog reboots it, see system.md) [guess: from the
draw path and unit settings, not yet seen on the device].

The bootsplash and both PNGs belong to the `glesgui` package, so an update restores them. Our SD
builds replace 1 and 2 with the mod design (see the modding guide, "Version and boot visuals").
