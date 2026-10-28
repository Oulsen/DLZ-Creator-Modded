// Tests for dlzmod-server.js: node install/server-mod/test-dlzmod-server.js
// Loads the file in a vm context, the way it runs once appended to server.js.
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const vm = require("vm");

const ctx = vm.createContext({ require, process, Buffer, setTimeout, clearTimeout, setInterval, clearInterval,
  console: { log() {}, error() {} } });
vm.runInContext(fs.readFileSync(path.join(__dirname, "dlzmod-server.js"), "utf8"), ctx);
// the pairing state (#45) in a folder of its own, never this PC's /var/lib; pairIn() gives a test a fresh one
const pairIn = (name) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dlzpair-" + name + "-"));
  ctx.DLZMOD_pairDir = () => dir;
  return dir;
};
pairIn("start");
const { DLZMOD_pickRecName: pick, DLZMOD_recAnimal: animal, DLZMOD_animals: animals,
  DLZMOD_recName: recName, DLZMOD_updateNoteFrom: noteFrom, DLZMOD_updateStatusFrom: statusFrom,
  DLZMOD_updateNoteSend: noteSend, DLZMOD_updateNoteSeen: noteSeen } = ctx;
const NAME = (n) => new RegExp("^REC_" + n + "_[a-z]{2,10}$");
const files = (o) => (name) => o[name] || "";
const plain = (o) => o && JSON.parse(JSON.stringify(o));   // objects from the vm context

const tests = [];
const test = (name, fn) => tests.push([name, fn]);

test("empty folder starts at REC_0001", () => {
  assert.strictEqual(pick([], ""), "REC_0001");
});
test("next after the highest number", () => {
  assert.strictEqual(pick(["REC_0001.wav", "REC_0003.wav", "notes.txt"], ""), "REC_0004");
});
test("a name sorting after REC_ does not lower the number (stock picks REC_0003 here)", () => {
  const e = ["REC_0001.wav", "REC_0002.wav", "REC_0003.wav", "REC_0004.wav", "REC_0005.wav", "old_REC_0002.wav"];
  assert.strictEqual(pick(e, ""), "REC_0006");
});
test("lower-case names count (FAT is case-insensitive)", () => {
  assert.strictEqual(pick(["REC_0001.wav", "rec_0004.WAV"], ""), "REC_0005");
});
test("multitrack folders count", () => {
  assert.strictEqual(pick(["REC_0007"], ""), "REC_0008");
});
test("dated names (earlier builds) count", () => {
  assert.strictEqual(pick(["REC_0042_2026-10-09_1432.wav"], ""), "REC_0043");
});
test("after REC_9999 comes REC_10000 (stock throws)", () => {
  assert.strictEqual(pick(["REC_9999.wav"], ""), "REC_10000");
  assert.strictEqual(pick(["REC_10000.wav"], ""), "REC_10001");
});
test("suffix is appended after the number", () => {
  assert.strictEqual(pick(["REC_0041.wav"], "2026-10-09_1432"), "REC_0042_2026-10-09_1432");
  assert.strictEqual(pick(["REC_0041.wav"], "otter"), "REC_0042_otter");
});
test("tagged and animal names count (older cards have random tags)", () => {
  assert.strictEqual(pick(["REC_0003_k7q2.wav"], ""), "REC_0004");
  assert.strictEqual(pick(["REC_0007_otter.wav"], ""), "REC_0008");
});
test("numbers on the other media count", () => {
  assert.strictEqual(pick(["REC_0002_owl.wav"], "yak", ["REC_0009_lynx.wav", "REC_0010_emu"]), "REC_0011_yak");
  assert.strictEqual(pick([], "yak", ["rec_0001_yak.WAV"]), "REC_0002_yak");
  assert.strictEqual(pick(["REC_0004.wav"], "yak", []), "REC_0005_yak");
});
test("animals: lower case a-z, at most 10 letters, no duplicates, 128-160 of them", () => {
  const a = animals();
  assert.ok(a.length >= 128 && a.length <= 160, a.length + " animals");
  assert.strictEqual(new Set(a).size, a.length, "duplicates");
  for (const x of a) assert.match(x, /^[a-z]{2,10}$/);
});
test("animal: no repeat until the whole list is used, then a new round", () => {
  animal.queue = null;
  const n = animals().length;
  const round = new Set();
  for (let i = 0; i < n; i++) round.add(animal());
  assert.strictEqual(round.size, n);
  assert.ok(animals().includes(animal()));
  animal.queue = null;
});
test("animal: shuffled with the given random source", () => {
  animal.queue = null;
  const a = animals();
  // r() = 0 always swaps with the first element: a fixed, checkable order
  const first = animal(() => 0);
  assert.strictEqual(first, a[0]);
  animal.queue = null;
});
test("recName creates a missing folder and skips taken names", async () => {
  const dir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "dlzrec-")), "DLZ_Creator_XS_Recordings");
  const first = await recName(dir);
  assert.match(first, NAME("0001"));
  assert.ok(fs.statSync(dir).isDirectory());
  fs.writeFileSync(path.join(dir, first + ".wav"), "");
  assert.match(await recName(dir), NAME("0002"));
});
test("recName counts the other media's folder, skips missing ones and '-'", async () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "dlzrec-"));
  const sd = path.join(base, "sd", "DLZ_Creator_XS_Recordings");
  const usb = path.join(base, "usb", "DLZ_Creator_XS_Recordings");
  fs.mkdirSync(usb, { recursive: true });
  fs.writeFileSync(path.join(usb, "REC_0041_owl.wav"), "");
  const others = [sd, usb, path.join(base, "none", "DLZ_Creator_XS_Recordings"), "-/DLZ_Creator_XS_Recordings"];
  const cwd = process.cwd();
  process.chdir(base);
  try {
    assert.match(await recName(sd, others), NAME("0042"));
    assert.ok(!fs.existsSync(path.join(base, "-")), "made a folder for an empty slot");
  } finally {
    process.chdir(cwd);
  }
});
test("recName: a hung other medium delays the start by at most 2 s", async () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "dlzrec-"));
  const sd = path.join(base, "sd");
  const hung = path.join(base, "hung");
  const readdir = fs.promises.readdir;
  fs.promises.readdir = (p, ...a) => (p === hung ? new Promise(() => {}) : readdir(p, ...a));
  try {
    const t0 = Date.now();
    assert.match(await recName(sd, [hung]), NAME("0001"));
    const dt = Date.now() - t0;
    assert.ok(dt >= 1900 && dt < 3000, dt + " ms");
  } finally {
    fs.promises.readdir = readdir;
  }
});
test("recName refuses when the folder cannot be read", async () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "dlzrec-")), "not-a-folder");
  fs.writeFileSync(file, "");
  assert.strictEqual(await recName(file), null);
});

test("update note: nothing installed, or all shown: none", () => {
  assert.strictEqual(noteFrom(files({})), null);
  assert.strictEqual(noteFrom(files({ installed: "v0.1.0 (dev-a)", shown: "v0.1.0 (dev-a)" })), null);
});
test("update note: a new build is announced; a card from before the popup (no shown) too", () => {
  assert.deepStrictEqual(plain(noteFrom(files({ installed: "v0.1.0 (dev-b)", shown: "v0.1.0 (dev-a)" }))),
    { ok: true, version: "v0.1.0 (dev-b)" });
  assert.deepStrictEqual(plain(noteFrom(files({ installed: "v0.1.0 (dev-b)" }))), { ok: true, version: "v0.1.0 (dev-b)" });
});
test("update note: a failure comes first, once per failed file", () => {
  const f = { installed: "v0.1.0 (dev-b)", shown: "v0.1.0 (dev-a)", failed: "abc", "last-report": "update-3.txt" };
  assert.deepStrictEqual(plain(noteFrom(files(f))), { ok: false, report: "update-3.txt" });
  assert.deepStrictEqual(plain(noteFrom(files({ ...f, "shown-failed": "abc" }))), { ok: true, version: "v0.1.0 (dev-b)" });
  assert.strictEqual(noteFrom(files({ ...f, shown: "v0.1.0 (dev-b)", "shown-failed": "abc" })), null);
});
test("update status: the installed build, and the last refusal next to it", () => {
  assert.deepStrictEqual(plain(statusFrom(files({}))), { installed: "", failed: "", pending: null, local: false });
  assert.deepStrictEqual(plain(statusFrom(files({ installed: "v0.1.0 (dev-b)" }))), { installed: "v0.1.0 (dev-b)", failed: "", pending: null, local: false });
  assert.deepStrictEqual(plain(statusFrom(files({ installed: "v0.1.0", failed: "x", "last-report": "update-2-unknown-version.txt" }))),
    { installed: "v0.1.0", failed: "Last update not installed: see dlzmod-logs/update-2-unknown-version.txt on the card", pending: null, local: false });
  assert.deepStrictEqual(plain(statusFrom(files({ installed: "v0.1.0", failed: "x" }))),
    { installed: "v0.1.0", failed: "Last update not installed: see dlzmod-logs on the card", pending: null, local: false });
});
test("update note round trip: sent at every screen load until OK, then not again", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dlzupd-"));
  fs.writeFileSync(path.join(dir, "installed"), "v0.1.0 (dev-b)\n");
  const sent = [];
  noteSend((m) => sent.push(plain(m)), dir);
  assert.deepStrictEqual(sent.map((m) => m.cmd), ["DLZMOD_UPDATE_STATUS", "DLZMOD_UPDATE_NOTE"]);
  assert.ok(sent.every((m) => m.id === 0));
  assert.deepStrictEqual(sent[1].data, { ok: true, version: "v0.1.0 (dev-b)" });
  sent.length = 0;
  noteSend((m) => sent.push(plain(m)), dir);   // switched off before the OK: again
  assert.strictEqual(sent.length, 2);
  noteSeen(dir);
  assert.strictEqual(fs.readFileSync(path.join(dir, "shown"), "utf8"), "v0.1.0 (dev-b)\n");
  assert.ok(!fs.existsSync(path.join(dir, "shown.dlzmod-new")));
  sent.length = 0;
  noteSend((m) => sent.push(plain(m)), dir);
  assert.deepStrictEqual(sent.map((m) => m.cmd), ["DLZMOD_UPDATE_STATUS"]);
});
test("update note: a failure's OK marks it, the next failure shows again", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dlzupd-"));
  fs.writeFileSync(path.join(dir, "installed"), "v0.1.0 (dev-a)\n");
  fs.writeFileSync(path.join(dir, "shown"), "v0.1.0 (dev-a)\n");
  fs.writeFileSync(path.join(dir, "failed"), "sum1\n");
  fs.writeFileSync(path.join(dir, "last-report"), "update-2.txt\n");
  const notes = () => {
    const sent = [];
    noteSend((m) => sent.push(plain(m)), dir);
    return sent.filter((m) => m.cmd === "DLZMOD_UPDATE_NOTE").map((m) => m.data);
  };
  assert.deepStrictEqual(notes(), [{ ok: false, report: "update-2.txt" }]);
  noteSeen(dir);
  assert.deepStrictEqual(notes(), []);
  fs.writeFileSync(path.join(dir, "failed"), "sum2\n");
  assert.strictEqual(notes().length, 1);
});
test("update note: an OK with nothing new to mark writes nothing (any client can send a burst)", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dlzupd-"));
  fs.writeFileSync(path.join(dir, "installed"), "v0.1.0 (dev-a)\n");
  fs.writeFileSync(path.join(dir, "failed"), "sum1\n");
  noteSeen(dir);
  const old = new Date(2000, 0, 1);
  for (const n of ["shown", "shown-failed"]) fs.utimesSync(path.join(dir, n), old, old);
  for (let i = 0; i < 100; i++) noteSeen(dir);
  for (const n of ["shown", "shown-failed"]) {
    assert.strictEqual(fs.statSync(path.join(dir, n)).mtimeMs, old.getTime(), n + " rewritten");
  }
  fs.writeFileSync(path.join(dir, "installed"), "v0.1.1 (dev-b)\n");
  noteSeen(dir);
  assert.strictEqual(fs.readFileSync(path.join(dir, "shown"), "utf8"), "v0.1.1 (dev-b)\n");
  assert.strictEqual(fs.statSync(path.join(dir, "shown-failed")).mtimeMs, old.getTime());
});
test("card note: the card check's text first, at every screen load, nothing without the file", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dlzupd-"));
  const card = path.join(dir, "dlzmod-cardcheck");
  const cmds = () => {
    const sent = [];
    noteSend((m) => sent.push(plain(m)), dir, card);
    return sent;
  };
  assert.deepStrictEqual(cmds().map((m) => m.cmd), ["DLZMOD_UPDATE_STATUS"]);
  fs.writeFileSync(card, "This card was made for another mixer. Install again with the installer on this mixer.\n");
  for (let i = 0; i < 2; i++) {
    const sent = cmds();
    assert.deepStrictEqual(sent.map((m) => m.cmd), ["DLZMOD_CARD_NOTE", "DLZMOD_UPDATE_STATUS"]);
    assert.strictEqual(sent[0].data, "This card was made for another mixer. Install again with the installer on this mixer.");
    assert.strictEqual(sent[0].id, 0);
  }
});
test("update note: a missing folder sends only an empty status, OK does not throw", () => {
  const dir = path.join(os.tmpdir(), "dlzupd-missing-" + process.pid);
  const sent = [];
  noteSend((m) => sent.push(plain(m)), dir);
  assert.deepStrictEqual(sent.map((m) => [m.cmd, m.data]), [["DLZMOD_UPDATE_STATUS", { installed: "", failed: "", pending: null, local: false }]]);
  noteSeen(dir);
  assert.ok(!fs.existsSync(dir));
});
test("update note: a send that throws is caught", () => {
  noteSend(() => {
    throw new Error("socket closed");
  }, os.tmpdir());
});

