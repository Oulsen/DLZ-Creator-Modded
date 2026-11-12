// The patched audio graph against Mackie's, without dspserver (tests/patches.sh runs it with the dump's
// node): both graph files run in a stand-in for dspserver's prelude (createBuffer, configureVU,
// stringRange and its flattenGraph, which keeps each nested list's current buffer to itself), and the
// flat block lists are compared.
//   node tests/graph-check.js <stock mixergraph-dlzlite.js> <patched one> <install/app-mod/dlzmod.js>
//   node tests/graph-check.js <stock mixergraph.js> <patched one> <install/app-mod/dlzmod.js>
// Checks (#131, graph-mod/dlzmod-graph.js), on both models' graphs:
// - every block of Mackie's is there, in the same order, on the same buffer, with the same parameters
// - the mod's blocks write only the mod's own buffers; nothing of Mackie's writes them
// - one tap per channel buffer, right after that channel's "dynin" meter, with the dlzmod.rta value
//   the app mod gives that channel's EQ page (DLZMOD_rtaCode); the buffer cleared before the first
//   tap, the analyser after the last; its meters as the VU group dlzmod.rta, with the app's bands
// - Mackie's VU groups as they were
// - #25: band 4 right after every band 3, the same block on the band's own keys, and nothing else on
//   those keys. It changes Mackie's audio path on purpose, so the checks above run without it
// - #60: each headphone's solo by its Hear Solo key, its computer send on its own USB pair; the
//   checks above see those blocks put back as stock's
// - #18: each mic into the ducking trigger buffer by its key, one AutoDuckSource on that buffer after
//   the mics, every AutoDuck on its strip's key and the settings; the checks above see those blocks
//   put back as stock's
const fs = require("fs");
const vm = require("vm");
const assert = require("assert");

const [stockFile, patchedFile, appFile] = process.argv.slice(2);
if (!appFile) {
  console.error("usage: node graph-check.js <stock graph> <patched graph> <dlzmod.js>");
  process.exit(2);
}

