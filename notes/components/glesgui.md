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
  Touch-down to app.js's next frame: median 52 ms [device].
- Side effects: a "Screen calibration gesture" runs `ts-calibrate.sh &` and
  `killall -STOP/-CONT /usr/local/bin/dspserver`; forces `/sys/class/drm/*/power/control` to `on`;
  writes `/tmp/thread_watchdog`.

### Bad starts after a software restart (#81)

After a software restart the start often goes wrong; after the switch on the back rarely. Two
shapes, maybe one cause; why is not known.

- **Counts** on the mod card [device] (cold vs warm from the clock lines, system.md, Clock):
  software restarts 6: 2 fine, 1 GUI stall, 3 frozen. Starts with the switch ~15 (incl. 4 with
  Wi-Fi off and 9 older boot logs): 1 GUI stall, 1 frozen, the rest fine. Later, on v0.2 builds,
  3 more frozen starts with the switch on the dev card (starts not counted), and a fresh v0.2.0 card
  hung in its 2nd of 3 starts. Stock from the eMMC, started with the switch: once or twice in two
  years of use, by the user's account.
- **Not caused by v0.2's own paths** [device]: that fresh card had never had an update, upload or
  Wi-Fi, and no recordings folder (so no read-write remount and no #98 read-only remount at start);
  it ran only what v0.1.0 also runs at every start, and stock.
- **Frozen** [device]: the syslog stops mid-boot (~18-40 s in, cut mid-line, NUL bytes after it)
  although the mixer runs on for minutes: ping answers, sshd accepts but drops logins during the key
  exchange, the screen shows the spinner or a UI without touch, then the spinner stops. The SD card
  is set up the same on warm and cold starts ("high speed SDXC", no UHS); no MMC or I/O errors
  before the cut. Where the syslog stops is not when it froze: the last ~10-40 s never reach the card
  (system.md, "Filesystem and persistence"); a start that hung at ~11 s left no line at all.
- **Spinner stops and stays** [device]: the boot spinner stops turning and stays on screen, nothing
  follows. In a good start Weston takes the display over right after the boot log copy (~10 s; the
  kernel's spinner stops then) and needs ~6.6 s to load its GL renderer and bring up the Mali-400
  before it draws. So this hang sits at Weston's GL/GPU start [guess]; the frozen start whose log
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
- **Lead** [guess]: a software restart leaves the GPU/display, touch, the USB Wi-Fi, the USB audio
  chip and the FPGA side powered, so something starts in a state a cold start never gives it. The
  rare cold-start cases say it is not only that.
- **Not the trigger on its own** [device]: chrony stepping the clock while glesgui opens its
  window. Both GUI stalls had a step in that window, but a cold start with a +234 s step in the same
  window went through normally; a step adding to it is not ruled out.
- **Next**: a log that survives a freeze: every syslog line written through to the card at once
  (dev card only, for the card's wear) or the kernel log over the network (netconsole); then starts
  with the switch until one hangs. After that, software restarts with single parts reset first.

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