// #65: an update waits for Install on the mixer's own screen. The updater writes "pending"; Install
// writes "approved" (DLZMOD_updateApprove)
const { DLZMOD_updatePendingFrom: pendingFrom, DLZMOD_updateApprove: approve } = ctx;
const SUM_A = "a".repeat(64), SUM_B = "b".repeat(64);
const onScreen = (sent) => Object.assign((m) => sent.push(plain(m)), { dlzmodLocal: true });
const pendingDir = (sum = SUM_A, version = "v0.2.0 (dev-c0e3084)") => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dlzupd-"));
  fs.writeFileSync(path.join(dir, "installed"), "v0.1.0\n");
  fs.writeFileSync(path.join(dir, "shown"), "v0.1.0\n");
  fs.writeFileSync(path.join(dir, "pending"), sum + " " + version + "\n");
  return dir;
};
test("update pending: the record and the checked version; anything else is no update", () => {
  assert.deepStrictEqual(plain(pendingFrom(files({ pending: SUM_A + " v0.2.0 (dev-c0e3084)" }))),
    { sum: SUM_A, version: "v0.2.0 (dev-c0e3084)", approved: false });
  assert.deepStrictEqual(plain(pendingFrom(files({ pending: SUM_A + " v0.2.0", approved: SUM_A }))),
    { sum: SUM_A, version: "v0.2.0", approved: true });
  assert.strictEqual(pendingFrom(files({ pending: SUM_A + " v0.2.0", approved: SUM_B })).approved, false);
  for (const bad of ["", SUM_A, SUM_A + " ", "xyz v0.2.0", SUM_A.slice(1) + " v0.2.0", SUM_A.toUpperCase() + " v0.2.0"]) {
    assert.strictEqual(pendingFrom(files({ pending: bad })), null, JSON.stringify(bad));
  }
  assert.strictEqual(plain(statusFrom(files({ pending: SUM_A + " v0.2.0" }), true)).pending.version, "v0.2.0");
});
test("update ask: on the mixer's own screen at every load until Install; other devices only see the status", () => {
  const dir = pendingDir();
  for (let i = 0; i < 2; i++) {   // Later: asked again
    const sent = [];
    noteSend(onScreen(sent), dir);
    assert.deepStrictEqual(sent.map((m) => m.cmd), ["DLZMOD_UPDATE_STATUS", "DLZMOD_UPDATE_ASK"]);
    assert.deepStrictEqual(sent[1].data, { sum: SUM_A, version: "v0.2.0 (dev-c0e3084)", approved: false });
    assert.strictEqual(sent[0].data.local, true);
  }
  const phone = [];
  noteSend((m) => phone.push(plain(m)), dir);
  assert.deepStrictEqual(phone.map((m) => m.cmd), ["DLZMOD_UPDATE_STATUS"]);
  assert.strictEqual(phone[0].data.local, false);
  assert.strictEqual(phone[0].data.pending.version, "v0.2.0 (dev-c0e3084)");
});
test("update approve: from the screen writes this record, flushed; then no more question", () => {
  const dir = pendingDir();
  const sent = [];
  approve({ sum: SUM_A }, onScreen(sent), dir);
  assert.strictEqual(fs.readFileSync(path.join(dir, "approved"), "utf8"), SUM_A + "\n");
  assert.ok(!fs.existsSync(path.join(dir, "approved.dlzmod-new")));
  assert.deepStrictEqual(sent.map((m) => m.cmd), ["DLZMOD_UPDATE_APPROVED", "DLZMOD_UPDATE_STATUS"]);
  assert.strictEqual(sent[0].data.ok, true);
  assert.strictEqual(sent[0].data.text, "Ready to install v0.2.0 (dev-c0e3084).\nSwitch the mixer off and on.");
  assert.strictEqual(sent[1].data.pending.approved, true);
  const again = [];
  noteSend(onScreen(again), dir);
  assert.deepStrictEqual(again.map((m) => m.cmd), ["DLZMOD_UPDATE_STATUS"]);
  // a second Install (the Mod page, a double tap) answers the same and does not write again
  const old = new Date(2000, 0, 1);
  fs.utimesSync(path.join(dir, "approved"), old, old);
  const twice = [];
  approve({ sum: SUM_A }, onScreen(twice), dir);
  assert.strictEqual(twice[0].data.ok, true);
  assert.strictEqual(fs.statSync(path.join(dir, "approved")).mtimeMs, old.getTime());
});
test("update approve: never from another device, nor for a record that is not the waiting one", () => {
  const dir = pendingDir();
  const phone = [];
  approve({ sum: SUM_A }, (m) => phone.push(plain(m)), dir);
  approve({ sum: SUM_A }, Object.assign((m) => phone.push(plain(m)), { dlzmodLocal: "yes" }), dir);
  assert.deepStrictEqual(phone.map((m) => [m.cmd, m.data.ok]), [["DLZMOD_UPDATE_APPROVED", false], ["DLZMOD_UPDATE_APPROVED", false]]);
  assert.match(phone[0].data.text, /mixer's own screen/);
  const sent = [];
  for (const args of [{ sum: SUM_B }, {}, null, { sum: [SUM_A] }, "x"]) approve(args, onScreen(sent), dir);
  assert.ok(sent.every((m) => m.cmd === "DLZMOD_UPDATE_APPROVED" && m.data.ok === false));
  assert.ok(!fs.existsSync(path.join(dir, "approved")));
  // no update waiting (installed since, or the file removed): nothing written
  const none = fs.mkdtempSync(path.join(os.tmpdir(), "dlzupd-"));
  const s2 = [];
  approve({ sum: SUM_A }, onScreen(s2), none);
  assert.strictEqual(s2[0].data.ok, false);
  assert.deepStrictEqual(fs.readdirSync(none), []);
});
test("update approve: a write that fails says so, and a send that throws is caught", () => {
  const dir = pendingDir();
  fs.mkdirSync(path.join(dir, "approved"));   // where the file should go: the rename fails
  const sent = [];
  approve({ sum: SUM_A }, onScreen(sent), dir);
  assert.deepStrictEqual(sent.map((m) => [m.cmd, m.data.ok]), [["DLZMOD_UPDATE_APPROVED", false]]);
  approve({ sum: SUM_A }, Object.assign(() => {
    throw new Error("socket closed");
  }, { dlzmodLocal: true }), pendingDir());
});

// Network panel. fakeNet: a pretend nmcli/systemctl that records every call (program, args, stdin)
const { DLZMOD_nmSplit: nmSplit, DLZMOD_wifiSecurity: wifiSec, DLZMOD_wifiParseList: parseList,
  DLZMOD_wifiPskOk: pskOk, DLZMOD_sshPasswordOk: sshPwOk, DLZMOD_wifiKeyfile: keyfile,
  DLZMOD_wifiFile: wifiFile, DLZMOD_wifiSaved: wifiSaved, DLZMOD_net: net, DLZMOD_netState: netState,
  DLZMOD_isLocal: isLocal } = ctx;
const SCAN = " :Studio 5G:82:WPA2\n :Studio 5G:61:WPA2\n*:Home\\:Net:74:WPA2 WPA3\n :Cafe:51:\n" +
  " ::30:WPA2\n :Office:40:WPA2 802.1X\n :New:35:WPA3\n";
function fakeNet(o = {}) {
  const calls = [];
  const run = async (file, args, input, timeout) => {
    calls.push({ file, args: [...args], input, timeout });
    const a = args.join(" ");
    if (/device status$/.test(a)) return { ok: true, out: "eth0:ethernet:unavailable\n" + (o.nostick ? "" : "wlan0:wifi:" + (o.state || "connected") + "\n"), err: "" };
    if (/wifi list/.test(a)) return { ok: !o.scanFails, out: o.scanFails ? "" : SCAN, err: "" };
    if (/IP4.ADDRESS/.test(a)) return { ok: true, out: "192.168.1.42/24\n", err: "" };
    if (/connection up/.test(a)) return o.wrong ? { ok: false, out: "", err: "Error: Connection activation failed: Secrets were required, but not provided." } : { ok: true, out: "", err: "" };
    if (a === "is-active ssh") return { ok: !!o.ssh, out: o.ssh ? "active\n" : "inactive\n", err: "" };
    if (o.fail && file.endsWith(o.fail)) return { ok: false, out: "", err: "failed" };
    return { ok: true, out: "", err: "" };
  };
  return { run, calls };
}
const tmpDir = (name) => fs.mkdtempSync(path.join(os.tmpdir(), "dlznet-" + name + "-"));
// the device's own screen (server.js stamps its connection's send, see patch.py); remote: a browser on the LAN
const local = (fn) => Object.assign(fn, { dlzmodLocal: true });
const sendTo = (sent) => local((m) => sent.push(plain(m)));
const remoteTo = (sent) => (m) => sent.push(plain(m));
const result = (sent) => sent.filter((m) => m.cmd === "DLZMOD_NET_RESULT").map((m) => m.data);
const noSecret = (calls, secret) => {
  for (const c of calls) assert.ok(!c.args.some((x) => x.includes(secret)), "secret in the arguments of " + c.file);
};

test("nmcli -t fields: escaped colons and backslashes", () => {
  assert.deepStrictEqual([...nmSplit("*:Home\\:Net:74:WPA2")], ["*", "Home:Net", "74", "WPA2"]);
  assert.deepStrictEqual([...nmSplit(" :a\\\\b:1:")], [" ", "a\\b", "1", ""]);
});
test("wifi security from nmcli's column", () => {
  assert.deepStrictEqual(["", "--", "WPA2", "WPA1 WPA2", "WPA2 WPA3", "WPA3", "WEP", "WPA2 802.1X"].map(wifiSec),
    ["open", "open", "wpa-psk", "wpa-psk", "wpa-psk", "sae", "unsupported", "unsupported"]);
});
test("wifi list: one entry per name, connected first, then by signal, hidden left out", () => {
  const l = plain(parseList(SCAN, ["Cafe"]));
  assert.deepStrictEqual(l.map((n) => n.ssid), ["Home:Net", "Studio 5G", "Cafe", "Office", "New"]);
  assert.strictEqual(l[0].active, true);
  assert.strictEqual(l[1].signal, 82);
  assert.strictEqual(l[2].known, true);
  assert.strictEqual(l[2].security, "open");
});
test("wifi list: a name with a line break cannot add rows or fake the connected one", () => {
  // what nmcli -t prints for an access point named "x\n*:Fake:99:WPA2\n" (its ":" escaped), a name
  // with a tab, and the unescaped form for good measure
  const evil = " :x\n*\\:Fake\\:99\\:WPA2\n:74:WPA2\n :Tab\tName:50:WPA2\n *:Fake2:99:WPA2:74:WPA2\n";
  const l = plain(parseList(evil + " :Real:60:WPA2\n"));
  assert.deepStrictEqual(l.map((n) => n.ssid), ["Real"]);
  assert.ok(!l.some((n) => n.active));
});
test("password checks", () => {
  assert.ok(pskOk("12345678") && pskOk("x".repeat(63)) && pskOk("a".repeat(64)) && pskOk(" sp ace \\ \"#;"));
  assert.ok(!pskOk("1234567") && !pskOk("x".repeat(64)) && !pskOk("line\nbreak!") && !pskOk("café-café") && !pskOk(undefined));
  assert.ok(sshPwOk("abcdefgh") && sshPwOk("x".repeat(64)) && !sshPwOk("short") && !sshPwOk("x".repeat(65)) && !sshPwOk("a\nbcdefgh"));
});
test("keyfile: name as bytes, password escaped, open networks without a security part", () => {
  const k = keyfile("Café 5G", "wpa-psk", " a\\b c ", "0123abcd-0000-4000-8000-000000000000");
  assert.ok(k.includes("\nssid=67;97;102;195;169;32;53;71;\n"));
  assert.ok(k.includes("\nkey-mgmt=wpa-psk\npsk=\\sa\\\\b\\sc\\s\n"));
  assert.ok(k.includes("\nuuid=0123abcd-0000-4000-8000-000000000000\n") && k.includes("\nautoconnect=true\n"));
  assert.ok(!keyfile("Cafe", "open", "", "0123abcd-x").includes("wifi-security"));
  assert.ok(!keyfile("Cafe", "open", "", "0123abcd-x").includes("psk"));
});
test("net status: stick, network, address, SSH", async () => {
  const sent = [];
  await net({ op: "status" }, sendTo(sent), fakeNet({ ssh: true }));
  const pair = sent[0].data.pair;
  delete sent[0].data.pair;
  assert.deepStrictEqual(sent, [{ cmd: "DLZMOD_NET_STATE", id: 0, data:
    { stick: true, wifi: "connected", ssid: "Home:Net", signal: 74, ip: "192.168.1.42", ssh: true, sshKeep: false,
      sshBusy: "" } }]);
  assert.deepStrictEqual(Object.keys(pair).sort(), ["devices", "ips", "on", "own", "pin", "wait"], "the Remote Control panel's status");
  const s2 = plain(await netState(fakeNet({ nostick: true }).run));
  assert.strictEqual(s2.stick, false);
  assert.strictEqual(plain(await netState(fakeNet({ state: "connecting (getting IP configuration)" }).run)).wifi, "connecting");
});
test("net scan: list with saved networks marked; a failed scan says so", async () => {
  const dir = tmpDir("scan");
  fs.writeFileSync(wifiFile("Cafe", dir), "[connection]\nuuid=u-1\n");
  const sent = [];
  await net({ op: "scan" }, sendTo(sent), Object.assign(fakeNet(), { dir }));
  assert.strictEqual(sent[0].cmd, "DLZMOD_WIFI_LIST");
  assert.deepStrictEqual(sent[0].data.networks.filter((n) => n.known).map((n) => n.ssid), ["Cafe"]);
  const s2 = [];
  await net({ op: "scan" }, sendTo(s2), Object.assign(fakeNet({ scanFails: true }), { dir }));
  assert.deepStrictEqual(s2[0].data, { networks: [], error: "No Wi-Fi networks found" });
});
test("net connect: keyfile written root-only, loaded and brought up by uuid; password never in arguments", async () => {
  const dir = tmpDir("conn");
  const f = fakeNet();
  const sent = [];
  await net({ op: "connect", ssid: "Studio 5G", security: "wpa-psk", password: "s3cret pass" }, sendTo(sent), Object.assign(f, { dir }));
  assert.deepStrictEqual(result(sent), [{ ok: true, text: "Connected to Studio 5G" }]);
  const file = wifiFile("Studio 5G", dir);
  const k = fs.readFileSync(file, "utf8");
  assert.ok(k.includes("psk=s3cret\\spass\n"));
  if (process.platform !== "win32") assert.strictEqual(fs.statSync(file).mode & 0o777, 0o600);
  const uuid = /^uuid=(.+)$/m.exec(k)[1];
  assert.deepStrictEqual(plain(wifiSaved(dir)), { "Studio 5G": uuid });
  assert.ok(f.calls.some((c) => c.args.join(" ") === "connection load " + file));
  assert.ok(f.calls.some((c) => c.args.join(" ") === "--wait 45 connection up uuid " + uuid));
  noSecret(f.calls, "s3cret");
  assert.ok(f.calls.every((c) => !c.input || !c.input.includes("s3cret")));
  assert.strictEqual(sent[sent.length - 1].cmd, "DLZMOD_NET_STATE");
  assert.deepStrictEqual(fs.readdirSync(dir).filter((n) => n.includes("dlzmod-new")), []);
});
test("net connect: a wrong password leaves nothing behind", async () => {
  const dir = tmpDir("wrong");
  const f = fakeNet({ wrong: true });
  const sent = [];
  await net({ op: "connect", ssid: "Home:Net", security: "wpa-psk", password: "wrongpass" }, sendTo(sent), Object.assign(f, { dir }));
  assert.deepStrictEqual(result(sent), [{ ok: false, text: "Could not connect to Home:Net.\nCheck the password." }]);
  assert.deepStrictEqual(fs.readdirSync(dir), []);
  assert.ok(f.calls.some((c) => /^connection delete uuid /.test(c.args.join(" "))));
});
test("net connect: reconnecting replaces the saved network; open networks need no password", async () => {
  const dir = tmpDir("again");
  const opts = Object.assign(fakeNet(), { dir });
  await net({ op: "connect", ssid: "Cafe", security: "open" }, local(() => {}), opts);
  const first = wifiSaved(dir).Cafe;
  await net({ op: "connect", ssid: "Cafe", security: "open", password: "ignored" }, local(() => {}), opts);
  assert.ok(wifiSaved(dir).Cafe && wifiSaved(dir).Cafe !== first);
  assert.strictEqual(fs.readdirSync(dir).length, 1);
  assert.ok(!fs.readFileSync(wifiFile("Cafe", dir), "utf8").includes("ignored"));
});
test("net connect: bad input refused before anything is written or run", async () => {
  const dir = tmpDir("bad");
  for (const a of [{ ssid: "", security: "open" }, { ssid: "x".repeat(33), security: "open" },
    { ssid: "Office", security: "unsupported", password: "12345678" }, { ssid: "New", security: "sae", password: "short" },
    { ssid: "New", security: "wpa-psk\nkey-mgmt=none", password: "12345678" }]) {
    const f = fakeNet();
    const sent = [];
    await net(Object.assign({ op: "connect" }, a), sendTo(sent), Object.assign(f, { dir }));
    assert.strictEqual(result(sent)[0].ok, false, JSON.stringify(a));
    assert.ok(!f.calls.some((c) => c.args.includes("load") || c.args.includes("up")));
  }
  assert.deepStrictEqual(fs.readdirSync(dir), []);
});
test("net connect: refused without a working stick, nothing written", async () => {
  for (const [o, text] of [[{ nostick: true }, "No working Wi-Fi stick in the USB port"],
    [{ state: "unavailable" }, "The Wi-Fi stick is not ready yet"]]) {
    const dir = tmpDir("nostick");
    const f = fakeNet(o);
    const sent = [];
    await net({ op: "connect", ssid: "Cafe", security: "open" }, sendTo(sent), Object.assign(f, { dir }));
    assert.deepStrictEqual(result(sent), [{ ok: false, text }]);
    assert.deepStrictEqual(fs.readdirSync(dir), []);
    assert.ok(!f.calls.some((c) => c.args.includes("load") || c.args.includes("up")));
  }
});
test("net forget: connection deleted and file removed", async () => {
  const dir = tmpDir("forget");
  const opts = Object.assign(fakeNet(), { dir });
  await net({ op: "connect", ssid: "Cafe", security: "open" }, local(() => {}), opts);
  const sent = [];
  await net({ op: "forget", ssid: "Cafe" }, sendTo(sent), opts);
  assert.deepStrictEqual(result(sent), [{ ok: true, text: "Forgot Cafe" }]);
  assert.deepStrictEqual(fs.readdirSync(dir), []);
});
// SSH markers in a temporary folder (on the mixer: /run and /var/lib/dlzmod-ssh)
const sshMarks = () => {
  const d = tmpDir("sshmark");
  return { sshOnFlag: d + "/run-ssh-on", sshKeepFile: d + "/lib/keep-on" };
};
test("net ssh on: password only on chpasswd's stdin, flushed, password login allowed, host keys, enable; off disables", async () => {
  const sshdDir = tmpDir("sshd");
  fs.writeFileSync(sshdDir + "/10-dlzmod.conf", "PasswordAuthentication no\n");
  fs.writeFileSync(sshdDir + "/50-other.conf", "x\n");
  const marks = sshMarks();
  const f = Object.assign(fakeNet(), { sshdDir }, marks);
  // the unit's condition needs the run marker when enable --now starts it
  let markedAtEnable = null;
  const run0 = f.run;
  f.run = async (file, args, input, timeout) => {
    if (args.join(" ") === "enable --now ssh") markedAtEnable = fs.existsSync(marks.sshOnFlag);
    return run0(file, args, input, timeout);
  };
  const sent = [];
  await net({ op: "ssh", on: true, password: "root pass 1" }, sendTo(sent), f);
  assert.strictEqual(markedAtEnable, true, "run marker written before enable --now");
  assert.deepStrictEqual(result(sent), [{ ok: true, text: "SSH is on: log in as root with the new password" }]);
  assert.deepStrictEqual(f.calls.filter((c) => !/nmcli|is-active/.test(c.file + c.args.join(" "))).map((c) => [c.file, c.args.join(" ")]),
    [["/usr/sbin/chpasswd", ""], ["/bin/sync", ""], ["/usr/bin/ssh-keygen", "-A"], ["/bin/systemctl", "enable --now ssh"], ["/bin/sync", ""]]);
  assert.strictEqual(f.calls.find((c) => c.file === "/usr/sbin/chpasswd").input, "root:root pass 1\n");
  assert.ok(f.calls.find((c) => c.file === "/usr/bin/ssh-keygen").timeout >= 150000, "ssh-keygen needs minutes on this CPU");
  assert.deepStrictEqual(fs.readdirSync(sshdDir), ["50-other.conf"]);
  assert.ok(fs.existsSync(marks.sshOnFlag), "the run marker lets ssh.service start this boot");
  noSecret(f.calls, "root pass");
  fs.mkdirSync(path.dirname(marks.sshKeepFile));
  fs.writeFileSync(marks.sshKeepFile, "");
  const f2 = Object.assign(fakeNet(), marks);
  const s2 = [];
  await net({ op: "ssh", on: false }, sendTo(s2), f2);
  assert.deepStrictEqual(result(s2), [{ ok: true, text: "SSH is off" }]);
  assert.ok(f2.calls.some((c) => c.args.join(" ") === "disable --now ssh"));
  assert.ok(!fs.existsSync(marks.sshOnFlag) && !fs.existsSync(marks.sshKeepFile), "off drops both markers");
});
test("net ssh off: markers dropped even when systemctl fails, so it stays off at the next start", async () => {
  const marks = sshMarks();
  fs.writeFileSync(marks.sshOnFlag, "");
  fs.mkdirSync(path.dirname(marks.sshKeepFile));
  fs.writeFileSync(marks.sshKeepFile, "");
  const sent = [];
  await net({ op: "ssh", on: false }, sendTo(sent), Object.assign(fakeNet({ fail: "systemctl" }), marks));
  assert.deepStrictEqual(result(sent), [{ ok: false, text: "Could not stop SSH" }]);
  assert.ok(!fs.existsSync(marks.sshOnFlag) && !fs.existsSync(marks.sshKeepFile));
});
test("net ssh on: a failed start takes the run marker back", async () => {
  const marks = sshMarks();
  const f = Object.assign(fakeNet(), marks);
  const run0 = f.run;
  f.run = async (file, args, input, timeout) => args.join(" ") === "enable --now ssh"
    ? { ok: false, out: "", err: "failed" } : run0(file, args, input, timeout);
  const sent = [];
  await net({ op: "ssh", on: true, password: "longenough" }, sendTo(sent), f);
  assert.deepStrictEqual(result(sent), [{ ok: false, text: "Could not start SSH" }]);
  assert.ok(!fs.existsSync(marks.sshOnFlag));
});
test("net ssh: a status while SSH is being set up or switched off says so, and not after it is done", async () => {
  for (const [a, step, busy] of [[{ op: "ssh", on: true, password: "longenough" }, "-A", "on"],
    [{ op: "ssh", on: false }, "disable --now ssh", "off"]]) {
    let release;
    const f = Object.assign(fakeNet(), sshMarks());
    const run0 = f.run;
    f.run = (file, args, input, timeout) => (args.join(" ") === step
      ? new Promise((r) => (release = () => r(run0(file, args, input, timeout)))) : run0(file, args, input, timeout));
    const s1 = [], s2 = [], s3 = [];
    const change = net(a, sendTo(s1), f);
    await new Promise((r) => setTimeout(r, 20));
    assert.ok(release, "the change reached " + step);
    await net({ op: "status" }, sendTo(s2), f);
    assert.strictEqual(s2[0].data.sshBusy, busy, a.on ? "setting up" : "switching off");
    release();
    await change;
    const states = s1.filter((m) => m.cmd === "DLZMOD_NET_STATE");
    assert.strictEqual(states[states.length - 1].data.sshBusy, "", "the state after the change is not busy");
    await net({ op: "status" }, sendTo(s3), f);
    assert.strictEqual(s3[0].data.sshBusy, "");
  }
  const s4 = [];
  await net({ op: "ssh", on: true, password: "short" }, sendTo(s4), Object.assign(fakeNet(), sshMarks()));
  assert.strictEqual(s4.find((m) => m.cmd === "DLZMOD_NET_STATE").data.sshBusy, "", "a refused change leaves nothing busy");
});
test("net ssh keep off: also while SSH is not running (a marker left behind), and fine without one", async () => {
  const marks = sshMarks();
  fs.mkdirSync(path.dirname(marks.sshKeepFile));
  fs.writeFileSync(marks.sshKeepFile, "");
  const sent = [];
  await net({ op: "sshKeep", on: false }, sendTo(sent), Object.assign(fakeNet({ ssh: false }), marks));
  assert.deepStrictEqual(result(sent), [{ ok: true, text: "SSH turns off at the next start" }]);
  assert.ok(!fs.existsSync(marks.sshKeepFile));
  const s2 = [];
  const errors = [];
  const err0 = console.error;
  console.error = (...a) => errors.push(a.join(" "));
  try {
    await net({ op: "sshKeep", on: false }, sendTo(s2), Object.assign(fakeNet({ ssh: false }), sshMarks()));
  } finally {
    console.error = err0;
  }
  assert.strictEqual(result(s2)[0].ok, true);
  assert.deepStrictEqual(errors, [], "no folder flush without a marker");
});
test("net ssh keep on: only while SSH runs, a root-only file on the card, shown in the status; off removes it", async () => {
  const marks = sshMarks();
  const s1 = [];
  await net({ op: "sshKeep", on: true }, sendTo(s1), Object.assign(fakeNet({ ssh: false }), marks));
  assert.deepStrictEqual(result(s1), [{ ok: false, text: "Turn SSH on first" }]);
  assert.ok(!fs.existsSync(marks.sshKeepFile));
  const s2 = [];
  await net({ op: "sshKeep", on: true }, sendTo(s2), Object.assign(fakeNet({ ssh: true }), marks));
  assert.deepStrictEqual(result(s2), [{ ok: true, text: "SSH stays on after a restart" }]);
  assert.ok(fs.existsSync(marks.sshKeepFile));
  if (process.platform !== "win32") assert.strictEqual(fs.statSync(marks.sshKeepFile).mode & 0o777, 0o600);
  assert.strictEqual(s2.filter((m) => m.cmd === "DLZMOD_NET_STATE").pop().data.sshKeep, true);
  const s3 = [];
  await net({ op: "sshKeep", on: false }, sendTo(s3), Object.assign(fakeNet({ ssh: true }), marks));
  assert.deepStrictEqual(result(s3), [{ ok: true, text: "SSH turns off at the next start" }]);
  assert.ok(!fs.existsSync(marks.sshKeepFile));
});
test("net ssh on: short password refused, a failing step stops before SSH starts", async () => {
  const f = fakeNet();
  const sent = [];
  await net({ op: "ssh", on: true, password: "short" }, sendTo(sent), f);
  assert.strictEqual(result(sent)[0].ok, false);
  assert.ok(!f.calls.some((c) => /chpasswd|systemctl$/.test(c.file) && c.args[0] !== "is-active"));
  const f2 = fakeNet({ fail: "chpasswd" });
  const s2 = [];
  await net({ op: "ssh", on: true, password: "longenough" }, sendTo(s2), f2);
  assert.deepStrictEqual(result(s2), [{ ok: false, text: "Could not set the password" }]);
  assert.ok(!f2.calls.some((c) => c.args.join(" ") === "enable --now ssh"));
});
test("net: from another device on the network only the status, nothing changed or run", async () => {
  const dir = tmpDir("remote");
  for (const a of [{ op: "ssh", on: true, password: "takeover1" }, { op: "ssh", on: false }, { op: "sshKeep", on: true },
    { op: "connect", ssid: "Cafe", security: "open" }, { op: "forget", ssid: "Cafe" }]) {
    const f = Object.assign(fakeNet(), { dir });
    const sent = [];
    await net(a, remoteTo(sent), f);
    assert.deepStrictEqual(result(sent), [{ ok: false, text: "Network settings can only be changed\non the mixer's own screen." }], a.op);
    assert.deepStrictEqual(f.calls, [], a.op + ": something ran");
  }
  const f = fakeNet();
  const s1 = [];
  await net({ op: "scan" }, remoteTo(s1), f);
  assert.deepStrictEqual(s1[0].data, { networks: [], error: "Only on the mixer's own screen" });
  assert.deepStrictEqual(f.calls, []);
  const s2 = [];
  const f2 = fakeNet({ ssh: true });
  await net({ op: "status" }, remoteTo(s2), f2);
  assert.strictEqual(s2[0].cmd, "DLZMOD_NET_STATE");
  assert.deepStrictEqual(plain(s2[0].data), { stick: false, wifi: "", ssid: "", signal: 0, ip: "", ssh: false, sshKeep: false,
    unknown: true, remote: true }, "no network name, address or SSH state for another device");
  assert.deepStrictEqual(f2.calls, [], "status for another device: nothing ran");
  const s3 = [];
  await net({ op: "ssh", on: false }, Object.assign((m) => s3.push(plain(m)), { dlzmodLocal: "yes" }), fakeNet());
  assert.strictEqual(result(s3)[0].ok, false, "only a true stamp counts");
  assert.deepStrictEqual(fs.readdirSync(dir), []);
});
// #47: stock's file commands, checked before they run
const { DLZMOD_cmdAllowed: cmdOk, DLZMOD_keyAllowed: keyOk, DLZMOD_inMedia: inMedia, DLZMOD_noOrig: noOrig } = ctx;
const HANDLERS = Object.fromEntries(["MEDIA_DELETE", "MEDIA_RENAME", "MEDIA_SWITCH_TRACK", "MEDIA_DIR", "PRESET_WRITE",
  "PRESET_READ", "PRESET_LIST", "PRESET_DELETE", "PRESET_RENAME", "SNAP_SAVE", "SNAP_LOAD", "SNAP_DELETE", "SNAP_RENAME",
  "SAMPLE_LOAD", "SAMPLE_PREVIEW_START", "FORMAT_USB", "REC_START", "DLZMOD_NET", "FACTORY_RESET", "RESET", "RESTART_GUI",
  "DLZMOD_UPDATE_APPROVE"].map((c) => [c, () => {}]));
const ROOTS = ["/media/sd", "-"];
const SCREEN = local(() => {}), PHONE = () => {};
test("files: the screen keeps every file command, with names as stock uses them", () => {
  for (const [cmd, args] of [["MEDIA_DELETE", { path: "sd:/DLZ_Creator_XS_Recordings/REC_0001_otter.wav" }],
    ["MEDIA_RENAME", { path: "/srv/bankPlayer/default/loaded/a.wav", newName: "Vocals....wav" }],
    ["PRESET_WRITE", { type: "eq", name: "AC/DC", data: {} }], ["PRESET_READ", { type: "eq", name: "AC_DC" }],
    ["PRESET_RENAME", { type: "rev", name: "Hall", newName: "Big hall" }], ["SNAP_SAVE", { name: "a/b" }],
    ["SNAP_RENAME", { name: "Show 1", newName: "Show/2" }], ["SAMPLE_LOAD", { path: "\\srv\\bankPlayer\\default\\x.wav" }],
    ["PRESET_LIST", { type: "snaps" }], ["REC_START", undefined], ["DLZMOD_NET", { op: "status" }],
    ["DLZMOD_UPDATE_APPROVE", { sum: "a".repeat(64) }]]) {
    assert.strictEqual(cmdOk(HANDLERS, cmd, args, SCREEN, ROOTS), "", cmd);
  }
});
test("files: other devices keep mixing and presets, but no delete, rename, sample path or format", () => {
  for (const cmd of ["MEDIA_DELETE", "MEDIA_RENAME", "PRESET_DELETE", "PRESET_RENAME", "SNAP_DELETE", "SNAP_RENAME",
    "SAMPLE_LOAD", "SAMPLE_PREVIEW_START", "FORMAT_USB", "DLZMOD_UPDATE_APPROVE"]) {
    assert.strictEqual(cmdOk(HANDLERS, cmd, { type: "eq", name: "a", newName: "b", path: "sd:/x.wav" }, PHONE, ROOTS),
      "only on the mixer's own screen", cmd);
  }
  assert.strictEqual(cmdOk(HANDLERS, "PRESET_WRITE", { type: "eq", name: "Mine", data: {} }, PHONE, ROOTS), "");
  assert.strictEqual(cmdOk(HANDLERS, "PRESET_WRITE", { type: "snaps", name: "x", data: { recFile: "/dev/mmcblk1" } }, PHONE, ROOTS),
    "only on the mixer's own screen", "a snapshot file's keys bypass the key check when loaded");
  assert.strictEqual(cmdOk(HANDLERS, "SNAP_SAVE", { name: "Show 2" }, PHONE, ROOTS), "", "phones still save snapshots");
  assert.strictEqual(cmdOk(HANDLERS, "PRESET_WRITE", { type: "snaps", name: "x", data: {} }, SCREEN, ROOTS), "");
  assert.strictEqual(cmdOk(HANDLERS, "SNAP_LOAD", { name: "Show 1" }, PHONE, ROOTS), "");
  assert.strictEqual(cmdOk(HANDLERS, "MEDIA_SWITCH_TRACK", { path: "sd:/DLZ_Creator_XS_Recordings/REC_0001.wav" }, PHONE, ROOTS), "");
  assert.strictEqual(cmdOk(HANDLERS, "MEDIA_SWITCH_TRACK", { path: "/media/sd/../../srv/srv_data.json" }, PHONE, ROOTS),
    "not on the SD card or USB stick");
  assert.strictEqual(cmdOk(HANDLERS, "MEDIA_SWITCH_TRACK", { path: "usb:/a.wav" }, PHONE, ROOTS), "not on the SD card or USB stick",
    "no stick mounted");
});
test("files: known attack inputs are refused, from any device", () => {
  for (const send of [SCREEN, PHONE]) {
    assert.strictEqual(cmdOk(HANDLERS, "PRESET_WRITE", { type: "../../etc/cron.d", name: "x", data: "* * * * * root id" }, send, ROOTS),
      "not a preset folder");
    assert.strictEqual(cmdOk(HANDLERS, "PRESET_READ", { type: "eq", name: "../../srv_data" }, send, ROOTS), "not a plain name");
    assert.strictEqual(cmdOk(HANDLERS, "SNAP_LOAD", { name: "../../srv_data" }, send, ROOTS), "not a plain name");
    assert.strictEqual(cmdOk(HANDLERS, "PRESET_LIST", {}, send, ROOTS), "not a preset folder");
    assert.strictEqual(cmdOk(HANDLERS, "toString", {}, send, ROOTS), "not a command");
    assert.strictEqual(cmdOk(HANDLERS, "__proto__", {}, send, ROOTS), "not a command");
  }
  assert.strictEqual(cmdOk(HANDLERS, "MEDIA_RENAME", { path: "/srv/server.js.orig", newName: "../server.js" }, SCREEN, ROOTS),
    "not a plain name");
  assert.strictEqual(cmdOk(HANDLERS, "MEDIA_RENAME", { path: "sd:/a.wav", newName: ".." }, SCREEN, ROOTS), "not a plain name");
  assert.strictEqual(cmdOk(HANDLERS, "PRESET_RENAME", { type: "eq", name: "a", newName: "..\\..\\x" }, SCREEN, ROOTS), "not a plain name");
});
test("files: data keys: no prototype keys, file paths only from the screen, track names plain", () => {
  for (const k of ["__proto__", "constructor", "prototype"]) assert.ok(!keyOk(k, {}, SCREEN), k);
  for (const k of ["recFile", "sample.rec.file", "sample.prev.file", "player.currentFileName", "b.1.file"]) {
    assert.ok(!keyOk(k, "/etc/shadow", PHONE), k + " from a phone");
    assert.ok(keyOk(k, "/media/sd/x.wav", SCREEN), k + " from the screen");
  }
  assert.ok(!keyOk("i.1.name", "../../srv/server", PHONE) && !keyOk("p.2.name", "a/b", PHONE));
  assert.ok(keyOk("i.1.name", "Mic 1/2", SCREEN), "the screen keeps stock's names");
  assert.ok(keyOk("i.1.name", "Vocals...", PHONE) && keyOk("i.1.name", "", PHONE) && keyOk("m.fader", 0.5, PHONE));
  assert.ok(keyOk("settings.rec.toUSB", 0, PHONE) && keyOk("filename", "x", PHONE), "only whole .file / recFile names");
});
test("files: a refused key is taken out of the message stock passes on to dspserver (patch.py's loop)", () => {
  const src = fs.readFileSync(path.join(__dirname, "..", "patch.py"), "utf8");
  const m = /"(for\(const\[a,i\]of Object\.entries\(e\)\)if\(null!=a&&\(DLZMOD_keyAllowed[^"]*)"/.exec(src);
  assert.ok(m, "key loop patch found in patch.py");
  const loop = new vm.Script(m[1] + "stored.push(a)}");
  const run = (e, send) => {
    const c = vm.createContext({ e, t: { send }, stored: [], DLZMOD_keyAllowed: keyOk });
    loop.runInContext(c);
    return c.stored;
  };
  const msg = { "m.fader": 0.5, recFile: "/dev/mmcblk1", "sample.prev.file": "/etc/shadow" };
  assert.deepStrictEqual(plain(run(msg, PHONE)), ["m.fader"]);
  assert.deepStrictEqual(plain(msg), { "m.fader": 0.5 }, "what stock broadcasts afterwards");
  const own = { recFile: "/media/sd/x.wav", "m.fader": 0.2 };
  assert.deepStrictEqual(plain(run(own, SCREEN)), ["recFile", "m.fader"]);
  assert.deepStrictEqual(plain(own), { recFile: "/media/sd/x.wav", "m.fader": 0.2 }, "the screen's keys untouched");
});
test("files: inMedia only inside a mounted medium, never the root itself", () => {
  assert.ok(inMedia("sd:/REC_0001.wav", ROOTS) && inMedia("sd:\\a\\b.wav", ROOTS) && inMedia("/media/sd/a.wav", ROOTS));
  assert.ok(!inMedia("sd:/", ROOTS) && !inMedia("/media/sd", ROOTS) && !inMedia("/media/sdx/a.wav", ROOTS)
    && !inMedia("sd:/../x", ROOTS) && !inMedia("a.wav", ROOTS) && !inMedia("sd:/a\0.wav", ROOTS) && !inMedia(5, ROOTS));
});
test("files: originals and temp files not served over HTTP, the rest passes", () => {
  const ask = (p) => {
    let status = 0, passed = false;
    const res = { status(s) { status = s; return this; }, end() {} };
    noOrig({ path: p }, res, () => (passed = true));
    return passed ? "next" : status;
  };
  assert.strictEqual(ask("/srv_data.json.orig"), 404);
  assert.strictEqual(ask("/server.js%2Eorig"), 404);
  assert.strictEqual(ask("/APP.JS.ORIG/"), 404);
  assert.strictEqual(ask("/srv_data.json.dlzmod-new"), 404);
  assert.strictEqual(ask("/%E0%A4%A"), 400);
  assert.strictEqual(ask("/index.html"), "next");
  assert.strictEqual(ask("/presets/eq/original.json"), "next");
});
test("isLocal: loopback in all its forms, nothing else", () => {
  assert.ok(isLocal("127.0.0.1") && isLocal("::1") && isLocal("::ffff:127.0.0.1") && isLocal("127.0.1.1"));
  assert.ok(!isLocal("192.168.1.20") && !isLocal("::ffff:192.168.1.20") && !isLocal("fe80::1") && !isLocal("")
    && !isLocal(undefined) && !isLocal("10.127.0.1") && !isLocal("::10"));
});
test("net status: 'connected (externally)' counts as connected; a status while one runs is dropped", async () => {
  assert.strictEqual(plain(await netState(fakeNet({ state: "connected (externally)" }).run)).wifi, "connected");
  let release;
  const slow = fakeNet();
  const run = (file, args, input) => (args.join(" ").endsWith("device status")
    ? new Promise((r) => (release = () => r(slow.run(file, args, input)))) : slow.run(file, args, input));
  const s1 = [], s2 = [];
  const first = net({ op: "status" }, sendTo(s1), { run });
  await new Promise((r) => setTimeout(r, 10));
  await net({ op: "status" }, sendTo(s2), { run });
  assert.deepStrictEqual(s2, []);
  release();
  await first;
  assert.strictEqual(s1.length, 1);
  const s3 = [];
  await net({ op: "status" }, sendTo(s3), fakeNet());
  assert.strictEqual(s3.length, 1, "next poll answered again");
});
test("net: one change at a time, unknown actions refused", async () => {
  const dir = tmpDir("busy");
  let release;
  const slow = fakeNet();
  const run = (file, args, input) => (args.includes("up") ? new Promise((r) => (release = () => r({ ok: true, out: "", err: "" }))) : slow.run(file, args, input));
  const s1 = [], s2 = [], s3 = [];
  const first = net({ op: "connect", ssid: "Cafe", security: "open" }, sendTo(s1), { run, dir });
  await new Promise((r) => setTimeout(r, 20));
  await net({ op: "forget", ssid: "Cafe" }, sendTo(s2), { run, dir });
  assert.deepStrictEqual(result(s2), [{ ok: false, text: "Still busy with the last change, try again in a moment" }]);
  release();
  await first;
  assert.strictEqual(result(s1)[0].ok, true);
  await net({ op: "reboot" }, sendTo(s3), { run, dir });
  assert.deepStrictEqual(result(s3), [{ ok: false, text: "Unknown network action" }]);
});

