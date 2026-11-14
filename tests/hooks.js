// The mod's hooks in Mackie's code exist in the mod (no dump needed; GitHub runs it too):
//   node tests/hooks.js
// install/patch.py's replacements call the mod's own functions (DLZMOD_*) from inside Mackie's code.
// node --check cannot see a name that is not defined: a hook renamed or removed in the mod passes every
// syntax check and only throws on the mixer (in startGUI: no screen). Checks: every DLZMOD_ name in each
// target's patch tables (APP_PATCHES, SERVER_PATCHES, the graph tables) is defined at the top level of
// that target's mod file (app-mod/dlzmod.js, server-mod/dlzmod-server.js, graph-mod/dlzmod-graph.js),
// or by the patches themselves; and controls that the check can fail.
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8").replace(/\r\n/g, "\n");
const py = read("install/patch.py");

// each target's tables: from its first table to the next target's (the tables are in this order)
const TARGETS = [
  ["app", "\nAPP_PATCHES = [", "install/app-mod/dlzmod.js"],
  ["server", "\nSERVER_PATCHES = [", "install/server-mod/dlzmod-server.js"],
  ["graph", "\nGRAPH_SPECTRUM_PATCHES = [", "install/graph-mod/dlzmod-graph.js"],
];
const END = "\nTARGETS = {";

let ok = 0, bad = 0;
const check = (cond, what) => {
  if (cond) ok++;
  else { bad++; console.log("FAIL: " + what); }
};

// a Python table's text without its comment lines (they name hooks in prose, e.g. "DLZMOD_src*")
const tables = (from, to) => {
  const a = py.indexOf(from), b = py.indexOf(to, a + 1);
  if (a < 0 || b < 0) return null;
  return py.slice(a, b).split("\n").filter((l) => !/^\s*#/.test(l)).join("\n");
};
// the names a patch calls or reads: DLZMOD_ followed by a lower-case letter (upper case are message
// types and placeholders, e.g. DLZMOD_RELEASE_STATE, %%DLZMOD_VERSION%%)
const used = (text) => [...new Set(text.match(/\bDLZMOD_[a-z]\w*/g) || [])].sort();
// the names a JS text defines: a function, or a var/let/const (also later ones in one statement)
const defined = (js) => {
  const s = new Set();
  for (const m of js.matchAll(/\bfunction\s*\*?\s*(DLZMOD_\w+)\s*\(/g)) s.add(m[1]);
  for (const m of js.matchAll(/\b(?:var|let|const)\s+([^;]*)/g))
    for (const d of m[1].matchAll(/(?:^|,)\s*(DLZMOD_\w+)\s*(?:=|,|$)/g)) s.add(d[1]);
  for (const m of js.matchAll(/^(DLZMOD_\w+)\s*=(?!=)/gm)) s.add(m[1]);
  return s;
};
const missing = (names, defs) => names.filter((n) => !defs.has(n));

const starts = TARGETS.map((t) => t[1]).concat(END);
TARGETS.forEach(([name, from, modFile], i) => {
  const text = tables(from, starts[i + 1]);
  check(text !== null, `${name}: tables not found in patch.py (${from.trim()})`);
  if (text === null) return;
  const names = used(text);
  check(names.length > 0, `${name}: no DLZMOD_ hooks found in its tables`);
  const defs = defined(read(modFile));
  for (const n of defined(text)) defs.add(n);   // a patch may define a name itself
  const miss = missing(names, defs);
  check(miss.length === 0, `${name}: called from patch.py but not defined in ${modFile}: ${miss.join(", ")}`);
  console.log(`${name}: ${names.length} hooks, ${names.length - miss.length} defined in ${modFile}`);
});

// controls: the check must be able to fail
check(missing(["DLZMOD_gone"], defined("function DLZMOD_here() {}")).length === 1,
  "control: a hook the mod does not define is not caught");
check(missing(["DLZMOD_a", "DLZMOD_b"], defined("let x = 1, DLZMOD_a = 2;\nvar DLZMOD_b;")).length === 0,
  "control: a hook defined by let/var is not seen");
check(used("x = 'DLZMOD_RELEASE_STATE'; DLZMOD_go();").join() === "DLZMOD_go",
  "control: message types are taken for hooks, or a call is missed");
check(missing(used(tables(TARGETS[0][1], starts[1]) || ""), defined(read(TARGETS[1][2]))).length > 0,
  "control: the app's hooks all pass against the server mod (the check cannot tell the files apart)");

console.log(`hooks: ok ${ok}, FAIL ${bad}`);
process.exit(bad ? 1 : 0);
