# Mixer graph (`mixergraph-dlzlite.js`)

The audio engine's routing and processing, as readable JavaScript that dspserver runs in its embedded
QuickJS. `/usr/local/share/evolve-a1/mixergraph-dlzlite.js` (XS, 1762 lines) / `mixergraph.js`
(full-size), package `dspserver` 1338. All [static] unless tagged.

## How the engine runs it

dspserver evaluates a JS prelude (embedded in the binary), then the graph file:

- **Buffers**: `createBuffer(name | [names])` makes named audio buffers. Hardware I/O is predefined:
  `ain[]`, `aout[]` (TDM32 slots), `cin[0..1]`, `cout[0..3]` (Bluetooth codec).
- **Blocks**: objects `{type: 'EqBand', ...params}`. `type` is a built-in (`Clear`, `CopyTo`,
  `CopyFrom`, `MixTo`, `MixFrom`, `MaxMeter`, `MinMeter`) or a DSP plugin from the catalogue below.
- **Graph**: a nested array. A buffer in the list makes it the current buffer; each following block
  works on it (unless it names `buf`/`src`/`dest`). `compileGraph(graph)` flattens and loads it.
- **Live parameters**: a string param is a JS expression; `@key` means the hub state value
  (`data['key']`). Every key the expression uses gets a handler, so the block parameter is recomputed
  whenever the hub broadcasts that key. A binding only applies once all its keys have a value;
  until then the block keeps its default. Expressions can call the graph file's own functions
  (e.g. `leftForPan` on the master pan key) and use its variables (e.g. the `usbOuts` array).
- `ignoreKeys([...])` (= `keyUsed`) only silences the "Ignoring key" debug print for keys the graph
  does not use; it does not block anything.
- `configureVU({...})` maps meter names (`vuInPre0`, ...) to the hub's `VU` command groups.
- No ALSA: the buffers are DMA'd to/from the FPGA/codecs (see [dspserver.md](dspserver.md)).

## DSP block catalogue

The binary embeds a JSON descriptor per plugin (name, description, params with `law`, `minmax`,
`def`). 48 plugins; **used** by the XS graph in bold:

| Kind | Blocks |
|---|---|
| Gain/mix | **Gain**, **LinearGain**, **GainWithLin**, **GainWithLinMixTo**, **GainWithLinMixToM2S**, **GainWithLinDownMixS2M**, PreampGain, **PreampHWGain** (THAT preamp chip), **MixWet**, MixToCond, **FadeInOut**, **ResetRampCount** |
| EQ/filter | **EqBand** (peak, low/high shelf, LP, HP, notch, BP), EqBandStereo, **DCFilter** |
| Dynamics | **EconomyGateCompressor**, **EconomyCompressor**, **EconomyDeesser**, EconomyGate, Compressor, Gate, Deesser |
| Time/FX | **Delay**, **FeedbackDelay**, SimpleDelay, Delay2, **AsyncReverb**, Reverb, SmallReverb, **BasicPitchShifter**, **Vocoder**, **SineGen** |
| Automation | **AutoGain**, **AutoMixerPrepare**/**AutoMixerChannel**/**AutoMixer**, **AutoDuckPrepare**/**AutoDuckSource**/**AutoDuck** |
| Media | **BankPlayer**, **BankRecorder**, **StereoPlayer**, **StereoMtkRecorder** |
| NDI | **NDIDiscovery**, **NDIInputStereo**, **NDIOutputStereo**, NDIOutputQuad |
| Debug | Measure |

