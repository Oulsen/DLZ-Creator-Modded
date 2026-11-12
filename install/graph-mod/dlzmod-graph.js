// DLZ Creator Modded additions to Mackie's mixergraph-dlzlite.js (XS) and mixergraph.js (full-size),
// the audio graph dspserver runs in its QuickJS, appended by install/patch.py. Only function
// declarations: they are hoisted, so the patched lines above can call them. The file calls
// compileGraph(graph) itself, above this part, so what goes into the graph is patched in before that
// call (DLZMOD_rtaAnalyser too), never pushed here.

// #131 the sound behind the EQ curve. The channel whose EQ page the mixer's screen shows (hub key
// dlzmod.rta, the codes in DLZMOD_rtaTap's callers; 0 = no EQ page open) is mixed into one mono
// buffer of the mod's own, right after its EQ (where Mackie's "dynin" meter sits); at the end of
// the graph one band-pass (DLZMOD_rtaAnalyser) and one meter per half octave report it as the VU group
// "dlzmod.rta". The taps
// only read the channel's buffer and write the mod's own, each in a nested list (flattenGraph keeps
// the current buffer of the list around it), so Mackie's audio path stays as it is. With no EQ page
// open the taps and the band-passes are bypassed.

// the bands' centres in Hz; app-mod/dlzmod.js has the same list (DLZMOD_rtaFreqs)
function DLZMOD_rtaFreqs() {
  return [22.4, 31.5, 45, 63, 90, 125, 180, 250, 355, 500, 710, 1000, 1400, 2000, 2800, 4000, 5600, 8000, 11200, 16000]
}

// the mono buffer the open EQ page's channel is mixed into, made on first use (the first use is the
// Clear at the start of each cycle, before any tap)
function DLZMOD_rtaBuf() {
  if (!globalThis.DLZMOD_rtaBuffer) globalThis.DLZMOD_rtaBuffer = createBuffer('dlzmodRta')
  return globalThis.DLZMOD_rtaBuffer
}

// the channels' dlzmod.rta values; app-mod/dlzmod.js has the same numbers (DLZMOD_rtaCode). The XS's
// channels come first, the full-size's mics 3 and 4 and player 3 after them
function DLZMOD_rtaMicCode(i) {
  return i < 2 ? 1 + i : 7 + i
}

function DLZMOD_rtaPlayerCode(i) {
  return i < 2 ? 3 + i : 9 + i
}

// the meters, for configureVU
function DLZMOD_rtaMeters() {
  return stringRange(DLZMOD_rtaFreqs().length, 'dlzmodRta#')
}

// the tap after a channel's EQ: code = the channel's dlzmod.rta value, bufs = its buffer(s) there;
// a stereo channel goes in at -6 dB per side. A list of its own, put into Mackie's list as one entry.
function DLZMOD_rtaTap(code, bufs) {
  return bufs.map(b => ({
    type: 'GainWithLinMixTo',
    src: b,
    gain: bufs.length > 1 ? -6 : 0,
    bypass: `@dlzmod.rta != ${code}`,
    dest: DLZMOD_rtaBuf(),
  }))
}

// per band a half octave wide band-pass and a meter, each on a copy of the tapped buffer. The band-pass
// is a high-pass a quarter octave below the centre and a low-pass a quarter octave above (EqBand's T_HP
// and T_LP, as Mackie's telephone effect uses them), not EqBand's own T_BP: Mackie never uses that,
// and with it every band read silence on the mixer, with the tap's channel at -10 dB [device].
function DLZMOD_rtaAnalyser() {
  let band = createBuffer('dlzmodRtaBand')
  let meters = DLZMOD_rtaMeters()
  return [band, ...DLZMOD_rtaFreqs().map((f, k) => [
    {type: 'CopyFrom', src: DLZMOD_rtaBuf()},
    {type: 'EqBand', bypass: `!@dlzmod.rta`, kind: T_HP, freq: f / 2 ** 0.25, q: 0.707, gain: 0.0},
    {type: 'EqBand', bypass: `!@dlzmod.rta`, kind: T_LP, freq: Math.min(20000, f * 2 ** 0.25), q: 0.707, gain: 0.0},
    {type: 'MaxMeter', vu: meters[k], threshold: VU_THRESHOLD},
  ])]
}