// #45: control from other devices, pairing with a PIN
const { DLZMOD_pair: pairState, DLZMOD_pairSet: pairSet, DLZMOD_pairTry: pairTry, DLZMOD_pairForget: pairForget,
  DLZMOD_pairStatus: pairStatus, DLZMOD_pairValid: pairValid, DLZMOD_allowRequest: allowReq,
  DLZMOD_remoteAdmit: admit, DLZMOD_remoteHttp: remoteHttp } = ctx;
const cookie = (token) => "io=x; dlzmod_pair=" + token;
const HOST = "192.168.1.20";
const handshake = (address, headers = {}) => ({ socket: { remoteAddress: address }, headers: Object.assign({ host: HOST }, headers) });
const allowed = (req) => {
  let r;
  allowReq(req, (err, ok) => (r = ok));
  return r;
};
// a paired device: the PIN from the screen's status, the token from the answer
const pairOne = (now = Date.now()) => pairTry(pairStatus(now).pin, now).token;
const fakeSocket = (address, headers) => {
  const ev = new (require("events"))();
  return Object.assign(ev, { handshake: { address, headers: Object.assign({ host: HOST }, headers) }, dropped: 0,
    disconnect() {
      this.dropped++;
      this.emit("disconnect");
    } });
};
test("pairing: off on a fresh card; the mixer itself always gets in, other devices not", () => {
  pairIn("fresh");
  assert.strictEqual(pairStatus().on, false);
  assert.strictEqual(allowed(handshake("127.0.0.1")), true, "the screen, dspserver, faderlink");
  assert.strictEqual(allowed(handshake("::1")), true);
  assert.strictEqual(allowed(handshake("::ffff:127.0.0.1")), true);
  assert.strictEqual(allowed(handshake("192.168.1.50")), false);
  assert.strictEqual(allowed(handshake("::ffff:192.168.1.50")), false);
  assert.strictEqual(pairTry("000000").ok, false);
  assert.strictEqual(pairTry("000000").off, true);
});
test("pairing: the right PIN gives a token once; the PIN changes after each pairing", () => {
  const dir = pairIn("pin");
  assert.strictEqual(pairSet(true), "saved");
  const pin = pairStatus().pin;
  assert.match(pin, /^\d{6}$/);
  const r = pairTry(" " + pin + " ");
  assert.strictEqual(r.ok, true, "spaces around it are fine");
  assert.match(r.token, /^[0-9a-f]{64}$/);
  assert.ok(pairValid(cookie(r.token)));
  assert.ok(!pairValid(cookie(r.token.replace(/^./, (c) => (c === "a" ? "b" : "a")))), "another token");
  assert.ok(!pairValid("dlzmod_pair=" + r.token.slice(1)) && !pairValid(""), "a short token, no cookie");
  assert.notStrictEqual(pairStatus().pin, pin, "one PIN, one device");
  assert.strictEqual(pairTry(pin).ok, false, "the old PIN no longer pairs");
  assert.strictEqual(pairStatus().devices, 1);
  const saved = fs.readFileSync(path.join(dir, "state.json"), "utf8");
  assert.ok(!saved.includes(r.token), "the card keeps only the token's hash");
  for (const bad of ["", "12345", "1234567", "abcdef", null, undefined, 123456]) assert.strictEqual(pairTry(bad).ok, false, String(bad));
});
test("pairing: 5 wrong PINs pause it for 60 s, doubling, at most 15 min; the right PIN waits too", () => {
  pairIn("pause");
  pairSet(true);
  const t0 = 1000000000;
  const pin = pairStatus(t0).pin;
  const wrong = pin === "000000" ? "111111" : "000000";
  for (let i = 0; i < 4; i++) assert.deepStrictEqual(plain(pairTry(wrong, t0)), { ok: false, wait: 0 });
  assert.deepStrictEqual(plain(pairTry(wrong, t0)), { ok: false, wait: 60 }, "the fifth");
  assert.strictEqual(pairTry(pin, t0 + 59000).ok, false, "the right PIN during the pause");
  assert.strictEqual(pairStatus(t0 + 30000).wait, 30, "the screen shows the pause");
  let t = t0 + 60000;
  const pauses = [];
  for (let round = 0; round < 6; round++) {
    let r;
    for (let i = 0; i < 5; i++) r = pairTry(wrong, t);
    pauses.push(r.wait);
    t += r.wait * 1000;
  }
  assert.deepStrictEqual(pauses, [120, 240, 480, 900, 900, 900]);
  assert.strictEqual(pairTry(pin, t).ok, true, "after the pause");
  for (let i = 0; i < 4; i++) pairTry(wrong, t);
  assert.strictEqual(pairTry(wrong, t).wait, 60, "a pairing starts the count again");
});
test("pairing: kept on the card; a damaged state file means off", () => {
  const dir = pairIn("keep");
  pairSet(true);
  const token = pairOne();
  const pin = pairStatus().pin;
  pairIn("other");
  assert.ok(!pairValid(cookie(token)));
  ctx.DLZMOD_pairDir = () => dir;   // read again from the card, as after a restart
  assert.ok(pairValid(cookie(token)));
  assert.strictEqual(pairStatus().pin, pin);
  for (const broken of ["{", "null", '{"on":true,"pin":"12","tokens":[]}', '{"on":"yes","pin":"123456"}']) {
    const d2 = pairIn("broken");
    fs.writeFileSync(path.join(d2, "state.json"), broken);
    assert.strictEqual(pairStatus().on, false, broken);
  }
  const d3 = pairIn("junk");
  fs.writeFileSync(path.join(d3, "state.json"), JSON.stringify({ on: true, pin: "123456", tokens: ["x", "A".repeat(64), "1".repeat(64)] }));
  assert.strictEqual(pairStatus().devices, 1, "junk entries dropped");
  assert.strictEqual(pairState().tokens[0], "1".repeat(64));
});
test("pairing: off and Forget all devices end every pairing and drop paired connections", () => {
  pairIn("forget");
  pairSet(true);
  const t1 = pairOne(), t2 = pairOne();
  assert.strictEqual(pairStatus().devices, 2);
  const s1 = fakeSocket("192.168.1.50", { cookie: cookie(t1) });
  assert.strictEqual(admit(s1, {}), true);
  const pin = pairStatus().pin;
  assert.strictEqual(pairForget(), "saved");
  assert.strictEqual(s1.dropped, 1, "connection dropped");
  assert.ok(!pairValid(cookie(t1)) && !pairValid(cookie(t2)));
  assert.notStrictEqual(pairStatus().pin, pin, "a new PIN");
  assert.strictEqual(pairStatus().on, true);
  const t3 = pairOne();
  const s2 = fakeSocket("192.168.1.51", { cookie: cookie(t3) });
  admit(s2, {});
  assert.strictEqual(pairSet(false), "saved");
  assert.strictEqual(s2.dropped, 1);
  assert.strictEqual(pairStatus().pin, "");
  assert.strictEqual(allowed(handshake("192.168.1.51", { cookie: cookie(t3) })), false);
  assert.strictEqual(pairSet(true), "saved");
  assert.strictEqual(allowed(handshake("192.168.1.51", { cookie: cookie(t3) })), false, "on again: paired anew");
});
test("pairing: socket.io from other devices only paired and from the mixer's own page", () => {
  pairIn("sio");
  pairSet(true);
  const token = pairOne();
  assert.strictEqual(allowed(handshake("192.168.1.50", { cookie: cookie(token) })), true, "no Origin: not a browser");
  assert.strictEqual(allowed(handshake("192.168.1.50", { cookie: cookie(token), origin: "http://" + HOST })), true);
  assert.strictEqual(allowed(handshake("192.168.1.50", { cookie: cookie(token), origin: "http://evil.example" })), false);
  assert.strictEqual(allowed(handshake("192.168.1.50", { cookie: cookie(token), origin: "null" })), false);
  assert.strictEqual(allowed(handshake("192.168.1.50", { origin: "http://" + HOST })), false, "no cookie");
  // the connection itself, checked once more (ua)
  const screen = { dlzmodLocal: true };
  assert.strictEqual(admit(fakeSocket("127.0.0.1", {}), screen), true);
  assert.strictEqual(screen.dlzmodPaired, undefined, "the screen needs no pairing stamp");
  const bad = fakeSocket("192.168.1.50", {}), badSend = {};
  assert.strictEqual(admit(bad, badSend), false);
  assert.strictEqual(bad.dropped, 1);
  assert.strictEqual(badSend.dlzmodPaired, undefined);
  const evil = fakeSocket("192.168.1.50", { cookie: cookie(token), origin: "http://evil.example" });
  assert.strictEqual(admit(evil, {}), false);
  const good = fakeSocket("192.168.1.50", { cookie: cookie(token) }), goodSend = {};
  assert.strictEqual(admit(good, goodSend), true);
  assert.strictEqual(goodSend.dlzmodPaired, true);
  good.emit("disconnect");
  pairForget();
  assert.strictEqual(good.dropped, 0, "a connection that ended is not kept");
});
test("pairing: an own PIN pairs several devices, stays until changed or switched off; obvious ones refused", async () => {
  const dir = pairIn("own");
  const { DLZMOD_pairSetPin: setPin, DLZMOD_pinWeak: weak } = ctx;
  assert.strictEqual(setPin("482915"), "Turn control from other devices on first");
  pairSet(true);
  for (const w of ["000000", "999999", "123456", "234567", "456789", "012345", "987654", "654321", "543210", "121212", "112233", "696969", "123123", "120120", "100001"]) {
    assert.ok(weak(w), w);
    assert.strictEqual(setPin(w), "Too easy to guess.\nPick another PIN.", w);
  }
  for (const ok of ["482915", "135790", "123457", "120934", "855777"]) assert.ok(!weak(ok), ok);
  for (const bad of ["12345", "1234567", "48291a", " 48291", undefined, 482915]) assert.strictEqual(setPin(bad), "A PIN has 6 digits", String(bad));
  const t1 = pairOne();
  assert.strictEqual(setPin("482915"), "");
  assert.ok(pairValid(cookie(t1)), "setting a PIN keeps the devices paired");
  const st = plain(pairStatus());
  assert.strictEqual(st.pin, "482915");
  assert.strictEqual(st.own, true);
  const t2 = pairTry("482915").token, t3 = pairTry("482915").token;
  assert.ok(t2 && t3 && pairValid(cookie(t2)) && pairValid(cookie(t3)), "the same PIN pairs a second and third device");
  assert.strictEqual(pairStatus().pin, "482915", "an own PIN stays after a pairing");
  ctx.DLZMOD_pairDir = () => dir + "-x";
  ctx.DLZMOD_pairDir = () => dir;   // read again, as after a restart
  assert.strictEqual(pairStatus().own, true);
  assert.strictEqual(pairForget(), "saved");
  assert.ok(!pairValid(cookie(t2)));
  assert.strictEqual(pairStatus().pin, "482915", "Forget keeps an own PIN");
  const s1 = [];
  await net({ op: "pairForget" }, sendTo(s1), fakeNet());
  assert.deepStrictEqual(result(s1), [{ ok: true, text: "All devices are forgotten.\nYour own PIN stays." }]);
  const s2 = [];
  await net({ op: "pairPin" }, sendTo(s2), fakeNet());
  assert.deepStrictEqual(result(s2), [{ ok: true, text: "Back to a random PIN", quiet: true }], "no popup: the panel shows the PIN");
  assert.notStrictEqual(pairStatus().pin, "482915");
  assert.strictEqual(pairStatus().own, false);
  const s3 = [];
  await net({ op: "pairPin", pin: " 482915 " }, sendTo(s3), fakeNet());
  assert.deepStrictEqual(result(s3), [{ ok: true, text: "Your own PIN is set", quiet: true }]);
  const s4 = [];
  await net({ op: "pairPin", pin: "111111" }, Object.assign((m) => s4.push(plain(m)), { dlzmodPaired: true }), fakeNet());
  assert.strictEqual(pairStatus().pin, "482915", "a paired phone cannot change the PIN");
  pairSet(false);
  pairSet(true);
  assert.strictEqual(pairStatus().own, false, "off forgets an own PIN");
  assert.notStrictEqual(pairStatus().pin, "482915");
});
test("pairing: a card that cannot save never ends up more open after a restart than the screen says", async () => {
  const dir = pairIn("nosave");
  const restart = () => {
    ctx.DLZMOD_pairDir = () => dir + "-elsewhere";
    pairState();
    ctx.DLZMOD_pairDir = () => dir;
  };
  // a folder where the temp file goes: every save fails, as on a full or read-only card
  const block = () => fs.mkdirSync(path.join(dir, "state.json.dlzmod-new"));
  const unblock = () => fs.rmdirSync(path.join(dir, "state.json.dlzmod-new"));
  block();
  assert.strictEqual(pairSet(true), "", "on is not saved");
  assert.strictEqual(pairStatus().on, false, "so it stays off");
  unblock();
  pairSet(true);
  const token = pairOne(), pin = pairStatus().pin;
  block();
  assert.deepStrictEqual(plain(pairTry(pin)), { ok: false, wait: 0, failed: true }, "a pairing the card did not take");
  assert.strictEqual(pairStatus().pin, pin, "the PIN stays usable");
  assert.strictEqual(ctx.DLZMOD_pairSetPin("482915"), "Could not save the PIN");
  assert.strictEqual(pairStatus().own, false);
  const sock = fakeSocket("192.168.1.50", { cookie: cookie(token) });
  admit(sock, {});
  assert.strictEqual(pairForget(), "removed", "Forget not saved: the file goes, so off");
  assert.strictEqual(sock.dropped, 1);
  assert.strictEqual(pairStatus().on, false);
  restart();
  assert.ok(!pairValid(cookie(token)) && pairStatus().on === false, "after a restart: off, the device forgotten");
  unblock();
  pairSet(true);
  const t2 = pairOne();
  block();
  assert.strictEqual(pairSet(false), "removed", "off not saved: the file goes");
  restart();
  assert.ok(!pairValid(cookie(t2)) && pairStatus().on === false, "after a restart: off");
  unblock();
  pairSet(true);
  pairOne();
  // neither saved nor removed (the state file cannot go): off holds in memory, and the screen says so
  fs.unlinkSync(path.join(dir, "state.json"));
  fs.mkdirSync(path.join(dir, "state.json", "x"), { recursive: true });
  block();
  assert.strictEqual(pairSet(false), "");
  assert.strictEqual(pairStatus().on, false, "off in memory all the same");
  const s1 = [];
  await net({ op: "pair", on: false }, sendTo(s1), fakeNet());
  assert.deepStrictEqual(result(s1), [{ ok: false,
    text: "Off now, but the card could not save it:\npaired devices may come back after a restart." }]);
});
// express-like request and response for the HTTP gate
const httpReq = (address, p, o = {}) => Object.assign(new (require("events"))(), { socket: { remoteAddress: address }, path: p,
  method: o.method || "GET", headers: Object.assign({ host: HOST }, o.headers || {}), setEncoding() {}, resume() {
    this.resumed = true;
  }, destroy() {
    this.destroyed = true;
  } });
