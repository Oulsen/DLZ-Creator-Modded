// DLZ Creator Modded additions to Mackie's /srv/app.js, appended by install/patch.py.
// Only function declarations here: they are hoisted, so the patched Mackie code can call them
// even when the UI is built before this part of the script has run.

// the mod's own colour, where the owner chose none (#21)
function DLZMOD_yellow() {
  return "#FFD600";
}

// the Mod page's colour: what it shows on or selected (switches, choices, its tabs), its name, the
// line on its panels and status texts. The mod's yellow, or the owner's accent colour like Mackie's
// pages (#21), so the page is one piece with the rest: the palette value that stands for it
// (DLZMOD_tokens), so it follows a change of look. With a look (the Colors tab's swatches): that
// look's colour, its theme's selection colour, or Mackie's green.
function DLZMOD_accent(look) {
  if (look) return look.fader || (look.colors && look.colors.main) || "#9CCC56";
  return DLZMOD_applyTheme.accent || DLZMOD_yellow();
}

// Filled in from the repo's VERSION file by patch.py
function DLZMOD_version() {
  return "%%DLZMOD_VERSION%%";
}

function DLZMOD_tabLabel() {
  return "DLZ Creator Modded";
}

// Settings tab bar: About (short label) and the Mod tab (last) get fixed widths, Mackie's other
// tabs share the rest equally. Same 2 px gaps as the original; the last tab takes the rounding
// remainder.
function DLZMOD_layoutTabs(page) {
  if (!page.banks) return;
  const gap = 2;
  const aboutW = 120;
  const modW = 230;
  const n = page.banks.length - 1;
  const each = (page.w - aboutW - modW - gap * n) / (n - 1) | 0;
  let x = 0;
  page.banks.forEach((b, i) => {
    const w = i === n ? page.w - x : i === n - 1 ? aboutW : each;
    b.setGeometry(x, null, w, null);
    x += w + gap;
  });
}

// Mod settings live in the hub state like Mackie's own keys (saved in srv_data.json, cleared by a
// factory reset). app.js refuses keys its Data store does not know yet ([NOT IN DATA]), so ours
// are added with their defaults before use; the hub's INIT then brings the saved values. Plain JSON
// (apply-mod.sh's set_mod_defaults reads it). dlzmod.rta is no setting: the channel the EQ spectrum
// measures (#131, DLZMOD_rtaMeasure), none at first.
function DLZMOD_keys() {
  return { "dlzmod.hideHeader": 0, "dlzmod.meterMode": 0, "dlzmod.preColor": 0, "dlzmod.preLevel": 0,
    "dlzmod.meterMarks": 0, "dlzmod.theme": 0, "dlzmod.bgColor": 0, "dlzmod.faderColor": 0, "dlzmod.recDate": 0,
    "dlzmod.rta": 0 };
}

// The owner's own colours on top of the theme (#21): the background, and an accent colour for the
// faders' knobs, the meters and what is shown selected (tabs, the channel; on the Mod page
// DLZMOD_accent). Index 0 keeps the theme's; the rest are what dlzmod.bgColor / dlzmod.faderColor save, so
// only ever add to the end. All dark backgrounds: the text stays white or Mackie's light grey.
// "Tinted" (no colour here): a dark shade of the accent (DLZMOD_look).
function DLZMOD_bgColors() {
  return [null, ["Tinted", null]];
}

// Mackie's own channel colours (Color.channel), so they sit with the strips' colours as one family;
// lighter with High contrast. Green is the default's already. Red a calmer red than Mackie's clip red
function DLZMOD_faderColors() {
  return [null, ["White", "#f9f9f9", "#ffffff"], ["Yellow", "#ffc909", "#ffd633"], ["Orange", "#f9a42b", "#ffb84d"],
    ["Red", "#e0533f", "#f0705c"], ["Teal", "#21baac", "#40d6c8"], ["Blue", "#1ba9d5", "#45c3ee"],
    ["Purple", "#a276b3", "#bc95cc"]];
}

// Mackie's greys under a tinted background, as palette keys and as colours written into the code:
// buttons, panels, meter tracks, the tab bars (DLZMOD_tint)
function DLZMOD_surfaceKeys() {
  return ["buttonBg", "buttonBgPopup", "buttonBgDark", "menuBg", "bankButtons", "knobOff", "panelValueBg", "vuBg",
    "vuBgEdit", "bgPopup", "stripBorder", "bgSeparator", "subNavButtonSeparator"];
}

function DLZMOD_surfaceLiterals() {
  return ["#303030", "#393939", "#404040", "#252525", "#202020", "#222222", "#333333", "#2a2a2a", "#3a3a3a"];
}

// a grey (#rrggbb, r = g = b) moved toward the hue of a dark background: its tint, a little
// stronger, so the step stays visible on the lighter greys. Anything else: null
function DLZMOD_tint(grey, bg) {
  const rgb = (c) => typeof c === "string" && /^#[0-9a-f]{6}$/i.test(c) && [1, 3, 5].map((i) => parseInt(c.substr(i, 2), 16));
  const g = rgb(grey), b = rgb(bg);
  if (!g || !b || g[0] !== g[1] || g[1] !== g[2]) return null;
  const avg = (b[0] + b[1] + b[2]) / 3;
  return "#" + g.map((v, i) => Math.max(0, Math.min(255, Math.round(v + (b[i] - avg) * 1.6)))
    .toString(16).padStart(2, "0")).join("");
}

// a colour at strength a over another (#rrggbb both)
function DLZMOD_mix(hex, under, a) {
  const mix = (i) => {
    const b = parseInt(under.substr(i, 2), 16);
    return Math.round(b + (parseInt(hex.substr(i, 2), 16) - b) * a).toString(16).padStart(2, "0");
  };
  return "#" + mix(1) + mix(3) + mix(5);
}

// a swatch's colour in a theme: the lighter one with High contrast
function DLZMOD_faderTone(c, themeId) {
  return c && (themeId === 1 ? c[2] : c[1]);
}

// the theme with the owner's colours put in: the palette keys and drawn colours they replace
function DLZMOD_look(sel = DLZMOD_lookSel()) {
  const th = DLZMOD_theme(sel.theme);
  const base = DLZMOD_applyTheme.stock || Color;
  const colors = Object.assign({}, th.colors), literals = Object.assign({}, th.literals);
  const fader = DLZMOD_faderColors()[sel.fader];
  const tone = DLZMOD_faderTone(fader, th.id);
  let bg = DLZMOD_bgColors()[sel.bg];
  if (bg && !bg[1]) bg = [bg[0], DLZMOD_mix(tone || colors.main || base.main || "#9CCC56", "#000000", 0.1)];
  if (bg) {
    for (const k of ["bg", "bgOld", "bgDark", "bgDark2", "bgList", "stripBg", "stripNameBg", "subNavButtonBg"]) colors[k] = bg[1];
    // the stereo strips' and LR's own darker panels
    for (const k of ["#1a1a1a", "#171e0d", "#191919"]) literals[k] = bg[1];
    // the greys on it in the same hue (a neutral background leaves them as they are)
    for (const k of DLZMOD_surfaceKeys()) {
      const v = DLZMOD_tint(colors[k] || base[k], bg[1]);
      if (v && v !== (colors[k] || base[k]).toLowerCase()) colors[k] = v;
    }
    for (const k of DLZMOD_surfaceLiterals()) {
      const v = DLZMOD_tint(literals[k] || k, bg[1]);
      if (v && v !== (literals[k] || k).toLowerCase()) literals[k] = v;
    }
  }
  let outline = th.outline;
  if (fader) {
    const c = tone, g = colors.vuGrad || base.vuGrad;
    colors.green = colors.vuPeak = c;
    // the warning colours at the top of the meter stay
    colors.vuGrad = g.map(([at, col]) => [at, at < 0.8 ? c : col]);
    for (const k of ["main", "menuBgActive", "subNavButtonBgActive", "bankButtonsActive", "stripNameBgSelected"]) colors[k] = c;
    if (outline) outline = [outline[0], c];
    // panel edges and the lines between areas a soft shade of it (stronger with High contrast)
    const soft = DLZMOD_mix(c, colors.bg || base.bg || "#000000", th.id === 1 ? 0.6 : 0.35);
    for (const k of ["stripBorder", "bgSeparator", "graphBorders"]) colors[k] = soft;
  }
  return { id: th.id, colors, literals, outline, bg: bg && bg[1], fader: fader ? tone : null };
}

// Themes (#21): each changes only the colours of Mackie's palette (Color) it names, the rest stays
// Mackie's. `literals`: colours written into Mackie's code (and ours) outside the palette, swapped
// where every colour is set for drawing (DLZMOD_drawColor); the FX pages' light panels keep theirs
// (#333, #cccccc, #eee, #232323: not listed). `outline`: Mackie's buttons get its border (white, the
// selected one yellow). The id is what dlzmod.theme saves: never reuse one. Pad and knob LEDs are
// not themed (DLZMOD_ledColor).
function DLZMOD_themes() {
  const white = "#ffffff", line = "#8a8a8a", track = "#707070", yellow = "#ffcc00";
  return [
    { id: 0, name: "Normal", colors: {}, literals: {} },
    { id: 1, name: "High", outline: ["#b0b0b0", yellow], literals: {
      // grey text and marks white
      "#888888": white, "#888": white, "#8c8c8c": white, "#999999": white, "#aaaaaa": white, "#bbb": white,
      "#c8c8c8": white, "#d0d0d0": white, "#efefef": white, "#464646": "#bdbdbd",
      // tracks, marks, disabled icons and the pads' dots a light grey; lines lighter
      "#303030": track, "#393939": track, "#404040": track, "#666666": line, "#363635": line,
      // dark panels black; knobs black in a light ring
      "#1a1a1a": "#000000", "#171e0d": "#000000", "#191919": "#000000", "#181818": "#1e1e1e",
      "#111": "#000000", "#090909": "#bdbdbd",
      // the little arrows on lists and the side panel
      "rgba(255,255,255,0.16)": "rgba(255,255,255,0.7)", "rgba(255,255,255,0.30)": "rgba(255,255,255,0.85)",
      "rgba(255,255,255,0.33)": "rgba(255,255,255,0.85)",
    }, colors: {
      // black behind everything, white text, light lines between areas
      bg: "#000000", bgOld: "#000000", bgDark: "#000000", bgDark2: "#000000", bgList: "#000000",
      bgPopup: "#111111", stripBg: "#000000", stripNameBg: "#000000", subNavButtonBg: "#000000",
      white: white, text: white, gray: "#f2f2f2", gray69: "#bdbdbd", stripNameText: white, menuText: white,
      editPageLabels: white, subNavButtonText: white, buttonTextPopup: white, panelText: white, graphMarks: white,
      white15: "rgba(255,255,255,0.4)", white30: "rgba(255,255,255,0.55)", white60: "rgba(255,255,255,0.8)",
      bgSeparator: line, stripBorder: line, graphBorders: line, subNavButtonSeparator: line, menuSeparator: line,
      // buttons a clear step above the black, selected in the mod's yellow (black text on it)
      buttonBg: "#3a3a3a", buttonBgPopup: "#3a3a3a", buttonBgDark: "#2a2a2a", menuBg: "#3a3a3a",
      bankButtons: "#3a3a3a", knobOff: "#4a4a4a", panelValueBg: "#2a2a2a", vuBg: "#2a2a2a", vuBgEdit: "#2a2a2a",
      main: yellow, menuBgActive: yellow, subNavButtonBgActive: yellow, bankButtonsActive: yellow,
      stripNameBgSelected: yellow,
      // meters and warnings: Mackie's colours, a little lighter
      green: "#a6f04d", vuPeak: "#a6f04d", red: "#ff4a3d", clip: "#ff4a3d", yellow: "#ffde2e",
      confirm: "#3d7a2e", deny: "#b3261e",
      vuGrad: [[0, "#a6f04d"], [0.35, "#a6f04d"], [0.6, "#a6f04d"], [0.85, "#ffde2e"], [0.9, "#ffde2e"], [0.95, "#ff4a3d"]],
    } },
  ];
}

function DLZMOD_theme(id = Data.data["dlzmod.theme"] ?? 0) {
  return DLZMOD_themes().find((t) => t.id === id) || DLZMOD_themes()[0];
}

// the saved theme and own colours
function DLZMOD_lookSel() {
  return { theme: Data.data["dlzmod.theme"] ?? 0, bg: Data.data["dlzmod.bgColor"] ?? 0,
    fader: Data.data["dlzmod.faderColor"] ?? 0 };
}

// Before startGUI builds the pages (patch.py). Widgets copy their colours when they are made, so a
// look cannot be set by changing the palette afterwards. Instead, once, every palette colour a look
// may change gets a value of its own (DLZMOD_tokens), and where a colour is set for drawing
// (DLZMOD_drawColor) that value becomes the chosen look's colour, or Mackie's: a change of look only
// rebuilds that table and repaints the screen (DLZMOD_themeChanged), no restart.
// A theme that fails is no reason for a screen that does not start: Mackie's look, as a stock start.
function DLZMOD_applyTheme() {
  const f = DLZMOD_applyTheme;
  try {
    if (!f.slots) DLZMOD_tokens();
    DLZMOD_setLook();
  } catch (e) {
    console.log("dlzmod: theme not set: " + e);
    DLZMOD_stockLook();
  }
}

// every look there is: the palette colours any of them changes, the colours written into the code
function DLZMOD_allLooks() {
  const looks = [];
  for (const th of DLZMOD_themes()) {
    for (let bg = 0; bg < DLZMOD_bgColors().length; bg++) {
      for (let fader = 0; fader < DLZMOD_faderColors().length; fader++) looks.push(DLZMOD_look({ theme: th.id, bg, fader }));
    }
  }
  return looks;
}

// a colour one step further in blue (#rrggbb or rgba(r,g,b,a)), d steps; anything else: null
function DLZMOD_nudge(c, d) {
  let m = /^#([0-9a-f]{6})$/i.exec(c);
  if (m) {
    const b = parseInt(m[1].substr(4, 2), 16) + d;
    return b < 0 || b > 255 ? null : "#" + m[1].substr(0, 4).toLowerCase() + b.toString(16).padStart(2, "0");
  }
  m = /^rgba\((\d+),(\d+),(\d+),([\d.]+)\)$/.exec(c.replace(/\s/g, ""));
  if (!m) return null;
  const b = +m[3] + d;
  return b < 0 || b > 255 ? null : `rgba(${m[1]},${m[2]},${b},${m[4]})`;
}