// #60 a headphone's computer send (a.N.send2usb) on its own USB pair: headphone 1 on USB 3/4 (as
// stock, where every headphone used that pair), 2 on 5/6, and on the full-size 3 on 7/8, 4 on 9/10.
// ch 0 left, 1 right; the index into the graph's usbOuts. Outside "record to computer" (the send's
// other condition) Mackie's strips write silence on these slots earlier in each cycle, so a send
// that is off leaves them silent. app-mod/dlzmod.js labels the switch the same (DLZMOD_hpUsbLabel)
function DLZMOD_hpUsbOut(hp, ch) {
  return 2 + 2 * hp + ch
}

// #18 ducking (the pad editor's Ducking page, app-mod/dlzmod.js DLZMOD_duck*). Stock, mic 1 is the
// trigger (an AutoDuckSource on its own buffer) and the rest is ducked. dspserver's AutoDuckSource
// writes its group's flag (level above the threshold or not) on every cycle, so a second source in
// the group would overwrite the first [static]: instead every trigger mic is mixed into one buffer of
// the mod's own, cleared each cycle, and one AutoDuckSource after the mics reads that. A mic ducked
// by it (one that is not a trigger) runs before that source and so follows the cycle before, a few
// samples. The keys are global settings (dlzmod-server.js DLZMOD_duckDefaults); their stock values
// give stock's ducking: mic 1 the trigger, -25 dB, everything else ducked by -15 dB at stock's speed.

// the buffer the trigger mics are mixed into, made on first use (the Clear at the start of each cycle)
function DLZMOD_duckBuf() {
  if (!globalThis.DLZMOD_duckBuffer) globalThis.DLZMOD_duckBuffer = createBuffer('dlzmodDuckKey')
  return globalThis.DLZMOD_duckBuffer
}

// mic i into the trigger buffer, where stock's AutoDuckSource sat (after the fader and auto mix)
function DLZMOD_duckTap(i) {
  return {
    type: 'GainWithLinMixTo',
    src: workBuf,
    gain: 0,
    bypass: `!@autoDucking || !@dlzmod.duck.src.${i}`,
    dest: DLZMOD_duckBuf(),
  }
}

// the one trigger, after all mics
function DLZMOD_duckSource() {
  return [DLZMOD_duckBuf(), {
    type: 'AutoDuckSource',
    enable: `@autoDucking`,
    threshold: `DLZMOD_duckThreshold(@dlzmod.duck.threshold)`,
  }]
}

// the slider values (0..1) in dB; app-mod/dlzmod.js shows the same (DLZMOD_duckDb). Depth -30..-5 dB
// (0.6 = stock's -15), threshold -45..-5 dB (0.5 = stock's -25). A value from elsewhere (a browser)
// is held to 0..1, and one that is not a number counts as stock's
function DLZMOD_duckUnit(v, stock) {
  v = Number(v)
  return isFinite(v) ? Math.min(1, Math.max(0, v)) : stock
}

function DLZMOD_duckDepth(v) {
  return -30 + 25 * DLZMOD_duckUnit(v, 0.6)
}

function DLZMOD_duckThreshold(v) {
  return -45 + 40 * DLZMOD_duckUnit(v, 0.5)
}

// attack, release, hold (what: 0, 1, 2) in ms for speed 0 slow, 1 stock, 2 fast; stock = the value
// Mackie gives that block (mics 500, 500, 250; the others the plugin's 1000, 1000, 1000)
function DLZMOD_duckTime(speed, what, stock) {
  if (speed == 0) return [1000, 2000, 1500][what]
  if (speed == 2) return [50, 250, 250][what]
  return stock
}

// a ducked strip's AutoDuck: key = its hub prefix ('p.0', 's'), ms = stock's attack, release, hold;
// a mic is never ducked while it is a trigger itself (stock: mic 1)
function DLZMOD_duck(key, ms, mic) {
  const notSrc = mic === undefined ? '' : ` && !@dlzmod.duck.src.${mic}`
  return {
    type: 'AutoDuck',
    enable: `@autoDucking && @dlzmod.duck.on.${key}${notSrc}`,
    atten: `DLZMOD_duckDepth(@dlzmod.duck.depth)`,
    attack: `DLZMOD_duckTime(@dlzmod.duck.speed, 0, ${ms[0]})`,
    release: `DLZMOD_duckTime(@dlzmod.duck.speed, 1, ${ms[1]})`,
    hold: `DLZMOD_duckTime(@dlzmod.duck.speed, 2, ${ms[2]})`,
  }
}
