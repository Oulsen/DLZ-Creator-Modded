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
