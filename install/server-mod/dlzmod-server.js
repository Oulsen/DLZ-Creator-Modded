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

// for the Mod page, every start: the installed build ("" before the first install wrote it), the
// last refusal ("" when the last update went in) and the update waiting for Install (null: none);
// local: the mixer's own screen, the only one that can install it
function DLZMOD_updateStatusFrom(f, local = false) {
  const report = f("last-report") ? "dlzmod-logs/" + f("last-report") : "dlzmod-logs";
  return {
    installed: f("installed"),
    failed: f("failed") ? "Last update not installed: see " + report + " on the card" : "",
    pending: DLZMOD_updatePendingFrom(f),
    local: local,
  };
}

// #65: an update is installed only after Install on the mixer's own screen. At every start the
// updater checks a package in DLZDATA/dlzmod-update and, without an approval, leaves it and writes
// "pending": "<record> <version>" (record: sha256 of the tar and its .sig together; version as in
// "installed", checked). Install writes that record to "approved" (DLZMOD_updateApprove); the
// updater installs at the next start only when the file is still the same. Pure part: {sum, version,
// approved} or null.
function DLZMOD_updatePendingFrom(f) {
  const m = /^([0-9a-f]{64}) (\S.*)$/.exec(f("pending"));
  return m ? { sum: m[1], version: m[2], approved: f("approved") === m[1] } : null;
}

