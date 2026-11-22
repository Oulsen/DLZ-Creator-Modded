---
name: audio-check
description: Test the mixer's sound from this PC over USB - play a 440 Hz tone into the mixer (USB 1-2) and check that it comes back on the main-mix return, or read the levels of a return - with dev/usbloop.py. Use when the user asks to test or check the audio/sound, "is there sound", "test the audio, it's connected to this laptop", or at a silent start (#257) to tell the USB/processing side from the analog outputs.
---

# audio-check

`dev/usbloop.py` (Windows Python, standard library only, WinMM) talks to the mixer's USB audio
devices ("DLZ Creator ... <pair>", XS and full-size). It sends only audio to the mixer: no SSH, no
writes, nothing on the card.

## Run

From the repo root in Git Bash, with **Windows** Python: `py -3` (Git Bash's `python3` is the
Windows Store stub, and WSL has no access to the PC's audio devices). No `py`: Windows Python is not
installed; ask the user, do not try WSL.

```bash
py -3 -I dev/usbloop.py list              # every playback/recording device; the mixer's start with "DLZ Creator"
py -3 -I dev/usbloop.py check             # ~14 s: a 6 s tone at -20 dBFS into USB 1-2, recorded from return 1-2
py -3 -I dev/usbloop.py record 10 1-2     # levels of a return only, no tone (other pairs: 3-4, 5-6, ...)
py -3 -I dev/usbloop.py play 5 -30        # only the tone (seconds, dBFS -60..-3)
```

1. `list` first. No "DLZ Creator" lines: the mixer is not on this PC's USB, still starting, or
   Mackie's USB driver is missing; say so and stop.
2. **The tone is audible** on the mixer's speakers/headphones (the computer channel is in the main
   mix). Unless the user asked for the check in this turn, ask before `check` or `play`; otherwise
   say in one line that a tone will sound. A quiet test is `record` with something already playing
   on the mixer.
3. `check` exits 0 when the tone came back. Exit 1 is either `tone on the return: NO` or an error
   line starting with `usbloop:`: read the output, not the exit code. Exit 2: wrong arguments.
4. Errors: `usbloop: ... WinMM error`: the device is busy (a DAW or another app holds it) or the
   mixer went away; ask the user to close the app or check the cable and power. `need exactly one
   ... found [...]`: none = not connected or no driver; two or more = two mixers on this PC.

## Reading the result

- `tone on the return: yes` (at least 20 dB above the quiet before and after, and above -60 dBFS):
  USB in, the mix and USB out work. This says nothing about the **analog outputs** (speakers,
  headphones, main out): ask the user whether they hear it. Tone back but silent outputs = the
  analog output path (the #257 pattern: meters moving, no sound).
- `NO`: first the computer channel on the mixer: mix-minus off (it leaves the computer's own audio
  out of the return by design), not muted, fader up, and the main mix up; then `check` again.
  Still no: the USB link or the processing (dspserver); look at the start with the network log or
  the `mixer-ssh` skill.
- `record` rows with level -120 dBFS are digital silence (all zeros); a return that stays there
  while something plays on the mixer means nothing reaches that return.
- On the XS, the PC's USB 1-2 arrives on the computer channel (9/10) and the main mix goes back on
  return 1-2 (`notes/hardware.md`). The full-size's routing is not verified with this tool yet:
  when it is first used there, write the result into `notes/hardware.md` with [device].

## USB gone or `need exactly one ... found []` after a restart on the mixer

Every dspserver stop (also through a faderlink restart) resets the USB chip through PI14, and it
sometimes comes back as `0A4A:AC1E`, Ploytec's fallback, which Windows cannot start (#88,
`notes/hardware.md`, "PI14 resets the USB chip"). Watch it with
`powershell -NoProfile -ExecutionPolicy Bypass -File dev/usbwatch.ps1` (as a Monitor; its lines read
`0A73:003A OK`, `0A4A:AC1E OK, ...` or `none`). A replug of the cable brings `0A73:003A` back; one
more dspserver restart (a write, with the user's yes) may too, but each restart picks the identity
anew (it can come back as `AC1E` again) and is itself a chip setup: replug first, at most one restart.

## At a silent start (#257)

Outputs silent, meters moving. Do not let the user switch off or reboot first. In this order:

1. `check` here: the tone back on the return = only the analog outputs are dead (the #257 pattern).
   No tone: first `list` (no "DLZ Creator" lines = USB came up as `AC1E`, above) and the computer
   channel's mix-minus (on = no tone on the return by design); fix those and `check` again. Still no
   tone: not the #257 pattern; read the start (`mixer-ssh`) before anything else.
2. One read-only login (`mixer-ssh`): CPU temperature, the codec setup, PH2 low after it (the pin log).
3. On the dev card only, with the user's yes for each command: `systemctl stop dspserver`, wait
   ~6 s, `systemctl start dspserver` (no other service, no FPGA). It resets the USB chip (PI14,
   #88): the user replugs USB and `list` shows the pairs again before the sound is judged, or the
   user listens to Bluetooth, which does not go over USB. Then ask whether the sound is back. A
   restart of every service with dspserver down ~6 s, then a replug, brought it back on 2026-11-20
   (`notes/components/dspserver.md`, "A sixth silent start"), and this step alone (down ~15 s) on
   2026-11-22 ("A seventh silent start").
4. Still silent: the FPGA reload (`mixer-ssh`, "The #257 FPGA reload", with its read-only checks),
   with the user's yes, judged the same way; it brought the sound back on 2026-11-19 ("A fifth
   silent start"). On another mixer: no restart or reload, ask the maintainer. More silent starts
   are needed before the mod does anything by itself; write each result into that note.
5. Still silent: `reboot` (known to help), with the user's yes.

## Report

One or two lines: what was played and recorded, the levels from the output, and what it means
(USB/mix fine, analog path untested unless the user heard it).