// The palette's own values for the colours a look may change, the mod's accent and the Overview's
// background (Mackie writes Color.black there, which also colours text). Each: Mackie's colour moved
// in blue until it is no colour of the palette, of a theme's written into the code or of another
// such value, so on screen it is one step from Mackie's at most and always told apart. Built on a
// copy and put in at the end: nothing half done. The knob rings' colours (K.N.color, sent to the
// fader board) are palette values: they go out as Mackie's colour (DLZMOD_ledColor). Mackie's
// colour lists (channels, auxes, samples) are never themed and stay as they are.
function DLZMOD_tokens() {
  const f = DLZMOD_applyTheme;
  if (!f.stock) f.stock = JSON.parse(JSON.stringify(Color));
  const stock = f.stock, looks = DLZMOD_allLooks();
  const taken = new Set();
  const add = (v) => typeof v === "string" && taken.add(v.toLowerCase().replace(/\s/g, ""));
  for (const v of Object.values(stock)) add(v);
  for (const l of looks) Object.keys(l.literals).forEach(add);
  const own = (c) => {
    for (let i = 1; i < 512; i++) {
      const t = DLZMOD_nudge(c, i % 2 ? (i + 1) / 2 : -i / 2);
      if (t && !taken.has(t)) return taken.add(t), t;
    }
    return null;
  };
  const keys = new Set();
  for (const l of looks) Object.keys(l.colors).forEach((k) => keys.add(k));
  const next = {}, slots = [], back = {};
  for (const k of keys) {
    const v = stock[k], t = typeof v === "string" ? own(v) : null;
    if (!t) continue;   // vuGrad: put in place by DLZMOD_setLook; "transparent"
    next[k] = t;
    back[t] = v;
    slots.push([t, (l) => l.colors[k] ?? v]);
  }
  // what Mackie derives from the palette right after it
  const rgba = Util.hex2rgba;
  if (next.main) {
    for (const p of [75, 50, 30, 10]) {
      next["main" + p] = rgba(next.main, p / 100);
      slots.push([next["main" + p], (l) => rgba(l.colors.main ?? stock.main, p / 100)]);
    }
  }
  const accent = own(DLZMOD_yellow()), ovBg = own(stock.black || "#000000");
  slots.push([accent, (l) => l.fader || DLZMOD_yellow()], [ovBg, (l) => l.bg || stock.black || "#000000"]);
  Object.assign(Color, next);
  Object.assign(f, { slots, back, accent, ovBg, taken, slotOf: new Map(slots), sums: 0 });
  // Mackie's colour sums (DLZMOD_sum): some are worked out once, when a page is built
  for (const fn of ["hex2rgba", "brighter"]) {
    const sum = Util[fn];
    if (typeof sum === "function") Util[fn] = function (c, ...rest) {
      return DLZMOD_sum(sum, this, c, rest);
    };
  }
  const set = Data.set;
  Data.set = function (k, v, ...rest) {
    if (typeof k === "string" && k[0] === "K" && /^K\.\d+\.color$/.test(k)) v = DLZMOD_ledColor(v);
    return set.call(this, k, v, ...rest);
  };
  // in a browser Mackie draws on the canvas itself; the mixer's screen gets the drawing through
  // wrapObject's setters (patch.py)
  if (typeof CanvasRenderingContext2D !== "undefined" && !(typeof $CFG !== "undefined" && $CFG.ctxPipeline)) {
    const P = CanvasRenderingContext2D.prototype;
    for (const prop of ["fillStyle", "strokeStyle"]) {
      const d = Object.getOwnPropertyDescriptor(P, prop);
      if (d && d.set) Object.defineProperty(P, prop, { configurable: true, get: d.get,
        set(v) { d.set.call(this, DLZMOD_drawColor(prop, v)); } });
    }
  }
}

// Util.hex2rgba / Util.brighter of a palette value (DLZMOD_tokens): the sum of the value itself, as
// unique as it, and the table turns it into the same sum of the look's colour, so a colour Mackie
// works out when a page is built (a list's selection colour from Color.main) follows a change too.
// At most 256 such sums (Mackie also sums while drawing, with changing strengths): after that, and
// for any other colour, the sum of the colour on screen
function DLZMOD_sum(sum, self, c, rest) {
  const f = DLZMOD_applyTheme, of = f.slotOf && typeof c === "string" && f.slotOf.get(c);
  const onScreen = () => sum.call(self, DLZMOD_drawColor("fillStyle", c), ...rest);
  if (!of) return onScreen();
  const t = sum.call(self, c, ...rest);
  if (f.slotOf.has(t)) return t;
  if (typeof t !== "string" || f.taken.has(t.toLowerCase().replace(/\s/g, "")) || f.sums >= 256) return onScreen();
  const colour = (l) => sum.call(self, of(l), ...rest);
  f.sums++;
  f.taken.add(t.toLowerCase().replace(/\s/g, ""));
  f.slotOf.set(t, colour);
  f.slots.push([t, colour]);
  if (Object.prototype.hasOwnProperty.call(f.back, c)) f.back[t] = sum.call(self, f.back[c], ...rest);
  if (DLZMOD_drawColor.map) DLZMOD_drawColor.map[t] = colour(f.look || { colors: {} });
  return t;
}

// the saved look on screen: the table from the palette's values to its colours, its outline, the
// meters' colour stops (in place: the meters keep the palette's list and look for it, DLZMOD_vuPaint)
function DLZMOD_setLook() {
  const f = DLZMOD_applyTheme, look = DLZMOD_look();
  const map = {};
  for (const [t, colour] of f.slots || []) map[t] = colour(look);
  // Mackie writes some in capitals ("#AAAAAA"): both spellings
  for (const [k, v] of Object.entries(look.literals)) map[k] = map[k.toUpperCase()] = v;
  const g = Color.vuGrad, stops = look.colors.vuGrad || f.stock.vuGrad;
  if (Array.isArray(g) && Array.isArray(stops)) g.splice(0, g.length, ...JSON.parse(JSON.stringify(stops)));
  f.id = look.id;
  f.look = look;
  DLZMOD_drawColor.map = map;
  DLZMOD_outline.colors = look.outline || null;
}

// Mackie's look: each palette value drawn as Mackie's colour, no outline
function DLZMOD_stockLook() {
  const f = DLZMOD_applyTheme;
  f.look = null;
  f.id = 0;
  const map = {};
  for (const [t, colour] of f.slots || []) map[t] = colour({ colors: {} });
  DLZMOD_drawColor.map = f.slots ? map : null;
  DLZMOD_outline.colors = null;
  const g = typeof Color !== "undefined" && Color.vuGrad, stops = f.stock && f.stock.vuGrad;
  if (Array.isArray(g) && Array.isArray(stops)) g.splice(0, g.length, ...JSON.parse(JSON.stringify(stops)));
}

// the palette colour a value stands for, as Mackie has it (the knob rings, DLZMOD_tokens)
function DLZMOD_ledColor(v) {
  const back = DLZMOD_applyTheme.back || {};
  return typeof v === "string" && Object.prototype.hasOwnProperty.call(back, v) ? back[v] : v;
}

// the Overview's own colours where Mackie writes them into the code (patch.py): its background
// (Color.black, which also colours text on light buttons: its own value, DLZMOD_tokens) and the
// faders' knobs (drawn each time)
function DLZMOD_ovColor(role, c) {
  const f = DLZMOD_applyTheme;
  if (role === "bg") return f.ovBg || c;
  return (f.look && f.look[role]) || c;
}

// a strip fader's knob: the owner's fader colour where Mackie's is white (an aux mix's own colour stays)
function DLZMOD_knobColor(c) {
  return !c || c === Color.white ? DLZMOD_ovColor("fader", Color.white) : c;
}

// a colour set for drawing (fillStyle, strokeStyle) as the look on screen has it
function DLZMOD_drawColor(prop, v) {
  const lit = DLZMOD_drawColor.map;
  if (!lit || typeof v !== "string" || (prop !== "fillStyle" && prop !== "strokeStyle")) return v;
  return Object.prototype.hasOwnProperty.call(lit, v) ? lit[v] : v;
}

// Button.paintBody (patch.py): with a theme's outline, a filled button without a border of its own
// gets one (Mackie's border: off colour, on colour); another look takes it off again
function DLZMOD_outline(b) {
  const c = DLZMOD_outline.colors;
  if (b.dlzmodOutline) {
    if (c) {
      b.borderColors = c;
      return;
    }
    b.border = b.dlzmodOutline.border;
    b.borderColors = b.dlzmodOutline.colors;
    b.dlzmodOutline = null;
    return;
  }
  if (!c || b.border || b.bodyStyle !== "custom" || b.img0) return;
  const fill = b.colors && b.colors[0];
  if (!fill || fill === "transparent" || fill === Color.transparent) return;
  b.dlzmodOutline = { border: b.border, colors: b.borderColors };
  b.border = 2;
  b.borderColors = c;
}

// dlzmod.theme or an own colour changed (on this screen, or on the mixer's while this is a browser):
// the whole screen in the new colours, at once
function DLZMOD_themeChanged() {
  if (!DLZMOD_applyTheme.slots) return;   // before the start set its look: that start takes it
  try {
    DLZMOD_setLook();
  } catch (e) {
    console.log("dlzmod: theme not set: " + e);
    DLZMOD_stockLook();
  }
  if (typeof app !== "undefined" && app && app.update) app.update();
}

// "Meter marks" (Mod page): the mod's yellow and red zones, dB tick marks and the dB numbers beside
// LR; off = Mackie's plain meters. The meters repaint on every VU message; the LR fader, which draws
// the numbers, is repainted on a change.
function DLZMOD_meterMarks() {
  return (Data.data["dlzmod.meterMarks"] ?? 0) !== 0;
}

function DLZMOD_applyMeterMarks() {
  const lr = typeof VU_STRUCT !== "undefined" && VU_STRUCT.m && VU_STRUCT.m.strips && VU_STRUCT.m.strips[0];
  if (lr && lr.sl) lr.sl.update();
}

// "Both": the "before the fader" bar's look (Mod page): colour green or grey, strong or soft over the
// meter background. Green is the strip's own Color.green (a theme's or the owner's fader colour, #21).
// Strengths per colour, compared in the
// sandbox: green still shows on the empty track at 15 % and blurs into the bright bar above 50 %;
// grey vanishes into the track below 25 % and stays apart from the green bar at 60 %.
function DLZMOD_preColor() {
  const green = DLZMOD_lookColor("green", "#9CCC56");
  return [green, "#D0D0D0"][Data.data["dlzmod.preColor"] | 0] || green;
}

// a palette colour of the look on screen (a #rrggbb), else Mackie's
function DLZMOD_lookColor(k, c) {
  const look = DLZMOD_applyTheme.look;
  const v = look && look.colors[k];
  return typeof v === "string" && /^#[0-9a-f]{6}$/i.test(v) ? v : c;
}

function DLZMOD_preAlpha() {
  const grey = (Data.data["dlzmod.preColor"] | 0) === 1;
  return (Data.data["dlzmod.preLevel"] | 0) === 1 ? (grey ? 0.25 : 0.15) : (grey ? 0.6 : 0.5);
}

// Meters. The hub sends every pickup of a strip in each VU message; Mackie's strip meters show
// "post" (after the fader) and their second value is "pre" (before the gain), unused: the strips have
// no havePre. "dlzmod.meterMode" (Mod page): 0 = Mackie; 1 = Both: Mackie's own dim second bar
// (havePre) behind, fed with "gain" (after the gain, before the fader), the clip block also follows
// it (clipping is about the input); 2 = only before the fader. Strips without a gain pickup stay as
// Mackie, except the main meter: its "post" is taken before the master fader (mixergraph), so
// Mackie's bar and Before fader already show that level, and Both computes the bright bar behind the
// fader the way Mackie's own aux meters do (modVuByDb with the fader in dB, 0 when muted); as Mackie
// until the fader's position is known (VtoMix(undefined) is NaN).
// Replaces m.setValue(post, pre) in parseVuData (patched), for vu and vu2; strip = parseVuData's e.
function DLZMOD_vuSet(m, gain, idx, post, pre, strip) {
  const mode = DLZMOD_meterModeNow();
  let g = gain && idx < gain.length ? deconvertVU(gain.charCodeAt(idx) || 0) : null;
  const mix = g === null && mode === 1 && strip && strip.type === E_CH_TYPE.MASTER ? strip.getValue("mix") : null;
  if (typeof mix === "number") {
    g = post;
    post = strip.getValue("mute") ? 0 : modVuByDb(post, VtoMix(mix));
  }
  const both = mode === 1 && g !== null;
  const fill = both ? DLZMOD_dim(DLZMOD_preColor(), DLZMOD_preAlpha()) : null;
  if (both !== !!m.dlzmodPre || (both && m.fillStylePre !== fill)) {   // only ever undo our own havePre
    m.dlzmodPre = both;
    m.havePre = both;
    if (both) m.fillStylePre = fill;
  }
  if (both) {
    m.setValue(post, g);
    if (m.autoClip && g >= m.clipThreshold) m.clip();
  } else {
    m.setValue(mode === 2 && g !== null ? g : post, pre);
  }
}

// a colour at strength a over Mackie's meter background (#393939): the "before the fader" bar
function DLZMOD_dim(hex, a) {
  const c = DLZMOD_dim.cache || (DLZMOD_dim.cache = {});
  const k = hex + a + DLZMOD_lookColor("vuBg", "");
  if (!c[k]) c[k] = DLZMOD_mix(hex, DLZMOD_lookColor("vuBg", "#393939"), a);
  return c[k];
}

// Called from VUMeter.paint (patched) right after the bar: s = bar length, e = full length (px).
// Strip meters (Mackie's channel palette Color.vuGrad) get solid yellow and red zones over the bar
// at Mackie's own colour stops (on the device the gradient is off and the bar is plain green), and
// dB notches. Values are dB-linear, 80 dB for the full length (modVuByDb: 1/80 per dB), top = 0 dB
// [guess until measured with a test tone, #38].
function DLZMOD_vuPaint(m, t, s, e) {
  if (m.gradArr !== Color.vuGrad || m.flipped || e < 40) return;
  // the device never draws Mackie's gradient (VU_GRADIENT); a browser would, under our zones
  // (createGradient puts it into fillStyle). From the next frame on both draw the strip's own solid
  // green (Strip passes fillStyle: Color.green) with the same zones
  if (m.gradient) {
    m.gradient = false;
    m.fillStyle = Color.green;
  }
  if (!DLZMOD_meterMarks()) return;   // Mackie's plain look (Mod page "Meter marks" off)
  const g = m.gradArr;
  // the first stop that is not green in Mackie's own list: an own colour can be Mackie's yellow
  const own = (DLZMOD_applyTheme.stock && DLZMOD_applyTheme.stock.vuGrad) || g;
  const yellow = g[own.findIndex((c) => c[1] !== own[0][1])];
  const red = g[g.length - 1];
  const rect = (from, to) => m.horizontal ? t.fillRect(from, 0, to - from, m.h) : t.fillRect(0, m.h - to, m.w, to - from);
  // zones on the bright bar (0..s) and, dimmed, on the part of the "before the fader" bar above it
  const s2 = m.dlzmodPre ? Math.min(e, e * m.value2 | 0) : 0;
  for (const [stop, colour] of [[yellow, yellow && yellow[1]], [red, red[1]]]) {
    if (!stop) continue;
    const from = e * stop[0] | 0;
    const end = stop === red ? e : e * red[0] | 0;
    if (Math.min(s, end) > from) {
      t.fillStyle = colour;
      rect(from, Math.min(s, end));
    }
    if (Math.min(s2, end) > Math.max(from, s)) {
      t.fillStyle = DLZMOD_dim(colour, DLZMOD_preAlpha());
      rect(Math.max(from, s), Math.min(s2, end));
    }
  }
  // dB scale: tick marks on every channel meter; the numbers only beside the LR meter (one readable
  // scale without crowding every strip), in the gap right of its right bar: left of the meter
  // Mackie's fader marks fill the strip up to its edge
  const marks = [0, -6, -12, -18, -24, -36, -48];   // inside: only hoisted declarations at top level
  t.fillStyle = "rgba(0,0,0,0.8)";
  for (const db of marks) {
    if (db === 0) continue;   // the top edge
    const p = e * (1 + db / 80) | 0;
    rect(p, p + 1);
  }
  const lr = typeof VU_STRUCT !== "undefined" && VU_STRUCT.m && VU_STRUCT.m.strips && VU_STRUCT.m.strips[0];
  const sl = lr && lr.sl;
  if (sl && m === (lr.vu2 || lr.vu) && !m.horizontal && !sl.dlzmodScale) {
    sl.dlzmodScale = true;
    const paint = sl.paint;
    sl.paint = function (c) {
      const r = paint.apply(this, arguments);
      DLZMOD_paintDbScale(c, this, m);
      return r;
    };
    sl.update();
  }
}