// the graph file in a fresh stand-in prelude: the flat block list it compiles (when it calls
// compileGraph: what it pushes later never runs) and its VU groups
function run(file) {
  const vus = {};
  let blocks = null;
  const ctx = vm.createContext({ console, print() {}, debug() {} });
  ctx.globalThis = ctx;
  class MixBuffer {
    constructor(name) {
      this.name = "" + name;
      ctx[this.name] = this;
    }
  }
  Object.assign(ctx, {
    MixBuffer,
    createBuffer: (d) => (Array.isArray(d) ? d.map((n) => new MixBuffer(n)) : new MixBuffer(d)),
    stringRange(N, s) {
      const arr = [];
      for (let i = 0; i < N; i++) {
        for (const a of typeof s === "string" ? [s] : s) arr.push(a.replace(/#/g, "" + i));
      }
      return arr;
    },
    configureVU(data) {
      for (const [k, v] of Object.entries(data)) vus[k] = v.map(String);
    },
    keyUsed() {},
    ignoreKeys() {},
    ignoreKey() {},
    compileGraph(graph) {
      if (blocks) throw new Error("compileGraph called twice");
      blocks = flatten(graph);
    },
  });
  const name = (v) => (v instanceof MixBuffer ? "buffer:" + v.name : v);
  function flatten(graph, cur = null, out = []) {
    for (const item of graph) {
      if (item instanceof MixBuffer) cur = item;
      else if (Array.isArray(item)) flatten(item, cur, out);
      else if (item && item.type) {
        const p = {};
        for (const [k, v] of Object.entries(item)) if (k !== "type") p[k] = name(v);
        out.push({ type: item.type, buf: p.buf ? p.buf.replace(/^buffer:/, "") : cur && cur.name, p });
      } else throw new Error("unknown graph entry " + JSON.stringify(item));
    }
    return out;
  }
  vm.runInContext("globalThis.ain = createBuffer(stringRange(32, 'ain#'));"
    + "globalThis.aout = createBuffer(stringRange(32, 'aout#'));"
    + "globalThis.cin = createBuffer(['cin0', 'cin1']); globalThis.cout = createBuffer(['cout0', 'cout1', 'cout2', 'cout3']);", ctx);
  vm.runInContext(fs.readFileSync(file, "utf8"), ctx, { filename: file });
  if (!blocks) throw new Error(file + " never calls compileGraph");
  return { blocks, vus };
}

const stock = run(stockFile), patched = run(patchedFile);
const usesB4 = (b) => JSON.stringify(b.p).includes(".eq.b4.");
const isB4 = (b) => b.type === "EqBand" && usesB4(b);
const withB4 = patched.blocks;
patched.blocks = withB4.filter((b) => !isB4(b));

let fail = 0;
const check = (ok, what) => {
  console.log((ok ? "ok    " : "FAIL  ") + what);
  if (!ok) fail = 1;
};

// #60 the headphones: solo on each headphone whose Hear Solo (a.N.dlzmodSolo) is on, where stock has
// headphone 1 only, and each headphone's computer send on its own USB pair (2 + 2N, 3 + 2N), where
// stock has all on USB 3/4 (usbOuts 2, 3). Only these two expressions change, so the blocks are
// checked and put back as stock's for the checks below
const SOLO = /\(\(@a\.(\d+)\.dlzmodSolo && \(/;
const SEND = /^@a\.(\d+)\.send2usb && !@settings\.rec\.toComputer\? usbOuts\[(\d+)\] : temp$/;
const hpSolo = [], hpSend = [];
patched.blocks = patched.blocks.map((b) => {
  const p = Object.assign({}, b.p);
  let m;
  if (b.type === "CopyFrom" && (m = SOLO.exec(p.src || ""))) {
    hpSolo.push(+m[1]);
    p.src = p.src.replace(SOLO, `(((${m[1]} == 0) && (`);
  } else if (b.type === "CopyTo" && (m = SEND.exec(p.dest || ""))) {
    const hp = +m[1], slot = +m[2];
    hpSend.push([hp, slot]);
    p.dest = p.dest.replace(`usbOuts[${slot}]`, `usbOuts[${slot - 2 * hp}]`);
  } else return b;
  return Object.assign({}, b, { p });
});
const nhp = new Set(stock.blocks.filter((b) => /@a\.\d+\.send2usb/.test(b.p.dest || "")).map((b) => b.p.dest)).size / 2;
const pairs = (n) => [...Array(n).keys()].flatMap((i) => [i, i]);
check(nhp >= 2 && JSON.stringify(hpSolo) === JSON.stringify(pairs(nhp)),
  `headphones: solo on each of the ${nhp} by its Hear Solo, left and right (${hpSolo.join(" ")})`);
check(JSON.stringify(hpSend) === JSON.stringify(pairs(nhp).map((i, k) => [i, 2 + 2 * i + (k % 2)])),
  `headphones: each computer send on its own USB pair (${hpSend.map(([i, s]) => `${i + 1}:${s + 1}`).join(" ")})`);

// #18 ducking: each mic into the trigger buffer (dlzmodDuckKey) by its trigger key, where stock has
// its one AutoDuckSource (mic 1); one AutoDuckSource on that buffer after the last mic, before any
// strip it ducks; every AutoDuck on its strip's key, the depth and the speed (stock's times passed
// as they were). The taps and the AutoDucks are checked and put back as stock's for the checks below
const TAP = /^!@autoDucking \|\| !@dlzmod\.duck\.src\.(\d+)$/;
const DUCK = /^@autoDucking && @dlzmod\.duck\.on\.([ipvs](?:\.\d+)?)(?: && !@dlzmod\.duck\.src\.(\d+))?$/;
const duckTaps = [], ducks = [];
let duckBad = [];
patched.blocks = patched.blocks.map((b, at) => {
  let m;
  if (b.type === "GainWithLinMixTo" && b.p.dest === "buffer:dlzmodDuckKey") {
    m = TAP.exec(b.p.bypass || "");
    if (!m || b.p.src !== "buffer:workBuf" || b.p.gain !== 0 || b.buf !== "workBuf") duckBad.push(JSON.stringify(b));
    const i = m ? +m[1] : -1;
    duckTaps.push({ i, at });
    return { type: "AutoDuckSource", buf: b.buf, p: { enable: `(${i} === 0) && @autoDucking`, threshold: -25 } };
  }
  if (b.type !== "AutoDuck") return b;
  m = DUCK.exec(b.p.enable || "");
  const mic = m && m[1].startsWith("i.");
  const t = mic ? [500, 500, 250] : [1000, 1000, 1000];
  const ok = m && (mic ? m[2] === m[1].slice(2) : m[2] === undefined)
    && b.p.atten === "DLZMOD_duckDepth(@dlzmod.duck.depth)"
    && ["attack", "release", "hold"].every((k, n) => b.p[k] === `DLZMOD_duckTime(@dlzmod.duck.speed, ${n}, ${t[n]})`);
  if (!ok) duckBad.push(JSON.stringify(b));
  ducks.push({ key: m ? m[1] : "?", at });
  const p = mic ? { enable: `(${m[2]} > 0) && @autoDucking`, atten: -15, attack: 500, release: 500, hold: 250 }
    : { enable: "@autoDucking", atten: -15 };
  return Object.assign({}, b, { p });
});
const nmic = stock.blocks.filter((b) => b.type === "AutoDuckSource").length;
check(duckBad.length === 0, "ducking: taps and AutoDucks in the mod's form" + (duckBad.length ? ": " + duckBad.join(" ") : ""));
check(nmic >= 2 && JSON.stringify(duckTaps.map((t) => t.i)) === JSON.stringify([...Array(nmic).keys()]),
  `ducking: each of the ${nmic} mics into the trigger buffer by its own key (${duckTaps.map((t) => t.i).join(" ")})`);
// positions in patched.blocks, as the taps' and the AutoDucks' (band 4 left out); the taps there are
// stock's sources again, so the mod's one is the one on its buffer, and the graph has no other
const duckSrc = patched.blocks.map((b, at) => ({ b, at })).filter((x) => x.b.type === "AutoDuckSource" && x.b.buf === "dlzmodDuckKey");
const lastTap = Math.max(...duckTaps.map((t) => t.at));
const firstStrip = Math.min(...ducks.filter((d) => !d.key.startsWith("i.")).map((d) => d.at));
const duckClear = patched.blocks.findIndex((b) => b.type === "Clear" && b.buf === "dlzmodDuckKey");
check(withB4.filter((b) => b.type === "AutoDuckSource").length === 1 && duckSrc.length === 1 && duckSrc[0].b.p.enable === "@autoDucking"
  && duckSrc[0].b.p.threshold === "DLZMOD_duckThreshold(@dlzmod.duck.threshold)"
  && duckSrc[0].at > lastTap && duckSrc[0].at < firstStrip && duckClear >= 0 && duckClear < Math.min(...duckTaps.map((t) => t.at)),
  "ducking: the trigger buffer cleared before the first tap, its one AutoDuckSource after the last mic, before the other strips");
// every dlzmod.duck key the graph binds is in the server's defaults: a binding with a key not set never
// applies (an AutoDuckSource left at its -200 dB threshold would duck everything all the time)
{
  const srv = fs.readFileSync(require("path").join(__dirname, "..", "install", "server-mod", "dlzmod-server.js"), "utf8");
  const fn = /function DLZMOD_duckKeys\(\) \{[\s\S]*?\n\}/.exec(srv);
  const s = vm.createContext({});
  if (fn) vm.runInContext(fn[0], s);
  const defaults = fn ? Object.keys(s.DLZMOD_duckKeys()) : [];
  const bound = new Set();
  for (const b of withB4) for (const v of Object.values(b.p)) for (const m of String(v).matchAll(/@(dlzmod\.duck\.[0-9a-zA-Z._]*[0-9a-zA-Z_])/g)) bound.add(m[1]);
  const missing = [...bound].filter((k) => !defaults.includes(k));
  check(bound.size > 0 && missing.length === 0,
    `ducking: the ${bound.size} keys the graph binds all in the server's defaults` + (missing.length ? ": missing " + missing.join(" ") : ""));
}
const stockDucked = [...Array(nmic).keys()].map((i) => `i.${i}`).concat(
  model0().filter((k) => !k.startsWith("i.")).flatMap((k) => [k, k]));
check(JSON.stringify(ducks.map((d) => d.key)) === JSON.stringify(stockDucked),
  `ducking: every strip's AutoDuck on its own key (${ducks.map((d) => d.key).join(" ")})`);
// the strips with an AutoDuck in stock's graph order, from the meters this graph has (mics, samples,
// players, virtual channels)
function model0() {
  const vus = new Set(stock.blocks.filter((b) => b.type === "MaxMeter").map((b) => b.p.vu));
  const pl = [0, 1, 2].filter((i) => vus.has(`vuPlDynIn${i}`)).map((i) => `p.${i}`);
  const vi = [0, 1].filter((i) => vus.has(`vuViDynIn${i}`)).map((i) => `v.${i}`);
  return ["s", ...pl, ...vi];
}

// #25 band 4: follows each band 3 at once, the same block with b3 -> b4
function checkB4() {
  const twin = (b) => JSON.parse(JSON.stringify(b).replace(/\.eq\.b3\./g, ".eq.b4."));
  const b3s = withB4.filter((b) => b.type === "EqBand" && JSON.stringify(b.p).includes(".eq.b3."));
  const followed = withB4.every((b, i) => {
    if (!b3s.includes(b)) return true;
    try {
      assert.deepStrictEqual(withB4[i + 1], twin(b));
      return true;
    } catch (e) {
      console.log(`      no band 4 after ${JSON.stringify(b)}`);
      return false;
    }
  });
  check(b3s.length > 0 && followed, `band 4: right after each of the ${b3s.length} band 3 blocks, the same block on its own keys`);
  check(withB4.filter(isB4).length === b3s.length, "band 4: no other block of it");
  check(withB4.filter(usesB4).length === b3s.length, "band 4: nothing else reads its keys");
}

const app = fs.readFileSync(appFile, "utf8");
const list = (fn) => {
  const m = new RegExp("function " + fn + "\\([^)]*\\) \\{\\s*return (\\[[^\\]]*\\])").exec(app);
  assert.ok(m, fn + " in the app mod");
  return JSON.parse(m[1]);
};
const graphSrc = fs.readFileSync(patchedFile, "utf8");
const gm = /function DLZMOD_rtaFreqs\(\) \{\s*return (\[[^\]]*\])/.exec(graphSrc);
assert.ok(gm, "DLZMOD_rtaFreqs in the graph mod");
const freqs = JSON.parse(gm[1]);
assert.deepStrictEqual(list("DLZMOD_rtaFreqs"), freqs, "the app and the graph have the same bands");

const OWN = new Set(["dlzmodRta", "dlzmodRtaBand", "dlzmodDuckKey"]);
// a block with a dest writes there (its own buffer is only where it sits), the others their buffer
const writes = (b) => [b.p.dest ? String(b.p.dest).replace(/^buffer:/, "") : b.buf];
const ours = (b) => writes(b).some((w) => OWN.has(w)) || String(b.p.vu || "").startsWith("dlzmodRta");
// Mackie's blocks: the patched list without ours is the stock list
const theirs = patched.blocks.filter((b) => !ours(b));
check(theirs.length === stock.blocks.length, `graph: Mackie's ${stock.blocks.length} blocks all there (${theirs.length})`);
let same = theirs.length === stock.blocks.length;
for (let i = 0; same && i < theirs.length; i++) {
  try {
    assert.deepStrictEqual(theirs[i], stock.blocks[i]);
  } catch (e) {
    same = false;
    console.log(`      first difference at Mackie's block ${i}: ${JSON.stringify(stock.blocks[i])} / ${JSON.stringify(theirs[i])}`);
  }
}
check(same, "graph: Mackie's blocks unchanged, in the same order, on the same buffers");
check(stock.blocks.every((b) => !writes(b).some((w) => OWN.has(w))), "graph: nothing of Mackie's writes the mod's buffers");
const mine = patched.blocks.filter(ours);
check(mine.every((b) => writes(b).every((w) => OWN.has(w))), `graph: the mod's ${mine.length} blocks write only its own buffers`);

// the taps: after which meter, and the channel's code as the app's EQ page has it
const codes = list("DLZMOD_rtaCode");   // the app's list, index + 1 = the code, for both models
const meterOf = { "i.0.": "vuInDynIn0", "i.1.": "vuInDynIn1", "i.2.": "vuInDynIn2", "i.3.": "vuInDynIn3",
  "p.0.": "vuPlDynIn0", "p.1.": "vuPlDynIn1", "p.2.": "vuPlDynIn2",
  "v.0.": "vuViDynIn0", "v.1.": "vuViDynIn1", "s.": "vuSmpDynIn", "m.": "vuMasterDynIn" };
check(codes.length === 11 && codes.every((p) => meterOf[p]), "app: the 11 channels with an EQ page on either model: " + codes.join(" "));
// this model's: those whose meter this graph has, which must be every "dynin" meter it has
const stockMeters = new Set(stock.blocks.filter((b) => b.type === "MaxMeter").map((b) => b.p.vu));
const prefixes = codes.filter((p) => stockMeters.has(meterOf[p]));
const unknown = [...stockMeters].filter((m) => /DynIn/.test(m) && !prefixes.some((p) => meterOf[p] === m));
const model = stockMeters.has("vuViDynIn0")
  ? ["XS", ["i.0.", "i.1.", "p.0.", "p.1.", "v.0.", "v.1.", "s.", "m."]]
  : ["full-size", ["i.0.", "i.1.", "p.0.", "p.1.", "s.", "m.", "i.2.", "i.3.", "p.2."]];
check(unknown.length === 0 && JSON.stringify(prefixes) === JSON.stringify(model[1]),
  `${model[0]}: ${prefixes.length} channels with a meter after the EQ: ${prefixes.join(" ")}${unknown.length ? "; none for " + unknown : ""}`);
const taps = [];
patched.blocks.forEach((b, i) => {
  if (b.p.dest !== "buffer:dlzmodRta") return;
  let j = i - 1;
  while (j >= 0 && patched.blocks[j].p.dest === "buffer:dlzmodRta") j--;
  taps.push({ i, b, after: patched.blocks[j] });
});
for (const p of prefixes) {
  const code = codes.indexOf(p) + 1;
  const t = taps.filter((x) => x.b.p.bypass === `@dlzmod.rta != ${code}`);
  const stereo = !p.startsWith("i.");
  const okTap = t.length === (stereo ? 2 : 1) && t.every((x) => x.b.type === "GainWithLinMixTo"
    && x.after && x.after.type === "MaxMeter" && x.after.p.vu === meterOf[p]
    && x.b.p.gain === (stereo ? -6 : 0)
    && (stereo ? new Set(t.map((y) => y.b.p.src)).size === 2 : true));
  check(okTap, `tap ${p} (dlzmod.rta ${code}): after ${meterOf[p]}, ${stereo ? "both sides at -6 dB" : "0 dB"}`
    + (okTap ? "" : `: ${JSON.stringify(t.map((x) => [x.b, x.after && x.after.p.vu]))}`));
  const metered = new Set(stock.blocks.filter((b) => b.type === "MaxMeter" && b.p.vu === meterOf[p]).map((b) => "buffer:" + b.buf));
  check(t.length === metered.size && t.every((x) => metered.has(x.b.p.src)), `tap ${p}: reads the buffer(s) that meter reads`);
}
const wantTaps = prefixes.reduce((n, p) => n + (p.startsWith("i.") ? 1 : 2), 0);
check(taps.length === wantTaps, `taps: ${wantTaps} (${taps.length}), none for a channel this model has not`);
const clear = patched.blocks.findIndex((b) => b.type === "Clear" && b.buf === "dlzmodRta");
check(clear >= 0 && clear < Math.min(...taps.map((t) => t.i)), "the mod's buffer cleared before the first tap");

// the analyser: per band a copy, a high-pass a quarter octave below, a low-pass a quarter octave above
// (at most 20 kHz, EqBand's top) and a meter, after the last tap, at the end
const an = patched.blocks.filter((b) => b.buf === "dlzmodRtaBand");
const firstAn = patched.blocks.findIndex((b) => b.buf === "dlzmodRtaBand");
check(firstAn > Math.max(...taps.map((t) => t.i)) && firstAn === patched.blocks.length - an.length,
  "analyser: after the last tap, at the end of the graph");
const near = (a, b) => Math.abs(a - b) < 1e-6;
const bandsOk = an.length === 4 * freqs.length && freqs.every((f, k) => {
  const [c, hp, lp, m] = an.slice(4 * k, 4 * k + 4);
  return c.type === "CopyFrom" && c.p.src === "buffer:dlzmodRta" && hp.type === "EqBand" && hp.p.kind === 4
    && near(hp.p.freq, f / 2 ** 0.25) && lp.type === "EqBand" && lp.p.kind === 3 && near(lp.p.freq, Math.min(20000, f * 2 ** 0.25))
    && m.type === "MaxMeter" && m.p.vu === "dlzmodRta" + k;
});
check(bandsOk, `analyser: ${freqs.length} bands (copy, high-pass, low-pass, meter): ${freqs.join(" ")} Hz`);
const vuOk = JSON.stringify(patched.vus["dlzmod.rta"]) === JSON.stringify(freqs.map((f, k) => "dlzmodRta" + k));
check(vuOk, "VU group dlzmod.rta: one meter per band");
const rest = Object.assign({}, patched.vus);
delete rest["dlzmod.rta"];
check(JSON.stringify(rest) === JSON.stringify(stock.vus), `Mackie's ${Object.keys(stock.vus).length} VU groups as they were`);

checkB4();

process.exit(fail);
