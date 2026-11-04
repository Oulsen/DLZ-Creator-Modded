// The patched audio graph against Mackie's, without dspserver (tests/patches.sh runs it with the dump's
// node): both graph files run in a stand-in for dspserver's prelude (createBuffer, configureVU,
// stringRange and its flattenGraph, which keeps each nested list's current buffer to itself), and the
// flat block lists are compared.
//   node tests/graph-check.js <stock mixergraph-dlzlite.js> <patched one> <install/app-mod/dlzmod.js>
// Checks (#131, graph-mod/dlzmod-graph.js):
// - every block of Mackie's is there, in the same order, on the same buffer, with the same parameters
// - the mod's blocks write only the mod's own buffers; nothing of Mackie's writes them
// - one tap per channel buffer, right after that channel's "dynin" meter, with the dlzmod.rta value
//   the app mod gives that channel's EQ page (DLZMOD_rtaCode); the buffer cleared before the first
//   tap, the analyser after the last; its meters as the VU group dlzmod.rta, with the app's bands
// - Mackie's VU groups as they were
// Checks (#59): the master's gate is Mackie's commented-out block, in its place; the limiter sits on
// the master out only, right after the mix is copied there, and does nothing until its keys are set
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

const OWN = new Set(["dlzmodRta", "dlzmodRtaBand"]);
// a block with a dest writes there (its own buffer is only where it sits), the others their buffer
const writes = (b) => [b.p.dest ? String(b.p.dest).replace(/^buffer:/, "") : b.buf];
// #59: the limiter (its meters and compressor, on the master out) and the master's gate (Mackie's
// own block, commented out in the stock graph) change the master's sound on purpose: checked on
// their own below, not as the mod's buffers
const isLim = (b) => String(b.p.vu || "").startsWith("dlzmodLim");
const isGate = (b) => b.type === "Gate" && b.p.vu === "vuMasterGate";
const ours = (b) => writes(b).some((w) => OWN.has(w)) || String(b.p.vu || "").startsWith("dlzmodRta")
  || isLim(b) || isGate(b);
let fail = 0;
const check = (ok, what) => {
  console.log((ok ? "ok    " : "FAIL  ") + what);
  if (!ok) fail = 1;
};

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
const mine = patched.blocks.filter((b) => ours(b) && !isLim(b) && !isGate(b));
check(mine.every((b) => writes(b).every((w) => OWN.has(w))), `graph: the mod's ${mine.length} blocks write only its own buffers`);

// #59 the master's gate: one, Mackie's block as it is commented out, between the master's EQ meter
// (vuMasterDynIn) and its compressor, on both sides
const at = (pred) => patched.blocks.findIndex(pred);
const gates = patched.blocks.filter(isGate), gi = at(isGate);
const g = gates[0];
// its neighbours among Mackie's blocks (the EQ spectrum's master tap sits right after that meter)
const prev = patched.blocks.slice(0, gi).filter((b) => !ours(b)).pop();
const next = patched.blocks.slice(gi + 1).find((b) => !ours(b));
check(gates.length === 1 && g.buf === "masterL" && g.p.right === "buffer:masterR"
  && ["bypass", "thresh", "depth", "attack", "hold", "release"].every((k) => g.p[k] === `@m.gate.${k}`)
  && prev && prev.type === "MaxMeter" && prev.p.vu === "vuMasterDynIn"
  && next && next.type === "EconomyCompressor" && next.p.vu === "vuMasterComp",
"master gate: Mackie's block, m.gate.* keys, after the master's EQ, before its compressor, stereo");

// #59 the limiter: in-meters, the compressor, out-meters on the master out (aout16/aout20), right
// after Mackie copies the mix there; ratio 20 only once both keys have a value, attack 1 ms
const lim = patched.blocks.filter(isLim), li = at(isLim);
const comp = lim.find((b) => b.type === "Compressor");
const before = patched.blocks[li - 1];
check(lim.length === 5 && lim.every((b) => b.buf === "aout16" || b.buf === "aout20")
  && lim.map((b) => b.p.vu).join() === "dlzmodLimIn,dlzmodLimIn,dlzmodLimGr,dlzmodLimOut,dlzmodLimOut"
  && patched.blocks.slice(li, li + 5).every(isLim)
  && before.type === "CopyFrom" && before.buf === "aout20" && before.p.src === "buffer:masterR",
"limiter: meters and compressor on the master out only, right after the mix is copied there");
check(comp && comp.buf === "aout16" && comp.p.right === "buffer:aout20" && comp.p.attack === 1 && comp.p.knee === 0
  && comp.p.bypass === "@dlzmod.lim.bypass" && comp.p.thresh === "@dlzmod.lim.thresh"
  && comp.p.release === "@dlzmod.lim.release"
  && comp.p.ratio === "(@dlzmod.lim.bypass || @dlzmod.lim.thresh > 0) ? 1 : 20",
"limiter: stereo linked, 1 ms attack, ratio 20 needs both keys (else the block's own ratio 1)");
// the ratio expression itself, as dspserver evaluates it once both keys have a value
const ratioOf = (bypass, thresh) => vm.runInNewContext(String(comp && comp.p.ratio)
  .replace(/@dlzmod\.lim\.bypass/g, String(bypass)).replace(/@dlzmod\.lim\.thresh/g, String(thresh)));