// The dB numbers, beside the LR meter only (one readable scale without crowding every strip), in the
// gap right of its right bar: left of the meter Mackie's fader marks fill the strip, and the gap
// belongs to the LR fader (an opaque Slider in the strip's colour, from the meter's edge on), so the
// fader draws them: its paint is wrapped once, for this one fader (DLZMOD_vuPaint). Drawn on the
// fader's own clean background they stay sharp (drawn by the meter, outside its area, they piled up)
// and come back when the knob has passed. No minus sign (everything below the top is negative), at
// the meter's tick marks, on whole pixels; t is in the fader's coordinates.
function DLZMOD_paintDbScale(t, sl, m) {
  if (!DLZMOD_meterMarks()) return;
  // drawn after the fader's own paint, so on top of its knob: leave out a number the knob covers
  // (knob centre: 18 px from the ends of the travel, measured in the sandbox; value 0..1 = bottom..top)
  const knobY = 18 + (1 - (sl.value || 0)) * (sl.h - 36);
  for (const db of [0, -6, -12, -18, -24, -36, -48]) {
    const y = Math.round(m.y - sl.y + Math.max(7, m.h - m.h * (1 + db / 80)));
    if (Math.abs(y - knobY) < (sl.knobRadius || 11) + 7) continue;
    t.drawText(String(-db), m.x + m.w + 2 - sl.x, y, { color: "#c8c8c8", font: Font.font(600, "8pt"), align: "left", valign: "middle" });
  }
}

// #131 the sound behind the EQ curve. The graph mod (graph-mod/dlzmod-graph.js) measures the channel
// whose EQ page the mixer's screen shows in octave bands and sends them with every VU message as
// "dlzmod.rta" (one byte per band, Mackie's VU scale: 0..1 over 80 dB). The screen says which channel
// that is (hub key dlzmod.rta, DLZMOD_rtaCode; the server takes it from the screen only); a browser
// shows it when its EQ page has the same channel. Drawn by Mackie's own spectrum code in the EQ
// curve (EQ.setRTA, paintRTA: a filled line over 20 Hz - 20 kHz, cleared 250 ms after the last data,
// so it goes when the sound stops or the page closes). Mackie's overlay layer for it is not used:
// drawn with the curve (rtaOverlay off), as the widget does on its own without one.

// the bands' centres in Hz, as the graph mod has them
function DLZMOD_rtaFreqs() {
  return [31.5, 63, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];
}

// a channel's dlzmod.rta value from its key prefix (the graph mod's taps have the same numbers);
// 0: none (an FX return, no EQ page open)
function DLZMOD_rtaCode(prefix) {
  return ["i.0.", "i.1.", "p.0.", "p.1.", "v.0.", "v.1.", "s.", "m."].indexOf(prefix) + 1;
}

// the spectrum's line and fill in the meters' colour of the look on screen (the theme's or the
// owner's fader colour, #21), so it follows a change of look; stronger with High contrast. Mackie's
// greys (rgba(200,200,200,0.5), rgba(100,100,100,0.15)) were too dim behind the curve.
function DLZMOD_rtaColors() {
  const c = DLZMOD_lookColor("green", "#9CCC56");
  const rgb = [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16)).join(", ");
  const high = DLZMOD_lookSel().theme === 1;
  return [`rgba(${rgb}, ${high ? 1 : 0.85})`, `rgba(${rgb}, ${high ? 0.35 : 0.25})`];
}

// PageEQ shown or hidden (patch.py; null at startGUI: none open yet). Its channel follows in sync.
function DLZMOD_rtaShown(page, on) {
  if (on) {
    DLZMOD_rtaShown.page = page;
    if (page.eq) page.eq.rtaOverlay = !1;
    return;
  }
  if (page && DLZMOD_rtaShown.page !== page) return;
  DLZMOD_rtaShown.page = null;
  DLZMOD_rtaShown.prefix = "";
  DLZMOD_rtaMeasure(0);
}

// PageEQ.sync (patch.py): the channel on the page; also called while the page is hidden
function DLZMOD_rtaSync(page, prefix) {
  if (DLZMOD_rtaShown.page !== page) return;
  DLZMOD_rtaShown.prefix = prefix;
  DLZMOD_rtaMeasure(DLZMOD_rtaCode(prefix));
}

// the channel the graph mod measures: only the mixer's own screen says
function DLZMOD_rtaMeasure(code) {
  if (!DLZMOD_external() && Data.get("dlzmod.rta") !== code) Data.set("dlzmod.rta", code);
}

// every VU message (parseVuData, patched): the bands onto the open EQ page, when they are its channel's
function DLZMOD_rtaVu(t) {
  const page = DLZMOD_rtaShown.page, s = t && t["dlzmod.rta"];
  if (!page || !page.eq || typeof s !== "string") return;
  const code = DLZMOD_rtaCode(DLZMOD_rtaShown.prefix);
  if (!code || Data.get("dlzmod.rta") !== code) return;
  let raw;
  try {
    raw = atob(s);
  } catch (e) {
    return;
  }
  const pts = DLZMOD_rtaPoints(Array.from(raw, (c) => c.charCodeAt(0) / 240));
  if (!pts) return;
  // the look's colours each time: a change of look shows at the next message
  [page.eq.rtaStrokeColor, page.eq.rtaFillColor] = DLZMOD_rtaColors();
  page.eq.setRTA(pts);
}

// The band levels (0..1 over 80 dB, top = 0 dBFS) as the points paintRTA draws: evenly spread over
// the curve's 20 Hz - 20 kHz (a log scale), each the level at its frequency, interpolated in dB
// between the two nearest bands (outside them: the outer band's). Shown from -60 dBFS (bottom) to
// 0 dBFS (top); null when every band is below that (silence: Mackie's code clears the curve).
function DLZMOD_rtaPoints(levels, n = 64) {
  const freqs = DLZMOD_rtaFreqs();
  if (!levels || levels.length < freqs.length) return null;
  const floor = 20 / 80;   // -60 dBFS
  const show = (v) => Math.max(0, Math.min(1, (v - floor) / (1 - floor)));
  if (!levels.slice(0, freqs.length).some((v) => v > floor)) return null;
  const pts = new Array(n);
  for (let k = 0; k < n; k++) {
    const f = 20 * Math.pow(1000, k / (n - 1));
    const x = Math.max(0, Math.min(freqs.length - 1, Math.log2(f / freqs[0])));
    const j = Math.min(freqs.length - 2, Math.floor(x));
    pts[k] = show(levels[j] + (levels[j + 1] - levels[j]) * (x - j));
  }
  return pts;
}

function DLZMOD_initKeys() {
  Object.entries(DLZMOD_keys()).forEach(([k, v]) => Data.has(k) || (Data.data[k] = v));
}

function DLZMOD_headerHidden() {
  return !!Data.get("dlzmod.hideHeader");
}

// Header (TopBar: status icons, pad indicators, messages). app.setPage shows it on every page switch
// (patched to ask DLZMOD_headerHidden); this applies a change right away. Full-screen pages
// (assistant, keyboard, language, ...) hide the nav bar as well: leave those alone.
function DLZMOD_applyHeader() {
  if (typeof app === "undefined" || !app.topBar || !app.navBar.visible) return;
  if (DLZMOD_messageBar.bar) DLZMOD_messageBar.bar.destroy();   // its place moves with the header
  app.topBar.setVisible(!DLZMOD_headerHidden());
  app.updateGeometry();
  app.update();
}

// #58: with the header hidden, Mackie's messages still show (showToast: "Saved: ...", "Loaded: ...",
// "Renamed", ..., each right after something the owner did). The header keeps them as in stock
// (shown again within their time: there); while it is hidden, DLZMOD_messageBar shows them as well.
function DLZMOD_hookMessages() {
  if (DLZMOD_hookMessages.done) return;
  DLZMOD_hookMessages.done = !0;
  const show = TopBar.prototype.showMessage;
  TopBar.prototype.showMessage = function (text, color = Color.main, time = 3e3) {
    show.call(this, text, color, time);
    if (DLZMOD_headerHidden() && !this.visible && app.navBar.visible) DLZMOD_messageBar(text, color, time);
  };
}

// A bar in the header's look (its background, separator line and message text) over the tab bar, up
// to the gear, for the message's time; a new message takes its place. It draws on the foreground
// layer, as popups do, so nothing moves, but it is not one of the UI's modal widgets: app.setPage and
// Escape close those (a snapshot load shows "Loaded: ..." and switches page at once), and a tap beside
// them closes them. It takes no taps: a tap on it reaches the tab below. On a full-screen page (no tab
// bar) it draws nothing. On the device a closed overlay stays drawn until what is below draws again,
// and closing one clears the whole foreground layer (DLZMOD_repaintSoon): so the tab bar draws again,
// and so does an open popup.
function DLZMOD_messageBar(text, color, time) {
  if (DLZMOD_messageBar.bar) DLZMOD_messageBar.bar.destroy();
  const nav = app.navBar, top = app.topBar;
  const bar = DLZMOD_messageBar.bar = new Widget(app, {
    anchors: [nav.globalX(), nav.globalY()],
    size: [nav.w, top.h],
    ignoreEvents: !0,
    paint: function (t) {
      if (!nav.visible) return;
      t.fillStyle = top.bgColor;
      t.fillRect(0, 0, this.w, this.h);
      t.fRect(Color.menuSeparator, 0, this.h - 1, this.w, 1);
      t.drawText(text, this.w / 2 | 0, 16, { color: color, font: Font.font(600, "13pt"), align: "center", valign: "middle" });
    },
    onDestroy: function () {
      if (DLZMOD_messageBar.bar === this) DLZMOD_messageBar.bar = null;
      setTimeout(() => {
        nav.update();
        if (app.mWidgets.length) app.drawAllFg();
      }, 0);
    },
  });
  bar.setOverlay(!0, !0);   // the foreground layer without joining the modal widgets
  bar.update();
  setTimeout(() => DLZMOD_messageBar.bar === bar && bar.destroy(), time);
}

// Settings → Bluetooth / Disk: the only SD slot holds the boot card, so its Format button is hidden
// (server.js refuses FORMAT_SD too) and this note sits where the button was (centre 54 px above
// the panel's bottom edge).
function DLZMOD_paintSdNote(t, panel) {
  let cx = panel.w / 2 | 0, y = panel.h - 54;
  t.drawText(DLZMOD_tabLabel(), cx, y - 11,
    { color: DLZMOD_accent(), font: Font.font(600, "13pt"), align: "center", valign: "middle" });
  t.drawText("runs from this card", cx, y + 12,
    { color: "#888888", font: Font.font(500, "12pt"), align: "center", valign: "middle" });
}

// The drop-in update's result, once after the start that installed it (or refused it), in the style
// of Mackie's firmware popups (green / red text, showMessage); OK tells the server it was seen
// (dlzmod-server.js, DLZMOD_updateNoteSend). n: {ok, version} or {ok: false, report}.
function DLZMOD_showUpdateNote(n) {
  if (!n) return;
  const text = n.ok
    ? "Updated to " + n.version + "."
    : "The update was not installed.\nSee " + (n.report ? "dlzmod-logs/" + n.report : "dlzmod-logs") + " on the card.";
  showMessage(text, {
    title: DLZMOD_tabLabel() + " update", textColor: n.ok ? Color.green : Color.red2,
    font: Font.font(500, "17pt"), textDY: 32, func: () => $NET.cmd("DLZMOD_UPDATE_NOTE_OK"),
  });
}

// #65: an update file on the card passed the updater's checks and waits for Install (dlzmod-server.js,
// DLZMOD_updatePendingFrom; sent to the mixer's own screen only). Laid out as Mackie's firmware update
// question (askConfirm: current and new version, an arrow on top), Install and Later. Later only
// closes it: the question comes back at the next start and the Mod page keeps an Install button.
function DLZMOD_askUpdate(p) {
  if (!p || !p.sum) return;
  askConfirm("", {
    title: DLZMOD_tabLabel() + " update", font: Font.font(500, "17pt"), textDY: 32,
    paintCustom: function (t) {
      const x = this.w / 2 | 0, y = (this.h / 2 + 35 | 0) - 26;
      t.drawText(lang.CURRENT_VERSION, x, y - 60, { color: Color.white, font: Font.font(500, "18pt"), align: "center", valign: "middle" });
      t.drawText(DLZMOD_installed(), x, y - 20, { color: Color.main, font: Font.font(500, "18pt"), align: "center", valign: "middle" });
      t.drawText(lang.UPDATE_VERSION, x, y + 20, { color: Color.white, font: Font.font(500, "18pt"), align: "center", valign: "middle" });
      t.drawText(p.version, x, y + 60, { color: Color.main, font: Font.font(500, "18pt"), align: "center", valign: "middle" });
      t.drawText($FA.arrow_to_top, x, 92, { font: Font.fa("36px"), color: Color.main, align: "center" });
    },
    buttons: [
      { text: "Install", textStyle: { font: Font.font(600, "16pt") }, textColors: [Color.main, Color.white], colors: [Color.confirm, Color.main] },
      { text: "Later", textStyle: { font: Font.font(600, "16pt") } },
    ],
  }, () => DLZMOD_approveUpdate(p.sum));
}

function DLZMOD_approveUpdate(sum) {
  $NET.cmd("DLZMOD_UPDATE_APPROVE", { sum: sum });
}

// Install's answer: what to do now (switch off and on), or why not
function DLZMOD_updateApproved(r) {
  if (!r) return;
  showMessage(r.text, {
    title: DLZMOD_tabLabel() + " update", textColor: r.ok ? Color.green : Color.red2,
    font: Font.font(500, "17pt"), textDY: 32,
  });
}

// The card's check before the FPGA loader failed (sd-system/dlzmod-cardcheck): no audio this start.
// Shown at every start while it fails, red as Mackie's failure popups; text from the check itself.
function DLZMOD_showCardNote(text) {
  if (!text) return;
  showMessage(text + "\nThe mixer has no sound now. Take the card out to use it normally.", {
    title: DLZMOD_tabLabel(), textColor: Color.red2, font: Font.font(500, "17pt"), textDY: 32,
  });
}

// {installed: "v0.1.0 (dev-b2f2852)", failed: "Last update not installed: ...", pending: {sum, version,
// approved} or null, local} (dlzmod-server.js, DLZMOD_updateStatusFrom), every start and after Install;
// installed and failed may be ""
function DLZMOD_setUpdateStatus(s) {
  DLZMOD_setUpdateStatus.s = s && typeof s === "object" ? s : {};
  const page = DLZMOD_page();
  if (page) page.about.syncInstall();
  if (page && page.visible) page.about.update();
}

function DLZMOD_updateFailed() {
  return (DLZMOD_setUpdateStatus.s || {}).failed || "";
}

// the update waiting for Install, or null
function DLZMOD_updatePending() {
  const p = (DLZMOD_setUpdateStatus.s || {}).pending;
  return p && p.sum ? p : null;
}

// the Mod page's Updates row: [text, colour or null for grey]
function DLZMOD_updateRow() {
  const p = DLZMOD_updatePending();
  if (p && p.approved) return [p.version + " installs at the next start: switch the mixer off and on", DLZMOD_accent()];
  if (p && (DLZMOD_setUpdateStatus.s || {}).local) return ["Update " + p.version + " is on the card", DLZMOD_accent()];
  if (p) return ["Update " + p.version + " is on the card: install it on the mixer's own screen", DLZMOD_accent()];
  const failed = DLZMOD_updateFailed();
  if (failed) return [failed, Color.red2];
  if (DLZMOD_external()) return ["Upload the update's .tar and .sig with the button below", null];
  return ["Copy the update's .tar and .sig to DLZDATA/dlzmod-update", null];
}