There is **no limiter** block. `Compressor` goes up to ratio 20, attack 1-500 ms, with dry/wet.
There is **no analyser** block either: `MaxMeter`/`MinMeter` give a level, and the debug `Measure`
block appears only commented out in the graph. JUCE's `dsp::FFT` is linked into dspserver, but no
block exposes it (the only "analysis" in the descriptors is a `Vocoder` parameter) [static]. A
spectrum for app.js's unused RTA overlay ([node-backend.md](node-backend.md), "Look and meters")
would have to be built from stock blocks, e.g. band-pass `EqBand`s each followed by a `MaxMeter`
(#131) [guess: untested, CPU cost unknown].
Unused blocks are available to mods, but their CPU cost on the A40i is unknown.

## Hardware I/O map

| Signal | Buffers |
|---|---|
| Mic/line 1, 2 (THAT preamps) | `ain[0]`, `ain[4]` |
| Line in 3/4, 5/6 | `ain[8]/ain[12]`, `ain[16]/ain[20]` |
| USB in 1/2, 3/4 | `ain[2]/ain[6]`, `ain[3]/ain[7]` |
| Bluetooth in | `cin[1]/cin[0]` |
| Headphones 1, 2 | `aout[0]/aout[4]`, `aout[8]/aout[12]` |
| Master out | `aout[16]/aout[20]` |
| USB out 1-14 | `aout[2,6,3,7,10,14,11,15,18,22,19,23,26,30]` |
| Bluetooth out | `cout[2]/cout[3]` |

## Strips and buses

| Strip | Keys | Source | Chain |
|---|---|---|---|
| Mic 1, 2 (mono) | `i.0`, `i.1` | analog in | DC filter → preamp gain (or auto gain) → 3-band EQ + HPF → gate/comp → de-esser → pad FX (if `fx.ch` is this mic) → fader/mute → automix → ducking → fade → sends |
| Players 1, 2 (stereo) | `p.0`, `p.1` | `p.0.src`: 0 line 3/4, 1 media player; `p.1.src`: 0 line 5/6, 1 Bluetooth | trim → EQ + HPF → gate/comp → fader → fade → ducking → sends |
| Virtual 1, 2 (stereo) | `v.0`, `v.1` | `v.N.src`: 0 USB 1/2, 1 USB 3/4, 2 NDI in | same as players |
| Samples (stereo) | `s` | 48 pad players (8 banks × 6) + preview + 1 kHz censor tone | EQ + HPF → gate/comp → fader → fade → ducking → sends |
| Master | `m` | sum | 3-band EQ + HPF → compressor → balance (`m.pan`) → delay (`m.delay`) → fader `m.mix`/`m.mute` → master out |
| Headphones 1, 2 | `a.0`, `a.1` | master, or own mix (`a.N.auxMixMode`: 0 master, 1 own pre-fader mix, 2 own post-fader mix) | level `a.N.mix` |
| FX returns | `f.0` delay, `f.1` reverb | sends `*.fx.0.value` / `*.fx.1.value` | → master, USB mix-minus, NDI mix-minus |

Sends from every strip: master, reverb, delay, solo, Bluetooth out, USB out mix, NDI out mix,
headphone 1 and 2 mixes.

- **Source selection** is graph code: the functions `playerSource` and `virtualSource`, called with
  the strip number and its `p.N.src` / `v.N.src` key, pick buffers (`usbIn[]`, NDI, line, media, Bluetooth). The mix-minus expressions test the same
  `src` values (`btMixMinus` on `p.1.src == 1`, `usbMixMinus`/`ndiMixMinus` on `v.N.src`), so more
  source choices mean updating those too. Only one NDI receiver, one media player and one Bluetooth
  stream exist; two strips on the same source would get a copy.
- **From the PC only 4 channels come in** (USB 1/2 and 3/4); 14 go out. Whether the USB interface
  offers the PC more playback channels than the graph reads is open (question 8).
- **Meter taps** (`MaxMeter`, `configureVU`): per input `vuInPre`/`vuInGain` (before/after gain),
  `vuInDynIn`, `vuInGate`, `vuInComp`, `vuInDS`, `vuInDynOut`, `vuInPost` (after fader); the same
  pattern for players, virtuals and samples, plus `vuMasterDynIn/Out`. A PFL meter mode needs no DSP
  change, only the UI choosing another group.
- **The master has no tap after its fader** (both graphs): `vuMasterDynIn/Out` sit around the
  compressor, `vuMasterPre` after it (before balance and delay), and `vuMasterPost` right *in front
  of* the `Gain` with `@m.mix`/`@m.mute`. So `m.post`, the main L/R meter, is the level before the
  master fader [static; device: the meter stays put when the master fader is pulled down]. The mod's
  Both meter mode computes the level after it in the app (#134, [../mod.md](../mod.md)).
- **EQ**: 3 `EqBand`s + HPF per strip, keys `eq.b1-3.*`, `eq.hp.*`; app.js and the faderlink knob
  table know only b1-b3.

## Features in the graph

- **Pan laws**: mono mics use constant power (-3 dB in the centre); stereo strips use linear balance.
- **Solo**: overrides **headphone 1 only**; headphone 2 never hears solo.
- **Auto ducking** (`autoDucking`): mic 1 is the only trigger (threshold -25 dB). Everything else
  ducks by a fixed -15 dB (mic 2: attack/release 500 ms, hold 250 ms; others: plugin defaults).
  Nothing about it is adjustable in the UI.
- **Auto mix** (`amix`, `i.N.amix`, `i.N.amixweight`): mics only.
- **Auto gain** (`i.N.autogain`): holds the preamp at 10 dB while measuring, target offset -3.
- **Fade in/out** (`ctrl.fade.*`): all strips; `ctrl.fade.excl` keeps mic 1 out of the fade.
- **Censor**: `Bleep.sample.mute` mutes every strip and silences all pads except the bleep pad;
  `censorBleep` adds a 1 kHz sine at -20 dB on the samples bus.
- **Smart pad FX** on one mic (`fx.ch`): pitch shift, disguise (vocoder), telephone (HP 400 Hz /
  LP 7 kHz), delay, reverb. `T_ROBOT` is defined but unused: robot mode is only the pitch shifter.
- **Intercom / mix-minus**: matrix `ctrl.intercom.<dest>.<src>.enable`, dest/src `1`, `2`
  (headphone/mic pairs), `u` USB, `n` NDI, `b` Bluetooth. `X.X.enable` puts destination X in
  intercom mode: it then hears only the sources enabled for it, and mic X is taken off master and
  the FX sends [guess on the intent, the routing itself is static]. `p.1.mixminus` / `v.N.mixminus`
  keep a Bluetooth/USB/NDI caller out of their own return feed. USB and NDI mix-minus feeds get the
  master EQ and compressor too.
- **Bluetooth out** is summed to mono and raised by +10 dB.
- **Headphone sends**: `a.N.send2usb` copies the headphone mix to USB out 3/4 (both headphones
  write the same slots, so headphone 2 wins if both are on); `a.N.send2ndi` replaces the NDI out.
- **Headphone setup tone** (`ez.hp.play`): loops `/srv/bankPlayer/default/Mackie After Dark.wav`
  at -10 dB on both headphones.
- **USB out layout**: normally 1/2 = main mix (or the USB mix-minus), 3/4 = headphone send.
  With `settings.rec.toComputer`: 1 mic 1, 2 mic 2, 3/4 player 1, 5/6 player 2, 7/8 samples,
  9/10 virtual 1, 11/12 virtual 2, 13/14 main mix.
- **Recording taps** (`settings.rec.*`): `bypassProc` records the raw source, `postFader` after the
  fader; `mtk` records 12 tracks + stereo to the file recorder.
- **NDI** (`settings.ndi.mode`): 1 mono, 2 stereo, 3 per-strip outputs ("Output 1-2" ... "11-12").

## Leftovers and oddities

- Master gate is commented out: `m.gate.*` keys are stored but do nothing.
- The compressor's hold parameter is not wired (Mackie's comment there doubts it is in the GUI).
- Reverb room size/damping mapping is marked by Mackie as still to verify (a TODO comment).
- A headphone volume line is commented out, with a TODO comment questioning whether it belongs there.

## Modding it

- Hook: patch the graph file by anchor in `build-sd.sh` (like `app.js`), keep a `.orig`,
  restart `dspserver` (audio drops briefly). Overwritten by a `dspserver` package update.
- Own state keys work: the hub stores and broadcasts any key, the graph binds to it, and an unset
  key leaves the block at its default. A Mod page toggle can thus drive a new block.
- Unknowns before the first audio mod: CPU headroom of the DSP thread, and whether the full
  (non-"Economy") dynamics blocks fit. Test on the device.
- Candidates that are issues: limiter and gate on the main output (#59), headphone 2 solo and its own computer send (#60), robot voice (#61), a 4th EQ band (#25), a spectrum behind the EQ curve (#131), more sources per strip (#24), reassigning faders (#23).
