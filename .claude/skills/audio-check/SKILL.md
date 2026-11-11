---
name: audio-check
description: Test the mixer's sound from this PC over USB - play a 440 Hz tone into the mixer (USB 1-2) and check that it comes back on the main-mix return, or read the levels of a return - with dev/usbloop.py. Use when the user asks to test or check the audio/sound, "is there sound", "test the audio, it's connected to this laptop", after a drop-in or a start to see whether the mixer passes audio, or at a silent start (#257) to tell the USB/processing side from the analog outputs.
---

# audio-check

`dev/usbloop.py` (Windows Python, standard library only, WinMM) talks to the mixer's USB audio
devices ("DLZ Creator ... <pair>", XS and full-size). It sends only audio to the mixer: no SSH, no
writes, nothing on the card.

## Run

From the repo root in Git Bash, with **Windows** Python: `py -3` (Git Bash's `python3` is the
Windows Store stub, and WSL has no access to the PC's audio devices).

```bash
py -3 -I dev/usbloop.py list              # the mixer's playback and recording devices
py -3 -I dev/usbloop.py check             # ~14 s: a 6 s tone at -20 dBFS into USB 1-2, recorded from return 1-2
py -3 -I dev/usbloop.py record 10 1-2     # levels of a return only, no tone (other pairs: 3-4, 5-6, ...)
py -3 -I dev/usbloop.py play 5 -30        # only the tone (seconds, dBFS -60..-3)
```

1. `list` first. No "DLZ Creator" lines: the mixer is not on this PC's USB, still starting, or
   Mackie's USB driver is missing; say so and stop.
2. Before `check` or `play`: **the tone is audible** on the mixer's speakers/headphones (the
   computer channel is in the main mix). Tell the user in one line before playing it; a quiet test
   is `record` with something already playing on the mixer.
3. `check` exits 0 when the tone came back, 1 when it did not.

## Reading the result

- `tone on the return: yes` (the tone well above the quiet before and after): USB in, the mix and
  USB out work. This says nothing about the **analog outputs** (speakers, headphones, main out):
  ask the user whether they hear it. Tone back but silent outputs = the analog output path (the
  #257 pattern: meters moving, no sound).
- `NO`: first **mix-minus on the computer channel** (it leaves the computer's own audio out of the
  return by design): ask the user to turn it off and run `check` again. Still no: the USB link or
  the processing (dspserver); look at the start with the network log or the `mixer-ssh` skill.
- `record` rows near -140 dBFS are digital silence; a return that stays there while something plays
  on the mixer means nothing reaches that return.
- On the XS, the PC's USB 1-2 arrives on the computer channel (9/10) and the main mix goes back on
  return 1-2 (`notes/hardware.md`). The full-size's routing is not verified with this tool yet:
  when it is first used there, write the result into `notes/hardware.md` with [device].

## Report

One or two lines: what was played and recorded, the levels from the output, and what it means
(USB/mix fine, analog path untested unless the user heard it).