const httpRes = () => ({ status: 0, headers: {}, body: "",
  setHeader(name, value) {
    this.headers[name] = value;
  },
  writeHead(status, headers) {
    this.status = status;
    Object.assign(this.headers, headers);
  },
  end(b) {
    this.body += b || "";
  } });
const gate = (req) => {
  const res = httpRes();
  let next = false;
  remoteHttp(req, res, () => (next = true));
  return next ? "next" : res;
};
test("pairing: HTTP: the mixer itself as stock; other devices: off page, PIN page, then only the UI's files", () => {
  pairIn("http");
  assert.strictEqual(remoteHttp.length, 3, "express takes a 4-parameter function for an error handler");
  assert.strictEqual(gate(httpReq("127.0.0.1", "/srv_data.json")), "next", "the mixer itself: unchanged");
  const off = gate(httpReq("192.168.1.50", "/"));
  assert.strictEqual(off.status, 403);
  assert.match(off.body, /Control from other devices is off/);
  assert.ok(!/<form/.test(off.body), "no PIN form while off");
  pairSet(true);
  const form = gate(httpReq("192.168.1.50", "/"));
  assert.strictEqual(form.status, 200);
  assert.match(form.body, /<form method="post" action="\/dlzmod-pair">/);
  assert.ok(!form.body.includes(pairStatus().pin), "the PIN is never on the page");
  assert.strictEqual(gate(httpReq("192.168.1.50", "/app.js")).status, 403, "not paired: not even the UI");
  assert.strictEqual(gate(httpReq("192.168.1.50", "/srv_data.json")).status, 403);
  const token = pairOne();
  const asPaired = (p) => gate(httpReq("192.168.1.50", p, { headers: { cookie: cookie(token) } }));
  for (const p of ["/", "/index.html", "/app.js", "/style.css", "/favicon.ico", "/libs/socket.io.js",
    "/fonts/fa/fa-solid-900.woff", "/img1x/fx.png"]) {
    assert.strictEqual(asPaired(p), "next", p);
  }
  for (const p of ["/srv_data.json", "/presets/eq/a.json", "/presets_factory/eq/a.json", "/package.json", "/server.js",
    "/node_modules/express/package.json", "/emu.html", "/libs/../srv_data.json", "/libs/%2e%2e/srv_data.json",
    "/libs/..%2fsrv_data.json", "/img1x/", "/libs/a%00.js", "/%E0%A4%A"]) {
    const r = asPaired(p);
    assert.ok(r !== "next" && r.status >= 400, p);
  }
});
test("pairing: HTTP: before pairing (also switched off) only the login page's logo and two fonts", () => {
  pairIn("login");
  const files = ["/img1x/DLZ_XS.png", "/img1x/DLZ_Creator.png", "/fonts/proximanova/ProximaNova-Regular.woff",
    "/fonts/proximanova/ProximaNova-Semibold.woff"];
  const other = ["/img1x/fx.png", "/fonts/proximanova/ProximaNova-Bold.woff", "/fonts/proximanova/../../srv_data.json",
    "/img1x/DLZ_XS.png/../../srv_data.json", "/img1x/DLZ_XS.pngx", "/app.js"];
  for (const on of [false, true]) {
    pairSet(on);
    for (const f of files) assert.strictEqual(gate(httpReq("192.168.1.50", f)), "next", f + (on ? " (on)" : " (off)"));
    for (const f of other) assert.notStrictEqual(gate(httpReq("192.168.1.50", f)), "next", f + (on ? " (on)" : " (off)"));
  }
  assert.notStrictEqual(gate(httpReq("192.168.1.50", files[0], { method: "POST" })), "next", "only GET and HEAD");
  const page = gate(httpReq("192.168.1.50", "/"));
  assert.match(page.body, /<img class="l" src="\/img1x\/DLZ_(XS|Creator)\.png"/);
  assert.ok(!/src="(?!\/img1x\/DLZ_)|url\((?!\/fonts\/proximanova\/ProximaNova-(Regular|Semibold)\.woff)/.test(page.body),
    "the page asks for nothing else");
});
test("pairing: HTTP: the PIN form sets an HttpOnly, same-site cookie; wrong PINs and other pages refused", async () => {
  pairIn("post");
  pairSet(true);
  const post = (body, headers) => new Promise((resolve) => {
    const req = httpReq("192.168.1.50", "/dlzmod-pair", { method: "POST", headers });
    const res = httpRes();
    const end = res.end;
    res.end = function (b) {
      end.call(this, b);
      resolve(res);
    };
    remoteHttp(req, res, () => resolve("next"));
    req.emit("data", body);
    req.emit("end");
  });
  const wrong = await post("pin=" + (pairStatus().pin === "000000" ? "111111" : "000000"));
  assert.strictEqual(wrong.status, 200);
  assert.match(wrong.body, /Wrong PIN/);
  assert.strictEqual(wrong.headers["Set-Cookie"], undefined);
  const evil = await post("pin=" + pairStatus().pin, { origin: "http://evil.example" });
  assert.strictEqual(evil.status, 403, "a form on another web page");
  const ok = await post("pin=" + pairStatus().pin, { origin: "http://" + HOST });
  assert.strictEqual(ok.status, 303);
  assert.strictEqual(ok.headers.Location, "/");
  const m = /^dlzmod_pair=([0-9a-f]{64}); Path=\/; Max-Age=\d+; HttpOnly; SameSite=Strict$/.exec(ok.headers["Set-Cookie"]);
  assert.ok(m, ok.headers["Set-Cookie"]);
  assert.ok(pairValid(cookie(m[1])));
  const big = await post("pin=" + "1".repeat(300));
  assert.strictEqual(big.status, 413);
  assert.strictEqual(big.headers.Connection, "close", "the answer goes out, then the connection closes");
  // DNS rebinding: a web page's own name pointed at the mixer, Host and Origin matching each other
  const before = pairStatus().pin;
  const rebound = await post("pin=" + before, { host: "evil.example", origin: "http://evil.example" });
  assert.strictEqual(rebound.status, 421);
  assert.strictEqual(rebound.headers["Set-Cookie"], undefined);
  assert.strictEqual(pairStatus().pin, before, "refused before the PIN is tried");
});
test("pairing: only by the mixer's IP address, its .local name or localhost (DNS rebinding)", () => {
  pairIn("host");
  pairSet(true);
  const token = pairOne();
  const hostOk = ctx.DLZMOD_hostOk;
  for (const h of ["192.168.1.30", "192.168.1.30:80", "[fe80::1]", "[::1]:80", "localhost", "mackie-dlz-creator-xs.local",
    "Mackie-DLZ-Creator-XS.local:80"]) assert.strictEqual(hostOk(h), true, h);
  for (const h of ["evil.example", "192.168.1.30.evil.example", "mixer.lan", "mixer.fritz.box", "mixer", "local",
    "evil.local.example", "192.168.1.30:8080", "", undefined]) assert.strictEqual(hostOk(h), false, String(h));
  const asHost = (host, origin) => ({ cookie: cookie(token), host, origin });
  assert.strictEqual(gate(httpReq("192.168.1.50", "/", { headers: { host: "evil.example" } })).status, 421);
  assert.strictEqual(gate(httpReq("192.168.1.50", "/app.js", { headers: asHost("evil.example") })).status, 421,
    "a paired cookie does not help (and a rebound page has none)");
  assert.strictEqual(gate(httpReq("127.0.0.1", "/", { headers: { host: "evil.example" } })), "next", "the mixer itself: as stock");
  assert.strictEqual(allowed(handshake("192.168.1.50", asHost("evil.example", "http://evil.example"))), false);
  assert.strictEqual(allowed(handshake("192.168.1.50", asHost("mackie-dlz-creator-xs.local", "http://mackie-dlz-creator-xs.local"))),
    true);
  assert.strictEqual(allowed(handshake("192.168.1.50", asHost(undefined, "http://" + HOST))), false, "no Host, but an Origin");
  assert.strictEqual(admit(fakeSocket("192.168.1.50", asHost("evil.example", "http://evil.example")), {}), false);
});
test("pairing: at most 16 devices, the oldest goes first", () => {
  pairIn("cap");
  pairSet(true);
  const tokens = [];
  for (let i = 0; i < 17; i++) tokens.push(pairOne());
  assert.strictEqual(pairValid(cookie(tokens[0])), false, "the first one paired");
  for (const t of tokens.slice(1)) assert.strictEqual(pairValid(cookie(t)), true);
  assert.strictEqual(JSON.parse(fs.readFileSync(path.join(ctx.DLZMOD_pairDir(), "state.json"), "utf8")).tokens.length, 16);
});
// #48: paired devices delete and rename again, recordings only in the recordings folders
const PAIRED = Object.assign(() => {}, { dlzmodPaired: true });
test("files: a paired device deletes and renames recordings, presets and snapshots", () => {
  for (const [cmd, args] of [["MEDIA_DELETE", { path: "sd:/DLZ_Creator_XS_Recordings/REC_0001_otter.wav" }],
    ["MEDIA_DELETE", { path: "/media/sd/DLZ_Creator_Recordings/REC_0002/track1.wav" }],
    ["MEDIA_RENAME", { path: "sd:\\DLZ_Creator_XS_Recordings\\REC_0003_owl.wav", newName: "Interview.wav" }],
    ["MEDIA_RENAME", { path: "sd:/DLZ_Creator_XS_Recordings/REC_0004", newName: "Band take" }],
    ["PRESET_DELETE", { type: "eq", name: "Mine" }], ["PRESET_RENAME", { type: "rev", name: "Hall", newName: "Big hall" }],
    ["SNAP_DELETE", { name: "Show 1" }], ["SNAP_RENAME", { name: "Show 1", newName: "Show 2" }]]) {
    assert.strictEqual(cmdOk(HANDLERS, cmd, args, PAIRED, ROOTS), "", cmd + " " + JSON.stringify(args));
  }
});
test("pairing: installing a mod update stays on the mixer's own screen (#65), also for a paired device", () => {
  assert.strictEqual(cmdOk(HANDLERS, "DLZMOD_UPDATE_APPROVE", { sum: SUM_A }, PAIRED, ROOTS), "only on the mixer's own screen");
  assert.strictEqual(cmdOk(HANDLERS, "DLZMOD_UPDATE_APPROVE", { sum: SUM_A }, SCREEN, ROOTS), "");
  // and the handler itself, should the command filter ever let it through
  const dir = pendingDir();
  const sent = [];
  approve({ sum: SUM_A }, Object.assign((m) => sent.push(plain(m)), { dlzmodPaired: true }), dir);
  assert.deepStrictEqual(sent.map((m) => [m.cmd, m.data.ok]), [["DLZMOD_UPDATE_APPROVED", false]]);
  assert.ok(!fs.existsSync(path.join(dir, "approved")));
  // a paired device loading the page gets the status, never the question
  const loads = [];
  noteSend(Object.assign((m) => loads.push(plain(m)), { dlzmodPaired: true }), dir);
  assert.deepStrictEqual(loads.map((m) => m.cmd), ["DLZMOD_UPDATE_STATUS"]);
});
test("pairing: factory reset, restarting the screen and the System Lock PIN only from the mixer's screen", () => {
  for (const cmd of ["FACTORY_RESET", "RESET", "RESTART_GUI"]) {
    assert.strictEqual(cmdOk(HANDLERS, cmd, {}, PAIRED, ROOTS), "only on the mixer's own screen", cmd + " from a paired device");
    assert.strictEqual(cmdOk(HANDLERS, cmd, {}, SCREEN, ROOTS), "", cmd + " from the screen");
  }
  for (const v of ["1234", "", 0, null]) {
    assert.ok(!keyOk("lock", v, PAIRED), "a paired device cannot set or remove the lock PIN: " + JSON.stringify(v));
    assert.ok(keyOk("lock", v, SCREEN), "the screen can: " + JSON.stringify(v));
  }
  assert.ok(keyOk("i.0.lock", 1, PAIRED), "a channel's lock (mute groups) is another key");
});
test("theme: the theme and its colours only from the mixer's screen", () => {
  for (const k of ["dlzmod.theme", "dlzmod.bgColor", "dlzmod.faderColor"]) {
    assert.ok(!keyOk(k, 1, PAIRED), k + " from a paired device");
    assert.ok(!keyOk(k, 1, {}), k + " from another device");
    assert.ok(keyOk(k, 1, SCREEN), k + " from the screen");
  }
  assert.ok(keyOk("dlzmod.meterMode", 1, PAIRED), "the other mod settings stay as they were");
});
test("files: a paired device changes nothing outside those folders, and no sample paths or formatting", () => {
  for (const p of ["sd:/notes.txt", "sd:/DLZ_Creator_XS_Recordings", "sd:/DLZ_Creator_XS_Recordings/", "sd:/",
    "sd:/DLZ_Creator_XS_Recordings/../dlzmod-update/x.tar", "sd:/DLZ_Creator_XS_Recordings_old/a.wav",
    "/media/sd/DLZ_Creator_XS_Recordings/../../../srv/server.js", "/srv/srv_data.json", "/etc/shadow",
    "usb:/DLZ_Creator_XS_Recordings/a.wav", "sd:/DLZ_Creator_XS_Recordings/a\0.wav", "", undefined, 7]) {
    assert.strictEqual(cmdOk(HANDLERS, "MEDIA_DELETE", { path: p }, PAIRED, ROOTS), "not in a recordings folder", "delete " + p);
    assert.strictEqual(cmdOk(HANDLERS, "MEDIA_RENAME", { path: p, newName: "x.wav" }, PAIRED, ROOTS), "not in a recordings folder",
      "rename " + p);
  }
  assert.strictEqual(cmdOk(HANDLERS, "MEDIA_RENAME", { path: "sd:/DLZ_Creator_XS_Recordings/a.wav", newName: "../../a.wav" },
    PAIRED, ROOTS), "not a plain name");
  assert.strictEqual(cmdOk(HANDLERS, "PRESET_DELETE", { type: "../..", name: "x" }, PAIRED, ROOTS), "not a preset folder");
  assert.strictEqual(cmdOk(HANDLERS, "SNAP_DELETE", { name: "../../srv_data" }, PAIRED, ROOTS), "not a plain name");
  for (const cmd of ["SAMPLE_LOAD", "SAMPLE_PREVIEW_START", "FORMAT_USB"]) {
    assert.strictEqual(cmdOk(HANDLERS, cmd, { path: "sd:/DLZ_Creator_XS_Recordings/a.wav" }, PAIRED, ROOTS),
      "only on the mixer's own screen", cmd);
  }
  assert.strictEqual(cmdOk(HANDLERS, "MEDIA_DELETE", { path: "sd:/DLZ_Creator_XS_Recordings/a.wav" },
    Object.assign(() => {}, { dlzmodPaired: "yes" }), ROOTS), "only on the mixer's own screen", "only a true stamp counts");
  assert.strictEqual(cmdOk(HANDLERS, "MEDIA_DELETE", { path: "/srv/srv_data.json" },
    Object.assign(() => {}, { dlzmodLocal: true, dlzmodPaired: true }), ROOTS), "", "the screen as stock");
  const usb = ["/media/sd", "/media/usb"];
  assert.strictEqual(cmdOk(HANDLERS, "MEDIA_DELETE", { path: "usb:/DLZ_Creator_XS_Recordings/a.wav" }, PAIRED, usb), "",
    "the stick's recordings");
});
test("pairing: the switch and Forget only from the mixer's screen; the PIN only to the screen", async () => {
  pairIn("net");
  const s1 = [];
  await net({ op: "pair", on: true }, sendTo(s1), fakeNet());
  assert.deepStrictEqual(result(s1), [{ ok: true, text: "Control from other devices is on" }]);
  const st = s1.find((m) => m.cmd === "DLZMOD_NET_STATE").data.pair;
  assert.strictEqual(st.on, true);
  assert.match(st.pin, /^\d{6}$/);
  const token = pairOne();
  const s2 = [];
  const phone = Object.assign((m) => s2.push(plain(m)), { dlzmodPaired: true });
  await net({ op: "pair", on: false }, phone, fakeNet());
  await net({ op: "pairForget" }, phone, fakeNet());
  await net({ op: "status" }, phone, fakeNet());
  assert.ok(pairValid(cookie(token)), "a paired phone cannot switch it off or forget devices");
  assert.ok(!JSON.stringify(s2).includes(pairStatus().pin) && !s2.some((m) => m.data && m.data.pair), "no PIN to a phone");
  const s3 = [];
  await net({ op: "pairForget" }, sendTo(s3), fakeNet());
  assert.deepStrictEqual(result(s3), [{ ok: true, text: "All devices are forgotten.\nThe PIN is new." }]);
  assert.ok(!pairValid(cookie(token)));
  const s4 = [];
  await net({ op: "pair", on: false }, sendTo(s4), fakeNet());
  assert.deepStrictEqual(result(s4), [{ ok: true, text: "Control from other devices is off.\nAll devices are forgotten." }]);
  assert.strictEqual(s4.find((m) => m.cmd === "DLZMOD_NET_STATE").data.pair.on, false);
});

