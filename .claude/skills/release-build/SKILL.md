---
name: release-build
description: Start the signed release build (RELEASE=1 package + installer image, and a dev image of the same commit) in a PowerShell window for the user, check afterwards that build/release holds a clean, signed build of HEAD, and at the release attach the tested files to the draft GitHub release. Use when the user asks for the release build, "the build script", an installer image for the mixer, or "build install N".
---

# release-build

The release build (`install/release/build-release.cmd`) signs the package with the release key, so
it asks for `release.pem`'s passphrase. Only the user types it, in their own window: never ask for
it in the conversation, never put it on a command line or in `DLZMOD_SIGNING_PASS`.

Run from the repo root in Git Bash:

```bash
bash .claude/skills/release-build/release.sh open    # commit check, then a new pwsh window
bash .claude/skills/release-build/release.sh check   # after the user says it is done
bash .claude/skills/release-build/release.sh upload vX.Y.Z [--with-update]   # at the release, step 5
```

## Before `open`

- **Commit, then build**: images only from a committed tree. `open` refuses changes or new files in
  `install/` or `VERSION` (the build itself refuses them too). Commit via `/commit` first.
- Parallel sessions: say which commit is built (HEAD) so nobody commits mid-build; another session
  working in its own worktree does not matter.
- Long-running tests in WSL may run on; the build only adds CPU load.

## While it runs

The window shows the version, the key folder, a hidden passphrase prompt, the package and the
image steps, then the dev image of the same commit, then `Done: ...` or `RELEASE BUILD FAILED`
(`DEV IMAGE FAILED`: the release build is done, only the dev image is missing), and waits for a key.
It stays open (`-NoExit`). Output in `build\release`: `dlz-installer-vX.Y.Z.img`, `dlzmod-vX.Y.Z.tar`
+ `.sig` (an older build of the same version is overwritten). In `build\devcard`:
`dlz-installer-vX.Y.Z-dev-<commit>.img`, with the dev key and without `RELEASE=1`, for a new dev card,
so it starts at this version instead of updating from an old image. It is never a release file, and
its first time onto a mixer goes through the `device-review` skill like any image.

## After: `check`

`check` reads `build/release/dlzmod-<VERSION>/package.env`: the commit must be HEAD without
`+dirty`, the `.sig` must exist, and tar, sig and image must be newer than the HEAD commit (the image
newer than the tar). Any `STALE`, `DIRTY`, `OLDER` or `missing` line: do not hand over the image;
find out why (wrong window, failed step, a commit after the build) and build again. A missing dev
image is only a note (`note: no dev image`, `check` still says OK): the release files are not
affected; build again when a new dev card needs it.

Then nothing goes onto a card yet: run the `device-review` skill on exactly this build (tier from
the diff against the last version that passed on the device), handle its findings, and only then
give the flashing instructions. Images are handed over as paths in the repo's `build\release`
folder, never as WSL paths.

## At the release: `upload`

After the tag is pushed and its workflow has made the draft release (`docs/DEVELOPMENT.md`,
"Releases" step 5), `upload vX.Y.Z` attaches `dlz-installer-vX.Y.Z.img` with a new `SHA256SUMS`
(`--with-update`: the update `.tar` + `.tar.sig` too, only for a drop-in release). It refuses a build
that is not of the tagged commit and a release that is not a draft (a published release is never
changed from here). Then it downloads the files again and checks that the draft holds exactly these
files and that `sha256sum -c SHA256SUMS` passes. The notes' first line, the highlights (posted in Discord on publishing) and publishing stay with the
maintainer, on GitHub.
