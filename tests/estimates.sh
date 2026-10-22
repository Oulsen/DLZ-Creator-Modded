#!/bin/bash
# The copy step's time left (install-card.sh, steady() in IC_AWK) replayed on a real install (#128):
# the v0.2.0 install on the mixer (spare card, 2322 MiB in use), its step 1 estimates as they stood
# before steady() (read back from the shown minutes of its 30 s log lines, in between one round every
# 2 s as on the mixer), copy and backup done at 328 s, the install at 578 s. Each 30 s point: the shown
# step and whole-install times at most 1.5 times the real one plus half a minute, and the real one at
# most twice the shown plus a minute. A control run without steady() must fail (it showed 14 min for
# 6.6 on the mixer). VERBOSE=1: every checked time. AWK= another awk (the device's: AWK="qemu-arm vendor/busybox.bin awk" in WSL).
# Run from the repo root: bash tests/estimates.sh
set -u
. install/installer/install-card.sh
AWK=${AWK:-awk}

# replay <rise %>: the checks' failures, one per line, then "checked N"
replay() {
  $AWK -v rise="$1" -v verbose="${VERBOSE:-0}" -v cp=$IC_COMPARE_PCT -v bs=$IC_BUILD_SECS "$IC_AWK"'
  BEGIN {
    t0 = 33; e1 = 328; ea = 578
    # uptime and the step time left the mixer estimated then (its shown minutes, before steady)
    n = split("33 300 63.5 240 94 240 124.3 300 154.7 300 185.1 360 215.7 180 246.4 60 276.9 30 307.4 30", a, " ")
    for (i = 1; i <= n; i += 2) { k++; ts[k] = a[i]; ls[k] = a[i + 1] }
    pe = 0; tp = 0; j = 1
    # to the end of the copy: after the last log line the last estimate holds
    for (now = t0; now < e1; now += 2) {
      while (j < k && ts[j + 1] <= now) j++
      raw = ls[j]
      if (j < k) raw = ls[j] + (ls[j + 1] - ls[j]) * (now - ts[j]) / (ts[j + 1] - ts[j])
      left = raw
      if (rise >= 0) { left = steady(pe, tp, now, raw, rise); pe = now + left; tp = now }
      for (m = 1; m <= k; m++) if (!done[m] && now >= ts[m]) {
        done[m] = 1; c++
        all = copyall(left, now, t0, cp, bs)
        check("step", left, e1 - now); check("whole install", all, ea - now)
      }
    }
    print "checked " c
  }
  function check(w, sh, real) {
    if (verbose) printf "    %3d s  %-13s shown %3d s  real %3d s\n", now, w, sh, real
    if (sh > 1.5 * real + 30 || real > 2 * sh + 60) printf "  at %d s: %s shown %d s, real %d s\n", now, w, sh, real
  }'
}

fail=0
# the copy round itself reads /proc and the copy's processes, so it cannot run here: that it hands
# steady() the end shown last, and carries it to the next round, is checked in its text
tick=$(sed -n '/^ic_copy_tick() {/,/^}/p' install/installer/install-card.sh)
for w in '-v pe="${_pe:-0}" -v tp="${_tp:-0}" -v rise=$IC_RISE_PCT' 'left = steady(pe, tp, now, raw, rise); pe = now + left; tp = now' \
    'alltxt(copyall(left, now, t0, cp, bs))' '_tk=$7 _pe=$8 _tp=$9'; do
  case $tick in *"$w"*) ;; *) echo "  ic_copy_tick: no longer has: $w"; fail=1 ;; esac
done
grep -q '_tk=0 _pe=0 _tp=0' install/installer/install-card.sh || { echo "  ic_copy: _pe/_tp not reset at the start"; fail=1; }
out=$(replay $IC_RISE_PCT)
echo "$out" | grep -v '^checked' || true
[ "${VERBOSE:-0}" = 1 ] && { echo "control without steady:"; replay -1 | grep -v '^checked'; }
bad=$(echo "$out" | grep -c '^  at')
echo "steady (rise $IC_RISE_PCT %): $(echo "$out" | sed -n 's/^checked //p') points, $bad off"
[ "$bad" = 0 ] || fail=1
ctl=$(replay -1 | grep -c '^  at')
echo "control without steady: $ctl off (must be more than 0)"
[ "$ctl" -gt 0 ] || fail=1
[ $fail = 0 ] && echo "ALL OK" || { echo "FAILED"; exit 1; }