// #114: Upload Update... (Mod page, in a browser): the browser's file picker for the update's two files.
// In the page while open (a picker outside it can be dropped by some browsers before it answers); the
// one of an earlier press (cancelled: no answer) goes. Not while one is being sent
function DLZMOD_uploadPick() {
  const s = DLZMOD_uploadPick;
  if (DLZMOD_uploadBusy()) return;
  if (s.input) s.input.remove();
  const input = (s.input = document.createElement("input"));
  input.type = "file";
  input.multiple = !0;
  input.accept = ".tar,.sig";
  input.hidden = !0;
  input.onchange = () => {
    const files = Array.from(input.files || []);
    input.remove();
    s.input = null;
    DLZMOD_uploadFiles(files);
  };
  document.body.appendChild(input);
  input.click();
}

// the chosen files: {tar, sig}, or what is wrong with them (the server checks the same again)
function DLZMOD_uploadCheck(files) {
  const tar = files.filter((f) => /\.tar$/i.test(f.name));
  const sig = files.filter((f) => /\.tar\.sig$/i.test(f.name));
  if (files.length !== 2 || tar.length !== 1 || sig.length !== 1) {
    return "Choose both files of the update together:\nits dlzmod-....tar and its .tar.sig.";
  }
  const t = tar[0];
  const s = sig[0];
  if (!/^dlzmod-[A-Za-z0-9][A-Za-z0-9._+-]{0,80}\.tar$/.test(t.name) || t.name.includes("..")) {
    return t.name + " is not a mod update.\n(A copy the browser renamed, like \"(1)\", is not taken.)";
  }
  if (s.name !== t.name + ".sig") return s.name + " is not the signature of " + t.name + ".";
  if (s.size !== 64) return s.name + " is not a signature file.";
  if (!t.size || t.size > 64 * 1024 * 1024) return t.name + " is not a mod update (wrong size).";
  return { tar: t, sig: s };
}

// sent as one request (dlzmod-server.js, DLZMOD_updateUpload): the signature, then the package. A
// Blob of the two files: the browser sends them from disk, not read into the page first. One at a
// time from this page
function DLZMOD_uploadFiles(files) {
  const s = DLZMOD_uploadFiles;
  const title = "Upload Update";
  if (DLZMOD_uploadBusy()) return;
  const f = DLZMOD_uploadCheck(files);
  if (typeof f === "string") return showMessage(f, { title: title });
  askConfirm("Send " + f.tar.name + " (" + DLZMOD_size(f.tar.size) + ") to the mixer?\n" +
    "It is installed only after Install on the mixer's own screen.", { title: title }, () => {
    if (s.busy) return;
    s.busy = !0;
    showToast("Sending: " + f.tar.name);
    fetch("/dlzmod-update-upload", { method: "POST", cache: "no-store", body: new Blob([f.sig, f.tar]),
      headers: { "Content-Type": "application/octet-stream", "X-Dlzmod-Name": f.tar.name } })
      .then((r) => r.text().then((text) => showMessage(DLZMOD_uploadReply(r, text), { title: title })))
      .catch(() => showMessage("The upload did not get through. Try again.", { title: title }))
      .finally(() => (s.busy = !1));
  });
}

// an update being sent from this page: says so; true: stop there
function DLZMOD_uploadBusy() {
  if (!DLZMOD_uploadFiles.busy) return !1;
  showMessage("An update is being sent to the mixer.\nWait for its answer.", { title: "Upload Update" });
  return !0;
}

// what the mixer answered, for the popup: the upload's own text (text/plain); the pairing gate's
// pages (HTML: no longer paired, control from other devices off) get a sentence instead
function DLZMOD_uploadReply(r, text) {
  const plain = /^text\/plain/i.test((r.headers && r.headers.get("content-type")) || "");
  if (plain && text) return text;
  if (r.ok) return "Sent.";
  if (r.status === 403 || r.status === 421) {
    return "This browser is not paired with the mixer any more,\nor control from other devices is off. Reload this page.";
  }
  return "The mixer refused it (HTTP " + r.status + ").";
}

// the installed build as the update popup names it ("v0.1.0" on a release card, the stamped VERSION
// until the server has sent it)
function DLZMOD_installed() {
  return (DLZMOD_setUpdateStatus.s || {}).installed || DLZMOD_version();
}

function DLZMOD_page() {
  return typeof app !== "undefined" && app.pageSettings && app.pageSettings.dlzmod;
}

// On the device a closed popup stays on screen until the page below it draws again: on the Mod page,
// which draws nothing until its next status, up to 3 s [device] (notes/modding-guide.md). A repaint
// of the page right after it closes, only while the page is on screen; and of the message bar, which
// the cleared foreground layer took along.
function DLZMOD_repaintSoon() {
  setTimeout(() => {
    const page = DLZMOD_page();
    if (page && page.globalVisible()) page.update();
    if (DLZMOD_messageBar.bar) DLZMOD_messageBar.bar.update();
  }, 0);
}

// every popup ends in onDestroy (a button, close(), a tap outside it): Mackie's own runs first, then
// the repaint
function DLZMOD_hookPopups() {
  if (DLZMOD_hookPopups.done) return;
  DLZMOD_hookPopups.done = !0;
  const destroyed = PopupWindow.prototype.onDestroy;
  PopupWindow.prototype.onDestroy = function () {
    destroyed.call(this);
    DLZMOD_repaintSoon();
  };
}

// Mod page under Settings, after About. Unlike Mackie's pages (829 x 392 with wide margins) it fills
// the Settings area with 12 px margins: on the device the knob panel leaves Settings 938 px, and with
// the header shown 464 px below the tab bar (measured in the sandbox), so 914 x 440. Sub-tabs in the
// style of Settings' own tab bar sit above one of six pages of panels: Display (Screen + Meters),
// Colors, Time, Network, Remote, Mod. Laid out for the header shown; with it hidden Mackie's centring (anchors) splits the
// extra 30 px above and below. glesgui only has Proxima Nova Light/Regular/Semibold: use font weights
// 300-600.
function DLZMOD_settingsPage(parent, y) {
  DLZMOD_initKeys();
  DLZMOD_hookPopups();
  DLZMOD_hookMessages();
  Data.regWidget("dlzmod.hideHeader", DLZMOD_applyHeader);   // also when changed from a browser
  Data.regWidget("dlzmod.meterMarks", DLZMOD_applyMeterMarks);
  for (const k of ["dlzmod.theme", "dlzmod.bgColor", "dlzmod.faderColor"]) Data.regWidget(k, DLZMOD_themeChanged);
  const top = 44 + 8;   // sub-tabs (44) and a gap, then the panels
  return new Widget(parent, {
    anchors: [0, y, null, null, !0, !0],
    size: [914, top + DLZMOD_panelH()],
    opaque: !1,
    paint: function () {},   // only the tabs and panels, the page's black between them
    _constructor: function () {
      this.sub = 0;
      // in a browser no Network and Remote: only the mixer's own screen changes those (the server
      // refuses them from other devices)
      const names = ["Display", "Colors", "Time", "Network", "Remote", "Mod"];
      const shown = DLZMOD_external() ? [0, 1, 2, 5] : [0, 1, 2, 3, 4, 5];
      this.tabs = shown.map((i, k) => new ToggleButton(this, {
        anchors: [k * 153, 0], w: 149, h: 44, text: names[i], opaque: !1,
        colors: [Color.buttonBg, DLZMOD_accent()], textColor: Color.subNavButtonText, textColorON: Color.black,
        textStyle: { align: "left", valign: "middle", x: 7, y: 23, offsetX: 0, offsetY: 0, font: Font.font(600, "18px") },
        onToggleON: () => this.setSub(i), getVal: () => this.sub === i,
      }));
      this.screen = DLZMOD_screenPanel(this, 0, top, 290);
      this.meters = DLZMOD_metersPanel(this, 290 + 12, top, 914 - 290 - 12);
      this.colours = DLZMOD_coloursPanel(this, 0, top, 914);
      this.time = DLZMOD_timePanel(this, 0, top, 914);
      this.network = DLZMOD_networkPanel(this, 0, top, 914);
      this.pair = DLZMOD_pairPanel(this, 0, top, 914);
      this.about = DLZMOD_aboutPanel(this, 0, top, 914);
      this.groups = [[this.screen, this.meters], [this.colours], [this.time], [this.network], [this.pair],
        [this.about]];
      this.setSub(0);
      // the Network and Remote Control panels' status, every 3 s while one is on screen (the PIN
      // changes after each pairing); the Time panel's (the time now)
      setInterval(() => {
        if (this.network.globalVisible() || this.pair.globalVisible()) $NET.cmd("DLZMOD_NET", { op: "status" });
        if (this.time.globalVisible()) $NET.cmd("DLZMOD_TIME", { op: "status" });
      }, 3000);
    },
    setSub: function (i) {
      this.sub = i;
      if (this.pair) this.pair.revealPin(!1);   // leaving or opening Remote Control hides the PIN
      this.groups.forEach((g, j) => g.forEach((p) => p.setVisible(j === i)));
      if (i === 2) $NET.cmd("DLZMOD_TIME", { op: "status" });
      if (i === 3 || i === 4) $NET.cmd("DLZMOD_NET", { op: "status" });
      this.update();
    },
    onShow: function () {
      this.pair.revealPin(!1);
      $NET.cmd("DLZMOD_NET", { op: "status" });
      $NET.cmd("DLZMOD_TIME", { op: "status" });
    },
  });
}

// height of the Mod page's panels (see DLZMOD_settingsPage)
function DLZMOD_panelH() {
  return 388;
}

// text row of the Mod page's panels: title, grey line below
function DLZMOD_paintRow(t, x, y, title, sub, max, subColor) {
  t.drawText(title, x, y - 12, { color: Color.white, font: Font.font(500, "16pt"), align: "left", valign: "middle" });
  if (sub) t.drawText(sub, x, y + 14, { color: subColor || "#888888", font: Font.font(500, "12pt"), align: "left",
    valign: "middle", max: max });
}

// Mackie's window, a line on top in the Mod page's colour, the title
function DLZMOD_paintPanel(w, t, title, color, font) {
  PAINT_WINDOW_BG.call(w, t);
  t.fRect(DLZMOD_accent(), 0, 0, w.w, 4);
  t.drawText(title, w.w / 2 | 0, 40, { color: color, font: font, align: "center", valign: "middle" });
}

// same switch as Mackie's DEMO MODE, ON in the Mod page's colour, 24 px from the right edge of a panel w wide
function DLZMOD_switch(parent, w, y, key, apply) {
  return new Switcher(parent, {
    anchors: [w - 24 - 72, y], size: [72, 46], margin: 10,
    bgColors: [Color.buttonBg, DLZMOD_accent()], knobMargin: 0, key: key,
    onToggleON: apply, onToggleOFF: apply,
  });
}

// Mackie's segmented control, in the Mod page's colour. applyParams takes an array parameter's first element
// (Mackie writes items:[["",""]]), and only setItems derives w from the items: both given here
function DLZMOD_switchBox(parent, x, y, h, key, items, itemWidth, size) {
  return new SwitchBox(parent, {
    anchors: [x, y], w: items.length * itemWidth, h: h, itemWidth: itemWidth, key: key,
    items: [items], bgColor: Color.buttonBg, color: DLZMOD_accent(),
    alphaOn: 1, textColorOn: "#000000", border: 0, borderOn: 0,
    textStyle: { offsetX: 0, offsetY: 1, font: Font.font(500, size), align: "center", valign: "middle" },
  });
}

// Display: the header
function DLZMOD_screenPanel(parent, x, y, w) {
  return new Widget(parent, {
    anchors: [x, y],
    size: [w, DLZMOD_panelH()],
    bgColor: Color.bgDark,
    _constructor: function () {
      this.hideHeader = DLZMOD_switch(this, w, 73, "dlzmod.hideHeader", DLZMOD_applyHeader);
    },
    paint: function (t) {
      DLZMOD_paintPanel(this, t, "Screen", Color.white, Font.font(500, "20pt"));
      const grey = { color: "#888888", font: Font.font(500, "12pt"), align: "left", valign: "middle", max: this.w - 48 };
      t.drawText("Hide header", 24, this.hideHeader.geomCenterY(),
        { color: Color.white, font: Font.font(500, "16pt"), align: "left", valign: "middle" });
      t.drawText("Status icons at the top of the screen", 24, 136, grey);
      t.drawText("Messages still show for a moment", 24, 156, grey);
    },
  });
}

// Colors (#21): the theme, the accent colour and the background, chosen with big swatches. A tap
// saves it, and the whole screen is in the new colours at once (DLZMOD_themeChanged): the screen is
// the preview. Only on the mixer's own screen: a browser sees what is set and follows a change (the
// server refuses these keys from other devices)
function DLZMOD_coloursPanel(parent, x, y, w) {
  const local = !DLZMOD_external();
  const sw = 62, gap = 6, left = 170, swH = 56;
  const keys = { theme: "dlzmod.theme", bg: "dlzmod.bgColor", fader: "dlzmod.faderColor" };
  return new Widget(parent, {
    anchors: [x, y],
    size: [w, DLZMOD_panelH()],
    bgColor: Color.bgDark,
    _constructor: function () {
      const pick = (k, v) => () => {
        if (local && DLZMOD_lookSel()[k] !== v) Data.set(keys[k], v);
      };
      this.themeBtns = DLZMOD_themes().map((th, i) => new Button(this, {
        anchors: [left + i * 214, 40], size: [206, swH], text: th.name, round: 6, triggerOnUp: !0, border: 3,
        textStyle: { font: Font.font(600, "15pt"), offsetX: 0, offsetY: 1, align: "center", valign: "middle" },
        onPress: pick("theme", th.id),
      }));
      // the chosen one: a thick white edge and a tick, dark or light against the swatch
      const swatch = (k, i, row) => new Button(this, {
        anchors: [left + i * (sw + gap), row], size: [sw, swH], round: 6, triggerOnUp: !0, border: 2,
        onPress: pick(k, i),
        paintOverlay: function (t) {
          if (!this.chosen) return;
          // on a light swatch the white edge needs a dark line inside to show
          if (DLZMOD_light(this.colors[0])) t.sRect("#000000", 2, 5, 5, sw - 10, swH - 10, 3);
          t.drawText("✓", sw / 2, swH / 2 + 1, { color: DLZMOD_light(this.colors[0]) ? "#000000" : "#ffffff",
            font: Font.font(600, "24pt"), align: "center", valign: "middle" });
        },
      });
      this.bgBtns = DLZMOD_bgColors().map((c, i) => swatch("bg", i, 246));
      this.faderBtns = DLZMOD_faderColors().map((c, i) => swatch("fader", i, 138));
      // also a change from the other side (the mixer's, in a browser)
      for (const k of Object.values(keys)) Data.regWidget(k, () => this.sync());
      this.sync();
    },
    sync: function () {
      const sel = DLZMOD_lookSel(), look = DLZMOD_look(sel), on = "#ffffff", off = "#5a5a5a";
      // "Default": the look's own background and colour
      const plain = DLZMOD_look({ theme: sel.theme, bg: 0, fader: 0 });
      this.themeBtns.forEach((b, i) => {
        const chosen = DLZMOD_themes()[i].id === sel.theme;
        b.colors = [chosen ? DLZMOD_accent(look) : Color.buttonBg, DLZMOD_accent(look)];
        b.textColor = b.textColorON = chosen && DLZMOD_light(DLZMOD_accent(look)) ? "#000000" : Color.white;
        b.borderColors = [chosen ? on : off, on];
      });
      const mark = (btns, k, fill) => btns.forEach((b, i) => {
        const c = fill(i);
        b.colors = [c, c];
        b.chosen = i === sel[k];
        b.border = b.chosen ? 5 : 2;
        b.borderColors = b.chosen ? [on, on] : [off, off];
      });
      // "Tinted": the shade the chosen colour gives
      mark(this.bgBtns, "bg", (i) => DLZMOD_look(Object.assign({}, sel, { bg: i })).bg || plain.colors.bg || "#000000");
      mark(this.faderBtns, "fader", (i) => DLZMOD_faderTone(DLZMOD_faderColors()[i], sel.theme) || DLZMOD_accent(plain));
      this.update();
    },
    paint: function (t) {
      PAINT_WINDOW_BG.call(this, t);
      t.fRect(DLZMOD_accent(), 0, 0, this.w, 4);
      const label = { color: Color.white, font: Font.font(500, "16pt"), align: "left", valign: "middle" };
      const small = { color: "#bdbdbd", font: Font.font(500, "11pt"), align: "center", valign: "middle" };
      t.drawText("Contrast", 28, 40 + swH / 2, label);
      t.drawText("Background", 28, 246 + swH / 2, label);
      t.drawText("Color", 28, 138 + swH / 2 - 10, label);
      t.drawText("Faders, meters,", 28, 138 + swH / 2 + 14, Object.assign({}, small, { align: "left" }));
      t.drawText("what is selected", 28, 138 + swH / 2 + 32, Object.assign({}, small, { align: "left" }));
      // a two-word name on two lines
      const names = (list, row) => list.forEach((c, i) => (c ? c[0] : "Default").split(" ").forEach((word, j, all) =>
        t.drawText(word, left + i * (sw + gap) + sw / 2, row + swH + 13 + j * 15 - (all.length - 1) * 2, small)));
      names(DLZMOD_bgColors(), 246);
      names(DLZMOD_faderColors(), 138);
      if (!local) t.drawText("Set on the mixer's screen", w - 28, 328 + 24, { color: "#bdbdbd", font: Font.font(500, "12pt"),
        align: "right", valign: "middle" });
    },
  });
}

