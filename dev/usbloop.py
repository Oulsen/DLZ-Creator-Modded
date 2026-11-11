#!/usr/bin/env python3
"""USB audio loop test from a Windows PC with the mixer on USB (#257, #261). Standard library only
(WinMM through ctypes), so it needs nothing installed besides Mackie's USB driver. XS and full-size:
it looks for devices named "DLZ Creator ... <pair>".

  python dev/usbloop.py list                          the mixer's playback and recording devices
  python dev/usbloop.py play [seconds] [dbfs]         a 440 Hz tone into the mixer (USB 1-2)
  python dev/usbloop.py record [seconds] [pair]       levels of a return (default 1-2, e.g. 5-6)
  python dev/usbloop.py check                         both at once: does the tone come back on 1-2?

On the XS, the PC's USB 1-2 arrives on the mixer's computer channel (9/10) and the main mix goes back
on return 1-2 (notes/hardware.md). With mix-minus on for the computer channel the tone is left out of
the return by design, so turn it off for `check`. Nothing is sent to the mixer but audio.

`check` at a silent start (outputs silent, meters moving): tone back on the return -> the mix works
and the sound is lost on the analog output path; no tone back -> the USB link or the processing.
"""
import ctypes
import math
import re
import struct
import sys
import threading
import time
from ctypes import wintypes

RATE = 48000
FREQ = 440.0
NAME = "DLZ Creator"
WHDR_DONE = 1

winmm = ctypes.WinDLL("winmm") if sys.platform == "win32" else None


class WAVEOUTCAPSW(ctypes.Structure):
    _fields_ = [("wMid", wintypes.WORD), ("wPid", wintypes.WORD), ("vDriverVersion", wintypes.UINT),
                ("szPname", wintypes.WCHAR * 32), ("dwFormats", wintypes.DWORD),
                ("wChannels", wintypes.WORD), ("wReserved1", wintypes.WORD), ("dwSupport", wintypes.DWORD)]


class WAVEINCAPSW(ctypes.Structure):
    _fields_ = [("wMid", wintypes.WORD), ("wPid", wintypes.WORD), ("vDriverVersion", wintypes.UINT),
                ("szPname", wintypes.WCHAR * 32), ("dwFormats", wintypes.DWORD),
                ("wChannels", wintypes.WORD), ("wReserved1", wintypes.WORD)]


class WAVEFORMATEX(ctypes.Structure):
    _fields_ = [("wFormatTag", wintypes.WORD), ("nChannels", wintypes.WORD), ("nSamplesPerSec", wintypes.DWORD),
                ("nAvgBytesPerSec", wintypes.DWORD), ("nBlockAlign", wintypes.WORD),
                ("wBitsPerSample", wintypes.WORD), ("cbSize", wintypes.WORD)]


class WAVEHDR(ctypes.Structure):
    pass


WAVEHDR._fields_ = [("lpData", ctypes.c_char_p), ("dwBufferLength", wintypes.DWORD),
                    ("dwBytesRecorded", wintypes.DWORD), ("dwUser", ctypes.c_size_t), ("dwFlags", wintypes.DWORD),
                    ("dwLoops", wintypes.DWORD), ("lpNext", ctypes.POINTER(WAVEHDR)), ("reserved", ctypes.c_size_t)]

FMT = WAVEFORMATEX(1, 2, RATE, RATE * 4, 4, 16, 0)  # PCM, stereo, 16 bit


class Fail(Exception):
    pass


def ok(r, what):
    if r:
        raise Fail("%s: WinMM error %d (device busy, or the mixer unplugged or switched off?)" % (what, r))


def devices(kind):
    caps_t, count, getcaps = ((WAVEOUTCAPSW, winmm.waveOutGetNumDevs, winmm.waveOutGetDevCapsW) if kind == "out"
                              else (WAVEINCAPSW, winmm.waveInGetNumDevs, winmm.waveInGetDevCapsW))
    out = []
    for i in range(count()):
        caps = caps_t()
        if getcaps(i, ctypes.byref(caps), ctypes.sizeof(caps)) == 0:
            out.append((i, caps.szPname))
    return out


