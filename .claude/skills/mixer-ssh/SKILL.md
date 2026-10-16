---
name: mixer-ssh
description: SSH to your mixer (the DLZ Creator Modded card's running system) for read-only diagnostics - reading logs (install, boot, journal), unit states, boot timing, mounts, I/O counters, fetching files to the PC. Read-only by default and enforced by its wrapper; anything that changes state needs the user's explicit confirmation of that exact command in the current turn. Use when the user says SSH is on, gives the mixer's address, or asks to look at / fetch something on the mixer ("check the mixer", "get the install log over ssh", "what does the mixer say").
---

# mixer-ssh

Talk to the running mixer over SSH, **read-only**. The mixer is a real device in use: one wrong
write can cost the mixer or its user's data. Look, never touch, unless the user says yes to the
exact command first.

## Connect

Everything runs from WSL distro **Ubuntu** through `dlz-ssh.sh` (next to this file), from the repo
root, with `MSYS_NO_PATHCONV=1` in Git Bash:

```bash
W="MSYS_NO_PATHCONV=1 wsl -d Ubuntu -e bash .claude/skills/mixer-ssh/dlz-ssh.sh"
$W show                                    # stored address? password this session?
$W host <ip or name>                       # when none is stored or the user gives a new one
printf '%s\n' '<password>' | $W pass        # once per session, on stdin (WSL /tmp only)
$W run 'uptime; findmnt -no SOURCE /'      # read-only command; prints [mixer: root@<address>]
$W get <remote file> build/device-logs/<name>   # copy to the PC (git-ignored)
$W forget                                  # at the end of the session (--all: the address too)
```

- Start with `show`. **Address**: stored in WSL `~/.config/dlz-mixer-ssh/host` (outside the
  repo, kept across sessions, never in notes or memory). None stored, a connection that fails, or a
  different mixer or network: ask the user for the address (IP, or the network name such as
  `mackie-dlz-creator-xs.local`) and store it with `host`. Say which address is used when it was
  stored in an earlier session. User `root`.
- **Password**: only from the user, in this conversation, for this session; never write it into
  the repo, notes, memory or any command line. It goes to `pass` on stdin, through the shell's own
  `printf` (a builtin, so it is on no command line in WSL: not `wsl`'s, not `ssh`'s, not
  `dlz-ssh.sh`'s); `pass` refuses an argument and stores
  it in a private `mktemp -d` folder (mode 700) that `forget` removes. When the user uses a test
  password, remind them to change it and turn SSH keep-on off before the mixer leaves home.
- SSH must be on (Settings, Network, SSH). Connection refused or timeout: ask the user, do not
  scan the network.
- Host keys go to the same private folder: each install makes a new card with new keys, so a changed key
  after a reinstall is expected (`forget` clears it). A changed key *without* a reinstall: stop and
  tell the user.

## Read-only: allowed without asking

Reading files and state, small outputs:

- files: `cat`, `head`, `tail`, `less`-free reads, `ls`, `stat`, `find -xdev` (bounded with
  `-maxdepth`), `grep`, `wc`, `md5sum`/`sha256sum` of small files, `file`
- system: `uptime`, `uname -a`, `cat /etc/os-release`, `free -m`, `df -h`, `ps`, `top -bn1`,
  `vmstat 1 <n>` (n <= 30), `cat /proc/...`, `cat /sys/...`, `dmesg`, `lsblk`, `findmnt`,
  `blkid -p`, `ip addr`, `ip route`, `ss -ltnp`, `lsusb`; swap: `cat /proc/swaps` (`swapon` is refused: without
  `--show` it switches swap on)
- systemd: `systemctl status|show|is-active|is-enabled|list-units|list-unit-files|cat`,
  `journalctl` (with `-b`, `-u`, `-n`, `--no-pager`; never `--vacuum/--rotate/--flush`),
  `systemd-analyze`, `systemd-analyze blame|critical-chain`
- copying a file **to the PC** with `get` (reads on the mixer; small files, logs)

The wrapper refuses commands that look like writes (`rm`, `mv`, `cp`, `dd`, `tee`, `>` to a file,
`mount`, `systemctl start/stop/...`, `kill`, `apt`, interpreters like `python3`/`bash`, and more:
`WRITE_RE` in the script; command words count only where a command starts, so a unit name like
`flash-fpga` as an argument is fine). A refusal is a stop sign, not an obstacle: do not rephrase the
command to get past it. A refused *read* is a false positive in the wrapper: fix the pattern, add the
case to `test-guard.sh` (offline, never connects), run it until ALL OK, then rerun the same command.

## Anything else: strict confirmation

Before any command that changes state on the mixer (writes a file, restarts or stops a unit,
mounts, kills, changes a setting, installs, reboots), **ask first and wait**:

1. show the exact command, what it changes, how to undo it, and why it is needed;
2. continue only on an explicit yes from the user **in the current turn**, for that command only
   (a yes does not carry over to the next command or to a changed command);
3. run it with `DLZ_SSH_WRITE=1` in front of the `run`, nothing else in the same call.

Prefer the project's own paths over live edits: a change to the mod goes through the repo, the
`device-review` skill and the drop-in update (`DLZDATA/dlzmod-update/`), not through SSH.

## Never, not even with confirmation

The project's hard rules (`CLAUDE.md`) apply over SSH too; point to them and refuse:

- no write to the eMMC (`mmcblk1` on a card boot: user area, boot0/boot1, RPMB, ext_csd), no
  remount of it read-write, no `mmc` tool; the eMMC is read-only by design (`dlzmod-emmc-ro`)
- nothing that touches the GD32 (firmware, `/root/.gd32-loaded-*` markers, openocd, `flash-gd32`),
  `gwprog`/`flash-fpga`, or `/root/.dlzlite`
- no Mackie updater (`upgradedaemon`, `upgraderun`, `.upd` files)
- no load tests (big `dd`/copies, `fio`, stress): the mixer has ~120 MB free RAM, a GB copy over
  SSH once hung its screen. Measure in the PC rehearsal or from logs instead
- no secrets in output or notes: password hashes, SSH keys, Wi-Fi credentials, the `lock` value
  (state presence only)

## Where things are (card boot)

- The card is `mmcblk0` (p1 the system, p2 `DLZDATA`), the eMMC `mmcblk1`; check with `lsblk -o
  NAME,LABEL,SIZE,RO,MOUNTPOINT` before relying on it
- DLZDATA's mount point: find it (`findmnt -rno TARGET -S LABEL=DLZDATA` or `lsblk`); Mackie's
  server mounts it. Logs in its `dlzmod-logs/`: `install-N.txt` (the installer, highest N =
  newest), boot logs from `dlzmod-bootlog`, update results; the backup in `dlzmod-backup/`
- Fetched logs go to `build/device-logs/` (git-ignored, private), e.g. `install4.txt`
- Mod units: `dlzmod-*` (bootlog, cardcheck, emmc-ro, grow-data, update), Mackie's `evolve-node`
  (server.js/app), `dspserver`, `faderlink`, `flash-fpga`

## Known normal readings (do not chase these)

Check `notes/system.md` before calling a reading odd; the ones that come up every time:

- **Load average ~25 is normal**, not load [device, `notes/system.md`]: core 3 is
  dspserver's (`isolcpus=3`, busy 99 % by design, `nproc` = 3) and dozens of audio threads wake
  together ~590/s, so the load sample keeps catching them runnable. Real load: per-core
  `/proc/stat` over a few seconds (cores 0-2 measured ~8 % busy each)
- the eMMC (`mmcblk1`, its boot0/boot1) shows `RO 1`: the mod's read-only lock (`dlzmod-emmc-ro`)
- installer files on DLZDATA dated 1 Jan 1980: FAT's earliest date (the installer sets no clock);
  for other odd dates check the mixer's own clock (`date`) before reading anything into them

## Afterwards

Write what was learned into the notes with **[device]** and the date (`CLAUDE.md`: keep notes
current), never the password. At the end of the session: `forget`, and remind the user about the
test password and SSH keep-on.
