#!/bin/bash
# Builds the Ghidra project of the mixer's programs (#201): copies faderlink, dspserver and glesgui
# from the read-only dump into build/re/ (all REA needs: it analyses a program itself when opened)
# and analyses them once into build/re/ghidra/dlz.gpr, for Ghidra's own GUI and headless scripts.
# Private: build/ is git-ignored, never commit any of it.
# Analysis runs on WSL's own disk (/root/re) with 2 decompiler workers and a 4 GB heap (1 and 3 GB
# when WSL has less than 12 GB): 12 workers ran WSL out of memory (each can take 2.5 GB on a large
# function). dspserver takes longest (about 41 minutes, the others under 2).
#
# Usage (repo root): wsl -d Ubuntu -u root -e bash dev/re/analyze.sh [program...]
#   default: all three; a program already in the project is analysed again (-overwrite)
set -euo pipefail

REPO=$(cd "$(dirname "$0")/../.." && pwd)
OUT=$REPO/build/re
WORK=/root/re
GHIDRA_DIR=/opt/ghidra_12.1.4_PUBLIC
PROGS=("$@"); [ ${#PROGS[@]} -gt 0 ] || PROGS=(faderlink dspserver glesgui)

[ "$(id -u)" = 0 ] || { echo "analyze: run as root (wsl -u root)" >&2; exit 1; }
[ -x "$GHIDRA_DIR/support/analyzeHeadless" ] || { echo "analyze: no Ghidra, run dev/re/setup.sh first" >&2; exit 1; }

bash "$REPO/install/mount-ro.sh"
mkdir -p "$OUT" "$WORK/ghidra"
[ -d "$OUT/ghidra/dlz.rep" ] && [ ! -d "$WORK/ghidra/dlz.rep" ] && cp -a "$OUT/ghidra/." "$WORK/ghidra/"
for p in "${PROGS[@]}"; do
  cp -p "/mnt/dlz/usr/local/bin/$p" "$OUT/"
  cp -p "/mnt/dlz/usr/local/bin/$p" "$WORK/"
done

# WSL gets half the PC's RAM by default: below 12 GB, one worker and a 3 GB heap
CPUS=2 HEAP=4G
[ "$(awk '/^MemTotal/ {print int($2 / 1048576)}' /proc/meminfo)" -ge 12 ] || CPUS=1 HEAP=3G
echo "== analysing ${PROGS[*]} ($CPUS workers, $HEAP heap)"

# Headless Ghidra only reports a finished program: once a minute, the analysis step it is in
# (from a thread dump of its JVM), printed when it changes
JDK=/usr/lib/jvm/java-21-openjdk-amd64
(
  prev=
  while sleep 60; do
    pid=$(pgrep -f ghidra.Ghidra | head -1) || continue
    step=$("$JDK/bin/jcmd" "$pid" Thread.print 2>/dev/null | grep -oE '[A-Za-z]+Analyzer\.[a-z]' \
      | grep -vE '^(Headless|AutoAnalysis|Abstract)' | sed 's/\..*//' | sort -u | tr '\n' ' ')
    [ "$step" = "$prev" ] || echo "   $(date +%H:%M) step: ${step:-between steps}"
    prev=$step
  done
) &
WATCH=$!
trap 'kill $WATCH 2>/dev/null' EXIT

cd "$WORK"
rm -f ghidra/dlz.lock ghidra/dlz.lock~
JAVA_HOME=$JDK MAXMEM=$HEAP \
  "$GHIDRA_DIR/support/analyzeHeadless" "$WORK/ghidra" dlz -import "${PROGS[@]}" -overwrite \
  -processor ARM:LE:32:v7 -cspec default -max-cpu $CPUS 2>&1 | tee "$OUT/analyze.log" \
  | grep -E 'ANALYZING|REPORT|ERROR' || true
kill $WATCH 2>/dev/null || true
rm -f ghidra/dlz.lock ghidra/dlz.lock~

rm -rf "$OUT/ghidra"
cp -a "$WORK/ghidra" "$OUT/"
echo "== project: build/re/ghidra/dlz.gpr ($(du -sh "$OUT/ghidra" | cut -f1)); full log: build/re/analyze.log"