// #98: media back to read-only. A /proc/mounts of its own, fake mount calls and data keys
const MOUNTS = [
  "/dev/mmcblk0p1 / ext4 rw,noatime 0 0",
  "/dev/mmcblk0p2 /tmp/mnt/mmcblk0p2 vfat rw,noatime,flush,fmask=0022 0 0",
  "/dev/sda1 /tmp/mnt/sda1 vfat ro,noatime,flush 0 0",
  "/dev/sdb1 /tmp/mnt/my\\040stick vfat rw,noatime 0 0",
  "/dev/sdc1 /media/other vfat rw 0 0",
  "/dev/sdd1 /tmp/mnt/sdd1 exfat rw 0 0",
].join("\n") + "\n";
const roRig = (keys = {}, fail = () => "") => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "dlzro-")), "mounts");
  fs.writeFileSync(file, MOUNTS);
  const calls = [];
  // these tests run last; nothing after them needs the real DLZMOD_run
  ctx.DLZMOD_run = async (f, args) => {
    calls.push([f].concat(args).join(" "));
    const err = fail(args[args.length - 1]);
    return { ok: !err, out: "", err };
  };
  ctx.getDataKey = (k) => keys[k];
  ctx.DLZMOD_roLater.lastRw = 0;
  ctx.DLZMOD_roLater.failLogged = false;
  return { file, calls, keys };
};
const tick = (ms) => new Promise((r) => setTimeout(r, ms));

test("read-only: only the writable FAT media under /tmp/mnt", () => {
  assert.deepStrictEqual(plain(ctx.DLZMOD_rwMedia(MOUNTS)), ["/tmp/mnt/mmcblk0p2", "/tmp/mnt/my stick"]);
  assert.deepStrictEqual(plain(ctx.DLZMOD_rwMedia("")), []);
});
test("read-only: not while recording, paused, saving or a sample take is recorded, to keep or being stored", () => {
  const busy = (k) => ctx.DLZMOD_recBusy((x) => k[x]);
  assert.strictEqual(busy({}), false);
  assert.strictEqual(busy({ recState: 0, hw_rec: 0, "sample.rec.state": 0, "sample.rec.file": "" }), false);
  assert.strictEqual(busy({ recState: 4 }), false, "saved");
  assert.strictEqual(busy({ "sample.rec.state": 2, "sample.rec.file": "" }), false, "stored: the state stays at keep/discard");
  for (const k of [{ recState: 1 }, { recState: 2 }, { recState: 3 }, { hw_rec: 1 }, { "sample.rec.state": 1 },
    { "sample.rec.state": 2, "sample.rec.file": "/tmp/mnt/mmcblk0p2/x/bank_recorder.wav" },
    { "sample.rec.state": 2, "sample.rec.file": "/tmp/mnt/mmcblk0p2/x/RS_0001.wav" }]) {
    assert.strictEqual(busy(k), true, JSON.stringify(k));
  }
});
test("read-only: a remount that hangs holds the queue up for the limit only", async () => {
  ctx.DLZMOD_mountQueue(() => new Promise(() => {}), 50);
  const t = Date.now();
  assert.strictEqual(await ctx.DLZMOD_mountQueue(async () => "next"), "next");
  assert.ok(Date.now() - t >= 40, "waited for the limit");
});
test("read-only: a read-write remount counts from when it is done; finalizing a file counts too", async () => {
  let release;
  const block = ctx.DLZMOD_mountQueue(() => new Promise((r) => (release = r)));
  const rw = ctx.DLZMOD_rw(async () => "rw");
  ctx.DLZMOD_roLater.lastRw = 0;   // as if it had waited longer than 10 s in the queue
  while (!release) await tick(1);   // the queue starts it a few ticks later
  release();
  await block;
  await rw;
  await tick(0);
  assert.ok(Date.now() - ctx.DLZMOD_roLater.lastRw < 1000);
  ctx.DLZMOD_roLater.lastRw = 0;
  await assert.rejects(ctx.DLZMOD_wavfinalize("/nonexistent/a.wav.unfinished", "/nonexistent/a.wav"));
  assert.ok(Date.now() - ctx.DLZMOD_roLater.lastRw < 1000, "noted after wavfinalizer (here: not found)");
});
test("read-only: every writable medium remounted; nothing left: done", async () => {
  const r = roRig({ recState: 0 });
  assert.strictEqual(await ctx.DLZMOD_roNow(r.file), true);
  assert.deepStrictEqual(r.calls, ["/usr/bin/mount -o remount,ro /tmp/mnt/mmcblk0p2", "/usr/bin/mount -o remount,ro /tmp/mnt/my stick"]);
  fs.writeFileSync(r.file, "/dev/mmcblk0p2 /tmp/mnt/mmcblk0p2 vfat ro,noatime 0 0\n");
  r.calls.length = 0;
  assert.strictEqual(await ctx.DLZMOD_roNow(r.file), true);
  assert.deepStrictEqual(r.calls, []);
});
test("read-only: waits while recording and for 10 s after a read-write remount", async () => {
  const r = roRig({ recState: 1 });
  assert.strictEqual(await ctx.DLZMOD_roNow(r.file), false);
  r.keys.recState = 0;
  ctx.DLZMOD_roLater.lastRw = Date.now() - 5000;
  assert.strictEqual(await ctx.DLZMOD_roNow(r.file), false, "a recording starts with the remount, before it shows as recording");
  assert.deepStrictEqual(r.calls, []);
  ctx.DLZMOD_roLater.lastRw = Date.now() - 11000;
  assert.strictEqual(await ctx.DLZMOD_roNow(r.file), true);
  assert.strictEqual(r.calls.length, 2);
});
test("read-only: a refused remount (file open for writing) is tried again, the others still go", async () => {
  const r = roRig({}, (m) => (m === "/tmp/mnt/mmcblk0p2" ? "mount point busy" : ""));
  assert.strictEqual(await ctx.DLZMOD_roNow(r.file), false);
  assert.strictEqual(r.calls.length, 2);
  assert.strictEqual(ctx.DLZMOD_roLater.failLogged, true);
  assert.strictEqual(await ctx.DLZMOD_roNow("/nonexistent/mounts"), false, "an unreadable mount list: later");
});
test("read-only: a remount stuck in the kernel (pulled stick) counts as not done after the limit, the others still go", async () => {
  const r = roRig({});
  const run = ctx.DLZMOD_run;
  let stuck = 0;
  ctx.DLZMOD_run = (f, args) => (args[args.length - 1] === "/tmp/mnt/mmcblk0p2" ? (stuck++, new Promise(() => {})) : run(f, args));
  try {
    const t = Date.now();
    assert.strictEqual(await ctx.DLZMOD_roNow(r.file, 50), false, "looked at again later");
    assert.ok(Date.now() - t < 1000, "did not wait for the stuck one");
    assert.deepStrictEqual(r.calls, ["/usr/bin/mount -o remount,ro /tmp/mnt/my stick"]);
    assert.strictEqual(await ctx.DLZMOD_roNow(r.file, 50), false);
    assert.strictEqual(stuck, 1, "no second mount behind the stuck one");
  } finally {
    ctx.DLZMOD_run = run;
    delete ctx.DLZMOD_roLater.pending;
  }
});
test("read-only: the limit is for the whole call, also with two stuck media (under the queue's 40 s)", async () => {
  const r = roRig({});
  const run = ctx.DLZMOD_run;
  let started = 0;
  ctx.DLZMOD_run = () => (started++, new Promise(() => {}));
  try {
    const t = Date.now();
    const pr = ctx.DLZMOD_roNow(r.file, 200);
    assert.strictEqual(started, 2, "both media started before any wait, side by side");
    assert.strictEqual(await pr, false);
    const took = Date.now() - t;
    assert.ok(took >= 190 && took < 350, "about one limit, not one per medium: " + took + " ms");
  } finally {
    ctx.DLZMOD_run = run;
    delete ctx.DLZMOD_roLater.pending;
  }
});
test("read-only: a remount that finishes after the limit frees its medium for the next try", async () => {
  const r = roRig({});
  const run = ctx.DLZMOD_run;
  let release, started = 0;
  ctx.DLZMOD_run = (f, args) => (args[args.length - 1] === "/tmp/mnt/mmcblk0p2"
    ? (started++, new Promise((res) => (release = res))) : run(f, args));
  try {
    assert.strictEqual(await ctx.DLZMOD_roNow(r.file, 30), false);
    release({ ok: false, out: "", err: "busy" });
    await tick(0);
    assert.strictEqual(await ctx.DLZMOD_roNow(r.file, 30), false);
    assert.strictEqual(started, 2, "a new remount once the old one has ended");
  } finally {
    ctx.DLZMOD_run = run;
    delete ctx.DLZMOD_roLater.pending;
  }
});
test("read-only: remounts one after the other; read-write asked during read-only comes after it, errors stay the caller's", async () => {
  const order = [];
  let release;
  const ro = ctx.DLZMOD_mountQueue(() => new Promise((r) => (release = r)).then(() => order.push("ro")));
  const rw = ctx.DLZMOD_rw(async () => order.push("rw"));
  assert.ok(Date.now() - ctx.DLZMOD_roLater.lastRw < 1000, "read-write noted");
  while (!release) await tick(1);
  await tick(10);
  assert.deepStrictEqual(order, [], "read-write waits for the running read-only");
  release();
  await ro;
  await rw;
  assert.deepStrictEqual(order, ["ro", "rw"]);
  await assert.rejects(ctx.DLZMOD_rw(() => Promise.reject(new Error("mount failed"))), /mount failed/);
  assert.strictEqual(await ctx.DLZMOD_mountQueue(async () => "next"), "next", "a failed remount does not block the queue");
});
test("read-only: the timer remounts once idle and looks again while busy", async () => {
  const r = roRig({ recState: 1 });
  const roNow = ctx.DLZMOD_roNow;
  ctx.DLZMOD_roNow = () => roNow(r.file);
  try {
    ctx.DLZMOD_roLater(0);
    await tick(30);
    assert.deepStrictEqual(r.calls, []);
    assert.ok(ctx.DLZMOD_roLater.timer, "looks again later");
    r.keys.recState = 0;
    ctx.DLZMOD_roLater(0);
    await tick(30);
    assert.strictEqual(r.calls.length, 2);
    assert.strictEqual(ctx.DLZMOD_roLater.timer, null, "done: no more looking");
  } finally {
    clearTimeout(ctx.DLZMOD_roLater.timer);
    ctx.DLZMOD_roNow = roNow;
  }
});

