@echo off
rem The PC's release build in one double-click (Windows), in the pinned build environment
rem (install/release/buildenv.sh: Docker Desktop, from WSL distro Ubuntu): the RELEASE=1 package and
rem the installer image around it, unsigned (UNSIGNED=1, no key or passphrase on the PC): GitHub
rem builds and signs the release files from the tag (#158); release.sh compare checks that this build
rem of the same commit has the same bytes and that GitHub's signature fits them.
rem Output in build\release: dlz-installer-vX.Y.Z.img and dlzmod-vX.Y.Z.tar. Then a dev installer
rem image of the same commit (dev key from %USERPROFILE%\.dlzmod-keys, or set DLZMOD_KEYS_WIN=<folder>)
rem in build\devcard, so a new dev card starts at this version instead of updating from an old one
rem (build\devcard is this step's own folder: emptied first, so it holds only the newest dev image).
setlocal
set "REPO=%~dp0..\.."
if not defined DLZMOD_KEYS_WIN set "DLZMOD_KEYS_WIN=%USERPROFILE%\.dlzmod-keys"
for /f "usebackq delims=" %%p in (`wsl -d Ubuntu -e wslpath -a "%REPO%"`) do set "REPO_WSL=%%p"
for /f "usebackq delims=" %%p in (`wsl -d Ubuntu -e wslpath -a "%DLZMOD_KEYS_WIN%"`) do set "KEYS_WSL=%%p"
if not defined REPO_WSL (echo WSL distro Ubuntu not found & goto end)
for /f "usebackq delims=" %%v in ("%REPO%\VERSION") do set "VER=%%v"
echo Release build %VER% from %REPO% (unsigned, to compare with GitHub's)
echo.
wsl -d Ubuntu -u root --cd "%REPO_WSL%" -e env RELEASE=1 UNSIGNED=1 bash install/release/buildenv.sh bash -c "rm -rf build/release && bash install/release/mkpackage.sh && bash install/release/mkinstaller.sh build/release/dlzmod-%VER%"
if errorlevel 1 (echo. & echo RELEASE BUILD FAILED, see above & goto end)
echo.
echo Dev installer image of the same commit, in build\devcard
wsl -d Ubuntu -u root --cd "%REPO_WSL%" -e env "DLZMOD_SIGNING_KEYS=%KEYS_WSL%" bash install/release/buildenv.sh bash -c "rm -rf build/devcard && bash install/release/mkpackage.sh build/devcard && bash install/release/mkinstaller.sh $(ls -d build/devcard/dlzmod-%VER%-dev-*/) build/devcard"
if errorlevel 1 (echo. & echo DEV IMAGE FAILED, see above: the release build itself is done) else (echo. & echo Done: build\release\dlz-installer-%VER%.img and dlzmod-%VER%.tar, the dev image in build\devcard)
:end
echo.
pause
