#!/usr/bin/env python3
"""USB audio loop test from a Windows PC with the mixer on USB (#257, #261). Standard library only
(WinMM through ctypes), so it needs nothing installed besides Mackie's USB driver.

  python dev/usbloop.py list                         the mixer's playback and recording devices
  python dev/usbloop.py play [seconds] [dbfs]        a 440 Hz tone into the mixer (USB 1-2)
  python dev/usbloop.py record [seconds]             levels of what the mixer sends back (USB return 1-2)
  python dev/usbloop.py check                        both at once: does the tone come back?

The PC's USB 1-2 arrives on the mixer's computer channel (9/10 on the XS); the mixer's main mix goes
back on return 1-2. With mix-minus on for the computer channel the tone is left out of the return
by design, so turn it off for `check`. Nothing is sent to the mixer but audio.

`check` at a silent start (outputs silent, meters moving): tone back on the return → the mix works
and the sound is lost on the analog output path; no tone back → the USB link or the processing.
"""
import ctypes
import math
import struct
import sys
import threading
import time
from ctypes import wintypes

RATE = 48000
FREQ = 440.0
DEV_OUT = "XS 1-2"   # WinMM cuts names to 31 characters: "DLZ Creator XS 1-2 (DLZ Creator"
DEV_IN = "XS 1-2"
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


def devices(kind):
    caps_t, count, getcaps = ((WAVEOUTCAPSW, winmm.waveOutGetNumDevs, winmm.waveOutGetDevCapsW) if kind == "out"
                              else (WAVEINCAPSW, winmm.waveInGetNumDevs, winmm.waveInGetDevCapsW))
    out = []
    for i in range(count()):
        caps = caps_t()
        if getcaps(i, ctypes.byref(caps), ctypes.sizeof(caps)) == 0:
            out.append((i, caps.szPname))
    return out


def find(kind, want):
    hits = [(i, n) for i, n in devices(kind) if want + " " in n + " "]
    if len(hits) != 1:
        sys.exit("usbloop: need exactly one %s device with %r, found %r (Mackie's driver installed, cable in?)"
                 % (kind, want, [n for _, n in hits]))
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


def play(secs, dbfs):
    dev, name = find("out", DEV_OUT)
    amp, n, fade = 32767 * 10 ** (dbfs / 20), int(RATE * secs), int(RATE * 0.05)
    frames = bytearray()
    for k in range(n):
        s = int(amp * min(1.0, k / fade, (n - k) / fade) * math.sin(2 * math.pi * FREQ * k / RATE))
        frames += struct.pack("<hh", s, s)
    h = wintypes.HANDLE()
    r = winmm.waveOutOpen(ctypes.byref(h), dev, ctypes.byref(FMT), 0, 0, 0)
    if r:
        sys.exit("usbloop: waveOutOpen %s: error %d" % (name, r))
    buf = ctypes.create_string_buffer(bytes(frames), len(frames))
    hdr = WAVEHDR(ctypes.cast(buf, ctypes.c_char_p), len(frames), 0, 0, 0, 0, None, 0)
    winmm.waveOutPrepareHeader(h, ctypes.byref(hdr), ctypes.sizeof(hdr))
    winmm.waveOutWrite(h, ctypes.byref(hdr), ctypes.sizeof(hdr))
    while not hdr.dwFlags & WHDR_DONE:
        time.sleep(0.05)
    winmm.waveOutUnprepareHeader(h, ctypes.byref(hdr), ctypes.sizeof(hdr))
    winmm.waveOutClose(h)


def record(secs):
    """Half-second rows of (t, rms dBFS, tone dBFS), the louder channel of each."""
    dev, name = find("in", DEV_IN)
    nbytes = int(RATE * secs) * 4
    h = wintypes.HANDLE()
    r = winmm.waveInOpen(ctypes.byref(h), dev, ctypes.byref(FMT), 0, 0, 0)
    if r:
        sys.exit("usbloop: waveInOpen %s: error %d" % (name, r))
    buf = ctypes.create_string_buffer(nbytes)
    hdr = WAVEHDR(ctypes.cast(buf, ctypes.c_char_p), nbytes, 0, 0, 0, 0, None, 0)
    winmm.waveInPrepareHeader(h, ctypes.byref(hdr), ctypes.sizeof(hdr))
    winmm.waveInAddBuffer(h, ctypes.byref(hdr), ctypes.sizeof(hdr))
    winmm.waveInStart(h)
    while not hdr.dwFlags & WHDR_DONE:
        time.sleep(0.05)
    winmm.waveInStop(h)
    winmm.waveInUnprepareHeader(h, ctypes.byref(hdr), ctypes.sizeof(hdr))
    winmm.waveInClose(h)
    n = hdr.dwBytesRecorded // 4
    smp = struct.unpack("<%dh" % (2 * n), buf.raw[:4 * n])
    rows, step = [], RATE // 2
    for k in range(0, n - step + 1, step):
        rms = tone = 0.0
        for ch in (0, 1):
            xs = [smp[2 * j + ch] / 32768 for j in range(k, k + step)]
            rms = max(rms, math.sqrt(sum(x * x for x in xs) / step))
            tone = max(tone, tone_rms(xs))
        rows.append((k / RATE, db(rms), db(tone)))
    return rows[1:]  # the first half second is the device starting up


def main():
    if winmm is None:
        sys.exit("usbloop: Windows only (WinMM)")
    cmd, args = (sys.argv[1] if len(sys.argv) > 1 else ""), [float(a) for a in sys.argv[2:]]
    if cmd == "list":
        for kind in ("out", "in"):
            for i, n in devices(kind):
                print("%-3s %d %s" % (kind, i, n))
    elif cmd == "play":
        play(*(args + [10, -20][len(args):]))
    elif cmd == "record":
        for t, rms, tone in record(args[0] if args else 10):
            print("%5.1f s  level %6.1f dBFS  %d Hz %6.1f dBFS" % (t, rms, FREQ, tone))
    elif cmd == "check":
        # record 10 s, the tone from 3 s to 8 s; the tone is at least 20 dB above the rest when it is back
        rows = []
        rec = threading.Thread(target=lambda: rows.extend(record(10)))
        rec.start()
        time.sleep(3)
        play(5, -20)
        rec.join()
        during = [tone for t, _, tone in rows if 3.5 <= t < 7.5]
        outside = [tone for t, _, tone in rows if t < 2.5 or t >= 8.5]
        level = max((rms for _, rms, _ in rows), default=-120.0)
        if not during:
            sys.exit("usbloop: the recording is too short")
        back = min(during) > -60 and min(during) > max(outside, default=-120.0) + 20
        print("tone on the return: %s (during %.1f dBFS, outside %.1f dBFS); loudest return level %.1f dBFS"
              % ("yes" if back else "NO", min(during), max(outside, default=-120.0), level))
        print("-> the mix works; silent outputs would be the analog output path" if back else
              "-> not back: mix-minus on the computer channel? otherwise the USB link or the processing")
        sys.exit(0 if back else 1)
    else:
        sys.exit(__doc__)


if __name__ == "__main__":
    main()
