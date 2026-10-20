# The mod's own changes to a rootfs, shared by card-core.sh (a new card, on its mounted rootfs) and
# sd-system/dlzmod-update (an update on the running mod card, rootfs = /), so both apply the same
# files the same way. Sourced (bash); needs MNT (the rootfs, "" for the running system) and TOOLS (the
# mod files: patch.py, modversion.py, app-mod/, server-mod/, sd-system/; VERSION next to them).
# Callers run with set -e: any failing step stops them.
#
# Every file is replaced atomically (written next to the target, flushed, renamed over it) and only
# when it differs: on the running card a power cut must leave the old file or the new one, never an
# empty guard (the next start runs flash-gd32/upgradedaemon before any repair).

# put_file <mode> <source> <target>
put_file() {
  local tmp=$3.dlzmod-new
  if [ -f "$3" ] && [ ! -L "$3" ] && cmp -s "$2" "$3" && [ "$(stat -c %a "$3")" = "$1" ]; then return 0; fi
  mkdir -p "$(dirname "$3")"
  cp "$2" "$tmp"
  chmod "$1" "$tmp"
  sync "$tmp"
  mv -f "$tmp" "$3"
}
# put_link <link target> <link path>
put_link() {
  [ -L "$2" ] && [ "$(readlink "$2")" = "$1" ] && return 0
  mkdir -p "$(dirname "$2")"
  ln -sfn "$1" "$2.dlzmod-new"
  mv -Tf "$2.dlzmod-new" "$2"
}

# Brick guards (notes/modding-guide.md, Brick risks), the first-boot DLZDATA grower, the report of
# each start and its boot log for DLZDATA (dlzmod-logs/, readable in a card reader), the network log
# of a development card and the drop-in update. The guards go first
# and are flushed before anything else changes
install_sd_system() {
  local s=$TOOLS/sd-system u f
  # the FPGA loader's gate first: its drop-in calls it (no FPGA load from a card in another mixer)
  put_file 755 "$s/dlzmod-cardcheck" "$MNT/usr/local/sbin/dlzmod-cardcheck"
  for u in flash-gd32 flash-fpga upgradedaemon upgraderun dspserver; do
    put_file 644 "$s/$u.service.d/dlzmod.conf" "$MNT/etc/systemd/system/$u.service.d/dlzmod.conf"
  done
  put_file 755 "$s/dlzmod-emmc-ro" "$MNT/usr/local/sbin/dlzmod-emmc-ro"
  put_file 644 "$s/dlzmod-emmc-ro.service" "$MNT/etc/systemd/system/dlzmod-emmc-ro.service"
  put_link /etc/systemd/system/dlzmod-emmc-ro.service "$MNT/etc/systemd/system/sysinit.target.wants/dlzmod-emmc-ro.service"
  # and the eMMC locked whenever it appears, also after that unit ran (sd-system/60-dlzmod-emmc-ro.rules)
  put_file 644 "$s/60-dlzmod-emmc-ro.rules" "$MNT/etc/udev/rules.d/60-dlzmod-emmc-ro.rules"
  sync
  # dspserver waits for server.js before starting (dlzmod-wait-hub, its drop-in above)
  for f in dlzmod-grow-data dlzmod-bootlog dlzmod-bootreport dlzmod-wait-hub dlzmod-netlog; do
    put_file 755 "$s/$f" "$MNT/usr/local/sbin/$f"
  done
  for f in dlzmod-grow-data dlzmod-bootreport dlzmod-netlog; do
    put_file 644 "$s/$f.service" "$MNT/etc/systemd/system/$f.service"
    put_link "/etc/systemd/system/$f.service" "$MNT/etc/systemd/system/multi-user.target.wants/$f.service"
  done
  # #136: the boot log is no longer a step of the start (dlzmod-bootreport starts it at the end)
  put_file 644 "$s/dlzmod-bootlog.service" "$MNT/etc/systemd/system/dlzmod-bootlog.service"
  rm -f "$MNT/etc/systemd/system/multi-user.target.wants/dlzmod-bootlog.service"
  # the update installs its own new copy itself, last, once everything else passed its checks
  [ "${DLZMOD_SELF_LAST:-}" = 1 ] || install_update_unit
  # USB Wi-Fi sticks the stock driver drives but does not list (sd-system/90-dlzmod-usb-wifi.rules)
  put_file 644 "$s/90-dlzmod-usb-wifi.rules" "$MNT/etc/udev/rules.d/90-dlzmod-usb-wifi.rules"
  # Realtek sticks that start as a driver CD are ejected into Wi-Fi mode (sd-system/70-dlzmod-wifi-zerocd.rules)
  put_file 755 "$s/dlzmod-zerocd-eject" "$MNT/usr/local/sbin/dlzmod-zerocd-eject"
  put_file 644 "$s/70-dlzmod-wifi-zerocd.rules" "$MNT/etc/udev/rules.d/70-dlzmod-wifi-zerocd.rules"
  # SSH makes this card's own host keys when it starts (ssh.service.d/dlzmod.conf)
  put_file 644 "$s/ssh.service.d/dlzmod.conf" "$MNT/etc/systemd/system/ssh.service.d/dlzmod.conf"
  # sshd only via ssh.service, whose drop-in decides when: stock's socket-activated ssh@.service
  # (ssh.socket, not enabled in stock) would skip that check, so it is masked
  put_link /dev/null "$MNT/etc/systemd/system/ssh.socket"
  sync
  # here and not as a step of its own: an older updater on the card only calls the steps it knew
  remove_factory_access
  echo "guards: eMMC read-only unit, GD32 flash and Mackie updater disabled, FPGA load only in this card's mixer; DLZDATA grower, boot log, update and dspserver start guard enabled"
}

