// DLZ Creator Modded additions to Mackie's /srv/app.js, appended by install/patch.py.
// Only function declarations here: they are hoisted, so the patched Mackie code can call them
// even when the UI is built before this part of the script has run.

function DLZMOD_yellow() {
  return "#FFD600";
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
// are added with their defaults before use; the hub's INIT then brings the saved values. Every
// default is the stock behaviour: after an install the mixer looks
// and works like stock until a setting is changed.
function DLZMOD_keys() {
  return { "dlzmod.hideHeader": 0, "dlzmod.meterMode": 0, "dlzmod.preColor": 0, "dlzmod.preLevel": 0,
    "dlzmod.meterMarks": 0 };
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
// meter background. Green is the strip's own Color.green. Strengths per colour, compared in the
// sandbox: green still shows on the empty track at 15 % and blurs into the bright bar above 50 %;
// grey vanishes into the track below 25 % and stays apart from the green bar at 60 %.
function DLZMOD_preColor() {
  return ["#9CCC56", "#D0D0D0"][Data.data["dlzmod.preColor"] | 0] || "#9CCC56";
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
// Mackie. Replaces m.setValue(post, pre) in parseVuData (patched), for vu and vu2.
function DLZMOD_vuSet(m, gain, idx, post, pre) {
  const mode = DLZMOD_meterModeNow();
  const g = gain && idx < gain.length ? deconvertVU(gain.charCodeAt(idx) || 0) : null;
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
  const k = hex + a;
  if (!c[k]) {
    const mix = (i) => Math.round(0x39 + (parseInt(hex.substr(i, 2), 16) - 0x39) * a).toString(16).padStart(2, "0");
    c[k] = "#" + mix(1) + mix(3) + mix(5);
  }
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
  const yellow = g.find((c) => c[1] !== g[0][1]);   // first stop that is not green
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
  app.topBar.setVisible(!DLZMOD_headerHidden());
  app.updateGeometry();
  app.update();
}

// Settings → Bluetooth / Disk: the only SD slot holds the boot card, so its Format button is hidden
// (server.js refuses FORMAT_SD too) and this note sits where the button was (centre 54 px above
// the panel's bottom edge).
function DLZMOD_paintSdNote(t, panel) {
  let cx = panel.w / 2 | 0, y = panel.h - 54;
  t.drawText(DLZMOD_tabLabel(), cx, y - 11,
    { color: DLZMOD_yellow(), font: Font.font(600, "13pt"), align: "center", valign: "middle" });
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
  if (p && p.approved) return [p.version + " installs at the next start: switch the mixer off and on", DLZMOD_yellow()];
  if (p && (DLZMOD_setUpdateStatus.s || {}).local) return ["Update " + p.version + " is on the card", DLZMOD_yellow()];
  if (p) return ["Update " + p.version + " is on the card: install it on the mixer's own screen", DLZMOD_yellow()];
  const failed = DLZMOD_updateFailed();
  if (failed) return [failed, Color.red2];
  return ["Copy the update's .tar and .sig to DLZDATA/dlzmod-update", null];
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
// of the page right after it closes, only while the page is on screen.
function DLZMOD_repaintSoon() {
  setTimeout(() => {
    const page = DLZMOD_page();
    if (page && page.globalVisible()) page.update();
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
// style of Settings' own tab bar sit above one of three pages of panels: Display (Screen + Meters),
// Network, Mod. Laid out for the header shown; with it hidden Mackie's centring (anchors) splits the
// extra 30 px above and below. glesgui only has Proxima Nova Light/Regular/Semibold: use font weights
// 300-600.
function DLZMOD_settingsPage(parent, y) {
  DLZMOD_initKeys();
  DLZMOD_hookPopups();
  Data.regWidget("dlzmod.hideHeader", DLZMOD_applyHeader);   // also when changed from a browser
  Data.regWidget("dlzmod.meterMarks", DLZMOD_applyMeterMarks);
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
      const names = ["Display", "Network", "Remote", "Mod"];
      const shown = DLZMOD_external() ? [0, 3] : [0, 1, 2, 3];
      this.tabs = shown.map((i, k) => new ToggleButton(this, {
        anchors: [k * 202, 0], w: 200, h: 44, text: names[i], opaque: !1,
        colors: [Color.buttonBg, DLZMOD_yellow()], textColor: Color.subNavButtonText, textColorON: Color.black,
        textStyle: { align: "left", valign: "middle", x: 7, y: 23, offsetX: 0, offsetY: 0, font: Font.font(600, "18px") },
        onToggleON: () => this.setSub(i), getVal: () => this.sub === i,
      }));
      this.screen = DLZMOD_screenPanel(this, 0, top, 290);
      this.meters = DLZMOD_metersPanel(this, 290 + 12, top, 914 - 290 - 12);
      this.network = DLZMOD_networkPanel(this, 0, top, 914);
      this.pair = DLZMOD_pairPanel(this, 0, top, 914);
      this.about = DLZMOD_aboutPanel(this, 0, top, 914);
      this.groups = [[this.screen, this.meters], [this.network], [this.pair], [this.about]];
      this.setSub(0);
      // the Network and Remote Control panels' status, every 3 s while one is on screen (the PIN
      // changes after each pairing)
      setInterval(() => (this.network.globalVisible() || this.pair.globalVisible()) &&
        $NET.cmd("DLZMOD_NET", { op: "status" }), 3000);
    },
    setSub: function (i) {
      this.sub = i;
      if (this.pair) this.pair.revealPin(!1);   // leaving or opening Remote Control hides the PIN
      this.groups.forEach((g, j) => g.forEach((p) => p.setVisible(j === i)));
      if (i === 1 || i === 2) $NET.cmd("DLZMOD_NET", { op: "status" });
      this.update();
    },
    onShow: function () {
      this.pair.revealPin(!1);
      $NET.cmd("DLZMOD_NET", { op: "status" });
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

// Mackie's window, a yellow line on top, the title
function DLZMOD_paintPanel(w, t, title, color, font) {
  PAINT_WINDOW_BG.call(w, t);
  t.fRect(DLZMOD_yellow(), 0, 0, w.w, 4);
  t.drawText(title, w.w / 2 | 0, 40, { color: color, font: font, align: "center", valign: "middle" });
}

// same switch as Mackie's DEMO MODE, ON in mod yellow, 24 px from the right edge of a panel w wide
function DLZMOD_switch(parent, w, y, key, apply) {
  return new Switcher(parent, {
    anchors: [w - 24 - 72, y], size: [72, 46], margin: 10,
    bgColors: [Color.buttonBg, DLZMOD_yellow()], knobMargin: 0, key: key,
    onToggleON: apply, onToggleOFF: apply,
  });
}

// Mackie's segmented control, in mod yellow. applyParams takes an array parameter's first element
// (Mackie writes items:[["",""]]), and only setItems derives w from the items: both given here
function DLZMOD_switchBox(parent, x, y, h, key, items, itemWidth, size) {
  return new SwitchBox(parent, {
    anchors: [x, y], w: items.length * itemWidth, h: h, itemWidth: itemWidth, key: key,
    items: [items], bgColor: Color.buttonBg, color: DLZMOD_yellow(),
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
      t.drawText("Status icons and messages", 24, 136, grey);
      t.drawText("at the top of the screen", 24, 156, grey);
    },
  });
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
      this.preColor = DLZMOD_switchBox(this, 28, 244, 46, "dlzmod.preColor", ["Green", "Grey"], item2, "14pt");
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
      DLZMOD_paintRow(t, 28, 92, "Channel meters", ["After the fader, as Mackie shows them",
        "After the fader, with the level before the fader dimmed behind", "Before the fader"][mode] || "", max);
      if (mode === 1) DLZMOD_paintRow(t, 28, 212, "Before-fader bar", "Its colour and strength", max);
      DLZMOD_paintRow(t, 28, this.meterMarks.geomCenterY(), "Meter marks",
        "Yellow and red zones, dB marks and numbers", this.w - 28 - 120);
    },
  });
}

// Mod: what is installed and how to update it; Install for an update waiting on the card (#65), on
// the mixer's own screen only
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
      this.syncInstall();
    },
    syncInstall: function () {
      const p = DLZMOD_updatePending();
      this.install.setVisible(!!p && !p.approved && !!(DLZMOD_setUpdateStatus.s || {}).local);
    },
    paint: function (t) {
      DLZMOD_paintPanel(this, t, DLZMOD_tabLabel(), DLZMOD_yellow(), Font.font(600, "24pt"));
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
  if (s.wifi === "connecting") return ["Connecting…", "", DLZMOD_yellow()];
  if (s.wifi === "unavailable") return ["Wi-Fi stick not ready", "", "#888888"];
  return ["Not connected", "", "#888888"];
}

// SSH status under "Remote login" and its colour. Other devices get no SSH state (DLZMOD_net), and a
// change still running (sshBusy) shows as Wi-Fi's "Connecting…" does
function DLZMOD_sshStatusText(s) {
  if (s.remote) return ["Only on the mixer's own screen", "#888888"];
  if (s.unknown) return ["…", "#888888"];
  if (s.sshBusy === "on") return ["Setting up…", DLZMOD_yellow()];
  if (s.sshBusy === "off") return ["Switching off…", DLZMOD_yellow()];
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
        bgColors: [Color.buttonBg, DLZMOD_yellow()], knobMargin: 0,
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
        bgColors: [Color.buttonBg, DLZMOD_yellow()], knobMargin: 0,
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
        bgColors: [Color.buttonBg, DLZMOD_yellow()], knobMargin: 0,
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
        { color: DLZMOD_yellow(), font: Font.font(600, "34pt"), align: "right", valign: "middle" });
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

function DLZMOD_size(bytes) {
  const units = [["GB", 1e9], ["MB", 1e6], ["KB", 1e3]];
  for (const [u, n] of units) if (bytes >= n) return (bytes / n).toFixed(bytes >= 10 * n ? 0 : 1) + " " + u;
  return bytes + " bytes";
}
