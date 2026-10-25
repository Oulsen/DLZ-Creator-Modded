// Tests for dlzmod.js (the app mod): node install/app-mod/test-dlzmod.js
// Loads the file in a vm context, as it runs once appended to app.js, with small stand-ins for the
// Mackie UI globals it uses (Widget and its kinds, PopupWindow, askConfirm, showMessage, showToast,
// PopupConfirm, askInput, setKbdTitle, Data, $NET, app, Font, Color, $FA, lang, deconvertVU, VU_STRUCT,
// E_CH_TYPE, VtoMix, modVuByDb, EXTERNAL) and for the browser
// (fetch, document). What the stand-ins record is what the tests look at; what is drawn where stays
// with the UI sandbox's screenshots.
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ui = { buttons: [], popups: [], toasts: [], links: [], fetches: [], cmds: [], windows: [], progress: [],
  widgets: [], inputs: [], titles: [], destroyed: [], pickers: [], attached: [], sets: [] };
const regs = {};   // Data.regWidget: key -> callbacks
// Mackie's Widget: the parameters become properties, then _constructor runs
function Widget(parent, p) {
  Object.assign(this, p);
  this.parent = parent;
  if (!("visible" in this)) this.visible = true;
  this.updates = 0;
  ui.widgets.push(this);
  if (this._constructor) this._constructor();
}
Object.assign(Widget.prototype, {
  setVisible(v) {
    this.visible = v;
  },
  update() {
    this.updates++;
  },
  globalVisible() {
    return this.visible && (!this.parent || !this.parent.globalVisible || this.parent.globalVisible());
  },
  geomCenterY() {
    return 0;
  },
});
const kind = (extra) => {
  const k = function (parent, p) {
    Widget.call(this, parent, p);
    if (extra) extra(this);
  };
  k.prototype = Object.create(Widget.prototype);
  return k;
};
const PopupWindow = kind((w) => {
  ui.windows.push(w);
  if (w.initWidgets) w.initWidgets();
});
Object.assign(PopupWindow.prototype, {
  close() {
    this.closed = true;
    this.onDestroy();
  },
  onDestroy() {
    ui.destroyed.push(this);
  },
  paint() {},
});
const mackieOnDestroy = PopupWindow.prototype.onDestroy;
const SwitchBox = kind();
SwitchBox.prototype.setItems = function (items) {
  this.items = items;
};
const ctx = vm.createContext({
  setTimeout, clearTimeout, setInterval: () => 0, console: { log() {}, error() {} },
  EXTERNAL: false, app: undefined,
  Widget, PopupWindow, SwitchBox,
  E1Button: kind((b) => ui.buttons.push(b)),
  ToggleButton: kind(), Switcher: kind(), Button: kind(),
  Util: { hex2rgba: (c, a) => c + "@" + a },
  PopupShowProgress: function (parent, p) {
    Object.assign(this, p);
    this.close = () => (this.closed = true);
    ui.progress.push(this);
  },
  PopupConfirm: function (parent, p) {
    ui.popups.push({ kind: "popupConfirm", text: p.text, opts: p });
  },
  askInput: (text, accept, cancel, other) => ui.inputs.push({ accept, cancel, other }),
  setKbdTitle: (t) => ui.titles.push(t),
  PAINT_WINDOW_BG: () => {},
  askConfirm: (text, opts, yes) => ui.popups.push({ kind: "confirm", text, opts: opts || {}, yes }),
  showMessage: (text, opts) => ui.popups.push({ kind: "message", text, opts: opts || {} }),
  showToast: (text) => ui.toasts.push(text),
  Data: {
    data: {},
    has(k) {
      return k in this.data;
    },
    get(k) {
      return this.data[k];
    },
    regWidget: (k, f) => (regs[k] = regs[k] || []).push(f),
    set(k, v) {
      ui.sets.push([k, v]);
      this.data[k] = v;
    },
  },
  $NET: { cmd: (c, a) => ui.cmds.push([c, plain(a)]) },
  deconvertVU: (c) => c / 100,
  // the fader position as its dB (here: position - 1 in tens of dB), a level moved by dB (here: 1/100 per dB)
  E_CH_TYPE: { INPUT: 0, MASTER: 4 },
  VtoMix: (v) => (v - 1) * 10,
  modVuByDb: (v, db) => Math.round((v + db / 100) * 1000) / 1000,
  lang: { CURRENT_VERSION: "Current version", UPDATE_VERSION: "Update version", CANCEL: "Cancel" },
  Font: { font: (w, s) => w + " " + s, fa: (s) => "fa " + s, mi: (s) => "mi " + s },
  Color: { main: "main", confirm: "confirm", deny: "deny", red: "red", blue: "blue", white: "white", green: "green",
    red2: "red2", black: "black", bgDark: "bgDark", buttonBg: "buttonBg", subNavButtonText: "subNavButtonText",
    bgPopup: "bgPopup", text: "text",
    vuGrad: [[0, "#00ff00"], [0.7, "#00ff00"], [0.75, "#ffff00"], [0.9, "#ff0000"]] },
  $FA: { times: "times", lock: "lock", check: "check", arrow_to_top: "arrow_to_top", wifi: "wifi",
    exclamation: "exclamation" },
  fetch: () => Promise.reject(new Error("no fetch set")),
  Blob: function (parts) {
    this.parts = parts;
  },
  document: {
    // a file picker (input) is kept as it was opened; a link as what it downloads; ui.attached: what
    // is in the page
    createElement: (tag) => Object.assign(tag === "input" ? { click() {
      ui.pickers.push(this);
    } } : { click() {
      ui.links.push({ href: this.href, download: this.download });
    } }, { remove() {
      const i = ui.attached.indexOf(this);
      if (i >= 0) ui.attached.splice(i, 1);
    } }),
    body: { appendChild: (el) => ui.attached.push(el) },
  },
});
vm.runInContext(fs.readFileSync(path.join(__dirname, "dlzmod.js"), "utf8"), ctx);
const plain = (o) => o && JSON.parse(JSON.stringify(o));   // objects from the vm context
const tick = (ms) => new Promise((r) => setTimeout(r, ms));
// a clean start, also after a test that failed halfway: no spinner or its timer, no open Wi-Fi list, no
// server status, Mackie's own screen
const reset = () => {
  ctx.app = undefined;
  ctx.EXTERNAL = false;
  ctx.VU_STRUCT = undefined;
  ctx.DLZMOD_netIdle();
  ctx.DLZMOD_wifiList.popup = null;
  ctx.DLZMOD_setNetState(undefined);
  ctx.DLZMOD_setUpdateStatus(null);
  ctx.DLZMOD_uploadFiles.busy = false;
  ctx.DLZMOD_uploadPick.input = null;
  for (const k of Object.keys(ui)) ui[k].length = 0;
  for (const k of Object.keys(regs)) delete regs[k];
};
// the mod's settings as the hub has them (none saved: Mackie's look)
const settings = (d = {}) => {
  ctx.Data.data = Object.assign({}, d);
};

const tests = [];
const test = (name, fn) => tests.push([name, fn]);

// #26: recordings to a computer
const XS = "sd:\\DLZ_Creator_XS_Recordings";
const page = (p = XS, selected = "") => ({ getPath: () => p, list: { selected: () => selected },
  lPath: { sizes: [], setSize(w, h) {
    this.sizes.push([w, h]);
  } } });
// the server's list (dlzmod-server.js, DLZMOD_recList) as fetch answers it
const answer = (files, o = {}) => {
  ctx.fetch = (url, opts) => {
    ui.fetches.push({ url, opts: plain(opts) });
    if (o.fail) return Promise.reject(new Error("offline"));
    return Promise.resolve({ ok: !o.status, status: o.status || 200, json: () => Promise.resolve({
      recording: !!o.recording,
      media: [{ medium: "sd", files }, { medium: "usb", files: [{ dir: "DLZ_Creator_XS_Recordings", name: "stick.wav", size: 5 }] }],
    }) });
  };
};
const FILES = [{ dir: "DLZ_Creator_XS_Recordings", name: "REC_0002_owl.wav", size: 2e6 },
  { dir: "DLZ_Creator_XS_Recordings", name: "Band take.wav", size: 1e6 },
  { dir: "DLZ_Creator_Recordings", name: "full-size.wav", size: 7 }];
const XS_FILES = FILES.slice(0, 2);
const run = async (pg) => {
  ctx.DLZMOD_download(pg);
  await tick(20);
};
const hrefs = () => ui.links.map((l) => l.href);

test("recordings: a recordings folder on the SD card or USB stick is recognised, nothing else", () => {
  assert.deepStrictEqual(plain(ctx.DLZMOD_recFolder(XS)), { medium: "sd", dir: "DLZ_Creator_XS_Recordings" });
  assert.deepStrictEqual(plain(ctx.DLZMOD_recFolder("usb:\\DLZ_Creator_Recordings")), { medium: "usb", dir: "DLZ_Creator_Recordings" });
  for (const p of ["", undefined, null, "sd:", "sd:\\", XS + "\\REC_0005", XS + "\\", "sd:\\dlz_creator_xs_recordings",
    "sd:/DLZ_Creator_XS_Recordings", "hd:\\DLZ_Creator_XS_Recordings", "sd:\\DLZ_Creator_XS_Recordings_old", "sd:\\Live sets"]) {
    assert.strictEqual(ctx.DLZMOD_recFolder(p), null, String(p));
  }
});
test("recordings: sizes in the unit they round to (no 1000 MB, no 10.0 MB)", () => {
  for (const [b, s] of [[0, "0 bytes"], [999, "999 bytes"], [1000, "1.0 KB"], [1500, "1.5 KB"], [3.5e6, "3.5 MB"],
    [9.94e6, "9.9 MB"], [9.96e6, "10 MB"], [999.4e6, "999 MB"], [999.6e6, "1.0 GB"], [25e9, "25 GB"], [3e12, "3.0 TB"]]) {
    assert.strictEqual(ctx.DLZMOD_size(b), s, String(b));
  }
});
test("recordings: the download button only in a browser, enabled in a recordings folder only", () => {
  reset();
  ctx.EXTERNAL = false;
  const screen = page();
  const b = ctx.DLZMOD_mediaDownloadButton(screen, { size: [46, 46] });
  assert.strictEqual(b.visible, false, "the mixer's own screen: not shown");
  assert.deepStrictEqual(screen.lPath.sizes, [], "and its path label as stock");
  assert.deepStrictEqual(b.size, [46, 46], "the page's own button style");
  ctx.EXTERNAL = true;
  try {
    const pg = page();
    const b2 = ctx.DLZMOD_mediaDownloadButton(pg, {});
    assert.strictEqual(b2.visible, true, "a browser: shown");
    assert.deepStrictEqual(pg.lPath.sizes, [[424, 40]], "the path label ends left of it");
    assert.deepStrictEqual(plain(b2.regKey), ["player.path"]);
    b2.getState();
    assert.strictEqual(b2.enabled, true, "in a recordings folder");
    const other = page("sd:\\Live sets");
    const b3 = ctx.DLZMOD_mediaDownloadButton(other, {});
    b3.getState();
    assert.strictEqual(b3.enabled, false, "elsewhere: greyed");
  } finally {
    ctx.EXTERNAL = false;
  }
});
test("recordings: nothing selected asks to download all of this folder's recordings, then hands each to the browser", async () => {
  reset();
  answer(FILES);
  await run(page());
  assert.deepStrictEqual(ui.fetches, [{ url: "/dlzmod-rec", opts: { cache: "no-store" } }]);
  assert.strictEqual(ui.popups.length, 1);
  assert.match(ui.popups[0].text, /^Download all 2 recordings \(3\.0 MB\)\?\nYour browser may ask/);
  assert.deepStrictEqual(ui.links, [], "nothing before the answer");
  ui.popups[0].yes();
  await tick(450);
  assert.deepStrictEqual(hrefs(), ["/dlzmod-rec/sd/DLZ_Creator_XS_Recordings/REC_0002_owl.wav",
    "/dlzmod-rec/sd/DLZ_Creator_XS_Recordings/Band%20take.wav"], "this folder on this medium only, names encoded");
  assert.deepStrictEqual(ui.links.map((l) => l.download), ["REC_0002_owl.wav", "Band take.wav"]);
  reset();
  answer(FILES);
  await run(page(XS, "REC_0005\\"));
  assert.match(ui.popups[0].text, /^Download all 2 recordings/, "a folder selected: the same question");
});
test("recordings: a selected recording asks This one or All N; one recording there downloads at once", async () => {
  reset();
  answer(FILES);
  await run(page(XS, "Band take.wav"));
  const p = ui.popups[0];
  assert.match(p.text, /^Download Band take\.wav\nor all 2 recordings \(3\.0 MB\)\?/);
  assert.deepStrictEqual(plain(p.opts.buttons.map((b) => b.text)), ["This one", "All 2", "times"]);
  assert.strictEqual(p.opts.w, 760, "three buttons fit");
  assert.notDeepStrictEqual(p.opts.buttons[0].colors, p.opts.buttons[1].colors, "This one and All look different");
  let destroyed = 0;
  const press = (b) => b.onPress.call({ parent: { destroy: () => destroyed++ } });
  press(p.opts.buttons[0]);
  await tick(20);
  assert.deepStrictEqual(hrefs(), ["/dlzmod-rec/sd/DLZ_Creator_XS_Recordings/Band%20take.wav"]);
  assert.deepStrictEqual(ui.toasts, ["Downloading: Band take.wav"]);
  ui.links.length = 0;
  press(p.opts.buttons[1]);
  await tick(450);
  assert.strictEqual(ui.links.length, 2, "All 2");
  ui.links.length = 0;
  press(p.opts.buttons[2]);
  await tick(20);
  assert.deepStrictEqual(ui.links, [], "the cross: nothing");
  assert.strictEqual(destroyed, 3, "each button closes the popup");
  reset();
  answer(FILES.slice(0, 1));
  await run(page(XS, "REC_0002_owl.wav"));
  assert.deepStrictEqual(ui.popups, [], "nothing to choose");
  assert.deepStrictEqual(hrefs(), ["/dlzmod-rec/sd/DLZ_Creator_XS_Recordings/REC_0002_owl.wav"]);
});
test("recordings: busy, nothing there, a name the server does not list, no answer: a message, no download", async () => {
  for (const [files, o, sel, text] of [[XS_FILES, { recording: true }, "", /^The mixer is busy with a recording/],
    [[], {}, "", /^No recordings to download here/],
    [XS_FILES, {}, "REC_0006_emu.wav.unfinished", /^REC_0006_emu\.wav\.unfinished\ncannot be downloaded/],
    [XS_FILES, { status: 503 }, "", /did not answer/], [XS_FILES, { fail: true }, "", /did not answer/]]) {
    reset();
    answer(files, o);
    await run(page(XS, sel));
    assert.strictEqual(ui.popups.length, 1, JSON.stringify(o) + " " + sel);
    assert.strictEqual(ui.popups[0].kind, "message");
    assert.match(ui.popups[0].text, text);
    await tick(20);
    assert.deepStrictEqual(ui.links, []);
  }
  reset();
  answer(XS_FILES);
  await run(page("sd:\\Live sets"));
  assert.deepStrictEqual(ui.fetches, [], "outside a recordings folder: not even asked");
});

