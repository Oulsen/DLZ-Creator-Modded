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
- Side effects: a "Screen calibration gesture" runs `ts-calibrate.sh &` and
  `killall -STOP/-CONT /usr/local/bin/dspserver`; forces `/sys/class/drm/*/power/control` to `on`;
  writes `/tmp/thread_watchdog`.

### Tap to screen (#7)

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
- **Decision**: settings first (#196): `NODE_FPS` 60 (the tick waits up to 33 ms) and `vblank_mode=0`
  for glesgui (may drop a vsync wait in its swap; unknown whether Mesa honours it on this EGL/X11
  path). A replacement renderer was weighed and left out: it could win part of the 41 ms at most, must
  match ~100 Canvas2D calls and Mackie's fonts, and the screen is the mixer's only UI.
- **How it was measured**: a read-only Python script piped over SSH (nothing written on the mixer),
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
  Testable: hold chrony's step back until the context is there, then count stalls.
- **If one comes back**: the dev card's journal reaches the PC as it happens, the whole start from
  the kernel's first line, without a login (`dlzmod-netlog`, `dev/netlog.sh`; the kernel has no
  netconsole) [device]; a start that hangs is left alone a few minutes (ping, does the log go on?),
  then read in the network log.

### Mod angles

- Change what is drawn: patch app.js, not glesgui.
- Your own renderer/overlay: a process can write to the FIFO (if app.js is stopped) and serve 8011.
- Capture the full draw-call list live (tee the FIFO) before relying on it.

## Weston (`weston-mackie.service`)

- `weston -c /etc/weston.ini --tty 7`, DRM backend, `rgb565`, `xwayland=true`
- Output `LVDS-1`, 1024x600 @ ~60 Hz, `transform=rotate-180` (panel is mounted upside down)
- Background `/etc/dlz.png` (the "later splash"), shown until glesgui draws
- libinput `touchscreen_calibrator=true`, helper `/usr/local/bin/save-calibration.sh`
  (writes `LIBINPUT_CALIBRATION_MATRIX` to `/etc/udev/rules.d/touchscreen.rules`)
- Env for both: `MESA_LOADER_DRIVER_OVERRIDE=sun4i-drm`, `XDG_RUNTIME_DIR=/run/user/0`

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
