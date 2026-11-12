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

// #24 any source on any stereo strip (the Setup page's source list, app-mod/dlzmod.js DLZMOD_src*).
// Stock, each strip has 2 or 3 sources of its own (playerInSource, virtualInSource, by its src key),
// and the mix-minus and intercom rules test those src values strip by strip. Both models have the same
// 7 stereo sources, so the mod gives every strip all of them: the key <strip>.dlzmodSrc holds a pool
// id (DLZMOD_srcPool) and -1, its default, means "as Mackie's src key says". The screen sets src for a
// choice stock has on that strip and dlzmodSrc only for one it has not, so a version without #24 (an
// undo) or a snapshot from before it still finds a valid stock src. Mackie's rules are rewritten on
// the kind of the source, not the strip: what stock does for its Bluetooth strip is done for any
// strip on Bluetooth, the same for USB and NDI. tests/graph-check.js checks that every rewritten
// expression gives stock's value for every stock choice, and the same as the stock strip with that
// source for every other.

// the 7 sources, [left, right] each; app-mod/dlzmod.js lists them in the same order (DLZMOD_srcIds):
// the first line input (XS 3/4, full-size 5/6), the second (5/6, 7/8), USB 1/2, USB 3/4, the media
// player, Bluetooth, NDI. Two strips on one source both get it. Made once: the buffers are fixed
function DLZMOD_srcPool() {
  if (!globalThis.DLZMOD_srcPoolList) {
    globalThis.DLZMOD_srcPoolList = [lineIn[0], lineIn[1], usbIn[0], usbIn[1], [mediaPlayer, mediaPlayerR], btIn, [ndiL, ndiR]]
  }
  return globalThis.DLZMOD_srcPoolList
}

// The media player and the NDI receiver fill their buffers during the cycle (cleared at its start),
// the line, USB and Bluetooth inputs are there from its start. A strip that reads its input before
// that block has run (the pads on both models, the XS's players for NDI) would get silence: it reads
// a copy of the cycle before instead, made at the end of each cycle (DLZMOD_srcHold), a few ms later.
// Which reader needs it is decided while the graph is built, by the blocks pushed so far
function DLZMOD_srcHeldBufs() {
  if (!globalThis.DLZMOD_srcHeldBuffers) {
    globalThis.DLZMOD_srcHeldBuffers = createBuffer(['dlzmodHeldMediaL', 'dlzmodHeldMediaR', 'dlzmodHeldNdiL', 'dlzmodHeldNdiR'])
  }
  return globalThis.DLZMOD_srcHeldBuffers
}

// the copies, at the end of the graph (after every block of Mackie's)
function DLZMOD_srcHold() {
  let h = DLZMOD_srcHeldBufs()
  return [[mediaPlayer, mediaPlayerR, ndiL, ndiR].map((b, n) => [h[n], {type: 'CopyFrom', src: b}])]
}

// while the graph is built: what a reader pushed now must take from the copies (1: the media player,
// 2: NDI), as their blocks are not in the graph yet
function DLZMOD_srcHeldNow() {
  let has = (g, type) => g.some(x => Array.isArray(x) ? has(x, type) : !!x && x.type === type)
  return (has(graph, 'StereoPlayer') ? 0 : 1) | (has(graph, 'NDIInputStereo') ? 0 : 2)
}

// a source's kind: '' a local one (line inputs, the media player), 'b' Bluetooth, 'u' USB, 'n' NDI,
// as the letters of Mackie's intercom keys (ctrl.intercom.<dest>.<src>.enable)
function DLZMOD_srcKind(id) {
  return ['', '', 'u', 'u', '', 'b', 'n'][id] || ''
}

// the stereo strips this model has: [virt, i], players then virtual channels (the XS's)
function DLZMOD_srcStrips() {
  let s = []
  for (let i = 0; i < NPL; i++) s.push([0, i])
  if (typeof NVIRT !== 'undefined') for (let i = 0; i < NVIRT; i++) s.push([1, i])
  return s
}

