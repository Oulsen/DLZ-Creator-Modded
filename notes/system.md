# System (OS layer)

Everything around the Mackie software: base OS, boot, network, access, persistence, packages.
Confidence tags: see [architecture.md](architecture.md). Hardware and boot chain details: [hardware.md](hardware.md).

## Base

- Armbian 22.08.0-trunk, `BOARD=mackie-evolve-a1` (BSP package `armbian-bsp-cli-mackie-evolve-a1`),
  Ubuntu 22.04.3 armhf, kernel 5.10.197-sunxi [static]
- Node.js 18.18.2 (NodeSource package) [static]
- Memory: 1 GiB for two Node processes, dspserver and Weston, and **no swap** (`SwapTotal: 0`;
  dspserver turns zswap off), so a shortage ends in the OOM killer, not in slowness. dspserver holds
  ~610 MB RSS; `MemAvailable` ~104-120 MB in use, 106 MB after a 60 s busy test [device]. That is
  why nothing heavy runs on a mixer that is in use (no load tests over SSH)
- Tools on board that the installer and the mod use: python3 3.10 (no Pillow), zstd, cpio,
  e2fsprogs, the DejaVu fonts and ffmpeg 4.4.2 [static]
- Weston, Xwayland and Mesa come from a vendor package `xorgmesawayland` (811 files), not Ubuntu [static]
- CPU clock: `/etc/default/cpufrequtils` asks for 1.2 GHz with the `performance` governor, but it
  never applies: the DTB's `cpu@0..3` nodes have no `clocks`, `cpu-supply` or `operating-points`,
  so `cpufreq-dt` (a module, like `sun50i-cpufreq-nvmem`) has nothing to bind to and no policy
  exists [static; missing `policy0` device]. U-Boot's SPL sets 1008 MHz, `vdd-cpu` stays at 1.2 V,
  `/sys/devices/system/cpu/cpufreq/` empty, no cpufreq module loaded [device, SD boot]. dspserver
  then raises the clock itself, past the kernel, through `/dev/mem`: its journal shows "old CPU PLL:
  90001410" → "new CPU PLL: 90001510" at every start, i.e. N 21 → 22 with K 2, M 1, P 1 in the R40's
  PLL_CPUX layout, 1008 → **1056 MHz** at the same 1.2 V [device; decode static, field layout of
  mainline `ccu-sun8i-r40`]. debugfs `clk_summary` keeps showing 1008 MHz (the clock framework's
  cached rate), so it cannot be used to read the real clock. The thermal sensor works
  (`sun8i_thermal` loaded, zones cpu0/gpu) but runs uncalibrated ("Failed to get calibration nvmem
  cell"): cpu0 68.8 °C, gpu 67.0 °C after 1 h 28 min in normal use [device], so read the absolute
  values with care. Who asks for what: `/etc/default/cpufrequtils` belongs to no package (Armbian's
  build writes it from the board config's CPU limits), and dspserver's start-up shell snippet echoes
  `performance` into `policy0/scaling_governor` next to `sched_rt_runtime_us = -1`; neither checks
  the result [static]. Both failures are quiet (at most an error line in the journal), so the missing OPPs
  go unnoticed while the mixer works at 1056 MHz. The mainline R40 dtsi had no CPU OPPs in 5.10: they were
  only proposed in 2022 (LKML "ARM: dts: sun8i-r40: add opp table for cpu"), with values from
  Allwinner's BSP: 720 MHz 1.00 V, 912 MHz 1.10 V, 1008 MHz 1.16 V, 1104 MHz 1.24 V, 1200 MHz 1.30 V,
  clock latency 2 ms. 1104 and 1200 MHz were left to board DTS files (current draw; ~800 mA at 5 V
  at 4x1.2 GHz full load) [static, upstream thread]. The board's dcdc2 range (1.2–1.3 V) covers
  exactly the 1.2 GHz point. Chip limits (A40i datasheet rev 1.1, tables 5-1, 5-2 and 6-1): VDD-CPU
  recommended 1.0 / 1.1 / 1.3 V (min/typ/max), absolute maximum 1.32 V; ambient -40..85 °C, junction
  -40..125 °C, θJA 24 °C/W. The datasheet names no top CPU clock (only the PLL's 60 MHz–2.1 GHz
  output range); module makers' "up to 1.5 GHz" has no voltage behind it on this board [static]. So
  1104 MHz at 1.24 V sits inside the recommended range with margin, 1200 MHz at 1.30 V on its upper
  edge and 20 mV under the damage limit, which leaves no room for the PMIC's tolerance or ripple.
  Measured against today's 1056 MHz, 1104 MHz gains ~4.5% and 1200 MHz ~13.6%
- `vm.swappiness=100`, `kernel.printk = 3 4 1 3`; zram disabled [static]

## Boot and services

- Default target `graphical.target` [static]
- Mackie units hook into `basic.target.wants` (gd32, fpga, faderlink, dspserver, weston, glesgui,
  upgradedaemon) and `multi-user.target.wants` (evolve-node, evolve-app) [static]. Order and roles:
  [architecture.md](architecture.md#processes)
- `basic.target` waits for faderlink (`Before=basic.target`), which waits for the FPGA load
  (9.4-14.3 s into a start) [device]. A unit with the default dependencies starts after it: the
  mod's `dlzmod-update` and `dlzmod-grow-data`, ordered before evolve-node, evolve-app and
  dspserver, held node back to ~16 s, where stock starts it at ~9.5 s. **The mod** (#141): their
  drop-ins take the default dependencies off (after `sysinit.target`, stopped at shutdown, the
  eMMC lock still first). On the dev card [device, 11 starts]: the mixer view at 29.4-31.1 s instead
  of 37.3-38.3 s; audio ready at ~19.6 s in 8, ~27 s in 3 (dspserver's preamp step waited ~7.5 s
  when it met glesgui's graphics start, not the Wi-Fi: `components/dspserver.md`, #147), always
  before the view.
- Also enabled: NetworkManager, systemd-networkd, resolved, wpa_supplicant, avahi, ssh, openvpn
  (no config, does nothing), chrony, cron (stock, empty), rsyslog, sysstat, armbian-firstrun-config [static]
- Masked: `ondemand.service`, `sudo.service` [static]
- Only `serial-getty@ttyS0` is enabled; getty overrides add a 10 s sleep, no autologin [static]
- `rc.local` is empty (`exit 0`) [static]

### Scheduling

- Stock units of `glesgui`, `evolve-node`, `evolve-app`, `dspserver` and `faderlink`:
  `CPUSchedulingPolicy=fifo`, `CPUSchedulingPriority=20`, `Nice=-20`, `Restart=always` [static]. Weston, Xwayland, sshd, journald, rsyslog, systemd and the kworkers
  run normal (TS) [device, `ps -eLo cls,rtprio`].
- `/proc/sys/kernel/sched_rt_runtime_us` is `-1` (RT throttling off: real-time tasks may keep a core
  for ever); dspserver sets it at its start (its start snippet; the string is only in dspserver)
  [device, static]. Cores 0-2 are shared (`isolcpus=3` is dspserver's audio core).
- dspserver's own threads on cores 0-2 set their priorities themselves, above 20: main loop RR 50,
  NDI senders RR 50, reverb FIFO 99, a few FIFO 20; ~1 % CPU each in normal use [device].
- glesgui and node set no policy themselves (no `sched_setscheduler`/`pthread_setschedparam`
  imported; glesgui imports `sched_yield`) [static]: the units decide.
- **The mod** (#140): drop-ins `CPUSchedulingPolicy=other`, `CPUSchedulingPriority=0` for glesgui,
  evolve-node and evolve-app (Nice=-20 kept; dspserver and faderlink unchanged), after real-time
  glesgui and node starved the rest of the start (components/glesgui.md, "Bad starts"). The explicit
  0: systemd 249 refuses an empty `CPUSchedulingPriority=` and keeps 20, which `other` does not
  take [static, the dump's systemd-analyze under qemu]. On the card: glesgui and the 22 node threads
  TS nice -20, dspserver as before [device].

## Clock, filesystems, tools

- **Clock**: RTC drivers built in (`RTC_DRV_SUN6I`, `RTC_DRV_SUNXI`), but `fake-hwclock` is
  installed and chrony only syncs from internet pools. Offline every boot restarts at the dump's
  saved time, 2023-11-16 [device]: fake-hwclock has no periodic save, only one at a clean shutdown,
  which the hard power switch never gives [static].
  The only RTC in the Mackie DTB is the SoC's own `rtc@1c20400` (`allwinner,sun8i-r40-rtc`, external
  32.768 kHz crystal); no external RTC chip on i2c0 (PMIC) or i2c1 (GT911 only). Kernel has
  `RTC_HCTOSYS=y` and `RTC_SYSTOHC=y` (rtc0 is only written back after an NTP sync); fake-hwclock
  runs without `FORCE`, so it only moves the clock forward [static]. Its only trigger is
  `fake-hwclock.service` (sysinit: `load`, stop: `save`); no cron or timer job (`/etc/cron.hourly`
  and `/etc/cron.d` hold only placeholders), `/etc/default/fake-hwclock` only comments. `save`
  writes `/etc/fake-hwclock.data` in place (`date > $FILE`, no temp file, no sync), so a power cut
  during a save can leave it empty or cut off; `load` then finds no usable later time and the clock
  stays where systemd put it (its build time) [static].
  **The RTC keeps time over a software restart and loses it without power** [device]: in every
  kept boot log, after a restart fake-hwclock logs "saved clock information is in the past" (rtc0
  is ahead and wins); after the switch on the back systemd logs "System time before build time,
  advancing clock" and fake-hwclock sets its saved time. Those two lines tell a cold start from a
  warm one in any boot log. So there is no backup battery [guess, strong; a public teardown shows
  no coin cell on the digital board's top side either]. Online, chrony (`makestep 1 3`) then steps
  the clock some 20-40 s into the boot: by the time since the last clean shutdown after a cold
  start, by about a second after a warm one [device]. Timezone is `Etc/UTC`
  (`/etc/localtime`, `/etc/timezone`), so recording file times are UTC [static]: server.js mounts
  FAT media without `tz=`/`time_offset=`, so the kernel (5.10, `fat_tz_offset`) converts file times
  with its own offset `sys_tz` at every conversion, and systemd leaves that at 0 (its first
  `settimeofday` seals the time warp with 0, RTC in UTC); a computer reads FAT times as its local
  time, so they showed 1-2 h early in the Netherlands [static]. tzdata is installed (418 zones in
  `zone.tab`); `hwclock --systz --utc` (util-linux 2.37.2) makes exactly two calls,
  `settimeofday(NULL, {0,0})` and `settimeofday(NULL, {<minutes west>,0})`, and reads neither the RTC nor
  `/etc/adjtime` [static, qemu `-strace` as a user without rights]. Node 18.18.2 has full ICU (73.2),
  so `Intl` gives any zone's offset. Mackie's app and server show no local times; app.js has an
  unused date/time page (`PageTime`, built in `startGUI`, never shown; nothing in server.js takes its
  `SET_TIME`) [static]. chrony has `rtcsync` and `makestep 1 3`; `chronyc -c tracking` ends with the
  leap status, `Not synchronised` before the first sync [static]. The mod's time zone and clock
  settings: [mod.md](mod.md) (#9, #13)
- **Filesystems**: vfat built in; `exfat.ko` and `ntfs.ko` (rw) available as modules; CIFS and NFSD
  as modules [static]. Userland has `mkfs.vfat`/`mkfs.ext*` but no `mkfs.exfat`, no Samba, no NFS
  server, no BlueZ [static].
- **USB gadget**: kernel has `USB_GADGET` and MUSB dual-role (`musb-sunxi` module), but the DTB has
  no OTG node and the PC port is not wired to Linux as far as known [static]/[guess]. A "show up as a
  USB drive on the PC" mode is therefore not available on the PC cable.

## Kernel and boot config

- `armbianEnv.txt`: `bootlogo=true`, `disp_mode=1024x600p58`, no `overlays=`, `rootdev=UUID=...` [static]
- No `fdtfile` in armbianEnv: the DTB name is a built-in default of Mackie's U-Boot (`fdtfile=sun8i-r40-mackie-evolve-a1.dtb`) [static, [hardware.md](hardware.md) "Boot chain"]
- extraargs: `isolcpus=3 nohz_full=3 rcu_nocbs=3 irqaffinity=0,1,2 cma=128M mitigations=off net.ifnames=0` [static]
- DTB `/boot/dtb-5.10.197-sunxi/sun8i-r40-mackie-evolve-a1.dtb`: on-chip codec, I2S/sound and all
  four SPI controllers disabled; no musb/OTG node [static]
- UARTs: ttyS0 = uart0 (console, DEBUG header), ttyS1 = uart3 (Bluetooth module), ttyS2 = uart5 (GD32) [static]
- Touch: Goodix GT911 on i2c1 @ 0x5d; calibration through libinput, matrix stored in
  `/etc/udev/rules.d/touchscreen.rules` (written by `save-calibration.sh`) [static].
  The DTB declares the GT911 twice, at its two possible addresses 0x14 and 0x5d; only 0x5d answers
  and binds `Goodix-TS`, so every boot logs `Goodix-TS 1-0014: I2C communication failure: -6` (no
  device at 0x14): a normal reading [device]
- modprobe.d: `blacklist mali`, `g_ether use_eem=0`, 8189fs power option [static]
- **Hardware watchdog unused**: `CONFIG_SUNXI_WATCHDOG=y` and the DTB's `watchdog@1c20c90` is enabled,
  but `RuntimeWatchdogSec` in `/etc/systemd/system.conf` is unset and nothing else opens
  `/dev/watchdog` [static]. A kernel hang or full lockup never reboots on its own: only the power
  button helps. (`/tmp/thread_watchdog` is something else, internal to dspserver/glesgui.)
- **Reboot works** [device, mod card]: `systemctl reboot` over SSH, back on SSH
  after 39 s, from the SD card, eMMC read-only, evolve-node/evolve-app/dspserver/dlzmod-update/
  dlzmod-emmc-ro active.
- **Load average ~25 is an artifact, not load** [device]: kernel cmdline `isolcpus=3
  rcu_nocbs=3 nohz_full=3` gives core 3 to dspserver's `dspLoopThreadC3`, busy 99% by design
  (`nproc` = 3); cores 0-2 measured 8% busy each (`/proc/stat`, 5 s). Dozens of audio threads
  (AsyncReverb, NDIStereoSender, dspLoopThreadC2, glesgui) wake together ~590/s on the audio block
  period, so the 5-second load sample keeps catching them runnable at once. For real load use
  per-core `/proc/stat`, not `uptime`/`top`'s load average. `dspLoopThreadC3` (SCHED_FIFO 99)
  shows 99.3% in `ps`/`top -H` and core 3 is busy ~99.6% at any moment, so `top -H` cannot show the
  DSP's headroom: the thread keeps its core whether it has work or not. dspLoopThreadC2 (core 2)
  1.2%, each AsyncReverb thread 0.7%; cores 0-2 7-13% busy over a few seconds of normal use
  [device].
- USB host: both EHCI/OHCI pairs (`usb@1c19000/400`, `usb@1c1c000/400`) exist; which one is the
  external USB-A port is open (question 18) [static]

## Network

| Item | Value | Conf. |
|---|---|---|
| Hostname | `mackie-dlz-creator-xs` (set by faderlink on first boot, marker `/root/.sethostname`) | [static] |
| Ethernet | `eth0` (sun4i-emac, IP101GR PHY), DHCP via NetworkManager/netplan | [static] |
| Wi-Fi | **None on board**: the DTB's SDIO slot `mmc@1c10000` is disabled, with no Wi-Fi node or pwrseq (`vcc-wifi*` are only AXP rail names from the Banana Pi M2 Ultra reference); no wlan in the dump's logs. netplan `wlan0.yaml` holds a saved network, a leftover. Wi-Fi only via a USB stick (drivers for Realtek, Broadcom, MediaTek etc. are in the image as modules) | [static] |
| USB net | `usb0.network`: 10.10.10.1/24 with DHCP server; probably never appears (no OTG) | [guess] |
| mDNS | Vendor avahi build, no published services | [static] |
| Firewall | None (no iptables/nftables config) | [static] |

### Listening ports

| Port | Process | Bind | Auth | Conf. |
|---|---|---|---|---|
| 22 | sshd | all | password + keys | [static] |
| 80 | server.js (HTTP + socket.io) | all | **none** (mod: other devices only paired, #45) | [device] (`ss -ltnp`) |
| 89 | server.js (newline-JSON) | all (mod: 127.0.0.1 and ::1) | **none** | [device] |
| 8011 | glesgui (WebSocket) | 127.0.0.1 only (app.js uses it) | none | [device] |
| ? | upgradedaemon (Prologue, default 8080) | `0.0.0.0` | RSA-signed upload | [guess] |

## Access and security

- root is the only login account; it has a password hash (yescrypt, unknown password) [static]
- sshd: `PermitRootLogin yes`, password auth on (default), host keys present [static]; enabled at
  boot (`multi-user.target.wants/ssh.service`, alias `sshd.service`), no socket activation [static]
- The host keys are dated 2023-11-16, the day of the factory image (same as the netplan files), so
  every mixer most likely has the same ones [guess, strong]
- `/root/.ssh/authorized_keys` contains **3 RSA keys**: vendor access [static]
- `/etc/netplan/wlan0.yaml` holds a saved factory Wi-Fi network with its password (renderer
  NetworkManager: netplan turns it into a connection at every boot, so a mixer with a Wi-Fi stick
  tries to join it) [static]
- **On the mod card** (`apply-mod.sh` `remove_factory_access`, once, marker
  `/var/lib/dlzmod-update/factory-access-removed`): `wlan0.yaml`, the vendor keys and the host keys
  are removed and SSH is off; the card gets its own host keys (`ssh-keygen -A` in
  `ssh.service.d/dlzmod.conf`) and SSH is turned on from the Mod page with a root password set there.
  The eMMC keeps all of it [device]. The SSH switch and its guard rails: [mod.md](mod.md), "Network
  panel: Wi-Fi and SSH"
- **Ports 80 and 89 give full control to anyone on the LAN**, with no authentication: every mixer
  parameter plus `FACTORY_RESET`, `FORMAT_SD/USB`, `FIRMWARE_UPDATE`. `express.static(/srv)` also
  serves `srv_data.json` and the presets [static]. Every socket.io client gets the whole state store
  as `INIT`, `lock` included [static]. On the mod card other devices need "Control from other
  devices" and a pairing with a PIN, and port 89 listens on loopback only ([mod.md](mod.md), "Remote
  Control", #45)
- **Stock's file commands reach any file** [static, server.js]: `MEDIA_DELETE` and `MEDIA_RENAME`
  take a path from the client, only rewrite its `sd:`/`usb:` prefix and unlink or rename it as root
  (the new name may contain `/`); server.js has a containment helper for the media folder, but these
  two do not use it. The preset commands take the preset folder (`type`) raw, so `../` writes,
  reads, deletes and moves any `.json`, and writing a preset then renaming it puts any content
  anywhere; sample loads and several hub keys (`recFile`, `*.file`, `player.currentFileName`) carry
  paths dspserver opens; multitrack track names (`i.N.name`) become rename targets; on mounting a
  card or stick, each `*.wav.unfinished` name goes unquoted into a shell command for `wavfinalizer`
  (a name with `;` runs as root). On stock that reaches the whole eMMC system. The mod limits file
  commands to the mixer's own screen (deleting and renaming also to paired devices, recordings only in
  their folders, #48) and checks names and folders for everyone ([mod.md](mod.md), #47)
- Port 89's only Mackie client is app.js running in Node (the screen: `$NET.usePipeForNode=1`,
  `usePipePort=89`); browsers use socket.io on :80 [static]. It listens on all interfaces
  (`ss -ltnp` [device]). Closing it to the network needs a listener on **both** loopback addresses:
  app.js connects to `localhost`, which Node 18 resolves to `::1` first when the mixer has an IPv6
  address, so a 127.0.0.1-only listener cuts the screen off [static + qemu]. The mod does that
  (`DLZMOD_listen89`, #45) [device: `ss -ltn` shows `127.0.0.1:89` and `[::1]:89`, the screen
  connects, no restarts]
- dspserver and faderlink are socket.io clients on `localhost:80`, so port 80 itself must stay open:
  the mod tells the mixer's own connections (127.0.0.1 / ::1) from other devices per connection
  [static]
- The "System Lock" password lives in state key `lock` in `srv_data.json` (plain) [static]. It
  does not gate the web UI's commands: the server reads `lock` only in the hardware handlers `HWREC`,
  `PADPRSD` and `ALT`; a browser shows the lock overlay of a locked mixer, but its socket.io commands
  go through [static]. Since #45 only paired browsers get that far (`notes/mod.md`)

Implication: keep the mixer on a trusted LAN, and never port-forward it.

## Filesystem and persistence

- `/` is ext4 **read-write** (`noatime,commit=10,errors=remount-ro`), no overlay; `/tmp` is tmpfs [static]
- journald `Storage=volatile` (RAM), but rsyslog writes `/var/log/{syslog,kern.log,auth.log}` to
  eMMC; armbian-ramlog is **disabled** [static]. So the syslog of a session that ended in a freeze
  survives the reboot (unless the freeze stopped rsyslog first): the first place to look after a crash.
  But not its end: with `commit=10` and the kernel's delayed write-back of file data (no write-back
  setting in `/etc/sysctl*`, so the kernel's default of up to ~30 s) [static], a power cut loses the
  last ~10-40 s [guess, from those two], and a start that freezes early can leave nothing at all; the
  last line kept is the last write-back, not the moment of the freeze [device: a start that hung
  after its boot log copy (10.4 s) left no line in the card's syslog; its first 10 s survive only in
  the boot log copy]. Since #136 `dlzmod-bootreport` writes the syslog through (`sync <file>`) every
  10-15 s until the start has finished, and the boot log copy to DLZDATA comes only after that

### What changes at runtime

| Path | Written by | Notes |
|---|---|---|
| `/srv/srv_data.json` | server.js | Full mixer state, flushed every 3 s via `.tmp` + `mv` + `sync` |
| `/srv/presets/{eq,gate,rev,snaps}/*.json` | server.js | User presets/snapshots |
| `/srv/bankPlayer/default/loaded/` | server.js | Rebuilt from defaults on first boot and factory reset |
| `/root/.gd32-loaded-<fw>` | flash-gd32.sh | Marker; missing → GD32 is reflashed |
| `/root/.use-gowin-fpga`, `/root/.no-fpga-reflash` | flash-fpga.sh | Latter = skip one FPGA load |
| `/root/.sethostname`, `/root/.bt-name-set-v2` | faderlink | First-boot markers |
| `/root/.upgrade{success,fail,failcorrupt}` | upgradedaemon | Update result, read by server.js |
| `/root/.ndi/ndi-config.v1.json` | dspserver package / NDI_SAVE | NDI settings |
| `/etc/udev/rules.d/touchscreen.rules` | save-calibration.sh | Touch calibration |
| `/var/updtmp/` | upgradedaemon | Last update payload (wiped at the start of each update) |
| `/tmp/{upgradefile.txt,upgrade.upd,upgradefound.txt,init-done}` | server.js | tmpfs |
| `/tmp/mnt/<dev>` | server.js | USB/SD media mounts |
| `/tmp/thread_watchdog`, `/tmp/stream*.wav`, `/tmp/debug` | dspserver, glesgui | tmpfs |

### Mode/marker files in /root

| File | Effect |
|---|---|
| `.dlzlite` | XS mode everywhere. **Never remove** (wrong GD32/FPGA firmware) |
| `.gd32-loaded-firmware-dlzlite-154.bin` | GD32 is up to date; delete = reflash next boot |
| `.no-fpga-reflash` | Skip FPGA load once (deleted after use) |
| `.use-gowin-fpga` | Set after a successful FPGA load |

## Package ownership (what an update overwrites)

All from one vendor maintainer [static: `/var/lib/dpkg/status`]:

| Package | Ver. | Owns |
|---|---|---|
| `evolve-node` | 3297 | All of `/srv` except `presets/`, both node units |
| `evolve-node-wav` | 3266 | `/srv/bankPlayer/default/*.wav` |
| `glesgui` | 1338 | glesgui + weston-mackie units and binary, `/etc/weston.ini`, `/etc/dlz.png`, `/etc/dlzcreator.png`, `/usr/lib/firmware/bootsplash.armbian` |
| `dspserver` | 1338 | dspserver + wavfinalizer, `libndi.so.5.5.4`, `mixergraph{,-dlzlite}.js`, `/root/.ndi/ndi-config.v1.json` |
| `faderlink` | 521 | faderlink, gwprog, flash scripts + units, GD32 firmware, FPGA bitstreams |
| `upgradedaemon` | 1324 | Daemon + both units |
| `kernelupdate` | 1304 | `/var/kernelupdate/newdata.tar.gz`; postinst replaces kernel, initrd, **whole dtb dir**, `/usr/lib/modules`, bootsplash |
| `avahi` | 1 | Custom avahi build |
| `xorgmesawayland` | 1 | Weston, Xwayland, Mesa, libdrm |
| `nodejs` | 18.18.2 | NodeSource |

Not owned by any package: `openocd`, `jam`, `ts-calibrate.sh`, `save-calibration.sh`.
Updates run `dpkg -i --force-overwrite` or arbitrary `upgrade.sh`, so assume **any** modded file can
be replaced. Details: [components/firmware-update.md](components/firmware-update.md).
