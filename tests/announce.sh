#!/bin/bash
# The Discord message of a published release (install/release/announce.jq, run by
# .github/workflows/announce.yml): highlights before the first heading, issue numbers off, CRLF notes,
# the update or new-install line, the name or the tag, mentions, and the stops (the line to replace
# still there, no highlights, too long). Offline; needs jq (JQ= another one); CI runs it.
set -u
REPO=$(cd "$(dirname "$0")/.." && pwd)
JQ=${JQ:-jq}
F=$REPO/install/release/announce.jq
fail=0
ok() { printf 'ok    %s\n' "$1"; }
bad() { printf 'WRONG %s\n' "$1"; fail=1; }

# msg <name> <body> [crlf]: the message's text; exit status of jq (jq makes the CRLF: Git Bash drops
# the CR of $'\r' in a script)
msg() { "$JQ" -n --arg n "$1" --arg b "$2" --arg crlf "${3:-}" \
    '{name: $n, body: (if $crlf == "" then $b else $b | gsub("\n"; "\r\n") end), url: "https://example.org/v0.3.0"}' \
  | TAG=v0.3.0 "$JQ" -e -f "$F" > "$T" 2> "$E" && "$JQ" -r .content "$T" | tr -d '\r'; }   # jq.exe writes CRLF
T=$(mktemp); E=$(mktemp)
trap 'rm -f "$T" "$E"' EXIT

notes=$'**New install:** download the installer image ...\n\n- Themes: high contrast (#21)\n- Starts sooner\n\n### DLZ features\n- Themes: high contrast (#21)\n'
out=$(msg v0.3.0 "$notes") && ok "good notes: exit 0" || bad "good notes: exit 0 ($(cat "$E"))"
[ "$(printf '%s\n' "$out" | head -n 1)" = '@everyone DLZ Creator Modded v0.3.0!' ] && ok "@everyone and the name" || bad "@everyone and the name ($out)"
[ "$(printf '%s\n' "$out" | grep '^- ' | tr '\n' '|')" = '- Themes: high contrast|- Starts sooner|' ] \
  && ok "only the highlights, issue numbers off" || bad "only the highlights ($out)"
printf '%s\n' "$out" | grep -q '^New install only: ' && ok "no update line: a new install only" || bad "no update line: a new install only"
[ "$(printf '%s\n' "$out" | tail -n 1)" = 'https://example.org/v0.3.0' ] && ok "the link last" || bad "the link last"
[ "$("$JQ" -c .allowed_mentions "$T")" = '{"parse":["everyone"]}' ] && ok "mentions: @everyone only" || bad "mentions"

out=$(msg "" "$notes" crlf) && "$JQ" -e '.content | contains("\r") | not' "$T" > /dev/null \
  && printf '%s\n' "$out" | grep -qx -- '- Starts sooner' && ok "CRLF notes" || bad "CRLF notes ($out)"
printf '%s\n' "$out" | head -n 1 | grep -q 'Modded v0.3.0!$' && ok "no name: the tag" || bad "no name: the tag"
out=$(msg v0.3.0 "**Update from v0.2.0:** copy both update files ..."$'\n\n- A thing') \
  && printf '%s\n' "$out" | grep -q '^Already on v0.2.0: drop the update files' && ok "the update line names the version" || bad "the update line ($out)"
out=$(msg v0.3.0 $'- Only highlights, no heading') && printf '%s\n' "$out" | grep -qx -- '- Only highlights, no heading' \
  && ok "notes without a heading" || bad "notes without a heading ($out)"

stop() {   # stop <description> <expected text in stderr> <body>
  if msg v0.3.0 "$3" > /dev/null; then bad "$1: exit 0"
  elif grep -q -- "$2" "$E"; then ok "$1"
  else bad "$1 (said: $(cat "$E"))"; fi
}
stop "the line to replace still there" "Before publishing, replace this line" $'**Before publishing, replace this line:** ...\n\n- A thing'
stop "no highlights" "no highlights" $'**New install:** ...\n\n### DLZ features\n- A thing'
stop "highlights only under a heading" "no highlights" $'### DLZ features\n- A thing'
stop "longer than 2000 characters" "longer than Discord takes" "- $(printf 'x%.0s' $(seq 2000))"

[ $fail = 0 ] && echo "ALL OK" || { echo "FAILED"; exit 1; }