check(comp && ratioOf(0, -1) === 20 && ratioOf(1, -1) === 1 && ratioOf(0, 3) === 1 && ratioOf(0, 0) === 20,
  "limiter: ratio 20 when on with a ceiling at or below 0 dB, else 1");
const keys = /function DLZMOD_keys\(\) \{\s*return (\{[^}]*\});/.exec(app);
const defaults = keys && JSON.parse(keys[1]);
check(!!defaults && defaults["dlzmod.lim.bypass"] === 0 && defaults["dlzmod.lim.thresh"] === -1
  && typeof defaults["dlzmod.lim.release"] === "number",
"limiter: the app mod's defaults have every key it binds (on, ceiling -1 dB, a release)");
check(JSON.stringify(patched.vus["dlzmod.lim"]) === JSON.stringify(["dlzmodLimIn", "dlzmodLimGr", "dlzmodLimOut"]),
  "VU group dlzmod.lim: in, gain reduction, out");

// the taps: after which meter, and the channel's code as the app's EQ page has it
const prefixes = list("DLZMOD_rtaCode");   // the app's list, index + 1 = the code
const meterOf = { "i.0.": "vuInDynIn0", "i.1.": "vuInDynIn1", "p.0.": "vuPlDynIn0", "p.1.": "vuPlDynIn1",
  "v.0.": "vuViDynIn0", "v.1.": "vuViDynIn1", "s.": "vuSmpDynIn", "m.": "vuMasterDynIn" };
check(prefixes.length === 8 && prefixes.every((p) => meterOf[p]), "app: the 8 channels with an EQ page: " + prefixes.join(" "));
const taps = [];
patched.blocks.forEach((b, i) => {
  if (b.p.dest !== "buffer:dlzmodRta") return;
  let j = i - 1;
  while (j >= 0 && patched.blocks[j].p.dest === "buffer:dlzmodRta") j--;
  taps.push({ i, b, after: patched.blocks[j] });
});
for (const p of prefixes) {
  const code = prefixes.indexOf(p) + 1;
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
check(taps.length === 14, `taps: 14 (${taps.length})`);
const clear = patched.blocks.findIndex((b) => b.type === "Clear" && b.buf === "dlzmodRta");
check(clear >= 0 && clear < Math.min(...taps.map((t) => t.i)), "the mod's buffer cleared before the first tap");

// the analyser: per band a copy, a high-pass half an octave below, a low-pass half an octave above
// (at most 20 kHz, EqBand's top) and a meter, after the last tap, at the end
const an = patched.blocks.filter((b) => b.buf === "dlzmodRtaBand");
const firstAn = patched.blocks.findIndex((b) => b.buf === "dlzmodRtaBand");
check(firstAn > Math.max(...taps.map((t) => t.i)) && firstAn === patched.blocks.length - an.length,
  "analyser: after the last tap, at the end of the graph");
const near = (a, b) => Math.abs(a - b) < 1e-6;
const bandsOk = an.length === 4 * freqs.length && freqs.every((f, k) => {
  const [c, hp, lp, m] = an.slice(4 * k, 4 * k + 4);
  return c.type === "CopyFrom" && c.p.src === "buffer:dlzmodRta" && hp.type === "EqBand" && hp.p.kind === 4
    && near(hp.p.freq, f / Math.SQRT2) && lp.type === "EqBand" && lp.p.kind === 3 && near(lp.p.freq, Math.min(20000, f * Math.SQRT2))
    && m.type === "MaxMeter" && m.p.vu === "dlzmodRta" + k;
});
check(bandsOk, `analyser: ${freqs.length} bands (copy, high-pass, low-pass, meter): ${freqs.join(" ")} Hz`);
const vuOk = JSON.stringify(patched.vus["dlzmod.rta"]) === JSON.stringify(freqs.map((f, k) => "dlzmodRta" + k));
check(vuOk, "VU group dlzmod.rta: one meter per band");
const rest = Object.assign({}, patched.vus);
delete rest["dlzmod.rta"];
delete rest["dlzmod.lim"];
check(JSON.stringify(rest) === JSON.stringify(stock.vus), `Mackie's ${Object.keys(stock.vus).length} VU groups as they were`);

process.exit(fail);
