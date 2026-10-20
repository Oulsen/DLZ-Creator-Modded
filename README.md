# DLZ Creator Modded

An unofficial mod for the Mackie DLZ Creator and DLZ Creator XS. It runs from a microSD card in the
mixer: the mixer's own software stays as it is, and without the card the mixer starts normally.
Alpha, at your own risk: read [DISCLAIMER.md](DISCLAIMER.md) first.

## What the mod does

- **Recordings**: saved to the SD card by default, numbered across SD card and USB with unique
  names like `REC_0003_otter`, and downloaded to a computer over the network (after pairing,
  from the Media page)
- **Meters**: level before or after the fader, yellow and red zones, a dB scale
- **Screen**: the header bar can be hidden for more room; a "DLZ Creator Modded" tab in Settings;
  its own startup screens and a startup log for bug reports, with a report of each start (timings,
  errors, how the audio chips started)
- **Network**: Wi-Fi from the screen (with a USB Wi-Fi stick), remote login (SSH), and control from
  a computer's web browser after pairing with a PIN (phones and tablets not yet,
  [#52](https://github.com/Oulsen/DLZ-Creator-Modded/issues/52)); all off by default
- **Safety**: no firmware updates from the card, the mixer's internal storage is never changed
- **Updates** of the mod without losing recordings or settings, copied to the card or sent from a
  computer's web browser after pairing, installed only after you tap Install on the mixer's own
  screen
- **Fixes for stock bugs**: the recording crash after take 9,999; new recordings overwriting old
  ones; anyone on the network (or a prepared SD card or USB stick) changing files on the mixer;
  anyone on the network controlling the mixer without a PIN; the SD card or USB stick staying
  writable once it holds recordings, so switching off could damage it

What changed in each version: [CHANGELOG.md](CHANGELOG.md).

## Roadmap

What is planned and what is being worked on, all on GitHub:

- **[The board](https://github.com/users/Oulsen/projects/2)**: the planned bugs and features, from
  "to do" to "released"
- **[Milestones](https://github.com/Oulsen/DLZ-Creator-Modded/milestones)**: what goes into which
  version
- **[Issues](https://github.com/Oulsen/DLZ-Creator-Modded/issues)**: the details of each one, and new
  reports. Missing something? Open a feature request

## Which mixers

| Mixer | Firmware (Settings → About) | Status |
|---|---|---|
| DLZ Creator XS | 1.2.0, build 1731 | Supported, tested |
| DLZ Creator (full-size) | 1.2.0, build 1731 | Supported: installed and running on an owner's mixer (v0.1.0); our test mixer is an XS |
| Either model | another build, such as 1794 | Not supported: the installer can save a backup so we can add it |

## Install

You need the mixer, a microSD card (16 GB or more) and a card reader. Download the installer image
from the [latest release](https://github.com/Oulsen/DLZ-Creator-Modded/releases/latest), write it to
the card, put it in the mixer and follow the screen. Step by step, with pictures of every screen:
**[docs/INSTALL.md](docs/INSTALL.md)**.

## Is it safe?

- The mixer's internal storage is locked read-only during the install and while the mod runs; the
  mod never writes to it
- Take the card out and the mixer starts its normal Mackie software, as before
- A card belongs to the mixer it was installed on: in another mixer it keeps the sound hardware off
  and says so on the screen
- The installer also saves a backup of the mixer's internal storage onto the card
- On a network (cable or Wi-Fi), other devices can only control the mixer once you allow it
  (Settings → DLZ Creator Modded → Remote, off by default) and pair them with the PIN shown
  there. Open the mixer by its IP address or its `.local` name. The connection is not encrypted: only use it on networks you trust, not on an open café or
  venue Wi-Fi
- It is still an alpha made by one person: see [DISCLAIMER.md](DISCLAIMER.md)

## SD cards

The installer copies the mixer's software onto the card (about 7.7 GB); the rest of the card holds
your recordings. **Minimum 16 GB** (smaller cards are refused before anything is written), **32 GB
or more to work with recordings, 64 GB or more preferred**. The card's speed sets the install time
and how safely long multitrack recordings run.

The mod keeps the card's recordings part read-only except while it records, renames or deletes, so
switching off is safe then. A card that was switched off while writable (during a recording, or with
older versions and the stock software whenever it held recordings) stays marked as "not properly
unmounted". The mixer works with it as before; to clear the mark, put the card in a computer, **copy
your recordings off first**, then let the computer scan and fix the DLZDATA drive only. If the
computer offers to format a drive of the card, **never click Format**. A repair can shorten a
recording that was cut off.

### Known good cards

Cards that installed and ran the mod on a real mixer. Tested a card? Open an issue with the exact
name, size, mod version, install time (from `dlzmod-logs/install-N-vX.Y.Z.txt` on the card) and whether
recording worked.

| Card | Size | Mod version | Install time | Write speed during install | Recording |
|---|---|---|---|---|---|
| SanDisk Ultra microSDXC UHS-I, A1, U1, Class 10 | 128 GB | v0.1.0 | 9 min | about 13 MB/s | yes |
| Gigastone 4K UHD Video microSDXC, U3 | 64 GB | v0.1.0 | 9 min | about 11 MB/s | not tried yet |

### Known good Wi-Fi sticks

USB Wi-Fi sticks that connected on a real mixer with the mod. Other sticks may work too, but have not
been tried. Tested a stick? Open an issue with its exact name and version (on the box or the stick),
the mod version and whether Wi-Fi connected.

| Wi-Fi stick | Mod version | Wi-Fi | Notes |
|---|---|---|---|
| TP-Link Archer T3U (AC1300) | v0.1.0 | yes | the mixer's stock software does not recognise it, the mod does |

## Help and contact

- **Chat, questions, contact:** [Discord](https://discord.gg/Qa2fjzVbGp)
- **Bugs, feature requests and help with an install:** [GitHub issues](https://github.com/Oulsen/DLZ-Creator-Modded/issues)
- **A security hole:** privately, not in an issue: [SECURITY.md](SECURITY.md)

Never post dumps, Mackie files, Wi-Fi passwords or keys, in any of these places.

## For developers

How it works, the tools, building a card from source and the knowledge base:
**[docs/DEVELOPMENT.md](docs/DEVELOPMENT.md)**; how to help: [CONTRIBUTING.md](CONTRIBUTING.md).

## Legal

Our own code, notes and artwork are licensed under the [GPL-3.0](LICENSE). Mackie's software is not
covered: it is not in this repo and not in the downloads.

The installer image carries two GPL-2.0 programs from Debian: U-Boot (`u-boot-sunxi`
2025.01-3+deb13u1, with its built-in defaults and device tree changed by
[`install/release/uboot-safe.py`](install/release/uboot-safe.py)) and busybox (`busybox-static`
1.37.0-6+b9). Their source code: Debian's source packages of exactly these versions,
[u-boot](https://snapshot.debian.org/package/u-boot/2025.01-3%2Bdeb13u1/) and
[busybox](https://snapshot.debian.org/package/busybox/1%3A1.37.0-6/). A finished mod card starts
with the mixer's own bootloader, copied from the mixer.

Dumps contain Mackie/LOUD Audio copyrighted software. Keep them private; only share your own
scripts and patches.
