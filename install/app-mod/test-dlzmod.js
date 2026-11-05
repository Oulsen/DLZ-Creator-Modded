// Tests for dlzmod.js (the app mod): node install/app-mod/test-dlzmod.js
// Loads the file in a vm context, as it runs once appended to app.js, with small stand-ins for the
// Mackie UI globals it uses (Widget and its kinds, PopupWindow, TopBar, askConfirm, showMessage, showToast,
// PopupConfirm, askInput, setKbdTitle, Data, $NET, app, Font, Color, $FA, lang, deconvertVU, VU_STRUCT,
// E_CH_TYPE, VtoMix, modVuByDb, EXTERNAL) and for the browser
// (fetch, document). What the stand-ins record is what the tests look at; what is drawn where stays
// with the UI sandbox's screenshots.
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ui = { buttons: [], popups: [], toasts: [], links: [], fetches: [], cmds: [], windows: [], progress: [],
  widgets: [], inputs: [], titles: [], destroyed: [], pickers: [], attached: [], sets: [], headerMsgs: [] };
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
  // Mackie's: a null keeps that value
  setGeometry(x, y, w, h) {
    if (x !== null) this.x = x;
    if (y !== null) this.y = y;
    if (w !== null) this.w = w;
    if (h !== null) this.h = h;
  },
  // Mackie's: left and top place it (right, bottom and centring not used here)
  setAnchors(left, top) {
    this.anchors = [left, top];
    this.x = left;
    this.y = top;
  },
  // the foreground layer; as Mackie's, without a second argument the widget also joins the UI's modal
  // widgets (its parent's mWidgets here), and destroy takes it out again
  setOverlay(v, child) {
    this._overlay = v;
    const d = this.parent;
    if (!child && d && d.mWidgets && !d.mWidgets.includes(this)) d.mWidgets.push(this);
  },
  destroy() {
    this.destroyed = true;
    if (this.onDestroy) this.onDestroy();
    const m = this.parent && this.parent.mWidgets, i = m ? m.indexOf(this) : -1;
    if (i >= 0) m.splice(i, 1);
  },
});
// Mackie's header: its own showMessage puts the message in the bar (ui.headerMsgs)
function TopBar() {}
TopBar.prototype.showMessage = function (text, color, time) {
  ui.headerMsgs.push([text, color, time]);
};
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
  setTimeout, clearTimeout, setInterval: () => 0, console: { log() {}, error() {} }, atob,
  EXTERNAL: false, app: undefined,
  Widget, PopupWindow, SwitchBox, TopBar,
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
    apply(t, e, i, s) {
      ui.applied.push([t, e, i, s]);
    },
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
    red2: "red2", black: "black", bgDark: "bgDark", menuSeparator: "menuSeparator", buttonBg: "buttonBg", subNavButtonText: "subNavButtonText",
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
  ctx.DLZMOD_zonePicker.popup = null;
  ctx.DLZMOD_clockPicker.popup = null;
  ctx.DLZMOD_timeState.s = undefined;
  ctx.DLZMOD_setNetState(undefined);
  ctx.DLZMOD_setUpdateStatus(null);
  ctx.DLZMOD_uploadFiles.busy = false;
  ctx.DLZMOD_uploadPick.input = null;
  ctx.DLZMOD_messageBar.bar = null;
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
    "dlzmod.preLevel": 0, "dlzmod.meterMarks": 0, "dlzmod.theme": 0, "dlzmod.bgColor": 0, "dlzmod.faderColor": 0,
    "dlzmod.recDate": 0, "dlzmod.spectrum": 1, "dlzmod.rta": 0, "dlzmod.updateAuto": 1, "dlzmod.updateSeen": "" });
});

// #14: the date and time switch on Settings, Recording / Routing
test("recording date: a row like the panel's own, its key known before the panel is built, four rows fit", () => {
  settings({});
  assert.deepStrictEqual(Array.from(ctx.DLZMOD_recDateRow()), ["dlzmod.recDate", "Date & Time in Name", 0]);
  assert.strictEqual(ctx.Data.data["dlzmod.recDate"], 0, "Mackie's Data refuses an unknown key");
  settings({ "dlzmod.recDate": 1 });
  ctx.DLZMOD_recDateRow();
  assert.strictEqual(ctx.Data.data["dlzmod.recDate"], 1, "a saved value stays");
  // the toggle buttons above end at 109 + 50; the switches are 44 high in a 392 high panel
  assert.ok(ctx.DLZMOD_recRowY(0) > 159 + 15);
  assert.ok(ctx.DLZMOD_recRowY(3) + 44 <= 392 - 10);
  const t = { calls: [], fRect(...a) { this.calls.push(a); } };
  ctx.DLZMOD_stockMark(t, { geomCenterY: () => 334 });
  assert.deepStrictEqual(t.calls, [["#FFD600", 10, 325, 3, 18]]);
  ctx.DLZMOD_stockMark(t, undefined);
  assert.strictEqual(t.calls.length, 1, "no row: no mark");
  ctx.DLZMOD_stockMark(t, { geomCenterY: () => 104 }, 18);
  assert.deepStrictEqual(t.calls[1], ["#FFD600", 18, 95, 3, 18], "another x (the EQ page's box)");
});

// #193: the player's title line
test("player: recordings without dspserver's artist, other files unchanged", () => {
  assert.strictEqual(ctx.DLZMOD_trackName("DLZ|Creator - REC_0005_wombat_2026-10-28_2013"), "REC_0005_wombat_2026-10-28_2013");
  assert.strictEqual(ctx.DLZMOD_trackName("Some Band - Some Song"), "Some Band - Some Song");
  assert.strictEqual(ctx.DLZMOD_trackName("Track 1"), "Track 1");
  assert.strictEqual(ctx.DLZMOD_trackName(""), "");
  assert.strictEqual(ctx.DLZMOD_trackName(undefined), undefined);
  assert.strictEqual(ctx.DLZMOD_trackName(42), 42, "not a string: as stock, never a throw in the paint");
  assert.strictEqual(ctx.DLZMOD_trackName("Live - DLZ|Creator - Jam"), "Live - DLZ|Creator - Jam", "only in front");
  assert.strictEqual(ctx.DLZMOD_trackName("dlz|creator - Jam"), "dlz|creator - Jam", "only dspserver's exact artist");
});

// #58: Mackie's messages (showToast) while the header is hidden. o.shown: the header shown, o.nav false:
// a full-screen page (no tab bar)
// a full-screen page (no tab bar). closeModals as Mackie's (app.setPage and Escape run it): a forEach
// that destroys, so a widget after a destroyed one is skipped
const msgApp = (o = {}) => {
  const nav = new Widget(null, { w: 950, h: 66, globalX: () => 0, globalY: () => 0, visible: o.nav !== false });
  const top = Object.assign(new TopBar(), { visible: !!o.shown, h: 30, bgColor: "black",
    setVisible(v) {
      this.visible = v;
    } });
  return { navBar: nav, topBar: top, mWidgets: [], fg: 0, drawAllFg() {
    this.fg++;
  }, closeModals() {
    this.mWidgets.forEach((w) => w.autoCloseModal !== false && w.destroy());
  }, updateGeometry() {}, update() {} };
};
const barTexts = (bar) => {
  const texts = [];
  Object.assign(bar, { w: 950, h: 30 });   // as Mackie's Widget takes its size
  bar.paint({ fillRect() {}, fRect() {}, drawText: (...x) => texts.push(x) });
  return plain(texts);
};
test("header hidden: a message shows in a bar over the tab bar for its time; a new one takes its place", async () => {
  reset();
  settings({ "dlzmod.hideHeader": 1 });
  ctx.DLZMOD_hookMessages();
  ctx.DLZMOD_hookMessages();   // once, however often the page is built
  const a = msgApp();
  ctx.app = a;
  try {
    a.topBar.showMessage("Saved: Show 1", undefined, 30);
    assert.deepStrictEqual(plain(ui.headerMsgs), [["Saved: Show 1", "main", 30]], "the header keeps it too, once");
    const bar = ctx.DLZMOD_messageBar.bar;
    assert.ok(bar._overlay && bar.ignoreEvents, "on the foreground layer; a tap goes to the tab below");
    assert.deepStrictEqual(a.mWidgets, [], "not a modal widget");
    assert.ok(bar.updates > 0, "drawn at once");
    assert.deepStrictEqual(plain([bar.anchors, bar.size]), [[0, 0], [950, 30]], "the tab bar's width, the header's height");
    assert.deepStrictEqual(barTexts(bar), [["Saved: Show 1", 475, 16,
      { color: "main", font: "600 13pt", align: "center", valign: "middle" }]]);
    a.topBar.showMessage("Loaded: Show 2", "red", 30);
    const second = ctx.DLZMOD_messageBar.bar;
    assert.ok(bar.destroyed && second !== bar, "replaced");
    await tick(60);
    assert.ok(second.destroyed && ctx.DLZMOD_messageBar.bar === null, "gone after its time");
    assert.strictEqual(a.navBar.updates, 2, "the tab bar draws again after each (the device keeps a closed overlay drawn)");
    assert.strictEqual(a.fg, 0);
    const popup = new Widget(a, {});
    popup.setOverlay(true);
    a.topBar.showMessage("Renamed", undefined, 5);
    await tick(30);
    assert.strictEqual(a.fg, 1, "an open popup draws again too");
  } finally {
    ctx.app = undefined;
  }
});
test("message bar: stays through a page switch, which still closes a popup; gone with the header or a full-screen page", async () => {
  reset();
  settings({ "dlzmod.hideHeader": 1 });
  ctx.DLZMOD_hookMessages();
  const a = msgApp();
  ctx.app = a;
  try {
    // a snapshot load: "Loaded: ..." and at once app.setPage, which first closes the modal widgets
    const popup = new Widget(a, {});
    popup.setOverlay(true);
    a.topBar.showMessage("Loaded: Show 1", undefined, 1000);
    const bar = ctx.DLZMOD_messageBar.bar;
    a.closeModals();
    assert.ok(popup.destroyed, "the popup closed, as in stock");
    assert.ok(!bar.destroyed && ctx.DLZMOD_messageBar.bar === bar, "the message still shows");
    a.navBar.visible = false;   // a full-screen page: drawn without the bar
    assert.deepStrictEqual(barTexts(bar), []);
    a.navBar.visible = true;
    ctx.DLZMOD_applyHeader();   // Hide header changed (also from a browser): its place moves
    assert.ok(bar.destroyed && ctx.DLZMOD_messageBar.bar === null);
    const before = bar.updates;
    a.topBar.showMessage("Saved: Show 1", undefined, 1000);
    const again = ctx.DLZMOD_messageBar.bar;
    ctx.DLZMOD_repaintSoon();   // a popup closed: the cleared foreground layer took the bar along
    await tick(10);
    assert.ok(again.updates >= 2 && bar.updates === before, "drawn again");
    again.destroy();
    await tick(10);
  } finally {
    ctx.app = undefined;
  }
});
test("header shown, or a full-screen page: the message stays Mackie's, no bar", () => {
  for (const [hide, o] of [[0, { shown: true }], [1, { nav: false }]]) {
    reset();
    settings({ "dlzmod.hideHeader": hide });
    ctx.DLZMOD_hookMessages();
    const a = msgApp(o);
    ctx.app = a;
    try {
      a.topBar.showMessage("Deleted: Show 1");
      assert.strictEqual(ui.headerMsgs.length, 1, JSON.stringify(o));
      assert.strictEqual(ctx.DLZMOD_messageBar.bar, null, JSON.stringify(o));
    } finally {
      ctx.app = undefined;
    }
  }
});

