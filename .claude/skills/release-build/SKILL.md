---
name: release-build
description: Start the PC's release build (RELEASE=1 package + installer image, unsigned, in the pinned build environment, and a dev image of the same commit) in a PowerShell window for the user, check afterwards that build/release holds a clean build of HEAD, and at the release compare it with the files GitHub built and signed for the draft release. Use when the user asks for the release build, "the build script", an installer image for the mixer, or "build install N".
---

# release-build

GitHub builds and signs the release files from the tag (#158). The PC's build
(`install/release/build-release.cmd`) is the same commit in the same build environment
(`install/release/buildenv/`, Docker Desktop), unsigned: no key and no passphrase on the PC. Its
image is what goes onto the mixer for the test; at the release, `compare` proves that GitHub's
files are those bytes. The release key's passphrase is a GitHub secret: never ask for it in the
conversation or put it anywhere.

Run from the repo root in Git Bash:

```bash
bash .claude/skills/release-build/release.sh open    # commit check, then a new pwsh window
bash .claude/skills/release-build/release.sh check   # after the user says it is done
bash .claude/skills/release-build/release.sh compare vX.Y.Z   # at the release, step 5
```

## Before `open`

- **Commit, then build**: images only from a committed tree. `open` refuses changes or new files in
  `install/` or `VERSION` (the build itself refuses them too). Commit via `/commit` first.
- **Docker Desktop must run** (it does not start with Windows): ask the user to start it.
  `buildenv.sh` says "docker does not answer" otherwise. The first build after a Dockerfile change
  builds the image first (a few minutes).
- Parallel sessions: say which commit is built (HEAD) so nobody commits mid-build; another session
  working in its own worktree does not matter.
- Long-running tests in WSL may run on; the build only adds CPU load.

## While it runs

The window shows the version, the package and the image steps (`NOT SIGNED: UNSIGNED=1` is
expected), then the dev image of the same commit, then `Done: ...` or `RELEASE BUILD FAILED`
(`DEV IMAGE FAILED`: the release build is done, only the dev image is missing), and waits for a key.
It stays open (`-NoExit`). Output in `build\release`: `dlz-installer-vX.Y.Z.img`, `dlzmod-vX.Y.Z.tar`
(the folder is emptied first). In `build\devcard`: `dlz-installer-vX.Y.Z-dev-<commit>.img`, with the
dev key and without `RELEASE=1`, for a new dev card, so it starts at this version instead of
updating from an old image. It is never a release file, and its first time onto a mixer goes
through the `device-review` skill like any image.

## After: `check`

`check` reads `build/release/dlzmod-<VERSION>/package.env`: the commit must be HEAD without
`+dirty`, and tar and image must be newer than the HEAD commit (the image newer than the tar). Any
`STALE`, `DIRTY`, `OLDER` or `missing` line: do not hand over the image; find out why (wrong
window, failed step, a commit after the build) and build again. A missing dev image is only a note
(`note: no dev image`, `check` still says OK): the release files are not affected; build again when
a new dev card needs it.

Then nothing goes onto a card yet: run the `device-review` skill on exactly this build (tier from
the diff against the last version that passed on the device), handle its findings, and only then
give the flashing instructions. Images are handed over as paths in the repo's `build\release`
folder, never as WSL paths.

## At the release: `compare`

After the tag is pushed, its workflow makes the draft release and its job `build-release` waits for
the maintainer's approval (GitHub: Actions, the run, "Review deployments"); then it builds, signs
and attaches the files (`docs/DEVELOPMENT.md`, "Releases" step 5). `compare vX.Y.Z` then downloads
the draft, runs `sha256sum -c SHA256SUMS`, checks that the draft holds exactly the files
`SHA256SUMS` names (the image always; the update `.tar` + `.tar.sig` only for a drop-in release),
that its image and tar are this PC's build byte for byte, and that the `.sig` verifies with
`install/keys/release.pub` over the PC's tar. It refuses a build that is not of the tagged commit
and a release that is not a draft. `DIFFERENT` or a failed signature: never publish; the build
environment differs between the two sides, find out why. A drop-in release: test the update from
the draft's `.tar` + `.tar.sig` on the mixer before publishing. The notes' first line, the
highlights (posted in Discord on publishing) and publishing stay with the maintainer, on GitHub. On
a test tag (`vX.Y.Z-testN`) `compare` works the same, on unsigned files.
