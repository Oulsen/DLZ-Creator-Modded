// DLZ Creator Modded additions to Mackie's mixergraph-dlzlite.js (the audio graph dspserver runs in
// its QuickJS), appended by install/patch.py. Only function declarations: they are hoisted, so the
// patched lines above can call them. The file calls compileGraph(graph) itself, above this part, so
// what goes into the graph is patched in before that call (DLZMOD_rtaAnalyser too), never pushed
// here. The full-size's mixergraph.js is not patched: there the EQ page simply shows no spectrum.

// #131 the sound behind the EQ curve. The channel whose EQ page the mixer's screen shows (hub key
// dlzmod.rta, the codes in DLZMOD_rtaTap's callers; 0 = no EQ page open) is mixed into one mono
// buffer of the mod's own, right after its EQ (where Mackie's "dynin" meter sits); at the end of
// the graph one band-pass and one meter per octave report it as the VU group "dlzmod.rta". The taps
// only read the channel's buffer and write the mod's own, each in a nested list (flattenGraph keeps
// the current buffer of the list around it), so Mackie's audio path stays as it is. With no EQ page
// open the taps and the band-passes are bypassed.

// the bands' centres in Hz; app-mod/dlzmod.js has the same list (DLZMOD_rtaFreqs)
function DLZMOD_rtaFreqs() {
  return [31.5, 63, 125, 250, 500, 1000, 2000, 4000, 8000, 16000]
}

// the mono buffer the open EQ page's channel is mixed into, made on first use (the first use is the
// Clear at the start of each cycle, before any tap)
function DLZMOD_rtaBuf() {
  if (!globalThis.DLZMOD_rtaBuffer) globalThis.DLZMOD_rtaBuffer = createBuffer('dlzmodRta')
  return globalThis.DLZMOD_rtaBuffer
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

// one band-pass (an octave wide) and a meter per band, each on a copy of the tapped buffer
function DLZMOD_rtaAnalyser() {
  let band = createBuffer('dlzmodRtaBand')
  let meters = DLZMOD_rtaMeters()
  return [band, ...DLZMOD_rtaFreqs().map((f, k) => [
    {type: 'CopyFrom', src: DLZMOD_rtaBuf()},
    {type: 'EqBand', bypass: `!@dlzmod.rta`, kind: T_BP, freq: f, q: 1.414, gain: 0.0},
    {type: 'MaxMeter', vu: meters[k], threshold: VU_THRESHOLD},
  ])]
}
