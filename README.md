# DLZ Creator Modded

An unofficial mod for the Mackie DLZ Creator and DLZ Creator XS. It runs from a microSD card in the
mixer: the mixer's own software stays as it is, and without the card the mixer starts normally.
Alpha, at your own risk, not supported by Mackie, and it could void your mixer's warranty: read
[Is it safe?](#is-it-safe) and [DISCLAIMER.md](DISCLAIMER.md) first.

## What the mod does

The mod's own settings are in Settings → **DLZ Creator Modded**, on the tabs named in brackets
below. They all start as stock: turn on what you want.

### Recording

- Recordings go to the SD card by default
- Names that never repeat, numbered across SD card and USB: `REC_0003_otter`
- Download recordings to your computer over the network *(Media page, from a paired computer)*

### Meters and screen

- Meters that show the level before the fader, after it, or both *(Display)*
- Yellow and red zones and a dB scale on the meters *(Display)*
- Hide the header bar for more room; messages still show for a moment *(Display)*
- A high-contrast look, your own background and your own color for the faders, meters and what is
  selected *(Colors)*
- The mod's own startup screens

### Network and remote control

- Wi-Fi from the mixer's screen, with a USB Wi-Fi stick *(Network)*
- Control the mixer from a computer's web browser, after pairing with a PIN *(Remote)*; phones and
  tablets not yet ([#52](https://github.com/Oulsen/DLZ-Creator-Modded/issues/52))
- Remote login (SSH), for support and tinkering *(Network)*

### Updates and safety

- Update the mod without losing recordings or settings: copy the update to the card, or send it
  from a paired computer *(Mod)*
- An update installs only after you tap Install on the mixer's own screen
- Updates are signed; if a signing key ever leaks, an update withdraws it and the mixer refuses
  anything signed with it
- The mixer's internal storage is never changed, and no firmware updates run from the card
- Logs of the install and the last starts on the card, for bug reports *(the `dlzmod-logs`
  folder, readable in any card reader)*

### Fixes for stock bugs

- Recording no longer crashes after take 9,999
- New recordings no longer overwrite old ones
- Nobody on the network, and no prepared SD card or USB stick, can change files on the mixer
- Nobody on the network can control the mixer without a PIN
- The SD card or USB stick no longer stays writable once it holds recordings (switching off could
  damage it)
- The mixer no longer gets stuck while starting, held up by its screen and control software

What changed in each version: [CHANGELOG.md](CHANGELOG.md). What is coming: [Roadmap](#roadmap).

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

**For the mixer itself: it is built so that the mod cannot damage it, and taking the card out
undoes it.** For your recordings and your setup: it is alpha software, so expect bugs and keep
copies of what matters. And it is your own risk: Mackie does not support the mod, and installing it
could void your mixer's warranty.

### What protects your mixer

- **The mixer's own software is never changed.** Its internal storage is locked read-only during
  the install and while the mod runs. The mod lives only on the card.
- **Card out, stock mixer.** Switch off, take the card out, switch on: the normal Mackie software
  starts, as before.
- **A power cut during the install is harmless.** The card only becomes startable in the very last
  step; until then the mixer ignores it and starts normally. Start the install again.
- **A card works only in the mixer it was made on.** In another mixer, or after a Mackie update of
  the mixer itself, it keeps the sound hardware off and says so on the screen, so the mixer's sound
  parts never run with software that does not belong to them.
- **Only known firmware.** The installer refuses any firmware other than 1.2.0 build 1731.

### What can still go wrong

- **Bugs.** It is an alpha made by one person and tested on one mixer (an XS). A feature can
  misbehave or a start can hang; switching off and on, or taking the card out, gets you back.
- **Recordings.** An SD card can fail, and a bug can cost a take. Copy recordings you care about to
  a computer soon; don't use the mod as the only recorder for a show you cannot repeat.
- **The network.** The connection to the mixer is not encrypted. Other devices (cable or Wi-Fi) can
  only control the mixer once you allow it (Settings → DLZ Creator Modded → Remote, off by default)
  and pair them with the PIN shown there; they open it by its IP address or its `.local` name. Only
  do this on networks you trust, not on an open café or venue Wi-Fi.
- **Warranty.** See above; for problems with the mixer itself, take the card out before you
  contact Mackie.

### Your part

- Copy the backup the installer saves (`dlzmod-backup` on the card) to your computer and keep it
  private: it holds your settings, including the lock PIN.
- Install Mackie firmware updates only with the card taken out (the mod refuses them anyway).
- When the card is in your computer, never let Windows format a drive of it.

The full terms: [DISCLAIMER.md](DISCLAIMER.md).

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
