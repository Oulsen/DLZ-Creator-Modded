// The top sheet's clear (#243) in the patched app.js, without a screen (tests/patches.sh runs it with the
// dump's node): Mackie's own wrapObject and clearFg, cut out of the patched file, on a stand-in canvas.
//   node tests/overlay-check.js <patched app.js>
// Checks: the clear is left out only while the sheet is known to be empty; every kind of fctx command
// (a drawing call, a setting, a helper, the dim colour) brings it back; ctx commands do not; a new
// connection to glesgui does; and in a browser it is never left out.
const fs = require("fs");
const vm = require("vm");
const assert = require("assert");

const appFile = process.argv[2];
if (!appFile) {
  console.error("usage: node overlay-check.js <patched app.js>");
  process.exit(2);
}
const src = fs.readFileSync(appFile, "utf8");
const cut = (from, to) => {
  const a = src.indexOf(from), b = src.indexOf(to, a);
  assert.ok(a >= 0 && b > a, `not found: ${from}`);
  return src.slice(a, b);
};
const wrapObject = cut("function wrapObject(t,e){", "var UI=class{");
const clearFg = cut("clearFg(){", "clearFgRect(t,e,i,s){");
const fgClear = cut("function DLZMOD_fgClear(ui) {", "function DLZMOD_bgNeeded(w) {");
const onopen = cut("canvasWebsocket.onopen=()=>{", "console.log(\"[WS TO GLESGUI] CONNECTED\")") + "0}";

function setup(isNode) {
  const c = vm.createContext({ console, $ENV: { isNode }, PIPELINE_DEBUG: 0, DLZMOD_drawColor: (s, v) => v });
  vm.runInContext(`let canvasWebsocketStash=[],canvasWebsocketOpen=!1,canvasWebsocket={},DLZMOD_fgEmpty=!1;
    ${fgClear}\n${wrapObject}
    const plain={clearRect(){},fillRect(){},beginPath(){},fRect(){this.fillRect()},drawText(){},fillStyle:""};
    var ui={w:1024,h:600,alternativeClear:!1,overlayBgColor:null,needDrawFrame:!1,
      fctx:wrapObject("fctx",plain),ctx:wrapObject("ctx",plain),${clearFg}};
    ${onopen}
    var sent=()=>canvasWebsocketStash.filter(x=>x.obj=="fctx"&&x.call=="clearRect").length;
    var flag=()=>DLZMOD_fgEmpty; var open=()=>canvasWebsocket.onopen();`, c);
  return { ui: c.ui, sent: c.sent, flag: c.flag, open: c.open };
}

let n = 0;
const check = (name, f) => {
  f();
  n++;
  console.log("ok " + name);
};

check("the first clear goes out, a second one on an empty sheet does not", () => {
  const { ui, sent, flag } = setup(true);
  assert.strictEqual(flag(), false);
  ui.clearFg();
  assert.strictEqual(sent(), 1);
  assert.strictEqual(flag(), true);
  ui.clearFg();
  assert.strictEqual(sent(), 1);
  assert.strictEqual(ui.needDrawFrame, true, "the frame is still asked for");
});
check("the main screen's commands leave the sheet empty", () => {
  const { ui, sent } = setup(true);
  ui.clearFg();
  ui.ctx.fillRect(0, 0, 9, 9);
  ui.ctx.fillStyle = "#123456";
  ui.ctx.fRect("#000", 0, 0, 9, 9);
  ui.clearFg();
  assert.strictEqual(sent(), 1);
});
for (const [what, use] of [
  ["a drawing call", (f) => f.fillRect(0, 0, 9, 9)],
  ["a setting", (f) => { f.fillStyle = "#123456"; }],
  ["a helper that draws", (f) => f.fRect("#000", 0, 0, 9, 9)],
  ["a helper that sends nothing itself", (f) => f.drawText("x", 0, 0)],
  ["a small clear (a list's scroll bar)", (f) => f.clearRect(10, 10, 100, 3)],
]) {
  check(`${what} on the sheet brings the clear back`, () => {
    const { ui, sent } = setup(true);
    ui.clearFg();
    const before = sent();
    use(ui.fctx);
    const small = sent() - before;
    ui.clearFg();
    assert.strictEqual(sent(), before + small + 1);
  });
}
check("the dim behind a popup: painted over an empty sheet, the next clear goes out", () => {
  const { ui, sent } = setup(true);
  ui.clearFg();
  ui.overlayBgColor = "#000";
  ui.clearFg();
  assert.strictEqual(sent(), 1);
  ui.overlayBgColor = null;
  ui.clearFg();
  assert.strictEqual(sent(), 2);
});
check("after connecting to glesgui the sheet counts as unknown", () => {
  const { ui, sent, open } = setup(true);
  ui.clearFg();
  open();
  ui.clearFg();
  assert.strictEqual(sent(), 2);
});
check("in a browser the clear always goes out", () => {
  const { ui, sent } = setup(false);
  ui.clearFg();
  ui.clearFg();
  assert.strictEqual(sent(), 2);
});
console.log(`${n} checks`);