// Meters: what each strip meter is given (DLZMOD_vuSet) and which zones and marks it gets (DLZMOD_vuPaint)
const meter = (o = {}) => Object.assign({ vals: null, clips: 0, autoClip: true, clipThreshold: 0.9,
  setValue(a, b) {
    this.vals = [a, b];
  },
  clip() {
    this.clips++;
  } }, o);
const GAIN = String.fromCharCode(0, 40, 95);   // gain pickups: 0.4 at 1, 0.95 at 2 (deconvertVU stand-in: / 100)

test("meters: Mackie (the default) shows after the fader and leaves Mackie's own second bar alone", () => {
  settings();
  const m = meter();
  ctx.DLZMOD_vuSet(m, GAIN, 1, 0.3, 0.6);
  assert.deepStrictEqual(m.vals, [0.3, 0.6]);
  assert.strictEqual(m.havePre, undefined);
  const own = meter({ havePre: true });
  ctx.DLZMOD_vuSet(own, GAIN, 1, 0.3, 0.6);
  assert.strictEqual(own.havePre, true, "a second bar Mackie set stays");
});
test("meters: Both: after the fader bright, before the fader dimmed behind; the clip follows the level before the fader", () => {
  settings({ "dlzmod.meterMode": 1 });
  const m = meter();
  ctx.DLZMOD_vuSet(m, GAIN, 1, 0.3, 0.6);
  assert.deepStrictEqual(m.vals, [0.3, 0.4], "after the fader, then the gain pickup (not Mackie's pre)");
  assert.strictEqual(m.havePre, true);
  assert.strictEqual(m.fillStylePre, ctx.DLZMOD_dim("#9CCC56", 0.5), "green, strong");
  assert.strictEqual(m.clips, 0);
  ctx.DLZMOD_vuSet(m, GAIN, 2, 0.3, 0.6);
  assert.strictEqual(m.clips, 1, "0.95 before the fader clips, though after it is low");
  ctx.Data.data["dlzmod.preColor"] = 1;
  ctx.Data.data["dlzmod.preLevel"] = 1;
  ctx.DLZMOD_vuSet(m, GAIN, 1, 0.3, 0.6);
  assert.strictEqual(m.fillStylePre, ctx.DLZMOD_dim("#D0D0D0", 0.25), "a new look from the next message on");
  ctx.Data.data["dlzmod.meterMode"] = 0;
  ctx.DLZMOD_vuSet(m, GAIN, 1, 0.3, 0.6);
  assert.strictEqual(m.havePre, false, "back to Mackie: our second bar goes");
  assert.deepStrictEqual(m.vals, [0.3, 0.6]);
  settings({ "dlzmod.meterMode": 1 });
  for (const [gain, idx] of [[null, 1], ["", 0], [GAIN, 3]]) {
    const s = meter();
    ctx.DLZMOD_vuSet(s, gain, idx, 0.3, 0.6);
    assert.deepStrictEqual(s.vals, [0.3, 0.6], "no gain pickup: as Mackie " + JSON.stringify([gain, idx]));
    assert.ok(!s.havePre);
  }
});
test("meters: Before fader shows the level before the fader, one bar; a strip without a gain pickup after it", () => {
  settings({ "dlzmod.meterMode": 2 });
  const m = meter();
  ctx.DLZMOD_vuSet(m, GAIN, 1, 0.3, 0.6);
  assert.deepStrictEqual(m.vals, [0.4, 0.6]);
  assert.ok(!m.havePre, "one bar");
  ctx.DLZMOD_vuSet(m, null, 1, 0.3, 0.6);
  assert.deepStrictEqual(m.vals, [0.3, 0.6]);
});
test("meters: the main meter is before the master fader as Mackie shows it; Both adds the level after the fader", () => {
  const strip = (type, mix, mute = 0) => ({ type, getValue: (k) => ({ mix, mute })[k] });
  const main = strip(4, 0.5);   // fader at -5 dB on the stand-in VtoMix's scale
  for (const mode of [0, 2]) {
    settings({ "dlzmod.meterMode": mode });
    const m = meter();
    ctx.DLZMOD_vuSet(m, "", 0, 0.8, 0.6, main);
    assert.deepStrictEqual(m.vals, [0.8, 0.6], "mode " + mode + ": Mackie's level, before the fader");
    assert.ok(!m.havePre, "mode " + mode + ": one bar");
  }
  settings({ "dlzmod.meterMode": 1 });
  const m = meter();
  ctx.DLZMOD_vuSet(m, "", 1, 0.8, 0.6, main);
  assert.deepStrictEqual(m.vals, [0.75, 0.8], "bright: 5 dB lower after the fader; dimmed: before it");
  assert.strictEqual(m.havePre, true);
  ctx.DLZMOD_vuSet(m, "", 1, 0.95, 0.6, strip(4, 0));
  assert.deepStrictEqual(m.vals, [0.85, 0.95], "fader at -10 dB (stand-in), level above the clip threshold");
  assert.strictEqual(m.clips, 1, "the clip follows the level before the fader");
  ctx.DLZMOD_vuSet(m, "", 1, 0.8, 0.6, strip(4, 1, 1));
  assert.deepStrictEqual(m.vals, [0, 0.8], "muted: nothing after the fader");
  ctx.DLZMOD_vuSet(m, "", 1, 0.8, 0.6, strip(4, undefined));
  assert.deepStrictEqual(m.vals, [0.8, 0.6], "fader position not known yet: as Mackie");
  assert.strictEqual(m.havePre, false);
  const ch = meter();
  ctx.DLZMOD_vuSet(ch, "", 0, 0.3, 0.6, strip(0, 0.5));
  assert.deepStrictEqual(ch.vals, [0.3, 0.6], "another strip without a gain pickup stays as Mackie");
});
test("meters: the before-the-fader bar's colour and strength, mixed over the meter background", () => {
  for (const [c, l, color, alpha] of [[0, 0, "#9CCC56", 0.5], [0, 1, "#9CCC56", 0.15], [1, 0, "#D0D0D0", 0.6],
    [1, 1, "#D0D0D0", 0.25], [7, 0, "#9CCC56", 0.5]]) {
    settings({ "dlzmod.preColor": c, "dlzmod.preLevel": l });
    assert.strictEqual(ctx.DLZMOD_preColor(), color, c + "/" + l);
    assert.strictEqual(ctx.DLZMOD_preAlpha(), alpha, c + "/" + l);
  }
  assert.strictEqual(ctx.DLZMOD_dim("#9CCC56", 0), "#393939", "nothing: the background");
  assert.strictEqual(ctx.DLZMOD_dim("#9CCC56", 1), "#9ccc56", "full: the colour");
  assert.strictEqual(ctx.DLZMOD_dim("#D0D0D0", 0.5), "#858585", "halfway");
});

// a canvas that records each fillRect as [fillStyle, from, to] along a vertical meter 100 px high
const canvas = () => ({ fills: [], fillStyle: null, fillRect(x, y, w, h) {
  this.fills.push([this.fillStyle, 100 - y - h, 100 - y]);
} });
const stripMeter = (o) => Object.assign({ gradArr: ctx.Color.vuGrad, flipped: false, horizontal: false, w: 6, h: 100,
  gradient: true, fillStyle: "gradient" }, o);
const TICK = "rgba(0,0,0,0.8)";
const zones = (t) => t.fills.filter((f) => f[0] !== TICK);
const ticks = (t) => t.fills.filter((f) => f[0] === TICK).map((f) => f[1]);