// at run time: the strip's pool id, from the mod's key when it holds one, else from Mackie's src
// through the strip's own stock table (an unknown src counts as its first source, as 0)
function DLZMOD_src(virt, i, src, mod) {
  let pool = DLZMOD_srcPool()
  mod = Number(mod)
  if (mod >= 0 && mod < pool.length) return Math.floor(mod)
  let row = (virt ? virtualInSource : playerInSource)[i] || []
  let entry = row[src] || row[0]
  let k = entry ? pool.findIndex(p => p[0] === entry[0]) : -1
  return k < 0 ? 0 : k
}

// the expression for a strip's pool id (its two keys)
function DLZMOD_srcExpr(virt, i) {
  let p = (virt ? 'v.' : 'p.') + i
  return `DLZMOD_src(${virt}, ${i}, @${p}.src, @${p}.dlzmodSrc)`
}

// the strip's input buffer (ch 'L' or 'R'): silence on Bluetooth while nothing is connected, as stock
// for its Bluetooth strip
function DLZMOD_srcBufExpr(virt, i, ch) {
  return `DLZMOD_srcBuf(${DLZMOD_srcExpr(virt, i)}, ${ch === 'L' ? 0 : 1}, @btStatus, ${DLZMOD_srcHeldNow()})`
}

// held: DLZMOD_srcHeldNow() where the reader sits
function DLZMOD_srcBuf(id, side, bt, held) {
  if (DLZMOD_srcKind(id) === 'b' && bt == 0) return zero
  let b = DLZMOD_srcPool()[id], h = DLZMOD_srcHeldBufs()
  if (b[0] === mediaPlayer && (held & 1)) return h[side]
  if (b[0] === ndiL && (held & 2)) return h[2 + side]
  return b[side]
}

// Mackie's global mix-minus flags (btMixMinus, usbMixMinus, ndiMixMinus): some strip on a source of
// that kind with its mix-minus on. In parentheses, as the graph puts them inside other expressions
function DLZMOD_mixMinusExpr(kind) {
  return '(' + DLZMOD_srcStrips().map(([v, i]) =>
    `DLZMOD_srcIs('${kind}', ${DLZMOD_srcExpr(v, i)}, @${v ? 'v' : 'p'}.${i}.mixminus)`)
    .concat(`DLZMOD_srcIs('${kind}', ${DLZMOD_padSrcExpr()}, @s.mixminus)`).join(' || ') + ')'
}

// the NDI receiver runs while some strip is on NDI, the pads' source included
function DLZMOD_srcAnyExpr(kind) {
  return '(' + DLZMOD_srcStrips().map(([v, i]) => `DLZMOD_srcIs('${kind}', ${DLZMOD_srcExpr(v, i)}, 1)`)
    .concat(`DLZMOD_srcIs('${kind}', ${DLZMOD_padSrcExpr()}, 1)`).join(' || ') + ')'
}

function DLZMOD_srcIs(kind, id, on) {
  return DLZMOD_srcKind(id) === kind && !!on
}

// a strip's send muted: what = 'b', 'u', 'n' (the Bluetooth, USB, NDI out), 'm' the main mix, 'fx'
// the reverb and delay sends, 'aux' headphone auxIdx's mix
function DLZMOD_muteExpr(what, virt, i, auxIdx) {
  let p = `@${virt ? 'v' : 'p'}.${i}.`, s = DLZMOD_srcExpr(virt, i)
  let ic = (d, x) => `@ctrl.intercom.${d}.${x}.enable`
  let mm = `${p}mixminus`, own = `${ic('b', 'b')}, ${ic('u', 'u')}, ${ic('n', 'n')}`
  if (what === 'm') return `DLZMOD_muteMain(${s}, ${own})`
  if (what === 'fx') return `DLZMOD_muteFx(${s}, ${mm}, ${own})`
  if (what === 'aux') {
    let d = auxIdx + 1, full = typeof NVIRT === 'undefined' ? 1 : 0
    return `DLZMOD_muteAux(${s}, ${full}, ${ic(d, d)}, ${ic(d, 'b')}, ${ic(d, 'u')}, ${ic(d, 'n')}, `
      + `@a.${auxIdx}.auxMixMode, ${p}aux.${auxIdx}.mute)`
  }
  return `DLZMOD_muteOut('${what}', ${s}, ${mm}, ${ic(what, what)}, ${ic(what, 'b')}, ${ic(what, 'u')}, ${ic(what, 'n')})`
}

