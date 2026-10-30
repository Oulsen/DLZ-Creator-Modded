# Open questions

Things static analysis of the dump cannot answer; most need the running mixer. When one is
answered, the fact moves into the topic note with its tag ([device], [static], [guess]) and the
question is deleted here. The numbers stay stable (gaps are answered questions), so references
like "Q28" keep working.

## Live checks (read-only, over SSH)

SSH from the Mod page; the `mixer-ssh` skill wraps it and refuses writes. No load tests on the
running mixer: it has ~120 MB of free RAM, and a large copy over SSH has hung the screen.

```bash
ss -ltnp                                    # Q1: upgradedaemon's port
ls -la /tmp/glesgui; cat /proc/cmdline      # Q4, kernel args
systemctl list-units --type=service --state=running
lsblk -O | head -3                          # Q9: is `mountpoint` still in lsblk's -O output
journalctl -b -u dspserver | grep -i i2c    # Q6: does it look for the i2c scripts
```

## Network and protocol

1. Which port does `upgradedaemon` listen on, and is it reachable from the LAN? (Masked on the mod
   card; the question is about stock.)
3. Which keys/commands do dspserver and faderlink send to the hub? Capture with a port-89 client
   while moving faders, pressing pads, playing audio.
4. Is `/tmp/glesgui` a FIFO created by glesgui; full list of draw calls it accepts; does it send
   anything besides `DOWN/MOVE/UP` over 8011?
5. Does the System Lock (`lock` key) protect the web UI, or only the touchscreen?

## DSP and hardware

6. Does dspserver run `/root/post-i2c.js` (and the codec scripts) if present? Do the codec scripts
   replace or add to the built-in init? (The `sys.*` API is known statically, see dspserver.md.)
7. Which codec chips are on the XS board (AKM, Everest, ESS Sabre)? (The A40i's own codec is not
   one of them: `hardware.md`, SoC.)
8. Which chip does USB audio to the PC: the FPGA or a separate bridge? (`lsusb -v` on the PC.)
   Known: it can show up under two identities, `0A73:003A` (normal, LOUD's driver) and once
   `0A4A:AC1E` (a standard USB Audio 2.0 device) [device]; neither ID is in any file on the rootfs,
   the FPGA bitstreams or the GD32 firmware [static], so most likely a chip with its own firmware
   [guess] (hardware.md). `lsusb -v` of both identities would name it.
9. Stock's media scan filters out `/` by lsblk's `mountpoint` column: is that column still in
   `lsblk -O` on the mod card? (Which `mmcblk` is which is answered: hardware.md, Storage.)
10. GD32 UART protocol and baud rate on ttyS2.
11. Which `/dev/mem` regions does faderlink map? (dspserver: `0x01C00000`, 8 MB, incl. port I for its
    chip buses: `components/dspserver.md`.)
19. How much CPU headroom does the DSP thread have? Decides whether extra graph blocks (limiter,
    full Compressor/Deesser) fit. Not with `top -H`: `dspLoopThreadC3` keeps core 3 at ~99% and its
    work cannot be told from its waiting (`system.md`, "Load average"); needs a measure from inside
    the audio loop: `dev/dsp-headroom.sh` (a measuring copy of dspserver, dev card only; #5).
20. Intercom: confirm on the device what `ctrl.intercom.X.X.enable` does from the UI (see
    components/mixergraph.md).
22. How many playback channels does the PC see on the XS USB interface (Windows sound settings /
    `lsusb -v`)? More than 4 would let the graph expose extra PC inputs.
23. Which faderlink fader-table entries do the XS faders send, and does faderlink read those keys
    back? (Capture on port 89 while moving each fader.)
24. Do `settings.brightness.screen/k/pad/button = 0` make the screen and LEDs fully dark? (For a
    sleep mode.)
25. Bluetooth module (Actions ATS2853, `components/faderlink.md`): which profiles does Mackie's
    module firmware offer? On a phone, the mixer's Bluetooth settings show it (media audio / calls).
    Software and chip both say sink only, no connect-out to speakers or headsets. If it ever
    matters: list the module's commands by disassembling faderlink's BT message builder.
26. How does dspserver name the parts of a recording split at 2 GB?
29. Does a knob drive an own key? Set `K.0.key` to `dlzmod.test` over port 89, turn knob 1, and
    watch for value broadcasts or faderlink's "keyDataTransform not found". Decides whether mod pages
    (e.g. Philips Hue, #53) can use the hardware knobs.

## Misc

15. Do the `HAVE_*` flags in app.js (e.g. `HAVE_STREAMING`, `HAVE_NDI_FULL`) unlock working features?
16. Where does `Recorded_Samples/` land on USB/SD media? (Recordings: `DLZ_Creator_XS_Recordings/`
    at the root of the medium, `DLZDATA` on a mod card [device]; see node-backend.md.)
17. Is the `srv_data.json` in the dump factory-fresh or from use?
18. Which USB controller is the external USB-A port on (most likely USB1 or USB2, the SoC's
    host-only ports; USB0 is OTG and can be a host too), and does U-Boot need VBUS enabled for it?
    (Only matters if we ever boot from USB, see hardware.md.) Also: how much current the port can
    supply, and whether a heavy load (bus-powered drive, phone charging) sags the board's 5 V.
31. What does a "frozen on the logo" crash look like from inside? Kill glesgui 6 times in 10 s on the
    SD system and confirm the logo stays while audio keeps running; after a real freeze, read
    `/var/log/syslog` and `kern.log` (persist on disk) for the cause (OOM, segfault, kernel oops).
    Known: in the freezes during a start (components/glesgui.md, "Bad starts after a software
    restart") the syslog stops before the cause (its last ~10-40 s never reach the card), so a
    freeze needs a log written through at once or one that does not go through the card [device].
34. Why does a closed popup stay on the device's screen until the page below it draws again, when
    closing it clears the foreground layer and asks for a frame [static]? The mod works around it on
    the Mod page (modding-guide.md, "PC sandbox"); other quiet pages may show the same.
35. Why does `glesgui` fail its first start with "Failed to init OpenGL" (about 11 s in) on 2 of the 3
    boots that reached the GUI on a full-size's mod card, then start at systemd's restart [device: owner's logs]?
    Not seen in our XS logs. Full-size timing, or does that mixer do it from the eMMC too?

## Installer boot

33. Is the "half off" state (SoC rails off, GD32 still powered, button LEDs lit) harmful if it lasts
    long? The GD32 drives UART and SWD lines into an unpowered SoC (possible back-powering through
    the protection diodes) [guess]. The datasheet allows a GPIO input at most VCC-IO + 0.3 V
    (table 5-3), so with the SoC's rails off anything above 0.3 V is outside spec; whether it does
    harm is not stated. Stock never powers off in software. The installer's normal
    endings never power off (they show "Safe to power off"); it reaches the state only through its
    45-minute safety timer (a hung installer), a U-Boot load failure (`boot.txt`) or nothing
    bootable (`bootcmd` ends in `poweroff`). INSTALL.md says to switch off at the back.
