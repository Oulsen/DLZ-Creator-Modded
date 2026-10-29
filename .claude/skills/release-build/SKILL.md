---
name: release-build
description: Run the PC's release build (RELEASE=1 package + installer image, unsigned, in the pinned build environment, and a dev image of the same commit) in the background in Claude Code, report its steps, check that build/release holds a clean build of HEAD that is still develop's tip, check again right before main is moved, and at the release compare it with the files GitHub built and signed for the draft release. Use when the user asks for the release build, "the build script", an installer image for the mixer, or "build install N".
---

# release-build

GitHub builds and signs the release files from the tag (#158). The PC's build
(`install/release/build-release.sh`) is the same commit in the same build environment
(`install/release/buildenv/`, Docker Desktop), unsigned: no key and no passphrase on the PC. Its
image is what goes onto the mixer for the test; at the release, `compare` proves that GitHub's
files are those bytes. The release key's passphrase is a GitHub secret: never ask for it in the
conversation or put it anywhere.

Run from the repo root in Git Bash:

```bash
bash .claude/skills/release-build/release.sh build   # commit check, the build, then check (background)
bash .claude/skills/release-build/release.sh check   # again, any time: still HEAD and develop's tip?
bash .claude/skills/release-build/release.sh ready   # right before main is moved (Releases, step 3)
bash .claude/skills/release-build/release.sh compare vX.Y.Z   # at the release, step 5
```

`release.sh open` runs the same build in a new PowerShell window instead (`build-release.cmd`, also
a double-click in Explorer), for the user who wants to watch it there.

## Before `build`

- **Commit, then build**: images only from a committed tree. `build` refuses changes or new files in
  `install/` or `VERSION` (the build itself refuses them too). Commit via `/commit` first.
- **Docker Desktop must run** (it does not start with Windows): ask the user to start it.
  `buildenv.sh` says "docker does not answer" otherwise. The first build after a Dockerfile change
  builds the image first (a few minutes).
- Parallel sessions: say which commit is built (HEAD) so nobody commits mid-build; another session
  working in its own worktree does not matter.
- **Nothing is merged into `develop` from the build until the tag**: the built commit must stay
  `develop`'s tip, so that the tested image is what goes to `main` (v0.3.0: #175 landed during the
  build, `main` got 25f5c9f and #178 had to be closed by hand). Say so to the user at the start;
  `check` and `ready` stop when `develop` moved.
- Long-running tests in WSL may run on; the build only adds CPU load.

## While it runs

Start `build` with `run_in_background`, and follow its log with a Monitor (up to 30 minutes):

```bash
tail -n +1 -f build/release-build.log | grep --line-buffered -E '^== |^release build|^building the build environment|FAILED|^Done:|^OK:|^(STALE|DIRTY|OLDER|DEVELOP MOVED|NOT DEVELOP|missing)'
```

Report each step to the user as it starts: `== 1/2` the release build (the package and the image;
`NOT SIGNED: UNSIGNED=1` in the log is expected), `== 2/2` the dev image of the same commit,
`== check`. The first build after a Dockerfile change shows `building the build environment` and
its steps in the log. The end: `Done: ...` then the check's result, or `RELEASE BUILD FAILED`
(`build` stops, read the log), or `DEV IMAGE FAILED` (the release build is done, only the dev image
is missing; `build` checks all the same). The background task's exit code is the check's. Output in
`build\release`: `dlz-installer-vX.Y.Z.img`, `dlzmod-vX.Y.Z.tar`
(the folder is emptied first). In `build\devcard`: `dlz-installer-vX.Y.Z-dev-<commit>.img`, with the
dev key and without `RELEASE=1`, for a new dev card, so it starts at this version instead of
updating from an old image. It is never a release file, and its first time onto a mixer goes
through the `device-review` skill like any image.

## After: `check`

`build` runs `check` itself; run it again before the device review and after a pause. `check` reads `build/release/dlzmod-<VERSION>/package.env`: the commit must be HEAD without
`+dirty`, and tar and image must be newer than the HEAD commit (the image newer than the tar). Any
`STALE`, `DIRTY`, `OLDER` or `missing` line: do not hand over the image; find out why (failed
step, a commit after the build) and build again. `check` also fetches `origin`: `DEVELOP MOVED`
names the commits merged into `develop` since the build, `NOT DEVELOP` means the build is not of
`develop` at all; either way this build is not the release, build `develop`'s tip again. A missing dev image is only a note
(`note: no dev image`, `check` still says OK): the release files are not affected; build again when
a new dev card needs it.

Then nothing goes onto a card yet: run the `device-review` skill on exactly this build (tier from
the diff against the last version that passed on the device), handle its findings, and only then
give the flashing instructions. Images are handed over as paths in the repo's `build\release`
folder, never as WSL paths.

## Before `main` moves: `ready`

Right before the maintainer runs `git push origin <commit>:main` (`docs/DEVELOPMENT.md`,
"Releases", step 3): `ready` fetches `origin` and says `READY` with the push command only when the
build is clean, still `origin/develop`'s tip and `main` can fast-forward to it. Otherwise
`NOT READY` and why: `main` stays where it is.

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
