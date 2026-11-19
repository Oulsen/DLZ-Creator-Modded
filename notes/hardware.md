# Hardware and boot chain

The board, Mackie's device tree, the boot chain, the eMMC layout and the SD slot. The software on top:
[architecture.md](architecture.md) and [system.md](system.md). Confidence tags: see
[architecture.md](architecture.md).

## Hardware

- SoC: Allwinner A40i-H (R40 family), 1 GiB DRAM (U-Boot relocates near 0x7c000000). Reference:
  the A40i Datasheet rev 1.1 (Allwinner, 2018; linux-sunxi's copy, also in the Wayback Machine as
  `Allwinner_A40i_Datasheet_V1.1_cleaned.pdf`): limits per supply in tables 5-1/5-2, clocks in 5.8,
  thermal in chapter 6. It gives no current or power figures (section 5.10 refers to Allwinner).
  USB: three ports, USB0 OTG (host or device), USB1 and USB2 host only (EHCI/OHCI); its own audio
  codec (24-bit/192 kHz DAC), which the XS does not use for its audio path [static; guess: unused]
- FPGA: GOWIN (on the digital board), loaded at every boot by `flash-fpga.sh`
- MCU: GD32 (control surface), flashed over SWD with openocd by `flash-gd32.sh`
- Controls per model [device: XS; static and Mackie's photos: full-size]. Both send channel levels the
  same way (`slider.N`, [components/faderlink.md](components/faderlink.md), "Faders"):
  - XS: five channel knobs with end stops in the bottom row (1 Mic 1, 2 Mic 2, 3 = 3/4, 4 = 5/6,
    5 Samples); knobs 1-4 with mute and solo buttons, knob 5 with solo only [device]; no master control. Top right four endless knobs with
    light rings (`K.0-3`)
  - Full-size: nine faders (1-4 the mics, 5/6, 7/8, 9/10, Samples next to the pads, Master on the
    right). Top right five endless knobs with light rings (`K.0-4`)
- PMIC: X-Powers AXP221 on I2C @ 0x34 (U-Boot has a `poweroff` command for it; untested on this
  board [guess])
- Storage: ~8 GB eMMC = U-Boot `mmc 1` (SD slot = `mmc 0`); under Linux the eMMC is `mmcblk1` and the
  SD `mmcblk0`, also when booted from SD [device]. That is probe order (the DTB has no `mmc`
  aliases), so the installer and the mod find the eMMC by `device/type` = `MMC`, never by name.
  The eMMC's boot partitions `mmcblk1boot0/1` report an empty `device/type`; the kernel starts
  them read-only, and the mod's udev rule finds them through the MMC device above them
  (`ATTRS{type}`) [device]
- Display: 7" 1024x600 LVDS panel (`tbs,a711-panel`, `panel-lvds`, vesa-24), driven by the R40 TCON
  LCD, mounted upside down (Weston uses `transform=rotate-180`; the kernel splash is stored rotated).
  The pixels are not square (0.1506 x 0.1432 mm), so the UI shows 5.2 % wider than 1024:600 [device:
  photo measurement]
- Backlight: `pwm-backlight`, PWM0 on PB2 (polarity inverted), enable GPIO PB3 (active high)
- UARTs enabled: UART0 = ttyS0 (PB22/PB23: the kernel console, `console=ttyS0,115200` in `armbianEnv.txt`
  [static]; likely on the DEBUG header [guess]),
  UART3 = ttyS1 (Bluetooth module, an Actions ATS2853: [components/faderlink.md](components/faderlink.md)),
  UART5 = ttyS2 (GD32 control surface MCU), both used by `faderlink`
- No ALSA sound card: on-chip codec, I2S and SPI are disabled in the DTB; `dspserver` drives the
  audio hardware via `/dev/mem` DMA (see [components/dspserver.md](components/dspserver.md))
- Touch: Goodix GT911 on i2c1 @ 0x5d (ID 911, firmware 1060), mounted like the panel: raw
  coordinates are rotated 180° (screen x = 1023 - raw x, y = 599 - raw y) [device]
- Board has a UBOOT button (likely FEL, USB device mode, which would show up as VID 1F3A / PID EFE8:
  a last-resort recovery path [guess]) and internal USB0/USB2 connectors
- External USB-A port: Linux USB host, used for USB drives and the Wi-Fi stick [device]; a Wi-Fi
  stick while connected caused no over-current or disconnects [device]; its power budget is unknown.
  The USB port to the PC is not Linux (no OTG in the DTB)
- USB audio to the PC: normally `0A73:003A` with LOUD's driver (`loudusbaudio`, 14 channels)
  [device]. Once, after a software restart with the cable plugged in, it came up as `0A4A:AC1E` rev
  1.30, also named "DLZ Creator XS", class 01 / protocol 0x20 (standard USB Audio 2.0), which
  Windows' own driver could not start (code 10); replugging the cable gave `0A73:003A` again
  [device]. Neither ID is in any file on the rootfs, the FPGA bitstreams or the GD32 firmware
  [static], so the USB audio chip most likely has its own firmware [guess] (open question 8). Not
  seen again in 7 starts with the cable plugged in (6 with the switch, 1 software restart), with a
  watcher on the PC [device] (#88)
- **PI14 resets the USB chip** (#88) [device, XS dev card, 2026-11-19; a USB watcher on the PC
  polling every 0.5 s, 2 cycles timed against the pin log, 6 more against the restart's time]: the
  chip leaves USB ~0.4 s after PI14 goes low and is back ~0.6 s after it goes high, every time.
  dspserver drives PI14 (high at its start, low at its exit, `components/dspserver.md`), so every
  dspserver stop re-enumerates USB to the PC (~1.8 s gone), also through a faderlink restart
  (dspserver `Requires=faderlink`). Restarting evolve-node or glesgui (which only pauses dspserver)
  leaves USB alone. Each start of the mixer raises PI14 the same way [static], which fits the first
  sighting after a software restart.
  - **The identity it comes back with varies**: 3 `0A4A:AC1E` in 10 PI14 cycles that day. Two were
    the first cycle after a long run as `003A` (8 min after a cold start; ~100 min after a start),
    the third came 2.5 min after one of those, from the `AC1E` state. The 7 `003A` were cycles 1-10
    min apart, all from a `003A` state except one (from `AC1E`, 10 min). Whether the run time (or the
    chip's temperature) decides it is a [guess] on few cases; which unit restarted does not.
    Windows' code 10 on `AC1E`: its own `usbaudio2` driver fails on it, the composite parent starts.
  - `AC1E` stayed 30+ min without change once; one dspserver restart brought `003A` back. Another
    time it went back to `003A` on its own ~1 min after a dspserver start, without a replug (whether
    a PI14 cycle came in between is not known; `components/dspserver.md`, "A fifth silent start").
  - `AC1E` reports the same product string, revision 1.30, serial "no serial number" and audio class
    2.0 (protocol 0x20) as `003A` [device]: the same firmware under Ploytec's own IDs, not a
    bootloader [guess].
- The Windows driver is Mackie's `Mackie_USB_Driver_v5.70.0_setup.exe`, signed by Thesycon Software
  Solutions (their generic USB audio driver under Mackie's name) [device, 2026-11-11]. Without it
  Windows leaves `0A73:003A` in error. With it, on the XS: playback endpoints 1-2 and 3-4, recording
  endpoints 1-2 to 13-14 (seven stereo pairs). Playback 1-2 arrives on the mixer's computer channel
  (9/10); recording 1-2 carries the main mix, the computer channel included only with its mix-minus
  off; the other returns were silent with no mic in use [device, XS dev card, `dev/usbloop.py`,
  #257]. Windows lists playback 1-2 and 3-4 as two separate playback devices, so each can take its
  own app (Windows "App volume and device preferences") [device, XS, 2026-11-12]. The channel
  count comes from the USB chip's descriptor, so a driver cannot add playback channels (#279). The
  full-size's endpoints were not checked.
- USB descriptor of `0A73:003A` (UsbTreeView, XS, 2026-11-12) [device]: vendor ID `0x0A73` is
  Mackie's (registered as SYDEC N.V., a company Mackie bought; `usb.ids` lists it as "Mackie
  Designs"; "LOUD Audio, LLC" is only the manufacturer string), `bcdDevice` 1.30, one
  configuration, three interfaces (audio control, playback, recording), no DFU interface.
  Playback: the only standard streaming setting carries 4 channels,
  24-bit in 4-byte slots (512-byte isochronous packets, room for far more; the count is the
  firmware's choice); a host-programmable clock and a volume control (no mute) on that path.
  Recording: 14 channels. Both streaming interfaces also have vendor-specific alternate settings
  (2-10, one interrupt endpoint each, 64-512 bytes out, 128-1024 in) with no format or channel
  count; Windows' class driver ignores them, their purpose is unknown [guess: the chip maker's own
  transfer modes]. Nothing in it offers more than 4 channels from the PC.
- The driver's INF (`loudusbaudio.inf`, DriverVer 5.62.0 in the installed copy) covers 14 Mackie
  products under `0x0A73`, among them the full-size as "DLZ Creator" `0A73:0033` and the XS as
  `0A73:003A` [static].

### The USB audio chip (#279)

What is known about the chip that does USB audio to the PC, and where to pick the research up.

- **The chip: an Atmel/Microchip ATSAM3U1C** (Cortex-M3, USB 2.0 high speed, LQFP100) on the
  analog (green) board, with a 12 MHz crystal beside it [static: full-size FCC internal photos,
  FCC ID `2AD4XEVOLVE`, close-up marked "ATSAM3U1C AU", 2024 date code]. Silkscreen around it:
  `ERASE` and `TP1` pads, `URXD`/`UTXD` (the chip's debug UART), and the audio lines `MCLK`, `BCLK`,
  `LRCK`, `SD1`, `SD2`, `DACSD` (I2S/TDM, the chip's SSC, towards the CPU board's FPGA). No labelled
  JTAG/SWD header in the photo. An Everest ES8388 codec sits next to it. The XS's FCC photos (FCC ID
  `2AD4XDLZXS`) show one chip of the same size at the same spot, marking unreadable at their
  resolution [guess: the same chip]. The PC's USB-C port is not on the CPU board, so it is on the
  analog board too.
- **Ploytec firmware** [guess, strong]: the ATSAM3U1C is the chip of Ploytec's "USB Audio Junction
  2.0" design; the second identity's vendor `0x0A4A` is Ploytec GmbH (`usb.ids`, which also lists
  `0A4A:A400` "AUDIO JUNCTION 2.0"); and the XS reports the serial string "no serial number"
  [device], the literal string Ploytec firmware uses instead of a per-unit serial (Ozzy's notes,
  below). Ploytec (Germany) licenses USB audio designs to manufacturers: Audio Junction 2.0 has
  4 in / 4 out as its base, with options up to 8 x 8 at 96 kHz or 16 x 16 at 48 kHz, and advertises
  "firmware updating via USB" (usb-audio.com, Ploytec's USB site). So the channel count is a
  per-product firmware choice, and Mackie (with Ploytec) most likely can update it in the field;
  how is not public. `0A4A:AC1E` would then be Ploytec's own ID showing through (a fallback or
  update mode) [guess].
- **Reading the firmware off the chip** (hardware work, outside the mod): the ATSAM3U's ROM
  bootloader (SAM-BA) is only reached through the `ERASE` pin, which wipes the flash first, so it
  cannot read the firmware out; reading needs JTAG/SWD on an opened mixer, and only if the
  security bit is not set.
- **Mackie's driver** (Thesycon, `loudusbaudioapi_x64.dll`, API 5.12) has Thesycon's generic
  firmware calls (`TUSBAUDIO_StartDfuDownload`, `StartDfuUpload`, `StartDfuRevertToFactoryImage`,
  `GetDfuStatus`) and raw request calls (`TUSBAUDIO_ClassVendorRequestIn`/`Out`); Mackie's control
  panel offers no firmware update [static]. Thesycon's firmware updates follow the USB DFU class.
- **Device properties** (`TUSBAUDIO_GetDeviceProperties`, read-only, nothing changed on the mixer),
  XS: `0A73:003A`, revision `0x130`, serial "no serial number", flags `0x1283` [device, XS]. The
  struct layout (VID, PID, revision, three 128-character strings, flags at offset `0x30C`) matches
  Thesycon's public reference manual 1.22.0. That manual names the flags (high speed supported, high
  speed, DFU supported, DSP plugin, audio class 1.0, audio class 2.0) but not their values; in order
  they would be `0x1`-`0x20`, yet `0x20` (audio class 2.0) is clear on a class 2.0 device, so the
  values differ and **whether the chip says it supports DFU is not known** [static]. The full-size's
  flags were not checked.
- **Prior work**: Ozzy (github.com/mischa85/Ozzy, open source, active) drives some 30 Ploytec-based
  interfaces (Allen & Heath Xone, Reloop, ESI, Akai, M-Audio, Tascam ...) and documents Ploytec's
  protocol from Ghidra and USB captures in its `.claude/re/` notes. Those are Ploytec's older
  non-class protocol; the DLZ runs Ploytec's class 2.0 firmware under Thesycon's driver, so only
  some of it carries over. Useful: vendor request 'V' (`bmRequestType 0xC0`, `bRequest 0x56`,
  `wLength 15`) reads the firmware version, byte 0 the chip ID.
- **Ploytec firmware updates in practice**: only the product's maker ships them, as a file for
  that one product. Example: Allen & Heath's `FWUpdater_XONE_DB4_v1.4.1.zip` (Windows, in the Xone:DB4
  driver package) changed the transfer mode (1.3.9 bulk, 1.4.1 interrupt), not the channel count
  (Allen & Heath forum, "New driver for Xone:DB4"). No community firmware, open firmware or
  general Ploytec flasher exists for any device; Ozzy only reads the version. Thesycon's update
  tools (`TUSBAudioDfu.exe`, `dfucons`, and TL-USBDFU, which replaces the DFU calls in the audio
  driver) need the maker's firmware file. Mackie has never shipped one for the DLZ's USB chip.
  Ploytec talks to the community (it helped Ozzy) and sells Revival, a box that turns old
  Ploytec mixers into class-compliant devices.
- **Inside the Xone:DB4 updater** [static: `FWUpdater_XONE_DB4_v1.4.1.exe` and driver package
  `XONE_DB4_2.9.91.0.exe`, read without running]: the updater is Ploytec's generic "AudioJunction
  Firmware Updater" (2015) with Allen & Heath's texts. The firmware is a PE resource (`BINARY`,
  ID 1012, 6152 bytes): an 8-character ASCII version header `10410001`, then scrambled data
  (entropy 7.8, no ARM vector table in it or anywhere in the package). It flashes only through
  Ploytec's own kernel driver (`\FW_UPDATE`, `PGIOCTL_PREPARE_FWUPDATE_FIRMWARE`; without it:
  "The installed driver does not support firmware update mode"). That driver binds `0A4A:FFDB`; it
  is Ploytec's shared driver (it also names Audio Junction 2.0, Xone:2D/4D/DX, Dotec), and its
  `readUC3UserFlash`/`writeUC3UserFlash` strings point to an Atmel AVR32 UC3 as the Xone:DB4's chip,
  not a SAM3U [guess, strong: the strings could belong to another product of that driver]. Either
  way the update path and driver differ from the DLZ's (class 2.0, Thesycon): the updater would not
  even see a DLZ.
- **Another product's Ploytec firmware is no route**: each image is built for its board's wiring
  (I2S/TDM lines, codecs), and the FPGA's bitstream expects the 4 channels it gets today. Best case,
  nothing changes. Worst case, USB audio is lost, with no published DLZ image to put back. The
  Xone:DB4's image is most likely not even for the same CPU family (above).
- **The only route to more PC inputs is Mackie with Ploytec**: they hold both halves, the chip's
  firmware and the FPGA routing. Makers do ship this kind of update (RØDECaster Pro II, #279; the
  Allen & Heath updater above), so an owner request to Mackie is the lever.
- **Not tried, in order of risk**: a sharp photo of the XS's chip (none; confirms the same chip);
  the 'V' request through `TUSBAUDIO_ClassVendorRequestIn` (a read request the firmware may not
  know, through a call whose parameters are not public; sent to the chip on the mixer); reading the
  firmware through the DFU calls (puts the chip in its update mode; only the mixer could be the
  first). Writing firmware is out (a licensed binary, and a bad write can cost the USB audio).
- **Even new USB firmware would not add PC inputs on its own**: the extra channels would also have
  to reach the graph through the FPGA (Mackie's bitstream), over the I2S/TDM lines above.

### Full-size DLZ Creator

One owner's full-size installed v0.1.0 and runs it [device: their install log, boot logs and a
photo]; our own test mixer is an XS.

- The installer reads it as `DLZ Creator full-size`, build 1731, GD32 marker
  `.gd32-loaded-firmware-evolve-154.bin` (the full-size firmware, no `/root/.dlzlite`); all 13 app and
  13 server anchors match, so its `app.js` and `server.js` match the XS's where the mod patches them
- Same disks as the XS: eMMC `mmcblk1` with 15269888 sectors, one ext4 partition at 8192, boot
  areas of 8192 sectors; SD `mmcblk0`
- Same touch: Goodix GT911 at 0x5d (ID 911, firmware 1060); the probe at 0x14 fails with `-6` on
  both models (a second touch address in the device tree that nothing answers)
- Install on a 128 GB card: 830 s from the first write, 2282 MiB in use on the eMMC, backup 895 MiB
- `dspserver` finds I2C devices 0x22, 0x40, 0x44, 0x48, 0x4C, 0x90, 0x98 (no XS list to compare yet)
- On 2 of 3 boots that reached the GUI, `glesgui` failed once with "Failed to init OpenGL" about
  11 s after "Initialising graphics..." and started at systemd's restart (open question 35)

## Mackie's device tree

From Mackie's `sun8i-r40-mackie-evolve-a1.dtb` [static]. A mainline-format tree (not Allwinner BSP),
run by Armbian 5.10.197 with the AXP20x regulator driver built in, no `regulator_ignore_unused`, no
overlays. Rail voltages are not measured. Relevant for any mod that brings its own device tree or
kernel (none does today, [modding-guide.md](modding-guide.md) "Brick risks"): copy the PMIC block
exactly, or the kernel may set other voltages at boot.

- **AXP221** `/soc/i2c@1c2ac00/pmic@34` (i2c0, PB0/PB1), IRQ via `nmi_intc` level-low,
  `x-powers,dcdc-freq = <3000>` (written to the PMIC: keep it). Charger/battery/ac/usb/led subnodes
  disabled; keep them so, keep `drivevbus` undeclared

  | Reg | Name | Range | Always-on | Used by | SoC recommends (datasheet 5-2) |
  |---|---|---|---|---|---|
  | dcdc1 | vcc-3v3 | 3.3 V | yes | SD + eMMC supplies, GT911 | VCC-IO 3.0–3.6 V |
  | dcdc2 | vdd-cpu | 1.2–1.3 V | yes | (no cpu-supply/OPPs: no DVFS) | 1.0–1.3 V (max 1.32 V) |
  | dcdc3 | vdd-sys | 1.0–1.3 V | yes | | 1.0–1.3 V (max 1.32 V) |
  | dcdc5 | vcc-dram | 1.5 V | yes | | DDR3 1.425–1.575 V |
  | dc1sw | vcc-gmac-phy | 3.3 V | no | Ethernet PHY | |
  | aldo2 | vcc-pa | 2.5 V | no | | VCC-PA 2.25–2.75 V (2.5 V mode) |
  | aldo3 | avcc | 2.7–3.3 V | yes | | AVCC 2.94–3.06 V |
  | dldo1 | vcc-lcd-io | 3.3 V | yes | panel | |
  | dldo2 / dldo3 | vcc-wifi / -2 | 3.3 V | yes | | |
  | dldo4 / eldo3 | vdd2v5-sata / vdd1v2-sata | 2.5 V / 1.2 V | no | | 2.25–2.75 V / 1.0–1.2 V |
  | rtc_ldo | rtc_ldo | 3.0 V | yes | | VCC-RTC 3.0–3.3 V |
  | dcdc4, dc5ldo, aldo1, eldo1, eldo2 | — | no constraints | no | (Linux may not change them) | |

  Which SoC pin each regulator feeds is read from the names, not from a schematic [guess]. aldo3's
  DTB range is wider than AVCC's (2.94–3.06 V); what it is set to is not measured. eldo3 at 1.2 V
  sits on VDD-SATA's recommended maximum; SATA is unused

  Declared, enabled, not always-on and unused regulators are switched off by Linux ~30 s after boot
  (stock does the same). Leaving a regulator out of the tree leaves it alone [guess]. `dc1sw` is on
  at every boot until then: the SPL enables it together with DCDC1 (`axp_set_dcdc1` sets
  `DCDC1SW_EN` for any non-zero DCDC1 voltage, and Mackie's defconfig has `AXP_DCDC1_VOLT=3300`),
  so that is stock behaviour [static]. On the XS the kernel logs `dc5ldo`, `vdd1v2-sata` and
  `vdd2v5-sata` as `disabling` at ~33.8 s [device, 2026-11-14]
- **SD** = mmc0 `/soc/mmc@1c0f000` (PF0–PF5, 4-bit, cd-gpios PH13 active-low, vmmc dcdc1).
  Hiding it from stock: `fdt set /soc/mmc@1c0f000 status disabled`.
  **eMMC** = mmc2 `/soc/mmc@1c11000` (PC5–PC15, PC24, 8-bit, non-removable, vmmc = vqmmc = dcdc1,
  3.3 V signalling). No max-frequency/HS200 set on either
- **Display**: mixer0 → tcon-top → tcon_lcd0 `/soc/lcd-controller@1c71000` (LVDS on PD0–PD9) →
  `/panel` (power dldo1, no enable-gpio): 52 MHz, 1024x600, h 180/20/160, v 12/5/23 (~58.7 Hz,
  `disp_mode=1024x600p58`). Backlight: PWM0 (`/soc/pwm@1c23400`) PB2, 50 µs period, inverted,
  levels 22359–65535 (4096 steps, default 1024), enable PB3
- **Touch**: GT911 declared twice on i2c1 (`@14` and `@5d`), IRQ PI10, reset PI11, AVDD dcdc1
- **GPIO fixed regulators**: `/vcc8v0` (PB13), `/vcc5v0-usb0` (PA13), `/vcc5v0-usb1` (PE4);
  reg-fixed drives their GPIO low at probe, so an own device tree should leave them (and the
  Bluetooth and GD32 UARTs, the codec nodes, USB, Ethernet, Mali) out unless it needs them.
  `/vcc8v0` has no consumer in the tree, so Linux leaves it off; what PB13 switches on the board,
  and whether anything else drives it, is not known [static]
  `clk_out_a` on PI12 may clock an external chip [guess]

## Boot chain

- The Boot ROM boots from microSD before eMMC, always, as long as the SD has a valid SPL (it checks
  the SPL's checksum and skips a card without one) [device]
- Mackie's bootloader: `U-Boot 2021.10-armbian`, built by `jenkins-Evolve-Image-1696`
- Device tree: `sun8i-r40-mackie-evolve-a1.dtb`, model "Mackie Evolve A1",
  compatible `mackie,evolve-a1`, `sinovoip,bpi-m2-ultra`, `allwinner,sun8i-r40`
- Standard Armbian `distro_bootcmd` → `/boot/boot.scr`, no signature or secure-boot checks
- Mackie's U-Boot has `fatload`, `fatwrite`, `ext4load`, `ext4ls`, `setexpr`, `itest`, `saveenv`
  (env file `uboot.env`, FAT), `usbkbd` (`stdin=serial,usbkbd`), the `fdt` command incl. `fdt apply`;
  no `ext4write`, no `bootmenu`, no `i2c` [static: strings of the SPL/U-Boot area]. Its built-in
  default `fdtfile=sun8i-r40-mackie-evolve-a1.dtb` (`fdt_addr_r=0x43000000`) is where the DTB name
  comes from (`armbianEnv.txt` has none) [static]; Mackie's own saved environment has not been located
- `bootcmd_mmc_auto` tries the device it was loaded from first (`mmc_bootdev`), then the other one;
  a booted SD therefore always runs the SD's `/boot/boot.scr` [static]
- Choosing SD vs eMMC without touching the eMMC is possible: the SD's `boot.scr` can chain
  `load mmc 1:1 ... /boot/boot.scr` (stock), load stock's kernel, initrd and DTB from the eMMC itself
  and disable the SD controller in the DTB first, so stock cannot see (or FORMAT) the mod card. A
  one-shot flag needs a FAT partition on the SD, because U-Boot can only write FAT [static, untested
  on the device]
- Kernel 5.10.197-sunxi; the initrd is one zstd frame (cpio newc), wrapped as `uInitrd` (64-byte
  uImage header, labelled lz4 but the payload is zstd). `armbianEnv.txt`: [system.md](system.md)
- Early splash: kernel bootsplash (`CONFIG_BOOTSPLASH`), file `/usr/lib/firmware/bootsplash.armbian`,
  copied into the initrd by `/etc/initramfs-install/hooks/bootsplash.sh`: a logo 488x200 (centered)
  and a spinner 48x48, 75 frames @ 48 ms (top, offset 200). The mod swaps that one cpio entry
  (`cpio-replace.py`); every other entry stays byte-identical. Later splash: Weston background
  `/etc/dlz.png`, shown until `glesgui` draws ([components/glesgui.md](components/glesgui.md))
- A card copy of the system needs its own rootfs UUID (`armbianEnv.txt` + `/etc/fstab`), or the
  kernel may mount the eMMC's rootfs. The GD32 marker is in the copy, so the card never reflashes the
  MCU; the FPGA is reloaded at every boot anyway [device: kernel, initrd and rootfs all come from the
  card]
- **Booting from USB** (not used): the Boot ROM goes SD → eMMC → SPI → FEL, no USB mass storage [guess: the A40i's documented boot order]. Both U-Boots have the R40 EHCI/OHCI drivers and `usb0` in `boot_targets`, after
  `mmc_auto`, so the eMMC (or a bootable SD) always wins; an SD with only U-Boot and no boot partition
  would fall through to a stick's `/boot/boot.scr`; the kernel has USB host, storage and PHY built in
  [static]. Against it: the single USB-A port is needed for the Wi-Fi stick, and server.js treats any
  USB disk as media (FORMAT USB would wipe a running system on it)

## eMMC layout

- MBR, SPL (`eGON.BT0`) at 8 KiB
- Partition 1: type 0x83 (ext4), start sector 8192 (4 MiB), 14934017 sectors (~7.1 GiB)
- eMMC user area: 0xe90000 sectors (7.28 GiB); boot0/boot1 hardware partitions: 4 MiB each, empty
- Rootfs: ext4, label `armbian_root`, UUID `fece6959-646b-4c18-b1d6-ba58fe2676aa`, ~2.3 GiB used

## SD card size and speed

Mackie publishes no maximum (spec sheet: microSDHC/microSDXC, FAT32). From the firmware [static]:

- No size check anywhere: kernel (`MMC_SUNXI`, vfat built in, exFAT module), `server.js` and
  dspserver have none. The capacity display already handles a `T` suffix
- Real ceiling **2 TiB**: FORMAT writes an MBR table (`parted mktable msdos`, one fat32 partition)
  and `mkfs.vfat -I` (dosfstools 4.2, picks FAT32 and cluster size by itself); MBR and FAT32 both
  stop at 2 TiB with 512-byte sectors. SDUC (> 2 TB) cards are not supported by kernel 5.10 [guess]
- Slot speed: the DT `mmc@1c0f000` has `bus-width = <4>`, `cd-gpios`, `vmmc-supply` only: no
  `vqmmc-supply`, no `sd-uhs-*`, so 3.3 V only and no UHS. The sunxi driver runs it at SD High Speed
  (50 MHz); measured ~23 MB/s sequential from a card, against 43.6 MB/s from the eMMC [device]. The
  "SD 3.0 104 MB/s" on the spec sheet is the controller, not this board. Recording needs ~2 MB/s
  (14 channels)
- Free space: `server.js` runs `df` (1K blocks) for the remaining-time estimate; dspserver has no
  `statvfs` and only reports "Disk Full". Its 32-bit `fseek`/`ftell` is why it splits at 2 GB
- Cards larger than 128 GB are not tested on the device yet

### Running from the card

- **The card is not a bottleneck** [device, an installed card, SanDisk Ultra 128 GB, idle UI some
  18 min after a start]: card busy (`io_ticks`) 32.7 s of ~1080 s (3 %, nearly all during the
  start), 0.6 % over 5 s while running; the start read 326 MiB in 7771 requests (~8.5 ms each),
  4.9 MiB written; `vmstat` wa 0, b 0; cores 0-2 4-5 % busy each, core 3 99 % (dspserver, by
  design); 104 MB available, no swap.
- The slot caps any card at ~23 MB/s (above), so a faster card only helps small random reads: an
  A1 or A2 card from a known brand is enough (the install guide's advice). A survey of many cards
  was dropped as not needed (#10).
- What the mod adds to a start: [system.md](system.md), "Boot and services" (since #141 the mixer
  view at ~28-31 s on the dev card). `systemd-networkd-wait-online` takes 2 min after every start,
  stock too; nothing waits for it [device].
- Running the mod from the eMMC instead (1.9x faster sequentially) would go against the first hard
  rule; its prerequisites would be a tested restore script, FEL confirmed, a UUID of its own for the
  eMMC copy and Mackie-updater guards on the main system.

## Sources

- https://linuxslate.com/forum/viewtopic.php?t=21 (teardown, A40i, UBOOT button, DEBUG header).
  Full-size DLZ Creator: "Allwinner a40i-H", a GOWIN FPGA, analog + digital board; no PMIC, DRAM
  or eMMC part named, no boot log. Its photos show 4 XLR + 4 jack inputs (the full-size) and the CPU
  board's silkscreen `EVOLVE-A1_A40i_V?.0_20221209` (version digit unreadable): the XS's board name
  (`mackie-evolve-a1`). PMIC marking not readable
- FCC internal photos of the XS, FCC ID `2AD4XDLZXS` (LOUD Audio, filed 2023-12): fccid.io blocks
  scripted fetches, save the PDF from a browser (21 JPEG pages, low resolution). XS CPU board
  silkscreen `PMD_DLZ Lite_V2.0_20230527`; control surface MCU `GD32F305VCT6`; Bluetooth module with
  an Actions ATS2853 and a `BT USB` header beside it; Samsung eMMC; two antennas on cables [static]
- FCC internal photos of the full-size, FCC ID `2AD4XEVOLVE` (LOUD Audio; same route, 19 JPEGs at
  1050 x 787, sharper than the XS's): USB audio chip ATSAM3U1C with an ES8388 beside it (analog
  board), FPGA `GW1N-LV9LQ144C6/I5` (GOWIN LittleBee GW1N-9, LQFP144), PMIC AXP221S, eMMC Samsung
  `KLM8G1GETF`, CPU board silkscreen `EVOLVE-A1_A40i` [static]. The other exhibits of both filings
  (test reports, RF exposure, antenna spec, label, user manual; no block diagram or schematics,
  those are confidential) cover only the Bluetooth radio: Bluetooth 5.0 BR/EDR, tested with the
  chip maker's `BT FCC Tool v2.24`, an FPCB antenna of 2.51 dBi (a 2.4/5 GHz part made for PMD(HK)
  Technology, the maker behind the `PMD_DLZ Lite` CPU board); the same two 18 V / 1.5 A (27 W)
  adapters for both models (GME36E-180150FDR, GPE048G-180150-D). Full-size samples tested
  2022-10 to 2023-03, the XS 2023-09 to 2023-11 [static]. All files are kept privately in
  `build/fcc/xs/` and `build/fcc/full-size/`
- Bootsplash format: `include/uapi/linux/bootsplash_file.h` and `tools/bootsplash/bootsplash-packer.c`
  in Armbian-patched kernels, e.g. https://github.com/orangepi-xunlong/linux-orangepi
- The installer's U-Boot: Debian `u-boot-sunxi` 2025.01-3+deb13u1, `Bananapi_M2_Ultra`, made safe by
  `install/release/uboot-safe.py` ([installer.md](installer.md)). `CONFIG_CMD_CRC32=y` (no `hash`
  command), no ext4 write. Environment in `uboot.env` on the boot card's FAT (`ENV_IS_IN_FAT`,
  `:auto`); its default `boot_targets=fel mmc_auto ...` would fall through to the eMMC's own
  `boot.scr` when the card has no script, so the cards ship a `uboot.env` with `boot_targets=mmc0`
  (`mkenv.py`) [static]
- USB audio chip (#279): `usb.ids` (linux-usb.org; the systemd copy is scriptable:
  github.com/systemd/systemd, `hwdb.d/usb.ids`) for vendors `0A4A` and `0A73`; Ploytec's USB
  designs at usb-audio.com (`/jct2`, `/jctu`); Microchip's "Ploytec USB 2.0 High-Speed Audio
  Junction" reference design (microchip.com blocks scripted fetches); Thesycon's API reference
  manual 1.22.0 as a public header copy (github.com/lilltroll77/DCF, `tusbaudioapi.h`); Ozzy and its
  Ploytec notes (github.com/mischa85/Ozzy, `.claude/re/`, `common/devices/ploytec/ploytec_defs.h`);
  Allen & Heath forum threads "New driver for Xone:DB4" (firmware updater, bulk/interrupt) and
  "Xone ... USB Ploytec driver update"; Thesycon's TL-USBDFU page and `TUSBAudio_history.txt`
  (thesycon.de); XMOS's DFU loader guide (Thesycon's `dfucons`)
