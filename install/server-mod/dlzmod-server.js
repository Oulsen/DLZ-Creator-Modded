// DLZ Creator Modded additions to Mackie's /srv/server.js, appended by install/patch.py.
// Only function declarations here: they are hoisted, so the patched Mackie code can call them
// before this part of the script has run.

// Recording names. Stock takes the first REC_NNNN in `ls -r` order plus one and falls back to
// REC_0001 on any shell error, without checking that the name is free; it also throws after
// REC_9999. Here the number is above every REC_<n> entry in the recordings folders of all inserted
// media (SD and USB: two media on one mixer never share a number; files and multitrack folders, any
// case: FAT is case-insensitive). The number alone repeats once a folder is emptied or on another
// mixer, so an animal keeps names apart (REC_0003_otter; a date and time variant may come back as an
// option). The REC_NNNN prefix stays first so stock firmware still counts these files.

// Pure part, tested by install/server-mod/test-dlzmod-server.js.
// entries: names in the folder the recording goes to; others: names in the recordings folders of
// the other media (only their numbers count); suffix: the animal ("" for none).
function DLZMOD_pickRecName(entries, suffix, others = []) {
  let highest = 0;
  for (const name of entries.concat(others)) {
    const m = /^rec_(\d{4,})/i.exec(name);
    if (m) highest = Math.max(highest, Number(m[1]));
  }
  let n = highest + 1;
  // n is above every number in the folder, so this only guards against odd names; no name in the
  // folder starts with the new REC_<n>, so the full name (any suffix) is free too
  const taken = (num) => {
    const prefix = "rec_" + String(num).padStart(4, "0");
    return entries.some((e) => e.toLowerCase().startsWith(prefix));
  };
  while (taken(n)) n++;
  const base = "REC_" + String(n).padStart(4, "0");
  return suffix ? base + "_" + suffix : base;
}

// Short, friendly animals, lower case a-z only (FAT-safe, no look-alike or awkward words)
function DLZMOD_animals() {
  return ("aardvark alpaca ant antelope badger beaver bee beetle bison bobcat buffalo butterfly camel " +
    "canary caribou cat cheetah chipmunk cicada cobra condor cougar cow coyote crab crane cricket crow " +
    "deer dingo dolphin donkey dove duck eagle elk emu falcon ferret finch firefly flamingo fox frog " +
    "gazelle gecko gerbil gibbon giraffe gnu goat goose gopher gorilla grouse gull hamster hare hawk " +
    "hedgehog heron hippo horse hyena ibex ibis iguana impala jackal jaguar jay kestrel kiwi koala kudu " +
    "ladybug lark lemming lemur leopard lion lizard llama lobster lynx macaw magpie mallard manatee " +
    "marmot meerkat mink mole mongoose moose moth narwhal newt ocelot octopus okapi orca oriole osprey " +
    "ostrich otter owl panda panther parrot pelican penguin pheasant pigeon platypus pony puffin puma " +
    "quail rabbit raccoon raven reindeer robin salmon sardine seahorse seal shark sheep shrimp skylark " +
    "sloth snail sparrow squid starling stork swallow swan tapir tiger toucan trout tuna turtle viper " +
    "vulture walrus wallaby warthog weasel whale wolf wombat woodpecker wren yak zebra").split(" ");
}

// The next animal: a shuffled round of the whole list, no repeat until it is used up (takes in one
// session always differ); a new round after a restart. rnd(n) gives 0..n-1 (crypto by default).
function DLZMOD_recAnimal(rnd) {
  const s = DLZMOD_recAnimal;
  if (!s.queue || !s.queue.length) {
    const r = rnd || require("crypto").randomInt;
    const a = DLZMOD_animals();
    for (let i = a.length - 1; i > 0; i--) {
      const j = r(i + 1);
      [a[i], a[j]] = [a[j], a[i]];
    }
    s.queue = a;
  }
  return s.queue.pop();
}

