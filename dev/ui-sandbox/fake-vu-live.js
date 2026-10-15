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