// whether a #rrggbb is light (dark text on it)
function DLZMOD_light(c) {
  if (typeof c !== "string" || !/^#[0-9a-f]{6}$/i.test(c)) return false;
  const v = [1, 3, 5].map((i) => parseInt(c.substr(i, 2), 16));
  return 0.299 * v[0] + 0.587 * v[1] + 0.114 * v[2] > 150;
}

function DLZMOD_meterModeNow() {
  return Data.data["dlzmod.meterMode"] ?? 0;
}

// Display: the channel meters. The mode is read on every VU message (DLZMOD_vuSet): nothing to apply
function DLZMOD_metersPanel(parent, x, y, w) {
  return new Widget(parent, {
    anchors: [x, y],
    size: [w, DLZMOD_panelH()],
    bgColor: Color.bgDark,
    _constructor: function () {
      // big touch targets: the whole width inside the 28 px margins
      const inner = w - 56, item3 = inner / 3 | 0, item2 = (inner - 40) / 4 | 0;
      this.meterMode = DLZMOD_switchBox(this, 28, 124, 52, "dlzmod.meterMode", ["Mackie", "Both", "Before fader"], item3, "15pt");
      // the "before the fader" bar's look, only with Both (the other modes have no second bar)
      // "Green" is the meters' colour: with an own colour (#21) its name
      const preNames = () => {
        const own = DLZMOD_faderColors()[DLZMOD_lookSel().fader];
        return [own ? own[0] : "Green", "Grey"];
      };
      this.preColor = DLZMOD_switchBox(this, 28, 244, 46, "dlzmod.preColor", preNames(), item2, "14pt");
      Data.regWidget("dlzmod.faderColor", () => this.preColor.setItems(preNames()));
      this.preLevel = DLZMOD_switchBox(this, 28 + 2 * item2 + 40, 244, 46, "dlzmod.preLevel", ["Strong", "Soft"], item2, "14pt");
      const sync = () => {
        const both = DLZMOD_meterModeNow() === 1;
        this.preColor.setVisible(both);
        this.preLevel.setVisible(both);
        this.update();   // hide() only clears the flag: without a repaint the rows stay drawn
      };
      Data.regWidget("dlzmod.meterMode", sync);
      sync();
      this.meterMarks = DLZMOD_switch(this, w, 312, "dlzmod.meterMarks", DLZMOD_applyMeterMarks);
    },
    paint: function (t) {
      DLZMOD_paintPanel(this, t, "Meters", Color.white, Font.font(500, "20pt"));
      const max = this.w - 56;
      const mode = DLZMOD_meterModeNow();
      // Mackie's main meter is before the master fader (DLZMOD_vuSet)
      DLZMOD_paintRow(t, 28, 92, "Level meters", ["As Mackie shows them: after the fader, the main meter before",
        "After the fader, with the level before the fader dimmed behind", "Before the fader"][mode] || "", max);
      if (mode === 1) DLZMOD_paintRow(t, 28, 212, "Before-fader bar", "Its colour and strength", max);
      DLZMOD_paintRow(t, 28, this.meterMarks.geomCenterY(), "Meter marks",
        "Yellow and red zones, dB marks and numbers", this.w - 28 - 120);
    },
  });
}

// Mod: what is installed and how to update it; Install for an update waiting on the card (#65), on
// the mixer's own screen only; Upload Update... in its place in a browser (#114)
function DLZMOD_aboutPanel(parent, x, y, w) {
  return new Widget(parent, {
    anchors: [x, y],
    size: [w, DLZMOD_panelH()],
    bgColor: Color.bgDark,
    _constructor: function () {
      this.install = new E1Button(this, {
        anchors: [0, 252, null, null, !0], size: [300, 56], text: "Install Update...",
        onPress: () => DLZMOD_askUpdate(DLZMOD_updatePending()),
      });
      this.upload = new E1Button(this, {
        anchors: [0, 252, null, null, !0], size: [300, 56], text: "Upload Update...",
        visible: DLZMOD_external(), onPress: () => DLZMOD_uploadPick(),
      });
      this.syncInstall();
    },
    syncInstall: function () {
      const p = DLZMOD_updatePending();
      this.install.setVisible(!!p && !p.approved && !!(DLZMOD_setUpdateStatus.s || {}).local);
    },
    paint: function (t) {
      DLZMOD_paintPanel(this, t, DLZMOD_tabLabel(), DLZMOD_accent(), Font.font(600, "24pt"));
      t.drawText("Unofficial mod for the Mackie DLZ Creator", this.w / 2 | 0, 70,
        { color: "#888888", font: Font.font(500, "12pt"), align: "center", valign: "middle" });
      const max = this.w - 56;
      DLZMOD_paintRow(t, 28, 136, "Version", DLZMOD_installed(), max);
      const [text, color] = DLZMOD_updateRow();
      DLZMOD_paintRow(t, 28, 206, "Updates", text, max, color);
      t.drawText("by Oulsen · github.com/Oulsen/DLZ-Creator-Modded", this.w / 2 | 0, this.h - 24,
        { color: "#666666", font: Font.font(500, "12pt"), align: "center", max: max });
    },
  });
}

// Time (#9): the time zone recordings get their times in. A computer shows a FAT card's file times
// as they are, as its own local time, so a mixer on UTC (stock) gave them 1-2 h early in the
// Netherlands. The server mod keeps the zone (DLZMOD_time in dlzmod-server.js) and sends it with its
// offset and the time there now; nothing of it is a hub key. Picked from a short list sorted by
// offset (DLZMOD_zonePicker); a browser also offers its own zone. The server takes a change from the
// mixer's own screen and from paired devices, and says so to others.
function DLZMOD_timeState() {
  return DLZMOD_timeState.s || { zone: "", offset: "", time: "", local: null, clock: "" };
}

function DLZMOD_setTimeState(s) {
  DLZMOD_timeState.s = s;
  const page = DLZMOD_page();
  if (page) page.time.update();
}

function DLZMOD_timeResult(r) {
  showMessage(r.text, { title: "Time", textColor: r.ok ? Color.green : Color.red2, font: Font.font(500, "17pt"),
    textDY: 32 });
  const page = DLZMOD_page();
  if (page) page.time.update();
}

// "America/Argentina/Buenos_Aires" as "America / Argentina / Buenos Aires"; stock's Etc/UTC as UTC
function DLZMOD_zoneName(z) {
  if (z === "Etc/UTC") return "UTC";
  return String(z || "").replace(/_/g, " ").split("/").join(" / ");
}

// the browser's own zone ("" when the browser does not say)
function DLZMOD_ownZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "";
  } catch (e) {
    return "";
  }
}

function DLZMOD_setZone(zone) {
  if (zone) $NET.cmd("DLZMOD_TIME", { op: "set", zone: zone });
}

// Time page: two cards, the time zone and the clock, in a container without paint of its own (as
// the Network page), so that page.time.update() and globalVisible() cover both
function DLZMOD_timePanel(parent, x, y, w) {
  const cw = (w - 12) / 2 | 0;
  return new Widget(parent, {
    anchors: [x, y],
    size: [w, DLZMOD_panelH()],
    opaque: !1,
    paint: function () {},
    _constructor: function () {
      this.zone = DLZMOD_zoneCard(this, 0, cw);
      this.clock = DLZMOD_clockCard(this, w - cw, cw);
    },
  });
}

function DLZMOD_zoneCard(parent, x, w) {
  const external = DLZMOD_external();
  return new Widget(parent, {
    anchors: [x, 0],
    size: [w, DLZMOD_panelH()],
    bgColor: Color.bgDark,
    _constructor: function () {
      this.own = new E1Button(this, {
        anchors: [0, 210, null, null, !0], size: [w - 48, 56], text: "Use This Computer's Zone", visible: external,
        onPress: () => DLZMOD_setZone(DLZMOD_ownZone()),
        getState: function () {
          const z = DLZMOD_ownZone();
          this.enabled = !!z && z !== DLZMOD_timeState().zone;
        },
      });
      this.change = new E1Button(this, {
        anchors: [0, 280, null, null, !0], size: [w - 48, 56], text: "Change...", onPress: () => DLZMOD_zonePicker(),
      });
    },
    paint: function (t) {
      DLZMOD_paintPanel(this, t, "Time Zone", Color.white, Font.font(500, "20pt"));
      const s = DLZMOD_timeState(), max = this.w - 48;
      t.drawText(s.zone ? DLZMOD_zoneName(s.zone) : "…", 24, 92, { color: Color.white, font: Font.font(500, "16pt"),
        align: "left", valign: "middle", max: max });
      if (s.offset && s.offset !== DLZMOD_zoneName(s.zone)) t.drawText(s.offset, 24, 118, { color: "#888888", font: Font.font(500, "12pt"), align: "left",
        valign: "middle", max: max });
      if (external) DLZMOD_paintRow(t, 24, 178, "This computer", DLZMOD_zoneName(DLZMOD_ownZone()) || "Unknown", max);
      t.drawText("Recording times follow it, summer time too", this.w / 2 | 0, this.h - 24,
        { color: "#666666", font: Font.font(500, "12pt"), align: "center", max: max });
    },
  });
}

// Clock (#13): the mixer's date and time and where they came from this start (the server's
// DLZMOD_clockSource). Without internet it is set here: by hand (DLZMOD_clockPicker), or in a browser
// to the computer's own time; a browser also gives its time when it connects (DLZMOD_connected,
// forward only). With internet the server refuses both, so the buttons are off.
function DLZMOD_clockCard(parent, x, w) {
  const external = DLZMOD_external();
  const free = () => DLZMOD_timeState().clock !== "internet" && !!DLZMOD_timeState().local;
  return new Widget(parent, {
    anchors: [x, 0],
    size: [w, DLZMOD_panelH()],
    bgColor: Color.bgDark,
    _constructor: function () {
      this.own = new E1Button(this, {
        anchors: [0, 210, null, null, !0], size: [w - 48, 56], text: "Use This Computer's Time", visible: external,
        onPress: () => $NET.cmd("DLZMOD_TIME", { op: "clock", now: Date.now() }),
        getState: function () {
          this.enabled = free();
        },
      });
      this.set = new E1Button(this, {
        anchors: [0, 280, null, null, !0], size: [w - 48, 56], text: "Set...", onPress: () => DLZMOD_clockPicker(),
        getState: function () {
          this.enabled = free();
        },
      });
    },
    paint: function (t) {
      DLZMOD_paintPanel(this, t, "Clock", Color.white, Font.font(500, "20pt"));
      const s = DLZMOD_timeState(), max = this.w - 48;
      t.drawText(s.local ? s.local.date + "  " + s.time : "…", 24, 92, { color: Color.white,
        font: Font.font(500, "16pt"), align: "left", valign: "middle", max: max });
      const [text, color] = DLZMOD_clockSourceText(s);
      if (text) t.drawText(text, 24, 118, { color: color, font: Font.font(500, "12pt"), align: "left", valign: "middle",
        max: max });
      if (external) DLZMOD_paintRow(t, 24, 178, "This computer", DLZMOD_ownTime(), max);
      t.drawText("With internet the mixer sets its clock itself", this.w / 2 | 0, this.h - 24,
        { color: "#666666", font: Font.font(500, "12pt"), align: "center", max: max });
    },
  });
}

function DLZMOD_clockSourceText(s) {
  if (!s.local) return ["", ""];
  return {
    internet: ["Set from the internet", Color.green],
    hand: ["Set by hand", "#888888"],
    device: ["From a phone or computer", "#888888"],
  }[s.clock] || ["Not checked since the start (no internet)", DLZMOD_yellow()];
}

// the browser's own date and time, as the card shows the mixer's
function DLZMOD_ownTime(d = new Date()) {
  return DLZMOD_dateText(d.getFullYear(), d.getMonth() + 1, d.getDate()) + "  " +
    String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
}

// "Tue 28 Oct 2026", as the server writes it (DLZMOD_tzLocal)
function DLZMOD_dateText(y, mo, d) {
  const day = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][new Date(Date.UTC(y, mo - 1, d)).getUTCDay()];
  return day + " " + d + " " + DLZMOD_monthNames()[mo - 1] + " " + y;
}

function DLZMOD_monthNames() {
  return ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
}

// days in a month (mo 1-12)
function DLZMOD_monthDays(y, mo) {
  return new Date(Date.UTC(y, mo, 0)).getUTCDate();
}

// the years the server takes (DLZMOD_clockYears in dlzmod-server.js)
function DLZMOD_clockYears() {
  return [2025, 2099];
}

// a picker field one step up or down: month, day, hour and minute go round (as Mackie's unused
// PageTime does), the year stops at the server's limits; a day past the month's end becomes its last
function DLZMOD_clockStep(f, k, d) {
  const [y0, y1] = DLZMOD_clockYears();
  const n = Object.assign({}, f);
  const round = (v, lo, hi) => (v - lo + d + (hi - lo + 1)) % (hi - lo + 1) + lo;
  if (k === "y") n.y = Math.max(y0, Math.min(y1, n.y + d));
  if (k === "mo") n.mo = round(n.mo, 1, 12);
  if (k === "d") n.d = round(n.d, 1, DLZMOD_monthDays(n.y, n.mo));
  if (k === "h") n.h = round(n.h, 0, 23);
  if (k === "mi") n.mi = round(n.mi, 0, 59);
  n.d = Math.min(n.d, DLZMOD_monthDays(n.y, n.mo));
  return n;
}

