#!/bin/bash
# The clock saver (install/sd-system/dlzmod-clock, #1) without a card, in seconds: no root, no dump
# (also on GitHub). Never sets the clock: only the save (to a file of its own) and the choice of the
# time the start would set are run.
# - save: fake-hwclock's format (its load reads it back), no temp file left, the old file kept when
#   the new one cannot be written
# - newest: a file written after the last save moves the clock just past it (+ 2 s: FAT's steps);
#   older files, files too far ahead (a computer in another time zone or with a fast clock), a search
#   over its limit or none leave it
# - newest, read raw (#234): the same from FAT16/FAT32 images (long names, deleted files, folders in
#   pieces, the kernel's time zone); what it cannot read (not FAT, a broken chain) is looked up with
#   find, and a raw read over its limit gives nothing
# - floor <dir>: gives the kernel the time zone first, then sets the clock through a stand-in `date`
#   (only `date -s` is caught) and says so
# - zone: runs `hwclock --systz --utc` (a stand-in: the real one would set this computer's time
#   zone) and says so, also when it fails
# - run: saves at once, and a TERM ends it at once with one more save; gives the kernel the time zone
#   at the start and again when the offset changes (summer time; a stand-in `date +%z`)
# Needs: Linux or WSL, bash, the sh the mixer has (dash), GNU find, touch and date; for the raw reads
# python3, mkfs.vfat (dosfstools) and mcopy (mtools), else skipped (a failure on CI).
# Usage: bash tests/clock.sh (from anywhere)
set -uo pipefail

REPO=$(cd "$(dirname "$0")/.." && pwd)
CLOCK=$REPO/install/sd-system/dlzmod-clock
T=$(mktemp -d)
trap 'chmod -R u+w "$T"; rm -rf "$T"' EXIT
F=0
ok() { echo "  ok: $*"; }; bad() { echo "  FAIL: $*"; F=$((F + 1)); }
# is <name> <expected> <actual>
is() { [ "$2" = "$3" ] && ok "$1" || bad "$1 (expected '$2', got '$3')"; }

echo "== save"
f=$T/etc/fake-hwclock.data
mkdir -p "$T/etc"
before=$(date -u +%s)
DLZMOD_CLOCK_FILE=$f sh "$CLOCK" save && ok "saved" || bad "save failed"
saved=$(cat "$f" 2>/dev/null)
grep -qxE '[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}' <<< "$saved" \
  && ok "fake-hwclock's format ($saved)" || bad "format: '$saved'"
# fake-hwclock's load: date -u -d "$(cat $FILE)"
back=$(date -u -d "$saved" +%s 2>/dev/null)
[ -n "$back" ] && [ "$back" -ge "$before" ] && [ "$back" -le "$(date -u +%s)" ] \
  && ok "read back as now" || bad "read back as '$back'"
is "no temp file left" "" "$(ls "$T/etc" | grep -v '^fake-hwclock.data$')"
echo "2030-01-01 00:00:00" > "$f"
chmod a-w "$T/etc"
if [ "$(id -u)" = 0 ]; then echo "  (root: the read-only folder case is skipped)"
else
  DLZMOD_CLOCK_FILE=$f sh "$CLOCK" save > "$T/out" 2>&1 && bad "save into a read-only folder passed" \
    || ok "save into a read-only folder fails"
  grep -qF "cannot save the time" "$T/out" && ok "and says so" || bad "no message: $(cat "$T/out")"
  is "the old file kept" "2030-01-01 00:00:00" "$(cat "$f")"
fi
chmod u+w "$T/etc"

