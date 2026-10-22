# The current start in a dev card's network log (dev/netlog.ps1: the journal with the uptime in front
# of every line, a marker line before each start): prints "<uptime> <screen>", the uptime of its last
# journal line and of glesgui's first "Context renderer string" or, when that line was lost, its first
# "Client connected." (the screen; empty while it is not up; a glesgui restarted later in the same
# start keeps the first). The start begins at the last marker or kernel boot line, or where the
# uptime goes back (a start whose first lines were lost, so without a marker; missed when the start
# before was younger than its first line that came); need=1: only after one (dev/push.sh, reading the
# lines after its prompt), else the file's first line too (a log that begins mid-start). Prints
# nothing without a journal line. Used by dlz-ssh.sh early() and dev/push.sh; the lines may end in CR
# (the listener).
/^===== new start of the mixer/ || /kernel: Booting Linux/ { n = 1; c = ""; k = ""; u = "" }
/^\[ *[0-9]+\.[0-9]+\]/ {
  s = $0; sub(/^\[ */, "", s); sub(/\].*/, "", s); s = int(s)
  if (u != "" && s + 5 < u) { n = 1; c = ""; k = "" }
  u = s
  if (c == "" && /Context renderer string/) c = u
  if (k == "" && /glesgui.*Client connected\./) k = u
}
END { if ((n || !need) && u != "") print u, (c != "" ? c : k) }