test("meters: marks on: yellow and red zones at Mackie's colour stops, dB ticks; dimmed zones on the before-the-fader bar", () => {
  settings({ "dlzmod.meterMarks": 1 });
  const m = stripMeter();
  let t = canvas();
  ctx.DLZMOD_vuPaint(m, t, 95, 100);
  assert.deepStrictEqual(zones(t), [["#ffff00", 75, 90], ["#ff0000", 90, 95]]);
  assert.deepStrictEqual(ticks(t), [92, 85, 77, 70, 55, 40], "-6 .. -48 dB, 80 dB for the full length");
  assert.strictEqual(m.gradient, false, "Mackie's gradient off: one solid green on the mixer and in a browser");
  assert.strictEqual(m.fillStyle, "green");
  t = canvas();
  ctx.DLZMOD_vuPaint(m, t, 60, 100);
  assert.deepStrictEqual(zones(t), [], "below yellow: plain green");
  t = canvas();
  ctx.DLZMOD_vuPaint(m, t, 80, 100);
  assert.deepStrictEqual(zones(t), [["#ffff00", 75, 80]]);
  settings({ "dlzmod.meterMarks": 1, "dlzmod.meterMode": 1 });
  t = canvas();
  ctx.DLZMOD_vuPaint(stripMeter({ dlzmodPre: true, value2: 0.95 }), t, 80, 100);
  assert.deepStrictEqual(zones(t), [["#ffff00", 75, 80], [ctx.DLZMOD_dim("#ffff00", 0.5), 80, 90],
    [ctx.DLZMOD_dim("#ff0000", 0.5), 90, 95]]);
});
test("meters: marks off: Mackie's plain meters; other meters (master, flipped, short) never touched", () => {
  settings();
  const m = stripMeter();
  const t = canvas();
  ctx.DLZMOD_vuPaint(m, t, 95, 100);
  assert.deepStrictEqual(t.fills, [], "no zones, no ticks");
  assert.strictEqual(m.gradient, false, "the gradient still goes: the mixer never draws it");
  settings({ "dlzmod.meterMarks": 1 });
  for (const [o, s, e] of [[{ gradArr: [[0, "#ffffff"]] }, 95, 100], [{ flipped: true }, 95, 100], [{}, 30, 39]]) {
    const other = stripMeter(o);
    const t2 = canvas();
    ctx.DLZMOD_vuPaint(other, t2, s, e);
    assert.deepStrictEqual(t2.fills, [], JSON.stringify([o, e]));
    assert.strictEqual(other.gradient, true);
  }
});
test("meters: the dB numbers beside LR only, drawn by its fader, leaving out those under the knob", () => {
  settings({ "dlzmod.meterMarks": 1 });
  let painted = 0, updates = 0;
  const sl = { x: 0, y: 0, h: 300, value: 1, paint() {
    painted++;
  }, update() {
    updates++;
  } };
  const vu = stripMeter({ x: 10, y: 0, w: 6, h: 300 });
  const vu2 = stripMeter({ x: 20, y: 0, w: 6, h: 300 });
  ctx.VU_STRUCT = { m: { strips: [{ sl, vu, vu2 }] } };
  try {
    ctx.DLZMOD_vuPaint(vu, canvas(), 0, 300);
    assert.strictEqual(updates, 0, "LR's left bar: no numbers");
    ctx.DLZMOD_vuPaint(vu2, canvas(), 0, 300);
    ctx.DLZMOD_vuPaint(vu2, canvas(), 0, 300);
    assert.strictEqual(updates, 1, "the fader's paint taken over once, then repainted");
    const texts = [];
    const c = { drawText: (s, x) => texts.push([s, x]) };
    sl.paint(c);
    assert.strictEqual(painted, 1, "the fader's own paint first");
    assert.deepStrictEqual(texts.map((x) => x[0]), ["12", "18", "24", "36", "48"], "the knob at the top covers 0 and 6");
    assert.ok(texts.every((x) => x[1] === 28), "right of the right bar");
    texts.length = 0;
    sl.value = 0;
    sl.paint(c);
    assert.deepStrictEqual(texts.map((x) => x[0]), ["0", "6", "12", "18", "24", "36", "48"], "the knob at the bottom");
    texts.length = 0;
    settings();
    sl.paint(c);
    assert.deepStrictEqual(texts, [], "marks off: none");
    ctx.DLZMOD_applyMeterMarks();
    assert.strictEqual(updates, 2, "a change repaints the fader at once");
  } finally {
    ctx.VU_STRUCT = undefined;
  }
});

// Header (Mod page, Display: Hide header)
const fakeApp = (nav = true) => {
  const a = { calls: [], navBar: { visible: nav }, topBar: { setVisible: (v) => a.calls.push(["topBar", v]) },
    updateGeometry: () => a.calls.push(["geometry"]), update: () => a.calls.push(["update"]) };
  return a;
};
test("header: hidden or shown at once, but not on full-screen pages; saved settings kept, the others stock", () => {
  settings({ "dlzmod.hideHeader": 1 });
  const a = fakeApp();
  ctx.app = a;
  try {
    ctx.DLZMOD_applyHeader();
    assert.deepStrictEqual(a.calls, [["topBar", false], ["geometry"], ["update"]]);
    a.calls.length = 0;
    ctx.Data.data["dlzmod.hideHeader"] = 0;
    ctx.DLZMOD_applyHeader();
    assert.deepStrictEqual(a.calls[0], ["topBar", true]);
    const full = fakeApp(false);
    ctx.app = full;
    ctx.DLZMOD_applyHeader();
    assert.deepStrictEqual(full.calls, [], "the assistant, the keyboard, ...: left alone");
  } finally {
    ctx.app = undefined;
  }
  ctx.DLZMOD_applyHeader();   // before the UI is built: nothing to do
  settings({ "dlzmod.hideHeader": 1 });
  ctx.DLZMOD_initKeys();
  assert.deepStrictEqual(ctx.Data.data, { "dlzmod.hideHeader": 1, "dlzmod.meterMode": 0, "dlzmod.preColor": 0,
    "dlzmod.preLevel": 0, "dlzmod.meterMarks": 0, "dlzmod.theme": 0, "dlzmod.bgColor": 0, "dlzmod.faderColor": 0 });
});

// The Mod page (Settings, DLZ Creator Modded): its tabs and what they show
const settingsPage = () => ctx.DLZMOD_settingsPage({}, 0);
test("Mod page: Display, Colors, Network, Remote and Mod on the mixer; Display, Colors and Mod in a browser", () => {
  reset();
  settings();
  assert.deepStrictEqual(plain(settingsPage().tabs.map((t) => t.text)), ["Display", "Colors", "Network", "Remote", "Mod"]);
  ctx.EXTERNAL = true;
  try {
    const web = settingsPage();
    assert.deepStrictEqual(plain(web.tabs.map((t) => t.text)), ["Display", "Colors", "Mod"]);
    web.tabs[2].onToggleON();
    assert.strictEqual(web.sub, 4, "its third tab is Mod");
    assert.deepStrictEqual(plain(web.tabs.map((t) => t.getVal())), [false, false, true]);
  } finally {
    ctx.EXTERNAL = false;
  }
});
test("Mod page: a tab shows its own panels; Network and Remote ask for the status; leaving Remote hides the PIN", () => {
  reset();
  settings();
  const pg = settingsPage();
  const shown = () => ["screen", "meters", "colours", "network", "pair", "about"].filter((k) => pg[k].visible);
  assert.deepStrictEqual(shown(), ["screen", "meters"], "Display first");
  assert.deepStrictEqual(ui.cmds, []);
  for (const [i, panels] of [[1, ["colours"]], [2, ["network"]], [3, ["pair"]], [4, ["about"]], [0, ["screen", "meters"]]]) {
    ui.cmds.length = 0;
    pg.tabs[i].onToggleON();
    assert.deepStrictEqual(shown(), panels, "tab " + i);
    assert.deepStrictEqual(ui.cmds, i === 2 || i === 3 ? [["DLZMOD_NET", { op: "status" }]] : [], "tab " + i);
  }
  pg.tabs[3].onToggleON();
  pg.pair.revealPin(true);
  pg.tabs[4].onToggleON();
  assert.strictEqual(pg.pair.shown, false, "leaving Remote: the PIN hidden again");
  pg.pair.revealPin(true);
  ui.cmds.length = 0;
  pg.onShow();
  assert.strictEqual(pg.pair.shown, false, "coming back to the page: hidden");
  assert.deepStrictEqual(ui.cmds, [["DLZMOD_NET", { op: "status" }]]);
});
test("Mod page: header and meter marks follow a change from any screen; the before-fader rows only with Both", () => {
  reset();
  settings();
  const pg = settingsPage();
  assert.strictEqual(pg.screen.hideHeader.key, "dlzmod.hideHeader");
  assert.strictEqual(pg.screen.hideHeader.onToggleON, ctx.DLZMOD_applyHeader);
  assert.ok(regs["dlzmod.hideHeader"].includes(ctx.DLZMOD_applyHeader), "also when a browser changes it");
  assert.strictEqual(pg.meters.meterMarks.key, "dlzmod.meterMarks");
  assert.ok(regs["dlzmod.meterMarks"].includes(ctx.DLZMOD_applyMeterMarks));
  assert.strictEqual(pg.meters.meterMode.key, "dlzmod.meterMode");
  const rows = () => [pg.meters.preColor.visible, pg.meters.preLevel.visible];
  assert.deepStrictEqual(rows(), [false, false]);
  for (const [mode, vis] of [[1, [true, true]], [2, [false, false]]]) {
    const before = pg.meters.updates;
    ctx.Data.data["dlzmod.meterMode"] = mode;
    regs["dlzmod.meterMode"].forEach((f) => f());
    assert.deepStrictEqual(rows(), vis, "mode " + mode);
    assert.ok(pg.meters.updates > before, "repainted: hiding alone leaves the rows drawn");
  }
});

// PIN pad (Remote Control, Own PIN)
const pinKey = (d) => ui.buttons.find((b) => b.text === d);
test("PIN pad: six digits enable the tick, a seventh starts over, the back key closes without a PIN", async () => {
  reset();
  const got = [];
  ctx.DLZMOD_pinPad("Your own PIN", (v) => got.push(v));
  const pad = ui.windows[0];
  assert.deepStrictEqual(ui.buttons.map((b) => b.text), ["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", ""]);
  assert.strictEqual(pad.done, ui.buttons[11]);
  assert.strictEqual(pad.done.enabled, false);
  for (const d of "12345") pinKey(d).onPress();
  assert.strictEqual(pad.value, "12345");
  assert.strictEqual(pad.done.enabled, false, "five digits: not yet");
  pinKey("0").onPress();
  assert.strictEqual(pad.value, "123450");
  assert.strictEqual(pad.done.enabled, true);
  pinKey("7").onPress();
  assert.strictEqual(pad.value, "7", "a seventh digit starts over");
  assert.strictEqual(pad.done.enabled, false);
  for (const d of "80912") pinKey(d).onPress();
  pad.done.onPress();
  assert.strictEqual(pad.closed, true);
  assert.deepStrictEqual(got, [], "not before the popup has closed");
  await tick(5);
  assert.deepStrictEqual(got, ["780912"]);
  reset();
  ctx.DLZMOD_pinPad("Your own PIN", (v) => got.push(v));
  for (const d of "123456") pinKey(d).onPress();
  ui.buttons[9].onPress();
  assert.strictEqual(ui.windows[0].closed, true);
  await tick(5);
  assert.deepStrictEqual(got, ["780912"], "the back key: no PIN");
});
test("PIN pad: your own PIN goes to the server behind the spinner", async () => {
  reset();
  ctx.DLZMOD_askOwnPin();
  for (const d of "246813") pinKey(d).onPress();
  ui.windows[0].done.onPress();
  await tick(5);
  assert.strictEqual(ui.progress.length, 1);
  assert.deepStrictEqual(ui.cmds, [["DLZMOD_NET", { op: "pairPin", pin: "246813" }]]);
  ctx.DLZMOD_netIdle();
  assert.strictEqual(ui.progress[0].closed, true);
});
test("PIN pad: a PIN set shows on the Remote panel instead of a popup; elsewhere, or refused, a popup", () => {
  reset();
  settings();
  const pg = settingsPage();
  ctx.app = { pageSettings: { dlzmod: pg } };
  try {
    pg.tabs[3].onToggleON();
    ctx.DLZMOD_netResult({ ok: true, quiet: true, text: "PIN set" });
    assert.deepStrictEqual(ui.popups, []);
    assert.strictEqual(pg.pair.shown, true, "the new PIN shown");
    ctx.DLZMOD_netResult({ ok: false, quiet: true, text: "Too easy to guess" });
    assert.deepStrictEqual([ui.popups[0].text, ui.popups[0].opts.textColor], ["Too easy to guess", "red2"]);
    pg.tabs[4].onToggleON();
    ctx.DLZMOD_netResult({ ok: true, quiet: true, text: "PIN set" });
    assert.deepStrictEqual([ui.popups[1].text, ui.popups[1].opts.textColor], ["PIN set", "green"]);
  } finally {
    ctx.app = undefined;
  }
});