# Mackie's factory network access, removed from the card once (a new card, or the first update that
# brings this; the marker keeps keys and settings the owner adds later). The eMMC keeps its own.
# - the saved factory Wi-Fi network (netplan turns it into a NetworkManager connection at each start)
# - Mackie's root login keys: the whole stock file, or on a card where sd.env added a key, the
#   stock lines (kept in authorized_keys.orig by card-core.sh's install_ssh)
# - the SSH host keys every mixer shares (new ones per card when SSH starts, ssh.service.d/dlzmod.conf)
# - SSH itself: off until the owner turns it on with their own password (Mod page)
# A power cut part-way leaves no marker, so the next run does it again (each step can be repeated).
remove_factory_access() {
  local mark=$MNT/var/lib/dlzmod-update/factory-access-removed keys=$MNT/root/.ssh/authorized_keys tmp dev=0
  if [ -e "$mark" ]; then
    echo "factory access: removed before"
    return 0
  fi
  rm -f "$MNT/etc/netplan/wlan0.yaml"
  # a developer card (sd.env added a key, the stock file kept as .orig): its SSH stays on
  [ -f "$keys.orig" ] && dev=1
  if [ -f "$keys" ]; then
    tmp=$keys.dlzmod-new
    if [ -f "$keys.orig" ]; then
      grep -vxF -f "$keys.orig" "$keys" > "$tmp" || true
    else
      : > "$tmp"
    fi
    chmod 600 "$tmp"
    sync "$tmp"
    mv -f "$tmp" "$keys"
    rm -f "$keys.orig"
  fi
  rm -f "$MNT"/etc/ssh/ssh_host_*
  if [ "$dev" = 0 ]; then
    rm -f "$MNT/etc/systemd/system/multi-user.target.wants/ssh.service"
    # an update on the running card: the sshd started at this boot still holds Mackie's keys
    if [ -z "$MNT" ]; then timeout 20 systemctl stop ssh.service || true; fi
  fi
  sync
  tmp=$(mktemp)
  echo "factory Wi-Fi network, Mackie's SSH keys and host keys removed, SSH off" > "$tmp"
  put_file 644 "$tmp" "$mark"
  rm -f "$tmp"
  sync
  echo "factory access: Wi-Fi network, SSH keys and host keys removed, SSH off until turned on"
}