// The date and time in a Mackie popup (modal): five columns (day, month, year, hour, minute) with
// arrows above and below that repeat while held, as Mackie's PageTime; opened at the mixer's time in
// its time zone. Set sends it to the server, which may also go back (a clock set too far ahead).
function DLZMOD_clockPicker() {
  const W = 900, H = 500, COL = 150, MID = 200;
  const s = DLZMOD_timeState();
  if (DLZMOD_clockPicker.popup || !s.local) return;
  const [y0, y1] = DLZMOD_clockYears();
  const keys = ["d", "mo", "y", "h", "mi"];
  // column centres, a gap between the date and the time
  const cx = (i) => W / 2 + (i - 2) * COL + (i < 3 ? -20 : 20) | 0;
  const arrow = (popup, i, dir) => new Button(popup, {
    anchors: [cx(i) - 65, dir > 0 ? MID - 135 : MID + 55], size: [130, 80], colors: [Color.buttonBg, "#333333"],
    round: 6,
    paintOverlay: function (t) {
      t.fillStyle = Color.white;
      t.fillPolygon(this.w / 2 | 0, this.h / 2 | 0, 14, 3, Math.PI / 2 * (dir > 0 ? 3 : 1));
    },
    onPress: () => popup.step(keys[i], dir),
    onhold: function () {
      this.hh = setInterval(() => this.onPress(), 120);
    },
    onUp: function () {
      clearInterval(this.hh);
    },
  });
  DLZMOD_clockPicker.popup = new PopupWindow(app, {
    w: W, h: H, bgColor: Color.bgPopup,
    // (a step of 0 also takes 29 Feb of a saved 2024 to 28 Feb 2025)
    f: DLZMOD_clockStep({ y: Math.max(y0, Math.min(y1, s.local.y)), mo: s.local.mo, d: s.local.d, h: s.local.h,
      mi: s.local.mi }, "y", 0),
    initWidgets: function () {
      keys.forEach((k, i) => {
        arrow(this, i, 1);
        arrow(this, i, -1);
      });
      new E1Button(this, {
        anchors: [24, null, null, 22], size: [260, 50], text: "Set",
        onPress: () => {
          const f = this.f;
          this.close();
          $NET.cmd("DLZMOD_TIME", { op: "clock", time: f });
        },
      });
      new E1Button(this, {
        anchors: [null, null, 24, 22], size: [180, 50], text: lang.CANCEL,
        onPress: () => this.close(),
      });
    },
    // every way out ends here, a tap outside the popup too (see DLZMOD_wifiList)
    onDestroy: function () {
      DLZMOD_clockPicker.popup = null;
      PopupWindow.prototype.onDestroy.call(this);
      DLZMOD_repaintSoon();
    },
    step: function (k, d) {
      this.f = DLZMOD_clockStep(this.f, k, d);
      this.update();
    },
    paint: function (t) {
      PopupWindow.prototype.paint.call(this, t);
      const f = this.f, two = (v) => String(v).padStart(2, "0");
      const big = { color: Color.white, font: Font.font(500, "25pt"), align: "center", valign: "middle" };
      t.drawText("Date and Time", this.w / 2 | 0, 36, { color: Color.white, font: Font.font(600, "18pt"),
        align: "center", valign: "middle" });
      [f.d, DLZMOD_monthNames()[f.mo - 1], f.y, two(f.h), two(f.mi)].forEach((v, i) => t.drawText(String(v), cx(i), MID,
        big));
      t.drawText(":", (cx(3) + cx(4)) / 2 | 0, MID, big);
      t.drawText(DLZMOD_dateText(f.y, f.mo, f.d) + "  " + two(f.h) + ":" + two(f.mi) + "  (" +
        DLZMOD_zoneName(DLZMOD_timeState().zone) + ")", this.w / 2 | 0, 368, { color: "#888888",
        font: Font.font(500, "13pt"), align: "center", valign: "middle", max: W - 48 });
    },
  });
}

// ms on Date.now()'s scale, but a clock that never jumps, for the screen's frame timer (patch.py):
// with Date.now() a clock set back 91 s stopped the screen for 91 s [device]. Date.now() where there
// is no performance clock
function DLZMOD_frameNow() {
  const p = typeof performance !== "undefined" ? performance : null;
  return p && p.timeOrigin ? p.timeOrigin + p.now() : Date.now();
}

// at every (re)connect (patch.py, after the hub's INIT): a browser gives the mixer its time; the
// server takes it only without internet, only forward and not after a time set by hand
function DLZMOD_connected() {
  if (DLZMOD_external()) $NET.cmd("DLZMOD_TIME", { op: "sync", now: Date.now() });
}

// The zones to pick from on the mixer, the way Windows lists them: one row per set of clock rules,
// sorted by the offset in winter (standard time), with well-known cities; a zone, not a bare offset,
// so summer time follows. A browser can set any other zone the mixer has (Use This Computer's Zone). Each name
// must exist in the mixer's tzdata and match its offset (tests/patches.sh checks both against the dump).
function DLZMOD_zoneList() {
  return [
    ["UTC-10:00", "Hawaii", "Pacific/Honolulu"],
    ["UTC-09:00", "Alaska", "America/Anchorage"],
    ["UTC-08:00", "Los Angeles, Vancouver (Pacific Time)", "America/Los_Angeles"],
    ["UTC-07:00", "Denver, Calgary (Mountain Time)", "America/Denver"],
    ["UTC-07:00", "Arizona", "America/Phoenix"],
    ["UTC-06:00", "Chicago, Winnipeg (Central Time)", "America/Chicago"],
    ["UTC-06:00", "Mexico City", "America/Mexico_City"],
    ["UTC-05:00", "New York, Toronto (Eastern Time)", "America/New_York"],
    ["UTC-05:00", "Bogota, Lima", "America/Bogota"],
    ["UTC-04:00", "Halifax (Atlantic Time)", "America/Halifax"],
    ["UTC-04:00", "Santiago", "America/Santiago"],
    ["UTC-03:30", "Newfoundland", "America/St_Johns"],
    ["UTC-03:00", "Sao Paulo, Brasilia", "America/Sao_Paulo"],
    ["UTC-03:00", "Buenos Aires", "America/Argentina/Buenos_Aires"],
    ["UTC-01:00", "Azores", "Atlantic/Azores"],
    ["UTC", "UTC (world time)", "Etc/UTC"],
    ["UTC+00:00", "London, Dublin, Lisbon", "Europe/London"],
    ["UTC+01:00", "Amsterdam, Berlin, Paris, Rome, Madrid", "Europe/Amsterdam"],
    ["UTC+01:00", "Lagos", "Africa/Lagos"],
    ["UTC+02:00", "Athens, Helsinki, Kyiv, Bucharest", "Europe/Athens"],
    ["UTC+02:00", "Cairo", "Africa/Cairo"],
    ["UTC+02:00", "Johannesburg", "Africa/Johannesburg"],
    ["UTC+02:00", "Jerusalem", "Asia/Jerusalem"],
    ["UTC+03:00", "Istanbul", "Europe/Istanbul"],
    ["UTC+03:00", "Moscow", "Europe/Moscow"],
    ["UTC+03:00", "Riyadh, Kuwait", "Asia/Riyadh"],
    ["UTC+03:00", "Nairobi", "Africa/Nairobi"],
    ["UTC+03:30", "Tehran", "Asia/Tehran"],
    ["UTC+04:00", "Dubai, Abu Dhabi", "Asia/Dubai"],
    ["UTC+05:00", "Karachi", "Asia/Karachi"],
    ["UTC+05:30", "Mumbai, New Delhi, Kolkata", "Asia/Kolkata"],
    ["UTC+05:45", "Kathmandu", "Asia/Kathmandu"],
    ["UTC+06:00", "Dhaka", "Asia/Dhaka"],
    ["UTC+07:00", "Bangkok, Hanoi, Jakarta", "Asia/Bangkok"],
    ["UTC+08:00", "Beijing, Hong Kong, Singapore", "Asia/Shanghai"],
    ["UTC+08:00", "Perth", "Australia/Perth"],
    ["UTC+09:00", "Tokyo, Seoul", "Asia/Tokyo"],
    ["UTC+09:30", "Adelaide", "Australia/Adelaide"],
    ["UTC+09:30", "Darwin", "Australia/Darwin"],
    ["UTC+10:00", "Sydney, Melbourne, Canberra", "Australia/Sydney"],
    ["UTC+10:00", "Brisbane", "Australia/Brisbane"],
    ["UTC+12:00", "Auckland, Wellington", "Pacific/Auckland"],
  ].map(([offset, cities, zone]) => ({ offset: offset, cities: cities, zone: zone }));
}

// The list in a Mackie popup (modal), in pages of 14 that read down each column, opened on the page
// of the zone set now (in the Mod page's colour). A tap on a row closes it and sets that zone.
function DLZMOD_zonePicker() {
  const COLS = 2, ROWS = 7, ROW_H = 48, TOP = 66, W = 900, H = 500, PER = COLS * ROWS;
  const colW = (W - 48) / COLS | 0;
  const zones = DLZMOD_zoneList();
  const pages = Math.ceil(zones.length / PER);
  if (DLZMOD_zonePicker.popup) return;
  const at = zones.findIndex((z) => z.zone === DLZMOD_timeState().zone);
  DLZMOD_zonePicker.popup = new PopupWindow(app, {
    w: W, h: H, bgColor: Color.bgPopup, page: at < 0 ? 0 : at / PER | 0,
    initWidgets: function () {
      for (let i = 0; i < PER; i++) {
        new Widget(this, {
          anchors: [24 + (i / ROWS | 0) * colW, TOP + (i % ROWS) * ROW_H], size: [colW - 6, ROW_H - 6], opaque: !1,
          idx: i,
          paint: function () {},   // touch area only: the popup paints the rows
          onup: function () {
            const z = this.parent.items()[this.idx];
            if (z) this.parent.pick(z);
          },
        });
      }
      new E1Button(this, {
        anchors: [24, null, null, 22], size: [180, 50], text: "<",
        onPress: () => this.show(this.page - 1),
        getState: function () {
          this.enabled = this.parent.page > 0;
        },
      });
      new E1Button(this, {
        anchors: [228, null, null, 22], size: [180, 50], text: ">",
        onPress: () => this.show(this.page + 1),
        getState: function () {
          this.enabled = this.parent.page < pages - 1;
        },
      });
      new E1Button(this, {
        anchors: [null, null, 24, 22], size: [180, 50], text: lang.CANCEL,
        onPress: () => this.close(),
      });
    },
    // every way out ends here, a tap outside the popup too (see DLZMOD_wifiList)
    onDestroy: function () {
      DLZMOD_zonePicker.popup = null;
      PopupWindow.prototype.onDestroy.call(this);
      DLZMOD_repaintSoon();
    },
    show: function (page) {
      this.page = Math.max(0, Math.min(page, pages - 1));
      this.update();
    },
    items: function () {
      return zones.slice(this.page * PER, (this.page + 1) * PER);
    },
    pick: function (z) {
      this.close();
      DLZMOD_setZone(z.zone);
    },
    paint: function (t) {
      PopupWindow.prototype.paint.call(this, t);
      t.drawText("Time Zone  " + (this.page + 1) + "/" + pages, this.w / 2 | 0, 36, { color: Color.white,
        font: Font.font(600, "18pt"), align: "center", valign: "middle" });
      const cur = DLZMOD_timeState().zone;
      this.items().forEach((z, i) => {
        const x = 24 + (i / ROWS | 0) * colW, y = TOP + (i % ROWS) * ROW_H, cy = y + (ROW_H - 6) / 2 | 0;
        const on = z.zone === cur;
        t.fRect(on ? DLZMOD_accent() : Color.buttonBg, x, y, colW - 6, ROW_H - 6);
        t.drawText(z.offset, x + 12, cy, { color: on ? Color.black : "#888888", font: Font.font(500, "12pt"),
          align: "left", valign: "middle" });
        t.drawText(z.cities, x + 112, cy, { color: on ? Color.black : Color.white, font: Font.font(500, "13pt"),
          align: "left", valign: "middle", max: colW - 130 });
      });
    },
  });
}

// Network panel: Wi-Fi (a USB stick) and SSH, both run by the server mod (DLZMOD_net in
// dlzmod-server.js). The status comes from the server (DLZMOD_NET_STATE); the SSH switch shows it
// and is no hub key, so nothing about it is sent to other clients or saved in srv_data.json.
// An SSH change sent from here counts as running at once (DLZMOD_sshSend), not only from the server's
// next status, until its outcome or the popup's time-out (DLZMOD_netIdle). Another network change's
// spinner drops that mark too; the server's sshBusy brings it back with the next status.
function DLZMOD_netState() {
  const s = DLZMOD_netState.s || { stick: false, wifi: "", ssid: "", signal: 0, ip: "", ssh: false, sshKeep: false,
    sshBusy: "", unknown: true };
  return DLZMOD_sshSend.busy && !s.sshBusy ? Object.assign({}, s, { sshBusy: DLZMOD_sshSend.busy }) : s;
}

function DLZMOD_setNetState(s) {
  DLZMOD_netState.s = s;
  const page = DLZMOD_page();
  if (page) {
    page.network.update();
    page.pair.update();
  }
}

// Wi-Fi status on the Wi-Fi card: two short lines and their colour
function DLZMOD_wifiStatusText(s) {
  if (s.remote) return ["Only on the mixer's", "own screen", "#888888"];
  if (s.unknown) return ["…", "", "#888888"];
  // stick = NetworkManager has a Wi-Fi device, i.e. a stick with a driver; one without stays unseen
  if (!s.stick) return ["No working Wi-Fi stick", "Not every stick is supported", "#888888"];
  if (s.wifi === "connected") return [s.ssid || "Connected", s.ip, Color.main];
  if (s.wifi === "connecting") return ["Connecting…", "", DLZMOD_accent()];
  if (s.wifi === "unavailable") return ["Wi-Fi stick not ready", "", "#888888"];
  return ["Not connected", "", "#888888"];
}

// SSH status under "Remote login" and its colour. Other devices get no SSH state (DLZMOD_net), and a
// change still running (sshBusy) shows as Wi-Fi's "Connecting…" does
function DLZMOD_sshStatusText(s) {
  if (s.remote) return ["Only on the mixer's own screen", "#888888"];
  if (s.unknown) return ["…", "#888888"];
  if (s.sshBusy === "on") return ["Setting up…", DLZMOD_accent()];
  if (s.sshBusy === "off") return ["Switching off…", DLZMOD_accent()];
  if (s.ssh) return ["On", "#888888"];
  return [s.sshKeep ? "Off now, back on at the next start" : "Off", "#888888"];
}

// the SSH controls: not on another device, and not while a change runs
function DLZMOD_sshIdle(s) {
  return !s.remote && !s.sshBusy;
}

// Network page: two cards, Wi-Fi and SSH, in a container without paint of its own, so that
// page.network.update() and globalVisible() cover both
function DLZMOD_networkPanel(parent, x, y, w) {
  const cw = (w - 12) / 2 | 0;
  return new Widget(parent, {
    anchors: [x, y],
    size: [w, DLZMOD_panelH()],
    opaque: !1,
    paint: function () {},
    _constructor: function () {
      this.wifi = DLZMOD_wifiCard(this, 0, cw);
      this.ssh = DLZMOD_sshCard(this, w - cw, cw);
    },
  });
}

