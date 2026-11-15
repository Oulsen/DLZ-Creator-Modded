@echo off
rem The PC's release build in one double-click (Windows): install/release/build-release.sh in WSL
rem distro Ubuntu, in the pinned build environment (Docker Desktop). The RELEASE=1 package and the
rem installer image around it, unsigned, in build\release; then a dev installer image of the same
rem commit in build\devcard (dev key from %USERPROFILE%\.dlzmod-keys, or set DLZMOD_KEYS_WIN=<folder>).
rem Claude Code runs the same script with release.sh build (.claude/skills/release-build).
rem Not from a git worktree (its .git file names a Windows path WSL cannot follow): release.sh build.
setlocal
set "REPO=%~dp0..\.."
rem a worktree's .git is a file naming a Windows path, which WSL's git cannot follow
if not exist "%REPO%\.git\HEAD" (echo A git worktree: run the build with release.sh build there ^(Claude Code^), not this file. & goto end)
if not defined DLZMOD_KEYS_WIN set "DLZMOD_KEYS_WIN=%USERPROFILE%\.dlzmod-keys"
for /f "usebackq delims=" %%p in (`wsl -d Ubuntu -e wslpath -a "%REPO%"`) do set "REPO_WSL=%%p"
for /f "usebackq delims=" %%p in (`wsl -d Ubuntu -e wslpath -a "%DLZMOD_KEYS_WIN%"`) do set "KEYS_WSL=%%p"
if not defined REPO_WSL (echo WSL distro Ubuntu not found & goto end)
wsl -d Ubuntu -u root --cd "%REPO_WSL%" -e bash install/release/build-release.sh "%KEYS_WSL%"
:end
echo.
pause
