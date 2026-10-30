#!/usr/bin/env python3
"""A measuring copy of dspserver for the audio headroom (#5, Q19; notes/components/dspserver.md).

dspserver's audio thread spins on a hardware register until the next half of the audio buffer is
ready, so the time it waits is the room left, and no outside tool can see it. This makes a copy of
the stock binary whose two block functions time that wait (dev/dsp-headroom.S) and add it up in
counters past the end of .bss, and reads those counters from the running process (/proc/PID/mem,
without stopping it). Dev card only, never shipped: dev/dsp-headroom.sh runs it on the mixer, with
the copy on a tmpfs, so nothing is written to the card.

Usage: dsp-headroom.py patch STOCK OUT   the patched copy of a stock dspserver (refuses any other)
       dsp-headroom.py read [SECONDS]    two readings SECONDS apart (default 10) from the running one
       dsp-headroom.py cave              the stub's bytes as hex (tests/dsp-headroom.sh)
Standard library only: runs on the mixer's python3.10 and in WSL.
"""
import hashlib
import os
import struct
import sys
import time

STOCK_SHA256 = '858e4e99bd84c30c854d56d8df88ce543dfef73b8542c776fc78c9b3a2ac2bb8'  # build 1731
BASE = 0x10000                                   # the text segment's address, file offset 0
SITES = (0x3dabc, 0x40d54)                       # the wait loop in each block function
LOOP = bytes.fromhex('286093e5a664e0e1016006e2060052e1faffff0a')
NOP = struct.pack('<I', 0xe320f000)
CAVE_VA = 0x286030                               # zero padding after .eh_frame, before the data segment
CAVE = bytes.fromhex(                            # dev/dsp-headroom.S, assembled
    '1e0f51ec286093e5a664e0e1016006e2060052e1faffff0a1e4f55ec000044e0808a03e3308040e3f040c8e1d840c8e1'
    '004094e00050a5e2f840c8e1704f1dee1c5098e5050054e11c4088152050981501508512205088150000e0e1144098e5'
    '040050e114008885101098e5011081e2101088e5011ab0e11eff2f11144098e5184088e5141088e51eff2fe1')
G = 0x303a80                                     # the counters: the stock end of .bss
G_SIZE = 0x40
TICKS_PER_S = 24_000_000                         # CNTVCT runs from the 24 MHz oscillator [guess]


def die(msg):
    sys.exit('dsp-headroom: ' + msg)


def patch(stock, out):
    b = bytearray(open(stock, 'rb').read())
    if hashlib.sha256(b).hexdigest() != STOCK_SHA256:
        die(stock + ' is not the stock dspserver this patch was made for')
    phoff, = struct.unpack_from('<I', b, 0x1c)
    phentsize, phnum = struct.unpack_from('<HH', b, 0x2a)
    loads = []
    for i in range(phnum):
        o = phoff + i * phentsize
        p_type, p_offset, p_vaddr, _, p_filesz, p_memsz, p_flags = struct.unpack_from('<7I', b, o)
        if p_type == 1:
            loads.append((o, p_offset, p_vaddr, p_filesz, p_memsz, p_flags))
    (to, _, tva, tfs, tms, _), (do, doff, dva, dfs, dms, _) = loads
    cave_off = CAVE_VA - BASE
    if tva != BASE or tfs != tms or tfs > cave_off or cave_off + len(CAVE) > doff \
            or any(b[tfs:cave_off + len(CAVE)]) or dva + dms != G:
        die('unexpected layout')
    for va in SITES:
        o = va - BASE
        if b[o:o + len(LOOP)] != LOOP:
            die('wait loop not found at 0x%x' % va)
        bl = 0xeb000000 | (((CAVE_VA - (va + 8)) >> 2) & 0xffffff)
        b[o:o + len(LOOP)] = struct.pack('<I', bl) + NOP * 4
    b[cave_off:cave_off + len(CAVE)] = CAVE
    # the text segment grows over the stub, the data segment over the counters (zeroed like .bss)
    struct.pack_into('<II', b, to + 16, cave_off + len(CAVE), cave_off + len(CAVE))
    struct.pack_into('<I', b, do + 20, dms + G_SIZE)
    tmp = out + '.tmp'
    with open(tmp, 'wb') as f:
        f.write(b)
    os.chmod(tmp, 0o755)
    os.rename(tmp, out)
    print('patched: %s (sha256 %s)' % (out, hashlib.sha256(b).hexdigest()))


def pid_of(name):
    for p in os.listdir('/proc'):
        if p.isdigit():
            try:
                if open('/proc/%s/comm' % p).read().strip() == name:
                    return int(p)
            except OSError:
                pass
    die(name + ' is not running')


def sample(pid):
    with open('/proc/%d/mem' % pid, 'rb', buffering=0) as m:
        m.seek(CAVE_VA)
        if m.read(len(CAVE)) != CAVE:
            die('the running dspserver is the stock one (dsp-headroom.sh on)')
        m.seek(G)
        raw = m.read(36)
    return time.monotonic(), struct.unpack('<QQIIIII', raw)


def shortest(a, b):
    w = [~v & 0xffffffff for v in (a, b) if v]
    return min(w) if w else None


def read(seconds):
    pid = pid_of('dspserver')
    w0, (end0, waited0, blocks0, _, _, _, changes0) = sample(pid)
    time.sleep(seconds)
    w1, (end1, waited1, blocks1, mincur, minprev, _, changes1) = sample(pid)
    ticks, blocks = end1 - end0, blocks1 - blocks0
    if blocks <= 0 or ticks <= 0:
        die('no audio blocks in %g s' % seconds)
    period = ticks / blocks
    print('blocks:          %d in %.2f s (%.0f per second by the counter)'
          % (blocks, w1 - w0, blocks * TICKS_PER_S / ticks))
    print('counter:         %.2f MHz by the wall clock' % (ticks / (w1 - w0) / 1e6))
    print('block period:    %.0f ticks (%.1f us at 24 MHz)' % (period, period * 1e6 / TICKS_PER_S))
    print('headroom:        %.1f %% of the time waiting (mean)' % (100 * (waited1 - waited0) / ticks))
    s = shortest(mincur, minprev)
    if s is not None:
        print('worst block:     %.1f %% left (shortest wait in the last 4096-8192 blocks)'
              % (100 * s / period))
    print('thread changes:  %d (C2/C3 handovers in the window)' % (changes1 - changes0))


def main(argv):
    if len(argv) == 4 and argv[1] == 'patch':
        patch(argv[2], argv[3])
    elif len(argv) in (2, 3) and argv[1] == 'read':
        read(float(argv[2]) if len(argv) == 3 else 10)
    elif len(argv) == 2 and argv[1] == 'cave':
        print(CAVE.hex())
    else:
        sys.exit(__doc__)


if __name__ == '__main__':
    main(sys.argv)
