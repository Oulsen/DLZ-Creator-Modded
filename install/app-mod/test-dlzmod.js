// Tests for dlzmod.js (the app mod): node install/app-mod/test-dlzmod.js
// Loads the file in a vm context, as it runs once appended to app.js, with small stand-ins for the
// Mackie UI globals it uses (E1Button, askConfirm, showMessage, showToast, Font, Color, $FA, EXTERNAL)
// and for the browser (fetch, document). What the stand-ins record is what the tests look at.
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ui = { buttons: [], popups: [], toasts: [], links: [], fetches: [] };
const ctx = vm.createContext({
  setTimeout, clearTimeout, console: { log() {}, error() {} },
  EXTERNAL: false,
  E1Button: function (parent, p) {
    Object.assign(this, p);
    this.parent = parent;
    ui.buttons.push(this);
  },
  askConfirm: (text, opts, yes) => ui.popups.push({ kind: "confirm", text, opts: opts || {}, yes }),
  showMessage: (text, opts) => ui.popups.push({ kind: "message", text, opts: opts || {} }),
  showToast: (text) => ui.toasts.push(text),
  Font: { font: (w, s) => w + " " + s, fa: (s) => "fa " + s },
  Color: { main: "main", confirm: "confirm", deny: "deny", red: "red", blue: "blue", white: "white" },
  $FA: { times: "times" },
  fetch: () => Promise.reject(new Error("no fetch set")),
  document: {
    createElement: () => ({ click() {
      ui.links.push({ href: this.href, download: this.download });
    }, remove() {} }),
    body: { appendChild() {} },
  },
});
vm.runInContext(fs.readFileSync(path.join(__dirname, "dlzmod.js"), "utf8"), ctx);
const plain = (o) => o && JSON.parse(JSON.stringify(o));   // objects from the vm context
const tick = (ms) => new Promise((r) => setTimeout(r, ms));
const reset = () => {
  for (const k of Object.keys(ui)) ui[k].length = 0;
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