// The Mod page (Settings, DLZ Creator Modded): its tabs and what they show
const settingsPage = () => ctx.DLZMOD_settingsPage({}, 0);
test("Mod page: Display, Colors, Time, Network, Remote and Mod on the mixer; Display, Colors, Time and Mod in a browser", () => {
  reset();
  settings();
  assert.deepStrictEqual(plain(settingsPage().tabs.map((t) => t.text)),
    ["Display", "Colors", "Time", "Network", "Remote", "Mod"]);
  ctx.EXTERNAL = true;
  try {
    const web = settingsPage();
    assert.deepStrictEqual(plain(web.tabs.map((t) => t.text)), ["Display", "Colors", "Time", "Mod"]);
    web.tabs[3].onToggleON();
    assert.strictEqual(web.sub, 5, "its fourth tab is Mod");
    assert.deepStrictEqual(plain(web.tabs.map((t) => t.getVal())), [false, false, false, true]);
  } finally {
    ctx.EXTERNAL = false;
  }
});
test("Mod page: a tab shows its own panels; Time, Network, Remote and Mod ask for the status; leaving Remote hides the PIN", () => {
  reset();
  settings();
  const pg = settingsPage();
  const shown = () => ["screen", "meters", "colours", "time", "network", "pair", "about"].filter((k) => pg[k].visible);
  assert.deepStrictEqual(shown(), ["screen", "meters"], "Display first");
  assert.deepStrictEqual(ui.cmds, []);
  const net = [["DLZMOD_NET", { op: "status" }]], time = [["DLZMOD_TIME", { op: "status" }]];
  const rel = [["DLZMOD_RELEASE", { op: "status" }]];
  for (const [i, panels, asks] of [[1, ["colours"], []], [2, ["time"], time], [3, ["network"], net], [4, ["pair"], net],
    [5, ["about"], rel], [0, ["screen", "meters"], []]]) {
    ui.cmds.length = 0;
    pg.tabs[i].onToggleON();
    assert.deepStrictEqual(shown(), panels, "tab " + i);
    assert.deepStrictEqual(ui.cmds, asks, "tab " + i);
  }
  pg.tabs[4].onToggleON();
  pg.pair.revealPin(true);
  pg.tabs[5].onToggleON();
  assert.strictEqual(pg.pair.shown, false, "leaving Remote: the PIN hidden again");
  pg.pair.revealPin(true);
  ui.cmds.length = 0;
  pg.onShow();
  assert.strictEqual(pg.pair.shown, false, "coming back to the page: hidden");
  assert.deepStrictEqual(ui.cmds, [["DLZMOD_NET", { op: "status" }], ["DLZMOD_TIME", { op: "status" }],
    ["DLZMOD_RELEASE", { op: "status" }]]);
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
    pg.tabs[4].onToggleON();
    ctx.DLZMOD_netResult({ ok: true, quiet: true, text: "PIN set" });
    assert.deepStrictEqual(ui.popups, []);
    assert.strictEqual(pg.pair.shown, true, "the new PIN shown");
    ctx.DLZMOD_netResult({ ok: false, quiet: true, text: "Too easy to guess" });
    assert.deepStrictEqual([ui.popups[0].text, ui.popups[0].opts.textColor], ["Too easy to guess", "red2"]);
    pg.tabs[5].onToggleON();
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
  assert.strictEqual(ok.opts.buttons, undefined, "no notes stamped in (an unpatched copy): Mackie's one OK");
  assert.strictEqual(ctx.DLZMOD_versionNotes(), "");
});
test("update popups: after an update, What's New shows the notes the app was stamped with (#224)", () => {
  reset();
  const version = ctx.DLZMOD_version, notes = ctx.DLZMOD_versionNotes;
  ctx.DLZMOD_version = () => "v0.5.0";
  ctx.DLZMOD_versionNotes = () => "Mod features\n• See what changed after an update";
  try {
    ctx.DLZMOD_showUpdateNote({ ok: true, version: "v0.5.0 (dev-fa646fa)" });
    ctx.DLZMOD_showUpdateNote({ ok: true, version: "v0.4.0" });
    ctx.DLZMOD_showUpdateNote({ ok: false, report: "update-report.txt" });
    const [ok, other, bad] = ui.popups;
    assert.deepStrictEqual(plain(ok.opts.buttons.map((b) => b.text)), ["check", "What's New"]);
    assert.strictEqual(ok.opts.buttons[0].onPress, undefined, "OK stays Mackie's: it calls func");
    assert.strictEqual(other.opts.buttons, undefined, "another version than the app's: no notes of its own");
    assert.strictEqual(bad.opts.buttons, undefined, "not installed: nothing new");
    const fake = { parent: { destroy() {
      this.gone = true;
    } } };
    ok.opts.buttons[1].onPress.call(fake);
    assert.ok(fake.parent.gone);
    assert.deepStrictEqual(ui.cmds, [["DLZMOD_UPDATE_NOTE_OK", undefined]], "What's New counts as seen too");
    const w = ui.windows.at(-1);
    const lines = [];
    w.paint({ drawText: (s) => lines.push(s), measureText: (s) => ({ width: s.length }) });
    assert.ok(lines.includes("What's New in v0.5.0 (dev-fa646fa)"), lines.join("|"));
    assert.ok(lines.includes("• See what changed after an update"), lines.join("|"));
    assert.ok(!ui.buttons.some((b) => b.parent === w && b.text === "Download" && b.visible !== false), "no Download here");
    w.close();
  } finally {
    ctx.DLZMOD_version = version;
    ctx.DLZMOD_versionNotes = notes;
  }
});
test("Mod page: What's New next to the version opens the installed version's notes; none stamped in: no button", () => {
  const notes = ctx.DLZMOD_versionNotes;
  try {
    let pg = relPage();
    assert.strictEqual(pg.about.notes.visible, false, "an unpatched copy has no notes");
    relDone();
    ctx.DLZMOD_versionNotes = () => "Mod features\n• See what changed after an update";
    pg = relPage();
    assert.notStrictEqual(pg.about.notes.visible, false);
    pg.about.notes.onPress();
    const w = ui.windows.at(-1), lines = [];
    w.paint({ drawText: (s) => lines.push(s), measureText: (s) => ({ width: s.length }) });
    assert.ok(lines.includes("• See what changed after an update"), lines.join("|"));
    assert.ok(lines.some((l) => l.startsWith("What's New in ")), lines.join("|"));
    w.close();
  } finally {
    ctx.DLZMOD_versionNotes = notes;
    relDone();
  }
});
test("notes pages: on the mixer lines are wrapped by length, as Mackie's popups do; in a browser by width", () => {
  const text = "Mod bugs fixed\n• After a restart of the mixer software, the date can drop out of recording names" +
    " and this goes on a bit";
  const useless = { measureText: () => ({ width: 1e9 }) };   // what one word per line on the mixer looked like
  ctx.$ENV = { isNode: true };
  try {
    const lines = ctx.DLZMOD_wrap(useless, text, "500 13pt", 836);
    assert.deepStrictEqual(plain(lines), ["Mod bugs fixed",
      "• After a restart of the mixer software, the date can drop out of recording names",
      "and this goes on a bit"]);
    assert.ok(lines.every((l) => l.length <= 83), "836 px: at most 83 characters a line");
  } finally {
    delete ctx.$ENV;
  }
  const byWidth = ctx.DLZMOD_wrap({ measureText: (s) => ({ width: s.length * 20 }) }, "aa bb cc", "f", 100);
  assert.deepStrictEqual(plain(byWidth), ["aa bb", "cc"]);
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

// #55: Check for Updates / Download Update (dlzmod-server.js, DLZMOD_release)
const REL = { state: "newer", installed: "v0.5.0", version: "v0.5.1", size: 1200000, summary: "Recordings are merged.",
  notes: "Recordings are merged.\n\n• one", error: "" };
const relPage = (o = {}) => {
  reset();
  settings(o.data || {});
  ctx.EXTERNAL = !!o.external;
  ctx.DLZMOD_setRelease.s = undefined;
  ctx.DLZMOD_setRelease.asked = "";
  ctx.DLZMOD_dot.all = [];
  const pg = settingsPage();
  ctx.app = { pageSettings: { dlzmod: pg } };
  return pg;
};
const relDone = () => {
  ctx.app = undefined;
  ctx.EXTERNAL = false;
  ctx.DLZMOD_setRelease.s = undefined;
  ctx.DLZMOD_setRelease.asked = "";
  ctx.DLZMOD_dot.all = [];
  ctx.DLZMOD_setUpdateStatus(null);
};
test("release: the Updates row and the left button follow what the check found", () => {
  const pg = relPage();
  try {
    const COPY = "Copy the update's .tar and .sig to DLZDATA/dlzmod-update";
    for (const [s, text, color, button] of [
      [{}, COPY, null, "Check for Updates..."],
      [{ state: "checking" }, "Looking for a new version on GitHub...", null, "Check for Updates..."],
      [REL, "v0.5.1 is available (1.2 MB)", "#FFD600", "Download Update..."],
      [Object.assign({}, REL, { state: "downloading" }), "Downloading v0.5.1...", "#FFD600", "Check for Updates..."],
      [Object.assign({}, REL, { state: "full" }), "v0.5.1 is out: it needs a full install with the installer image", "#FFD600",
        "Check for Updates..."],
      [{ state: "current", version: "v0.5.0" }, "Up to date: v0.5.0 is the latest release", null, "Check for Updates..."],
      [{ state: "error", error: "No answer from GitHub. Is the mixer online?" }, "No answer from GitHub. Is the mixer online?", "red2",
        "Check for Updates..."],
    ]) {
      ctx.DLZMOD_setRelease(s);
      assert.deepStrictEqual(plain(ctx.DLZMOD_updateRow()), [text, color], JSON.stringify(s));
      assert.strictEqual(pg.about.check.text, button, JSON.stringify(s));
    }
    // an update already on the card comes first, and Download gives way to it
    ctx.DLZMOD_setRelease(REL);
    ctx.DLZMOD_setUpdateStatus({ pending: { sum: "abc", version: "v0.5.1" }, local: true });
    assert.deepStrictEqual(plain(ctx.DLZMOD_updateRow()), ["Update v0.5.1 is on the card", "#FFD600"]);
    assert.strictEqual(pg.about.check.text, "Check for Updates...");
    // the buttons shown side by side in the middle: Check and Install here
    assert.deepStrictEqual([pg.about.check.x, pg.about.install.x], [(914 - 616) / 2 | 0, ((914 - 616) / 2 | 0) + 316]);
    ctx.DLZMOD_setUpdateStatus({});
    // no update waiting: Check and From USB Stick (#220)
    assert.deepStrictEqual([pg.about.check.x, pg.about.usb.x, pg.about.install.visible],
      [(914 - 616) / 2 | 0, ((914 - 616) / 2 | 0) + 316, false]);
    assert.ok(pg.about.auto, "the switch for the check by itself");
    assert.strictEqual(pg.about.auto.key, "dlzmod.updateAuto");
  } finally {
    relDone();
  }
});
test("release: Check asks the server; its answer: the question, a message or a short note", () => {
  const pg = relPage();
  try {
    pg.about.check.onPress();
    assert.deepStrictEqual(ui.cmds.at(-1), ["DLZMOD_RELEASE", { op: "check" }]);
    ctx.DLZMOD_setRelease({ state: "checking" });
    assert.strictEqual(ui.popups.length, 0, "nothing while it checks");
    ctx.DLZMOD_setRelease(REL);
    assert.strictEqual(ui.popups.length, 1, "a new version: Download's question");
    const q = ui.popups[0];
    assert.strictEqual(q.opts.title, "DLZ Creator Modded update");
    assert.deepStrictEqual(plain(q.opts.buttons.map((b) => b.text)), ["Download", "What's New", "Later"]);
    // Download on the question
    const fake = { parent: { destroy() {
      this.gone = true;
    } } };
    q.opts.buttons[0].onPress.call(fake);
    assert.ok(fake.parent.gone);
    assert.deepStrictEqual(ui.cmds.at(-1), ["DLZMOD_RELEASE", { op: "download" }]);
    ctx.DLZMOD_setRelease(Object.assign({}, REL, { state: "downloading" }));
    ctx.DLZMOD_setRelease(Object.assign({}, REL, { state: "done" }));
    assert.strictEqual(ui.popups.length, 1, "on the mixer's screen the server asks Install itself");
    // the button on a found version opens the question without a new check
    ctx.DLZMOD_setRelease(REL);
    ui.cmds.length = 0;
    pg.about.check.onPress();
    assert.strictEqual(ui.popups.length, 2);
    assert.deepStrictEqual(ui.cmds, []);
    // other answers to a check
    for (const [s, kind, text] of [
      [{ state: "current", installed: "v0.5.0", version: "v0.5.0" }, "message", "Up to date: v0.5.0\nThe latest release is v0.5.0."],
      [{ state: "current", installed: "", version: "v0.4.0" }, "message", "Up to date\nThe latest release is v0.4.0."],
      [{ state: "none" }, "message", "There is no release on GitHub yet."],
      [{ state: "error", error: "GitHub asks to wait (too many checks from this network)" }, "message",
        "GitHub asks to wait (too many checks from this network)"],
      [Object.assign({}, REL, { state: "full" }), "message",
        "v0.5.1 is out, but it needs a full install with the installer image:\nsee its release notes on GitHub."],
    ]) {
      ui.popups.length = 0;
      ui.toasts.length = 0;
      ctx.DLZMOD_setRelease({});
      ctx.DLZMOD_releaseSend("check");
      ctx.DLZMOD_setRelease(s);
      if (kind === "toast") assert.deepStrictEqual(ui.toasts, [text], JSON.stringify(s));
      else assert.deepStrictEqual(ui.popups.map((p) => p.text), [text], JSON.stringify(s));
    }
    // the check by itself (nobody asked): no popup, only the row
    ui.popups.length = 0;
    ctx.DLZMOD_setRelease(REL);
    assert.strictEqual(ui.popups.length, 0);
  } finally {
    relDone();
  }
});
test("release: a spinner while this page's check or download runs, closed by its answer", () => {
  relPage();
  try {
    ui.progress.length = 0;
    ui.popups.length = 0;
    ctx.DLZMOD_setRelease({});
    ctx.DLZMOD_releaseSend("check");
    assert.strictEqual(ui.progress.length, 1);
    assert.strictEqual(ui.progress[0].text, "Checking for updates…");
    ctx.DLZMOD_setRelease({ state: "checking" });
    assert.ok(!ui.progress[0].closed, "still checking: the spinner stays");
    ctx.DLZMOD_setRelease(REL);
    assert.ok(ui.progress[0].closed);
    assert.strictEqual(ui.popups.length, 1, "the answer: the question");
    ctx.DLZMOD_releaseSend("download");
    assert.strictEqual(ui.progress[1].text, "Downloading v0.5.1…");
    ctx.DLZMOD_setRelease(Object.assign({}, REL, { state: "done" }));
    assert.ok(ui.progress[1].closed);
  } finally {
    ctx.DLZMOD_relIdle();
    relDone();
  }
});
test("usb stick: From USB Stick... copies with a stick in, else says how; not in a browser, not while an update waits", () => {
  let pg = relPage({ data: { usb: 1 } });
  try {
    assert.ok(pg.about.usb.visible, "on the mixer's own screen");
    ui.cmds.length = 0;
    ui.progress.length = 0;
    ui.popups.length = 0;
    ctx.DLZMOD_usbPress();
    assert.deepStrictEqual(ui.cmds, [["DLZMOD_RELEASE", { op: "usb" }]]);
    assert.strictEqual(ui.progress[0].text, "Copying the update from the USB stick…");
    ctx.DLZMOD_setRelease({ state: "copying", version: "v0.5.1" });
    assert.ok(!ui.progress[0].closed, "still copying: the spinner stays");
    assert.strictEqual(ctx.DLZMOD_updateRow()[0], "Copying v0.5.1 from the USB stick...");
    ctx.DLZMOD_setRelease({ state: "done", version: "v0.5.1", error: "" });
    assert.ok(ui.progress[0].closed);
    assert.strictEqual(ui.popups.length, 0, "the Install question comes from the server");
    ctx.DLZMOD_usbPress();
    ctx.DLZMOD_setRelease({ state: "error", error: "More than one mod update on the USB stick." });
    assert.deepStrictEqual(ui.popups.map((p) => p.text), ["More than one mod update on the USB stick."]);
    // an update waiting for Install: Install in its place
    ctx.DLZMOD_setUpdateStatus({ local: true, pending: { sum: "a".repeat(64), version: "v0.5.1" } });
    assert.ok(!pg.about.usb.visible && pg.about.install.visible);
  } finally {
    ctx.DLZMOD_relIdle();
    relDone();
  }
  // no FAT stick: greyed out, nothing sent, no popup; the line under the buttons says what it needs
  for (const [usb, xs, hint] of [
    [0, true, "USB stick: FAT32, the update in a folder dlzmod-update"],
    [0, false, "USB stick: FAT32, the update in a folder dlzmod-update"],
    [2, true, "This USB stick is not FAT32: the mixer cannot read it"],
    [1, true, ""],
    [1, false, ""],
  ]) {
    const p = relPage({ data: { usb: usb } });
    if (xs) ctx.LITE_MODE = 1;
    try {
      p.about.usb.getState();
      assert.strictEqual(p.about.usb.enabled, usb === 1);
      assert.strictEqual(ctx.DLZMOD_usbHint(), hint);
      if (usb !== 1) {
        ui.cmds.length = 0;
        ui.popups.length = 0;
        ctx.DLZMOD_usbPress();
        assert.deepStrictEqual([ui.cmds, ui.popups.length], [[], 0], "nothing sent, no popup");
      }
    } finally {
      delete ctx.LITE_MODE;
      relDone();
    }
  }
  pg = relPage({ external: true, data: { usb: 1 } });
  try {
    assert.ok(!pg.about.usb.visible, "a browser has Upload Update... instead");
  } finally {
    relDone();
  }
});
test("release: without internet Check for Updates is greyed out and the Updates row says why", () => {
  const pg = relPage();
  try {
    ctx.DLZMOD_setRelease({ state: "", online: false });
    pg.about.check.getState();
    assert.strictEqual(pg.about.check.enabled, false);
    assert.deepStrictEqual(plain(ctx.DLZMOD_updateRow()), ["No internet: connect the mixer to a network to check for updates", null]);
    assert.ok(pg.about.usb.visible, "From USB Stick... still there");
    ctx.DLZMOD_setRelease(Object.assign({}, REL, { online: false }));
    pg.about.check.getState();
    assert.strictEqual(pg.about.check.enabled, false, "no Download either");
    ctx.DLZMOD_setRelease({ state: "", online: true });
    pg.about.check.getState();
    assert.strictEqual(pg.about.check.enabled, true);
    ctx.DLZMOD_setRelease({ state: "" });
    pg.about.check.getState();
    assert.strictEqual(pg.about.check.enabled, true, "an older server that does not say: not greyed out");
  } finally {
    relDone();
  }
});
test("release: in a browser the download's end says where Install is", () => {
  relPage({ external: true });
  try {
    ctx.DLZMOD_releaseSend("download");
    ctx.DLZMOD_setRelease(Object.assign({}, REL, { state: "done" }));
    assert.deepStrictEqual(ui.popups.map((p) => p.text),
      ["v0.5.1 is on the mixer's card.\nTap Install on the mixer's screen, then switch the mixer off and on."]);
    ui.popups.length = 0;
    ctx.DLZMOD_releaseSend("download");
    ctx.DLZMOD_setRelease(Object.assign({}, REL, { state: "done", error: "This same update failed on this mixer before" }));
    assert.deepStrictEqual(ui.popups.map((p) => p.text), ["This same update failed on this mixer before"]);
  } finally {
    relDone();
  }
});
test("release: a dot on the Mod tab while a new version is out that the Mod page has not shown yet", () => {
  const pg = relPage();
  try {
    const dots = () => ctx.DLZMOD_dot.all.map((d) => d.visible);
    assert.ok(ctx.DLZMOD_dot.all.length >= 1, "the Mod sub-tab has one");
    assert.ok(dots().every((v) => !v), "none at first");
    pg.tabs[0].onToggleON();   // on another sub-tab
    ctx.DLZMOD_setRelease(REL);
    assert.ok(dots().every((v) => v), "a new version: shown");
    pg.tabs[5].onToggleON();   // the Mod page shows it
    assert.deepStrictEqual(ui.sets.at(-1), ["dlzmod.updateSeen", "v0.5.1"]);
    assert.ok(dots().every((v) => !v), "seen: gone");
    pg.tabs[0].onToggleON();
    ctx.DLZMOD_setRelease(REL);
    assert.ok(dots().every((v) => !v), "the same version: stays gone");
    ctx.DLZMOD_setRelease(Object.assign({}, REL, { version: "v0.5.2" }));
    assert.ok(dots().every((v) => v), "the next one: back");
    ctx.DLZMOD_setRelease({ state: "current", version: "v0.5.2" });
    assert.ok(dots().every((v) => !v), "installed: gone");
  } finally {
    relDone();
  }
  // a browser has no dots
  relPage({ external: true });
  try {
    ctx.DLZMOD_setRelease(REL);
    assert.ok(ctx.DLZMOD_dot.all.every((d) => !d.visible));
  } finally {
    relDone();
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
    assert.match(ui.popups[0].text, /^Send dlzmod-v0\.2\.0\.tar \(1\.\d MB\) to the mixer\?\nThe mixer's screen then asks to install it\.$/);
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
  pg.tabs[3].onToggleON();
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
  pg.tabs[4].onToggleON();
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
  pg.tabs[3].onToggleON();
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
test("Mod page: the Network and Remote status every 3 s, only while one of them is on screen; the Time panel's too", () => {
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
  const net = [["DLZMOD_NET", { op: "status" }]], time = [["DLZMOD_TIME", { op: "status" }]];
  for (const [tab, asks] of [[0, []], [1, []], [2, time], [3, net], [4, net], [5, []]]) {
    pg.tabs[tab].onToggleON();
    ui.cmds.length = 0;
    poll.fn();
    assert.deepStrictEqual(ui.cmds, asks, "tab " + tab);
  }
  pg.tabs[3].onToggleON();
  pg.visible = false;
  ui.cmds.length = 0;
  poll.fn();
  assert.deepStrictEqual(ui.cmds, [], "another Settings page or screen: nothing");
});

// Time (#9): the time zone, kept by the server (DLZMOD_TIME)
const REAL_INTL = ctx.Intl;
// a browser that says its zone is z (undefined: one without Intl)
const browserZone = (z) => {
  ctx.Intl = z === undefined ? undefined : { DateTimeFormat: () => ({ resolvedOptions: () => ({ timeZone: z }) }) };
};
test("Time panel: the zone, its offset and the time there; a browser offers its own zone, the mixer does not", () => {
  reset();
  settings();
  const pg = settingsPage();
  ctx.app = { pageSettings: { dlzmod: pg } };
  try {
    pg.tabs[2].onToggleON();
    assert.strictEqual(pg.time.zone.own.visible, false, "on the mixer: no own zone");
    ctx.DLZMOD_setTimeState({ zone: "Europe/Amsterdam", offset: "UTC+01:00", time: "14:05" });
    assert.ok(pg.time.updates > 0, "a new status repaints the panel");
    assert.strictEqual(ctx.DLZMOD_zoneName("America/Argentina/Buenos_Aires"), "America / Argentina / Buenos Aires");
    const n = ui.windows.length;
    pg.time.zone.change.onPress();
    assert.strictEqual(ui.windows.length, n + 1, "Change... opens the list");
    ui.windows.at(-1).close();
    ctx.EXTERNAL = true;
    const web = settingsPage();
    web.tabs[2].onToggleON();
    browserZone("Europe/London");
    assert.strictEqual(enabled(web.time.zone.own), true);
    ui.cmds.length = 0;
    web.time.zone.own.onPress();
    assert.deepStrictEqual(ui.cmds, [["DLZMOD_TIME", { op: "set", zone: "Europe/London" }]]);
    browserZone("Europe/Amsterdam");
    assert.strictEqual(enabled(web.time.zone.own), false, "already that zone");
    browserZone(undefined);
    assert.strictEqual(enabled(web.time.zone.own), false, "a browser that does not say");
    ui.cmds.length = 0;
    web.time.zone.own.onPress();
    assert.deepStrictEqual(ui.cmds, [], "nothing sent without a zone");
  } finally {
    ctx.app = undefined;
    ctx.EXTERNAL = false;
    ctx.Intl = REAL_INTL;
  }
});
test("Time panel: the outcome of a change in a Time popup", () => {
  reset();
  ctx.DLZMOD_timeResult({ ok: true, text: "Time zone: Europe/Amsterdam" });
  ctx.DLZMOD_timeResult({ ok: false, text: "Unknown time zone" });
  assert.deepStrictEqual(ui.popups.map((p) => [p.text, p.opts.title, p.opts.textColor]),
    [["Time zone: Europe/Amsterdam", "Time", "green"], ["Unknown time zone", "Time", "red2"]]);
});
// Clock (#13): the date and time and where they came from, set by hand or from a browser
const CLOCK = { zone: "Europe/Amsterdam", offset: "UTC+01:00", time: "23:58",
  local: { y: 2026, mo: 1, d: 31, h: 23, mi: 58, date: "Sat 31 Jan 2026" }, clock: "" };
test("Clock card: where the time came from; Set... and the computer's time only without internet", () => {
  reset();
  settings();
  const pg = settingsPage();
  ctx.app = { pageSettings: { dlzmod: pg } };
  try {
    pg.tabs[2].onToggleON();
    const c = pg.time.clock;
    assert.strictEqual(c.own.visible, false, "on the mixer: not the computer's time");
    assert.strictEqual(enabled(c.set), false, "no status yet");
    assert.deepStrictEqual(plain(ctx.DLZMOD_clockSourceText({})), ["", ""]);
    const text = (clock) => {
      ctx.DLZMOD_setTimeState(Object.assign({}, CLOCK, { clock: clock }));
      return [plain(ctx.DLZMOD_clockSourceText(ctx.DLZMOD_timeState())), enabled(c.set)];
    };
    assert.deepStrictEqual(text(""), [["Not checked since the start (no internet)", YELLOW], true]);
    assert.deepStrictEqual(text("hand"), [["Set by hand", GREY], true]);
    assert.deepStrictEqual(text("device"), [["From a phone or computer", GREY], true]);
    assert.deepStrictEqual(text("internet"), [["Set from the internet", "green"], false]);
    ctx.EXTERNAL = true;
    const web = settingsPage();
    web.tabs[2].onToggleON();
    ctx.DLZMOD_setTimeState(CLOCK);
    assert.strictEqual(enabled(web.time.clock.own), true);
    ui.cmds.length = 0;
    const before = Date.now();
    web.time.clock.own.onPress();
    assert.strictEqual(ui.cmds.length, 1);
    assert.strictEqual(ui.cmds[0][1].op, "clock");
    assert.ok(ui.cmds[0][1].now >= before && ui.cmds[0][1].now <= Date.now(), "the browser's time now");
    ctx.DLZMOD_setTimeState(Object.assign({}, CLOCK, { clock: "internet" }));
    assert.strictEqual(enabled(web.time.clock.own), false);
    assert.match(ctx.DLZMOD_ownTime(new Date(2026, 9, 28, 9, 5)), /^Wed 28 Oct 2026  09:05$/);
  } finally {
    ctx.app = undefined;
    ctx.EXTERNAL = false;
  }
});
test("Clock picker: steps go round, the year stops at the server's limits, a day past the month's end is its last", () => {
  const f = { y: 2026, mo: 1, d: 31, h: 23, mi: 59 };
  const step = (k, d, from = f) => plain(ctx.DLZMOD_clockStep(from, k, d));
  assert.deepStrictEqual(step("mi", 1), Object.assign({}, f, { mi: 0 }), "no carry into the hour");
  assert.deepStrictEqual(step("h", 1), Object.assign({}, f, { h: 0 }));
  assert.deepStrictEqual(step("d", 1), Object.assign({}, f, { d: 1 }));
  assert.deepStrictEqual(step("mo", -1), Object.assign({}, f, { mo: 12 }));
  assert.deepStrictEqual(step("mo", 1), Object.assign({}, f, { mo: 2, d: 28 }), "31 Jan → Feb: the 28th");
  assert.deepStrictEqual(step("y", -1, { y: 2028, mo: 2, d: 29, h: 0, mi: 0 }), { y: 2027, mo: 2, d: 28, h: 0, mi: 0 });
  assert.deepStrictEqual(step("d", -1, { y: 2028, mo: 2, d: 1, h: 0, mi: 0 }).d, 29, "a leap year");
  assert.strictEqual(step("y", -1, Object.assign({}, f, { y: 2025 })).y, 2025);
  assert.strictEqual(step("y", 1, Object.assign({}, f, { y: 2099 })).y, 2099);
  assert.strictEqual(ctx.DLZMOD_dateText(2026, 10, 28), "Wed 28 Oct 2026");
});
test("Clock picker: opens at the mixer's time, arrows change it, Set sends it; every way out lets it open again", () => {
  reset();
  ctx.DLZMOD_clockPicker();
  assert.strictEqual(ui.windows.length, 0, "no status yet: nothing to start from");
  ctx.DLZMOD_setTimeState(Object.assign({}, CLOCK, { local: Object.assign({}, CLOCK.local, { y: 2023 }) }));
  ctx.DLZMOD_clockPicker();
  const w = ui.windows[0];
  ctx.DLZMOD_clockPicker();
  assert.strictEqual(ui.windows.length, 1, "already open: not twice");
  assert.deepStrictEqual(plain(w.f), { y: 2025, mo: 1, d: 31, h: 23, mi: 58 }, "a saved time before 2025: from 2025");
  const arrows = ui.widgets.filter((x) => x.parent === w && x.onhold);
  assert.strictEqual(arrows.length, 10, "up and down for day, month, year, hour, minute");
  arrows[0].onPress();   // day up
  arrows[3].onPress();   // month down
  arrows[9].onPress();   // minute down
  assert.deepStrictEqual(plain(w.f), { y: 2025, mo: 12, d: 1, h: 23, mi: 57 });
  ui.cmds.length = 0;
  ui.buttons.find((b) => b.parent === w && b.text === "Set").onPress();
  assert.strictEqual(w.closed, true);
  assert.deepStrictEqual(ui.cmds, [["DLZMOD_TIME", { op: "clock", time: { y: 2025, mo: 12, d: 1, h: 23, mi: 57 } }]]);
  ctx.DLZMOD_clockPicker();
  ui.cmds.length = 0;
  ui.buttons.find((b) => b.parent === ui.windows.at(-1) && b.text === "Cancel").onPress();
  assert.deepStrictEqual(ui.cmds, [], "Cancel sends nothing");
  ctx.DLZMOD_clockPicker();
  ui.windows.at(-1).onDestroy();   // a tap outside the popup
  ctx.DLZMOD_clockPicker();
  assert.strictEqual(ui.windows.length, 4, "a tap outside: opens again");
  ui.windows.at(-1).close();
  reset();
  ctx.DLZMOD_setTimeState(Object.assign({}, CLOCK, { local: Object.assign({}, CLOCK.local, { y: 2024, mo: 2, d: 29 }) }));
  ctx.DLZMOD_clockPicker();
  assert.deepStrictEqual(plain(ui.windows[0].f), { y: 2025, mo: 2, d: 28, h: 23, mi: 58 },
    "29 Feb of a saved 2024: 28 Feb 2025, a date the server takes");
  ui.windows[0].close();
});
test("Clock: the screen's frame timer does not stop when the clock is set back (patch.py)", () => {
  // Mackie's timer (app.js, node only): wait 17 ms minus the time since the last frame
  const wait = (now, last) => Math.max(0, 17 - (now - last));
  const D = vm.runInContext("Date", ctx), realNow = D.now;
  let mono = 5000;
  ctx.performance = { timeOrigin: 1e12, now: () => mono };
  try {
    const last = ctx.DLZMOD_frameNow();
    assert.strictEqual(last, 1e12 + 5000);
    D.now = () => realNow() - 91000;   // chrony steps the clock back 91 s
    mono += 10;
    assert.strictEqual(wait(ctx.DLZMOD_frameNow(), last), 7, "the next frame as planned");
    assert.ok(wait(D.now(), realNow()) > 90000, "by the wall clock it waited 91 s [device]");
  } finally {
    D.now = realNow;
    delete ctx.performance;
  }
  const before = Date.now();
  assert.ok(ctx.DLZMOD_frameNow() >= before, "no performance clock: Date.now()");
});
test("Clock: a browser gives its time at every connect, the mixer's own screen does not", () => {
  reset();
  ctx.DLZMOD_connected();
  assert.deepStrictEqual(ui.cmds, []);
  ctx.EXTERNAL = true;
  try {
    const before = Date.now();
    ctx.DLZMOD_connected();
    assert.strictEqual(ui.cmds.length, 1);
    assert.strictEqual(ui.cmds[0][1].op, "sync");
    assert.ok(ui.cmds[0][1].now >= before && ui.cmds[0][1].now <= Date.now());
  } finally {
    ctx.EXTERNAL = false;
  }
});
test("Zone list: sorted by offset, every zone once, UTC on its own; plain cities, no region names", () => {
  const zones = plain(ctx.DLZMOD_zoneList());
  const minutes = (o) => o === "UTC" ? 0 : (o[3] === "-" ? -1 : 1) * (+o.slice(4, 6) * 60 + +o.slice(7, 9));
  assert.ok(zones.length >= 35 && zones.length <= 45, zones.length + " rows");
  zones.forEach((z, i) => {
    assert.match(z.offset, /^UTC([+-]\d\d:\d\d)?$/, z.zone);
    assert.match(z.zone, /^[A-Za-z_]+(\/[A-Za-z_]+){1,2}$/, z.zone);
    assert.ok(!/[\/_]/.test(z.cities), z.cities);
    if (i) assert.ok(minutes(z.offset) >= minutes(zones[i - 1].offset), z.zone + " after " + zones[i - 1].zone);
  });
  assert.strictEqual(new Set(zones.map((z) => z.zone)).size, zones.length, "every zone once");
  assert.deepStrictEqual(zones.filter((z) => z.offset === "UTC").map((z) => z.zone), ["Etc/UTC"]);
  assert.ok(zones.some((z) => z.zone === "Europe/Amsterdam"));
});
test("Zone list: pages of 14, opened on the zone set; a row sets it; < and >; every way out lets it open again", () => {
  reset();
  const all = plain(ctx.DLZMOD_zoneList());
  const pages = Math.ceil(all.length / 14);
  ctx.DLZMOD_setTimeState({ zone: "Europe/Amsterdam", offset: "UTC+01:00", time: "14:05" });
  ctx.DLZMOD_zonePicker();
  const w = ui.windows[0];
  ctx.DLZMOD_zonePicker();
  assert.strictEqual(ui.windows.length, 1, "already open: not twice");
  const at = all.findIndex((z) => z.zone === "Europe/Amsterdam");
  assert.strictEqual(w.page, at / 14 | 0, "opens on the zone set");
  const rows = rowsOf(w);
  assert.strictEqual(rows.length, 14);
  const [prev, next] = ["<", ">"].map((t) => ui.buttons.find((b) => b.parent === w && b.text === t));
  w.show(0);
  prev.getState();
  next.getState();
  assert.deepStrictEqual([prev.enabled, next.enabled], [false, true]);
  assert.deepStrictEqual(plain(w.items()), all.slice(0, 14));
  next.onPress();
  assert.deepStrictEqual(plain(w.items()), all.slice(14, 28));
  w.show(99);
  assert.strictEqual(w.page, pages - 1, "not past the last page");
  next.getState();
  assert.strictEqual(next.enabled, false);
  const last = all.slice((pages - 1) * 14);
  if (last.length < 14) {
    rows[13].onup();
    assert.strictEqual(w.closed, undefined, "an empty place: nothing");
  }
  ui.cmds.length = 0;
  rows[last.length - 1].onup();
  assert.strictEqual(w.closed, true, "a row closes the list");
  assert.deepStrictEqual(ui.cmds, [["DLZMOD_TIME", { op: "set", zone: all.at(-1).zone }]]);
  ctx.DLZMOD_setTimeState({ zone: "Europe/Berlin", offset: "UTC+01:00", time: "14:05" });
  ctx.DLZMOD_zonePicker();
  assert.strictEqual(ui.windows.at(-1).page, 0, "a zone not in the list (set from a browser): the first page");
  ui.windows.at(-1).onDestroy();   // a tap outside the popup destroys it without close()
  ctx.DLZMOD_zonePicker();
  assert.strictEqual(ui.windows.length, 3, "a tap outside: opens again");
  ui.windows.at(-1).close();
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

// #131 the sound behind the EQ curve
// Mackie's PageEQ as the hooks see it: its EQ widget records the spectrum at each redraw
const eqPage = () => ({ eq: { rtaOverlay: true, h: 202, got: [], update() {
  this.got.push(this.rtaData && this.rtaData.slice());
} } });
// a message, then the animation's frame at the same moment
const rtaAt = (msg, now) => {
  ctx.DLZMOD_rtaVu(msg, now);
  ctx.DLZMOD_rtaTick(now);
};
// a VU message's dlzmod.rta group: one byte per band, Mackie's VU scale (240 = 0 dBFS, 3 per dB)
const rtaMsg = (dbs) => ({ "dlzmod.rta": Buffer.from(dbs.map((db) => Math.round(240 + 3 * db))).toString("base64") });
const rtaReset = () => {
  reset();
  settings({ "dlzmod.rta": 0 });
  ctx.DLZMOD_rtaShown.page = null;
  ctx.DLZMOD_rtaShown.prefix = "";
  ctx.DLZMOD_rtaStop(true);
  ctx.DLZMOD_rtaRange.code = ctx.DLZMOD_rtaSmooth.code = ctx.DLZMOD_rtaGlideTop.code = undefined;
  ctx.DLZMOD_rtaRange.top = ctx.DLZMOD_rtaSmooth.levels = ctx.DLZMOD_rtaGlideTop.top = undefined;
  delete ctx.wstream;
  Object.assign(ctx.DLZMOD_rtaAnim(), { busyAt: -1e9, at: 0, later: (f, ms) => (ui.later = ms, 1) });
};
test("EQ spectrum: the channels with an EQ page get the graph mod's numbers, others none", () => {
  const codes = ["i.0.", "i.1.", "p.0.", "p.1.", "v.0.", "v.1.", "s.", "m."].map((p) => ctx.DLZMOD_rtaCode(p));
  assert.deepStrictEqual(codes, [1, 2, 3, 4, 5, 6, 7, 8]);
  for (const p of ["f.0.", "f.1.", "", undefined, "i.2."]) assert.strictEqual(ctx.DLZMOD_rtaCode(p), 0, String(p));
});
test("EQ spectrum: the screen's EQ page says which channel to measure, and none when it closes", () => {
  rtaReset();
  const pg = eqPage();
  ctx.DLZMOD_rtaShown(pg, true);
  assert.strictEqual(pg.eq.rtaOverlay, false, "drawn with the curve, not on Mackie's overlay layer");
  ctx.DLZMOD_rtaSync(pg, "p.1.");
  ctx.DLZMOD_rtaSync(pg, "m.");
  ctx.DLZMOD_rtaSync(pg, "m.");
  ctx.DLZMOD_rtaShown(pg, false);
  assert.deepStrictEqual(ui.sets, [["dlzmod.rta", 4], ["dlzmod.rta", 8], ["dlzmod.rta", 0]], "each change once");
  ctx.DLZMOD_rtaSync(pg, "i.0.");
  assert.strictEqual(ui.sets.length, 3, "a hidden page's sync measures nothing");
  ctx.DLZMOD_rtaShown(null, false);
  assert.strictEqual(ui.sets.length, 3, "at startGUI: already none");
  ctx.Data.data["dlzmod.rta"] = 5;
  ctx.DLZMOD_rtaShown(null, false);
  assert.deepStrictEqual(ui.sets[3], ["dlzmod.rta", 0], "at startGUI: the one from before a restart cleared");
});
test("EQ spectrum: another page hidden late does not end the open page's measuring", () => {
  rtaReset();
  const a = eqPage(), b = eqPage();
  ctx.DLZMOD_rtaShown(b, true);
  ctx.DLZMOD_rtaSync(b, "i.1.");
  ctx.DLZMOD_rtaShown(a, false);
  assert.deepStrictEqual(ui.sets, [["dlzmod.rta", 2]]);
});
test("EQ spectrum: a browser shows the screen's channel but never chooses it", () => {
  rtaReset();
  ctx.EXTERNAL = true;
  try {
    const pg = eqPage();
    ctx.DLZMOD_rtaShown(pg, true);
    ctx.DLZMOD_rtaSync(pg, "i.0.");
    ctx.DLZMOD_rtaShown(pg, false);
    assert.deepStrictEqual(ui.sets, []);
    ctx.DLZMOD_rtaShown(pg, true);
    ctx.DLZMOD_rtaSync(pg, "i.0.");
    rtaAt(rtaMsg(Array(20).fill(-20)), 1000);
    assert.strictEqual(pg.eq.got.length, 0, "the screen measures another channel (none)");
    ctx.Data.data["dlzmod.rta"] = 1;
    rtaAt(rtaMsg(Array(20).fill(-20)), 1000);
    assert.strictEqual(pg.eq.got.length, 1, "the same channel as the screen's");
  } finally {
    ctx.EXTERNAL = false;
  }
});
test("EQ spectrum: the bands go onto the open page, not without one, another channel's or a broken message", () => {
  rtaReset();
  const pg = eqPage();
  rtaAt(rtaMsg(Array(20).fill(-20)), 1000);
  ctx.DLZMOD_rtaShown(pg, true);
  ctx.DLZMOD_rtaSync(pg, "s.");
  rtaAt({ "in.post": "AAA=" }, 1000);
  rtaAt({ "dlzmod.rta": "not base64!" }, 1000);
  rtaAt(undefined, 1000);
  assert.strictEqual(pg.eq.got.length, 0);
  rtaAt(rtaMsg(Array(20).fill(-20)), 1000);
  assert.strictEqual(pg.eq.got.length, 1);
  ctx.Data.data["dlzmod.rta"] = 3;   // the hub has another channel (a moment after a switch)
  ctx.DLZMOD_rtaVu(rtaMsg(Array(20).fill(-10)), 1033);
  assert.strictEqual(ctx.DLZMOD_rtaAnim().at, 1000, "not taken");
});
test("EQ spectrum: each message's picture glides in, a step every 33 ms, no frame while it stands still", () => {
  rtaReset();
  const pg = eqPage();
  ctx.DLZMOD_rtaShown(pg, true);
  ctx.DLZMOD_rtaSync(pg, "m.");
  ctx.DLZMOD_rtaVu(rtaMsg(Array(20).fill(-20)), 1000);
  const goal = plain(ctx.DLZMOD_rtaAnim().target);
  ctx.DLZMOD_rtaTick(1000);
  const first = pg.eq.got[0];
  const part = 1 - Math.pow(0.2, 0.33);
  assert.ok(first.every((v, k) => Math.abs(v - part * goal[k]) < 1e-9), "from the bottom, a third of 100 ms's 80 %");
  assert.strictEqual(ui.later, 33, "the next step in 33 ms");
  for (let t = 1033; t < 1890; t += 33) {
    ctx.DLZMOD_rtaVu(rtaMsg(Array(20).fill(-20)), t);
    ctx.DLZMOD_rtaTick(t);
  }
  const n = pg.eq.got.length;
  assert.deepStrictEqual(plain(pg.eq.rtaData), goal, "there, exactly");
  assert.ok(pg.eq.got[n - 1].every((v, k) => Math.abs(v - goal[k]) * 200 < 1), "the last frame within a pixel");
  ctx.DLZMOD_rtaVu(rtaMsg(Array(20).fill(-20)), 1890);
  ctx.DLZMOD_rtaTick(1900);
  assert.strictEqual(pg.eq.got.length, n, "standing still: no frame");
  assert.strictEqual(ui.later, 200, "a slower check");
});
test("EQ spectrum: the glide keeps its speed: two short steps go as far as one long, a late timer catches up", () => {
  const glide = (steps) => {
    rtaReset();
    const pg = eqPage();
    ctx.DLZMOD_rtaShown(pg, true);
    ctx.DLZMOD_rtaSync(pg, "m.");
    for (let t = 1000; t <= 1600; t += 50) rtaAt(rtaMsg(Array(20).fill(-20)), t);
    const a = ctx.DLZMOD_rtaAnim(), from = plain(pg.eq.rtaData);
    a.target = from.map((v) => v + 0.2);
    a.at = 1600;
    let t = 1600;
    for (const ms of steps) ctx.DLZMOD_rtaTick(t += ms);
    return (pg.eq.rtaData[0] - from[0]) / 0.2;
  };
  assert.ok(Math.abs(glide([100]) - 0.8) < 1e-6, "80 % in 100 ms");
  assert.ok(Math.abs(glide([50, 50]) - 0.8) < 1e-6, "the same in two steps");
  assert.ok(Math.abs(glide([200]) - 0.96) < 1e-6, "a late timer goes further");
  assert.ok(Math.abs(glide([250]) - 0.96) < 1e-6, "but no more than 200 ms's worth");
});
test("EQ spectrum: a redraw for a knob or a dragged dot counts as this step's frame, the next step draws again", () => {
  rtaReset();
  const pg = eqPage();
  ctx.DLZMOD_rtaShown(pg, true);
  ctx.DLZMOD_rtaSync(pg, "m.");
  rtaAt(rtaMsg(Array(20).fill(-20)), 1000);
  assert.strictEqual(pg.eq.got.length, 1);
  pg.eq.update();   // Mackie's own redraw: a knob turned
  assert.strictEqual(pg.eq.got.length, 2);
  ctx.DLZMOD_rtaAnim().busyAt = 1010;   // the wrapper takes the clock; here: at 1010
  const before = plain(pg.eq.rtaData);
  ctx.DLZMOD_rtaVu(rtaMsg(Array(20).fill(-20)), 1030);
  ctx.DLZMOD_rtaTick(1033);
  assert.strictEqual(pg.eq.got.length, 2, "no frame of its own");
  assert.notDeepStrictEqual(plain(pg.eq.rtaData), before, "but the picture moved on, for Mackie's next redraw");
  ctx.DLZMOD_rtaVu(rtaMsg(Array(20).fill(-20)), 1060);
  ctx.DLZMOD_rtaTick(1066);
  assert.strictEqual(pg.eq.got.length, 3, "a step later: frames again");
});
test("EQ spectrum: silence or no message for 300 ms: the picture sinks and goes; a closed page clears it", () => {
  rtaReset();
  const pg = eqPage();
  ctx.DLZMOD_rtaShown(pg, true);
  ctx.DLZMOD_rtaSync(pg, "m.");
  rtaAt(rtaMsg(Array(20).fill(-20)), 1000);
  ctx.DLZMOD_rtaVu(rtaMsg(Array(20).fill(-80)), 1033);
  let t = 1033;
  for (; t < 2000 && pg.eq.got[pg.eq.got.length - 1] !== null; t += 33) ctx.DLZMOD_rtaTick(t);
  const g = pg.eq.got;
  assert.ok(g.length > 3 && g[g.length - 1] === null, "sank, then gone");
  assert.ok(g[g.length - 2].every((v, k) => v <= g[1][k]), "downwards");
  ui.later = undefined;
  ctx.DLZMOD_rtaTick(t);
  assert.strictEqual(ui.later, undefined, "and the timer stops");
  rtaAt(rtaMsg(Array(20).fill(-20)), 3000);
  for (t = 3033; t < 3990; t += 33) ctx.DLZMOD_rtaTick(t);
  assert.strictEqual(pg.eq.got[pg.eq.got.length - 1], null, "no message for 300 ms: gone too");
  rtaAt(rtaMsg(Array(20).fill(-20)), 4000);
  ctx.DLZMOD_rtaShown(pg, false);
  assert.strictEqual(pg.eq.rtaData, null, "the page closed: cleared");
  ctx.DLZMOD_rtaTick(4033);
  assert.strictEqual(pg.eq.rtaData, null);
});
test("EQ spectrum: the Spectrum switch off measures and shows nothing; on again, the open page measures", () => {
  rtaReset();
  const pg = eqPage();
  ctx.Data.data["dlzmod.spectrum"] = 0;
  ctx.DLZMOD_rtaShown(pg, true);
  ctx.DLZMOD_rtaSync(pg, "v.0.");
  rtaAt(rtaMsg(Array(20).fill(-20)), 1000);
  assert.deepStrictEqual(ui.sets, [], "off: no channel measured");
  assert.strictEqual(pg.eq.got.length, 0, "and nothing drawn");
  ctx.Data.data["dlzmod.spectrum"] = 1;
  ctx.DLZMOD_rtaSwitched();
  assert.deepStrictEqual(ui.sets, [["dlzmod.rta", 5]], "on: the open page's channel");
  rtaAt(rtaMsg(Array(20).fill(-20)), 1100);
  assert.strictEqual(pg.eq.got.length, 1);
  ctx.Data.data["dlzmod.spectrum"] = 0;
  ctx.DLZMOD_rtaSwitched();
  assert.deepStrictEqual(ui.sets[1], ["dlzmod.rta", 0], "off again: none");
  ctx.DLZMOD_rtaVu(rtaMsg(Array(20).fill(-20)), 1300);
  assert.strictEqual(ctx.DLZMOD_rtaAnim().at, 1100, "its messages no longer taken: the picture goes after 300 ms");
  ctx.DLZMOD_rtaShown(pg, false);
  ctx.Data.data["dlzmod.spectrum"] = 1;
  ctx.DLZMOD_rtaSwitched();
  assert.strictEqual(ui.sets.length, 2, "no EQ page open: still none");
});
test("EQ spectrum: the Spectrum switch on the XS's EQ page only, the EQ switch moved up for it", () => {
  rtaReset();
  const page = { color: "eq" };
  assert.strictEqual(ctx.DLZMOD_rtaSwitch(page), null, "full-size: no switch");
  assert.strictEqual(ctx.DLZMOD_rtaSwitchY(), 55, "and Mackie's EQ switch where it was");
  ctx.LITE_MODE = 1;
  try {
    const sw = ctx.DLZMOD_rtaSwitch(page);
    assert.strictEqual(sw.key, "dlzmod.spectrum");
    assert.strictEqual(ctx.DLZMOD_rtaSwitchY(), 22);
    const top = 22, bottom = sw.anchors[1] + sw.size[1];
    assert.ok(top >= 14 + 6 && sw.anchors[1] >= top + 48 + 6 && bottom <= 137 - 6, "both in the box (14..137)");
    assert.strictEqual(sw.onToggleON, ctx.DLZMOD_rtaSwitched);
  } finally {
    delete ctx.LITE_MODE;
  }
});
test("EQ spectrum: the fill reaches the bottom on its own path, the line is drawn on a fresh one", () => {
  rtaReset();
  const calls = [];
  const ctx2 = new Proxy({}, { get: (o, k) => (k in o ? o[k] : (...a) => calls.push([k, ...a])),
    set: (o, k, v) => (calls.push(["set " + String(k), v]), true) });
  const pg = eqPage();
  Object.assign(pg.eq, { w: 101, h: 52, freqToX: (f) => Math.round(100 * Math.log10(f / 20) / 3), rtaStrokeColor: "S" });
  ctx.DLZMOD_rtaShown(pg, true);
  pg.eq.rtaData = [0, 0.5, 1];
  pg.eq.paintRTA(ctx2);
  const names = calls.map((c) => c[0]);
  assert.ok(!names.includes("fill"), "no filled area: the graphics chip's dearest part");
  assert.deepStrictEqual(calls[names.indexOf("moveTo")], ["moveTo", 0, 50], "the line starts at the first point");
  assert.deepStrictEqual(plain(calls.find((c) => c[0] === "lineToArray")[1]), [[0, 50], [50, 25], [100, 0]], "points on the widget's own frequency scale");
  assert.ok(calls.some((c) => c[0] === "set strokeStyle" && c[1] === "S") && calls.some((c) => c[0] === "set lineWidth" && c[1] === 4), "thick, in the look's colour");
  pg.eq.rtaData = [0, 0.333, 1];
  calls.length = 0;
  pg.eq.paintRTA(ctx2);
  assert.strictEqual(calls.find((c) => c[0] === "lineToArray")[1][1][1], 50 * 0.667, "at the exact height, no whole pixels");
  pg.eq.rtaData = null;
  calls.length = 0;
  pg.eq.paintRTA(ctx2);
  assert.strictEqual(calls.length, 0, "nothing without data");
});
test("EQ spectrum: up in about 0.1 s, down in about 0.3 s; afresh for another channel or after a pause", () => {
  const S = (lv, code, now) => plain(ctx.DLZMOD_rtaSmooth(lv, code, now));
  S([0.5, 0.5], 1, 1000);
  const up = 1 - Math.exp(-0.1 / 0.1), down = 1 - Math.exp(-0.1 / 0.3);
  const got = S([0.9, 0.1], 1, 1100);
  assert.ok(Math.abs(got[0] - (0.5 + 0.4 * up)) < 1e-9 && Math.abs(got[1] - (0.5 - 0.4 * down)) < 1e-9, "up fast, down slower");
  for (let t = 1200; t <= 4000; t += 100) S([0.9, 0.1], 1, t);
  const there = S([0.9, 0.1], 1, 4100);
  assert.ok(Math.abs(there[0] - 0.9) < 1e-3 && Math.abs(there[1] - 0.1) < 1e-3, "a steady level reached");
  assert.deepStrictEqual(S([0.1, 0.1], 2, 4200), [0.1, 0.1], "another channel: afresh");
  assert.deepStrictEqual(S([0, 0], 2, 5800), [0, 0], "after a pause of over a second: afresh");
});
test("EQ spectrum: the scale's top 6-12 dB above the loudest band, steady while the bands move a little", () => {
  let t = 1000;
  const R = (dbs, code = 1) => ctx.DLZMOD_rtaRange(dbs.map((db) => 1 + db / 80), code, t += 100);
  ctx.DLZMOD_rtaRange.code = undefined;
  assert.strictEqual(R([-40, -14, -30]), -6, "loudest -14: top -6 dBFS");
  assert.strictEqual(R([-40, -8, -30]), -6, "a boost of 6 dB: the same top");
  assert.strictEqual(R([-40, -23, -30]), -6, "a cut of 9 dB: the same top");
  assert.strictEqual(R([-40, -3, -30]), 6, "a band over the top: up");
  assert.strictEqual(R([-40, -10, -30]), 6, "not down yet (16 dB below)");
  assert.strictEqual(R([-40, -13, -30], 2), -6, "another channel: afresh");
  assert.strictEqual(R([-80, -80, -80], 2), -48, "silence: the lowest top");
  assert.strictEqual(R([10, 0, 0], 2), 6, "over 0 dBFS: the highest");
  t += 1500;
  assert.strictEqual(R([-40, -14, -30], 2), -6, "after a pause of over a second: afresh (the page left, silence)");
});
test("EQ spectrum: a narrow cut shows as deep as the curve, from the curve; not with the EQ or the channel's processing off", () => {
  rtaReset();
  // a curve on a 1000 px wide widget, 200 px high, ±15 dB: -15 dB at 4 kHz, Q 4, in RBJ's peak form
  const toX = (f) => 1000 * Math.log10(f / 20) / 3;
  const gain = (f) => {
    const A = Math.pow(10, -15 / 40), w = 2 * Math.PI * f / 48000, w0 = 2 * Math.PI * 4000 / 48000, al = Math.sin(w0) / 8;
    const c0 = Math.cos(w0), [c1, c2, s1, s2] = [Math.cos(w), Math.cos(2 * w), Math.sin(w), Math.sin(2 * w)];
    const [b0, b2, a0, a2, m] = [1 + al * A, 1 - al * A, 1 + al / A, 1 - al / A, -2 * c0];
    const nr = b0 + m * c1 + b2 * c2, ni = m * s1 + b2 * s2, dr = a0 + m * c1 + a2 * c2, di = m * s1 + a2 * s2;
    return 10 * Math.log10((nr * nr + ni * ni) / (dr * dr + di * di));
  };
  const ps = [];
  for (let x = 0; x <= 1000; x += 2) ps.push([x, 100 - gain(20 * Math.pow(10, 3 * x / 1000)) / 15 * 100]);
  const eq = { h: 200, gainRange: 15, freqToX: toX, graphPoints: ps };
  const shape = plain(ctx.DLZMOD_rtaEqShape(eq, 129));
  const at = Math.round(128 * Math.log(4000 / 20) / Math.log(1000));
  assert.ok(Math.abs(shape[at] + 11.8) < 1.5, "at the cut: what the band misses of -15 dB, about 12 dB, got " + shape[at]);
  assert.ok(Math.abs(shape[20]) < 0.1, "far from it: nothing");
  assert.strictEqual(ctx.DLZMOD_rtaEqShape(eq, 129), ctx.DLZMOD_rtaEqShape(eq, 129), "worked out once per curve");
  assert.strictEqual(ctx.DLZMOD_rtaEqShape({ ...eq, bypass: true }, 129), null, "EQ off: the sound has no cut");
  const pg = eqPage();
  Object.assign(pg.eq, eq, { rtaStrokeColor: "S", rtaData: Array(129).fill(0.5) });
  ctx.DLZMOD_rtaShown(pg, true);
  ctx.DLZMOD_rtaSync(pg, "m.");
  const heights = () => {
    let got = null;
    pg.eq.paintRTA(new Proxy({}, { get: (o, k) => (k === "lineToArray" ? (p) => (got = p) : () => {}), set: () => true }));
    return plain(got).map((p) => p[1]);
  };
  const on = heights();
  assert.ok(on[at] > on[20] + 30, "the line dips");
  ctx.Data.data["m.procBypass"] = 1;
  const off = heights();
  delete ctx.Data.data["m.procBypass"];
  assert.strictEqual(off[at], off[20], "the channel skips its EQ: flat");
});
test("EQ spectrum: a step of the scale moves the picture in about half a second, no jump", () => {
  const G = (top, code, now) => ctx.DLZMOD_rtaGlideTop(top, code, now);
  ctx.DLZMOD_rtaGlideTop.code = undefined;
  assert.strictEqual(G(-6, 1, 1000), -6, "starts on the top");
  const once = G(6, 1, 1033);
  assert.ok(once > -6 && once < -5, "a 12 dB step: under a dB in one step");
  let v = once;
  for (let t = 1066; t <= 3000; t += 33) v = G(6, 1, t);
  assert.ok(Math.abs(v - 6) < 0.3, "as good as there in two seconds");
  assert.strictEqual(G(-12, 2, 3033), -12, "another channel: afresh");
  assert.strictEqual(G(-30, 2, 4500), -30, "after a pause of over a second: afresh");
});
test("EQ spectrum: on the EQ curve's dB scale, so a -15 dB cut dips as far as the curve", () => {
  rtaReset();
  const pg = eqPage();
  pg.eq.gainRange = 15;
  ctx.DLZMOD_rtaShown(pg, true);
  ctx.DLZMOD_rtaSync(pg, "m.");
  const dbs = Array(20).fill(-20);
  ctx.DLZMOD_rtaVu(rtaMsg(dbs), 1000);
  const flat = plain(ctx.DLZMOD_rtaAnim().target);
  dbs[5] = -35;
  ctx.DLZMOD_rtaVu(rtaMsg(dbs), 2100);   // after a pause of over a second: afresh, the cut at once
  const cut = plain(ctx.DLZMOD_rtaAnim().target);
  const k = cut.indexOf(Math.min(...cut));
  assert.ok(Math.abs(flat[k] - cut[k] - 0.5) < 0.01, "15 dB = half the height, as the curve's ±15 dB (" + (flat[k] - cut[k]) + ")");
  ctx.DLZMOD_rtaVu(rtaMsg(Array(20).fill(-70)), 2200);
  assert.strictEqual(ctx.DLZMOD_rtaAnim().target, null, "silent message: gone at once, not after the average");
  const quiet = Array(20).fill(-70);
  for (let t = 2300; t <= 2900; t += 100) ctx.DLZMOD_rtaVu(rtaMsg(quiet), t);
  quiet[5] = -30;
  ctx.DLZMOD_rtaVu(rtaMsg(quiet), 3000);
  assert.ok(ctx.DLZMOD_rtaAnim().target, "sound after a quiet stretch: shown at once, while the average still rises");
});
test("EQ spectrum: a touch counts as this step's frame; Mackie's touch handlers still run", () => {
  rtaReset();
  const calls = [];
  const saved = ctx.Events;
  ctx.Events = { eventPointerDown(...a) { calls.push(["down", this === ctx.Events, ...a]); return "d"; },
    eventPointerMove() { calls.push(["move"]); }, eventPointerUp() { calls.push(["up"]); } };
  ctx.DLZMOD_rtaHookTouch.done = false;
  try {
    const pg = eqPage();
    ctx.DLZMOD_rtaShown(pg, true);
    ctx.DLZMOD_rtaShown(pg, true);   // shown again: wrapped once
    ctx.DLZMOD_rtaSync(pg, "m.");
    const before = ctx.DLZMOD_rtaNow();
    assert.strictEqual(ctx.Events.eventPointerDown(10, 20, 0), "d", "its answer passed on");
    ctx.Events.eventPointerMove(11, 20, 0);
    ctx.Events.eventPointerUp(11, 20, 0);
    assert.deepStrictEqual(plain(calls), [["down", true, 10, 20, 0], ["move"], ["up"]], "each once, on Events, with its arguments");
    assert.ok(ctx.DLZMOD_rtaAnim().busyAt >= before, "the touch's time taken");
    ctx.DLZMOD_rtaAnim().busyAt = 1000;
    rtaAt(rtaMsg(Array(20).fill(-20)), 1010);
    assert.strictEqual(pg.eq.got.length, 0, "right after a touch: no frame of its own");
    rtaAt(rtaMsg(Array(20).fill(-20)), 1040);
    assert.strictEqual(pg.eq.got.length, 1, "a step later: frames again");
    ctx.DLZMOD_rtaAnim().later = () => { throw new Error("broken"); };
    assert.doesNotThrow(() => ctx.Events.eventPointerDown(1, 1, 0), "the wrapper never throws into Mackie's handler");
  } finally {
    ctx.Events = saved;
    ctx.DLZMOD_rtaHookTouch.done = false;
  }
});
test("EQ spectrum: a move under a pixel draws no frame but stays in the data, and is drawn once it adds up", () => {
  rtaReset();
  const pg = eqPage();
  ctx.DLZMOD_rtaShown(pg, true);
  ctx.DLZMOD_rtaSync(pg, "m.");
  for (let t = 500; t < 2000; t += 100) rtaAt(rtaMsg(Array(20).fill(-20)), t);
  const n = pg.eq.got.length, a = ctx.DLZMOD_rtaAnim();
  a.drawn = a.shown;
  a.target = a.shown.map((v) => v + 0.6 / 200);   // 0.6 px up: 60 % of it per step
  a.at = 2000;
  ctx.DLZMOD_rtaTick(2000);
  assert.strictEqual(pg.eq.got.length, n, "under a pixel since the last frame: none");
  assert.deepStrictEqual(plain(pg.eq.rtaData), plain(a.shown), "but in the data");
  a.target = a.shown.map((v) => v + 2 / 200);
  a.at = 2100;
  ctx.DLZMOD_rtaTick(2100);
  assert.strictEqual(pg.eq.got.length, n + 1, "a pixel or more: drawn");
});
test("EQ spectrum: touch handlers that cannot be wrapped leave the EQ page working", () => {
  rtaReset();
  const saved = ctx.Events;
  ctx.Events = Object.freeze({ eventPointerDown() {}, eventPointerUp: 1 });
  ctx.DLZMOD_rtaHookTouch.done = false;
  try {
    assert.doesNotThrow(() => ctx.DLZMOD_rtaShown(eqPage(), true));
  } finally {
    ctx.Events = saved;
    ctx.DLZMOD_rtaHookTouch.done = false;
  }
});
test("EQ spectrum: while the screen program is behind, no frames of its own, the picture still moves", () => {
  rtaReset();
  const pg = eqPage();
  ctx.DLZMOD_rtaShown(pg, true);
  ctx.DLZMOD_rtaSync(pg, "m.");
  ctx.wstream = { writableLength: 40000 };
  rtaAt(rtaMsg(Array(20).fill(-20)), 1000);
  assert.strictEqual(pg.eq.got.length, 0, "behind: no frame");
  assert.ok(pg.eq.rtaData && pg.eq.rtaData.length === 128, "but the data moved, for Mackie's next redraw");
  assert.strictEqual(ui.later, 33, "and it checks again");
  ctx.wstream.writableLength = 2000;
  ctx.DLZMOD_rtaTick(1050);
  assert.strictEqual(pg.eq.got.length, 1, "caught up: frames again");
  ctx.wstream = null;
  ctx.DLZMOD_rtaTick(1100);
  assert.strictEqual(pg.eq.got.length, 2, "no pipe (a browser): never behind");
});
test("EQ spectrum: a smooth curve through the bands, never beyond its neighbours", () => {
  const P = (dbs, n) => plain(ctx.DLZMOD_rtaPoints(dbs.map((db) => (240 + 3 * db) / 240), n));
  const dbs = [-40, -20, -50, -10, -30, -30, -45, -12, -50, -35, -40, -20, -50, -10, -30, -30, -45, -12, -50, -35];
  const pts = P(dbs, 200);
  const show = (db) => Math.max(0, Math.min(1, (80 + db) / 80 * 80 / 60 - 20 / 60));
  for (let k = 0; k < 200; k++) {
    const f = 20 * Math.pow(1000, k / 199), x = Math.max(0, Math.min(19, 19 * Math.log(f / 22.4) / Math.log(16000 / 22.4))), j = Math.min(18, Math.floor(x));
    const lo = Math.min(show(dbs[j]), show(dbs[j + 1])) - 1e-9, hi = Math.max(show(dbs[j]), show(dbs[j + 1])) + 1e-9;
    assert.ok(pts[k] >= lo && pts[k] <= hi, `point ${k} (${Math.round(f)} Hz) between its bands`);
  }
});
test("EQ spectrum: an error in it never reaches Mackie's meters (same parseVuData call)", () => {
  rtaReset();
  const pg = eqPage();
  pg.eq.update = () => {
    throw new Error("broken widget");
  };
  ctx.DLZMOD_rtaShown(pg, true);
  ctx.DLZMOD_rtaSync(pg, "m.");
  assert.doesNotThrow(() => ctx.DLZMOD_rtaVu(rtaMsg(Array(20).fill(-20))));
  assert.doesNotThrow(() => ctx.DLZMOD_rtaTick(), "nor the animation's timer");
  assert.doesNotThrow(() => ctx.DLZMOD_rtaVu({ "dlzmod.rta": "not base64!" }));
});
test("EQ spectrum: in the meters' colour of the look on screen, stronger with High contrast", () => {
  rtaReset();
  const saved = ctx.DLZMOD_applyTheme.look;
  try {
    ctx.DLZMOD_applyTheme.look = undefined;
    assert.strictEqual(ctx.DLZMOD_rtaColor(), "rgba(156, 204, 86, 0.85)", "Mackie's look");
    ctx.DLZMOD_applyTheme.look = { colors: { green: "#3ab0e0" } };
    const pg = eqPage();
    ctx.DLZMOD_rtaShown(pg, true);
    ctx.DLZMOD_rtaSync(pg, "i.0.");
    ctx.DLZMOD_rtaVu(rtaMsg(Array(20).fill(-20)), 1000);
    assert.strictEqual(pg.eq.rtaStrokeColor, "rgba(58, 176, 224, 0.85)", "the owner's colour");
    settings({ "dlzmod.rta": 1, "dlzmod.theme": 1 });
    ctx.DLZMOD_rtaVu(rtaMsg(Array(20).fill(-20)), 2000);
    assert.strictEqual(pg.eq.rtaStrokeColor, "rgba(58, 176, 224, 1)", "High contrast, at the next message");
  } finally {
    ctx.DLZMOD_applyTheme.look = saved;
  }
});
test("EQ spectrum: the bands as the curve's points, -60 dBFS at the bottom, nothing for silence", () => {
  const P = (dbs, n) => plain(ctx.DLZMOD_rtaPoints(dbs.map((db) => (240 + 3 * db) / 240), n));
  assert.strictEqual(P(Array(20).fill(-80)), null, "silence");
  assert.strictEqual(P(Array(20).fill(-61)), null, "everything below the bottom");
  assert.strictEqual(ctx.DLZMOD_rtaPoints([0.5, 0.5]), null, "too few bands");
  const flat = P(Array(20).fill(-30));
  assert.strictEqual(flat.length, 64);
  assert.ok(flat.every((v) => Math.abs(v - 0.5) < 1e-9), "-30 dBFS: halfway up, everywhere");
  const top = P(Array(20).fill(6));
  assert.ok(top.every((v) => v === 1), "over 0 dBFS: at the top");
  // one loud band at 1 kHz: the peak where 1 kHz is on the curve's 20 Hz - 20 kHz log scale
  const dbs = Array(20).fill(-60);
  dbs[11] = 0;
  const pts = P(dbs, 101);
  const peak = pts.indexOf(Math.max(...pts));
  const f = 20 * Math.pow(1000, peak / 100);
  assert.ok(f > 900 && f < 1150, "the peak at " + Math.round(f) + " Hz");
  assert.strictEqual(pts[0], 0, "20 Hz: the lowest band's level");
  // the ends take the outer bands
  const ends = P([-12, ...Array(18).fill(-60), -24], 64);
  assert.ok(Math.abs(ends[0] - 0.8) < 1e-9 && Math.abs(ends[63] - 0.6) < 1e-9, JSON.stringify([ends[0], ends[63]]));
});

test("the top sheet's clear: once, then again only after something used the sheet", () => {
  const env = ctx.$ENV;
  const clears = [];
  const ui = { w: 1024, h: 600, fctx: { clearRect: (...a) => clears.push(a) } };
  try {
    ctx.$ENV = { isNode: true };
    ctx.DLZMOD_fgEmpty = false;
    ctx.DLZMOD_fgClear(ui);
    assert.deepStrictEqual(clears, [[0, 0, 1024, 600]], "not known to be empty: cleared");
    ctx.DLZMOD_fgClear(ui);
    assert.strictEqual(clears.length, 1, "known to be empty: left out");
    ctx.DLZMOD_fgEmpty = false;
    ctx.DLZMOD_fgClear(ui);
    assert.strictEqual(clears.length, 2, "used since: cleared");
    ctx.$ENV = { isNode: false };
    ctx.DLZMOD_fgEmpty = false;
    ctx.DLZMOD_fgClear(ui);
    ctx.DLZMOD_fgClear(ui);
    assert.strictEqual(clears.length, 4, "a browser's canvas is not tracked: always cleared");
  } finally {
    ctx.$ENV = env;
    ctx.DLZMOD_fgEmpty = false;
  }
});

test("a widget's background: left out only under its page, only in a full redraw", () => {
  const need = (w, full) => {
    ctx.DLZMOD_fullRedraw = full;
    const r = ctx.DLZMOD_bgNeeded(w);
    ctx.DLZMOD_fullRedraw = false;
    return r;
  };
  const list = { bgColor: "#141414" }, other = { bgColor: "#141414" };
  for (const widgetName of ["PageSnapshots", "PageMedia"]) {
    const page = { widgetName, list };
    list.parent = page;
    other.parent = page;
    assert.strictEqual(need(list, true), false);
    assert.strictEqual(need(list, false), true, "redrawn on its own it wipes its old contents");
    assert.strictEqual(need(other, true), true, "not the page's list: the page did not paint under it");
  }
  const fx = { bgColor: "#000000" };
  for (const widgetName of ["PageReverb", "PageDelay", "MainMixer"]) {
    fx.parent = { widgetName, bgColor: "#000000" };
    assert.strictEqual(need(fx, true), false);
    assert.strictEqual(need(fx, false), true);
    fx.parent.bgColor = "#111111";
    assert.strictEqual(need(fx, true), true, "another colour under it");
  }
  const map = ctx.DLZMOD_drawColor.map;
  ctx.DLZMOD_drawColor.map = { "#000001": "#000000" };
  fx.parent = { widgetName: "MainMixer", bgColor: "#000001" };
  fx.bgColor = "#000000";
  assert.strictEqual(need(fx, true), false, "the Overview's own colour, drawn as the strip's");
  ctx.DLZMOD_drawColor.map = { "#000001": "#223344" };
  assert.strictEqual(need(fx, true), true, "the owner's own background: the strip stays");
  ctx.DLZMOD_drawColor.map = map;
  assert.strictEqual(need({ parent: { widgetName: "Popup" } }, true), true);
  assert.strictEqual(need({}, true), true, "no parent");
  assert.strictEqual(need({ _CACHING: true, parent: { widgetName: "PageMedia" } }, true), true, "its own cache");
});

test("eq band 4: a preset without it means the band flat, in both forms, on Data.apply's scale", () => {
  const { DLZMOD_eqOld: old, Data } = ctx;
  assert.strictEqual(old(null), null);
  const comp = { thresh: -30 };
  assert.strictEqual(old(comp), comp, "another kind of preset as it is");
  const eq = { "b1.gain": 2 };
  assert.deepStrictEqual({ ...old(eq) }, { "b1.gain": 2, "b4.gain": 0 });
  assert.deepStrictEqual({ ...eq }, { "b1.gain": 2 }, "the preset read stays as it is");
  assert.deepStrictEqual({ ...old({ "eq.b1.gain": 2 }) }, { "eq.b1.gain": 2, "eq.b4.gain": 0 });
  const four = { "b1.gain": 2, "b4.gain": 5 };
  assert.strictEqual(old(four), four, "a preset with band 4 keeps it");
  ui.applied = [];
  Data.apply("i.0.eq.", eq);
  assert.deepStrictEqual({ ...ui.applied.pop()[1] }, { "b1.gain": 2, "b4.gain": 0 });
  Data.apply("i.0.eq.", eq, [], 0);
  assert.strictEqual(ui.applied.pop()[1], eq, "raw 0-1 values: no dB value goes in");
});

test("eq band 4: its knobs sit on the stand-ins, bands 1-3 and the HP filter on their own keys", () => {
  const { DLZMOD_eqKnobs: knobs } = ctx;
  const panel = () => ["eq.hp.freq", "eq.bX.freq", "eq.bX.gain", "eq.bX.q", "eqBand"].map((key) => ({ control: { key } }));
  const b4 = knobs(panel(), "i.1.", "b4");
  assert.deepStrictEqual(Array.from(b4, (e) => e.control.key), ["eq.hp.freq", "a.1.pan", "f.0.pan", "f.1.pan", "eqBand"]);
  assert.deepStrictEqual(Array.from(ctx.DLZMOD_knobs.steps).slice(1), ["i.1.eq.b4.freq", "i.1.eq.b4.gain", "i.1.eq.b4.q"]);
  assert.strictEqual(0 in ctx.DLZMOD_knobs.steps, false, "knob 1 stays the HP filter");
  const b3 = knobs(panel(), "i.1.", "b3");
  assert.deepStrictEqual(Array.from(b3, (e) => e.control.key), panel().map((e) => e.control.key));
  assert.strictEqual(ctx.DLZMOD_knobs.steps.length, 0, "back on band 3 no knob steps band 4");
});

test("knobs: a panel entry with stepKey sits on the stand-in of its place, the steps move the setting", () => {
  const { DLZMOD_knobs: knobs, DLZMOD_knobStep: step, Data } = ctx;
  const mine = { title: "Ceiling", stepKey: "dlzmod.x", control: { key: "dlzmod.x", color: "c" } };
  const stock = { title: "HP", control: { key: "i.0.eq.hp.freq", color: "d" } };
  const list = knobs([stock, mine, mine, null, mine]);
  assert.strictEqual(list[0], stock, "Mackie's own entry as it was");
  assert.strictEqual(list[1].control.key, "a.1.pan");
  assert.strictEqual(list[1].control.color, "c");
  assert.strictEqual(list[2].control.key, "f.0.pan");
  assert.strictEqual(list[3], null);
  assert.strictEqual(list[4], mine, "no stand-in for the fifth");
  assert.strictEqual(mine.control.key, "dlzmod.x", "the page's own list stays");
  Data.data["dlzmod.x"] = 0.5;
  step({ knob: 1, steps: 4 });
  assert.strictEqual(Data.data["dlzmod.x"], 0.55);
  step({ knob: 1, steps: -100 });
  assert.strictEqual(Data.data["dlzmod.x"], 0, "stops at the end of the range");
  step({ knob: 1, steps: 200 });
  assert.strictEqual(Data.data["dlzmod.x"], 1);
  const before = ui.sets.length;
  step({ knob: 0, steps: 1 });
  step({ knob: 3, steps: 1 });
  step(null);
  assert.strictEqual(ui.sets.length, before, "a knob without a setting moves nothing");
  knobs([stock]);
  step({ knob: 1, steps: 1 });
  assert.strictEqual(ui.sets.length, before, "the next page's panel replaces them");
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
