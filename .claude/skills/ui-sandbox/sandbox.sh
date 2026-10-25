#!/bin/bash
# The UI sandbox ("the dev page"): Mackie's mixer UI on this PC (dev/ui-sandbox.sh), from Git Bash.
#
#   bash sandbox.sh status            running? (port 80/89, its node.exe, a drive an older start mapped)
#   bash sandbox.sh wait [seconds]    until http://127.0.0.1/ answers (after starting it in the background)
#   bash sandbox.sh repatch [full]    the mod's patches again onto the sandbox's app.js and server.js
#                                     (full: the full-size copy); app.js needs a browser reload, server.js
#                                     a restart (stop, then start)
#   bash sandbox.sh open              the dev page in the default browser
#   bash sandbox.sh stop              node.exe on 80/89 ended (and a drive an older start mapped, unmapped)
#
# Starting is not done here: run "bash dev/ui-sandbox.sh" (DLZ_FULLSIZE=1 for the full-size UI) as a
# background task from the repo root, then "wait". Stopping that task alone leaves node.exe listening
# on 80/89: always "stop". Starts before #166 mapped the sandbox folder to a drive (subst): status and
# stop still find and unmap such a drive.
set -u
REPO=$(git -C "$(dirname "$0")" rev-parse --show-toplevel)

# pids of processes listening on 127.0.0.1:80 or :89 (one line each, unique)
listeners() {
  netstat -ano 2>/dev/null | awk '$1 == "TCP" && $4 == "LISTENING" && ($2 ~ /:80$/ || $2 ~ /:89$/) { print $5 }' | sort -u
}
# image name of a Windows pid
image() { tasklist //FI "PID eq $1" //FO CSV //NH 2>/dev/null | awk -F'","' 'NR == 1 { gsub(/"/, "", $1); print $1 }'; }
# drive letters mapped to one of the sandbox folders (dumps/sandbox, dumps/sandbox-full)
# (the path through the environment: awk -v would read its backslashes as escapes)
drives() { subst | SBW=$(cygpath -w "$REPO/dumps/sandbox") awk 'index($0, ENVIRON["SBW"]) { print substr($1, 1, 1) }'; }

case ${1:-status} in
  status)
    any=0
    for p in $(listeners); do echo "listening on 80/89: pid $p ($(image "$p"))"; any=1; done
    for d in $(drives); do echo "drive $d: mapped to $(subst | grep -i "^$d:" | sed 's/.*=> //')"; any=1; done
    if curl -s -o /dev/null -m 3 http://127.0.0.1/; then echo "http://127.0.0.1/ answers"; else echo "http://127.0.0.1/ does not answer"; fi
    [ $any = 1 ] || echo "not running" ;;
  wait)
    n=${2:-30}
    for _ in $(seq "$n"); do
      curl -s -o /dev/null -m 2 http://127.0.0.1/ && { echo "http://127.0.0.1/ answers"; exit 0; }
      sleep 1
    done
    echo "no answer after $n s (see the background task's output)"; exit 1 ;;
  repatch)
    sb=$REPO/dumps/sandbox; [ "${2:-}" = full ] && sb=$REPO/dumps/sandbox-full
    [ -f "$sb/srv/app.js" ] || { echo "no sandbox copy in $sb (start it once first)"; exit 1; }
    python "$REPO/install/patch.py" app "$sb/srv/app.js" && python "$REPO/install/patch.py" server "$sb/srv/server.js" \
      && echo "patched $sb: reload the browser (app.js); server.js changes need stop + start" ;;
  open)
    cmd //c start http://127.0.0.1/ ;;
  stop)
    for p in $(listeners); do
      img=$(image "$p")
      if [ "$img" = node.exe ]; then taskkill //PID "$p" //F > /dev/null && echo "ended node.exe (pid $p)"
      else echo "pid $p ($img) listens on 80/89 but is not node.exe: left alone"; fi
    done
    for d in $(drives); do subst "$d:" //D && echo "drive $d: unmapped"; done
    sleep 1
    [ -z "$(listeners)" ] && [ -z "$(drives)" ] && echo "stopped" || { echo "something is still there:"; bash "$0" status; } ;;
  *)
    sed -n '2,15p' "$0"; exit 2 ;;
esac
