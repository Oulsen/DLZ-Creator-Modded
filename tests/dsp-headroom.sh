#!/bin/bash
# The measuring copy of dspserver (dev/dsp-headroom.py, #5) without a mixer (WSL, root, from the repo
# root, the dump mounted read-only at /mnt/dlz by install/mount-ro.sh; it is only read; needs
# binutils-arm-linux-gnueabihf and qemu-arm):
# - the stub's bytes in dsp-headroom.py are dev/dsp-headroom.S, assembled
# - the patch on a copy of the dump's dspserver: both wait loops call the stub, the stub sits in the
#   grown text segment, the data segment grows over the counters, nothing else changes; any other
#   binary is refused
# - the stub under qemu, linked at its place with the counters at theirs: 4097 blocks against a
#   register that is always ready give the block count, one thread, a new window after 4096 blocks
#   bash tests/dsp-headroom.sh
set -u
cd "$(dirname "$0")/.." || exit 2
DUMP=${DUMP:-/mnt/dlz}
STOCK=$DUMP/usr/local/bin/dspserver
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
fail=0
ok() { echo "ok    $*"; }
bad() { echo "FAIL  $*"; fail=1; }
[ -f "$STOCK" ] || { echo "no dump at $DUMP: wsl -d Ubuntu -u root -e bash install/mount-ro.sh"; exit 2; }
command -v arm-linux-gnueabihf-as > /dev/null || { echo "no ARM binutils: apt-get install binutils-arm-linux-gnueabihf"; exit 2; }
P=dev/dsp-headroom.py

arm-linux-gnueabihf-as -march=armv7-a -o "$TMP/cave.o" dev/dsp-headroom.S \
  && arm-linux-gnueabihf-objcopy -O binary -j .cave "$TMP/cave.o" "$TMP/cave.bin" || { echo "dsp-headroom.S does not assemble"; exit 1; }
[ "$(xxd -p "$TMP/cave.bin" | tr -d '\n')" = "$(python3 -I $P cave)" ] && ok "the stub's bytes are dsp-headroom.S" || bad "the stub's bytes differ from dsp-headroom.S: assemble it again"

python3 -I $P patch "$STOCK" "$TMP/dsp" > "$TMP/out" 2>&1 && ok "$(cat "$TMP/out")" || bad "patch failed: $(cat "$TMP/out")"
dis() { arm-linux-gnueabihf-objdump -d --start-address=$1 --stop-address=$2 "$TMP/dsp" | grep -E '^ +[0-9a-f]+:' | sed 's/^ *//; s/\t/ /g; s/  */ /g'; }
for site in 0x3dabc 0x40d54; do
  got=$(dis $site $((site + 20)) | cut -d' ' -f3- | sed 's/ <.*//; s/ {0}//' | tr '\n' ';')
  [ "$got" = "bl 286030;nop;nop;nop;nop;" ] && ok "wait loop at $site calls the stub" || bad "wait loop at $site: $got"
done
# no section covers the stub (objdump -d cannot show it): its bytes at its file offset
cmp -s "$TMP/cave.bin" <(dd if="$TMP/dsp" bs=1 skip=$((0x276030)) count=140 status=none) && ok "the stub sits at 0x286030" || bad "no stub at 0x286030"
# the program headers: text grows to the stub's end, data's memsz by 0x40, the rest the same
readelf -lW "$STOCK" | grep -E '^ +(LOAD|GNU|DYNAMIC|INTERP|NOTE|EXIDX|TLS)' > "$TMP/ph.stock"
readelf -lW "$TMP/dsp" | grep -E '^ +(LOAD|GNU|DYNAMIC|INTERP|NOTE|EXIDX|TLS)' > "$TMP/ph.dsp"
diff "$TMP/ph.stock" "$TMP/ph.dsp" | grep '^[<>]' | sed 's/  */ /g' > "$TMP/ph.diff"
expect='< LOAD 0x000000 0x00010000 0x00010000 0x27602c 0x27602c R E 0x10000
< LOAD 0x276428 0x00296428 0x00296428 0x0c060 0x6d658 RW 0x10000
> LOAD 0x000000 0x00010000 0x00010000 0x2760bc 0x2760bc R E 0x10000
> LOAD 0x276428 0x00296428 0x00296428 0x0c060 0x6d698 RW 0x10000'
[ "$(cat "$TMP/ph.diff")" = "$expect" ] && ok "segments: text over the stub, data over the counters, nothing else" || bad "segments: $(cat "$TMP/ph.diff")"
# outside the two loops, the stub and the two header fields, every byte is the stock one
python3 -I - "$STOCK" "$TMP/dsp" > "$TMP/cmp" <<'EOF' && ok "no other byte changed" || bad "other bytes changed: $(cat "$TMP/cmp")"
import sys
a, b = open(sys.argv[1], 'rb').read(), open(sys.argv[2], 'rb').read()
allowed = set(range(0x2dabc, 0x2dabc + 20)) | set(range(0x30d54, 0x30d54 + 20)) | set(range(0x276030, 0x276030 + 140))
allowed |= set(range(0x34 + 32 * 3 + 16, 0x34 + 32 * 3 + 24)) | set(range(0x34 + 32 * 4 + 20, 0x34 + 32 * 4 + 24))  # LOADs: entries 3, 4
diff = [hex(i) for i in range(len(a)) if a[i] != b[i] and i not in allowed]
print(' '.join(diff[:10]))
sys.exit(1 if diff or len(a) != len(b) else 0)
EOF
cp "$STOCK" "$TMP/other" && printf '\x01' | dd of="$TMP/other" bs=1 seek=$((0x100000)) conv=notrunc status=none
python3 -I $P patch "$TMP/other" "$TMP/dsp2" > "$TMP/out" 2>&1 || true
[ ! -e "$TMP/dsp2" ] && grep -q 'not the stock dspserver' "$TMP/out" && ok "another binary is refused" || bad "another binary: $(cat "$TMP/out")"

