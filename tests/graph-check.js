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
const ours = (b) => writes(b).some((w) => OWN.has(w)) || String(b.p.vu || "").startsWith("dlzmodRta");
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
const mine = patched.blocks.filter(ours);
check(mine.every((b) => writes(b).every((w) => OWN.has(w))), `graph: the mod's ${mine.length} blocks write only its own buffers`);

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

// the analyser: per band a copy, a band-pass and a meter, after the last tap, at the end
const an = patched.blocks.filter((b) => b.buf === "dlzmodRtaBand");
const firstAn = patched.blocks.findIndex((b) => b.buf === "dlzmodRtaBand");
check(firstAn > Math.max(...taps.map((t) => t.i)) && firstAn === patched.blocks.length - an.length,
  "analyser: after the last tap, at the end of the graph");
const bandsOk = an.length === 3 * freqs.length && freqs.every((f, k) => {
  const [c, eq, m] = an.slice(3 * k, 3 * k + 3);
  return c.type === "CopyFrom" && c.p.src === "buffer:dlzmodRta" && eq.type === "EqBand" && eq.p.kind === 6
    && eq.p.freq === f && m.type === "MaxMeter" && m.p.vu === "dlzmodRta" + k;
});
check(bandsOk, `analyser: ${freqs.length} bands (copy, band-pass, meter): ${freqs.join(" ")} Hz`);
const vuOk = JSON.stringify(patched.vus["dlzmod.rta"]) === JSON.stringify(freqs.map((f, k) => "dlzmodRta" + k));
check(vuOk, "VU group dlzmod.rta: one meter per band");
const rest = Object.assign({}, patched.vus);
delete rest["dlzmod.rta"];
check(JSON.stringify(rest) === JSON.stringify(stock.vus), `Mackie's ${Object.keys(stock.vus).length} VU groups as they were`);

process.exit(fail);