def find(kind, pair):
    # WinMM cuts names to 31 characters: "DLZ Creator XS 1-2 (DLZ Creator"
    pat = re.compile(r"(^|\s)%s(\s|$)" % re.escape(pair))
    hits = [(i, n) for i, n in devices(kind) if n.startswith(NAME) and pat.search(n)]
    if len(hits) != 1:
        raise Fail("need exactly one %s device '%s ... %s', found %r (Mackie's driver installed, cable in?)"
                   % ("playback" if kind == "out" else "recording", NAME, pair, [n for _, n in hits]))
    return hits[0]


def db(x):
    return 20 * math.log10(x) if x > 1e-9 else -120.0


def tone_rms(xs):
    """RMS of the FREQ component (Goertzel)."""
    c = 2 * math.cos(2 * math.pi * FREQ / RATE)
    s1 = s2 = 0.0
    for x in xs:
        s1, s2 = x + c * s1 - s2, s1
    p = s1 * s1 + s2 * s2 - c * s1 * s2
    return math.sqrt(max(p, 0.0)) * math.sqrt(2) / len(xs)


def tone(secs, dbfs):
    amp, n, fade = 32767 * 10 ** (dbfs / 20), int(RATE * secs), int(RATE * 0.05)
    frames = bytearray()
    for k in range(n):
        s = int(amp * min(1.0, k / fade, (n - k) / fade) * math.sin(2 * math.pi * FREQ * k / RATE))
        frames += struct.pack("<hh", s, s)
    return bytes(frames)


def wait_done(hdr, secs, reset, h):
    deadline = time.monotonic() + secs + 5
    while not hdr.dwFlags & WHDR_DONE:
        if time.monotonic() > deadline:
            reset(h)
            raise Fail("no end of the stream after %.0f s (the mixer gone?)" % (secs + 5))
        time.sleep(0.05)


class Player:
    def __init__(self, pair="1-2"):
        self.dev, self.name = find("out", pair)
        self.h = wintypes.HANDLE()
        ok(winmm.waveOutOpen(ctypes.byref(self.h), self.dev, ctypes.byref(FMT), 0, 0, 0), "open " + self.name)

    def play(self, frames):
        buf = ctypes.create_string_buffer(frames, len(frames))
        hdr = WAVEHDR(ctypes.cast(buf, ctypes.c_char_p), len(frames), 0, 0, 0, 0, None, 0)
        try:
            ok(winmm.waveOutPrepareHeader(self.h, ctypes.byref(hdr), ctypes.sizeof(hdr)), "prepare")
            ok(winmm.waveOutWrite(self.h, ctypes.byref(hdr), ctypes.sizeof(hdr)), "play")
            wait_done(hdr, len(frames) / 4 / RATE, winmm.waveOutReset, self.h)
        finally:
            winmm.waveOutUnprepareHeader(self.h, ctypes.byref(hdr), ctypes.sizeof(hdr))
            winmm.waveOutClose(self.h)