// the Bluetooth, USB or NDI out (x): normally only a strip on that same out's source with its
// mix-minus on is kept out (the caller does not hear themselves); in intercom mode for that out
// (xx) it hears its own source unless mix-minus is on, the other remote sources it is given (xb, xu,
// xn), and nothing local
function DLZMOD_muteOut(x, id, mm, xx, xb, xu, xn) {
  let k = DLZMOD_srcKind(id)
  if (!xx) return k === x && !!mm
  if (k === x) return !!mm
  return k ? !{b: xb, u: xu, n: xn}[k] : true
}

// the main mix: a remote source is off it while its own out is in intercom mode
function DLZMOD_muteMain(id, bb, uu, nn) {
  let k = DLZMOD_srcKind(id)
  return !!k && !!{b: bb, u: uu, n: nn}[k]
}

// the reverb and delay sends: a remote source, while its out is in intercom mode or its mix-minus is on
function DLZMOD_muteFx(id, mm, bb, uu, nn) {
  let k = DLZMOD_srcKind(id)
  return !!k && (!!{b: bb, u: uu, n: nn}[k] || !!mm)
}

// a headphone's own mix: in intercom mode (dd) it hears the remote sources it is given (db, du, dn).
// Local ones: the XS mutes them there, the full-size does not, and the full-size's NDI strip neither
// (each model's stock rule, kept); otherwise stock's own mute of the strip in that mix
function DLZMOD_muteAux(id, full, dd, db, du, dn, mode, auxMute) {
  if (!dd) return mode != 0 && !!auxMute
  let k = DLZMOD_srcKind(id)
  if (full && (k === '' || k === 'n')) return false
  return k ? !{b: db, u: du, n: dn}[k] : true
}

// #24 the pads channel (samples, 's'): its pads, and one of the 7 sources mixed in when s.dlzmodSrc
// holds a pool id (-1, its default: the pads only); with s.dlzmodPads off (Keep Pads, on by default)
// the source alone, the pads silenced, but never while the censor bleep runs (Bleep.sample.mute, the
// 1 kHz censorBleep: both play on the pads' buffer), so a bleep is heard there. Right after the pads are copied in,
// before the channel's EQ, so the source shares the pads' processing, fader, sends and ducking. Through
// a DC filter of its own (as every stereo strip's input), on the mod's own buffers, and muted while
// the censor bleep runs (Bleep.sample.mute, which silences the other pads and mutes every other
// strip), at the channel's own trim (s.trim, a key the mod adds: stock's pads channel has none). Its
// sends follow the source's kind (DLZMOD_padMuteExpr), with a mix-minus of its own (s.mixminus);
// the NDI receiver runs for it too (DLZMOD_srcAnyExpr)
function DLZMOD_padSrcBufs() {
  if (!globalThis.DLZMOD_padSrcBuffers) globalThis.DLZMOD_padSrcBuffers = createBuffer(['dlzmodPadSrcL', 'dlzmodPadSrcR'])
  return globalThis.DLZMOD_padSrcBuffers
}

// at run time: the pads' source buffer, silence while it holds none
function DLZMOD_padSrcIn(mod, side, bt, held) {
  let id = DLZMOD_padSrcId(mod)
  return id < 0 ? zero : DLZMOD_srcBuf(id, side, bt, held)
}

// the pads' pool id: their source, -1 for none (the kind of none is a local one: stock's rules)
function DLZMOD_padSrcId(mod) {
  mod = Number(mod)
  return mod >= 0 && mod < DLZMOD_srcPool().length ? Math.floor(mod) : -1
}

function DLZMOD_padSrcExpr() {
  return `DLZMOD_padSrcId(@s.dlzmodSrc)`
}

