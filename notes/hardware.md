# Hardware and boot chain

The board, Mackie's device tree, the boot chain, the eMMC layout and the SD slot. The software on top:
[architecture.md](architecture.md) and [system.md](system.md). Confidence tags: see
[architecture.md](architecture.md).

## Hardware

- SoC: Allwinner A40i-H (R40 family), 1 GiB DRAM (U-Boot relocates near 0x7c000000)
- FPGA: GOWIN (on the digital board), loaded at every boot by `flash-fpga.sh`
- MCU: GD32 (control surface), flashed over SWD with openocd by `flash-gd32.sh`
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

  | Reg | Name | Range | Always-on | Used by |
  |---|---|---|---|---|
  | dcdc1 | vcc-3v3 | 3.3 V | yes | SD + eMMC supplies, GT911 |
  | dcdc2 | vdd-cpu | 1.2–1.3 V | yes | (no cpu-supply/OPPs: no DVFS) |
  | dcdc3 | vdd-sys | 1.0–1.3 V | yes | |
  | dcdc5 | vcc-dram | 1.5 V | yes | |
  | dc1sw | vcc-gmac-phy | 3.3 V | no | Ethernet PHY |
  | aldo2 | vcc-pa | 2.5 V | no | |
  | aldo3 | avcc | 2.7–3.3 V | yes | |
  | dldo1 | vcc-lcd-io | 3.3 V | yes | panel |
  | dldo2 / dldo3 | vcc-wifi / -2 | 3.3 V | yes | |
  | dldo4 / eldo3 | vdd2v5-sata / vdd1v2-sata | 2.5 V / 1.2 V | no | |
  | rtc_ldo | rtc_ldo | 3.0 V | yes | |
  | dcdc4, dc5ldo, aldo1, eldo1, eldo2 | — | no constraints | no | (Linux may not change them) |

  Declared, enabled, not always-on and unused regulators are switched off by Linux ~30 s after boot
  (stock does the same). Leaving a regulator out of the tree leaves it alone [guess]. `dc1sw` is on
  at every boot until then: the SPL enables it together with DCDC1 (`axp_set_dcdc1` sets
  `DCDC1SW_EN` for any non-zero DCDC1 voltage, and Mackie's defconfig has `AXP_DCDC1_VOLT=3300`),
  so that is stock behaviour [static]
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
- Bootsplash format: `include/uapi/linux/bootsplash_file.h` and `tools/bootsplash/bootsplash-packer.c`
  in Armbian-patched kernels, e.g. https://github.com/orangepi-xunlong/linux-orangepi
- The installer's U-Boot: Debian `u-boot-sunxi` 2025.01-3+deb13u1, `Bananapi_M2_Ultra`, made safe by
  `install/release/uboot-safe.py` ([installer.md](installer.md)). `CONFIG_CMD_CRC32=y` (no `hash`
  command), no ext4 write. Environment in `uboot.env` on the boot card's FAT (`ENV_IS_IN_FAT`,
  `:auto`); its default `boot_targets=fel mmc_auto ...` would fall through to the eMMC's own
  `boot.scr` when the card has no script, so the cards ship a `uboot.env` with `boot_targets=mmc0`
  (`mkenv.py`) [static]
