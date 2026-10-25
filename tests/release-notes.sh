#!/bin/bash
# The notes of a GitHub release (install/release/release-notes.sh, run by .github/workflows/release.yml):
# the highlights for Discord, grouped and in order, prefixes off, issue numbers, the GPL note with links at the tag, and the stops
# (no version tag, VERSION another one, no or an empty section, a bullet without a known prefix).
# Offline, in a temporary folder; CI runs it.
set -u
REPO=$(cd "$(dirname "$0")/.." && pwd)
T=$(mktemp -d)
trap 'rm -rf "$T"' EXIT
mkdir -p "$T/install/release"
cp "$REPO/install/release/release-notes.sh" "$T/install/release/"
S=$T/install/release/release-notes.sh
fail=0
ok() { printf 'ok    %s\n' "$1"; }
bad() { printf 'WRONG %s\n' "$1"; fail=1; }

printf 'v0.3.0\r\n' > "$T/VERSION"
printf '%s\r\n' '# Changelog' '' '## v0.3.0' '' \
  '- (DLZ BUG) The mixer sometimes gets stuck while starting' \
  '- (MOD BUG) The main output meter ignores the "Both" meter setting' \
  '- (DLZ FEATURE) A new thing' \
  '- (MOD FEATURE) Each start leaves a clear log' \
  '' '## v0.2.0' '' '- (MOD BUG) An old one' > "$T/CHANGELOG.md"
printf '%s\n' '# Readme' '' '## Legal' '' 'Our own code is GPL-3.0.' '' \
  'The installer image carries two GPL-2.0 programs: U-Boot (changed by' \
  '[`install/release/uboot-safe.py`](install/release/uboot-safe.py)) and busybox,' \
  '[u-boot](https://snapshot.debian.org/package/u-boot/x/).' '' 'Dumps stay private.' '' '## More' > "$T/README.md"
printf '140\t(DLZ BUG) The mixer sometimes gets stuck while starting\r\n134\t(MOD BUG) The main output meter ignores the "Both" meter setting\n' > "$T/issues.txt"

out=$(bash "$S" v0.3.0 "$T/issues.txt" 2> "$T/err") && ok "a good section: exit 0" || bad "a good section: exit 0 ($(cat "$T/err"))"
heads=$(printf '%s\n' "$out" | grep '^### ' | tr '\n' '|')
[ "$heads" = "### DLZ features|### DLZ bugs fixed|### Mod features|### Mod bugs fixed|### Check your download|### Source code of the installer's GPL parts|" ] \
  && ok "sections in order, the GPL note last" || bad "sections in order ($heads)"
printf '%s\n' "$out" | grep -qx -- '- The mixer sometimes gets stuck while starting (#140)' && ok "prefix off, issue number on" || bad "prefix off, issue number on"
printf '%s\n' "$out" | grep -qx -- '- The main output meter ignores the "Both" meter setting (#134)' && ok "a title with quotes keeps its number" || bad "a title with quotes keeps its number"
printf '%s\n' "$out" | grep -qx -- '- A new thing' && ok "no number when the list has no such title" || bad "no number when the list has no such title"
grep -q 'no issue with this exact title: (DLZ FEATURE) A new thing' "$T/err" && ok "... and says so" || bad "... and says so"
printf '%s\n' "$out" | grep -q 'An old one' && bad "only the tag's section" || ok "only the tag's section"
printf '%s\n' "$out" | grep -q '](https://github.com/Oulsen/DLZ-Creator-Modded/blob/v0.3.0/install/release/uboot-safe.py)' \
  && ok "the GPL note's own link points at the tag" || bad "the GPL note's own link points at the tag"
printf '%s\n' "$out" | grep -q '](https://snapshot.debian.org/package/u-boot/x/)' && ok "outside links stay" || bad "outside links stay"
printf '%s\n' "$out" | grep -q 'Dumps stay private\|GPL-3.0' && bad "only the GPL paragraph" || ok "only the GPL paragraph"
printf '%s\n' "$out" | head -n 1 | grep -q '^\*\*Before publishing, replace this line' && ok "starts with the line to replace" || bad "starts with the line to replace"
hl=$(printf '%s\n' "$out" | sed -n '2,/^### /p' | grep '^- ' | tr '\n' '|')
[ "$hl" = '- A new thing|- Fixed: the mixer sometimes gets stuck while starting|- Fixed: the main output meter ignores the "Both" meter setting|' ] \
  && ok "highlights: DLZ features, then fixes (no mod features, no numbers)" || bad "highlights ($hl)"
grep -q $'\r' <<< "$out" && bad "no CR in the notes" || ok "no CR in the notes"
bash "$S" v0.3.0 > /dev/null 2> "$T/err" && ! [ -s "$T/err" ] && ok "without an issue list: no numbers, no warnings" || bad "without an issue list"
GITHUB_REPOSITORY=someone/fork bash "$S" v0.3.0-test2 2>/dev/null | grep -q 'someone/fork/blob/v0.3.0-test2/install' \
  && ok "a test tag: the section of v0.3.0, links at the test tag and the repo it runs in" || bad "a test tag"

stop() {   # stop <description> <expected text in stderr> <tag>
  if bash "$S" "$3" > /dev/null 2> "$T/err"; then bad "$1: exit 0"
  elif grep -q -- "$2" "$T/err"; then ok "$1"
  else bad "$1 (said: $(cat "$T/err"))"; fi
}
stop "no version tag" "no version tag" v0.3
stop "a tag with another suffix" "no version tag" v0.3.0-rc1
stop "VERSION is another version" "VERSION is v0.3.0, the tag is v0.4.0" v0.4.0
printf 'v0.4.0\n' > "$T/VERSION"
stop "no section for the tag" "no ## v0.4.0 section" v0.4.0
printf '%s\n' '## v0.4.0' '' '## v0.3.0' '- (MOD BUG) x' > "$T/CHANGELOG.md"
stop "an empty section" "section of CHANGELOG.md is empty" v0.4.0
printf '%s\n' '## v0.4.0' '- (DEV) Our own tool' '- (MOD BUG) x' > "$T/CHANGELOG.md"
stop "a bullet without a DLZ/MOD prefix" "no DLZ/MOD FEATURE/BUG prefix" v0.4.0
printf '%s\n' '## v0.4.0' 'Some text' > "$T/CHANGELOG.md"
stop "a line that is no bullet" "not a changelog bullet" v0.4.0
printf '%s\n' '## v0.4.0' '- (MOD BUG) x' > "$T/CHANGELOG.md"
printf '%s\n' '# Readme' '## Legal' 'GPL-3.0 only.' > "$T/README.md"
stop "no GPL paragraph in the README" "no paragraph" v0.4.0

# the real files: the current VERSION's section must give notes (an empty section right after the bump
# is fine: the release PR fills it)
v=$(tr -d '\r\n' < "$REPO/VERSION")
if (cd "$REPO" && bash install/release/release-notes.sh "$v" > /dev/null 2> "$T/err"); then ok "the repo's own $v notes"
elif grep -q "is empty" "$T/err"; then ok "the repo's own $v section is still empty (right after the bump)"
else bad "the repo's own $v notes ($(cat "$T/err"))"; fi

[ $fail = 0 ] && echo "ALL OK" || { echo "FAILED"; exit 1; }
