// Moving fake meter levels for the PC sandbox (no audio there). Loaded by shim.js into index.html
// after app.js (off with http://127.0.0.1/?novu). Feeds parseVuData a VU message every 50 ms, as
// the hub would. Per channel an input level ("gain": after the gain, before the fader) with its own
// slow swing, a bit of flicker and now and then a peak into the yellow and red; "post" is that level
// through the strip's fader and mute, the way the mixer computes it (Mackie's own VtoMix and
// modVuByDb, as on the aux page), so moving a fader moves the post-fader bar. "pre" (before the gain)
// sits a little lower. Levels are Mackie's VU scale (0..1, 1/80 per dB).
(() => {
  const chans = Array.from({ length: 32 }, (_, i) => ({
    base: 0.62 + 0.2 * ((i * 37) % 10) / 10,   // where it swings around (some channels into the yellow)
    amp: 0.08 + 0.06 * ((i * 53) % 7) / 7,     // how far
    speed: 0.6 + ((i * 29) % 11) / 8,          // how fast (rad/s)
    phase: i * 1.7,
    peak: 0,
  }));
  const bytes = (vals) => btoa(String.fromCharCode(...vals.map((v) => Math.round(254 * Math.max(0, Math.min(1, v))))));
  // the strip's fader in dB, or null when muted (0 dB if it has no fader)
  function faderDb(strip) {
    if (!strip || !strip.getValue) return 0;
    if (strip.getValue("mute")) return null;
    const mix = strip.getValue("mix");
    return typeof mix === "number" ? VtoMix(mix) : 0;
  }
  function tick() {
    const now = performance.now() / 1000;
    const msg = {};
    for (const type of VU_CH_TYPES) {
      const st = VU_STRUCT[type];
      const per = st.stereo ? 2 : 1;
      const gain = [], post = [], pre = [];
      for (let i = 0; i < st.amount * per; i++) {
        const c = chans[(i + type.length * 5) % chans.length];
        if (c.peak <= 0 && Math.random() < 0.004) c.peak = 1;   // about every 12 s per channel
        c.peak = Math.max(0, c.peak - 0.04);
        let g = c.base + c.amp * Math.sin(now * c.speed + c.phase + i) + 0.02 * (Math.random() - 0.5);
        g = Math.max(g, c.peak * 0.99);
        const db = faderDb(st.strips && st.strips[i / per | 0]);
        gain.push(g);
        post.push(db === null ? 0 : modVuByDb(g, db));
        pre.push(g - 0.05);
      }
      msg[type + ".gain"] = bytes(gain);
      msg[type + ".post"] = bytes(post);
      msg[type + ".pre"] = bytes(pre);
    }
    // the EQ spectrum (#131): with an EQ page open (dlzmod.rta), its channel's octave bands as the
    // graph mod sends them (one byte per band, 240 = 0 dBFS): falling towards the highs like music,
    // each band swinging on its own, plus the open EQ curve's gain at the band (read back from the
    // curve it draws, graphPoints: [x, y] pixels, 0 dB in the middle), as the mixer measures after the EQ
    if (Data.data["dlzmod.rta"]) {
      const eq = DLZMOD_rtaShown.page && DLZMOD_rtaShown.page.eq;
      const gainAt = (f) => {
        const ps = eq && !eq.bypass && eq.graphPoints;
        if (!ps || !ps.length) return 0;
        const x = eq.freqToX(f);
        const p = ps.reduce((a, b) => (Math.abs(b[0] - x) < Math.abs(a[0] - x) ? b : a));
        return (Math.round(0.5 * eq.h) - p[1]) / (0.5 * eq.h / eq.gainRange);
      };
      const bands = DLZMOD_rtaFreqs().map((f, k) => {
        const c = chans[k + 3];
        const g = gainAt(f);
        return (0.62 - 0.03 * k + g / 80 + 0.07 * Math.sin(now * c.speed * 1.5 + c.phase) + 0.02 * (Math.random() - 0.5)) * 240 / 254;
      });
      msg["dlzmod.rta"] = bytes(bands);
    }
    parseVuData(msg);
  }
  const start = setInterval(() => {
    if (typeof parseVuData !== "function" || typeof VU_CH_TYPES === "undefined" || typeof app === "undefined" || !app.pageAux) return;
    clearInterval(start);
    clearInterval(window.DLZMOD_fakeVu);
    window.DLZMOD_fakeVu = setInterval(tick, 50);
    console.log("[sandbox] fake meter levels running (off: ?novu)");
  }, 200);
})();