function DLZMOD_wifiCard(parent, x, w) {
  return new Widget(parent, {
    anchors: [x, 0],
    size: [w, DLZMOD_panelH()],
    bgColor: Color.bgDark,
    _constructor: function () {
      this.networks = new E1Button(this, {
        anchors: [0, 150, null, null, !0], size: [w - 48, 56], text: "Wi-Fi Networks...",
        onPress: () => DLZMOD_wifiList(),
        getState: function () {
          const s = DLZMOD_netState();
          this.enabled = s.stick && s.wifi !== "unavailable";
        },
      });
    },
    paint: function (t) {
      DLZMOD_paintPanel(this, t, "Wi-Fi", Color.white, Font.font(500, "20pt"));
      const max = this.w - 48;
      const [line1, line2, color] = DLZMOD_wifiStatusText(DLZMOD_netState());
      t.drawText(line1, 24, 92, { color: color, font: Font.font(500, "16pt"), align: "left", valign: "middle", max: max });
      if (line2) t.drawText(line2, 24, 118, { color: "#888888", font: Font.font(500, "12pt"), align: "left",
        valign: "middle", max: max });
      t.drawText("Needs a USB Wi-Fi stick: the mixer has no Wi-Fi of its own", this.w / 2 | 0, this.h - 24,
        { color: "#666666", font: Font.font(500, "12pt"), align: "center", max: max });
    },
  });
}

// SSH: on asks for a new root password; "Keep on after a restart" can be turned on while it runs,
// and off also for a marker left behind (both are the server's state, DLZMOD_sshPaths in
// dlzmod-server.js: without it SSH is off after a restart). The warning shows before it is turned on.
function DLZMOD_sshCard(parent, x, w) {
  return new Widget(parent, {
    anchors: [x, 0],
    size: [w, DLZMOD_panelH()],
    bgColor: Color.bgDark,
    _constructor: function () {
      // no hub key: shows the server's state (getState); a tap flips it only until the next
      // status, so ON asks for the password and OFF switches SSH off
      this.ssh = new Switcher(this, {
        anchors: [w - 24 - 72, 73], size: [72, 46], margin: 10,
        bgColors: [Color.buttonBg, DLZMOD_accent()], knobMargin: 0,
        getState: function () {
          const s = DLZMOD_netState();
          this.value = !!s.ssh;
          this.enabled = DLZMOD_sshIdle(s);
        },
        setVal: function (v) {
          this.value = v;
        },
        onToggleON: () => DLZMOD_confirmSsh(),
        onToggleOFF: () => DLZMOD_sshSend(!1),
      });
      this.keepOn = new Switcher(this, {
        anchors: [w - 24 - 72, 206], size: [72, 46], margin: 10,
        bgColors: [Color.buttonBg, DLZMOD_accent()], knobMargin: 0,
        getState: function () {
          const s = DLZMOD_netState();
          this.value = !!s.sshKeep;
          this.enabled = DLZMOD_sshIdle(s) && (!!s.ssh || !!s.sshKeep);   // a marker left behind can always go
        },
        setVal: function (v) {
          this.value = v;
        },
        onToggleON: () => DLZMOD_sshKeepSet(!0),
        onToggleOFF: () => DLZMOD_sshKeepSet(!1),
      });
      this.password = new E1Button(this, {
        anchors: [0, 300, null, null, !0], size: [w - 48, 56], text: "SSH Password...",
        onPress: () => DLZMOD_askSshPassword(),
        getState: function () {
          const s = DLZMOD_netState();
          this.enabled = DLZMOD_sshIdle(s) && !!s.ssh;
        },
      });
    },
    paint: function (t) {
      DLZMOD_paintPanel(this, t, "SSH", Color.white, Font.font(500, "20pt"));
      const s = DLZMOD_netState(), max = this.w - 48;
      const [status, color] = DLZMOD_sshStatusText(s);
      DLZMOD_paintRow(t, 24, this.ssh.geomCenterY(), "Remote login", status, this.w - 24 - 120, color);
      const warn = { color: Color.red2, font: Font.font(500, "12pt"), align: "left", valign: "middle", max: max };
      t.drawText("Gives full root access to the mixer over the network.", 24, 140, warn);
      t.drawText("Only on a network you trust; normal use does not need it.", 24, 160, warn);
      t.drawText("Never run apt upgrade or change system files.", 24, 180, warn);
      DLZMOD_paintRow(t, 24, this.keepOn.geomCenterY(), "Keep on after a restart",
        "Otherwise SSH turns off at the next start", this.w - 24 - 120);
      if (s.ssh && s.ip) t.drawText("ssh root@" + s.ip, this.w / 2 | 0, 278, { color: "#888888", font: Font.font(500, "12pt"),
        align: "center", valign: "middle", max: max });
    },
  });
}

function DLZMOD_sshKeepSet(on) {
  DLZMOD_netBusy(on ? "Keeping SSH on…" : "SSH turns off at the next start…", 30, $FA.lock);
  $NET.cmd("DLZMOD_NET", { op: "sshKeep", on: on });
}

// Mackie's full-screen keyboard (askInput) for a password; the title says what it is for. Its
// keyboard takes 36 characters (maxInput, made for names): 64 here, Mackie's limit back after.
function DLZMOD_askPassword(title, onValue) {
  const kbd = app.pageKbd && app.pageKbd.kbd;
  const max = kbd ? kbd.maxInput : 0;
  if (kbd) kbd.maxInput = 64;
  const reset = () => {
    if (kbd) kbd.maxInput = max;
    setKbdTitle("");
    DLZMOD_repaintSoon();   // once the page is back: a cancelled SSH switch shows the server's state again
  };
  setKbdTitle(title);
  // the keyboard calls this before it closes its page (accept: onValue, then close → pageBack); a
  // popup opened right away went with the page [device]: run it once the page is back
  askInput("", (v) => {
    reset();
    setTimeout(() => onValue(v), 0);
  }, reset, reset);
}

// Switching SSH on asks first, in the style of Mackie's confirmations (the red button as in "Forget
// this network"); the switch goes back to the server's state meanwhile, so Cancel leaves it off
function DLZMOD_confirmSsh() {
  const page = DLZMOD_page();
  if (page) page.network.update();
  new PopupConfirm(app, {
    title: "Remote login (SSH)",
    text: "Anyone with the password gets full control of the mixer.\nChanging or deleting system files can stop it from working.\nOnly for people who know Linux.",
    buttons: [{ text: "Turn on", colors: [Color.deny, Color.red] }, { text: lang.CANCEL }],
    icon: $FA.exclamation,
    func: () => setTimeout(() => DLZMOD_askSshPassword(), 0),   // once the popup has closed
  });
}

function DLZMOD_askSshPassword() {
  DLZMOD_askPassword("New root password for SSH (8 or more characters)", (pw) => {
    if (pw.length < 8) return DLZMOD_netResult({ ok: !1, text: "An SSH password has 8 to 64 characters" });
    DLZMOD_sshSend(!0, pw);
  });
}

// SSH on or off: the spinner, the card's mark (DLZMOD_netState) and the command
function DLZMOD_sshSend(on, password) {
  if (on) DLZMOD_netBusy("Setting up SSH…\nThe first time takes up to a few minutes.", 240, $FA.lock);
  else DLZMOD_netBusy("Switching SSH off…", 60, $FA.lock);
  DLZMOD_sshSend.busy = on ? "on" : "off";
  $NET.cmd("DLZMOD_NET", on ? { op: "ssh", on: !0, password: password } : { op: "ssh", on: !1 });
  const page = DLZMOD_page();
  if (page) page.network.update();
}

// Mackie's spinner popup (as showMessageWithSpinner) while a change runs; closed by its outcome,
// or after seconds without one (the server restarted, the connection dropped): the popup is modal
function DLZMOD_netBusy(text, seconds = 90, icon = $FA.wifi) {
  DLZMOD_netIdle();
  DLZMOD_netBusy.popup = new PopupShowProgress(app, { title: "", text: text, icon: icon });
  DLZMOD_netBusy.timer = setTimeout(() => DLZMOD_netResult({ ok: !1, text: "No answer from the mixer.\nTry again." }),
    seconds * 1000);
}

function DLZMOD_netIdle() {
  const p = DLZMOD_netBusy.popup;
  clearTimeout(DLZMOD_netBusy.timer);
  DLZMOD_netBusy.popup = null;
  DLZMOD_sshSend.busy = "";
  if (p) p.close();
}

// outcome of a network change, in the style of Mackie's popups. quiet (a PIN set): no popup, the
// Remote panel shows the new PIN instead
function DLZMOD_netResult(r) {
  DLZMOD_netIdle();
  const pg = DLZMOD_page();
  if (r.ok && r.quiet && pg && pg.pair.globalVisible()) return pg.pair.revealPin(!0);   // else the popup
  showMessage(r.text, { title: "Network", textColor: r.ok ? Color.green : Color.red2,
    font: Font.font(500, "17pt"), textDY: 32 });
  const page = DLZMOD_page();
  if (page) {
    page.network.update();
    page.pair.update();
  }
}

// Remote Control (#45): a computer's web browser (phones and tablets: Mackie's web UI does not fit
// them and misses touches yet, #52), run by the server mod
// (DLZMOD_pair* in dlzmod-server.js). Off by default; on shows a PIN that pairs one device (then a
// new one shows). The state comes with the Network status (pair: {on, pin, devices, wait, ips}),
// which the server sends only to this screen; nothing of it is a hub key.
function DLZMOD_pairPanel(parent, x, y, w) {
  return new Widget(parent, {
    anchors: [x, y],
    size: [w, DLZMOD_panelH()],
    bgColor: Color.bgDark,
    _constructor: function () {
      // as the SSH switch: the server's state; ON asks first, OFF switches off right away
      this.on = new Switcher(this, {
        anchors: [w - 24 - 72, 73], size: [72, 46], margin: 10,
        bgColors: [Color.buttonBg, DLZMOD_accent()], knobMargin: 0,
        getState: function () {
          const p = DLZMOD_netState().pair;
          this.value = !!(p && p.on);
          this.enabled = !!p;
        },
        setVal: function (v) {
          this.value = v;
        },
        onToggleON: () => DLZMOD_confirmPair(),
        onToggleOFF: () => {
          DLZMOD_netBusy("Switching control from other devices off…", 30, $FA.lock);
          $NET.cmd("DLZMOD_NET", { op: "pair", on: !1 });
        },
      });
      this.forget = new E1Button(this, {
        anchors: [24, 310], size: [280, 56], text: "Forget All Devices",
        onPress: () => DLZMOD_confirmPairForget(),
        getState: function () {
          const p = DLZMOD_netState().pair;
          this.enabled = !!(p && p.on);
        },
      });
      // the owner's own PIN (stays until changed), or back to a random one (new after each pairing)
      this.random = new E1Button(this, {
        anchors: [w - 24 - 200 - 12 - 200, 310], size: [200, 56], text: "Random PIN",
        onPress: () => {
          DLZMOD_netBusy("Making a random PIN…", 30, $FA.lock);
          $NET.cmd("DLZMOD_NET", { op: "pairPin" });   // no popup after: the panel shows the new PIN
        },
        getState: function () {
          const p = DLZMOD_netState().pair;
          this.enabled = !!(p && p.on && p.own);
        },
      });
      this.ownPin = new E1Button(this, {
        anchors: [w - 24 - 200, 310], size: [200, 56], text: "Own PIN...",
        onPress: () => DLZMOD_askOwnPin(),
        getState: function () {
          const p = DLZMOD_netState().pair;
          this.enabled = !!(p && p.on);
        },
      });
      // the PIN stays hidden (the screen is often on camera) until asked for, then for 30 s. Above
      // Random PIN, same size, centred on the PIN's line
      this.showPin = new E1Button(this, {
        anchors: [w - 24 - 200 - 12 - 200, 210], size: [200, 56], text: "Show PIN",
        onPress: () => this.revealPin(!this.shown),
        // enabled, never hidden: Mackie's widgets only run getState while visible, so a button that
        // hides itself here stays hidden after the switch goes on [device]
        getState: function () {
          const p = DLZMOD_netState().pair;
          this.enabled = !!(p && p.on);
          this.text = this.parent.shown ? "Hide PIN" : "Show PIN";
        },
      });
      this.shown = !1;
    },
    revealPin: function (on) {
      clearTimeout(this.hideTimer);
      this.shown = !!on;
      if (on) this.hideTimer = setTimeout(() => this.revealPin(!1), 30000);
      this.update();
    },
    paint: function (t) {
      DLZMOD_paintPanel(this, t, "Remote Control", Color.white, Font.font(500, "20pt"));
      const s = DLZMOD_netState(), p = s.pair, max = this.w - 48;
      DLZMOD_paintRow(t, 24, this.on.geomCenterY(), "Control from other devices",
        "A computer on the same network, in a web browser", this.w - 24 - 120);
      const warn = { color: Color.red2, font: Font.font(500, "12pt"), align: "left", valign: "middle", max: max };
      t.drawText("A paired device can change every setting and delete recordings, presets and snapshots.", 24, 140, warn);
      t.drawText("Only on a network you trust: the connection is not encrypted.", 24, 160, warn);
      const grey = { color: "#888888", font: Font.font(500, "14pt"), align: "left", valign: "middle", max: max };
      if (s.remote) return t.drawText("Only on the mixer's own screen", 24, 220, grey);
      if (!p) return t.drawText("…", 24, 220, grey);
      if (!p.on) return t.drawText("Off: only this screen and the mixer's own controls work.", 24, 220, grey);
      const addr = p.ips && p.ips.length ? p.ips.map((ip) => "http://" + ip).join("  or  ") : "the address in Settings, About";
      DLZMOD_paintRow(t, 24, 222, "Open in a web browser", addr, this.w - 24 - 200 - 12 - 200 - 48);
      t.drawText(p.devices === 1 ? "1 device paired" : p.devices ? p.devices + " devices paired" : "No devices paired yet",
        24, 272, grey);
      t.drawText(p.own ? "Your own PIN" : "PIN", this.w - 24, 200,
        { color: "#888888", font: Font.font(500, "12pt"), align: "right", valign: "middle" });
      t.drawText(this.shown ? p.pin.slice(0, 3) + " " + p.pin.slice(3) : "••• •••", this.w - 24, 238,
        { color: DLZMOD_accent(), font: Font.font(600, "34pt"), align: "right", valign: "middle" });
      t.drawText(p.wait ? "Too many wrong PINs: wait " + p.wait + " s"
        : p.own ? "Stays until you change it" : "A new one after each pairing", this.w - 24, 276,
        { color: p.wait ? Color.red2 : "#888888", font: Font.font(500, "12pt"), align: "right", valign: "middle" });
    },
  });
}

// turning it on asks first, as SSH does; the switch goes back to the server's state meanwhile
function DLZMOD_confirmPair() {
  const page = DLZMOD_page();
  if (page) page.pair.update();
  new PopupConfirm(app, {
    title: "Control from other devices",
    text: "Computers on this network can control the mixer\nin a web browser after entering the PIN shown here.\nOnly on a network you trust.",
    buttons: [{ text: "Turn on", colors: [Color.deny, Color.red] }, { text: lang.CANCEL }],
    icon: $FA.exclamation,
    func: () => {
      DLZMOD_netBusy("Switching control from other devices on…", 30, $FA.lock);
      $NET.cmd("DLZMOD_NET", { op: "pair", on: !0 });
    },
  });
}

// on a PIN pad in the layout of Mackie's System Lock (PopupLock: 3 x 4 keys, the digits above as
// underscores), for 6 digits; the server checks it too (not an obvious one). Set: no popup, the
// panel shows the new PIN (DLZMOD_netResult, quiet)
function DLZMOD_askOwnPin() {
  DLZMOD_pinPad("Your own PIN", (pin) => {
    DLZMOD_netBusy("Setting your PIN…", 30, $FA.lock);
    $NET.cmd("DLZMOD_NET", { op: "pairPin", pin: pin });
  });
}