# the drop-in update itself (sd-system/dlzmod-update)
install_update_unit() {
  put_file 755 "$TOOLS/sd-system/dlzmod-update" "$MNT/usr/local/sbin/dlzmod-update"
  put_file 644 "$TOOLS/sd-system/dlzmod-update.service" "$MNT/etc/systemd/system/dlzmod-update.service"
  put_link /etc/systemd/system/dlzmod-update.service "$MNT/etc/systemd/system/multi-user.target.wants/dlzmod-update.service"
  sync
}

# Our UI mods into /srv/app.js and the media/firmware guards into /srv/server.js (patch.py patches
# from the kept *.orig every time, so it can run again; it writes atomically)
apply_patches() {
  python3 "$TOOLS/patch.py" app "$MNT/srv/app.js"
  python3 "$TOOLS/patch.py" server "$MNT/srv/server.js"
}

# The Mod page's settings with their defaults in the hub state from the first boot. Without them the
# hub learns a key only when the UI first sends it, and in the PC sandbox that was once a 0 at startup
# (meter mode "Mackie" instead of the default "Both"). Defaults come from DLZMOD_keys() in
# app-mod/dlzmod.js (one source); only missing keys are added, the rest of the file stays as it is.
set_mod_defaults() {
  local f=$MNT/srv/srv_data.json
  [ -f "$f.orig" ] || put_file "$(stat -c %a "$f")" "$f" "$f.orig"
  python3 - "$f" "$TOOLS/app-mod/dlzmod.js" <<'PY'
import json, os, re, sys
f, js = sys.argv[1:]
m = re.search(r"function DLZMOD_keys\(\) \{\s*return (\{[^}]*\});", open(js, encoding="utf-8").read())
if not m:
    sys.exit("dlzmod.js: DLZMOD_keys() not found")
defaults = json.loads(m.group(1))
text = open(f, encoding="utf-8").read()
data = json.loads(text)
missing = {k: v for k, v in defaults.items() if k not in data}
if missing:
    i = text.index("{") + 1
    sep = "," if data else ""
    new = text[:i] + ",".join(f"\n  {json.dumps(k)}: {json.dumps(v)}" for k, v in missing.items()) + sep + text[i:]
    json.loads(new)   # still valid JSON, or the build stops here
    tmp = f + ".dlzmod-new"   # atomic: a power cut leaves the old state or the new one
    with open(tmp, "w", encoding="utf-8", newline="") as o:
        o.write(new)
        o.flush()
        os.fsync(o.fileno())
    os.chmod(tmp, os.stat(f).st_mode & 0o7777)
    os.replace(tmp, f)
print("srv_data.json: mod defaults " + (", ".join(f"{k}={v}" for k, v in missing.items()) or "already present"))
PY
}

# the mod version this card carries (the drop-in update refuses older packages), and the same with
# the build for people ("v0.1.0 (dev-b2f2852)"; a release or a PC build: the version alone), which
# the server mod compares with what the screen last showed (the update popup)
record_version() {
  local d=$MNT/var/lib/dlzmod-update build="" tmp
  put_file 644 "$TOOLS/../VERSION" "$d/version"
  [ -f "$TOOLS/../package.env" ] && build=$(sed -n 's/^BUILD=//p' "$TOOLS/../package.env")
  tmp=$(mktemp)
  if [ -n "$build" ] && [ "$build" != release ]; then
    printf '%s (%s)\n' "$(cat "$TOOLS/../VERSION")" "$build" > "$tmp"
  else
    cat "$TOOLS/../VERSION" > "$tmp"
  fi
  put_file 644 "$tmp" "$d/installed"
  rm -f "$tmp"
}

# a fresh install: the version it put on the card counts as shown, no "updated" popup at the first start
mark_version_shown() {
  local d=$MNT/var/lib/dlzmod-update
  put_file 644 "$d/installed" "$d/shown"
}