// #26: recordings over the network, read only
const { DLZMOD_recShown: recShown, DLZMOD_recFile: recFile, DLZMOD_recList: recList, DLZMOD_recHttp: recHttp } = ctx;
const recMedia = () => {
  const sd = fs.mkdtempSync(path.join(os.tmpdir(), "dlzrec-sd-"));
  const dir = path.join(sd, "DLZ_Creator_XS_Recordings");
  fs.mkdirSync(dir);
  const put = (name, body, age) => {
    fs.writeFileSync(path.join(dir, name), body);
    const t = new Date(Date.UTC(2026, 9, 1) + age * 60000);
    fs.utimesSync(path.join(dir, name), t, t);
  };
  put("REC_0001_otter.wav", "aaaa", 1);
  put("REC_0002_owl.wav", "bbbbbbbb", 3);
  put("Band take.wav", "cc", 2);
  put("REC_0003_yak.wav.unfinished", "dd", 4);
  put(".hidden.wav", "ee", 5);
  fs.mkdirSync(path.join(dir, "REC_0004"));
  fs.writeFileSync(path.join(sd, "notes.txt"), "not a recording");
  return { sd, dir };
};
test("recordings: names shown and opened; recordings in progress, hidden files and FAT's trailing dots not", () => {
  for (const n of ["REC_0001_otter.wav", "Band take.wav", "Vocals...wav", "REC_0002.WAV"]) assert.ok(recShown(n), n);
  for (const n of ["REC_0003.wav.unfinished", "REC_0003.WAV.UNFINISHED", "REC_0003.wav.unfinished.", "REC_0003.wav.unfinished ",
    "a.wav.", ".hidden.wav", "..", ".", "", "a/b.wav", "a\\b.wav", "a\0.wav", undefined, 7]) {
    assert.ok(!recShown(n), JSON.stringify(n));
  }
});
test("recordings: a download path only into a recordings folder on a mounted medium", () => {
  const roots = ["/tmp/mnt/mmcblk0p2", "-"];
  assert.deepStrictEqual(plain(recFile("/dlzmod-rec/sd/DLZ_Creator_XS_Recordings/Band%20take.wav", roots)),
    { dirPath: "/tmp/mnt/mmcblk0p2/DLZ_Creator_XS_Recordings", path: "/tmp/mnt/mmcblk0p2/DLZ_Creator_XS_Recordings/Band take.wav",
      name: "Band take.wav" });
  assert.strictEqual(recFile("/dlzmod-rec/sd/DLZ_Creator_Recordings/REC_0001.wav", roots).path,
    "/tmp/mnt/mmcblk0p2/DLZ_Creator_Recordings/REC_0001.wav", "the full-size's folder too");
  assert.strictEqual(recFile("/dlzmod-rec/usb/DLZ_Creator_XS_Recordings/REC_0001.wav", ["-", "/tmp/mnt/sda1"]).path,
    "/tmp/mnt/sda1/DLZ_Creator_XS_Recordings/REC_0001.wav");
  for (const p of ["/dlzmod-rec/usb/DLZ_Creator_XS_Recordings/REC_0001.wav", "/dlzmod-rec/sd/DLZ_Creator_XS_Recordings",
    "/dlzmod-rec/sd/DLZ_Creator_XS_Recordings/", "/dlzmod-rec/sd/dlz_creator_xs_recordings/REC_0001.wav",
    "/dlzmod-rec/sd/DLZ_Creator_XS_Recordings/..%2F..%2Fetc%2Fshadow", "/dlzmod-rec/sd/DLZ_Creator_XS_Recordings/%2e%2e",
    "/dlzmod-rec/sd/..%2Fdlzmod-update/x.tar", "/dlzmod-rec/sd/DLZ_Creator_XS_Recordings/REC_0004/track_1.wav",
    "/dlzmod-rec/sd/DLZ_Creator_XS_Recordings/a%00.wav", "/dlzmod-rec/sd/DLZ_Creator_XS_Recordings/%E0%A4%A",
    "/dlzmod-rec/sd/DLZ_Creator_XS_Recordings/REC_0003.wav.unfinished", "/dlzmod-rec/sd/DLZ_Creator_XS_Recordings/x.wav.unfinished.",
    "/dlzmod-rec/hd/DLZ_Creator_XS_Recordings/a.wav", "/dlzmod-rec/constructor/DLZ_Creator_XS_Recordings/a.wav",
    "/dlzmod-rec//DLZ_Creator_XS_Recordings/a.wav", "/x/dlzmod-rec/sd/DLZ_Creator_XS_Recordings/a.wav", "", undefined]) {
    assert.strictEqual(recFile(p, roots), null, String(p));
  }
});
test("recordings: the list has each mounted medium's recordings, newest first, nothing else", async () => {
  const { sd } = recMedia();
  const list = plain(await recList([sd, "-"], false));
  assert.strictEqual(list.recording, false);
  assert.deepStrictEqual(list.media.map((m) => m.medium), ["sd"], "no stick: not listed");
  assert.deepStrictEqual(list.media[0].files.map((f) => [f.dir, f.name, f.size]), [
    ["DLZ_Creator_XS_Recordings", "REC_0002_owl.wav", 8], ["DLZ_Creator_XS_Recordings", "Band take.wav", 2],
    ["DLZ_Creator_XS_Recordings", "REC_0001_otter.wav", 4]]);
  assert.strictEqual(list.media[0].files[0].time, Date.UTC(2026, 9, 1) + 3 * 60000);
  const both = plain(await recList([sd, path.join(sd, "nothing-here")], true));
  assert.strictEqual(both.recording, true);
  assert.deepStrictEqual(both.media.map((m) => [m.medium, m.files.length]), [["sd", 3], ["usb", 0]], "a stick without recordings");
  assert.deepStrictEqual(plain(await recList(["-", "-"], false)), { recording: false, media: [] });
});
// express-like response for DLZMOD_recHttp; done resolves at the end of the answer or at res.download
const recRes = () => {
  const res = Object.assign(new (require("events"))(), { status: 0, headers: {}, body: "", headersSent: false });
  res.done = new Promise((resolve) => {
    res.writeHead = (status, headers) => {
      res.status = status;
      res.headersSent = true;
      Object.assign(res.headers, headers);
    };
    res.end = (b) => {
      res.body += b || "";
      resolve(res);
    };
    res.download = (file, name, opts, cb) => {
      res.sent = { file, name, opts };
      res.cb = cb;
      resolve(res);
    };
    res.destroy = () => {
      res.destroyed = true;
      res.emit("close");
    };
  });
  return res;
};
const recCall = (keys, roots, p, method = "GET") => {
  ctx.getDataKey = (k) => keys[k];
  const res = recRes();
  let next = false;
  recHttp(() => roots)({ path: p, method }, res, () => (next = true));
  return next ? "next" : res.done;
};
test("recordings: HTTP: the list, a download, and nothing while the mixer records", async () => {
  const { sd, dir } = recMedia();
  const roots = [sd, "-"];
  assert.strictEqual(recCall({}, roots, "/app.js"), "next", "other paths: on to the rest");
  assert.strictEqual(recCall({}, roots, "/dlzmod-recx"), "next");
  const list = await recCall({}, roots, "/dlzmod-rec");
  assert.strictEqual(list.status, 200);
  assert.match(list.headers["Content-Type"], /^application\/json/);
  assert.strictEqual(list.headers["Cache-Control"], "no-store");
  assert.deepStrictEqual(JSON.parse(list.body).media[0].files.map((f) => f.name), ["REC_0002_owl.wav", "Band take.wav",
    "REC_0001_otter.wav"]);
  const dl = await recCall({}, roots, "/dlzmod-rec/sd/DLZ_Creator_XS_Recordings/Band%20take.wav");
  assert.deepStrictEqual([dl.sent.file, dl.sent.name], [sd + "/DLZ_Creator_XS_Recordings/Band take.wav", "Band take.wav"]);
  assert.ok(fs.existsSync(dl.sent.file), "the file itself: " + path.relative(dir, dl.sent.file));
  dl.destroy();
  for (const p of ["/dlzmod-rec/sd/DLZ_Creator_XS_Recordings/REC_0004", "/dlzmod-rec/sd/DLZ_Creator_XS_Recordings/gone.wav",
    "/dlzmod-rec/sd/DLZ_Creator_XS_Recordings/REC_0003_yak.wav.unfinished", "/dlzmod-rec/usb/DLZ_Creator_XS_Recordings/a.wav",
    "/dlzmod-rec/sd/notes.txt"]) {
    assert.strictEqual((await recCall({}, roots, p)).status, 404, p);
  }
  assert.strictEqual((await recCall({}, roots, "/dlzmod-rec", "POST")).status, 405, "read only");
  assert.strictEqual((await recCall({}, roots, "/dlzmod-rec/sd/DLZ_Creator_XS_Recordings/x.wav", "DELETE")).status, 405);
  // recording: the list says so, a download waits
  assert.strictEqual(JSON.parse((await recCall({ recState: 1 }, roots, "/dlzmod-rec")).body).recording, true);
  const busy = await recCall({ hw_rec: 1 }, roots, "/dlzmod-rec/sd/DLZ_Creator_XS_Recordings/Band%20take.wav");
  assert.strictEqual(busy.status, 503);
  assert.strictEqual(busy.headers["Retry-After"], "30");
  assert.strictEqual(busy.sent, undefined, "nothing read");
});
test("recordings: a linked recordings folder or file (an ext4 stick) is neither listed nor served", async () => {
  const system = fs.mkdtempSync(path.join(os.tmpdir(), "dlzrec-system-"));
  fs.writeFileSync(path.join(system, "shadow"), "secret");
  const stick = fs.mkdtempSync(path.join(os.tmpdir(), "dlzrec-usb-"));
  // a junction needs no rights on Windows; Linux makes a plain symlink of it
  fs.symlinkSync(system, path.join(stick, "DLZ_Creator_XS_Recordings"), "junction");
  const roots = ["-", stick];
  assert.deepStrictEqual(plain(await recList(roots, false)).media, [{ medium: "usb", files: [] }]);
  assert.strictEqual((await recCall({}, roots, "/dlzmod-rec/usb/DLZ_Creator_XS_Recordings/shadow")).status, 404);
  // a linked file in a real recordings folder (file links need rights on Windows: only where they can be made)
  const { sd, dir } = recMedia();
  let linked = true;
  try {
    fs.symlinkSync(path.join(system, "shadow"), path.join(dir, "notes.wav"), "file");
  } catch (e) {
    linked = false;
  }
  if (linked) {
    assert.ok(!plain(await recList([sd, "-"], false)).media[0].files.some((f) => f.name === "notes.wav"));
    assert.strictEqual((await recCall({}, [sd, "-"], "/dlzmod-rec/sd/DLZ_Creator_XS_Recordings/notes.wav")).status, 404);
  }
});
test("recordings: HTTP: a running download is cut off when the mixer starts recording", async () => {
  const { sd } = recMedia();
  const keys = {};
  const dl = await recCall(keys, [sd, "-"], "/dlzmod-rec/sd/DLZ_Creator_XS_Recordings/REC_0001_otter.wav");
  assert.ok(dl.sent, "downloading");
  await tick(1100);
  assert.ok(!dl.destroyed, "not while nothing records");
  keys["sample.rec.file"] = "sd:/Recorded_Samples/x.wav";
  await tick(1100);
  assert.ok(dl.destroyed, "cut off");
  assert.strictEqual(ctx.DLZMOD_recWatch.timer, null, "no download left: no more checking");
  dl.cb(Object.assign(new Error("aborted"), { code: "ECONNABORTED" }));
});
test("recordings: HTTP: nothing read while a recording file is being finished (wavfinalizer)", async () => {
  const { sd } = recMedia();
  ctx.DLZMOD_wavfinalize.running = 1;
  try {
    assert.strictEqual((await recCall({}, [sd, "-"], "/dlzmod-rec/sd/DLZ_Creator_XS_Recordings/Band%20take.wav")).status, 503);
    assert.strictEqual(JSON.parse((await recCall({}, [sd, "-"], "/dlzmod-rec")).body).recording, true);
  } finally {
    ctx.DLZMOD_wavfinalize.running = 0;
  }
  const after = await recCall({}, [sd, "-"], "/dlzmod-rec/sd/DLZ_Creator_XS_Recordings/Band%20take.wav");
  assert.ok(after.sent, "after it: downloads");
  after.destroy();
});
test("recordings: HTTP: a client gone during the checks is not kept; errors end the answer, never the server", async () => {
  const { sd } = recMedia();
  ctx.getDataKey = () => undefined;
  // gone while the folder and file were checked; first a client still there, the same wait: it
  // reaches the download, so the wait is long enough to show the one gone does not
  const get = (socket) => {
    const r = recRes();
    recHttp(() => [sd, "-"])({ path: "/dlzmod-rec/sd/DLZ_Creator_XS_Recordings/Band%20take.wav", method: "GET", socket }, r,
      () => {});
    return r;
  };
  const still = get({ destroyed: false });
  const res = get({ destroyed: true });
  await tick(100);
  assert.ok(still.sent, "control: a client still there downloads within the wait");
  still.destroy();
  assert.strictEqual(res.sent, undefined, "no download started");
  assert.ok(!(ctx.DLZMOD_recWatch.running || new Set()).has(res), "not watched");
  // a read error halfway (headers sent): the connection is ended, not left hanging
  const dl = await recCall({}, [sd, "-"], "/dlzmod-rec/sd/DLZ_Creator_XS_Recordings/Band%20take.wav");
  dl.headersSent = true;
  dl.cb(Object.assign(new Error("read error"), { code: "EIO" }));
  assert.ok(dl.destroyed, "ended");
  assert.strictEqual(ctx.DLZMOD_recWatch.timer, null, "and no longer watched");
  // a throw where none is expected: a 500, no unhandled rejection
  const bad = recRes();
  bad.download = () => {
    throw new Error("boom");
  };
  recHttp(() => [sd, "-"])({ path: "/dlzmod-rec/sd/DLZ_Creator_XS_Recordings/Band%20take.wav", method: "GET" }, bad, () => {});
  assert.strictEqual((await bad.done).status, 500);
  bad.destroy();
});
test("recordings: file lists again for every client after a change, one message for close calls, never a throw", async () => {
  const sent = [];
  const bus = { send: (m) => sent.push(plain(m)) };
  ctx.DLZMOD_dirsChanged(bus);
  ctx.DLZMOD_dirsChanged(bus);
  await tick(20);
  assert.deepStrictEqual(sent, [{ cmd: "UPDATE_DIRS", id: 0, args: {} }], "two at once: one message");
  ctx.DLZMOD_dirsChanged(bus, 80);
  await tick(30);
  assert.strictEqual(sent.length, 1, "after a recording: not yet");
  await tick(80);
  assert.strictEqual(sent.length, 2, "then");
  // a delete just after a recording stop: one message, at the recording's later time
  ctx.DLZMOD_dirsChanged(bus, 80);
  ctx.DLZMOD_dirsChanged(bus);
  await tick(30);
  assert.strictEqual(sent.length, 2, "not before the recording has its final name");
  await tick(80);
  assert.strictEqual(sent.length, 3, "one message for both");
  // a failing send: tried, nothing thrown
  let tried = 0;
  ctx.DLZMOD_dirsChanged({ send() {
    tried++;
    throw new Error("socket gone");
  } });
  await tick(20);
  assert.strictEqual(tried, 1, "the send was tried");
  assert.strictEqual(ctx.DLZMOD_dirsChanged.timer, null, "and its throw stayed inside");
  // a call from before the server ran (no broadcaster), then one with it: the message reaches it
  ctx.DLZMOD_dirsChanged.bus = undefined;
  const late = [];
  ctx.DLZMOD_dirsChanged(null, 40);
  ctx.DLZMOD_dirsChanged({ send: (m) => late.push(plain(m)) });
  await tick(70);
  assert.deepStrictEqual(late, [{ cmd: "UPDATE_DIRS", id: 0, args: {} }], "the later call's broadcaster");
  // never a broadcaster: nothing sent, nothing thrown
  ctx.DLZMOD_dirsChanged.bus = undefined;
  ctx.DLZMOD_dirsChanged(null);
  await tick(20);
  assert.strictEqual(ctx.DLZMOD_dirsChanged.timer, null);
});
test("recordings: wavfinalizer that fails to start leaves no busy count behind", async () => {
  ctx.DLZMOD_wavfinalize.running = 0;
  // a NUL in a name makes execFile throw at once (ERR_INVALID_ARG_VALUE), before any callback
  await assert.rejects(ctx.DLZMOD_wavfinalize("/tmp/a\0.wav.unfinished", "/tmp/a.wav"));
  assert.strictEqual(ctx.DLZMOD_wavfinalize.running, 0, "downloads are not refused for good");
  assert.ok(!ctx.DLZMOD_recNoRead(), "not busy");
});
test("recordings: HTTP: a paired device reaches them, others do not", () => {
  pairIn("rec");
  pairSet(true);
  for (const p of ["/dlzmod-rec", "/dlzmod-rec/sd/DLZ_Creator_XS_Recordings/REC_0001.wav"]) {
    assert.strictEqual(gate(httpReq("192.168.1.50", p)).status, 403, "not paired: " + p);
  }
  const token = pairOne();
  const asPaired = (p) => gate(httpReq("192.168.1.50", p, { headers: { cookie: cookie(token) } }));
  for (const p of ["/dlzmod-rec", "/dlzmod-rec/sd/DLZ_Creator_XS_Recordings/REC_0001.wav",
    "/dlzmod-rec/sd/DLZ_Creator_XS_Recordings/Band%20take.wav"]) {
    assert.strictEqual(asPaired(p), "next", p);
  }
  for (const p of ["/dlzmod-rec/", "/dlzmod-rec/sd/../../srv_data.json", "/dlzmod-rec/sd/%2e%2e/x", "/dlzmod-recx"]) {
    const r = asPaired(p);
    assert.ok(r !== "next" && r.status >= 400, p);
  }
  pairSet(false);
  assert.strictEqual(gate(httpReq("192.168.1.50", "/dlzmod-rec", { headers: { cookie: cookie(token) } })).status, 403, "off");
});