// Update and card popups (#65 and the card check)
test("update popups: the result after the start, green or red; OK tells the server it was seen", () => {
  reset();
  ctx.DLZMOD_showUpdateNote(null);
  assert.deepStrictEqual(ui.popups, []);
  ctx.DLZMOD_showUpdateNote({ ok: true, version: "v0.2.0" });
  ctx.DLZMOD_showUpdateNote({ ok: false, report: "update-report.txt" });
  ctx.DLZMOD_showUpdateNote({ ok: false });
  const [ok, bad, bare] = ui.popups;
  assert.strictEqual(ok.text, "Updated to v0.2.0.");
  assert.strictEqual(ok.opts.textColor, "green");
  assert.strictEqual(ok.opts.title, "DLZ Creator Modded update");
  assert.strictEqual(bad.text, "The update was not installed.\nSee dlzmod-logs/update-report.txt on the card.");
  assert.strictEqual(bad.opts.textColor, "red2");
  assert.match(bare.text, /\nSee dlzmod-logs on the card\.$/);
  assert.deepStrictEqual(ui.cmds, []);
  ok.opts.func();
  assert.deepStrictEqual(ui.cmds, [["DLZMOD_UPDATE_NOTE_OK", undefined]]);
});
test("update popups: an update waiting asks Install or Later with both versions; only Install approves it", () => {
  reset();
  ctx.DLZMOD_setUpdateStatus({ installed: "v0.1.0" });
  try {
    ctx.DLZMOD_askUpdate(null);
    ctx.DLZMOD_askUpdate({ version: "v0.2.0" });
    assert.deepStrictEqual(ui.popups, [], "nothing without the file's checksum");
    ctx.DLZMOD_askUpdate({ sum: "abc", version: "v0.2.0" });
    const p = ui.popups[0];
    assert.strictEqual(p.kind, "confirm");
    assert.deepStrictEqual(plain(p.opts.buttons.map((b) => b.text)), ["Install", "Later"]);
    const texts = [];
    p.opts.paintCustom.call({ w: 600, h: 400 }, { drawText: (s) => texts.push(s) });
    assert.deepStrictEqual(texts.slice(0, 4), ["Current version", "v0.1.0", "Update version", "v0.2.0"]);
    assert.deepStrictEqual(ui.cmds, [], "Later: nothing sent");
    p.yes();
    assert.deepStrictEqual(ui.cmds, [["DLZMOD_UPDATE_APPROVE", { sum: "abc" }]]);
  } finally {
    ctx.DLZMOD_setUpdateStatus(null);
  }
});
test("update popups: Install's answer and the card check's failure, green or red", () => {
  reset();
  ctx.DLZMOD_updateApproved(null);
  ctx.DLZMOD_showCardNote("");
  assert.deepStrictEqual(ui.popups, []);
  ctx.DLZMOD_updateApproved({ ok: true, text: "Switch the mixer off and on." });
  ctx.DLZMOD_updateApproved({ ok: false, text: "The file changed." });
  ctx.DLZMOD_showCardNote("The card has errors.");
  const [yes, no, card] = ui.popups;
  assert.deepStrictEqual([yes.text, yes.opts.textColor], ["Switch the mixer off and on.", "green"]);
  assert.deepStrictEqual([no.text, no.opts.textColor], ["The file changed.", "red2"]);
  assert.strictEqual(card.text, "The card has errors.\nThe mixer has no sound now. Take the card out to use it normally.");
  assert.deepStrictEqual([card.opts.title, card.opts.textColor], ["DLZ Creator Modded", "red2"]);
});
test("update popups: the Mod page's Updates row and Install button follow the server's status", () => {
  reset();
  settings();
  const pg = settingsPage();
  ctx.app = { pageSettings: { dlzmod: pg } };
  try {
    const P = { sum: "abc", version: "v0.2.0" };
    const COPY = "Copy the update's .tar and .sig to DLZDATA/dlzmod-update";
    for (const [s, text, color, install] of [
      [null, COPY, null, false],
      [{ failed: "Last update not installed: bad signature" }, "Last update not installed: bad signature", "red2", false],
      [{ pending: P, local: true }, "Update v0.2.0 is on the card", "#FFD600", true],
      [{ pending: P }, "Update v0.2.0 is on the card: install it on the mixer's own screen", "#FFD600", false],
      [{ pending: Object.assign({ approved: true }, P), local: true },
        "v0.2.0 installs at the next start: switch the mixer off and on", "#FFD600", false],
      [{ pending: { version: "v0.2.0" }, local: true }, COPY, null, false],
    ]) {
      ctx.DLZMOD_setUpdateStatus(s);
      assert.deepStrictEqual(plain(ctx.DLZMOD_updateRow()), [text, color], JSON.stringify(s));
      assert.strictEqual(pg.about.install.visible, install, "Install button: " + JSON.stringify(s));
    }
    ctx.DLZMOD_setUpdateStatus({ pending: P, local: true, installed: "v0.1.0" });
    assert.strictEqual(ctx.DLZMOD_installed(), "v0.1.0");
    pg.about.install.onPress();
    assert.strictEqual(ui.popups.length, 1, "Install asks first");
    ui.popups[0].yes();
    assert.deepStrictEqual(ui.cmds.at(-1), ["DLZMOD_UPDATE_APPROVE", { sum: "abc" }]);
    ctx.DLZMOD_setUpdateStatus({});
    assert.strictEqual(ctx.DLZMOD_installed(), "%%DLZMOD_VERSION%%", "until the server says: the stamped VERSION");
    assert.strictEqual(pg.about.upload.visible, false, "Upload Update...: not on the mixer's own screen");
  } finally {
    ctx.app = undefined;
    ctx.DLZMOD_setUpdateStatus(null);
  }
});