echo "== newest"
d=$T/data
mkdir -p "$d/Recordings" "$d/Recorded_Samples"
now=1800000000
at() { touch -d "@$1" "$2"; }   # at <seconds> <file>
is "an empty card: nothing" "" "$(sh "$CLOCK" newest "$d" $now)"
at $((now - 3600)) "$d/Recordings/REC_0001_otter.wav"
is "only older files: nothing" "" "$(sh "$CLOCK" newest "$d" $now)"
at $now "$d/Recordings/REC_0002_heron.wav"
is "a file at the clock's own second: nothing" "" "$(sh "$CLOCK" newest "$d" $now)"
at $((now + 40)) "$d/Recordings/REC_0003_lynx.wav"
is "a recording 40 s ahead: just past it" $((now + 42)) "$(sh "$CLOCK" newest "$d" $now)"
at $((now + 90)) "$d/Recorded_Samples/RS_0004.wav"
is "a sample further ahead counts too" $((now + 92)) "$(sh "$CLOCK" newest "$d" $now)"
at $((now + 120)) "$d/preset.json"
is "2 min ahead still counts" $((now + 122)) "$(sh "$CLOCK" newest "$d" $now)"
at $((now + 7200)) "$d/from-a-computer.wav"
is "2 h ahead (another time zone) is left out" $((now + 122)) "$(sh "$CLOCK" newest "$d" $now)"
at $((now + 121)) "$d/preset.json"
is "just over 2 min ahead (a computer's fast clock) is left out" $((now + 92)) "$(sh "$CLOCK" newest "$d" $now)"
mkdir "$d/folder-ahead" && at $((now + 60)) "$d/folder-ahead"
is "folders do not count" $((now + 92)) "$(sh "$CLOCK" newest "$d" $now)"
is "no such folder: nothing" "" "$(sh "$CLOCK" newest "$T/none" $now)"
# a search cut off by its limit: no answer, not the files it found so far
mkdir -p "$T/slow" && printf '#!/bin/sh\necho %s.0\nexit 124\n' $((now + 40)) > "$T/slow/timeout" && chmod +x "$T/slow/timeout"
is "a search over its limit: nothing" "" "$(PATH=$T/slow:$PATH sh "$CLOCK" newest "$d" $now)"

echo "== newest, read raw from FAT (#234)"
if ! command -v mkfs.vfat > /dev/null || ! command -v mcopy > /dev/null || ! command -v python3 > /dev/null; then
  [ -z "${CI:-}" ] || bad "needs mkfs.vfat (dosfstools), mcopy (mtools) and python3"
  echo "  (skipped: needs mkfs.vfat, mcopy and python3)"