// Returns the base name (no extension) for a new recording in dir, or null when the folder cannot
// be read: then no recording starts, instead of guessing a name that may overwrite a file. others:
// the recordings folders on all media (server.js's "-" for an empty slot and dir itself are
// skipped); one that cannot be read (no medium, no folder yet) only adds no numbers.
async function DLZMOD_recName(dir, others = []) {
  const fs = require("fs");
  let entries;
  try {
    await fs.promises.mkdir(dir, { recursive: true });
    entries = await fs.promises.readdir(dir);
  } catch (e) {
    console.error("dlzmod: cannot read " + dir + ", recording not started:", e.message);
    return null;
  }
  let more = [];
  for (const o of others) {
    if (o === dir || !require("path").isAbsolute(o)) continue;
    // a hung medium (a stick pulled while mounted) must not hold the recording back: 2 s at most
    let timer;
    try {
      more = more.concat(await Promise.race([
        fs.promises.readdir(o),
        new Promise((resolve) => {
          timer = setTimeout(() => resolve([]), 2000);
        }),
      ]));
    } catch (e) {}
    clearTimeout(timer);
  }
  const name = DLZMOD_pickRecName(entries, DLZMOD_recAnimal(), more);
  console.log("dlzmod: recording to " + dir + "/" + name);
  return name;
}

// Update popup (the drop-in update, sd-system/dlzmod-update). Same round trip as Mackie's firmware
// popup: when a screen has loaded (GUI_LOADED, patched) a result it has not shown yet is sent as
// DLZMOD_UPDATE_NOTE; its OK comes back as DLZMOD_UPDATE_NOTE_OK and marks it shown, so a start
// switched off before the OK shows it again. Files in dir (/var/lib/dlzmod-update):
//   installed     "v0.1.0 (dev-b2f2852)", written by the install and every update (apply-mod.sh)
//   shown         what the screen last confirmed (a fresh install writes it: no popup then)
//   failed        sha256 of the update file that failed last (the updater removes it on success)
//   shown-failed  the failure the screen last confirmed
//   last-report   "update-N-v0.1.0-dev-b2f2852.txt", the updater's newest report in DLZDATA/dlzmod-logs
// A failure comes first: it is newer than any install (a success removes "failed").
// Pure part: f(name) is the file's first line or "" when missing.
function DLZMOD_updateNoteFrom(f) {
  const report = f("last-report");
  if (f("failed") && f("failed") !== f("shown-failed")) return { ok: false, report: report };
  if (f("installed") && f("installed") !== f("shown")) return { ok: true, version: f("installed") };
  return null;
}

// for the Mod page, every start: the installed build ("" before the first install wrote it) and the
// last refusal ("" when the last update went in)
function DLZMOD_updateStatusFrom(f) {
  const report = f("last-report") ? "dlzmod-logs/" + f("last-report") : "dlzmod-logs";
  return {
    installed: f("installed"),
    failed: f("failed") ? "Last update not installed: see " + report + " on the card" : "",
  };
}

function DLZMOD_updateFile(dir) {
  const fs = require("fs");
  return (name) => {
    try {
      return fs.readFileSync(dir + "/" + name, "utf8").split("\n")[0].trim();
    } catch (e) {
      return "";
    }
  };
}

// called first thing in GUI_LOADED; send is the loading screen's own channel. Also the card check's
// failure (sd-system/dlzmod-cardcheck, before the FPGA loader): its screen text in /run, every start
function DLZMOD_updateNoteSend(send, dir = "/var/lib/dlzmod-update", cardNote = "/run/dlzmod-cardcheck") {
  try {
    const card = DLZMOD_updateFile(require("path").dirname(cardNote))(require("path").basename(cardNote));
    if (card) send({ cmd: "DLZMOD_CARD_NOTE", id: 0, data: card });
  } catch (e) {
    console.error("dlzmod: card note:", e.message);
  }
  try {
    const f = DLZMOD_updateFile(dir);
    send({ cmd: "DLZMOD_UPDATE_STATUS", id: 0, data: DLZMOD_updateStatusFrom(f) });
    const note = DLZMOD_updateNoteFrom(f);
    if (note) send({ cmd: "DLZMOD_UPDATE_NOTE", id: 0, data: note });
  } catch (e) {
    console.error("dlzmod: update note:", e.message);
  }
}