// Install, from the mixer's own screen only (also in DLZMOD_SCREEN_ONLY): any device on the network
// could otherwise start an update file someone else put on the card. args.sum must be the pending
// record the screen asked about. Flushed to the card (DLZMOD_writeDurable): the next step is
// switching the mixer off. Then off and on by the switch on the back, not a restart from software,
// which often hangs at the next start (#81). The answer and the new status go to this screen.
function DLZMOD_updateApprove(args, send, dir = "/var/lib/dlzmod-update") {
  const reply = (cmd, data) => {
    try {
      send({ cmd: cmd, id: 0, data: data });
    } catch (e) {}
  };
  const result = (ok, text) => reply("DLZMOD_UPDATE_APPROVED", { ok: ok, text: text });
  const local = !!(send && send.dlzmodLocal === true);
  if (!local) return result(false, "Updates can only be installed\non the mixer's own screen.");
  const f = DLZMOD_updateFile(dir);
  const p = DLZMOD_updatePendingFrom(f);
  const a = args && typeof args === "object" ? args : {};
  if (!p || a.sum !== p.sum) return result(false, "This update is no longer waiting on the card.");
  try {
    if (!p.approved) DLZMOD_writeDurable(dir + "/approved", p.sum + "\n", 0o644);
  } catch (e) {
    console.error("dlzmod: update approval not saved:", e.message);
    return result(false, "The choice could not be saved on the card.\nTry again.");
  }
  console.log("dlzmod: update " + p.version + " approved on the screen");
  result(true, "Ready to install " + p.version + ".\nSwitch the mixer off and on.");
  reply("DLZMOD_UPDATE_STATUS", DLZMOD_updateStatusFrom(f, local));
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
// failure (sd-system/dlzmod-cardcheck, before the FPGA loader): its screen text in /run, every start;
// and the question for an update that waits for Install (DLZMOD_UPDATE_ASK), on the mixer's own
// screen only, every time it loads until Install (Later only closes it)
function DLZMOD_updateNoteSend(send, dir = "/var/lib/dlzmod-update", cardNote = "/run/dlzmod-cardcheck") {
  try {
    const card = DLZMOD_updateFile(require("path").dirname(cardNote))(require("path").basename(cardNote));
    if (card) send({ cmd: "DLZMOD_CARD_NOTE", id: 0, data: card });
  } catch (e) {
    console.error("dlzmod: card note:", e.message);
  }
  try {
    const f = DLZMOD_updateFile(dir);
    const local = !!(send && send.dlzmodLocal === true);
    const status = DLZMOD_updateStatusFrom(f, local);
    send({ cmd: "DLZMOD_UPDATE_STATUS", id: 0, data: status });
    const note = DLZMOD_updateNoteFrom(f);
    if (note) send({ cmd: "DLZMOD_UPDATE_NOTE", id: 0, data: note });
    if (local && status.pending && !status.pending.approved) {
      send({ cmd: "DLZMOD_UPDATE_ASK", id: 0, data: status.pending });
    }
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
// Changes only from the mixer itself, also with pairing (#45): a paired phone must not set the root
// password or pair more devices. server.js's socket.io (ua) and
// TCP (da) connections stamp their send function with dlzmodLocal (patch.py): the device's screen
// connects to 127.0.0.1. Others only get the status.
function DLZMOD_isLocal(address) {
  return /^(127\.|::1$|::ffff:127\.)/.test(String(address || ""));
}

// #47 (notes/system.md, "Access and security"): stock's file commands take paths and names from any client and use them
// as root without a check, so any device on the network could delete, move, write or read any file
// (and undo the mod's patches). patch.py runs every command through DLZMOD_cmdAllowed and every
// plain key through DLZMOD_keyAllowed first.
// - deleting and renaming (recordings, presets, snapshots): from the mixer's own screen (the
//   dlzmodLocal stamp) and from paired devices (dlzmodPaired, #48), recordings only inside the
//   recordings folders
// - loading samples from a path, formatting the USB stick, a factory reset and restarting the screen
//   (RESTART_GUI: a few in a row run evolve-app into systemd's start limit, the screen stays dark
//   until a power cycle): only from the mixer's own screen
// - installing a mod update (#65): only from the mixer's own screen, always (also not paired devices)
// - for everyone: preset folders only Mackie's own, names only plain names (no folder in them)
// - from other devices: a track to play only from the SD card or the USB stick
const DLZMOD_SCREEN_ONLY = ["MEDIA_DELETE", "MEDIA_RENAME", "PRESET_DELETE", "PRESET_RENAME", "SNAP_DELETE",
  "SNAP_RENAME", "SAMPLE_LOAD", "SAMPLE_PREVIEW_START", "FORMAT_USB", "FACTORY_RESET", "RESET", "RESTART_GUI",
  "DLZMOD_UPDATE_APPROVE"];
const DLZMOD_PAIRED_FILES = ["MEDIA_DELETE", "MEDIA_RENAME", "PRESET_DELETE", "PRESET_RENAME", "SNAP_DELETE", "SNAP_RENAME"];
// server.js's recordings folders (full-size, XS), on the SD card and the USB stick
const DLZMOD_REC_DIRS = ["DLZ_Creator_Recordings", "DLZ_Creator_XS_Recordings"];
const DLZMOD_PRESET_TYPES = ["ch", "comp", "del", "ds", "eq", "gate", "rev", "snaps"];
const DLZMOD_RAW_NAME = ["PRESET_READ", "PRESET_DELETE", "PRESET_RENAME", "SNAP_LOAD", "SNAP_DELETE", "SNAP_RENAME"];
const DLZMOD_RAW_NEW_NAME = ["PRESET_RENAME", "MEDIA_RENAME"];

// a file name on its own: not empty, no folder separator, no NUL, not "." or ".." ("Vocals..." is fine:
// without a separator dots cannot leave the folder)
function DLZMOD_plainName(n) {
  return typeof n === "string" && n !== "" && !/[\/\\\0]/.test(n) && n !== "." && n !== "..";
}

// path (as stock takes it: "sd:" / "usb:" prefixes, "\" as separator) inside one of the media roots
// (mount points, "-" when nothing is mounted), and not the root itself; with subs: inside one of
// those folders on a medium, and not the folder itself
function DLZMOD_inMedia(p, roots, subs) {
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
    return (subs || [""]).some((s) => {
      const rel = path.relative(path.resolve(r, s), f);
      return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
    });
  });
}

// "" = allowed, else the reason it is refused (logged; the client gets false)
function DLZMOD_cmdAllowed(handlers, cmd, args, send, roots) {
  if (!Object.prototype.hasOwnProperty.call(handlers, cmd)) return "not a command";
  const a = args && typeof args === "object" ? args : {};
  const local = !!(send && send.dlzmodLocal === true);
  const paired = !local && !!(send && send.dlzmodPaired === true);
  if (!local && DLZMOD_SCREEN_ONLY.includes(cmd) && !(paired && DLZMOD_PAIRED_FILES.includes(cmd))) {
    return "only on the mixer's own screen";
  }
  if (paired && /^MEDIA_(DELETE|RENAME)$/.test(cmd) && !DLZMOD_inMedia(a.path, roots, DLZMOD_REC_DIRS)) {
    return "not in a recordings folder";
  }
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
// path dspserver opens or records to only from the screen; the System Lock PIN (`lock`: setting,
// changing or removing it) only from the screen (#45: other devices still receive it, Mackie's web
// UI needs it for its own lock screen); track names (multitrack file names) from other devices plain
function DLZMOD_keyAllowed(key, value, send) {
  if (key === "__proto__" || key === "constructor" || key === "prototype") return false;
  const local = !!(send && send.dlzmodLocal === true);
  if (!local && /(^|\.)(file|recFile|currentFileName)$/i.test(key)) return false;
  if (!local && key === "lock") return false;
  // from other devices only: the screen keeps stock's names ("Mic 1/2" typed on the mixer stays as is)
  if (!local && /^[ip]\.[^.]+\.name$/.test(key) && typeof value === "string" && value !== "" && !DLZMOD_plainName(value)) {
    return false;
  }
  return true;
}

// stock runs "wavfinalizer <unfinished> <final>" through a shell, built from file names on the card
// or stick: a name with ";" or "$(...)" would run as root. Same program, same arguments, no shell.
// #98: each file counts as a read-write use, so DLZMOD_roNow leaves the medium writable between files.
// #26: counted while it runs: the final file is being written, so no downloads (DLZMOD_recNoRead)
function DLZMOD_wavfinalize(src, dst) {
  DLZMOD_roLater.lastRw = Date.now();
  DLZMOD_wavfinalize.running = (DLZMOD_wavfinalize.running || 0) + 1;
  return new Promise((resolve, reject) => {
    // counted down exactly once, also when execFile throws at once (bad arguments): a count left
    // standing would refuse every download until the next start
    const done = (e, out) => {
      DLZMOD_roLater.lastRw = Date.now();
      DLZMOD_wavfinalize.running--;
      e ? reject(e) : resolve(out);
    };
    try {
      require("child_process").execFile("wavfinalizer", [src, dst], (e, out) => done(e, out));
    } catch (e) {
      done(e);
    }
  });
}

// #98: media back to read-only once nothing writes. Stock remounts a medium read-write to record,
// rename, delete or finish half-written recordings at the start, and never back (its fe() only logs
// "back to RO1"), so a card with a recordings folder stayed writable until switched off: "Volume was
// not properly unmounted", damaged files. Called (patched) at the end of a recording, when the
// sample recorder stops and from fe(). After `delay` ms every writable FAT medium under /tmp/mnt
// (server.js's mounts) is remounted read-only, unless something records, is paused, has a sample
// take still to keep or store, or was remounted read-write (or finalized a file) in the last 10 s (a
// recording starts with the remount and only then shows as recording); then it looks again every
// 10 s. A file still open for writing makes the kernel refuse (EBUSY): also again in 10 s. A new
// call restarts the wait.
function DLZMOD_roLater(delay = 10000) {
  const s = DLZMOD_roLater;
  clearTimeout(s.timer);
  s.timer = setTimeout(async () => {
    s.timer = null;
    // node 18 ends the whole server on an unhandled rejection
    const done = await DLZMOD_mountQueue(() => DLZMOD_roNow()).catch((e) => {
      console.error("dlzmod: read-only remount:", e.message);
      return false;
    });
    if (!done) DLZMOD_roLater();
  }, delay);
}

// every remount of the media, one after the other: a read-write remount asked for while the
// read-only one runs comes after it, so the medium ends up writable. The next one waits `limit` ms
// at most: a mount that hangs (a pulled stick) must not hold up every later recording start
function DLZMOD_mountQueue(fn, limit = 40000) {
  const s = DLZMOD_mountQueue;
  const run = (s.last || Promise.resolve()).then(() => fn());
  let timer;
  s.last = Promise.race([run.catch(() => {}), new Promise((resolve) => {
    timer = setTimeout(() => {
      console.error("dlzmod: a remount still runs after " + limit / 1000 + " s, the next ones go ahead");
      resolve();
    }, limit);
  })]).then(() => clearTimeout(timer));
  return run;
}

// stock's read-write remounts (patched); remount: the stock call, its result and errors as before.
// Noted when asked and again when done: one that waited in the queue still gets its 10 s
function DLZMOD_rw(remount) {
  const s = DLZMOD_roLater;
  s.lastRw = Date.now();
  const run = DLZMOD_mountQueue(remount);
  run.then(() => (s.lastRw = Date.now()), () => (s.lastRw = Date.now()));
  return run;
}

// true when no medium is left writable; false: look again later. The remounts get `limit` ms in all
// (under the queue's 40 s, so the queue does not move on during this call); one not finished by then
// counts as not done: a mount stuck in the kernel (a pulled stick) ignores DLZMOD_run's timeout, and
// waiting for it would end the looking again for good. While it is stuck no second one is started
// for the same mount point (each would hang behind it, with its own process and pipes); accepted: a
// new medium mounted at that very point while the old mount still hangs stays writable, as stock
async function DLZMOD_roNow(mounts = "/proc/mounts", limit = 35000) {
  const s = DLZMOD_roLater;
  const get = (k) => globalThis.getDataKey(k);
  if (Date.now() - (s.lastRw || 0) < 10000 || DLZMOD_recBusy(get)) return false;
  let rw;
  try {
    rw = DLZMOD_rwMedia(require("fs").readFileSync(mounts, "utf8"));
  } catch (e) {
    console.error("dlzmod: cannot read " + mounts + ":", e.message);
    return false;
  }
  // all media at once (one stuck medium does not keep the others from their turn), one deadline
  s.pending = s.pending || new Map();
  const runs = rw.map((m) => {
    let p = s.pending.get(m);
    if (!p) {
      const q = DLZMOD_run("/usr/bin/mount", ["-o", "remount,ro", m]);
      s.pending.set(m, q);
      q.then(() => s.pending.get(m) === q && s.pending.delete(m));   // DLZMOD_run never rejects
      p = q;
    }
    return [m, p];
  });
  let timer;
  const late = new Promise((resolve) => {
    timer = setTimeout(() => resolve({ ok: false, err: "the remount has not finished yet" }), limit);
  });
  let done = true;
  for (const [m, p] of runs) {
    const r = await Promise.race([p, late]);
    if (r.ok) {
      console.log("dlzmod: " + m + " read-only again");
    } else {
      done = false;
      // once per series: a writer holding a file open would log every 10 s
      if (!s.failLogged) console.error("dlzmod: " + m + " stays writable for now:", r.err.trim());
      s.failLogged = true;
    }
  }
  clearTimeout(timer);
  if (done) s.failLogged = false;
  return done;
}

// get: server.js's data keys. Recording, paused or saving; the sample recorder recording, or a take
// waiting for keep/discard or being stored: sample.rec.file is set from its start until dspserver
// has stored it (SAMPLE_REC_STORE waits for that) or it is discarded (SAMPLE_REC_RESET). Its state
// stays at keep/discard after a store, so the state alone would keep the medium writable
function DLZMOD_recBusy(get) {
  return !!get("hw_rec") || [1, 2, 3].includes(get("recState")) || get("sample.rec.state") === 1 ||
    !!get("sample.rec.file");
}

// mount points of the writable FAT media under /tmp/mnt in a /proc/mounts text
function DLZMOD_rwMedia(text) {
  const out = [];
  for (const line of text.split("\n")) {
    const f = line.split(" ");
    if (f.length < 4 || f[2] !== "vfat" || !f[3].split(",").includes("rw")) continue;
    const m = f[1].replace(/\\([0-7]{3})/g, (x, o) => String.fromCharCode(parseInt(o, 8)));
    if (m.startsWith("/tmp/mnt/")) out.push(m);
  }
  return out;
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

// Control from other devices (#45). Stock lets anyone on the network control the mixer (both ports,
// no login). Here the mixer itself (the screen, dspserver, faderlink: all on localhost) keeps
// everything; other devices only while "Control from other devices" is on (Mod page, Remote Control)
// and once paired with the PIN shown there. A pairing gives the browser a random token (cookie,
// HttpOnly); the card keeps only its sha256. A random PIN pairs one device: a new one after each
// pairing. Or the owner's own PIN (6 digits, not an obvious one): it stays until changed, for pairing
// several devices without the screen. Wrong PINs, counted for all devices together: after 5 a pause
// of 60 s, doubling up to 15 min. Off forgets every device and the own PIN; "Forget all devices"
// forgets the devices (an own PIN stays, a random one is new); both drop paired connections.
// State in /var/lib/dlzmod-remote/state.json (root only; an update keeps it, a fresh card has none,
// so it starts off). The PIN never goes into a hub key or a log line, only to the screen.
// Port 89 listens on loopback only (DLZMOD_listen89): its only client is the screen.
function DLZMOD_pairDir() {
  return "/var/lib/dlzmod-remote";
}

function DLZMOD_pairHash(token) {
  return require("crypto").createHash("sha256").update(String(token)).digest("hex");
}

function DLZMOD_newPin() {
  return String(require("crypto").randomInt(0, 1000000)).padStart(6, "0");
}

// the state, read once per folder (the tests swap DLZMOD_pairDir); fails/until: the wrong-PIN pause, in memory
function DLZMOD_pair() {
  const p = DLZMOD_pair;
  const dir = DLZMOD_pairDir();
  if (p.dir !== dir) {
    let s = {};
    try {
      s = JSON.parse(require("fs").readFileSync(dir + "/state.json", "utf8")) || {};
    } catch (e) {}
    const pin = /^\d{6}$/.test(s.pin) ? s.pin : "";
    p.dir = dir;
    p.on = s.on === true && pin !== "";
    p.pin = p.on ? pin : "";
    p.own = p.on && s.own === true;
    p.tokens = p.on && Array.isArray(s.tokens) ? s.tokens.filter((t) => /^[0-9a-f]{64}$/.test(t)).slice(-16) : [];
    p.fails = 0;
    p.pauses = 0;
    p.until = 0;
  }
  return p;
}

function DLZMOD_pairSave(dir, s) {
  try {
    require("fs").mkdirSync(dir, { recursive: true, mode: 0o700 });
    DLZMOD_writeDurable(dir + "/state.json", JSON.stringify({ on: s.on, pin: s.pin, own: s.own, tokens: s.tokens }) + "\n", 0o600);
    return true;
  } catch (e) {
    console.error("dlzmod: pairing state not saved:", e.message);
    return false;
  }
}

// a change of {on, pin, own, tokens}: to the card first, into memory after, so the card never says
// more than memory (after a restart the card counts; only when a safer change can be neither saved
// nor removed does the card keep the old state, until a restart). safer (off, forget): in memory even when the
// card cannot take it; then the file goes (no file = off at the next start). Returns "saved",
// "removed" (off now, the file is gone) or "" (not saved: an opening change did not happen; a safer
// one holds until a restart only)
function DLZMOD_pairCommit(next, safer) {
  const p = DLZMOD_pair();
  if (DLZMOD_pairSave(p.dir, next)) {
    Object.assign(p, next);
    return "saved";
  }
  if (!safer) return "";
  try {
    require("fs").unlinkSync(p.dir + "/state.json");
    DLZMOD_syncDir(p.dir);
    Object.assign(p, { on: false, pin: "", own: false, tokens: [] });
    return "removed";
  } catch (e) {
    if (e.code === "ENOENT") {
      Object.assign(p, { on: false, pin: "", own: false, tokens: [] });
      return "removed";
    }
    console.error("dlzmod: pairing state not removed:", e.message);
    Object.assign(p, next);
    return "";
  }
}

// the token from a Cookie header ("" without one)
function DLZMOD_pairToken(cookie) {
  for (const part of String(cookie || "").split(";")) {
    const m = /^\s*dlzmod_pair=([0-9a-f]{64})\s*$/.exec(part);
    if (m) return m[1];
  }
  return "";
}

function DLZMOD_pairValid(cookie) {
  const p = DLZMOD_pair();
  const token = DLZMOD_pairToken(cookie);
  return p.on && token !== "" && p.tokens.includes(DLZMOD_pairHash(token));
}

// the name a browser used for the mixer: an IP address, a .local name or localhost. A web page
// elsewhere can point a name of its own at the mixer (DNS rebinding); Host and Origin then both carry
// that name and match each other
function DLZMOD_hostOk(host) {
  const h = String(host || "").toLowerCase().replace(/:80$/, "");
  return /^(\d{1,3}(\.\d{1,3}){3}|\[[0-9a-f:.]+\]|localhost|([a-z0-9-]+\.)+local)$/.test(h);
}

// a browser names the page a request comes from: only the mixer's own pages (a web page elsewhere,
// open in a browser on the network, must not drive the mixer), by a name of the mixer's own
// (DLZMOD_hostOk). No Origin: not a browser
function DLZMOD_originOk(headers) {
  const h = headers || {};
  if (!DLZMOD_hostOk(h.host)) return false;
  if (!h.origin) return true;
  return h.origin === "http://" + h.host;
}

// a PIN tried by another device: {ok, token} or {ok: false, wait (seconds), off}
function DLZMOD_pairTry(pin, now = Date.now()) {
  const p = DLZMOD_pair();
  if (!p.on) return { ok: false, off: true, wait: 0 };
  if (now < p.until) return { ok: false, wait: Math.ceil((p.until - now) / 1000) };
  const crypto = require("crypto");
  const given = Buffer.from(String(pin || "").trim());
  const good = given.length === 6 && crypto.timingSafeEqual(given, Buffer.from(p.pin));
  if (!good) {
    if (++p.fails >= 5) {
      p.fails = 0;
      p.until = now + Math.min(60000 * 2 ** p.pauses, 900000);
      p.pauses++;
      console.error("dlzmod: 5 wrong PINs, pairing paused");
    }
    return { ok: false, wait: now < p.until ? Math.ceil((p.until - now) / 1000) : 0 };
  }
  const token = crypto.randomBytes(32).toString("hex");
  // a pairing the card did not take is not given out (it would be gone after a restart)
  if (!DLZMOD_pairCommit({ on: true, pin: p.own ? p.pin : DLZMOD_newPin(), own: p.own,
    tokens: p.tokens.concat(DLZMOD_pairHash(token)).slice(-16) }, false)) return { ok: false, wait: 0, failed: true };
  p.fails = 0;
  p.pauses = 0;
  console.log("dlzmod: a device was paired");
  return { ok: true, token: token };
}

// on: a new random PIN, no devices yet; off: PIN (an own one too) and devices gone; off drops paired
// connections right away. DLZMOD_pairCommit's answer
function DLZMOD_pairSet(on) {
  const p = DLZMOD_pair();
  const r = DLZMOD_pairCommit(on ? { on: true, pin: DLZMOD_newPin(), own: false, tokens: [] }
    : { on: false, pin: "", own: false, tokens: [] }, !on);
  if (r || !on) {
    p.fails = 0;
    p.pauses = 0;
    p.until = 0;
    DLZMOD_pairDrop();
  }
  return r;
}

// "Forget all devices": a random PIN is new as well (it may have been seen); an own PIN stays
// (the owner changes it when it has leaked). Paired connections drop. DLZMOD_pairCommit's answer
function DLZMOD_pairForget() {
  const p = DLZMOD_pair();
  if (!p.on) return "saved";
  const r = DLZMOD_pairCommit({ on: true, pin: p.own ? p.pin : DLZMOD_newPin(), own: p.own, tokens: [] }, true);
  DLZMOD_pairDrop();
  return r;
}

// an own PIN the first guesses would find: at most two different digits (000000, 121212, 112211),
// a straight run up or down (123456, 987654, 012345), a repeated block (123123, 120120) or three
// doubled digits (112233)
function DLZMOD_pinWeak(pin) {
  if (new Set(pin).size <= 2) return true;
  if (/^(\d{3})\1$/.test(pin) || /^(\d)\1(\d)\2(\d)\3$/.test(pin)) return true;
  const d = [...pin].map(Number);
  const steps = new Set(d.slice(1).map((v, i) => v - d[i]));
  return steps.size === 1 && (steps.has(1) || steps.has(-1));
}

// the owner's own PIN (only while on; the devices stay paired), or "" for a random one again.
// "" = done, else why not
function DLZMOD_pairSetPin(pin) {
  const p = DLZMOD_pair();
  if (!p.on) return "Turn control from other devices on first";
  if (pin !== "") {
    if (typeof pin !== "string" || !/^\d{6}$/.test(pin)) return "A PIN has 6 digits";
    if (DLZMOD_pinWeak(pin)) return "Too easy to guess.\nPick another PIN.";
  }
  const own = pin !== "";
  return DLZMOD_pairCommit({ on: true, pin: own ? pin : DLZMOD_newPin(), own: own, tokens: p.tokens }, false)
    ? "" : "Could not save the PIN";
}

// for the screen only (DLZMOD_net's status): never sent to another device
function DLZMOD_pairStatus(now = Date.now()) {
  const p = DLZMOD_pair();
  const ips = [];
  try {
    for (const list of Object.values(require("os").networkInterfaces())) {
      for (const a of list || []) if (a.family === "IPv4" && !a.internal) ips.push(a.address);
    }
  } catch (e) {}
  return { on: p.on, pin: p.pin, own: p.own, devices: p.tokens.length, wait: now < p.until ? Math.ceil((p.until - now) / 1000) : 0,
    ips: ips };
}

// paired socket.io connections, dropped when the switch goes off or the devices are forgotten
function DLZMOD_pairDrop() {
  const set = DLZMOD_remoteAdmit.sockets;
  if (!set) return;
  for (const s of [...set]) {
    try {
      s.disconnect(true);
    } catch (e) {}
  }
  set.clear();
}

// socket.io's allowRequest (patch.py): the handshake of every new connection, before it exists.
// The mixer itself always; another device only paired, from the mixer's own page
function DLZMOD_allowRequest(req, cb) {
  const h = (req && req.headers) || {};
  if (DLZMOD_isLocal(req && req.socket && req.socket.remoteAddress)) return cb(null, true);
  if (DLZMOD_pairValid(h.cookie) && DLZMOD_originOk(h)) return cb(null, true);
  cb("not paired", false);
}

// server.js's socket.io connection (ua, patch.py), after the dlzmodLocal stamp: the same check once
// more on the connection itself; a paired one is stamped dlzmodPaired (DLZMOD_cmdAllowed) and kept
// for DLZMOD_pairDrop. false: dropped, nothing of it runs
function DLZMOD_remoteAdmit(socket, send) {
  if (send && send.dlzmodLocal === true) return true;
  const h = (socket && socket.handshake && socket.handshake.headers) || {};
  if (!(DLZMOD_pairValid(h.cookie) && DLZMOD_originOk(h))) {
    try {
      socket.disconnect(true);
    } catch (e) {}
    return false;
  }
  send.dlzmodPaired = true;
  const set = DLZMOD_remoteAdmit.sockets || (DLZMOD_remoteAdmit.sockets = new Set());
  set.add(socket);
  socket.on("disconnect", () => set.delete(socket));
  return true;
}

// what a paired browser may load: the UI (index.html, app.js and its libraries, fonts and pictures)
// and the recordings (DLZMOD_recHttp, #26); and where it may send a mod update (DLZMOD_updateUpload,
// #114). Not srv_data.json (the System Lock PIN), presets, node_modules, package files, the demo pages
function DLZMOD_remoteFileOk(p) {
  return !/(^|\/)\.\.?(\/|$)/.test(p) && !p.includes("\0") &&
    /^\/(|index\.html|app\.js|style\.css|favicon\.ico|(libs|fonts|img1x)\/.+|dlzmod-rec(\/.+)?|dlzmod-update-upload)$/.test(p);
}

// what the PIN and switch-off pages load before any pairing: Mackie's logo and the two font weights
// they use (stock files from the firmware, nothing of the mixer's state)
function DLZMOD_loginFileOk(p) {
  return /^\/(img1x\/DLZ_(XS|Creator)\.png|fonts\/proximanova\/ProximaNova-(Regular|Semibold)\.woff)$/.test(p);
}

// express middleware in front of everything (patch.py, after DLZMOD_noOrig): the mixer itself as
// stock; another device gets the switch-off page, the PIN page or, paired, the UI's own files. Three
// parameters: express takes a function with four for an error handler
function DLZMOD_remoteHttp(req, res, next) {
  if (DLZMOD_isLocal(req.socket && req.socket.remoteAddress)) return next();
  if (!DLZMOD_hostOk(req.headers && req.headers.host)) {
    return DLZMOD_remotePage(res, 421, "Open the mixer by its IP address or its .local name.");
  }
  const p = DLZMOD_pair();
  let path = String(req.path || "");
  try {
    path = decodeURIComponent(path);
  } catch (e) {
    return DLZMOD_remotePage(res, 400, "");
  }
  if (DLZMOD_loginFileOk(path) && (req.method === "GET" || req.method === "HEAD")) return next();
  if (!p.on) {
    return DLZMOD_remotePage(res, 403, "Control from other devices is off. Turn it on at the mixer: " +
      DLZMOD_remoteTab() + ".");
  }
  if (path === "/dlzmod-pair" && req.method === "POST") return DLZMOD_pairPost(req, res);
  if (!DLZMOD_pairValid(req.headers && req.headers.cookie)) {
    if (path === "/" || path === "/index.html") return DLZMOD_remotePage(res, 200, "", true);
    return DLZMOD_remotePage(res, 403, "Not paired with this mixer.");
  }
  if (!DLZMOD_remoteFileOk(path)) return DLZMOD_remotePage(res, 404, "");
  next();
}

function DLZMOD_remoteTab() {
  return "Settings → DLZ Creator Modded → Remote";
}

// the PIN form posted: a cookie and on to the mixer, or the form again with what went wrong
function DLZMOD_pairPost(req, res) {
  if (!DLZMOD_originOk(req.headers)) return DLZMOD_remotePage(res, 403, "");
  let body = "";
  let tooBig = false;
  req.setEncoding("utf8");
  req.on("data", (c) => {
    body += c;
    if (body.length > 200 && !tooBig) {
      tooBig = true;
      // the answer first, then the connection closes (destroying the request would cut the answer off)
      req.removeAllListeners("data");
      req.resume();
      res.setHeader("Connection", "close");
      DLZMOD_remotePage(res, 413, "");
    }
  });
  req.on("end", () => {
    if (tooBig) return;
    const r = DLZMOD_pairTry(new (require("url").URLSearchParams)(body).get("pin") || "");
    if (r.ok) {
      res.writeHead(303, { Location: "/", "Cache-Control": "no-store",
        "Set-Cookie": "dlzmod_pair=" + r.token + "; Path=/; Max-Age=34560000; HttpOnly; SameSite=Strict" });
      return res.end();
    }
    if (r.off) return DLZMOD_remotePage(res, 403, "Control from other devices is off.");
    if (r.failed) return DLZMOD_remotePage(res, 503, "The mixer could not save the pairing. Try again.", true);
    DLZMOD_remotePage(res, 200, r.wait ? "Too many wrong PINs. Try again in " + r.wait + " seconds." : "Wrong PIN, try again.", true);
  });
}

// the mod's own small page for other devices, in Mackie's look (Settings' panels: black, thin #333
// border, Proxima Nova, Mackie green; the model's logo from About), with the mod's marker at the
// bottom as in the SD card panel: a message, and the PIN form when form is set. Before pairing it
// loads only DLZMOD_loginFileOk's files
function DLZMOD_remotePage(res, status, text, form) {
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  const logo = globalThis.isDLZLite ? "DLZ_XS" : "DLZ_Creator";
  const font = (w, f) => "@font-face{font-family:PN;font-weight:" + w + ";src:url(/fonts/proximanova/ProximaNova-" + f +
    ".woff)}";
  const html = "<!DOCTYPE html><html><head><meta charset=\"utf-8\">" +
    "<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\"><title>DLZ Creator</title><style>" +
    font(400, "Regular") + font(600, "Semibold") +
    "*{box-sizing:border-box}body{background:#000;color:#c2c2c2;font:17px/1.4 PN,sans-serif;margin:0;" +
    "padding:32px 16px}.c{max-width:420px;margin:0 auto;border:1.5px solid #333;border-radius:6px;" +
    "padding:32px 24px 20px;text-align:center}.l{display:block;width:100%;max-width:280px;margin:0 auto 10px}" +
    "h1{color:#f9f9f9;font-weight:400;font-size:22px;margin:0 0 24px}p{margin:0 0 20px}" +
    ".m{color:#db6f64;font-weight:600}b{color:#f9f9f9;font-weight:600}.n{white-space:nowrap}" +
    "input{display:block;width:100%;font:600 36px/1 PN,sans-serif;letter-spacing:10px;text-align:center;" +
    "color:#f9f9f9;background:#141414;border:1.5px solid #333;border-radius:6px;padding:14px 0 14px 10px;" +
    "margin:0 0 16px}input:focus{outline:none;border-color:#9CCC56}button{width:100%;font:600 19px PN,sans-serif;" +
    "color:#000;background:#9CCC56;border:0;border-radius:6px;padding:14px}button:active{background:#86b347}" +
    ".f{margin:28px 0 0;font-size:13px;color:#888}.f span{color:#FFD600;font-weight:600}" +
    // a computer: in the middle of the window; a phone keeps it at the top, where the keyboard leaves it
    "@media(min-width:600px) and (min-height:500px){body{min-height:100vh;display:flex;align-items:center}" +
    ".c{flex:1}}</style></head><body><div class=\"c\">" +
    "<img class=\"l\" src=\"/img1x/" + logo + ".png\" alt=\"DLZ Creator\"><h1>Remote Control</h1>" +
    (text ? "<p class=\"m\">" + esc(text) + "</p>" : "") +
    (form ? "<p>Enter the PIN from the mixer:<br><b>" +
      DLZMOD_remoteTab().split(" → ").map((s) => "<span class=\"n\">" + esc(s) + "</span>").join(" → ") +
      "</b><br>then tap Show PIN.</p>" +
      "<form method=\"post\" action=\"/dlzmod-pair\"><input name=\"pin\" type=\"text\" inputmode=\"numeric\" " +
      "autocomplete=\"one-time-code\" maxlength=\"6\" pattern=\"[0-9]{6}\" placeholder=\"······\" required autofocus>" +
      "<button>Pair</button></form>" : "") +
    "<p class=\"f\"><span>DLZ Creator Modded</span></p></div></body></html>";
  res.writeHead(status, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
  res.end(html);
}

// Recordings over the network (#26), read only: GET /dlzmod-rec lists the recordings on the SD card
// and the USB stick (JSON), GET /dlzmod-rec/<sd|usb>/<recordings folder>/<name> downloads one
// (express's res.download: Range and ETag, so a cut download resumes). Other devices only paired:
// DLZMOD_remoteHttp runs first. While the mixer records no file is read, so a download cannot cause
// dropouts: the list says so, a download gets 503 and running ones are cut off (the browser marks them
// failed; they can be resumed from its downloads once the recording has finished). roots: () => [SD
// card, USB stick] mount points ("-" when empty), server.js's ce()
function DLZMOD_recHttp(roots) {
  return (req, res, next) => {
    const p = String(req.path || "");
    if (p !== "/dlzmod-rec" && !p.startsWith("/dlzmod-rec/")) return next();
    const end = (status, headers) => {
      res.writeHead(status, Object.assign({ "Cache-Control": "no-store" }, headers));
      res.end();
    };
    if (req.method !== "GET" && req.method !== "HEAD") return end(405, { Allow: "GET, HEAD" });
    const busy = DLZMOD_recNoRead();
    // node 18 ends the whole server on an unhandled rejection
    const failed = (e) => {
      console.error("dlzmod: recordings:", e && e.message);
      if (!res.headersSent) end(500);
      else res.destroy();
    };
    if (p === "/dlzmod-rec") {
      return DLZMOD_recList(roots(), busy).then((list) => {
        res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
        res.end(JSON.stringify(list));
      }).catch(failed);
    }
    const f = DLZMOD_recFile(p, roots());
    if (!f) return end(404);
    if (busy) return end(503, { "Retry-After": "30" });
    DLZMOD_recReal(f.dirPath, f.path).then((ok) => {
      // gone while the checks ran: its "close" has passed, DLZMOD_recWatch would keep it for good
      if (req.socket && req.socket.destroyed) return;
      if (!ok) return end(404);
      DLZMOD_recWatch(res);
      res.download(f.path, f.name, { headers: { "Cache-Control": "no-store" } }, (err) => {
        if (!err) return;
        // not found before the answer started; a read error halfway (a pulled stick): end the
        // connection, the browser sees a broken download. A client that went away is no error
        if (!res.headersSent) end(404);
        else res.destroy();
      });
    }).catch(failed);
  };
}

// nothing is read from the media now: the mixer records (DLZMOD_recBusy) or finishes a recording
// file (DLZMOD_wavfinalize: after a power cut, at the start)
function DLZMOD_recNoRead() {
  return DLZMOD_recBusy(globalThis.getDataKey) || (DLZMOD_wavfinalize.running || 0) > 0;
}

// the recordings folder a real folder and (when given) the file in it a real file, neither a link:
// a USB stick may be ext4, and a recordings folder linked to / would serve the system's files. The
// mount point itself is server.js's own
async function DLZMOD_recReal(dirPath, filePath) {
  const fsp = require("fs").promises;
  try {
    if (!(await fsp.lstat(dirPath)).isDirectory()) return false;
    return !filePath || (await fsp.lstat(filePath)).isFile();
  } catch (e) {
    return false;
  }
}

// a name the list shows and a download may open: a plain name, not hidden, not a recording still
// being written (*.wav.unfinished). Not ending in a dot or space: FAT ignores those when looking a
// name up, so "x.wav.unfinished." would open the unfinished file
function DLZMOD_recShown(name) {
  return DLZMOD_plainName(name) && !name.startsWith(".") && !/[. ]$/.test(name) && !/\.unfinished$/i.test(name);
}

// /dlzmod-rec/<sd|usb>/<folder>/<name> (each part URL-encoded on its own) to {dirPath, path, name},
// or null
function DLZMOD_recFile(p, roots) {
  const seg = String(p).split("/");
  if (seg.length !== 5 || seg[0] !== "" || seg[1] !== "dlzmod-rec") return null;
  let medium, dir, name;
  try {
    [medium, dir, name] = seg.slice(2).map(decodeURIComponent);
  } catch (e) {
    return null;
  }
  const i = ["sd", "usb"].indexOf(medium);
  const root = i < 0 ? "" : roots[i];
  if (!root || root === "-" || !DLZMOD_REC_DIRS.includes(dir) || !DLZMOD_recShown(name)) return null;
  return { dirPath: root + "/" + dir, path: root + "/" + dir + "/" + name, name: name };
}

// the recordings of each mounted medium, newest first: {recording, media: [{medium, files: [{dir,
// name, size, time}]}]}
async function DLZMOD_recList(roots, busy) {
  const fsp = require("fs").promises;
  const out = { recording: !!busy, media: [] };
  for (const [i, medium] of ["sd", "usb"].entries()) {
    const root = roots[i];
    if (!root || root === "-") continue;
    const files = [];
    for (const dir of DLZMOD_REC_DIRS) {
      let names;
      if (!(await DLZMOD_recReal(root + "/" + dir))) continue;
      try {
        names = await fsp.readdir(root + "/" + dir);
      } catch (e) {
        continue;
      }
      for (const name of names) {
        if (!DLZMOD_recShown(name)) continue;
        try {
          const st = await fsp.lstat(root + "/" + dir + "/" + name);
          if (st.isFile()) files.push({ dir: dir, name: name, size: st.size, time: Math.round(st.mtimeMs) });
        } catch (e) {}
      }
    }
    files.sort((a, b) => b.time - a.time || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    out.media.push({ medium: medium, files: files });
  }
  return out;
}

// #26: every client's file lists again (stock's UPDATE_DIRS: the Media page and the sample browser
// reload when shown), after a recording, a delete or a rename (patch.py). Stock sends it only when a
// medium comes or goes, so a browser kept showing a recordings folder as it was. bus: server.js's
// broadcaster (ee, null before the server runs). Calls while one waits make one message, at the
// later of their times: a delete just after a recording stop must not send before the recording has
// its final name. The message goes to the last broadcaster given (one from before the server ran is
// null). Times on the monotonic clock: the mixer's clock jumps when NTP sets it after a start
function DLZMOD_dirsChanged(bus, delay = 0) {
  const s = DLZMOD_dirsChanged;
  if (bus) s.bus = bus;
  const due = require("perf_hooks").performance.now() + delay;
  if (s.timer && s.due >= due) return;
  clearTimeout(s.timer);
  s.due = due;
  s.timer = setTimeout(() => {
    s.timer = null;
    const b = s.bus;
    try {
      if (b && typeof b.send === "function") b.send({ cmd: "UPDATE_DIRS", id: 0, args: {} });
    } catch (e) {
      console.error("dlzmod: file lists:", e.message);
    }
  }, delay);
}

// running downloads: cut off once the mixer records or finishes a recording (one check a second
// while any runs)
function DLZMOD_recWatch(res) {
  const s = DLZMOD_recWatch;
  s.running = s.running || new Set();
  s.running.add(res);
  res.on("close", () => {
    s.running.delete(res);
    if (!s.running.size && s.timer) {
      clearInterval(s.timer);
      s.timer = null;
    }
  });
  if (s.timer) return;
  s.timer = setInterval(() => {
    if (!DLZMOD_recNoRead()) return;
    console.log("dlzmod: recording: " + s.running.size + " download(s) cut off");
    for (const r of [...s.running]) r.destroy();
  }, 1000);
}

// #114: a mod update from a computer (the Mod page's Upload Update..., in a browser): POST
// /dlzmod-update-upload, the body the update's 64-byte signature and then its package, the package's
// name in X-Dlzmod-Name. It only puts the two files into DLZDATA/dlzmod-update/ (the boot card's
// medium, server.js's "sd"), where the drop-in update finds them at the next start: its own checks
// (signature, version) still decide, and Install stays on the mixer's own screen (#65). Other devices
// only paired (DLZMOD_remoteHttp runs first) and from the mixer's own page (DLZMOD_originOk). Streamed
// to the card (about 120 MB free RAM) under hidden temp names the update does not look at; only once
// complete and synced are the update files there replaced: the old ones removed, the signature
// renamed, then the package. A cut-off upload or a power cut never leaves a package to be taken for
// an update (a temp file a power cut leaves is removed by the next upload). Not while the mixer
// records (a recording that starts stops the writing), not while an update's try is unfinished, one
// at a time; the medium goes back to read-only after it (DLZMOD_roLater). The answer: a text for the
// browser to show; a refusal of a well-formed request comes after the rest of the body (thrown away
// as it comes): a browser that is still sending when the connection closes shows a network error
// instead. root: () => the SD card's mount point ("-" when empty), server.js's ce("sd"); state: the
// drop-in update's state folder; mounts: the kernel's mount table
const DLZMOD_UPLOAD_MAX = 64 * 1024 * 1024;   // dlzmod-update's MAX_PKG

function DLZMOD_updateUpload(root, state = "/var/lib/dlzmod-update", mounts = "/proc/mounts") {
  return (req, res, next) => {
    if (String(req.path || "") !== "/dlzmod-update-upload") return next();
    const s = DLZMOD_updateUpload;
    // not an upload of the page's (method, origin, name, size): answered at once, the connection closes
    const bad = (status, text) => {
      req.resume();
      DLZMOD_uploadAnswer(res, status, text, true);
    };
    const refuse = (status, text) => DLZMOD_uploadDrain(req, () => DLZMOD_uploadAnswer(res, status, text));
    if (req.method !== "POST") return bad(405, "");
    const h = req.headers || {};
    if (!DLZMOD_isLocal(req.socket && req.socket.remoteAddress) && !DLZMOD_originOk(h)) return bad(403, "");
    const name = String(h["x-dlzmod-name"] || "");
    if (!DLZMOD_uploadName(name)) {
      return bad(400, "This is not a mod update: choose its dlzmod-....tar and .tar.sig.");
    }
    const len = /^[0-9]{1,9}$/.test(String(h["content-length"] || "")) ? Number(h["content-length"]) : -1;
    if (len < 0) return bad(411, "");
    if (len <= 64 || len > 64 + DLZMOD_UPLOAD_MAX) return bad(413, "This file is too big for a mod update.");
    if (s.running) return refuse(409, "Another update is being sent to the mixer. Try again when it has finished.");
    if (DLZMOD_recNoRead()) return refuse(503, "The mixer is busy with a recording.\nSend the update when it has finished.");
    let unfinished = "";
    try {
      unfinished = require("fs").readFileSync(state + "/inprogress", "utf8").trim();
    } catch (e) {}
    if (unfinished) return refuse(409, "The last update did not finish. Switch the mixer off and on first.");
    const r = root();
    if (!r || r === "-") return refuse(503, "The mixer does not see its SD card's DLZDATA partition.");
    s.running = true;
    DLZMOD_uploadRun(req, r + "/dlzmod-update", name, len, mounts).then(
      () => {
        console.log("dlzmod: update upload: " + name + " in place");
        DLZMOD_uploadAnswer(res, 200, name + " is on the mixer's card.\nSwitch the mixer off and on: " +
          "its screen then asks whether to install it.");
      },
      (e) => {
        console.error("dlzmod: update upload:", e.message);
        refuse(e.code === "ENOSPC" ? 507 : 500, e.code === "ENOSPC"
          ? "The SD card is full. Nothing was kept." : e.cut ? e.message : "The mixer could not store the update. Nothing was kept.");
      }).catch((e) => console.error("dlzmod: update upload:", e.message)).finally(() => {
      // node 18 ends the whole server on an unhandled rejection: nothing above may throw past here
      s.running = false;
      DLZMOD_roLater();
    });
  };
}

// the name the drop-in update looks for (dlzmod-*.tar), a plain one the browser would send
function DLZMOD_uploadName(name) {
  return /^dlzmod-[A-Za-z0-9][A-Za-z0-9._+-]{0,80}\.tar$/.test(name) && !name.includes("..");
}

// fn once the request's body has come in to its end, the rest thrown away as it comes; never when
// the computer went away (no one to answer)
function DLZMOD_uploadDrain(req, fn) {
  if (req.readableEnded || req.complete) return fn();
  if (req.destroyed) return;
  req.on("error", () => {});
  req.once("end", fn);
  req.resume();
}

// all of buf, however many writes the kernel takes for it (a nearly full card can write less
// without an error)
async function DLZMOD_writeAll(fh, buf) {
  for (let off = 0; off < buf.length;) {
    const { bytesWritten } = await fh.write(buf, off, buf.length - off);
    if (!(bytesWritten > 0)) throw Object.assign(new Error("ENOSPC: nothing written"), { code: "ENOSPC" });
    off += bytesWritten;
  }
}

// a file's data and folder entry (its inode) to the card (opened for writing, not written: Windows,
// where the unit tests also run, syncs only such a handle)
async function DLZMOD_syncFile(file) {
  const fh = await require("fs").promises.open(file, "r+");
  try {
    await fh.sync();
  } finally {
    await fh.close();
  }
}

// root is a FAT medium mounted read-write in the kernel's mount table (text): never a folder that
// only looks like one (a medium gone, its mount point left on /tmp's tmpfs, which is RAM)
function DLZMOD_uploadMounted(text, root) {
  return String(text).split("\n").some((line) => {
    const f = line.split(" ");
    return f.length >= 4 && f[2] === "vfat" && f[3].split(",").includes("rw") &&
      f[1].replace(/\\([0-7]{3})/g, (x, o) => String.fromCharCode(parseInt(o, 8))) === root;
  });
}

// close: the connection ends after the answer (a body not read to its end)
function DLZMOD_uploadAnswer(res, status, text, close) {
  if (res.headersSent || res.destroyed) return;
  const h = { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" };
  if (close) h.Connection = "close";
  if (status === 405) h.Allow = "POST";
  res.writeHead(status, h);
  res.end(text);
}

// the medium writable, the body to the temp files, then the update files replaced (DLZMOD_updateUpload).
// Rejects with the reason; nothing of this upload is left then (an error after the old update files
// are removed leaves none). An error with .cut set has a text for the browser
async function DLZMOD_uploadRun(req, dir, name, len, mounts) {
  const fs = require("fs");
  const fsp = fs.promises;
  const root = require("path").dirname(dir);
  const tar = dir + "/.dlzmod-upload.tar.part";
  const sig = dir + "/.dlzmod-upload.sig.part";
  const cut = (text) => Object.assign(new Error(text), { cut: true });
  let fh = null;
  let watch = null;
  let placed = false;
  let sigPlaced = false;
  try {
    await DLZMOD_rw(() => DLZMOD_run("/usr/bin/mount", ["-o", "remount,rw", root]).then((x) =>
      x.ok ? x : Promise.reject(new Error("remount: " + x.err.trim()))));
    if (!DLZMOD_uploadMounted(await fsp.readFile(mounts, "utf8"), root)) {
      throw new Error(root + " is not a writable FAT medium");
    }
    await fsp.mkdir(dir, { recursive: true });
    if (!(await DLZMOD_recReal(dir))) throw new Error(dir + " is not a folder");
    await fsp.rm(tar, { force: true });
    await fsp.rm(sig, { force: true });
    // a recording that starts stops the writing (card time goes to the recording; the rest of the
    // body is then thrown away, so the browser gets the text); the read-only remount waits while the
    // file is written (DLZMOD_roNow)
    let recording = false;
    watch = setInterval(() => {
      DLZMOD_roLater.lastRw = Date.now();
      if (DLZMOD_recNoRead()) recording = true;
    }, 1000);
    fh = await fsp.open(tar, "w");
    const head = [];
    let got = 0;
    let headLen = 0;
    let writeErr = null;
    try {
      // a break leaves the request as it is (DLZMOD_uploadDrain reads the rest)
      for await (const c of req.iterator({ destroyOnReturn: false })) {
        if (recording) break;
        got += c.length;
        if (got > len) break;
        let rest = c;
        if (headLen < 64) {
          const part = c.subarray(0, 64 - headLen);
          head.push(part);
          headLen += part.length;
          rest = c.subarray(part.length);
        }
        if (rest.length) await DLZMOD_writeAll(fh, rest).catch((e) => Promise.reject((writeErr = e)));
      }
    } catch (e) {
      // the card (a full one) throws on; the computer that went away: below
      if (writeErr) throw writeErr;
    }
    if (recording) throw cut("The mixer started a recording, so the upload stopped. Nothing was kept.");
    if (got !== len) throw cut("The upload was cut off. Nothing was kept.");
    await fh.sync();
    if ((await fh.stat()).size !== len - 64) throw new Error("the package on the card is not the size sent");
    await fh.close();
    fh = null;
    clearInterval(watch);
    watch = null;
    // the signature in its own synced temp file, then the update files replaced: never two packages
    // (the update refuses both), a package only with its complete signature
    const sh = await fsp.open(sig, "w");
    try {
      await DLZMOD_writeAll(sh, Buffer.concat(head));
      await sh.sync();
    } finally {
      await sh.close();
    }
    for (const f of await fsp.readdir(dir)) {
      if (!/^dlzmod-.*\.tar(\.sig)?$/.test(f)) continue;
      const st = await fsp.lstat(dir + "/" + f);
      if (st.isFile()) await fsp.unlink(dir + "/" + f);
    }
    // each synced again under its new name: FAT's rename writes the new folder entry with no first
    // cluster and size 0, the real ones only when the kernel writes the file's inode back (up to
    // ~30 s later; the folder's sync does not) [PC: tests/upload.sh, a power cut after the answer
    // left a 0-byte package]
    await fsp.rename(sig, dir + "/" + name + ".sig");
    sigPlaced = true;
    await DLZMOD_syncFile(dir + "/" + name + ".sig");
    await fsp.rename(tar, dir + "/" + name);
    placed = true;
    await DLZMOD_syncFile(dir + "/" + name);
    DLZMOD_syncDir(dir);
  } catch (e) {
    if (fh) await fh.close().catch(() => {});
    if (!placed) {
      await fsp.rm(tar, { force: true }).catch(() => {});
      await fsp.rm(sig, { force: true }).catch(() => {});
      if (sigPlaced) await fsp.rm(dir + "/" + name + ".sig", { force: true }).catch(() => {});
    }
    throw e;
  } finally {
    if (watch) clearInterval(watch);
  }
}

// port 89 (the screen's connection) on loopback only, IPv4 and IPv6: app.js connects to
// "localhost", which Node 18 resolves to ::1 first when the mixer has an IPv6 address. Stock
// listened on every interface. Without IPv6 the ::1 listener only logs
function DLZMOD_listen89(server, onConnection) {
  server.listen(89, "127.0.0.1");
  const v6 = require("net").createServer();
  v6.on("connection", onConnection);
  v6.on("error", (e) => console.error("dlzmod: port 89 on ::1:", e.message));
  v6.listen(89, "::1");
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
// change still running ("on"/"off", DLZMOD_net), so the card still says so when the screen lost its own
// mark (a reload, another network change)
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
  // the screen's status, with the Remote Control panel's (PIN included: only ever to the screen)
  const state = async () => Object.assign(await DLZMOD_netState(run, paths), { pair: DLZMOD_pairStatus() });
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
        return reply("DLZMOD_NET_STATE", await state());
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
      else if (a.op === "pair" && a.on) {
        const r = DLZMOD_pairSet(true);
        result(!!r, r ? "Control from other devices is on" : "Could not save the setting");
      } else if (a.op === "pair") {
        const r = DLZMOD_pairSet(false);
        result(!!r, r ? "Control from other devices is off.\nAll devices are forgotten."
          : "Off now, but the card could not save it:\npaired devices may come back after a restart.");
      } else if (a.op === "pairForget") {
        const r = DLZMOD_pairForget();
        result(r === "saved", r === "removed"
          ? "All devices are forgotten.\nThe card could not save the setting, so control\nfrom other devices is off."
          : !r ? "Forgotten now, but the card could not save it:\nthey may come back after a restart."
          : DLZMOD_pair().own ? "All devices are forgotten.\nYour own PIN stays." : "All devices are forgotten.\nThe PIN is new.");
      } else if (a.op === "pairPin") {
        const pin = typeof a.pin === "string" ? a.pin.trim() : "";
        const why = DLZMOD_pairSetPin(pin);
        // done: no popup on the screen (quiet), its Remote panel shows the new PIN
        if (why) result(false, why);
        else reply("DLZMOD_NET_RESULT", { ok: true, text: pin ? "Your own PIN is set" : "Back to a random PIN", quiet: true });
      } else result(false, "Unknown network action");
    } finally {
      DLZMOD_net.busy = false;
      DLZMOD_net.sshBusy = "";
    }
    reply("DLZMOD_NET_STATE", await state());
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