else
  export MTOOLS_SKIP_CHECK=1
  # mkfat <image> <16|32>: an empty FAT of 40 MB (32: 512-byte clusters, as card-core.sh makes DLZDATA)
  mkfat() { rm -f "$1"; mkfs.vfat -C "$1" -F "$2" $([ "$2" = 32 ] && echo -s 1) 40960 > /dev/null; }
  # put <image> <seconds> <path on the image>: a file with that time, its FAT fields in UTC
  src=$T/src; mkdir -p "$src"
  put() { : > "$src/f"; touch -d "@$2" "$src/f"; TZ=UTC mcopy -m -o -i "$1" "$src/f" "::$3" < /dev/null; }
  raw() { DLZMOD_CLOCK_DEV=$1 sh "$CLOCK" newest "$T/none" $now ${2:-0} 2> "$T/raw-err"; }
  for fat in 32 16; do
    img=$T/fat$fat.img
    mkfat "$img" $fat
    is "FAT$fat: an empty card: nothing" "" "$(raw "$img")"
    is "FAT$fat: read raw, not looked up" "" "$(cat "$T/raw-err")"
    mmd -i "$img" ::/DLZ_Creator_XS_Recordings ::/Recorded_Samples ::/folder-ahead
    put "$img" $((now - 3600)) /DLZ_Creator_XS_Recordings/REC_0001_otter.wav
    put "$img" $now /DLZ_Creator_XS_Recordings/REC_0002_heron.wav
    is "FAT$fat: only older files and one at the clock's second: nothing" "" "$(raw "$img")"
    put "$img" $((now + 40)) /DLZ_Creator_XS_Recordings/REC_0003_lynx_2026-10-28_2013.wav
    is "FAT$fat: a recording 40 s ahead (a long name): just past it" $((now + 42)) "$(raw "$img")"
    put "$img" $((now + 90)) /Recorded_Samples/RS_0004.wav
    is "FAT$fat: a sample in another folder further ahead" $((now + 92)) "$(raw "$img")"
    put "$img" $((now + 7200)) /from-a-computer.wav
    is "FAT$fat: 2 h ahead is left out" $((now + 92)) "$(raw "$img")"
    put "$img" $((now + 110)) /deleted.wav && mdel -i "$img" ::/deleted.wav
    is "FAT$fat: a deleted file does not count" $((now + 92)) "$(raw "$img")"
    mmd -i "$img" ::/folder-ahead/sub && put "$img" $((now + 100)) /folder-ahead/sub/deep.txt
    is "FAT$fat: a file two folders down counts" $((now + 102)) "$(raw "$img")"
    # FAT keeps local times: with the kernel at UTC+1, fields that read now+3640 are now+40
    mkfat "$T/zone.img" $fat && put "$T/zone.img" $((now + 3640)) /REC_0005.wav
    is "FAT$fat: the kernel's time zone (UTC+1) taken off" $((now + 42)) "$(raw "$T/zone.img" 3600)"
    is "FAT$fat: and at UTC, the same fields are 1 h ahead: left out" "" "$(raw "$T/zone.img" 0)"
  done
  # a folder of many files whose clusters are not in one piece: two folders filled in turns
  img=$T/frag.img && mkfat "$img" 32 && mmd -i "$img" ::/A ::/B
  for i in $(seq 1 120); do : > "$src/R_$i.WAV"; touch -d "@$((now - 600))" "$src/R_$i.WAV"; done
  for i in $(seq 1 120); do
    TZ=UTC mcopy -m -n -i "$img" "$src/R_$i.WAV" ::/A/ < /dev/null
    TZ=UTC mcopy -m -n -i "$img" "$src/R_$i.WAV" ::/B/ < /dev/null
  done
  put "$img" $((now + 30)) /A/REC_9999_last.wav
  is "a folder in many pieces: its last file found" $((now + 32)) "$(raw "$img")"
  # the script's own functions, without its command line
  sed -n -e '/^fattimes() {$/,/^}$/p' -e '/^mounted() {/p' "$CLOCK" > "$T/fns.sh"
  is "  all 241 files read" 241 "$(FIND_LIMIT=10; . "$T/fns.sh"; fattimes "$img" 0 0 9999999999 | wc -l)"
  # what it cannot read is looked up with find, and it says so
  head -c 1048576 /dev/zero > "$T/zero.img"
  out=$(DLZMOD_CLOCK_DEV=$T/zero.img sh "$CLOCK" newest "$d" $now 2> "$T/raw-err")
  is "not FAT: looked up with find instead" $((now + 92)) "$out"
  grep -qF "not read raw, looking up each file" "$T/raw-err" && ok "and says so" || bad "no message: $(cat "$T/raw-err")"
  # a damaged folder chain (folder A, one cluster with a file 40 s ahead): read up to the damage, as
  # the kernel does, and said; not a reason to look up each file
  # setfat <image> <value>: A's FAT entry, in every FAT copy
  setfat() { python3 -c '
import struct, sys
f = open(sys.argv[1], "r+b"); b = f.read(512)
res, nfats, fsz, root = struct.unpack_from("<H", b, 14)[0], b[16], struct.unpack_from("<I", b, 36)[0], struct.unpack_from("<I", b, 44)[0]
f.seek((res + nfats * fsz + root - 2) * 512); r = f.read(512)
a = next(struct.unpack_from("<H", r, i + 26)[0] | struct.unpack_from("<H", r, i + 20)[0] << 16
         for i in range(0, 512, 32) if r[i:i + 11] == b"A          ")
v = a if sys.argv[2] == "self" else int(sys.argv[2], 0)
for k in range(nfats):
    f.seek((res + k * fsz) * 512 + a * 4); f.write(struct.pack("<I", v))' "$@"; }
  img=$T/broken.img && mkfat "$img" 32 && mmd -i "$img" ::/A && put "$img" $((now + 40)) /A/REC_1.WAV
  setfat "$img" 0x0FFFFFF7
  out=$(raw "$img")
  is "a broken chain: the folder read up to it" $((now + 42)) "$out"
  grep -qF "broken chain after cluster" "$T/raw-err" && ok "and says so" || bad "no message: $(cat "$T/raw-err")"
  grep -qF "not read raw" "$T/raw-err" && bad "looked up with find after all" || ok "read raw all the same"
  setfat "$img" self
  out=$(raw "$img")
  is "a folder chain that loops: read up to 2 MiB" $((now + 42)) "$out"
  grep -qF "over 2 MiB" "$T/raw-err" && ok "and says so" || bad "no message: $(cat "$T/raw-err")"
  is "a folder that is no FAT mount: looked up, and said" "no FAT mount" \
    "$(sh "$CLOCK" newest "$d" $now 2>&1 >/dev/null | grep -o 'no FAT mount')"
  is "a raw read over its limit: nothing, and no find after it" "" \
    "$(DLZMOD_CLOCK_DEV=$T/fat32.img PATH=$T/slow:$PATH sh "$CLOCK" newest "$d" $now)"
  # the device mounted at the folder: FAT only (/ here is not)
  is "a folder that is no FAT mount: no device" "" "$(. "$T/fns.sh"; mounted /)"
  is "a folder that is not mounted: no device" "" "$(. "$T/fns.sh"; mounted "$d")"
fi

# stand-ins: `date -s` is written down, never run, and `date +%z` gives $T/offset when there is one;
# everything else is the real date. hwclock writes down its arguments (fails when $T/hwclock-fails
# exists), never the real one.
mkdir -p "$T/bin"
cat > "$T/bin/date" << EOF
#!/bin/sh
case "\$*" in *-s*) echo "\$*" >> "$T/date-set"; exit 0 ;; esac
[ "\$*" = +%z ] && [ -f "$T/offset" ] && exec cat "$T/offset"
exec $(command -v date) "\$@"
EOF
cat > "$T/bin/hwclock" << EOF
#!/bin/sh
echo "\$*" >> "$T/hwclock-calls"
[ ! -e "$T/hwclock-fails" ]
EOF
chmod +x "$T/bin/date" "$T/bin/hwclock"
export PATH=$T/bin:$PATH
calls() { cat "$T/hwclock-calls" 2>/dev/null; rm -f "$T/hwclock-calls"; }

