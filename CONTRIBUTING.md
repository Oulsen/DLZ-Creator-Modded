# Contributing

Thanks for helping. Everything goes through
[GitHub issues](https://github.com/Oulsen/DLZ-Creator-Modded/issues); chat is on the Discord linked
in the [README](README.md).

## Reporting a bug or asking for help

Pick a template (bug, feature, help with an install) and fill it in. What helps most:

- The mixer (DLZ Creator or XS), its firmware build (Settings → About) and the mod version (Settings →
  DLZ Creator Modded)
- What you did, what you expected and what happened instead; a photo of the screen if it shows
  something
- The log files from the card's `dlzmod-logs/` folder (the card's part named `DLZDATA`, or `DLZLOG`
  after a stopped install)

**Never post** the backup (`dlzmod-backup/`), dumps, Mackie files, Wi-Fi passwords or keys. The backup
holds your mixer's settings, including the lock PIN.

Found a security hole (a way into the mixer, or around the mod's safety locks)? Not in an issue:
report it privately, see [SECURITY.md](SECURITY.md).

Tested a microSD card? Open an issue with the card's exact name and size, the mod version, the
install time (from `dlzmod-logs/install-N-vX.Y.Z.txt`) and whether recording worked; it goes into the
README's list of known good cards.

## Code and notes

Start with [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md), "Getting started": it gets you from a fresh
clone to a dump, the tests and the UI on your PC. Then:

1. Pick or open an issue first, so the work is agreed before it is done.
2. Fork, branch from `develop`, and open the pull request into `develop` with `Refs #N` (not
   `Fixes #N`: the maintainer closes the issue after the merge). GitHub suggests `main`, the release branch: switch
   the base to `develop`.
3. Follow the rules in DEVELOPMENT.md, "Rules for notes and code": no Mackie code (describe it and
   point to it), nothing from a dump, confidence tags on observations, notes describe the current
   state.
4. Run the tests that cover your change ([tests/README.md](tests/README.md)) and say in the pull
   request which ones ran and what you tested on a mixer, if anything. GitHub runs the checks that
   need no mixer and no dump on every pull request by itself, and the maintainer reviews every pull
   request before it is merged.
5. Keep the safety rules of [notes/modding-guide.md](notes/modding-guide.md): never write to the
   eMMC, never touch the GD32 or `/root/.dlzlite`. A change that runs on the mixer is reviewed and
   tested on a real mixer before it is merged.

By contributing you agree that your work is published under the project's [GPL-3.0](LICENSE).