# qemu's 32-bit user mode does not let a program read the counter (mrrc CNTVCT traps, the mixer's
# kernel allows it): the harness's copy of the stub reads 100 at the start and 250 at the end instead
python3 -I - "$TMP/cave.bin" > "$TMP/cave-q.S" <<'EOF'
import struct, sys
w = list(struct.unpack('<35I', open(sys.argv[1], 'rb').read()))
assert w[0] == 0xec510f1e and w[6] == 0xec554f1e, 'the counter reads moved: update the harness'
w[0], w[6] = 0xe3a00064, 0xe3a040fa   # mov r0, #100 / mov r4, #250 (r5: 0 from the harness)
print('\t.section .cave, "ax"\n\t.global cave\ncave:')
print('\n'.join('\t.word 0x%08x' % x for x in w))
EOF
cat > "$TMP/harness.S" <<'EOF'
	.syntax unified
	.arm
	.global _start
	.text
_start:	ldr	r0, =0x1234
	ldr	r7, =0xf0005		@ set_tls, as glibc does for every thread
	svc	#0
	ldr	r10, =4097
1:	ldr	r3, =reg
	mov	r2, #0			@ the half done last: 0; the register reads 0, so half 1 is ready
	mov	r5, #0
	bl	cave
	cmp	r6, #1
	bne	2f
	subs	r10, r10, #1
	bne	1b
	mov	r0, #1
	ldr	r1, =0x303a80
	mov	r2, #36
	mov	r7, #4			@ write(1, counters, 36)
	svc	#0
	mov	r0, #0
	b	3f
2:	mov	r0, #3
3:	mov	r7, #1			@ exit
	svc	#0
	.bss
reg:	.space	0x40
	.section .counters, "aw", %nobits
	.space	0x40
EOF
if arm-linux-gnueabihf-as -march=armv7-a -o "$TMP/harness.o" "$TMP/harness.S" \
  && arm-linux-gnueabihf-as -march=armv7-a -o "$TMP/cave-q.o" "$TMP/cave-q.S" \
  && arm-linux-gnueabihf-ld -static -Ttext=0x10000 --section-start=.cave=0x286030 --section-start=.counters=0x303a80 \
     -o "$TMP/harness" "$TMP/harness.o" "$TMP/cave-q.o"; then
  qemu-arm -cpu cortex-a7 "$TMP/harness" > "$TMP/counters"; rc=$?
  python3 -I - "$TMP/counters" $rc > "$TMP/h" <<'EOF' && ok "under qemu: $(cat "$TMP/h")" || bad "under qemu: $(cat "$TMP/h")"
import struct, sys
raw, rc = open(sys.argv[1], 'rb').read(), int(sys.argv[2])
if rc != 0 or len(raw) != 36:
    print('exit %d, %d bytes (3: the stub gave the wrong half)' % (rc, len(raw))); sys.exit(1)
end, waited, blocks, mincur, minprev, tls, changes = struct.unpack('<QQIIIII', raw)
inv = ~150 & 0xffffffff
ok = (end, waited, blocks, mincur, minprev, changes) == (250, 150 * 4097, 4097, inv, inv, 1) and tls == 0x1234
print('%d blocks, %d ticks waited, last end %d, shortest wait %d and %d, %d thread change'
      % (blocks, waited, end, ~mincur & 0xffffffff, ~minprev & 0xffffffff, changes))
sys.exit(0 if ok else 1)
EOF
else
  bad "the harness does not build"
fi

[ $fail = 0 ] && echo "all ok" || echo "FAILED"
exit $fail