class Recorder:
    def __init__(self, pair="1-2"):
        self.dev, self.name = find("in", pair)
        self.h = wintypes.HANDLE()
        ok(winmm.waveInOpen(ctypes.byref(self.h), self.dev, ctypes.byref(FMT), 0, 0, 0), "open " + self.name)

    def record(self, secs):
        """Half-second rows of (t, rms dBFS, tone dBFS), the louder channel of each."""
        nbytes = int(RATE * secs) * 4
        buf = ctypes.create_string_buffer(nbytes)
        hdr = WAVEHDR(ctypes.cast(buf, ctypes.c_char_p), nbytes, 0, 0, 0, 0, None, 0)
        try:
            ok(winmm.waveInPrepareHeader(self.h, ctypes.byref(hdr), ctypes.sizeof(hdr)), "prepare")
            ok(winmm.waveInAddBuffer(self.h, ctypes.byref(hdr), ctypes.sizeof(hdr)), "add buffer")
            ok(winmm.waveInStart(self.h), "record")
            wait_done(hdr, secs, winmm.waveInReset, self.h)
            winmm.waveInStop(self.h)
        finally:
            winmm.waveInUnprepareHeader(self.h, ctypes.byref(hdr), ctypes.sizeof(hdr))
            winmm.waveInClose(self.h)
        n = hdr.dwBytesRecorded // 4
        smp = struct.unpack("<%dh" % (2 * n), buf.raw[:4 * n])
        rows, step = [], RATE // 2
        for k in range(0, n - step + 1, step):
            rms = tn = 0.0
            for ch in (0, 1):
                xs = [smp[2 * j + ch] / 32768 for j in range(k, k + step)]
                rms = max(rms, math.sqrt(sum(x * x for x in xs) / step))
                tn = max(tn, tone_rms(xs))
            rows.append((k / RATE, db(rms), db(tn)))
        return rows[1:]  # the first half second is the device starting up


def number(s, lo, hi, what):
    try:
        v = float(s)
    except ValueError:
        raise Fail("%s: %r is not a number" % (what, s))
    if not lo <= v <= hi:
        raise Fail("%s: %g is outside %g..%g" % (what, v, lo, hi))
    return v


def check():
    # record 12 s, the tone from ~3 s to ~9 s; judged on its middle (4.5-7.5 s) against the quiet ends
    # (before 2 s, from 10 s), so a late start or the tail cannot tip the verdict
    frames = tone(6, -20)
    rec, player = Recorder(), Player()
    rows, err = [], []

    def run():
        try:
            rows.extend(rec.record(12))
        except Fail as e:
            err.append(e)

    t = threading.Thread(target=run)
    t.start()
    time.sleep(3)
    try:
        player.play(frames)
    finally:
        t.join()
    if err:
        raise err[0]
    during = [tn for s, _, tn in rows if 4.5 <= s < 7.5]
    outside = [tn for s, _, tn in rows if s < 2.0 or s >= 10.0]
    if not during or not outside:
        raise Fail("the recording is too short")
    level = max(rms for _, rms, _ in rows)
    back = min(during) > -60 and min(during) > max(outside) + 20
    print("tone on the return: %s (during %.1f dBFS, outside %.1f dBFS); loudest return level %.1f dBFS"
          % ("yes" if back else "NO", min(during), max(outside), level))
    print("-> the mix works; silent outputs would be the analog output path" if back else
          "-> not back: mix-minus on the computer channel? otherwise the USB link or the processing")
    return 0 if back else 1


def main():
    if winmm is None:
        raise Fail("Windows only (WinMM)")
    cmd, args = (sys.argv[1] if len(sys.argv) > 1 else ""), sys.argv[2:]
    if cmd == "list" and not args:
        for kind in ("out", "in"):
            for i, n in devices(kind):
                print("%-3s %d %s" % (kind, i, n))
    elif cmd == "play" and len(args) <= 2:
        secs = number(args[0], 0.5, 600, "seconds") if args else 10
        dbfs = number(args[1], -60, -3, "dBFS") if len(args) > 1 else -20
        Player().play(tone(secs, dbfs))
    elif cmd == "record" and len(args) <= 2:
        secs = number(args[0], 1.5, 600, "seconds") if args else 10
        rec = Recorder(args[1] if len(args) > 1 else "1-2")
        print("recording %.0f s from %s" % (secs, rec.name))
        for s, rms, tn in rec.record(secs):
            print("%5.1f s  level %6.1f dBFS  %d Hz %6.1f dBFS" % (s, rms, FREQ, tn))
    elif cmd == "check" and not args:
        return check()
    else:
        print(__doc__, file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Fail as e:
        sys.exit("usbloop: %s" % e)