// Mackie's PopupLock layout and behaviour (the back key closes, a 7th digit starts over, the lock
// key works once all digits are in), for n digits and its own action
function DLZMOD_pinPad(title, onDone, n = 6) {
  new PopupWindow(app, {
    w: 350, h: 430, value: "", color: Color.main,
    input: function (d) {
      if (this.value.length >= n) this.value = "";
      this.value += d;
      this.done.enabled = this.value.length === n;
      this.update();
    },
    initWidgets: function () {
      const keys = [];
      for (let i = 0; i < 9; i++) keys.push(["" + (i + 1), () => this.input(i + 1)]);
      keys.push(["", () => this.close(), { paintOverlay: function (t) {
        t.drawText($MI.arrow_back, this.w / 2 | 0, this.h / 2 | 0, { color: Color.white30, font: Font.mi("28px"),
          align: "center", valign: "middle" });
      } }]);
      keys.push(["0", () => this.input(0)]);
      keys.push(["", () => {
        const v = this.value;
        this.close();
        setTimeout(() => onDone(v), 0);   // once the popup has closed
      }, { enabled: !1, colors: [Color.confirm, Color.main], paintOverlay: function (t) {
        t.drawText($FA.check, this.w / 2 | 0, this.h / 2 | 0, { color: this.state ? Color.white : Color.main,
          font: Font.fa("28px"), align: "center", valign: "middle" });
      } }]);
      keys.forEach((k, i) => {
        const b = new E1Button(this, Object.assign({ anchors: [76 * (i % 3 - 1), 72 * (i / 3 | 0) - 60, , , !0, !0],
          size: [66, 60], text: k[0], font: Font.font(600, "15pt"), textColor: Color.white, onPress: k[1] }, k[2] || {}));
        if (i === 11) this.done = b;
      });
    },
    paint: function (t) {
      PopupWindow.prototype.paint.call(this, t);
      const c = this.w / 2 | 0, step = 34;
      t.drawText(title, c, 26, { color: "#C2C2C2", font: Font.font(600, "16pt"), align: "center", valign: "middle" });
      t.fRect(Color.bgDark, c - 120, 55, 240, 50, 8);
      t.setParams({ color: this.color, font: Font.font(600, "24pt") });
      (this.value + "_".repeat(n - this.value.length)).split("").forEach((ch, i) => {
        t.drawText(ch, c + step * (i - (n - 1) / 2), 80);
      });
    },
  });
}

// in a browser (Mackie's EXTERNAL: not the mixer's own screen; set before startGUI builds the
// pages, so widgets can be left out when they are made)
function DLZMOD_external() {
  return typeof EXTERNAL !== "undefined" && !!EXTERNAL;
}

// what the server only takes from the screen and the browser still offers (unlocking a locked
// mixer, patch.py) says so instead of acting as if it worked; true: stop there. System Lock, Factory
// Reset and the Network and Remote tabs are not shown in a browser at all
function DLZMOD_screenOnly() {
  if (!DLZMOD_external()) return !1;
  showMessage("Only on the mixer's own screen", { title: DLZMOD_tabLabel(), font: Font.font(500, "17pt"), textDY: 32 });
  return !0;
}

function DLZMOD_confirmPairForget() {
  const own = !!(DLZMOD_netState().pair || {}).own;
  new PopupConfirm(app, {
    title: "Forget all devices",
    text: own ? "Every paired device is disconnected and needs your PIN again.\nChange the PIN too if others know it."
      : "Every paired device is disconnected and needs the new PIN again.",
    buttons: [{ text: "Forget", colors: [Color.deny, Color.red] }, { text: lang.CANCEL }],
    icon: $FA.lock,
    func: () => {
      DLZMOD_netBusy("Forgetting all devices…", 30, $FA.lock);
      $NET.cmd("DLZMOD_NET", { op: "pairForget" });
    },
  });
}

// Wi-Fi network list: a Mackie popup (modal: the page behind it takes no touches), up to 6
// networks, connected first, then by signal (the server sorts). A tap closes it and connects
// (password on Mackie's keyboard when the network has one), or offers to forget a saved one.
function DLZMOD_setWifiList(l) {
  const p = DLZMOD_wifiList.popup;
  if (p) p.setList(l);
}

function DLZMOD_wifiList() {
  const ROWS = 6, ROW_H = 44, TOP = 66, W = 720;
  if (DLZMOD_wifiList.popup) return;
  DLZMOD_wifiList.popup = new PopupWindow(app, {
    w: W, h: 430, bgColor: Color.bgPopup, list: [], scanning: !1, error: "",
    initWidgets: function () {
      for (let i = 0; i < ROWS; i++) {
        new Widget(this, {
          anchors: [24, TOP + i * ROW_H], size: [W - 48, ROW_H - 4], opaque: !1, idx: i,
          paint: function () {},   // touch area only: the popup paints the rows
          onup: function () {
            const n = this.parent.list[this.idx];
            if (n && !this.parent.scanning) this.parent.pick(n);
          },
        });
      }
      this.scan = new E1Button(this, {
        anchors: [24, null, null, 22], size: [210, 50], text: "Scan Again",
        onPress: () => this.rescan(),
        getState: function () {
          this.enabled = !this.parent.scanning;
        },
      });
      new E1Button(this, {
        anchors: [null, null, 24, 22], size: [210, 50], text: lang.CANCEL,
        onPress: () => this.close(),
      });
      this.rescan();
    },
    // every way out ends here: close() (Cancel, a pick) destroys it, and so does a tap outside the
    // popup, which skips onClose (the marker then stayed set and the button did nothing until a
    // restart [device]); PopupWindow's own onDestroy resets the overlay's background
    onDestroy: function () {
      DLZMOD_wifiList.popup = null;
      PopupWindow.prototype.onDestroy.call(this);
      $NET.cmd("DLZMOD_NET", { op: "status" });
    },
    rescan: function () {
      this.scanning = !0;
      this.error = "";
      this.update();
      $NET.cmd("DLZMOD_NET", { op: "scan" });
    },
    setList: function (l) {
      this.scanning = !1;
      this.list = (l && l.networks || []).slice(0, ROWS);
      this.error = l && l.error || "";
      this.update();
    },
    pick: function (n) {
      this.close();   // the keyboard and the other popups need the screen to themselves
      if (n.security === "unsupported") {
        return DLZMOD_netResult({ ok: !1, text: n.ssid + " uses a login this mixer\ndoes not support (WEP or company login)." });
      }
      if (n.active || n.known) {
        return new PopupConfirm(app, {
          title: n.ssid, text: n.active ? "Connected. Forget this network?" : "Saved. Forget this network?",
          buttons: [{ text: "Forget", colors: [Color.deny, Color.red] }, { text: lang.CANCEL }],
          icon: $FA.wifi,
          func: () => {
            DLZMOD_netBusy("Forgetting " + n.ssid + "…", 60);
            $NET.cmd("DLZMOD_NET", { op: "forget", ssid: n.ssid });
          },
        });
      }
      const connect = (pw) => {
        DLZMOD_netBusy("Connecting to " + n.ssid + "…", 150);
        $NET.cmd("DLZMOD_NET", { op: "connect", ssid: n.ssid, security: n.security, password: pw });
      };
      if (n.security === "open") return connect("");
      DLZMOD_askPassword("Wi-Fi password for " + n.ssid, (pw) => {
        if (pw.length < 8) return DLZMOD_netResult({ ok: !1, text: "A Wi-Fi password has 8 to 63 characters" });
        connect(pw);
      });
    },
    paint: function (t) {
      PopupWindow.prototype.paint.call(this, t);
      t.drawText("Wi-Fi Networks", this.w / 2 | 0, 36, { color: Color.white, font: Font.font(600, "18pt"),
        align: "center", valign: "middle" });
      const msg = this.scanning ? "Looking for networks…" : this.error || (this.list.length ? "" : "No networks found");
      if (msg) t.drawText(msg, this.w / 2 | 0, TOP + 2 * ROW_H, { color: Color.text, font: Font.font(500, "14pt"),
        align: "center", valign: "middle" });
      if (this.scanning) return;
      this.list.forEach((n, i) => {
        const y = TOP + i * ROW_H, cy = y + (ROW_H - 4) / 2 | 0, right = this.w - 24;
        t.fRect(Color.buttonBg, 24, y, W - 48, ROW_H - 4);
        // signal: four bars, lit by strength
        for (let b = 0; b < 4; b++) {
          const h = 6 + b * 6;
          t.fRect(n.signal > b * 25 ? (n.active ? Color.main : Color.white) : "#555555", 40 + b * 8, cy + 12 - h, 5, h);
        }
        t.drawText(n.ssid, 90, cy, { color: n.active ? Color.main : Color.white, font: Font.font(500, "15pt"),
          align: "left", valign: "middle", max: W - 300 });
        const tag = n.active ? "Connected" : n.known ? "Saved" : n.security === "unsupported" ? "Not supported" : "";
        if (tag) t.drawText(tag, right - 44, cy, { color: n.active ? Color.main : "#888888", font: Font.font(500, "12pt"),
          align: "right", valign: "middle" });
        if (n.security !== "open") t.drawText($FA.lock, right - 20, cy, { color: "#888888", font: Font.fa("16px"),
          align: "center", valign: "middle" });
      });
    },
  });
}

// #26: recordings to a computer (dlzmod-server.js, DLZMOD_recHttp). A download button on the Media
// page, left of Sort (patch.py; style: the page's own button style), only in a browser
// (DLZMOD_external, known before the pages are built: never on the mixer's own screen), enabled in a
// recordings folder only (the server serves nothing else), like stock's Rename and Delete. The path
// label (520 wide around x 29) then ends left of it: Mackie shortens a longer path with " .. ".
// A selected recording downloads on its own; nothing (or a folder) selected asks to download all
// the folder's recordings
function DLZMOD_mediaDownloadButton(page, style) {
  const external = DLZMOD_external();
  if (external && page.lPath) page.lPath.setSize(424, 40);
  return new E1Button(page, Object.assign({}, style, {
    // Font Awesome's "download" (in Mackie's font, not in its $FA list)
    anchors: [264, -214, null, null, !0, !0], text: "\uf019", visible: external, regKey: ["player.path"],
    getState: function () {
      this.enabled = !!DLZMOD_recFolder(page.getPath());
    },
    onPress: () => DLZMOD_download(page),
  }));
}

// #14: date and time in recording names (dlzmod-server.js, DLZMOD_recStamp), a switch on Settings,
// Recording / Routing, in the form of the panel's own rows: key, label, the reset button's value.
// Settings builds that panel before the Mod page, so the keys are added here already
function DLZMOD_recDateRow() {
  DLZMOD_initKeys();
  return ["dlzmod.recDate", "Date & Time in Name", 0];
}

// the panel's switch rows (stock: 64 px apart from 190, three of them): four, 52 apart from 178, the
// last ending 14 px above the panel's bottom (392)
function DLZMOD_recRowY(i) {
  return 178 + 52 * i;
}

// #193: the player's title line (dspserver's "artist - title", the file name when there is no title)
// without the artist dspserver writes into every recording of its own; other files keep their artist
function DLZMOD_trackName(name) {
  const own = "DLZ|Creator - ";
  return typeof name === "string" && name.startsWith(own) ? name.slice(own.length) : name;
}

// the mod's mark on a setting in a stock screen (ground rule 9, for bug reports and support): a short
// bar in the mod's yellow left of the setting's label, at the height of its control w
function DLZMOD_stockMark(t, w) {
  if (w) t.fRect(DLZMOD_yellow(), 10, w.geomCenterY() - 9, 3, 18);
}

// the Media page's path ("sd:\DLZ_Creator_XS_Recordings") to {medium, dir} when it is a recordings
// folder (dlzmod-server.js, DLZMOD_REC_DIRS), else null
function DLZMOD_recFolder(path) {
  const m = /^(sd|usb):\\(DLZ_Creator_Recordings|DLZ_Creator_XS_Recordings)$/.exec(path || "");
  return m ? { medium: m[1], dir: m[2] } : null;
}

// the server's list first: it knows whether the mixer records and leaves out recordings still being
// written, and gives the sizes for the question
function DLZMOD_download(page) {
  const f = DLZMOD_recFolder(page.getPath());
  if (!f) return;
  const sel = page.list.selected();
  const title = "Download";
  fetch("/dlzmod-rec", { cache: "no-store" })
    .then((r) => r.ok ? r.json() : Promise.reject(new Error("HTTP " + r.status)))
    .then((list) => {
      if (list.recording) {
        return showMessage("The mixer is busy with a recording.\nDownload when it has finished.", { title: title });
      }
      const m = list.media.find((x) => x.medium === f.medium);
      const files = m ? m.files.filter((x) => x.dir === f.dir) : [];
      const all = () => DLZMOD_downloadFiles(f, files);
      const allText = (files.length === 1 ? "1 recording" : "all " + files.length + " recordings") +
        " (" + DLZMOD_size(files.reduce((s, x) => s + x.size, 0)) + ")";
      const several = "Your browser may ask to allow several downloads.";
      // a selected recording: that one or all of them (Mackie's list cannot be unselected)
      if (sel && !sel.endsWith("\\")) {
        const one = files.find((x) => x.name === sel);
        if (!one) return showMessage(sel + "\ncannot be downloaded.", { title: title });
        const just = () => (DLZMOD_downloadFiles(f, [one]), showToast("Downloading: " + sel));
        if (files.length === 1) return just();
        const style = { textStyle: { font: Font.font(600, "16pt") }, textColors: [Color.main, Color.white],
          colors: [Color.confirm, Color.main] };
        // three buttons of Mackie's fixed width: a wider popup
        return askConfirm("Download " + sel + "\nor " + allText + "?\n" + several, { title: title, w: 760, buttons: [
          Object.assign({ text: "This one", onPress: function () { this.parent.destroy(), just(); } }, style),
          // All in Mackie's blue, darkened like its confirm green, so the two stand apart
          Object.assign({}, style, { text: "All " + files.length, textColors: [Color.blue, Color.white],
            colors: ["#1B455A", Color.blue], onPress: function () { this.parent.destroy(), all(); } }),
          { text: $FA.times, textStyle: { font: Font.fa("36px") }, textColors: [Color.white, Color.white],
            colors: [Color.deny, Color.red], onPress: function () { this.parent.destroy(); } },
        ] });
      }
      if (!files.length) return showMessage("No recordings to download here.", { title: title });
      askConfirm("Download " + allText + "?\n" + several, { title: title }, all);
    })
    .catch(() => showMessage("The mixer did not answer. Try again.", { title: title }));
}

// each file to the browser's downloads (it runs a few at a time, each can resume on its own)
function DLZMOD_downloadFiles(f, files) {
  files.forEach((x, i) => setTimeout(() => {
    const a = document.createElement("a");
    a.href = "/dlzmod-rec/" + f.medium + "/" + encodeURIComponent(f.dir) + "/" + encodeURIComponent(x.name);
    a.download = x.name;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }, i * 400));
}

// one decimal below 10, the unit the number rounds to: 9.96 MB is "10 MB", 999.6 MB "1.0 GB"
function DLZMOD_size(bytes) {
  if (bytes < 1e3) return bytes + " bytes";
  const units = ["KB", "MB", "GB", "TB"];
  const fmt = (v) => (Number(v.toFixed(1)) >= 10 ? v.toFixed(0) : v.toFixed(1));
  let v = bytes / 1e3, i = 0;
  while (i < units.length - 1 && Number(fmt(v)) >= 1000) {
    v /= 1e3;
    i++;
  }
  return fmt(v) + " " + units[i];
}
