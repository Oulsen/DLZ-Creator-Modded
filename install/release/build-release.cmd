@echo off
rem Release build in one double-click (Windows): RELEASE=1 package signed with the release key, then
rem the installer image around it, in WSL (distro Ubuntu, as root). Asks the passphrase of
rem release.pem itself, in this window (hidden). The private keys are in %USERPROFILE%\.dlzmod-keys
rem (mkkeys.sh); another folder: set DLZMOD_KEYS_WIN=<folder> before starting this.
rem Output in build\release: dlz-installer-vX.Y.Z.img, dlzmod-vX.Y.Z.tar and .tar.sig. Then a dev
rem installer image of the same commit (dev key, without RELEASE=1) in build\devcard, so a new dev
rem card starts at this version instead of updating from an old one.
setlocal
set "REPO=%~dp0..\.."
if not defined DLZMOD_KEYS_WIN set "DLZMOD_KEYS_WIN=%USERPROFILE%\.dlzmod-keys"
for /f "usebackq delims=" %%p in (`wsl -d Ubuntu -e wslpath -a "%REPO%"`) do set "REPO_WSL=%%p"
for /f "usebackq delims=" %%p in (`wsl -d Ubuntu -e wslpath -a "%DLZMOD_KEYS_WIN%"`) do set "KEYS_WSL=%%p"
if not defined REPO_WSL (echo WSL distro Ubuntu not found & goto end)
for /f "usebackq delims=" %%v in ("%REPO%\VERSION") do set "VER=%%v"
echo Release build %VER% from %REPO_WSL%, keys in %KEYS_WSL%
echo.
wsl -d Ubuntu -u root --cd "%REPO_WSL%" -e env RELEASE=1 "DLZMOD_SIGNING_KEYS=%KEYS_WSL%" bash -c "bash install/release/mkpackage.sh && bash install/release/mkinstaller.sh build/release/dlzmod-%VER%"
if errorlevel 1 (echo. & echo RELEASE BUILD FAILED, see above & goto end)
echo.
echo Dev installer image of the same commit, in build\devcard
wsl -d Ubuntu -u root --cd "%REPO_WSL%" -e env "DLZMOD_SIGNING_KEYS=%KEYS_WSL%" bash -c "rm -rf build/devcard && bash install/release/mkpackage.sh build/devcard && bash install/release/mkinstaller.sh build/devcard/dlzmod-%VER% build/devcard"
if errorlevel 1 (echo. & echo DEV IMAGE FAILED, see above: the release build itself is done) else (echo. & echo Done: build\release\dlz-installer-%VER%.img and dlzmod-%VER%.tar + .sig, the dev image in build\devcard)
:end
echo.
pause
