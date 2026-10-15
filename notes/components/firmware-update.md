# Firmware updates (upgradedaemon)

Owned by package `upgradedaemon` 1324. `upgradedaemon` and `upgradedaemon.old` are identical (same md5).
All [static] unless tagged.

## upgradedaemon

- Written in **Nim** with the **Prologue 0.6.4** web framework; pure-Nim RSA (`rsa.nim`);
  an **RSA-2048 public key is embedded**
- Two modes:
  - **Service** (`upgradedaemon.service`, `Restart=always`): serves a "Firmware Upgrade" HTML page
    and `POST /upgrade` on `0.0.0.0`, signature in a base64 `ContentSign` header. Port not in the
    strings (Prologue default 8080) [guess]
  - **One-shot** `-f <file>`: run by `upgraderun.service`

## Flow from USB/SD

1. server.js sees a file containing `evolveupdate` (`*.upd`) on mounted media → `FIRMWARE_FOUND`
2. User confirms (`FIRMWARE_UPDATE`): server.js symlinks it to `/tmp/upgrade.upd`, writes the path
   to `/tmp/upgradefile.txt`, stops dspserver, `systemctl start upgraderun`
3. `upgraderun` stops dspserver, then runs `upgradedaemon -f` on the file named in
   `/tmp/upgradefile.txt` (the unit's ExecStart)
4. upgradedaemon checks the RSA signature, `rm -rf /var/updtmp`, copies the payload to
   `/var/updtmp/tempupload` and picks a handler by magic bytes:

| Magic | Handled as |
|---|---|
| `!<arch>` | `.deb` → `dpkg -i --force-overwrite` |
| `PK` | zip → `temppayload/`; runs `upgrade.sh` if present, else `dpkg -i --force-overwrite *.deb` |
| other | `chmod +x` and execute |

   Env `OFFLINE_INSTALL=1 MIXER_OFFLINE_UPGRADE=1`, output to `/tmp/execlog.txt`.
5. Result marker `/root/.upgrade{success,fail,failcorrupt}`, picked up by server.js and shown in the UI.

## v1.2 (build 1731) as found on the device

`/var/updtmp/tempupload` is a 119 MB **ARM ELF** (the "other → execute" path), a self-extracting
installer that unpacked six debs into `/var/updtmp/updatefiles/`: avahi 1, dspserver 1338,
evolvenode 3297, faderlink 521, glesgui 1338, kernelupdate 1304. The update file is
`evolveupdate-DLZ-Creator-XS-v1.2.0-b1731.upd`, no longer publicly downloadable; the system reports
it in `/srv/srv_data.json` as `"17.01.2024 (build 1731)"`. The older 1.0.2 `.upd` was a plain archive
of 4 `.deb` packages [static].

## What this means for modding

- Homemade `.upd` files are rejected (RSA) [guess: signature checked before any handler runs].
  Mods go in through our SD image, not through the updater.
- An official update can overwrite anything (`--force-overwrite`, arbitrary root code). It would
  also hit the **SD copy** if run while booted from SD. Never run Mackie updaters from SD.
- `kernelupdate` replaces the kernel, initrd, the whole dtb directory, `/usr/lib/modules` and the
  bootsplash.
