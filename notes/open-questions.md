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
7. Which codec chips are on the XS board (AKM, Everest, ESS Sabre)?
8. Which chip does USB audio to the PC: the FPGA or a separate bridge? (`lsusb -v` on the PC.)
   Known: it can show up under two identities, `0A73:003A` (normal, LOUD's driver) and once
   `0A4A:AC1E` (a standard USB Audio 2.0 device) [device]; neither ID is in any file on the rootfs,
   the FPGA bitstreams or the GD32 firmware [static], so most likely a chip with its own firmware
   [guess] (hardware.md). `lsusb -v` of both identities would name it.
9. Stock's media scan filters out `/` by lsblk's `mountpoint` column: is that column still in
   `lsblk -O` on the mod card? (Which `mmcblk` is which is answered: hardware.md, Storage.)
10. GD32 UART protocol and baud rate on ttyS2.
11. Which `/dev/mem` regions do dspserver/faderlink map?
19. How much CPU headroom does the DSP thread have (`top -H`, idle vs. all FX on)? Decides whether
    extra graph blocks (limiter, full Compressor/Deesser) fit.
20. Intercom: confirm on the device what `ctrl.intercom.X.X.enable` does from the UI (see
    components/mixergraph.md).
22. How many playback channels does the PC see on the XS USB interface (Windows sound settings /
    `lsusb -v`)? More than 4 would let the graph expose extra PC inputs.
23. Which faderlink fader-table entries do the XS faders send, and does faderlink read those keys
    back? (Capture on port 89 while moving each fader.)
24. Do `settings.brightness.screen/k/pad/button = 0` make the screen and LEDs fully dark? (For a
    sleep mode.)
25. Bluetooth module: chip, profiles (A2DP sink only? HFP?), and can it act as a source?
26. How does dspserver name the parts of a recording split at 2 GB?
29. Does a knob drive an own key? Set `K.0.key` to `dlzmod.test` over port 89, turn knob 1, and
    watch for value broadcasts or faderlink's "keyDataTransform not found". Decides whether mod pages
    (e.g. Philips Hue, #53) can use the hardware knobs.

## Storage: SD vs eMMC

28. Does running from the microSD cost anything that matters?
    - Measured in use [device, an installed card, SanDisk Ultra 128 GB, idle UI some 18 min after
      boot]: **the card is not a bottleneck**. Card busy (`io_ticks`) 32.7 s of ~1080 s since boot
      (3 %, nearly all during boot), 0.6 % over 5 s while running; boot read 326 MiB in 7771
      requests (~8.5 ms each), 4.9 MiB written since boot; `vmstat` wa 0, b 0; cores 0-2 4-5 % busy
      each, core 3 99 % (dspserver, by design); 104 MB available, no swap.
    - Boot (`systemd-analyze`) [device]: evolve-node starts at 14.1 s, dspserver ~6 s after; the
      "2min 20s userspace" is `systemd-networkd-wait-online` (2 min, nothing waits for it; stock has
      it too). The mod's own units on the critical path took ~4.9 s: grow-data 1.48 s (mount, look,
      unmount to find "already set up"), update 1.09 s (no package), bootlog 2.17 s (of which the
      unmount 1.25 s). Since then grow-data stops at once once `/var/lib/dlzmod/dlzdata-ready` is
      set (written when DLZDATA is set up): ~1.4 s. The boot log stays as it was (copied before
      the mixer software at every boot, ~2.2 s). Moving its copy after the start, into the
      server's mount, does not work: server.js mounts DLZDATA read-only (`ro,noatime`) and
      remounts it `rw` to write, and remounting it under the server could break a recording
      [static, server.js]. Stock never goes back to `ro` once a recordings folder exists (`rw` from
      the start on [device]); the mod does that, about 10 s after the last write (#98,
      [mod.md](mod.md), "Media back to read-only"). Expected: ~1.4 s off a normal boot [device: the next install]
    - Open: (B) a stopwatch from power-on to the UI and to sound, card in vs card out (stock from
      the eMMC, nothing touched); (C) only if B shows a gap: 10 s of 4 KiB random reads, O_DIRECT,
      read-only, on the card and on the eMMC (`python3` with an mmap-aligned buffer; mixer idle).
    - Background: the eMMC is 1.9x faster sequentially (43.6 vs 23.0 MB/s), but the slot's High
      Speed bus caps any card at ~23 MB/s, so an A1/A2 card is the cheap fix for random I/O. Running
      the mod from the eMMC would go against the first hard rule; its prerequisites would be a
      tested restore script, FEL confirmed, a UUID of its own for the eMMC copy and Mackie-updater
      guards on the main system

## Misc

15. Do the `HAVE_*` flags in app.js (e.g. `HAVE_STREAMING`, `HAVE_NDI_FULL`) unlock working features?
16. Where does `Recorded_Samples/` land on USB/SD media? (Recordings: `DLZ_Creator_XS_Recordings/`
    at the root of the medium, `DLZDATA` on a mod card [device]; see node-backend.md.)
17. Is the `srv_data.json` in the dump factory-fresh or from use?
18. Which USB controller is the external USB-A port on, and does U-Boot need VBUS enabled for it?
    (Only matters if we ever boot from USB, see hardware.md.) Also: how much current the port can
    supply, and whether a heavy load (bus-powered drive, phone charging) sags the board's 5 V.
31. What does a "frozen on the logo" crash look like from inside? Kill glesgui 6 times in 10 s on the
    SD system and confirm the logo stays while audio keeps running; after a real freeze, read
    `/var/log/syslog` and `kern.log` (persist on disk) for the cause (OOM, segfault, kernel oops).
    Known: in the freezes during a start (components/glesgui.md, "Bad starts after a software
    restart") the syslog stops before the cause, so a freeze needs a log that does not go through
    the card [device].
34. Why does a closed popup stay on the device's screen until the page below it draws again, when
    closing it clears the foreground layer and asks for a frame [static]? The mod works around it on
    the Mod page (modding-guide.md, "PC sandbox"); other quiet pages may show the same.
35. Why does `glesgui` fail its first start with "Failed to init OpenGL" (about 11 s in) on 2 of 3
    boots of a full-size's mod card, then start at systemd's restart [device: owner's logs]?
    Not seen in our XS logs. Full-size timing, or does that mixer do it from the eMMC too?

## Installer boot

33. Is the "half off" state (SoC rails off, GD32 still powered, button LEDs lit) harmful if it lasts
    long? The GD32 drives UART and SWD lines into an unpowered SoC (possible back-powering through
    the protection diodes) [guess]. Stock never powers off in software. The installer's normal
    endings never power off (they show "Safe to power off"); it reaches the state only through its
    45-minute safety timer (a hung installer), a U-Boot load failure (`boot.txt`) or nothing
    bootable (`bootcmd` ends in `poweroff`). INSTALL.md says to switch off at the back.