echo "== zone"
out=$(sh "$CLOCK" zone); rc=$?
is "zone: exit 0" 0 $rc
is "zone: only hwclock --systz --utc" "--systz --utc" "$(calls)"
grep -qF "kernel time zone:" <<< "$out" && ok "and it says so" || bad "no message: $out"
touch "$T/hwclock-fails"
out=$(sh "$CLOCK" zone); rc=$?
is "a failing hwclock: exit 1" 1 $rc
grep -qF "cannot give the kernel the time zone" <<< "$out" && ok "and it says so" || bad "no message: $out"
rm -f "$T/hwclock-fails"; calls > /dev/null

echo "== floor"
fl=$T/floor
mkdir -p "$fl/Recordings"
real=$(date +%s)
at $((real - 3600)) "$fl/Recordings/REC_0001_otter.wav"
out=$(sh "$CLOCK" floor "$fl")
is "only older files: the clock is not set" "" "$(cat "$T/date-set" 2>/dev/null)"
is "the kernel's time zone given first" "--systz --utc" "$(calls)"
grep -qF "no newer file on DLZDATA" <<< "$out" && ok "and it says so" || bad "no message: $out"
at $((real + 40)) "$fl/Recordings/REC_0002_heron.wav"
out=$(sh "$CLOCK" floor "$fl")
set_to=$(sed -n 's/.*-s @\([0-9]*\).*/\1/p' "$T/date-set" 2>/dev/null)
is "a file 40 s ahead: the clock set just past it" $((real + 42)) "$set_to"
grep -qF "clock moved forward" <<< "$out" && ok "and it says so" || bad "no message: $out"
sh "$CLOCK" floor > /dev/null 2>&1; is "floor without a folder: usage, exit 2" 2 $?

echo "== run"
f=$T/etc/run.data
echo "2000-01-01 00:00:00" > "$f"
calls > /dev/null
echo +0100 > "$T/offset"
DLZMOD_CLOCK_FILE=$f DLZMOD_CLOCK_INTERVAL=1 sh "$CLOCK" run & pid=$!
for i in $(seq 50); do [ "$(cat "$f")" != "2000-01-01 00:00:00" ] && break; sleep 0.1; done
[ "$(cat "$f")" != "2000-01-01 00:00:00" ] && ok "saves at once" || bad "no save at the start"
sleep 2.5
is "the kernel's time zone given once, not every minute" "--systz --utc" "$(calls)"
echo +0200 > "$T/offset"
sleep 2
is "and again when summer time starts" "--systz --utc" "$(calls)"
echo "2000-01-01 00:00:00" > "$f"
t0=$(date +%s); kill -TERM $pid; wait $pid; rc=$?
is "a TERM ends it with exit 0" 0 $rc
[ $(( $(date +%s) - t0 )) -le 3 ] && ok "at once, not after the minute" || bad "it took $(( $(date +%s) - t0 )) s"
[ "$(cat "$f")" != "2000-01-01 00:00:00" ] && ok "and saves once more" || bad "no save at the TERM"
is "no temp file left" "" "$(ls "$T/etc" | grep -v -e '^fake-hwclock.data$' -e '^run.data$')"

echo "== usage"
sh "$CLOCK" > /dev/null 2>&1; is "no command: usage, exit 2" 2 $?

echo
[ $F = 0 ] && echo "ALL CLOCK CHECKS PASSED" || { echo "$F CLOCK CHECK(S) FAILED"; exit 1; }