// #114: a mod update sent from a computer (DLZMOD_updateUpload). The SD card's medium in a temp
// folder, its remount stubbed, the mount table a file listing it as a writable FAT medium; up: {root,
// state, mounts, remounts}
const SIG = Buffer.alloc(64, 7);
const PKG = Buffer.from("x".repeat(300));
const upMedia = () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "dlzup-sd-"));
  const state = fs.mkdtempSync(path.join(os.tmpdir(), "dlzup-state-"));
  const mounts = path.join(state, "mounts");
  fs.writeFileSync(mounts, "/dev/mmcblk0p1 / ext4 rw,noatime 0 0\n/dev/mmcblk0p2 " + root.replace(/ /g, "\\040") +
    " vfat rw,relatime,fmask=0022 0 0\n");
  const remounts = [];
  ctx.DLZMOD_run = async (f, args) => (remounts.push([f].concat(args)), { ok: true, out: "", err: "" });
  ctx.getDataKey = () => undefined;
  return { root, state, mounts, remounts, dir: path.join(root, "dlzmod-update") };
};
// a request whose body comes in chunks; fail: an error after them (the computer went away); wait: ms
// before the end, or before the chunks in late
const upReq = (chunks, o = {}) => {
  const body = Buffer.concat(chunks.concat(o.late || []));
  const r = require("stream").Readable.from((async function* () {
    for (const c of chunks) yield c;
    if (o.wait) await new Promise((resolve) => setTimeout(resolve, o.wait));
    for (const c of o.late || []) yield c;
    if (o.fail) throw new Error("aborted");
  })(), { objectMode: false });
  return Object.assign(r, { socket: { remoteAddress: o.address || "192.168.1.50" }, path: o.path || "/dlzmod-update-upload",
    method: o.method || "POST", headers: Object.assign({ host: HOST, origin: "http://" + HOST,
      "x-dlzmod-name": "dlzmod-v0.2.0.tar", "content-length": String(o.len === undefined ? body.length : o.len) }, o.headers || {}) });
};
// the answer, or (status 0) none once the upload has stopped: a computer that went away gets none
const upCall = (up, req) => {
  const res = recRes();
  let next = false;
  ctx.DLZMOD_updateUpload(() => up.root, up.state, up.mounts)(req, res, () => (next = true));
  if (next) return "next";
  const idle = (async () => {
    do await tick(5); while (ctx.DLZMOD_updateUpload.running);
    await tick(50);
    return res;
  })();
  return Promise.race([res.done, idle]).then(async (r) => {
    // the handler's last step (running off, read-only later) runs just after the answer
    await tick(20);
    clearTimeout(ctx.DLZMOD_roLater.timer);
    return r;
  });
};
const ls = (dir) => (fs.existsSync(dir) ? fs.readdirSync(dir).sort() : []);
test("update upload: the names the drop-in update takes", () => {
  for (const n of ["dlzmod-v0.2.0.tar", "dlzmod-v0.2.0-dev+3.g1a2b3c.tar", "dlzmod-v10.0.1_rc1.tar"]) assert.ok(ctx.DLZMOD_uploadName(n), n);
  for (const n of ["dlzmod-v0.2.0 (1).tar", "dlzmod-v0.2.0.TAR", "DLZMOD-v0.2.0.tar", "dlzmod-.tar", "dlzmod-..tar",
    "dlzmod-a..b.tar", "dlzmod-../x.tar", "dlzmod-a/b.tar", "dlzmod-v0.2.0.tar.sig", "x.tar", "dlzmod-a\0.tar",
    "dlzmod-" + "a".repeat(82) + ".tar", ""]) {
    assert.ok(!ctx.DLZMOD_uploadName(n), JSON.stringify(n));
  }
});
test("update upload: each file synced again under its new name, the signature before the package is renamed", async () => {
  // FAT's rename writes the new entry with size 0 until the file's inode is written back: without
  // these syncs a power cut after the answer left a 0-byte package (tests/upload.sh, case D)
  const up = upMedia();
  const fsp = fs.promises;
  const { rename, open } = fsp;
  const steps = [];
  fsp.rename = async (a, b) => (steps.push("rename " + path.basename(b)), rename(a, b));
  fsp.open = async (f, flags, ...a) => {
    const fh = await open(f, flags, ...a);
    const sync = fh.sync.bind(fh);
    return Object.assign(fh, { sync: () => (steps.push("sync " + path.basename(f)), sync()) });
  };
  try {
    assert.strictEqual((await upCall(up, upReq([SIG, PKG]))).status, 200);
  } finally {
    Object.assign(fsp, { rename, open });
  }
  assert.deepStrictEqual(steps.slice(-4), ["rename dlzmod-v0.2.0.tar.sig", "sync dlzmod-v0.2.0.tar.sig",
    "rename dlzmod-v0.2.0.tar", "sync dlzmod-v0.2.0.tar"]);
  assert.deepStrictEqual(steps.slice(0, 2), ["sync .dlzmod-upload.tar.part", "sync .dlzmod-upload.sig.part"],
    "both temp files synced before anything is replaced");
});
test("update upload: both files in place, older update files replaced, other files and folders left alone", async () => {
  const up = upMedia();
  fs.mkdirSync(up.dir);
  for (const f of ["dlzmod-v0.1.0.tar", "dlzmod-v0.1.0.tar.sig", "dlzmod-v0.1.5.tar.sig", "readme.txt"]) fs.writeFileSync(path.join(up.dir, f), "old");
  fs.mkdirSync(path.join(up.dir, "previous"));
  fs.writeFileSync(path.join(up.dir, ".dlzmod-upload.tar.part"), "left by a power cut");
  // the 64-byte signature split over chunks
  const res = await upCall(up, upReq([SIG.subarray(0, 40), Buffer.concat([SIG.subarray(40), PKG.subarray(0, 100)]), PKG.subarray(100)]));
  assert.strictEqual(res.status, 200, res.body);
  assert.match(res.body, /^dlzmod-v0\.2\.0\.tar is on the mixer's card\.\nSwitch the mixer off and on/);
  assert.deepStrictEqual(ls(up.dir), ["dlzmod-v0.2.0.tar", "dlzmod-v0.2.0.tar.sig", "previous", "readme.txt"]);
  assert.ok(fs.readFileSync(path.join(up.dir, "dlzmod-v0.2.0.tar")).equals(PKG), "the package");
  assert.ok(fs.readFileSync(path.join(up.dir, "dlzmod-v0.2.0.tar.sig")).equals(SIG), "its signature");
  assert.deepStrictEqual(up.remounts, [["/usr/bin/mount", "-o", "remount,rw", up.root]], "the medium writable first");
  assert.ok(!ctx.DLZMOD_updateUpload.running, "the next one may come");
  // the folder made when missing; the same name again replaces it
  const up2 = upMedia();
  assert.strictEqual((await upCall(up2, upReq([SIG, PKG]))).status, 200);
  assert.strictEqual((await upCall(up2, upReq([SIG, Buffer.from("new")]))).status, 200);
  assert.deepStrictEqual(ls(up2.dir), ["dlzmod-v0.2.0.tar", "dlzmod-v0.2.0.tar.sig"]);
  assert.strictEqual(fs.readFileSync(path.join(up2.dir, "dlzmod-v0.2.0.tar"), "utf8"), "new");
});
test("update upload: the medium must be in the mount table as a writable FAT one", () => {
  const t = "/dev/mmcblk0p1 / ext4 rw 0 0\n/dev/mmcblk0p2 /tmp/mnt/mmcblk0p2 vfat rw,relatime 0 0\n" +
    "/dev/sda1 /tmp/mnt/my\\040stick vfat rw 0 0\n/dev/sdb1 /tmp/mnt/sdb1 vfat ro,relatime 0 0\ntmpfs /tmp tmpfs rw 0 0\n";
  assert.ok(ctx.DLZMOD_uploadMounted(t, "/tmp/mnt/mmcblk0p2"));
  assert.ok(ctx.DLZMOD_uploadMounted(t, "/tmp/mnt/my stick"), "octal escapes");
  for (const r of ["/tmp/mnt/sdb1", "/tmp", "/", "/tmp/mnt/mmcblk0p", "/tmp/mnt/mmcblk0p2/", "/tmp/mnt/gone", ""]) {
    assert.ok(!ctx.DLZMOD_uploadMounted(t, r), r);
  }
});
test("update upload: refused before anything is written, with a text for the browser", async () => {
  const cases = [
    [{ method: "GET" }, 405, /^$/], [{ method: "PUT" }, 405, /^$/],
    [{ headers: { origin: "http://evil.example" } }, 403, /^Only from the mixer's own page/],
    [{ headers: { "x-dlzmod-name": "dlzmod-v0.2.0 (1).tar" } }, 400, /not a mod update/],
    [{ headers: { "x-dlzmod-name": undefined } }, 400, /not a mod update/],
    [{ len: "" }, 411, /^$/], [{ len: "12abc" }, 411, /^$/], [{ len: "-5" }, 411, /^$/],
    [{ len: 64 }, 413, /too big/], [{ len: 64 + 64 * 1024 * 1024 + 1 }, 413, /too big/],
  ];
  for (const [o, status, text] of cases) {
    const up = upMedia();
    const req = upReq([SIG, PKG], o);
    const res = await upCall(up, req);
    assert.strictEqual(res.status, status, JSON.stringify(o));
    assert.match(res.body, text, JSON.stringify(o));
    assert.strictEqual(res.headers.Connection, "close", "not an upload of the page's: the connection ends");
    assert.deepStrictEqual(up.remounts, [], "the medium not touched: " + JSON.stringify(o));
    assert.deepStrictEqual(ls(up.root), []);
  }
  // a well-formed upload refused: answered once its body has come in (a browser still sending when
  // the connection closes shows a network error), the connection kept
  const drained = (res, req, what) => {
    assert.strictEqual(res.headers.Connection, undefined, what + ": the connection kept");
    assert.ok(req.readableEnded && !req.errored, what + ": the body read to its end first");
  };
  const up = upMedia();
  ctx.getDataKey = (k) => (k === "hw_rec" ? 1 : undefined);
  const recReq = upReq([SIG], { wait: 50, late: [PKG] });
  const rec = await upCall(up, recReq);
  assert.match(rec.body, /busy with a recording/);
  drained(rec, recReq, "recording");
  ctx.getDataKey = () => undefined;
  fs.writeFileSync(path.join(up.state, "inprogress"), "abc\n");
  const inReq = upReq([SIG, PKG]);
  const r = await upCall(up, inReq);
  assert.strictEqual(r.status, 409);
  assert.match(r.body, /last update did not finish/);
  drained(r, inReq, "unfinished try");
  fs.writeFileSync(path.join(up.state, "inprogress"), "");
  ctx.DLZMOD_updateUpload.running = true;
  try {
    const busyReq = upReq([SIG, PKG]);
    const busy = await Promise.race([new Promise((resolve) => {
      const res = recRes();
      ctx.DLZMOD_updateUpload(() => up.root, up.state, up.mounts)(busyReq, res, () => {});
      res.done.then(resolve);
    }), tick(2000)]);
    assert.match(busy.body, /Another update is being sent/);
    drained(busy, busyReq, "another upload");
  } finally {
    ctx.DLZMOD_updateUpload.running = false;
  }
  const noneReq = upReq([SIG, PKG]);
  const none = await upCall(Object.assign(upMedia(), { root: "-" }), noneReq);
  assert.strictEqual(none.status, 503);
  drained(none, noneReq, "no SD medium");
  // a medium not (or not writable) in the mount table: refused after the remount, nothing written
  for (const table of ["", "/dev/mmcblk0p2 " + up.root.replace(/ /g, "\\040") + " vfat ro,relatime 0 0\n"]) {
    const gone = upMedia();
    fs.writeFileSync(gone.mounts, table);
    const g = await upCall(gone, upReq([SIG, PKG]));
    assert.strictEqual(g.status, 500, JSON.stringify(table));
    assert.match(g.body, /could not store the update\. Nothing was kept/);
    assert.strictEqual(gone.remounts.length, 1, "asked to be writable first");
    assert.deepStrictEqual(ls(gone.root), [], "no folder made");
  }
  assert.deepStrictEqual(up.remounts, [], "an empty inprogress is no unfinished try, but nothing was sent yet");
  assert.strictEqual(upCall(up, upReq([SIG, PKG], { path: "/dlzmod-update-uploadx" })), "next", "other paths: on");
  assert.strictEqual(upCall(up, upReq([SIG, PKG], { path: "/dlzmod-rec" })), "next");
  // the mixer itself: no Origin check (its own page has none to give here); an empty inprogress goes ahead
  const local = await upCall(up, upReq([SIG, PKG], { address: "127.0.0.1", headers: { origin: "http://evil.example" } }));
  assert.strictEqual(local.status, 200, local.body);
});
test("update upload: a failure after the old update files are removed leaves no update files at all", async () => {
  const up = upMedia();
  fs.mkdirSync(up.dir);
  for (const f of ["dlzmod-v0.1.0.tar", "dlzmod-v0.1.0.tar.sig", "README.txt"]) fs.writeFileSync(path.join(up.dir, f), "old");
  const fsp = fs.promises;
  const rename = fsp.rename;
  // the package's rename fails (the signature's went through)
  fsp.rename = async (a, b) => (String(b).endsWith(".tar") ? Promise.reject(new Error("EIO: i/o error")) : rename(a, b));
  try {
    const r = await upCall(up, upReq([SIG, PKG]));
    assert.strictEqual(r.status, 500);
    assert.match(r.body, /could not store the update\. Nothing was kept/);
  } finally {
    fsp.rename = rename;
  }
  assert.deepStrictEqual(ls(up.dir), ["README.txt"], "no package, no signature without one, no temp files: the updater sees nothing");
  assert.ok(!ctx.DLZMOD_updateUpload.running);
});
test("update upload: cut off, a failed remount, a full card: nothing of it kept, the old update stays", async () => {
  const old = (up) => {
    fs.mkdirSync(up.dir);
    fs.writeFileSync(path.join(up.dir, "dlzmod-v0.1.0.tar"), "old");
    fs.writeFileSync(path.join(up.dir, "dlzmod-v0.1.0.tar.sig"), "old");
  };
  const kept = ["dlzmod-v0.1.0.tar", "dlzmod-v0.1.0.tar.sig"];
  // the computer went away: no one to answer
  for (const chunks of [[SIG, PKG.subarray(0, 10)], [SIG.subarray(0, 30)]]) {
    const up = upMedia();
    old(up);
    const res = await upCall(up, upReq(chunks, { fail: true, len: 64 + PKG.length }));
    assert.strictEqual(res.status, 0, "no answer");
    assert.deepStrictEqual(ls(up.dir), kept);
    assert.ok(!ctx.DLZMOD_updateUpload.running);
  }
  // fewer bytes than announced
  const short = upMedia();
  old(short);
  const sres = await upCall(short, upReq([SIG, PKG.subarray(0, 10)], { len: 64 + PKG.length }));
  assert.strictEqual(sres.status, 500);
  assert.match(sres.body, /^The upload was cut off\. Nothing was kept\.$/);
  assert.deepStrictEqual(ls(short.dir), kept);
  const up = upMedia();
  old(up);
  ctx.DLZMOD_run = async () => ({ ok: false, out: "", err: "mount: busy\n" });
  const res = await upCall(up, upReq([SIG, PKG]));
  assert.strictEqual(res.status, 500);
  assert.match(res.body, /could not store the update\. Nothing was kept/);
  assert.deepStrictEqual(ls(up.dir), kept);
  // the card's writes: the package's file handle's write replaced (the signature's still writes, so
  // only a stop at the package's error passes)
  const open = fs.promises.open;
  const withWrite = async (write, fn) => {
    fs.promises.open = async (f, ...a) => {
      const fh = await open(f, ...a);
      if (!String(f).endsWith(".tar.part")) return fh;
      const real = fh.write.bind(fh);
      return Object.assign(fh, { write: (...w) => write(real, ...w) });
    };
    try {
      return await fn();
    } finally {
      fs.promises.open = open;
    }
  };
  const enospc = () => Promise.reject(Object.assign(new Error("ENOSPC: no space left on device"), { code: "ENOSPC" }));
  // the card full: an error, or a write of nothing
  for (const write of [enospc, async () => ({ bytesWritten: 0 })]) {
    const full = upMedia();
    old(full);
    const r = await withWrite(write, () => upCall(full, upReq([SIG, PKG])));
    assert.strictEqual(r.status, 507);
    assert.match(r.body, /SD card is full\. Nothing was kept/);
    assert.deepStrictEqual(ls(full.dir), kept);
  }
  // a write that says it wrote what it did not: the size check before anything is replaced
  const liar = upMedia();
  old(liar);
  const l = await withWrite(async (real, buf, off, n) => ({ bytesWritten: n }), () => upCall(liar, upReq([SIG, PKG])));
  assert.strictEqual(l.status, 500);
  assert.match(l.body, /could not store the update\. Nothing was kept/);
  assert.deepStrictEqual(ls(liar.dir), kept);
  // short writes (a nearly full card writes less without an error): written to the end all the same
  const bits = upMedia();
  const b = await withWrite((real, buf, off, n) => real(buf, off, Math.min(n, 7)), () => upCall(bits, upReq([SIG, PKG])));
  assert.strictEqual(b.status, 200, b.body);
  assert.ok(fs.readFileSync(path.join(bits.dir, "dlzmod-v0.2.0.tar")).equals(PKG));
});
test("update upload: a recording that starts stops the writing; the rest of the body is thrown away, then the text", async () => {
  const up = upMedia();
  // the late part well after the watch's first look (1 s after the start; later under qemu)
  const req = upReq([SIG, PKG.subarray(0, 10)], { wait: 3000, late: [PKG.subarray(10)] });
  const p = upCall(up, req);
  await tick(100);
  ctx.getDataKey = (k) => (k === "recState" ? 2 : undefined);
  const res = await p;
  ctx.getDataKey = () => undefined;
  assert.strictEqual(res.status, 500);
  assert.match(res.body, /started a recording, so the upload stopped/);
  assert.ok(req.readableEnded && !req.errored, "not cut off: the browser gets the text");
  assert.strictEqual(res.headers.Connection, undefined);
  assert.deepStrictEqual(ls(up.dir), []);
});
test("update upload: a paired device reaches it, others do not", () => {
  pairIn("upload");
  pairSet(true);
  const post = (headers) => gate(httpReq("192.168.1.50", "/dlzmod-update-upload", { method: "POST", headers }));
  assert.strictEqual(post({}).status, 403, "not paired");
  const token = pairOne();
  assert.strictEqual(post({ cookie: cookie(token) }), "next");
  for (const p of ["/dlzmod-update-upload/x", "/dlzmod-update", "/dlzmod-update-upload/../srv_data.json"]) {
    const r = gate(httpReq("192.168.1.50", p, { method: "POST", headers: { cookie: cookie(token) } }));
    assert.ok(r !== "next" && r.status >= 400, p);
  }
  pairSet(false);
  assert.strictEqual(post({ cookie: cookie(token) }).status, 403, "off");
});

// #136: the boot log copied to the SD card once a start has finished (DLZMOD_bootlogCopy). Same rig
// as the upload: the medium a temp folder, its remount stubbed; the timer never fires, tick() is
// called by hand. Each test starts as a fresh start: the file seen and its tries are forgotten
// (#187: Windows can give the next test's file the same mtime, which then counted as copied)
const bootRig = () => {
  delete ctx.DLZMOD_bootlogCopy.file;
  delete ctx.DLZMOD_bootlogCopy.tries;
  const up = upMedia();
  const src = path.join(up.state, "syslog-last-boots.txt");
  const uptime = path.join(up.state, "uptime");
  fs.writeFileSync(uptime, "150.20 300.10\n");
  ctx.DLZMOD_bootlogCopy(() => up.root, src, up.mounts, 1e9, uptime);
  clearInterval(ctx.DLZMOD_bootlogCopy.timer);
  const tick = async () => {
    await ctx.DLZMOD_bootlogCopy.tick();
    clearTimeout(ctx.DLZMOD_roLater.timer);
  };
  return Object.assign(up, { src, uptime, tick, logs: path.join(up.root, "dlzmod-logs") });
};
const setMtime = (f, s) => fs.utimesSync(f, s, s);
test("boot log: nothing to copy, nothing remounted", async () => {
  const b = bootRig();
  await b.tick();
  assert.deepStrictEqual(b.remounts, []);
  assert.deepStrictEqual(ls(b.logs), []);
});
test("boot log: copied once, through a read-write remount; the next file moves the old one to .prev", async () => {
  const b = bootRig();
  fs.writeFileSync(b.src, "start 1\n");
  await b.tick();
  assert.deepStrictEqual(ls(b.logs), ["syslog-last-boots.txt"]);
  assert.strictEqual(fs.readFileSync(path.join(b.logs, "syslog-last-boots.txt"), "utf8"), "start 1\n");
  assert.deepStrictEqual(b.remounts.map((x) => x.slice(1).join(" ")), ["-o remount,rw " + b.root]);
  await b.tick();
  assert.strictEqual(b.remounts.length, 1, "the same file once");
  fs.writeFileSync(b.src, "start 2\n");
  setMtime(b.src, Date.now() / 1000 + 5);
  await b.tick();
  assert.deepStrictEqual(ls(b.logs), ["syslog-last-boots.prev.txt", "syslog-last-boots.txt"]);
  assert.strictEqual(fs.readFileSync(path.join(b.logs, "syslog-last-boots.txt"), "utf8"), "start 2\n");
  assert.strictEqual(fs.readFileSync(path.join(b.logs, "syslog-last-boots.prev.txt"), "utf8"), "start 1\n");
});
test("boot log: not in the first 90 s after power-on (an early file from the start that installs the update)", async () => {
  const b = bootRig();
  fs.writeFileSync(b.uptime, "25.03 60.00\n");
  fs.writeFileSync(b.src, "early\n");
  await b.tick();
  assert.deepStrictEqual(b.remounts, []);
  fs.writeFileSync(b.uptime, "garbage\n");
  await b.tick();
  assert.deepStrictEqual(b.remounts, [], "an unreadable uptime: not yet");
  fs.writeFileSync(b.uptime, "90.00 60.00\n");
  await b.tick();
  assert.deepStrictEqual(ls(b.logs), ["syslog-last-boots.txt"]);
});
test("boot log: a temp file left by a power cut is replaced", async () => {
  const b = bootRig();
  fs.mkdirSync(b.logs);
  fs.writeFileSync(path.join(b.logs, ".syslog-last-boots.txt.part"), "half");
  fs.writeFileSync(b.src, "whole\n");
  await b.tick();
  assert.deepStrictEqual(ls(b.logs), ["syslog-last-boots.txt"]);
});
test("boot log: not while recording, an upload runs or there is no SD card; then it goes", async () => {
  const b = bootRig();
  fs.writeFileSync(b.src, "x\n");
  ctx.getDataKey = (k) => (k === "recState" ? 1 : undefined);
  await b.tick();
  ctx.getDataKey = () => undefined;
  ctx.DLZMOD_updateUpload.running = true;
  await b.tick();
  ctx.DLZMOD_updateUpload.running = false;
  const root = b.root;
  b.root = "-";
  ctx.DLZMOD_bootlogCopy(() => b.root, b.src, b.mounts, 1e9, b.uptime);
  clearInterval(ctx.DLZMOD_bootlogCopy.timer);
  await b.tick();
  assert.deepStrictEqual(b.remounts, [], "waited");
  b.root = root;
  await b.tick();
  assert.deepStrictEqual(ls(b.logs), ["syslog-last-boots.txt"]);
});
test("boot log: a medium that stays read-only: 3 tries, then left until a new file", async () => {
  const b = bootRig();
  fs.writeFileSync(b.mounts, "/dev/mmcblk0p2 " + b.root + " vfat ro,relatime 0 0\n");
  fs.writeFileSync(b.src, "x\n");
  for (let i = 0; i < 5; i++) await b.tick();
  assert.strictEqual(b.remounts.length, 3);
  assert.deepStrictEqual(ls(b.logs), []);
  setMtime(b.src, Date.now() / 1000 + 10);
  await b.tick();
  assert.strictEqual(b.remounts.length, 4, "a new file is tried again");
});
test("boot log: a failed remount is no crash and writes nothing", async () => {
  const b = bootRig();
  ctx.DLZMOD_run = async (f, args) => (b.remounts.push(args), { ok: false, out: "", err: "mount: busy" });
  fs.writeFileSync(b.src, "x\n");
  await b.tick();
  assert.strictEqual(b.remounts.length, 1);
  assert.deepStrictEqual(ls(b.logs), []);
  assert.ok(!ctx.DLZMOD_bootlogCopy.running);
});
test("boot log: a write that fails (a full card) leaves no temp file and keeps the last copy", async () => {
  const b = bootRig();
  fs.mkdirSync(b.logs);
  fs.writeFileSync(path.join(b.logs, "syslog-last-boots.txt"), "last\n");
  fs.writeFileSync(b.src, "new\n");
  const writeAll = ctx.DLZMOD_writeAll;
  ctx.DLZMOD_writeAll = async () => {
    throw Object.assign(new Error("ENOSPC: no space left on device"), { code: "ENOSPC" });
  };
  try {
    await b.tick();
  } finally {
    ctx.DLZMOD_writeAll = writeAll;
  }
  assert.deepStrictEqual(ls(b.logs), ["syslog-last-boots.txt"]);
  assert.strictEqual(fs.readFileSync(path.join(b.logs, "syslog-last-boots.txt"), "utf8"), "last\n");
  assert.ok(!ctx.DLZMOD_bootlogCopy.running);
});

// Time zone (#9): a zoneinfo folder of its own, never this PC's /etc
const tzIn = () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "dlztz-"));
  const zi = path.join(d, "zoneinfo");
  for (const z of ["Europe/Amsterdam", "Europe/London", "America/Argentina/Buenos_Aires", "Etc/UTC"]) {
    fs.mkdirSync(path.dirname(path.join(zi, z)), { recursive: true });
    fs.writeFileSync(path.join(zi, z), "TZif2 and the rest");
  }
  // zoneinfo's other trees and special files: real tzdata files too
  for (const z of ["right/Europe/Amsterdam", "posix/Europe/Amsterdam", "Factory", "posixrules"]) {
    fs.mkdirSync(path.dirname(path.join(zi, z)), { recursive: true });
    fs.writeFileSync(path.join(zi, z), "TZif2 and the rest");
  }
  fs.writeFileSync(path.join(zi, "notazone"), "plain text");
  fs.mkdirSync(path.join(d, "etc"));
  const links = [];
  // the link as a file with its target (symlinks need rights on Windows); readlink reads it back
  const opts = { zoneinfo: zi, localtime: path.join(d, "etc", "localtime"), timezone: path.join(d, "etc", "timezone"),
    link: (target, file) => links.push([target, file]) };
  return { d, zi, opts, links };
};
const tzRun = (ok = true) => {
  const calls = [];
  const run = async (file, args) => {
    calls.push([file].concat(args));
    return { ok: ok, out: "", err: ok ? "" : "settimeofday() failed" };
  };
  return { run, calls };
};
const timeOf = (sent, cmd) => sent.filter((m) => m.cmd === cmd).map((m) => m.data);

