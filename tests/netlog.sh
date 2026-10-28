#!/bin/bash
# The network log of a development card (install/sd-system/dlzmod-netlog) with stand-ins for ip and
# journalctl and a UDP receiver on this PC's loopback: no mixer, no dump, no root.
#   bash tests/netlog.sh
set -u
cd "$(dirname "$0")/.." || exit 2
SCRIPT=$PWD/install/sd-system/dlzmod-netlog
TMP=$(mktemp -d)
trap 'kill $rx 2> /dev/null; rm -rf "$TMP"' EXIT
rx=
fail=0
ok() { echo "ok    $*"; }
bad() { echo "FAIL  $*"; fail=1; }

# stand-ins: ip answers once $STATE/up exists (the network comes up after 2 tries); journalctl prints
# its arguments and 2 lines, one with a backslash, and ends (the real one follows)
mkdir -p "$TMP/bin"
cat > "$TMP/bin/ip" << 'EOF'
#!/bin/sh
n=$(cat "$STATE/ip" 2>/dev/null || echo 0); echo $((n + 1)) > "$STATE/ip"
[ "$n" -ge 2 ]
EOF
cat > "$TMP/bin/journalctl" << 'EOF'
#!/bin/sh
echo "args: $*"
echo "[    0.000000] host kernel: Booting Linux on physical CPU 0x0"
echo 'a line with a \ backslash'
EOF
cat > "$TMP/bin/sleep" << 'EOF'
#!/bin/sh
echo "$1" >> "$STATE/slept"
EOF
chmod +x "$TMP/bin/"*
run() { STATE=$TMP PATH="$TMP/bin:$PATH" DLZMOD_NETLOG_CONF=$TMP/conf bash "$SCRIPT" > "$TMP/out" 2>&1; }

# 1. no file: off, nothing said, nothing sent
run && [ ! -s "$TMP/out" ] && [ ! -e "$TMP/ip" ] && ok "off without the file" || bad "no file: $(cat "$TMP/out")"

# 2. a file that is not "<IPv4> <port>": nothing sent
for c in "pc.local 5140" "192.168.1.5" "192.168.1.5 0" "192.168.1.5 70000" "192.168.1.5 51x" "1.2.3.4; reboot 5140"; do
  echo "$c" > "$TMP/conf"
  rm -f "$TMP/ip"
  if run && grep -q "is not '<IPv4 address> <port>'" "$TMP/out" && [ ! -e "$TMP/ip" ]; then :; else bad "refused: $c"; fi
done
ok "odd files refused"

# 3. a good file: waits for the route, then every line of this start's journal as its own datagram
port=$(python3 -c 'import socket; s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM); s.bind(("127.0.0.1", 0)); print(s.getsockname()[1])')
python3 -c '
import socket, sys
s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
s.bind(("127.0.0.1", int(sys.argv[1])))
s.settimeout(5)
with open(sys.argv[2], "wb") as f:
    try:
        while True:
            d = s.recv(65535)
            f.write(d + b"|"); f.flush()
    except socket.timeout:
        pass
' "$port" "$TMP/rx" &
rx=$!
sleep_real=$(command -v sleep)
"$sleep_real" 0.5
echo "127.0.0.1 $port" > "$TMP/conf"
rm -f "$TMP/ip"
run || bad "good: exit $?"
"$sleep_real" 0.5
grep -q "sending this start's log to 127.0.0.1:$port" "$TMP/out" && ok "says where it sends" || bad "good: $(cat "$TMP/out")"
[ "$(cat "$TMP/ip")" = 3 ] && [ "$(cat "$TMP/slept")" = "$(printf '1\n1')" ] && ok "waited for the route (1 s steps)" \
  || bad "route: $(cat "$TMP/ip") tries, slept $(tr '\n' ' ' < "$TMP/slept")"
got=$(cat "$TMP/rx")
[ "$got" = "args: -b -f -n all -q --no-pager -o short-monotonic
|[    0.000000] host kernel: Booting Linux on physical CPU 0x0
|a line with a \\ backslash
|" ] && ok "this start, followed, one datagram per line, backslashes kept" || bad "received: $got"
[ "$(wc -l < "$TMP/out")" = 1 ] && ok "nothing else in its own log" || bad "own log: $(cat "$TMP/out")"

# 4. nobody listening (the PC's port closed): no error, no output per line
echo "127.0.0.1 9" > "$TMP/conf"
rm -f "$TMP/ip"
run && [ "$(wc -l < "$TMP/out")" = 1 ] && ok "a closed port: quiet" || bad "closed port: $(cat "$TMP/out")"

[ $fail = 0 ] && echo "ALL OK" || { echo "FAILED"; exit 1; }
