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
