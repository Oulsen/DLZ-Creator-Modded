// The mod's hooks in Mackie's code exist in the mod (no dump needed; GitHub runs it too):
//   node tests/hooks.js
// install/patch.py's replacements call the mod's own functions and variables (DLZMOD_*) from inside
// Mackie's code. node --check cannot see a name that is not defined: a hook renamed or removed in the
// mod passes every syntax check and only throws on the mixer (in startGUI: no screen). Checks: every
// DLZMOD_ name in each target's patch tables (APP_*, SERVER_*, GRAPH_* in patch.py) is defined at the
// top level of that target's mod file (app-mod/dlzmod.js, server-mod/dlzmod-server.js,
// graph-mod/dlzmod-graph.js, which the graph and graph-full targets share); that every table sits in
// its own target's part of patch.py and no DLZMOD_ name is outside those parts (nothing skipped); and
// controls that the check can fail.
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8").replace(/\r\n/g, "\n");

let ok = 0, bad = 0;
const check = (cond, what) => {
  if (cond) ok++;
  else { bad++; console.log("FAIL: " + what); }
};

// patch.py without its comment lines (they name hooks in prose, e.g. "DLZMOD_src*")
const code = (py) => py.split("\n").filter((l) => !/^\s*#/.test(l)).join("\n");
// the names a patch calls, reads or sets: DLZMOD_ and a name with a lower-case letter in it; ALL-CAPS
// names are message types and placeholders (DLZMOD_RELEASE_STATE, %%DLZMOD_VERSION%%)
const used = (text) => [...new Set((text.match(/\bDLZMOD_\w+/g) || []).filter((n) => /[a-z]/.test(n.slice(7))))].sort();
// the names a mod file defines at its top level: a function or a var/let/const at the start of a line
// (the mod files define everything there; a comment, a nested function or a name passed as an argument
// does not count)
const defined = (js) => new Set([...js.matchAll(
  /^(?:(?:async\s+)?function\s*\*?\s*|(?:var|let|const)\s+)(DLZMOD_\w+)\s*(?:\(|=|;|$)/gm)].map((m) => m[1]));
const missing = (names, defs) => names.filter((n) => !defs.has(n));

// patch.py's targets, in the order their tables appear: from the first table to the next target's
// first, the last one up to TARGETS
const TARGETS = [
  ["app", "APP_", "install/app-mod/dlzmod.js"],
  ["server", "SERVER_", "install/server-mod/dlzmod-server.js"],
  ["graph", "GRAPH_", "install/graph-mod/dlzmod-graph.js"],
];
// split patch.py (comment lines out) at the first table of each target; returns null when the tables
// are not in that order or a table of one target sits in another's part
function split(py) {
  const src = code(py);
  const starts = TARGETS.map(([, prefix]) => src.search(new RegExp(`^${prefix}\\w*PATCH(?:ES)?\\s*=`, "m")));
  const end = src.search(/^TARGETS\s*=\s*\{/m);
  const cuts = starts.concat(end);
  if (cuts.some((c) => c < 0) || cuts.some((c, i) => i && c <= cuts[i - 1])) return null;
  const parts = TARGETS.map((t, i) => src.slice(cuts[i], cuts[i + 1]));
  // every table is defined in its own target's part
  for (const m of src.matchAll(/^([A-Z][A-Z0-9_]*PATCH(?:ES)?)\s*=/gm)) {
    const i = TARGETS.findIndex(([, prefix]) => m[1].startsWith(prefix));
    if (i < 0 || m.index < cuts[i] || m.index >= cuts[i + 1]) return { stray: m[1] };
  }
  return { parts, outside: src.slice(0, cuts[0]) + src.slice(end) };
}

const py = read("install/patch.py");
const s = split(py);
check(s !== null && !s.stray, s && s.stray
  ? `patch.py: table ${s.stray} is outside its target's part (APP_, SERVER_, GRAPH_ in that order, before TARGETS)`
  : "patch.py: the APP_, SERVER_ and GRAPH_ tables or TARGETS not found in that order");
if (s && !s.stray) {
  const outside = used(s.outside);
  check(outside.length === 0, `patch.py: DLZMOD_ names outside the targets' tables, not checked: ${outside.join(", ")}`);
  TARGETS.forEach(([name, , modFile], i) => {
    const names = used(s.parts[i]);
    check(names.length > 0, `${name}: no DLZMOD_ hooks found in its tables`);
    const miss = missing(names, defined(read(modFile)));
    check(miss.length === 0, `${name}: used by patch.py but not defined at the top of ${modFile}: ${miss.join(", ")}`);
    console.log(`${name}: ${names.length} hooks, ${names.length - miss.length} defined in ${modFile}`);
  });
}

// controls: the check must be able to fail
const defs = defined([
  "function DLZMOD_here() {}",
  "async function DLZMOD_later(x) {}",
  "let DLZMOD_flag = !1;",
  "const DLZMOD_table = [",
  "let a = f(1, DLZMOD_arg, 2);",
  "// function DLZMOD_old() was renamed",
  "function outer() {",
  "  function DLZMOD_inner() {}",
  "}",
].join("\n"));
check([...defs].sort().join() === "DLZMOD_flag,DLZMOD_here,DLZMOD_later,DLZMOD_table",
  `control: top-level definitions only (not an argument, a comment or a nested function): ${[...defs].sort().join()}`);
check(used("x = 'DLZMOD_RELEASE_STATE'; DLZMOD_go(); DLZMOD_EQ4reset(); '%%DLZMOD_VERSION%%'").join() === "DLZMOD_EQ4reset,DLZMOD_go",
  "control: message types and placeholders are taken for hooks, or a hook with capitals is missed");
check(split("APP_PATCHES = [\n]\nSERVER_PATCHES = [\n]\nAPP_LATE_PATCHES = [\n]\nGRAPH_PATCHES = [\n]\nTARGETS = {\n}") !== null
  && split("APP_PATCHES = [\n]\nSERVER_PATCHES = [\n]\nAPP_LATE_PATCHES = [\n]\nGRAPH_PATCHES = [\n]\nTARGETS = {\n}").stray === "APP_LATE_PATCHES",
  "control: an app table among the server's is not caught");
const sp = split("X = 'DLZMOD_early()'\nAPP_PATCHES = [\n]\nSERVER_PATCHES = [\n]\nGRAPH_PATCHES = [\n]\nTARGETS = {\n}");
check(sp && used(sp.outside).join() === "DLZMOD_early", "control: a hook outside the tables is not seen");
if (s && !s.stray)
  check(missing(used(s.parts[0]), defined(read(TARGETS[1][2]))).length > 0,
    "control: the app's hooks all pass against the server mod (the check cannot tell the files apart)");

console.log(`hooks: ok ${ok}, FAIL ${bad}`);
process.exit(bad ? 1 : 0);
