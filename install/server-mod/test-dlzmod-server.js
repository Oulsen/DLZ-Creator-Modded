// Tests for dlzmod-server.js: node install/server-mod/test-dlzmod-server.js
// Loads the file in a vm context, the way it runs once appended to server.js.
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const vm = require("vm");

const ctx = vm.createContext({ require, process, Buffer, setTimeout, clearTimeout, console: { log() {}, error() {} } });
vm.runInContext(fs.readFileSync(path.join(__dirname, "dlzmod-server.js"), "utf8"), ctx);
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
  assert.deepStrictEqual(plain(statusFrom(files({}))), { installed: "", failed: "" });
  assert.deepStrictEqual(plain(statusFrom(files({ installed: "v0.1.0 (dev-b)" }))), { installed: "v0.1.0 (dev-b)", failed: "" });
  assert.deepStrictEqual(plain(statusFrom(files({ installed: "v0.1.0", failed: "x", "last-report": "update-2-unknown-version.txt" }))),
    { installed: "v0.1.0", failed: "Last update not installed: see dlzmod-logs/update-2-unknown-version.txt on the card" });
  assert.deepStrictEqual(plain(statusFrom(files({ installed: "v0.1.0", failed: "x" }))),
    { installed: "v0.1.0", failed: "Last update not installed: see dlzmod-logs on the card" });
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
  assert.deepStrictEqual(sent.map((m) => [m.cmd, m.data]), [["DLZMOD_UPDATE_STATUS", { installed: "", failed: "" }]]);
  noteSeen(dir);
  assert.ok(!fs.existsSync(dir));
});
test("update note: a send that throws is caught", () => {
  noteSend(() => {
    throw new Error("socket closed");
  }, os.tmpdir());
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
  assert.deepStrictEqual(sent, [{ cmd: "DLZMOD_NET_STATE", id: 0, data:
    { stick: true, wifi: "connected", ssid: "Home:Net", signal: 74, ip: "192.168.1.42", ssh: true, sshKeep: false,
      sshBusy: "" } }]);
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
  "SAMPLE_LOAD", "SAMPLE_PREVIEW_START", "FORMAT_USB", "REC_START", "DLZMOD_NET"].map((c) => [c, () => {}]));
const ROOTS = ["/media/sd", "-"];
const SCREEN = local(() => {}), PHONE = () => {};
test("files: the screen keeps every file command, with names as stock uses them", () => {
  for (const [cmd, args] of [["MEDIA_DELETE", { path: "sd:/DLZ_Creator_XS_Recordings/REC_0001_otter.wav" }],
    ["MEDIA_RENAME", { path: "/srv/bankPlayer/default/loaded/a.wav", newName: "Vocals....wav" }],
    ["PRESET_WRITE", { type: "eq", name: "AC/DC", data: {} }], ["PRESET_READ", { type: "eq", name: "AC_DC" }],
    ["PRESET_RENAME", { type: "rev", name: "Hall", newName: "Big hall" }], ["SNAP_SAVE", { name: "a/b" }],
    ["SNAP_RENAME", { name: "Show 1", newName: "Show/2" }], ["SAMPLE_LOAD", { path: "\\srv\\bankPlayer\\default\\x.wav" }],
    ["PRESET_LIST", { type: "snaps" }], ["REC_START", undefined], ["DLZMOD_NET", { op: "status" }]]) {
    assert.strictEqual(cmdOk(HANDLERS, cmd, args, SCREEN, ROOTS), "", cmd);
  }
});
test("files: other devices keep mixing and presets, but no delete, rename, sample path or format", () => {
  for (const cmd of ["MEDIA_DELETE", "MEDIA_RENAME", "PRESET_DELETE", "PRESET_RENAME", "SNAP_DELETE", "SNAP_RENAME",
    "SAMPLE_LOAD", "SAMPLE_PREVIEW_START", "FORMAT_USB"]) {
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