test("time zone: only names the mixer has, as Region/City, never outside zoneinfo", () => {
  const t = tzIn();
  const valid = (z) => ctx.DLZMOD_tzValid(z, ctx.DLZMOD_tzPaths(t.opts));
  assert.ok(valid("Europe/Amsterdam") && valid("America/Argentina/Buenos_Aires") && valid("Etc/UTC"));
  for (const z of ["Europe/Paris", "", "Europe", "notazone", "../zoneinfo/Europe/Amsterdam", "Europe/../Europe/London",
    "/Europe/London", "Europe/London/", "Europe\\London", "Europe/London\0", 42, null, "a/b/c/d",
    "right/Europe/Amsterdam", "posix/Europe/Amsterdam", "Factory", "posixrules"]) {
    assert.strictEqual(valid(z), false, JSON.stringify(z));
  }
});
test("time zone: the one set is the link's, else /etc/timezone's, else UTC (stock)", () => {
  const t = tzIn();
  const cur = () => ctx.DLZMOD_tzCurrent(ctx.DLZMOD_tzPaths(t.opts));
  assert.strictEqual(cur(), "Etc/UTC", "neither");
  fs.writeFileSync(t.opts.timezone, "Europe/London\n");
  assert.strictEqual(cur(), "Europe/London");
  fs.writeFileSync(t.opts.timezone, "Mars/Olympus\n");
  assert.strictEqual(cur(), "Etc/UTC", "a name the mixer does not have");
  if (process.platform !== "win32") {
    fs.symlinkSync(t.zi + "/Europe/Amsterdam", t.opts.localtime);
    assert.strictEqual(cur(), "Europe/Amsterdam", "the link wins");
  }
});
test("time zone: the offset and the time there", () => {
  const winter = new Date("2026-01-15T12:00:00Z"), summer = new Date("2026-07-15T12:00:00Z");
  assert.deepStrictEqual(plain(ctx.DLZMOD_tzInfo("Europe/Amsterdam", winter)), { offset: "UTC+01:00", time: "13:00" });
  assert.deepStrictEqual(plain(ctx.DLZMOD_tzInfo("Europe/Amsterdam", summer)), { offset: "UTC+02:00", time: "14:00" });
  assert.deepStrictEqual(plain(ctx.DLZMOD_tzInfo("Etc/UTC", winter)), { offset: "UTC", time: "12:00" });
  assert.deepStrictEqual(plain(ctx.DLZMOD_tzInfo("America/Argentina/Buenos_Aires", winter)),
    { offset: "UTC-03:00", time: "09:00" });
  assert.deepStrictEqual(plain(ctx.DLZMOD_tzInfo("Mars/Olympus", winter)), { offset: "", time: "" });
});
test("time zone: the status for everyone; a change from the screen or a paired device only", async () => {
  const t = tzIn();
  const r = tzRun();
  const s1 = [];
  await ctx.DLZMOD_time({ op: "status" }, remoteTo(s1), Object.assign({ run: r.run }, t.opts));
  assert.strictEqual(timeOf(s1, "DLZMOD_TIME_STATE")[0].zone, "Etc/UTC");
  await ctx.DLZMOD_time({ op: "set", zone: "Europe/Amsterdam" }, remoteTo(s1), Object.assign({ run: r.run }, t.opts));
  assert.strictEqual(timeOf(s1, "DLZMOD_TIME_RESULT")[0].ok, false, "an unpaired device");
  assert.deepStrictEqual([t.links, r.calls, fs.existsSync(t.opts.timezone)], [[], [], false], "nothing changed");
  for (const send of [sendTo([]), Object.assign(() => {}, { dlzmodPaired: true })]) {
    t.links.length = 0;
    r.calls.length = 0;
    await ctx.DLZMOD_time({ op: "set", zone: "Europe/Amsterdam" }, send, Object.assign({ run: r.run }, t.opts));
    assert.deepStrictEqual(plain(t.links), [[t.zi + "/Europe/Amsterdam", t.opts.localtime]]);
    assert.strictEqual(fs.readFileSync(t.opts.timezone, "utf8"), "Europe/Amsterdam\n");
    assert.deepStrictEqual(r.calls, [["/sbin/hwclock", "--systz", "--utc"]], "the kernel's offset, nothing else");
  }
});
test("time zone: a change says what it did; an unknown zone changes nothing; a failing hwclock: within a minute", async () => {
  const t = tzIn();
  const r = tzRun();
  const s1 = [];
  await ctx.DLZMOD_time({ op: "set", zone: "Europe/London" }, sendTo(s1), Object.assign({ run: r.run }, t.opts));
  assert.deepStrictEqual(timeOf(s1, "DLZMOD_TIME_RESULT"), [{ ok: true, text: "Time zone: Europe/London" }]);
  assert.strictEqual(timeOf(s1, "DLZMOD_TIME_STATE")[0].zone, "Europe/London", "the new status after it");
  const s2 = [];
  t.links.length = 0;
  for (const zone of ["Mars/Olympus", "../../etc/passwd", "notazone", undefined]) {
    await ctx.DLZMOD_time({ op: "set", zone: zone }, sendTo(s2), Object.assign({ run: r.run }, t.opts));
  }
  assert.ok(timeOf(s2, "DLZMOD_TIME_RESULT").every((x) => !x.ok && x.text === "Unknown time zone"));
  assert.deepStrictEqual(t.links, []);
  assert.strictEqual(fs.readFileSync(t.opts.timezone, "utf8"), "Europe/London\n");
  const s3 = [];
  const bad = tzRun(false);
  await ctx.DLZMOD_time({ op: "set", zone: "America/Argentina/Buenos_Aires" }, sendTo(s3),
    Object.assign({ run: bad.run }, t.opts));
  assert.deepStrictEqual(timeOf(s3, "DLZMOD_TIME_RESULT"),
    [{ ok: true, text: "Time zone: America/Argentina/Buenos Aires\nRecording times follow it within a minute." }]);
  const s4 = [];
  await ctx.DLZMOD_time({ op: "reboot" }, sendTo(s4), Object.assign({ run: r.run }, t.opts));
  assert.deepStrictEqual(timeOf(s4, "DLZMOD_TIME_RESULT"), [{ ok: false, text: "Unknown time action" }]);
});
if (process.platform !== "win32") {
  test("time zone: /etc/localtime becomes a link into zoneinfo, swapped in whole", () => {
    const t = tzIn();
    fs.writeFileSync(t.opts.localtime + ".dlzmod-new", "left from a power cut");
    fs.writeFileSync(t.opts.localtime, "stock's file");
    ctx.DLZMOD_tzLink(t.zi + "/Europe/Amsterdam", t.opts.localtime);
    assert.strictEqual(fs.readlinkSync(t.opts.localtime), t.zi + "/Europe/Amsterdam");
    assert.ok(!fs.existsSync(t.opts.localtime + ".dlzmod-new"));
  });
}

(async () => {
  let failed = 0;
  for (const [name, fn] of tests) {
    try {
      await fn();
      console.log("ok   " + name);
    } catch (e) {
      failed++;
      console.log("FAIL " + name + "\n     " + e.message.split("\n").join("\n     "));
    }
  }
  console.log(`${tests.length - failed}/${tests.length} passed`);
  process.exit(failed ? 1 : 0);
})();