// #114: Upload Update... in a browser (dlzmod-server.js, DLZMOD_updateUpload)
const TAR = { name: "dlzmod-v0.2.0.tar", size: 1200000 };
const SIGF = { name: "dlzmod-v0.2.0.tar.sig", size: 64 };
// the mixer's answer: the upload's own texts are text/plain, the pairing gate's pages HTML (o.type)
const uploadAnswer = (status, text, o = {}) => {
  ctx.fetch = (url, opts) => {
    ui.fetches.push({ url, opts });
    if (o.fail) return Promise.reject(new Error("offline"));
    if (o.hold) return new Promise(() => {});
    const type = o.type || "text/plain; charset=utf-8";
    return Promise.resolve({ ok: status === 200, status, text: () => Promise.resolve(text),
      headers: { get: (k) => (k.toLowerCase() === "content-type" ? type : null) } });
  };
};
test("update upload: the Mod page's Upload Update... in a browser opens a picker for the two files", () => {
  reset();
  settings();
  ctx.EXTERNAL = true;
  try {
    const pg = settingsPage();
    assert.strictEqual(pg.about.upload.visible, true);
    assert.strictEqual(pg.about.upload.text, "Upload Update...");
    assert.deepStrictEqual(plain(ctx.DLZMOD_updateRow()), ["Upload the update's .tar and .sig with the button below", null]);
    pg.about.upload.onPress();
    assert.strictEqual(ui.pickers.length, 1);
    const p = ui.pickers[0];
    assert.deepStrictEqual([p.type, p.multiple, p.accept, p.hidden], ["file", true, ".tar,.sig", true]);
    assert.deepStrictEqual(ui.attached, [p], "in the page while open");
    // cancelled (no answer), then pressed again: the first one goes
    pg.about.upload.onPress();
    const p2 = ui.pickers[1];
    assert.deepStrictEqual(ui.attached, [p2], "one picker in the page");
    p2.files = [SIGF, TAR];
    p2.onchange();
    assert.deepStrictEqual(ui.attached, [], "answered: out of the page");
    assert.strictEqual(ui.popups.length, 1, "the two files chosen: asks first");
    assert.match(ui.popups[0].text, /^Send dlzmod-v0\.2\.0\.tar \(1\.\d MB\) to the mixer\?\nIt is installed only after Install/);
  } finally {
    ctx.EXTERNAL = false;
  }
});
test("update upload: the wrong files get a message and are not sent", () => {
  for (const [files, text] of [
    [[], /^Choose both files/], [[TAR], /^Choose both files/], [[TAR, SIGF, SIGF], /^Choose both files/],
    [[TAR, { name: "dlzmod-v0.2.0.tar", size: 5 }], /^Choose both files/],
    [[{ name: "dlzmod-v0.2.0 (1).tar", size: 9 }, { name: "dlzmod-v0.2.0 (1).tar.sig", size: 64 }], /is not a mod update\.\n\(A copy the browser renamed/],
    [[{ name: "notes.tar", size: 9 }, { name: "notes.tar.sig", size: 64 }], /^notes\.tar is not a mod update/],
    [[TAR, { name: "dlzmod-v0.1.0.tar.sig", size: 64 }], /^dlzmod-v0\.1\.0\.tar\.sig is not the signature of dlzmod-v0\.2\.0\.tar\.$/],
    [[TAR, { name: SIGF.name, size: 65 }], /is not a signature file/],
    [[{ name: TAR.name, size: 0 }, SIGF], /wrong size/], [[{ name: TAR.name, size: 64 * 1024 * 1024 + 1 }, SIGF], /wrong size/],
  ]) {
    reset();
    uploadAnswer(200, "");
    ctx.DLZMOD_uploadFiles(files);
    assert.strictEqual(ui.popups.length, 1, JSON.stringify(files));
    assert.strictEqual(ui.popups[0].kind, "message");
    assert.match(ui.popups[0].text, text, JSON.stringify(files));
    assert.strictEqual(ui.popups[0].opts.title, "Upload Update");
    assert.deepStrictEqual(ui.fetches, []);
  }
});
test("update upload: Yes sends the signature, then the package, and shows the mixer's answer", async () => {
  reset();
  uploadAnswer(200, "dlzmod-v0.2.0.tar is on the mixer's card.");
  ctx.DLZMOD_uploadFiles([TAR, SIGF]);
  assert.deepStrictEqual(ui.fetches, [], "nothing before Yes");
  ui.popups[0].yes();
  await tick(20);
  assert.deepStrictEqual(ui.toasts, ["Sending: dlzmod-v0.2.0.tar"]);
  assert.strictEqual(ui.fetches.length, 1);
  const { url, opts } = ui.fetches[0];
  assert.strictEqual(url, "/dlzmod-update-upload");
  assert.strictEqual(opts.method, "POST");
  assert.strictEqual(opts.headers["X-Dlzmod-Name"], "dlzmod-v0.2.0.tar");
  assert.strictEqual(opts.body.parts[0], SIGF, "the signature first");
  assert.strictEqual(opts.body.parts[1], TAR);
  assert.strictEqual(opts.body.parts.length, 2);
  assert.strictEqual(ui.popups.at(-1).text, "dlzmod-v0.2.0.tar is on the mixer's card.");
  const gone = "This browser is not paired with the mixer any more,\nor control from other devices is off. Reload this page.";
  for (const [status, text, o, want] of [[503, "The mixer is busy with a recording.", {}, "The mixer is busy with a recording."],
    [403, "", {}, gone], [500, "", {}, "The mixer refused it (HTTP 500)."],
    // the pairing gate's HTML pages: never shown as text
    [403, "<!DOCTYPE html><html>...Not paired with this mixer...", { type: "text/html; charset=utf-8" }, gone],
    [421, "<!DOCTYPE html><html>...", { type: "text/html; charset=utf-8" }, gone],
    [404, "<!DOCTYPE html><html>...", { type: "text/html; charset=utf-8" }, "The mixer refused it (HTTP 404)."],
    [0, "", { fail: true }, "The upload did not get through. Try again."]]) {
    reset();
    uploadAnswer(status, text, o);
    ctx.DLZMOD_uploadFiles([TAR, SIGF]);
    ui.popups[0].yes();
    await tick(20);
    assert.strictEqual(ui.popups.at(-1).text, want, status + " " + JSON.stringify(o));
    assert.strictEqual(ctx.DLZMOD_uploadFiles.busy, false, "the next one may go");
  }
});
test("update upload: one at a time from the page: a second one while the first is sent gets a message", async () => {
  reset();
  uploadAnswer(200, "", { hold: true });
  ctx.DLZMOD_uploadFiles([TAR, SIGF]);
  ui.popups[0].yes();
  await tick(20);
  assert.strictEqual(ui.fetches.length, 1);
  ctx.DLZMOD_uploadFiles([TAR, SIGF]);
  assert.strictEqual(ui.popups.at(-1).kind, "message");
  assert.match(ui.popups.at(-1).text, /^An update is being sent to the mixer\.\nWait for its answer\./);
  // a question still open from before: its Yes sends nothing more
  ctx.DLZMOD_uploadFiles.busy = false;
  ctx.DLZMOD_uploadFiles([TAR, SIGF]);
  const late = ui.popups.at(-1);
  ctx.DLZMOD_uploadFiles.busy = true;
  late.yes();
  assert.strictEqual(ui.fetches.length, 1, "nothing sent twice");
  // Upload Update... pressed meanwhile: the message, no picker
  ctx.DLZMOD_uploadPick();
  assert.deepStrictEqual(ui.pickers, [], "no picker while one is sent");
  assert.match(ui.popups.at(-1).text, /^An update is being sent to the mixer\./);
});

// Network and Remote Control (the server's status: DLZMOD_setNetState)
const GREY = "#888888", YELLOW = "#FFD600";
// Mackie runs getState only while a widget is on screen: a control checked on a hidden panel would hide a
// getState that hides its own widget
const enabled = (b) => {
  assert.ok(b.globalVisible(), (b.text || "a control") + " is on screen");
  b.getState();
  return b.enabled;
};
const keyboard = () => {
  const kbd = { maxInput: 36 };
  ctx.app = { pageKbd: { kbd } };
  return kbd;
};
test("Network: the Wi-Fi card's status for each state of the stick", () => {
  for (const [s, want] of [
    [{ remote: true }, ["Only on the mixer's", "own screen", GREY]],
    [{ unknown: true }, ["…", "", GREY]],
    [{ stick: false }, ["No working Wi-Fi stick", "Not every stick is supported", GREY]],
    [{ stick: true, wifi: "connected", ssid: "Studio", ip: "192.168.1.20" }, ["Studio", "192.168.1.20", "main"]],
    [{ stick: true, wifi: "connected", ssid: "", ip: "192.168.1.20" }, ["Connected", "192.168.1.20", "main"]],
    [{ stick: true, wifi: "connecting" }, ["Connecting…", "", YELLOW]],
    [{ stick: true, wifi: "unavailable" }, ["Wi-Fi stick not ready", "", GREY]],
    [{ stick: true, wifi: "disconnected" }, ["Not connected", "", GREY]],
  ]) assert.deepStrictEqual(plain(ctx.DLZMOD_wifiStatusText(s)), want, JSON.stringify(s));
});
test("Network: the SSH card's status, also while a change runs", () => {
  for (const [s, want] of [
    [{ remote: true }, ["Only on the mixer's own screen", GREY]],
    [{ unknown: true }, ["…", GREY]],
    [{ ssh: false, sshBusy: "on" }, ["Setting up…", YELLOW]],
    [{ ssh: true, sshBusy: "off" }, ["Switching off…", YELLOW]],
    [{ ssh: true }, ["On", GREY]],
    [{ ssh: false, sshKeep: true }, ["Off now, back on at the next start", GREY]],
    [{ ssh: false }, ["Off", GREY]],
  ]) assert.deepStrictEqual(plain(ctx.DLZMOD_sshStatusText(s)), want, JSON.stringify(s));
});
test("Network: which Wi-Fi and SSH controls work in which state", () => {
  reset();
  settings();
  const pg = settingsPage();
  pg.tabs[2].onToggleON();
  const { wifi, ssh } = pg.network;
  const base = { stick: true, wifi: "connected", ssh: false, sshKeep: false, sshBusy: "" };
  try {
    // [Wi-Fi Networks, SSH switch, its position, Keep on, SSH Password]
    for (const [s, want] of [
      [base, [true, true, false, false, false]],
      [{ ...base, wifi: "unavailable" }, [false, true, false, false, false]],
      [{ ...base, stick: false }, [false, true, false, false, false]],
      [{ ...base, ssh: true }, [true, true, true, true, true]],
      [{ ...base, sshKeep: true }, [true, true, false, true, false]],
      [{ ...base, ssh: true, sshBusy: "off" }, [true, false, true, false, false]],
      [{ ...base, ssh: true, remote: true }, [true, false, true, false, false]],
    ]) {
      ctx.DLZMOD_setNetState(s);
      assert.deepStrictEqual([enabled(wifi.networks), enabled(ssh.ssh), ssh.ssh.value, enabled(ssh.keepOn),
        enabled(ssh.password)], want, JSON.stringify(s));
    }
  } finally {
    ctx.DLZMOD_setNetState(undefined);
  }
});
test("Remote Control: which controls work in which state; Show PIN says Hide PIN while shown", () => {
  reset();
  settings();
  const pg = settingsPage();
  pg.tabs[3].onToggleON();
  const pair = pg.pair;
  try {
    // [switch, its position, Forget All Devices, Random PIN, Own PIN, Show PIN]
    for (const [p, want] of [
      [undefined, [false, false, false, false, false, false]],
      [{ on: false }, [true, false, false, false, false, false]],
      [{ on: true, own: false }, [true, true, true, false, true, true]],
      [{ on: true, own: true }, [true, true, true, true, true, true]],
    ]) {
      ctx.DLZMOD_setNetState({ pair: p });
      assert.deepStrictEqual([enabled(pair.on), pair.on.value, enabled(pair.forget), enabled(pair.random),
        enabled(pair.ownPin), enabled(pair.showPin)], want, JSON.stringify(p));
    }
    assert.strictEqual(pair.showPin.text, "Show PIN");
    pair.showPin.onPress();
    pair.showPin.getState();
    assert.deepStrictEqual([pair.shown, pair.showPin.text], [true, "Hide PIN"]);
    pair.showPin.onPress();
    assert.strictEqual(pair.shown, false);
  } finally {
    pair.revealPin(false);
    ctx.DLZMOD_setNetState(undefined);
  }
});
test("Network: an SSH change counts as running at once, until its outcome; another change drops the mark, the server's brings it back", () => {
  reset();
  settings();
  const pg = settingsPage();
  pg.tabs[2].onToggleON();
  ui.cmds.length = 0;   // the tab's status request
  const ssh = pg.network.ssh;
  const s = { stick: true, wifi: "connected", ssh: true, sshKeep: false, sshBusy: "" };
  ctx.DLZMOD_setNetState(s);
  try {
    ssh.ssh.onToggleOFF();
    assert.deepStrictEqual(ui.cmds, [["DLZMOD_NET", { op: "ssh", on: false }]]);
    assert.strictEqual(ctx.DLZMOD_netState().sshBusy, "off");
    assert.strictEqual(ui.progress[0].text, "Switching SSH off…");
    assert.strictEqual(enabled(ssh.ssh), false, "locked meanwhile");
    ctx.DLZMOD_netResult({ ok: true, text: "SSH is off" });
    assert.strictEqual(ui.progress[0].closed, true);
    assert.strictEqual(ctx.DLZMOD_netState().sshBusy, "");
    assert.deepStrictEqual([ui.popups[0].text, ui.popups[0].opts.textColor], ["SSH is off", "green"]);
    ctx.DLZMOD_sshSend(true, "correct horse");
    assert.deepStrictEqual(ui.cmds.at(-1), ["DLZMOD_NET", { op: "ssh", on: true, password: "correct horse" }]);
    assert.strictEqual(ctx.DLZMOD_netState().sshBusy, "on");
    ctx.DLZMOD_netBusy("Connecting to Studio…", 150);
    assert.strictEqual(ui.progress[1].closed, true, "one spinner at a time");
    assert.strictEqual(ctx.DLZMOD_netState().sshBusy, "", "another change's spinner drops the mark");
    ctx.DLZMOD_setNetState({ ...s, sshBusy: "on" });
    assert.strictEqual(ctx.DLZMOD_netState().sshBusy, "on", "the server's status brings it back");
  } finally {
    ctx.DLZMOD_netIdle();
    ctx.DLZMOD_setNetState(undefined);
  }
});
test("Network: a spinner without an outcome gives up with No answer; an outcome stops the clock", async () => {
  reset();
  ctx.DLZMOD_netBusy("Forgetting Studio…", 0.02);
  await tick(60);
  assert.strictEqual(ui.progress[0].closed, true);
  assert.deepStrictEqual([ui.popups[0].text, ui.popups[0].opts.textColor], ["No answer from the mixer.\nTry again.", "red2"]);
  ctx.DLZMOD_netBusy("Forgetting Studio…", 0.02);
  ctx.DLZMOD_netResult({ ok: true, text: "Forgotten" });
  await tick(60);
  assert.deepStrictEqual(ui.popups.map((p) => p.text), ["No answer from the mixer.\nTry again.", "Forgotten"]);
});
test("Network: SSH on asks first, then a password of 8 or more on Mackie's keyboard (64 allowed, Mackie's limit back after)", async () => {
  reset();
  const kbd = keyboard();
  try {
    ctx.DLZMOD_confirmSsh();
    const c = ui.popups[0];
    assert.deepStrictEqual([c.kind, c.opts.title], ["popupConfirm", "Remote login (SSH)"]);
    assert.deepStrictEqual(plain(c.opts.buttons.map((b) => b.text)), ["Turn on", "Cancel"]);
    assert.deepStrictEqual(ui.inputs, [], "nothing before Turn on");
    c.opts.func();
    await tick(5);
    assert.strictEqual(ui.inputs.length, 1, "once the popup has closed: the keyboard");
    assert.strictEqual(kbd.maxInput, 64);
    assert.deepStrictEqual(ui.titles, ["New root password for SSH (8 or more characters)"]);
    ui.inputs[0].accept("1234567");
    assert.deepStrictEqual([kbd.maxInput, ui.titles.at(-1)], [36, ""], "Mackie's keyboard as it was");
    await tick(5);
    assert.deepStrictEqual(ui.cmds, []);
    assert.deepStrictEqual([ui.popups.at(-1).text, ui.popups.at(-1).opts.textColor], ["An SSH password has 8 to 64 characters", "red2"]);
    ctx.DLZMOD_askSshPassword();
    ui.inputs[1].accept("12345678");
    await tick(5);
    assert.deepStrictEqual(ui.cmds, [["DLZMOD_NET", { op: "ssh", on: true, password: "12345678" }]]);
    ctx.DLZMOD_netIdle();
    ctx.DLZMOD_askSshPassword();
    ui.inputs[2].cancel();
    await tick(5);
    assert.strictEqual(kbd.maxInput, 36, "cancelled: Mackie's limit back too");
    assert.strictEqual(ui.cmds.length, 1);
  } finally {
    ctx.app = undefined;
    ctx.DLZMOD_netIdle();
  }
});
test("Remote Control: on asks first, off at once; Forget All asks, in words for a random or your own PIN; Random PIN at once", () => {
  reset();
  settings();
  const pair = settingsPage().pair;
  try {
    ctx.DLZMOD_setNetState({ pair: { on: false } });
    pair.on.onToggleON();
    const c = ui.popups[0];
    assert.deepStrictEqual([c.kind, c.opts.title], ["popupConfirm", "Control from other devices"]);
    assert.deepStrictEqual(ui.cmds, [], "nothing before Turn on");
    c.opts.func();
    assert.deepStrictEqual(ui.cmds, [["DLZMOD_NET", { op: "pair", on: true }]]);
    assert.strictEqual(ui.progress.length, 1);
    ctx.DLZMOD_netIdle();
    pair.on.onToggleOFF();
    assert.deepStrictEqual(ui.cmds.at(-1), ["DLZMOD_NET", { op: "pair", on: false }]);
    ctx.DLZMOD_netIdle();
    for (const [own, text] of [[false, /^Every paired device is disconnected and needs the new PIN again\.$/],
      [true, /needs your PIN again\.\nChange the PIN too if others know it\.$/]]) {
      ctx.DLZMOD_setNetState({ pair: { on: true, own } });
      const n = ui.cmds.length;
      pair.forget.onPress();
      assert.match(ui.popups.at(-1).text, text);
      assert.strictEqual(ui.cmds.length, n, "nothing before Forget");
      ui.popups.at(-1).opts.func();
      assert.deepStrictEqual(ui.cmds.at(-1), ["DLZMOD_NET", { op: "pairForget" }]);
      ctx.DLZMOD_netIdle();
    }
    pair.random.onPress();
    assert.deepStrictEqual(ui.cmds.at(-1), ["DLZMOD_NET", { op: "pairPin" }]);
  } finally {
    ctx.DLZMOD_netIdle();
    ctx.DLZMOD_setNetState(undefined);
  }
});

// Wi-Fi Networks popup (the server sorts and answers the scan: DLZMOD_setWifiList)
const NETS = [{ ssid: "Studio", signal: 80, security: "wpa", active: true },
  { ssid: "Office", signal: 60, security: "wpa", known: true }, { ssid: "Cafe", signal: 50, security: "open" },
  { ssid: "Home", signal: 40, security: "wpa" }, { ssid: "Corp", signal: 30, security: "unsupported" },
  { ssid: "Six", signal: 20, security: "wpa" }, { ssid: "Seven", signal: 10, security: "wpa" }];
const rowsOf = (w) => ui.widgets.filter((x) => x.parent === w && "idx" in x);
test("Wi-Fi list: opens once and scans; up to 6 networks; rows and Scan Again wait for a scan; every way out lets it open again", () => {
  reset();
  ctx.DLZMOD_wifiList();
  const w = ui.windows[0];
  assert.deepStrictEqual(ui.cmds, [["DLZMOD_NET", { op: "scan" }]]);
  ctx.DLZMOD_wifiList();
  assert.strictEqual(ui.windows.length, 1, "already open: not twice");
  const scan = ui.buttons.find((b) => b.text === "Scan Again");
  assert.strictEqual(enabled(scan), false, "while scanning");
  const rows = rowsOf(w);
  assert.strictEqual(rows.length, 6);
  ctx.DLZMOD_setWifiList({ networks: NETS });
  assert.deepStrictEqual(plain(w.list.map((n) => n.ssid)), ["Studio", "Office", "Cafe", "Home", "Corp", "Six"]);
  assert.strictEqual(enabled(scan), true);
  scan.onPress();
  assert.deepStrictEqual(ui.cmds.at(-1), ["DLZMOD_NET", { op: "scan" }]);
  rows[2].onup();
  assert.strictEqual(w.closed, undefined, "a tap during a scan: nothing");
  ctx.DLZMOD_setWifiList({ networks: [], error: "The Wi-Fi stick stopped" });
  assert.deepStrictEqual([w.list.length, w.error], [0, "The Wi-Fi stick stopped"]);
  rows[0].onup();
  assert.strictEqual(w.closed, undefined, "an empty row: nothing");
  ui.buttons.find((b) => b.parent === w && b.text === "Cancel").onPress();
  assert.strictEqual(w.closed, true);
  assert.deepStrictEqual(ui.cmds.at(-1), ["DLZMOD_NET", { op: "status" }], "the card's status again");
  ctx.DLZMOD_wifiList();
  assert.strictEqual(ui.windows.length, 2, "Cancel: opens again");
  ui.windows[1].onDestroy();   // a tap outside the popup destroys it without close()
  ctx.DLZMOD_wifiList();
  assert.strictEqual(ui.windows.length, 3, "a tap outside: opens again");
  ui.windows[2].close();
});
test("Wi-Fi list: a tap closes it and connects, asks for the password, offers to forget, or says the login is not supported", async () => {
  reset();
  const kbd = keyboard();
  const tapNet = (ssid) => {
    ctx.DLZMOD_wifiList();
    const w = ui.windows.at(-1);
    ctx.DLZMOD_setWifiList({ networks: NETS });
    ui.cmds.length = 0;
    rowsOf(w)[w.list.findIndex((n) => n.ssid === ssid)].onup();
    assert.strictEqual(w.closed, true, ssid + ": the list closes first");
    assert.deepStrictEqual(ui.cmds[0], ["DLZMOD_NET", { op: "status" }]);
  };
  try {
    tapNet("Cafe");
    assert.deepStrictEqual(ui.cmds[1], ["DLZMOD_NET", { op: "connect", ssid: "Cafe", security: "open", password: "" }]);
    assert.strictEqual(ui.progress.at(-1).text, "Connecting to Cafe…");
    ctx.DLZMOD_netIdle();
    tapNet("Corp");
    assert.match(ui.popups.at(-1).text, /^Corp uses a login this mixer\ndoes not support/);
    assert.strictEqual(ui.cmds.length, 1);
    for (const [ssid, text] of [["Studio", "Connected. Forget this network?"], ["Office", "Saved. Forget this network?"]]) {
      tapNet(ssid);
      assert.deepStrictEqual([ui.popups.at(-1).kind, ui.popups.at(-1).text], ["popupConfirm", text]);
      assert.strictEqual(ui.cmds.length, 1, "nothing before Forget");
      ui.popups.at(-1).opts.func();
      assert.deepStrictEqual(ui.cmds.at(-1), ["DLZMOD_NET", { op: "forget", ssid }]);
      ctx.DLZMOD_netIdle();
    }
    tapNet("Home");
    assert.deepStrictEqual([ui.titles.at(-1), kbd.maxInput], ["Wi-Fi password for Home", 64]);
    ui.inputs.at(-1).accept("1234567");
    await tick(5);
    assert.strictEqual(ui.popups.at(-1).text, "A Wi-Fi password has 8 to 63 characters");
    assert.strictEqual(ui.cmds.length, 1);
    tapNet("Home");
    ui.inputs.at(-1).accept("12345678");
    await tick(5);
    assert.deepStrictEqual(ui.cmds.at(-1), ["DLZMOD_NET", { op: "connect", ssid: "Home", security: "wpa", password: "12345678" }]);
  } finally {
    ctx.app = undefined;
    ctx.DLZMOD_netIdle();
  }
});

test("popups: the Mod page repaints right after a popup closes, only while it is on screen", async () => {
  reset();
  settings();
  PopupWindow.prototype.onDestroy = mackieOnDestroy;   // as before the first Mod page
  ctx.DLZMOD_hookPopups.done = false;
  const pg = settingsPage();
  assert.notStrictEqual(PopupWindow.prototype.onDestroy, mackieOnDestroy, "the Mod page hooks every popup's end");
  ctx.app = { pageSettings: { dlzmod: pg } };
  try {
    let n = pg.updates;
    const p = new ctx.PopupWindow(undefined, {});
    p.close();
    assert.deepStrictEqual(ui.destroyed, [p], "Mackie's own end still runs");
    assert.strictEqual(pg.updates, n, "the repaint comes after it");
    await tick(5);
    assert.strictEqual(pg.updates, n + 1);
    pg.visible = false;
    n = pg.updates;
    new ctx.PopupWindow(undefined, {}).close();
    await tick(5);
    assert.strictEqual(pg.updates, n, "another page on screen: nothing");
  } finally {
    ctx.app = undefined;
  }
});
test("browser: what only the mixer's own screen may do says so in a browser, and nothing on the mixer", () => {
  reset();
  assert.strictEqual(ctx.DLZMOD_screenOnly(), false);
  assert.deepStrictEqual(ui.popups, []);
  ctx.EXTERNAL = true;
  try {
    assert.strictEqual(ctx.DLZMOD_screenOnly(), true, "stop there");
    assert.strictEqual(ui.popups[0].text, "Only on the mixer's own screen");
  } finally {
    ctx.EXTERNAL = false;
  }
});
test("Settings tabs: About and the Mod tab fixed, Mackie's tabs share the rest alike, edge to edge", () => {
  const geo = [];
  const banks = Array.from({ length: 7 }, () => ({ setGeometry: (x, y, w) => geo.push([x, w]) }));
  ctx.DLZMOD_layoutTabs({ w: 938, banks });
  const widths = geo.map((g) => g[1]);
  assert.strictEqual(widths[5], 120, "About");
  assert.ok(Math.abs(widths[6] - 230) <= 5, "the Mod tab last, 230 and the rounding: " + widths[6]);
  assert.strictEqual(new Set(widths.slice(0, 5)).size, 1, "Mackie's tabs alike");
  for (let i = 1; i < geo.length; i++) assert.strictEqual(geo[i][0], geo[i - 1][0] + widths[i - 1] + 2, "2 px gaps");
  assert.strictEqual(geo[6][0] + widths[6], 938, "the last one ends at the edge");
  ctx.DLZMOD_layoutTabs({ w: 938 });   // before Mackie's tabs are built: nothing
});

// What a paint shows (the texts and their colours; where they go stays with the screenshots)
const painter = () => ({ texts: [], rects: [], drawText(s, x, y, o) {
  this.texts.push([String(s), o && o.color]);
}, fRect(c, x, y, w) {
  this.rects.push([c, w]);
}, setParams() {} });
const shownBy = (w) => {
  const t = painter();
  w.paint(t);
  return t;
};
const words = (t) => t.texts.map((x) => x[0]);
const colourOf = (t, s) => (t.texts.find((x) => x[0] === s) || [])[1];
test("Remote Control panel: the PIN hidden until Show PIN; the addresses, paired devices, PIN kind and the wait after wrong PINs", () => {
  reset();
  settings();
  const pair = settingsPage().pair;
  const P = { on: true, pin: "123456", own: false, devices: 0, wait: 0, ips: ["192.168.1.20", "10.0.0.7"] };
  try {
    for (const [s, text] of [[{ remote: true, pair: P }, "Only on the mixer's own screen"], [{}, "…"],
      [{ pair: { on: false } }, "Off: only this screen and the mixer's own controls work."]]) {
      ctx.DLZMOD_setNetState(s);
      const w = words(shownBy(pair));
      assert.ok(w.includes(text), text);
      assert.ok(!w.some((x) => /123|•/.test(x)), "no PIN: " + text);
    }
    ctx.DLZMOD_setNetState({ pair: P });
    let t = shownBy(pair);
    assert.ok(words(t).includes("••• •••"), "hidden: the screen is often on camera");
    assert.ok(!words(t).some((x) => x.includes("123")));
    for (const s of ["http://192.168.1.20  or  http://10.0.0.7", "No devices paired yet", "PIN", "A new one after each pairing"]) {
      assert.ok(words(t).includes(s), s);
    }
    pair.revealPin(true);
    assert.ok(words(shownBy(pair)).includes("123 456"), "Show PIN: in two groups of three");
    pair.revealPin(false);
    ctx.DLZMOD_setNetState({ pair: { ...P, devices: 1, ips: [], own: true, wait: 30 } });
    t = shownBy(pair);
    for (const s of ["1 device paired", "the address in Settings, About", "Your own PIN"]) assert.ok(words(t).includes(s), s);
    assert.strictEqual(colourOf(t, "Too many wrong PINs: wait 30 s"), "red2");
    assert.ok(!words(t).includes("Stays until you change it"), "the wait instead");
    ctx.DLZMOD_setNetState({ pair: { ...P, devices: 3, own: true } });
    t = shownBy(pair);
    for (const s of ["3 devices paired", "Stays until you change it"]) assert.ok(words(t).includes(s), s);
  } finally {
    pair.revealPin(false);
    ctx.DLZMOD_setNetState(undefined);
  }
});
test("Wi-Fi list: Connected, Saved and Not supported tags, a lock except on open networks, bars by signal; scanning, error, none", () => {
  reset();
  ctx.DLZMOD_wifiList();
  const w = ui.windows[0];
  try {
    let t = shownBy(w);
    assert.ok(words(t).includes("Looking for networks…"));
    assert.ok(!words(t).includes("Studio"), "no rows while scanning");
    ctx.DLZMOD_setWifiList({ networks: NETS });
    t = shownBy(w);
    for (const [s, tag] of [["Studio", "Connected"], ["Office", "Saved"], ["Corp", "Not supported"]]) {
      assert.ok(words(t).includes(tag), s + ": " + tag);
    }
    assert.strictEqual(colourOf(t, "Studio"), "main", "the connected one in green");
    assert.strictEqual(words(t).filter((x) => x === "lock").length, 5, "all but Cafe (open)");
    const bars = t.rects.filter((r) => r[1] === 5);
    const lit = [];
    for (let i = 0; i < bars.length; i += 4) lit.push(bars.slice(i, i + 4).filter((b) => b[0] !== "#555555").length);
    assert.deepStrictEqual(lit, [4, 3, 2, 2, 2, 1], "signal 80 60 50 40 30 20");
    assert.deepStrictEqual(bars.slice(0, 4).map((b) => b[0]), ["main", "main", "main", "main"], "the connected one's bars green");
    w.rescan();
    t = shownBy(w);
    assert.ok(words(t).includes("Looking for networks…"));
    assert.ok(!words(t).includes("Studio"), "Scan Again: the old list gone meanwhile");
    ctx.DLZMOD_setWifiList({ networks: [] });
    assert.ok(words(shownBy(w)).includes("No networks found"));
    ctx.DLZMOD_setWifiList({ networks: [], error: "The Wi-Fi stick stopped" });
    t = shownBy(w);
    assert.ok(words(t).includes("The Wi-Fi stick stopped"));
    assert.ok(!words(t).includes("No networks found"));
  } finally {
    w.close();
  }
});
test("Meters panel: the subtitle for each mode; the before-fader row only with Both", () => {
  reset();
  for (const [mode, sub] of [[0, "As Mackie shows them: after the fader, the main meter before"],
    [1, "After the fader, with the level before the fader dimmed behind"], [2, "Before the fader"]]) {
    settings({ "dlzmod.meterMode": mode });
    const w = words(shownBy(settingsPage().meters));
    assert.ok(w.includes(sub), "mode " + mode);
    assert.strictEqual(w.includes("Before-fader bar"), mode === 1, "mode " + mode);
  }
});
test("SSH card: the ssh command only while SSH is on and the mixer has an address", () => {
  reset();
  settings();
  const ssh = settingsPage().network.ssh;
  try {
    for (const [s, shown] of [[{ ssh: true, ip: "192.168.1.20" }, true], [{ ssh: false, ip: "192.168.1.20" }, false],
      [{ ssh: true, ip: "" }, false]]) {
      ctx.DLZMOD_setNetState({ stick: true, wifi: "connected", sshKeep: false, sshBusy: "", ...s });
      assert.strictEqual(words(shownBy(ssh)).includes("ssh root@192.168.1.20"), shown, JSON.stringify(s));
    }
  } finally {
    ctx.DLZMOD_setNetState(undefined);
  }
});
test("PIN pad: the digits so far, underscores for the rest", () => {
  reset();
  ctx.DLZMOD_pinPad("Your own PIN", () => {});
  const pad = ui.windows[0];
  assert.deepStrictEqual(words(shownBy(pad)), ["Your own PIN", "_", "_", "_", "_", "_", "_"]);
  pinKey("4").onPress();
  pinKey("2").onPress();
  assert.deepStrictEqual(words(shownBy(pad)).slice(1), ["4", "2", "_", "_", "_", "_"]);
  pad.close();
});

// Timers: a controllable setTimeout / setInterval for one test
const fakeTimers = () => {
  const real = [ctx.setTimeout, ctx.clearTimeout, ctx.setInterval];
  const f = { timeouts: [], cleared: [], intervals: [] };
  ctx.setTimeout = (fn, ms) => f.timeouts.push({ fn, ms });
  ctx.clearTimeout = (id) => f.cleared.push(id);
  ctx.setInterval = (fn, ms) => f.intervals.push({ fn, ms });
  f.restore = () => ([ctx.setTimeout, ctx.clearTimeout, ctx.setInterval] = real);
  return f;
};
test("Remote Control panel: a shown PIN hides itself after 30 s; hiding it earlier stops that clock", () => {
  reset();
  settings();
  const pair = settingsPage().pair;
  const f = fakeTimers();
  try {
    pair.revealPin(true);
    const timer = f.timeouts.at(-1);
    assert.strictEqual(timer.ms, 30000);
    timer.fn();
    assert.strictEqual(pair.shown, false);
    pair.revealPin(true);
    const id = f.timeouts.length;
    pair.revealPin(false);
    assert.strictEqual(f.cleared.at(-1), id, "the 30 s clock stopped");
  } finally {
    f.restore();
  }
});
test("Mod page: the Network and Remote status every 3 s, only while one of them is on screen", () => {
  reset();
  settings();
  const f = fakeTimers();
  let pg;
  try {
    pg = settingsPage();
  } finally {
    f.restore();
  }
  const poll = f.intervals[0];
  assert.strictEqual(poll.ms, 3000);
  for (const [tab, asks] of [[0, false], [1, false], [2, true], [3, true], [4, false]]) {
    pg.tabs[tab].onToggleON();
    ui.cmds.length = 0;
    poll.fn();
    assert.deepStrictEqual(ui.cmds, asks ? [["DLZMOD_NET", { op: "status" }]] : [], "tab " + tab);
  }
  pg.tabs[2].onToggleON();
  pg.visible = false;
  ui.cmds.length = 0;
  poll.fn();
  assert.deepStrictEqual(ui.cmds, [], "another Settings page or screen: nothing");
});

// Small ones
test("Network: Keep on after a restart, on and off, behind the spinner", () => {
  reset();
  settings();
  const ssh = settingsPage().network.ssh;
  try {
    for (const [press, on, text] of [["onToggleON", true, "Keeping SSH on…"], ["onToggleOFF", false, "SSH turns off at the next start…"]]) {
      ssh.keepOn[press]();
      assert.strictEqual(ui.progress.at(-1).text, text);
      assert.deepStrictEqual(ui.cmds.at(-1), ["DLZMOD_NET", { op: "sshKeep", on }]);
      ctx.DLZMOD_netIdle();
    }
  } finally {
    ctx.DLZMOD_netIdle();
  }
});
test("meters: a horizontal strip meter gets the same zones and ticks, along its width", () => {
  settings({ "dlzmod.meterMarks": 1 });
  const t = { fills: [], fillStyle: null, fillRect(x, y, w) {
    this.fills.push([this.fillStyle, x, x + w]);
  } };
  ctx.DLZMOD_vuPaint(stripMeter({ horizontal: true, w: 100, h: 6 }), t, 95, 100);
  assert.deepStrictEqual(zones(t), [["#ffff00", 75, 90], ["#ff0000", 90, 95]]);
  assert.deepStrictEqual(ticks(t), [92, 85, 77, 70, 55, 40]);
});
test("update popups: a new status repaints the Mod tab only while the page is on screen; the Install button follows anyway", () => {
  reset();
  settings();
  const pg = settingsPage();
  ctx.app = { pageSettings: { dlzmod: pg } };
  try {
    let n = pg.about.updates;
    ctx.DLZMOD_setUpdateStatus({ installed: "v0.1.0" });
    assert.strictEqual(pg.about.updates, n + 1);
    pg.visible = false;
    n = pg.about.updates;
    ctx.DLZMOD_setUpdateStatus({ pending: { sum: "abc", version: "v0.2.0" }, local: true });
    assert.strictEqual(pg.about.updates, n, "not on screen: no repaint");
    assert.strictEqual(pg.about.install.visible, true, "the button is ready when the page comes back");
  } finally {
    ctx.app = undefined;
    ctx.DLZMOD_setUpdateStatus(null);
  }
});

// #21: themes and the owner's colours. Applied as at a start (startGUI, patched), then Mackie's
// palette, the functions the theme wraps and the mod's theme state put back for the other tests.
const MACKIE = { main: "#9CCC56", green: "#9CCC56", yellow: "#ffc909", red: "#ee3524", white: "#f9f9f9",
  black: "#000000", bg: "#000000", text: "#c2c2c2", buttonBg: "#303030", vuBg: "#393939", transparent: "transparent",
  purple: "#854d9e", orange: "#f9a42b", blue: "#64cbe5",
  channel: [null, "#ea1a5b", "#ffcc00"], vuGrad: [[0, "#9CCC56"], [0.85, "#ffc909"], [0.95, "#ee3524"]] };
const withTheme = (sel, fn) => {
  const keep = { Color: ctx.Color, Util: ctx.Util, set: ctx.Data.set, app: ctx.app }, f = ctx.DLZMOD_applyTheme;
  ctx.Color = JSON.parse(JSON.stringify(MACKIE));
  ctx.Util = Object.assign({}, keep.Util);
  ctx.app = { updates: 0, update() {
    this.updates++;
  } };
  settings({ "dlzmod.theme": sel[0], "dlzmod.bgColor": sel[1], "dlzmod.faderColor": sel[2] });
  const done = () => {
    Object.assign(ctx, { Color: keep.Color, Util: keep.Util, app: keep.app });
    ctx.Data.set = keep.set;
    for (const k of ["stock", "look", "id", "slots", "back", "accent", "ovBg", "taken", "slotOf", "sums"]) delete f[k];
    ctx.DLZMOD_drawColor.map = null;
    ctx.DLZMOD_outline.colors = null;
  };
  let r;
  try {
    ctx.DLZMOD_applyTheme();
    r = fn(ctx.Color);
  } catch (e) {
    done();
    throw e;
  }
  if (r && r.then) return r.finally(done);
  done();
  return r;
};
const draw = (v, prop = "fillStyle") => ctx.DLZMOD_drawColor(prop, v);
const look = (sel) => {
  Object.assign(ctx.Data.data, { "dlzmod.theme": sel[0], "dlzmod.bgColor": sel[1], "dlzmod.faderColor": sel[2] });
  ctx.DLZMOD_themeChanged();
};
const button = (o) => Object.assign({ colors: ["#303030", "x"], bodyStyle: "custom", border: 0 }, o);
test("theme: Mackie's look draws every palette colour as Mackie's; no outline; the lists stay Mackie's", () => {
  reset();
  withTheme([0, 0, 0], (c) => {
    for (const k of ["main", "green", "yellow", "red", "white", "bg", "text", "buttonBg", "vuBg"]) {
      assert.notStrictEqual(c[k], MACKIE[k], k + ": a value of its own");
      assert.strictEqual(draw(c[k]), MACKIE[k], k + ": drawn as Mackie's");
    }
    assert.deepStrictEqual([draw(c.main50), draw(ctx.DLZMOD_accent()), draw(ctx.DLZMOD_ovColor("bg", "x"))],
      ["#9CCC56@0.5", ctx.DLZMOD_yellow(), "#000000"], "the derived ones, the Mod page's yellow, the Overview");
    assert.deepStrictEqual(plain(c.channel), MACKIE.channel);
    assert.deepStrictEqual(plain(c.vuGrad), MACKIE.vuGrad);
    assert.deepStrictEqual([c.black, c.transparent, c.purple], [MACKIE.black, "transparent", MACKIE.purple],
      "what no look changes as it is");
    assert.strictEqual(draw("#888888"), "#888888");
    const b = button();
    ctx.DLZMOD_outline(b);
    assert.strictEqual(b.border, 0, "no outline");
  });
});
test("theme: each palette value is its own, never one of Mackie's or a colour a theme swaps in the code", () => {
  reset();
  withTheme([0, 0, 0], (c) => {
    const f = ctx.DLZMOD_applyTheme, values = f.slots.map((s) => s[0]);
    assert.strictEqual(new Set(values).size, values.length);
    const mackie = new Set(JSON.stringify(MACKIE).toLowerCase().match(/#[0-9a-f]{6}/g));
    const literals = new Set(ctx.DLZMOD_allLooks().flatMap((l) => Object.keys(l.literals)).map((k) => k.toLowerCase()));
    for (const v of values) assert.ok(!mackie.has(v) && !literals.has(v), v);
    assert.ok(Object.keys(f.back).concat(f.accent, f.ovBg).every((v) => /^#[0-9a-f]{6}$/.test(v)), "#rrggbb, as Mackie's");
  });
});
test("theme: High contrast draws the palette it names, the grey colours written into the code, outlined buttons", () => {
  reset();
  withTheme([1, 0, 0], (c) => {
    assert.deepStrictEqual([draw(c.text), draw(c.white), draw(c.buttonBg), draw(c.main50), draw(c.red)],
      ["#ffffff", "#ffffff", "#3a3a3a", "#ffcc00@0.5", "#ff4a3d"]);
    assert.deepStrictEqual([draw("#888888"), draw("#AAAAAA"), draw("#888888", "strokeStyle")], ["#ffffff", "#ffffff",
      "#ffffff"], "Mackie's grey text white, also in capitals and for lines");
    assert.deepStrictEqual([draw("#cccccc"), draw("#123456"), draw("#888888", "font"), draw(7)], ["#cccccc", "#123456",
      "#888888", 7], "the FX panels, other colours and other properties as they are");
    assert.deepStrictEqual(plain(c.vuGrad).map((s) => s[1]), ["#a6f04d", "#a6f04d", "#a6f04d", "#ffde2e", "#ffde2e",
      "#ff4a3d"], "the meters' stops are the theme's");
    const b = button();
    ctx.DLZMOD_outline(b);
    assert.deepStrictEqual([b.border, plain(b.borderColors)], [2, ["#b0b0b0", "#ffcc00"]]);
    for (const other of [button({ border: 1 }), button({ colors: ["transparent", "x"] }), button({ img0: {} }),
      button({ bodyStyle: "matc" })]) {
      const before = JSON.stringify(other);
      ctx.DLZMOD_outline(other);
      assert.strictEqual(JSON.stringify(other), before, "own border, no body, an image, Mackie's other styles: as is");
    }
  });
});
test("theme: an own background and colour on top of the theme; warnings at the top of the meters stay", () => {
  reset();
  withTheme([1, 1, 5], (c) => {
    assert.strictEqual(draw(c.bg), "#061514", "Tinted: a dark shade of High contrast's teal");
    assert.strictEqual(draw("#1a1a1a"), "#061514", "the stereo strips' own panels too");
    assert.deepStrictEqual([draw(c.green), draw(c.main)], ["#40d6c8", "#40d6c8"], "Teal, High contrast's lighter one");
    assert.deepStrictEqual(plain(c.vuGrad).map((s) => s[1]), ["#40d6c8", "#40d6c8", "#40d6c8", "#ffde2e", "#ffde2e",
      "#ff4a3d"]);
    assert.deepStrictEqual([draw(ctx.DLZMOD_ovColor("bg", "x")), draw(ctx.DLZMOD_knobColor(c.white)),
      ctx.DLZMOD_knobColor(undefined), ctx.DLZMOD_knobColor("#ea1a5b")], ["#061514", "#40d6c8", "#40d6c8", "#ea1a5b"],
    "an aux's own knob colour stays");
    assert.strictEqual(draw(ctx.DLZMOD_accent()), "#40d6c8", "the Mod page's switches and tabs");
    assert.strictEqual(ctx.DLZMOD_preColor(), "#40d6c8", "the before-fader bar");
    assert.deepStrictEqual([draw(c.buttonBg), draw(c.vuBg)], ["#2b4341", "#1b3331"], "the theme's greys in the background's hue");
    assert.strictEqual(draw("#303030"), "#617977", "grey written into the code too (High contrast's track grey)");
  });
  withTheme([0, 9, 0], (c) => {
    assert.deepStrictEqual([draw(c.bg), draw(c.buttonBg), draw(c.vuBg)], [MACKIE.bg, MACKIE.buttonBg, MACKIE.vuBg],
      "a background the list does not have: the theme's");
    assert.strictEqual(draw("#303030"), "#303030");
  });
});
test("theme: Tinted is a dark shade of the colour, the greys on it in its hue", () => {
  reset();
  withTheme([0, 1, 5], (c) => {
    assert.deepStrictEqual([draw(c.bg), draw(c.buttonBg), draw("#303030")], ["#031311", "#203a36", "#203a36"]);
  });
  withTheme([0, 1, 0], (c) => assert.strictEqual(draw(c.bg), "#101409", "no own colour: the theme's (Mackie's green)"));
  withTheme([0, 0, 5], (c) => assert.strictEqual(draw(c.green), "#21baac", "with Mackie: Mackie's own teal"));
});
test("theme: Red like every colour, meters included; the warning stops at the top stay Mackie's", () => {
  reset();
  withTheme([0, 0, 4], (c) => {
    assert.deepStrictEqual([draw(c.main), draw(c.green), draw(ctx.DLZMOD_accent()), ctx.DLZMOD_preColor()],
      ["#e0533f", "#e0533f", "#e0533f", "#e0533f"]);
    assert.deepStrictEqual(plain(c.vuGrad), [[0, "#e0533f"], [0.85, "#ffc909"], [0.95, "#ee3524"]]);
  });
  settings({ "dlzmod.faderColor": 4 });
  assert.strictEqual(settingsPage().meters.preColor.items[0][0], "Red", "the meters panel names it");
});
test("theme: Yellow (Mackie's own warning yellow) still gets the meters' yellow zone", () => {
  reset();
  withTheme([0, 0, 2], (c) => {
    ctx.Data.data["dlzmod.meterMarks"] = 1;
    const t = canvas();
    ctx.DLZMOD_vuPaint(stripMeter(), t, 96, 100);
    assert.deepStrictEqual(zones(t), [["#ffc909", 85, 95], ["#ee3524", 95, 96]]);
  });
});
test("theme: a colour Mackie sums from the palette when a page is built follows a change", () => {
  reset();
  withTheme([0, 0, 0], (c) => {
    const v = ctx.Util.hex2rgba(c.red, 0.42);
    assert.strictEqual(draw(v), "#ee3524@0.42");
    look([1, 0, 0]);
    assert.strictEqual(draw(v), "#ff4a3d@0.42", "after the change, without a new sum");
    assert.strictEqual(ctx.Util.hex2rgba(c.red, 0.42), v, "the same sum, the same value");
    assert.strictEqual(ctx.Util.hex2rgba("#123456", 0.5), "#123456@0.5", "other colours as they are");
    ui.sets.length = 0;
    ctx.Data.set("K.0.color", v);
    assert.deepStrictEqual(plain(ui.sets), [["K.0.color", "#ee3524@0.42"]], "to the knob rings as Mackie's");
  });
});
test("theme: the knob rings get Mackie's colours, whatever the look", () => {
  reset();
  withTheme([1, 0, 2], (c) => {
    ui.sets.length = 0;
    for (const [k, v] of [["K.0.color", c.main], ["K.1.color", c.yellow], ["K.2.color", "#ea1a5b"], ["x.color", c.main]]) {
      ctx.Data.set(k, v);
    }
    assert.deepStrictEqual(plain(ui.sets), [["K.0.color", "#9CCC56"], ["K.1.color", "#ffc909"], ["K.2.color", "#ea1a5b"],
      ["x.color", c.main]], "an aux keeps its own; other keys as they are");
  });
});
test("theme: a change shows at once on the whole screen, back and forth, without a restart", () => {
  reset();
  withTheme([0, 0, 0], (c) => {
    look([1, 0, 3]);
    assert.deepStrictEqual([draw(c.text), draw(c.main), draw("#888888"), draw(ctx.DLZMOD_accent())],
      ["#ffffff", "#ffb84d", "#ffffff", "#ffb84d"]);
    assert.strictEqual(ctx.app.updates, 1, "the screen repainted");
    const b = button();
    ctx.DLZMOD_outline(b);
    assert.strictEqual(b.border, 2);
    look([0, 0, 0]);
    assert.deepStrictEqual([draw(c.text), draw(c.main), draw("#888888")], [MACKIE.text, MACKIE.main, "#888888"]);
    assert.deepStrictEqual(plain(c.vuGrad), MACKIE.vuGrad, "the meters' stops back too");
    ctx.DLZMOD_outline(b);
    assert.deepStrictEqual([b.border, b.borderColors, b.dlzmodOutline], [0, undefined, null], "the outline taken off");
  });
  settings({ "dlzmod.theme": 1 });
  ctx.DLZMOD_themeChanged();
  assert.strictEqual(ctx.DLZMOD_drawColor.map, null, "before a start set a look: nothing");
});
test("theme: a theme that fails leaves Mackie's look, untouched", () => {
  reset();
  const util = ctx.Util;
  ctx.Util = {};   // hex2rgba missing: the palette's values fail halfway
  try {
    withTheme([1, 1, 2], (c) => {
      assert.deepStrictEqual(plain(c), MACKIE);
      assert.strictEqual(draw("#888888"), "#888888");
      look([1, 0, 0]);
      assert.strictEqual(draw("#888888"), "#888888", "and a change does nothing");
    });
  } finally {
    ctx.Util = util;
  }
  withTheme([0, 0, 0], (c) => {
    const themes = ctx.DLZMOD_themes;
    ctx.DLZMOD_themes = () => null;   // a look that fails after the start: Mackie's
    try {
      look([1, 0, 0]);
      assert.deepStrictEqual([draw(c.text), draw("#888888"), ctx.DLZMOD_outline.colors], [MACKIE.text, "#888888", null]);
    } finally {
      ctx.DLZMOD_themes = themes;
    }
  });
});
test("Colors tab: a tap saves that choice at once; the marks follow any change; a browser cannot pick", () => {
  reset();
  settings();
  const pg = settingsPage().colours;
  pg.faderBtns[3].onPress();
  assert.deepStrictEqual(plain(ui.sets), [["dlzmod.faderColor", 3]]);
  pg.faderBtns[3].onPress();
  assert.strictEqual(ui.sets.length, 1, "the same again: nothing");
  regs["dlzmod.faderColor"].forEach((cb) => cb());
  assert.deepStrictEqual([pg.faderBtns[3].chosen, pg.faderBtns[3].border, pg.faderBtns[0].chosen], [true, 5, false]);
  ctx.Data.data["dlzmod.theme"] = 1;   // from the other side
  regs["dlzmod.theme"].forEach((cb) => cb());
  assert.deepStrictEqual([pg.themeBtns[1].borderColors[0], pg.themeBtns[0].borderColors[0]], ["#ffffff", "#5a5a5a"]);
  assert.strictEqual(pg.apply, undefined, "no Apply");
  ctx.EXTERNAL = true;
  try {
    settings();
    ui.sets.length = 0;
    const web = settingsPage().colours;
    web.faderBtns[3].onPress();
    assert.deepStrictEqual(ui.sets, [], "a browser cannot pick");
  } finally {
    ctx.EXTERNAL = false;
  }
});
test("Meters panel: the before-fader colour is named after the own colour, also after a change", () => {
  reset();
  settings({ "dlzmod.faderColor": 5 });
  const m = settingsPage().meters;
  assert.strictEqual(m.preColor.items[0][0], "Teal");
  ctx.Data.data["dlzmod.faderColor"] = 0;
  regs["dlzmod.faderColor"].forEach((cb) => cb());
  assert.deepStrictEqual(plain(m.preColor.items), ["Green", "Grey"]);
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