// a send of the pads channel muted, as a stereo strip's by the kind of its source (DLZMOD_muteExpr),
// mix-minus on s.mixminus; with no source or a local one each rule gives stock's pads channel (its
// outs off in their own intercom mode, the headphones' intercom off). Mix-minus keeps the whole
// channel, pads too, out of the caller's return
function DLZMOD_padMuteExpr(what, auxIdx) {
  let s = DLZMOD_padSrcExpr(), ic = (d, x) => `@ctrl.intercom.${d}.${x}.enable`
  let own = `${ic('b', 'b')}, ${ic('u', 'u')}, ${ic('n', 'n')}`
  if (what === 'm') return `DLZMOD_muteMain(${s}, ${own})`
  if (what === 'fx') return `DLZMOD_muteFx(${s}, @s.mixminus, ${own})`
  if (what === 'aux') {
    let d = auxIdx + 1, full = typeof NVIRT === 'undefined' ? 1 : 0
    return `DLZMOD_muteAuxPads(${s}, ${full}, ${ic(d, d)}, ${ic(d, 'b')}, ${ic(d, 'u')}, ${ic(d, 'n')}, `
      + `@a.${auxIdx}.auxMixMode, @s.aux.${auxIdx}.mute)`
  }
  return `DLZMOD_muteOut('${what}', ${s}, @s.mixminus, ${ic(what, what)}, ${ic(what, 'b')}, ${ic(what, 'u')}, ${ic(what, 'n')})`
}

// a headphone's intercom mix and the pads channel: the pads and a local source off (stock's pads
// rule on both models), a remote source as a stereo strip on it (DLZMOD_muteAux)
function DLZMOD_muteAuxPads(id, full, dd, db, du, dn, mode, auxMute) {
  if (!dd) return mode != 0 && !!auxMute
  if (DLZMOD_srcKind(id) === '') return true
  return DLZMOD_muteAux(id, full, dd, db, du, dn, mode, auxMute)
}

// the pads channel as it is right after its source is mixed in (and the pads silenced by Keep Pads),
// before any processing: what its track records with "record unprocessed" (settings.rec.bypassProc),
// where stock's reads the pads' own buffers (sampleL/R) and so would miss the source; the stereo
// strips' own copy (origSrc) is after their input and trim too
function DLZMOD_padRawBufs() {
  if (!globalThis.DLZMOD_padRawBuffers) globalThis.DLZMOD_padRawBuffers = createBuffer(['dlzmodPadRawL', 'dlzmodPadRawR'])
  return globalThis.DLZMOD_padRawBuffers
}

// at run time: the pads silenced (a source set, Keep Pads off, no bleep)
function DLZMOD_padsOff(mod, keep, bleep, tone) {
  return DLZMOD_padSrcId(mod) >= 0 && !keep && !bleep && !tone
}

// the pads' source level after its trim, as the VU group smp.gain: app.js shows a channel's "gain"
// group on the Setup page's trim meter, and stock's pads have none
function DLZMOD_padSrcMeters() {
  return ['vuSmpGainL', 'vuSmpGainR']
}

// the pads' source on one side (ch 'L' or 'R'), mixed into the channel's buffer; a list of its own
function DLZMOD_padSrc(ch) {
  let side = ch === 'L' ? 0 : 1, buf = DLZMOD_padSrcBufs()[side]
  // the list starts on the channel's buffer (its parent's current one): the gate works on that
  return [
    {
      type: 'Gain',
      gain: 0,
      mute: `DLZMOD_padsOff(@s.dlzmodSrc, @s.dlzmodPads, @Bleep.sample.mute, @censorBleep)`,
    },
    buf,
    {type: 'DCFilter', src: `DLZMOD_padSrcIn(@s.dlzmodSrc, ${side}, @btStatus, ${DLZMOD_srcHeldNow()})`},
    {type: 'Gain', gain: `@s.trim`},
    {type: 'MaxMeter', vu: DLZMOD_padSrcMeters()[side], threshold: VU_THRESHOLD},
    {
      type: 'GainWithLinMixTo',
      src: buf,
      gain: 0,
      bypass: `DLZMOD_padSrcId(@s.dlzmodSrc) < 0`,
      mute: `@Bleep.sample.mute`,
      dest: side ? workBufR : workBuf,
    },
    DLZMOD_padRawBufs()[side],
    {type: 'CopyFrom', src: side ? workBufR : workBuf},
  ]
}