// the OK: what is there now counts as shown (atomic writes; a failure only means it shows again).
// Flushed to the card right away, file and folder: the mixer is switched off by cutting the power,
// and the card's root is ext4 in writeback mode with commit=10, so a write that is only in the page
// cache is lost when the mixer is switched off soon after the OK (the popup came back
// [device]; after waiting a minute it did not).
function DLZMOD_updateNoteSeen(dir = "/var/lib/dlzmod-update") {
  const fs = require("fs");
  const f = DLZMOD_updateFile(dir);
  const put = (name, value) => {
    const tmp = dir + "/" + name + ".dlzmod-new";
    const fd = fs.openSync(tmp, "w");
    try {
      fs.writeFileSync(fd, value + "\n");   // all of it (writeSync may write less)
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    fs.renameSync(tmp, dir + "/" + name);
  };
  // only what changed: any client can send the OK, and a burst of them must not mean a burst of
  // synced writes on the card
  let renamed = false;
  try {
    if (f("installed") && f("installed") !== f("shown")) {
      put("shown", f("installed"));
      renamed = true;
    }
    if (f("failed") && f("failed") !== f("shown-failed")) {
      put("shown-failed", f("failed"));
      renamed = true;
    }
  } catch (e) {
    console.error("dlzmod: update note not marked shown:", e.message);
  }
  if (!renamed) return;
  // the renames (also the first one when the second put failed): fsync of the folder (Linux; not
  // possible on Windows, where the tests run)
  try {
    const d = fs.openSync(dir, "r");
    try {
      fs.fsyncSync(d);
    } finally {
      fs.closeSync(d);
    }
  } catch (e) {
    if (process.platform !== "win32") console.error("dlzmod: update note folder not flushed:", e.message);
  }
}

// Network panel (Mod tab): Wi-Fi through a USB stick (NetworkManager) and SSH. The screen sends one
// command, DLZMOD_NET {op, ...} (patched into server.js's command table); the answers go back to
// that screen only: DLZMOD_NET_STATE (status), DLZMOD_WIFI_LIST (scan), DLZMOD_NET_RESULT (outcome
// of an action, shown as a popup). Passwords never go on a command line (visible in ps), into a hub
// key (sent to every client) or into a log line: the Wi-Fi password goes straight into a root-only
// NetworkManager keyfile, the SSH password into chpasswd's stdin. (Stock logs incoming commands
// only at VERBOSITY >= 2, which the mixer does not set.) Programs run without a shell (execFile),
// so a network name is never parsed as a command.
// Changes only from the mixer itself: the hub has no login, so any device on the network (or a web
// page in a browser on it) could otherwise set the root password. server.js's socket.io (ua) and
// TCP (da) connections stamp their send function with dlzmodLocal (patch.py): the device's screen
// connects to 127.0.0.1. Others only get the status.
function DLZMOD_isLocal(address) {
  return /^(127\.|::1$|::ffff:127\.)/.test(String(address || ""));
}

// #47 (notes/system.md, "Access and security"): stock's file commands take paths and names from any client and use them
// as root without a check, so any device on the network could delete, move, write or read any file
// (and undo the mod's patches). patch.py runs every command through DLZMOD_cmdAllowed and every
// plain key through DLZMOD_keyAllowed first.
// - deleting and renaming (recordings, presets, snapshots), loading samples from a path and
//   formatting the USB stick: only from the mixer's own screen (the dlzmodLocal stamp); phones and
//   tablets get them back with #45's pairing (#48)
// - for everyone: preset folders only Mackie's own, names only plain names (no folder in them)
// - from other devices: a track to play only from the SD card or the USB stick
const DLZMOD_SCREEN_ONLY = ["MEDIA_DELETE", "MEDIA_RENAME", "PRESET_DELETE", "PRESET_RENAME", "SNAP_DELETE",
  "SNAP_RENAME", "SAMPLE_LOAD", "SAMPLE_PREVIEW_START", "FORMAT_USB"];
const DLZMOD_PRESET_TYPES = ["ch", "comp", "del", "ds", "eq", "gate", "rev", "snaps"];
const DLZMOD_RAW_NAME = ["PRESET_READ", "PRESET_DELETE", "PRESET_RENAME", "SNAP_LOAD", "SNAP_DELETE", "SNAP_RENAME"];
const DLZMOD_RAW_NEW_NAME = ["PRESET_RENAME", "MEDIA_RENAME"];

// a file name on its own: not empty, no folder separator, no NUL, not "." or ".." ("Vocals..." is fine:
// without a separator dots cannot leave the folder)
function DLZMOD_plainName(n) {
  return typeof n === "string" && n !== "" && !/[\/\\\0]/.test(n) && n !== "." && n !== "..";
}

// path (as stock takes it: "sd:" / "usb:" prefixes, "\" as separator) inside one of the media roots
// (mount points, "-" when nothing is mounted), and not the root itself
function DLZMOD_inMedia(p, roots) {
  if (typeof p !== "string" || p.includes("\0")) return false;
  const path = require("path");
  let f = p.replace(/\\/g, "/");
  const m = /^(sd|usb):\/*/.exec(f);
  if (m) {
    const root = roots[m[1] === "sd" ? 0 : 1];
    if (!root || root === "-") return false;
    f = root + "/" + f.slice(m[0].length);
  }
  f = path.resolve("/", f);
  return roots.some((r) => {
    if (!r || r === "-") return false;
    const rel = path.relative(path.resolve(r), f);
    return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
  });
}

// "" = allowed, else the reason it is refused (logged; the client gets false)
function DLZMOD_cmdAllowed(handlers, cmd, args, send, roots) {
  if (!Object.prototype.hasOwnProperty.call(handlers, cmd)) return "not a command";
  const a = args && typeof args === "object" ? args : {};
  const local = !!(send && send.dlzmodLocal === true);
  if (!local && DLZMOD_SCREEN_ONLY.includes(cmd)) return "only on the mixer's own screen";
  if (/^PRESET_/.test(cmd) && !DLZMOD_PRESET_TYPES.includes(a.type)) return "not a preset folder";
  // a snapshot file's keys are set by the server itself when it is loaded (SNAP_LOAD), past
  // DLZMOD_keyAllowed: other devices save snapshots with SNAP_SAVE (the server's own state), they
  // do not write the file directly
  if (!local && cmd === "PRESET_WRITE" && a.type === "snaps") return "only on the mixer's own screen";
  // names stock uses as they come (saving and a snapshot's new name go through its own cleanup, st())
  if (DLZMOD_RAW_NAME.includes(cmd) && !DLZMOD_plainName(a.name)) return "not a plain name";
  if (DLZMOD_RAW_NEW_NAME.includes(cmd) && !DLZMOD_plainName(a.newName)) return "not a plain name";
  if (!local && cmd === "MEDIA_SWITCH_TRACK" && !DLZMOD_inMedia(a.path, roots)) return "not on the SD card or USB stick";
  return "";
}

// plain key/value messages (stock stores and relays every key): no prototype keys; keys with a file
// path dspserver opens or records to only from the screen; track names (multitrack file names) from
// other devices plain
function DLZMOD_keyAllowed(key, value, send) {
  if (key === "__proto__" || key === "constructor" || key === "prototype") return false;
  const local = !!(send && send.dlzmodLocal === true);
  if (!local && /(^|\.)(file|recFile|currentFileName)$/i.test(key)) return false;
  // from other devices only: the screen keeps stock's names ("Mic 1/2" typed on the mixer stays as is)
  if (!local && /^[ip]\.[^.]+\.name$/.test(key) && typeof value === "string" && value !== "" && !DLZMOD_plainName(value)) {
    return false;
  }
  return true;
}

// stock runs "wavfinalizer <unfinished> <final>" through a shell, built from file names on the card
// or stick: a name with ";" or "$(...)" would run as root. Same program, same arguments, no shell.
function DLZMOD_wavfinalize(src, dst) {
  return new Promise((resolve, reject) => {
    require("child_process").execFile("wavfinalizer", [src, dst], (e, out) => (e ? reject(e) : resolve(out)));
  });
}

// express middleware in front of the static /srv: the originals kept next to the patched files
// (*.orig: Mackie's server.js and app.js, srv_data.json from install day) and atomic-write temp
// files are not served
function DLZMOD_noOrig(req, res, next) {
  let p = String(req.path || "");
  try {
    p = decodeURIComponent(p);
  } catch (e) {
    return res.status(400).end();
  }
  if (/\.(orig|dlzmod-new)[\/\\]*$/i.test(p)) return res.status(404).end();
  next();
}

function DLZMOD_nmDir() {
  return "/etc/NetworkManager/system-connections";
}

// nmcli -t: fields split on ":", a ":" or "\" inside a value is escaped with "\"
function DLZMOD_nmSplit(line) {
  const out = [];
  let cur = "";
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === "\\" && i + 1 < line.length) cur += line[++i];
    else if (c === ":") {
      out.push(cur);
      cur = "";
    } else cur += c;
  }
  out.push(cur);
  return out;
}

// NetworkManager's SECURITY column: "open", "wpa-psk" (also WPA2/WPA3 mixed), "sae" (WPA3 only) or
// "unsupported" (WEP, enterprise logins)
function DLZMOD_wifiSecurity(sec) {
  const s = (sec || "").trim();
  if (!s || s === "--") return "open";
  if (/802\.1X|WEP/.test(s)) return "unsupported";
  if (/WPA[12]/.test(s)) return "wpa-psk";
  if (/WPA3/.test(s)) return "sae";
  return "unsupported";
}

// `nmcli -t -f IN-USE,SSID,SIGNAL,SECURITY device wifi list`: one entry per name (its strongest
// access point), the connected one first, then by signal; hidden networks (no name) left out.
// known: names with a saved connection.
function DLZMOD_wifiParseList(text, known = []) {
  const by = new Map();
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    // a name with a line break in it (an access point can send one: nmcli escapes only ":" and "\")
    // splits into lines that never have 4 fields, its own ":" being escaped: such rows are dropped,
    // as are names with other control characters
    const fields = DLZMOD_nmSplit(line);
    const [inUse, ssid, signal, security] = fields;
    if (fields.length !== 4 || !/^[ *]?$/.test(inUse) || !/^\d{1,3}$/.test(signal)) continue;
    if (!ssid || /[\x00-\x1f\x7f]/.test(ssid)) continue;
    const n = { ssid: ssid, signal: Number(signal) || 0, security: DLZMOD_wifiSecurity(security),
      active: inUse === "*", known: known.includes(ssid) };
    const old = by.get(ssid);
    if (!old || n.signal > old.signal) by.set(ssid, Object.assign(n, { active: n.active || !!(old && old.active) }));
    else if (n.active) old.active = true;
  }
  return [...by.values()].sort((a, b) => b.active - a.active || b.signal - a.signal || (a.ssid < b.ssid ? -1 : 1));
}

// WPA passphrase: 8-63 printable ASCII characters, or 64 hex digits
function DLZMOD_wifiPskOk(psk) {
  return typeof psk === "string" && (/^[\x20-\x7e]{8,63}$/.test(psk) || /^[0-9a-fA-F]{64}$/.test(psk));
}

// root password for SSH: 8-64 printable ASCII characters (what Mackie's keyboard can type)
function DLZMOD_sshPasswordOk(pw) {
  return typeof pw === "string" && /^[\x20-\x7e]{8,64}$/.test(pw);
}

// file for a saved network: the name in hex (any bytes, nothing to escape in a path)
function DLZMOD_wifiFile(ssid, dir = DLZMOD_nmDir()) {
  return dir + "/dlzmod-wifi-" + Buffer.from(ssid, "utf8").toString("hex") + ".nmconnection";
}

// NetworkManager keyfile. The name as a byte list (keyfile's form for any SSID, nothing to escape);
// the password with GKeyFile escapes (backslash, and every space: leading and trailing ones would
// be trimmed). security: "open", "wpa-psk" or "sae".
function DLZMOD_wifiKeyfile(ssid, security, psk, uuid) {
  const esc = (v) => v.replace(/\\/g, "\\\\").replace(/ /g, "\\s");
  const lines = [
    "[connection]",
    "id=dlzmod-wifi-" + uuid.slice(0, 8),
    "uuid=" + uuid,
    "type=wifi",
    "autoconnect=true",
    "",
    "[wifi]",
    "mode=infrastructure",
    "ssid=" + [...Buffer.from(ssid, "utf8")].join(";") + ";",
    "",
  ];
  if (security !== "open") lines.push("[wifi-security]", "key-mgmt=" + security, "psk=" + esc(psk), "");
  lines.push("[ipv4]", "method=auto", "", "[ipv6]", "addr-gen-mode=stable-privacy", "method=auto", "");
  return lines.join("\n");
}

// runs a program without a shell; input goes to its stdin. Never rejects: {ok, out, err}.
// evolve-node runs at real-time priority (SCHED_FIFO 20, nice -20) and children inherit it: they
// run as normal processes (chrt -o 0, nice 0), so ssh-keygen cannot hold up the screen or audio.
function DLZMOD_run(file, args, input, timeout = 30000) {
  return new Promise((resolve) => {
    try {
      const p = require("child_process").execFile("/usr/bin/chrt",
        ["-o", "0", "/usr/bin/nice", "-n", "20", file].concat(args), { timeout: timeout },
        (e, out, err) => resolve({ ok: !e, out: String(out || ""), err: String(err || (e && e.message) || "") }));
      p.stdin.on("error", () => {});   // a child that exits before reading: no crash of the hub
      p.stdin.end(input === undefined ? "" : input);
    } catch (e) {
      resolve({ ok: false, out: "", err: e.message });
    }
  });
}

// a file on the card's root that must survive a power cut right after (see DLZMOD_updateNoteSeen):
// temp file, fsync, rename, fsync of the folder
function DLZMOD_writeDurable(file, data, mode) {
  const fs = require("fs");
  const tmp = file + ".dlzmod-new";
  const fd = fs.openSync(tmp, "w", mode);
  try {
    fs.fchmodSync(fd, mode);
    fs.writeFileSync(fd, data);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmp, file);
  DLZMOD_syncDir(require("path").dirname(file));
}

function DLZMOD_syncDir(dir) {
  const fs = require("fs");
  try {
    const d = fs.openSync(dir, "r");
    try {
      fs.fsyncSync(d);
    } finally {
      fs.closeSync(d);
    }
  } catch (e) {
    if (process.platform !== "win32") console.error("dlzmod: folder not flushed:", dir, e.message);
  }
}

// saved networks: name -> uuid, from our keyfiles
function DLZMOD_wifiSaved(dir = DLZMOD_nmDir()) {
  const fs = require("fs");
  const saved = {};
  let names = [];
  try {
    names = fs.readdirSync(dir);
  } catch (e) {}
  for (const f of names) {
    const m = /^dlzmod-wifi-([0-9a-f]+)\.nmconnection$/.exec(f);
    if (!m) continue;
    try {
      const u = /^uuid=(.+)$/m.exec(fs.readFileSync(dir + "/" + f, "utf8"));
      if (u) saved[Buffer.from(m[1], "hex").toString("utf8")] = u[1].trim();
    } catch (e) {}
  }
  return saved;
}

// status for the Network panel: stick present, Wi-Fi state, network name, address, SSH on, and an SSH
// change still running ("on"/"off", DLZMOD_net), so the card says so after its popup was closed
async function DLZMOD_netState(run = DLZMOD_run, paths = DLZMOD_sshPaths()) {
  const st = { stick: false, wifi: "", ssid: "", signal: 0, ip: "", ssh: false, sshKeep: false,
    sshBusy: DLZMOD_net.sshBusy || "" };
  const dev = await run("/usr/bin/nmcli", ["-t", "-f", "DEVICE,TYPE,STATE", "device", "status"]);
  let wdev = "";
  for (const line of dev.out.split("\n")) {
    const [d, type, state] = DLZMOD_nmSplit(line);
    if (type !== "wifi" || wdev) continue;
    wdev = d;
    st.stick = true;
    // also "connected (externally)", "connected (local only)", "connected (site only)"
    st.wifi = /^connecting/.test(state) ? "connecting" : /^connected/.test(state) ? "connected"
      : state === "unavailable" || state === "unmanaged" ? "unavailable" : "disconnected";
  }
  if (st.wifi === "connected") {
    const list = await run("/usr/bin/nmcli", ["-t", "-f", "IN-USE,SSID,SIGNAL,SECURITY", "device", "wifi", "list", "--rescan", "no"]);
    const a = DLZMOD_wifiParseList(list.out).find((n) => n.active);
    if (a) Object.assign(st, { ssid: a.ssid, signal: a.signal });
    const ip = await run("/usr/bin/nmcli", ["-g", "IP4.ADDRESS", "device", "show", wdev]);
    st.ip = (ip.out.split("\n")[0].split(" | ")[0] || "").replace(/\/\d+$/, "").trim();
  }
  st.ssh = (await run("/bin/systemctl", ["is-active", "ssh"])).out.trim() === "active";
  st.sshKeep = require("fs").existsSync(paths.keep);
  return st;
}

// the command from the screen. One change at a time; status and scans may run alongside; a status
// asked for while one is still running (a slow NetworkManager, the 3 s poll) is dropped.
async function DLZMOD_net(args, send, opts = {}) {
  const run = opts.run || DLZMOD_run;
  const dir = opts.dir || DLZMOD_nmDir();
  const paths = DLZMOD_sshPaths(opts);
  const reply = (cmd, data) => {
    try {
      send({ cmd: cmd, id: 0, data: data });
    } catch (e) {}
  };
  const result = (ok, text) => reply("DLZMOD_NET_RESULT", { ok: ok, text: text });
  const a = args || {};
  try {
    // another device on the network: no network name, address or SSH state, and nothing run (its
    // polls would otherwise crowd out the screen's, one status at a time)
    if (a.op === "status" && !(send && send.dlzmodLocal === true)) {
      return reply("DLZMOD_NET_STATE", { stick: false, wifi: "", ssid: "", signal: 0, ip: "", ssh: false, sshKeep: false,
        unknown: true, remote: true });
    }
    if (a.op === "status") {
      if (DLZMOD_net.status) return;
      DLZMOD_net.status = true;
      try {
        return reply("DLZMOD_NET_STATE", await DLZMOD_netState(run, paths));
      } finally {
        DLZMOD_net.status = false;
      }
    }
    if (!(send && send.dlzmodLocal === true)) {
      if (a.op === "scan") return reply("DLZMOD_WIFI_LIST", { networks: [], error: "Only on the mixer's own screen" });
      return result(false, "Network settings can only be changed\non the mixer's own screen.");
    }
    if (a.op === "scan") {
      const r = await run("/usr/bin/nmcli", ["-t", "-f", "IN-USE,SSID,SIGNAL,SECURITY", "device", "wifi", "list",
        "--rescan", "yes"], undefined, 25000);
      return reply("DLZMOD_WIFI_LIST", r.ok
        ? { networks: DLZMOD_wifiParseList(r.out, Object.keys(DLZMOD_wifiSaved(dir))) }
        : { networks: [], error: "No Wi-Fi networks found" });
    }
    if (DLZMOD_net.busy) return result(false, "Still busy with the last change, try again in a moment");
    DLZMOD_net.busy = true;
    try {
      if (a.op === "connect") await DLZMOD_wifiConnect(a, run, dir, result);
      else if (a.op === "forget") await DLZMOD_wifiForget(String(a.ssid || ""), run, dir, result);
      else if (a.op === "ssh") {
        DLZMOD_net.sshBusy = a.on ? "on" : "off";
        await DLZMOD_sshSet(a, run, result, opts.sshdDir, paths);
      } else if (a.op === "sshKeep") await DLZMOD_sshKeep(a, run, result, paths);
      else result(false, "Unknown network action");
    } finally {
      DLZMOD_net.busy = false;
      DLZMOD_net.sshBusy = "";
    }
    reply("DLZMOD_NET_STATE", await DLZMOD_netState(run, paths));
  } catch (e) {
    console.error("dlzmod: network " + a.op + ":", e.message);
    result(false, "That did not work (" + a.op + ")");
  }
}

async function DLZMOD_wifiForgetQuiet(ssid, run, dir) {
  const uuid = DLZMOD_wifiSaved(dir)[ssid];
  if (uuid) await run("/usr/bin/nmcli", ["connection", "delete", "uuid", uuid]);
  try {
    require("fs").unlinkSync(DLZMOD_wifiFile(ssid, dir));
  } catch (e) {}
  DLZMOD_syncDir(dir);
}

async function DLZMOD_wifiConnect(a, run, dir, result) {
  const ssid = String(a.ssid || "");
  const security = String(a.security || "");
  const psk = security === "open" ? "" : a.password;
  if (!ssid || Buffer.byteLength(ssid) > 32) return result(false, "Not a valid network name");
  if (!["open", "wpa-psk", "sae"].includes(security)) return result(false, "This kind of Wi-Fi login is not supported");
  if (security !== "open" && !DLZMOD_wifiPskOk(psk)) return result(false, "A Wi-Fi password has 8 to 63 characters");
  // only with a working stick (a Wi-Fi device in NetworkManager): nothing is saved without one
  const st = await DLZMOD_netState(run);
  if (!st.stick) return result(false, "No working Wi-Fi stick in the USB port");
  if (st.wifi === "unavailable") return result(false, "The Wi-Fi stick is not ready yet");
  await DLZMOD_wifiForgetQuiet(ssid, run, dir);
  const uuid = require("crypto").randomUUID();
  const file = DLZMOD_wifiFile(ssid, dir);
  DLZMOD_writeDurable(file, DLZMOD_wifiKeyfile(ssid, security, psk, uuid), 0o600);
  await run("/usr/bin/nmcli", ["connection", "load", file]);
  const up = await run("/usr/bin/nmcli", ["--wait", "45", "connection", "up", "uuid", uuid], undefined, 60000);
  if (up.ok) return result(true, "Connected to " + ssid);
  // a wrong password must not stay behind and retry at every start
  await DLZMOD_wifiForgetQuiet(ssid, run, dir);
  console.error("dlzmod: wifi connect failed:", up.err.split("\n")[0]);
  result(false, /secrets|802-11-wireless-security|psk/i.test(up.err)
    ? "Could not connect to " + ssid + ".\nCheck the password." : "Could not connect to " + ssid + ".");
}

async function DLZMOD_wifiForget(ssid, run, dir, result) {
  if (!ssid) return result(false, "Not a valid network name");
  await DLZMOD_wifiForgetQuiet(ssid, run, dir);
  result(true, "Forgot " + ssid);
}

// SSH: on needs a new root password (replaces the factory one) and allows logging in with it (a
// developer card's sd.env may have turned password login off: that file goes); host keys are made
// here (the card ships without Mackie's, which every mixer shares; ssh.service.d/dlzmod.conf makes
// them too). RSA on this CPU can take a minute. Off stops and disables it, and drops both markers
// (DLZMOD_sshPaths) first, so it stays off at the next start even if systemctl fails.
async function DLZMOD_sshSet(a, run, result, sshdDir = "/etc/ssh/sshd_config.d", paths = DLZMOD_sshPaths()) {
  if (a.on) {
    if (!DLZMOD_sshPasswordOk(a.password)) return result(false, "An SSH password has 8 to 64 characters");
    const pw = await run("/usr/sbin/chpasswd", [], "root:" + a.password + "\n");
    if (!pw.ok) return result(false, "Could not set the password");
    await run("/bin/sync", []);
    try {
      require("fs").unlinkSync(sshdDir + "/10-dlzmod.conf");
      DLZMOD_syncDir(sshdDir);
    } catch (e) {}
    const keys = await run("/usr/bin/ssh-keygen", ["-A"], undefined, 180000);
    if (!keys.ok) return result(false, "Could not make the SSH host keys");
    try {
      require("fs").writeFileSync(paths.on, "");
    } catch (e) {
      return result(false, "Could not start SSH");
    }
    const on = await run("/bin/systemctl", ["enable", "--now", "ssh"]);
    await run("/bin/sync", []);
    if (on.ok) return result(true, "SSH is on: log in as root with the new password");
    DLZMOD_unlinkQuiet(paths.on);
    return result(false, "Could not start SSH");
  }
  DLZMOD_sshUnmark(paths);
  const off = await run("/bin/systemctl", ["disable", "--now", "ssh"]);
  await run("/bin/sync", []);
  result(off.ok, off.ok ? "SSH is off" : "Could not stop SSH");
}

// SSH only starts while one of two markers exists (ssh.service.d/dlzmod.conf, ConditionPathExists=|):
// `on` in /run, written when it is turned on and gone after a restart, so SSH is off again after
// every start; and `keep` on the card, when the owner chose "Keep on after a restart". Both are
// written only here, i.e. only from the mixer's own screen; neither is a hub key, which any device
// on the network could set.
function DLZMOD_sshPaths(o = {}) {
  return { on: o.sshOnFlag || "/run/dlzmod-ssh-on", keep: o.sshKeepFile || "/var/lib/dlzmod-ssh/keep-on" };
}

function DLZMOD_unlinkQuiet(f) {
  try {
    require("fs").unlinkSync(f);
    return true;
  } catch (e) {
    return false;
  }
}

// the keep marker removed and flushed (only when there was one: its folder may not exist)
function DLZMOD_sshUnkeep(paths) {
  if (DLZMOD_unlinkQuiet(paths.keep)) DLZMOD_syncDir(require("path").dirname(paths.keep));
}

function DLZMOD_sshUnmark(paths) {
  DLZMOD_sshUnkeep(paths);
  DLZMOD_unlinkQuiet(paths.on);
}

// "Keep on after a restart": on only while SSH runs; off at any time, also for a marker left behind
// while SSH is not running (it would start SSH at the next start). Off with SSH: DLZMOD_sshSet.
async function DLZMOD_sshKeep(a, run, result, paths = DLZMOD_sshPaths()) {
  const fs = require("fs");
  if (!a.on) {
    DLZMOD_sshUnkeep(paths);
    return result(true, "SSH turns off at the next start");
  }
  if ((await run("/bin/systemctl", ["is-active", "ssh"])).out.trim() !== "active") return result(false, "Turn SSH on first");
  fs.mkdirSync(require("path").dirname(paths.keep), { recursive: true, mode: 0o700 });
  DLZMOD_writeDurable(paths.keep, "", 0o600);
  result(true, "SSH stays on after a restart");
}
