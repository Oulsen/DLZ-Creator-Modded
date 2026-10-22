#!/bin/bash
# The notes of a GitHub release, from CHANGELOG.md and the README (run by .github/workflows/release.yml
# on a version tag; by hand to look at them first):
#   - a line to replace before publishing: how to get it (a drop-in update or a full install)
#   - the tag's `## vX.Y.Z` section of CHANGELOG.md, grouped under the section headings without the
#     title prefixes ("DLZ features", "DLZ bugs fixed", "Mod features", "Mod bugs fixed"; empty ones
#     left out), each with its issue number when the issue list has its exact title
#   - how to check the download, and the GPL source note from the README's "Legal", links at the tag
# Stops when the tag is no version, VERSION is another one, or the section is missing or empty.
#
# Usage: release-notes.sh <tag> [issue list: lines "<number><TAB><title>"] > notes.md
# A test tag vX.Y.Z-testN reads the section and VERSION of vX.Y.Z.
set -euo pipefail

REPO=$(cd "$(dirname "$0")/../.." && pwd)
TAG=${1:?usage: release-notes.sh <tag> [issue list]}
ISSUES=${2:-/dev/null}
SLUG=${GITHUB_REPOSITORY:-Oulsen/DLZ-Creator-Modded}

die() { echo "release-notes: $*" >&2; exit 1; }
[[ $TAG =~ ^(v[0-9]\.[0-9]{1,2}\.[0-9]{1,2})(-test[0-9]+)?$ ]] || die "'$TAG' is no version tag (vX.Y.Z, or vX.Y.Z-testN for a try)"
VER=${BASH_REMATCH[1]}
[ "$(tr -d '\r\n' < "$REPO/VERSION")" = "$VER" ] || die "VERSION is $(tr -d '\r\n' < "$REPO/VERSION"), the tag is $TAG"

tr -d '\r' < "$REPO/CHANGELOG.md" | awk -v ver="$VER" -v issues="$ISSUES" '
  BEGIN {
    while ((getline l < issues) > 0) { sub(/\r$/, "", l); t = index(l, "\t"); if (t) num[substr(l, t + 1)] = substr(l, 1, t - 1) }
    split("DLZ FEATURE|DLZ BUG|MOD FEATURE|MOD BUG", pre, "|")
    split("DLZ features|DLZ bugs fixed|Mod features|Mod bugs fixed", head, "|")
  }
  /^## / { on = ($0 == "## " ver); if (on) seen = 1; next }
  !on || /^[ \t]*$/ { next }
  {
    if ($0 !~ /^- \(/) { print "release-notes: not a changelog bullet in " ver ": " $0 > "/dev/stderr"; bad = 1; next }
    for (i = 1; i <= 4; i++) if (index($0, "- (" pre[i] ") ") == 1) break
    if (i > 4) { print "release-notes: no DLZ/MOD FEATURE/BUG prefix in " ver ": " $0 > "/dev/stderr"; bad = 1; next }
    full = substr($0, 3); title = substr(full, length(pre[i]) + 4)
    if (issues != "/dev/null" && !(full in num)) print "release-notes: no issue with this exact title: " full > "/dev/stderr"
    item[i] = item[i] "- " title ((full in num) ? " (#" num[full] ")" : "") "\n"; n++
  }
  END {
    if (!seen) { print "release-notes: CHANGELOG.md has no ## " ver " section" > "/dev/stderr"; exit 1 }
    if (bad) exit 1
    if (!n) { print "release-notes: the ## " ver " section of CHANGELOG.md is empty" > "/dev/stderr"; exit 1 }
    print "**Before publishing, replace this line:** \"**Update from vX.Y.Z:** copy both update files ...\" (a drop-in from the previous release) or \"**New install:** download the installer image ...\" (a full install; copy your recordings off the card first); see the notes of v0.2.0."
    for (i = 1; i <= 4; i++) if (item[i] != "") printf "\n### %s\n%s", head[i], item[i]
  }'

# the README's paragraph on the installer's GPL programs, its relative links pointing at the tag
gpl=$(tr -d '\r' < "$REPO/README.md" | awk '/^## Legal/ { on = 1; next } on && /^## / { exit }
  on && /^The installer image carries/ { p = 1 } p && /^[ \t]*$/ { exit } p { printf "%s%s", (s++ ? " " : ""), $0 }')
[ -n "$gpl" ] || die "README.md: no paragraph \"The installer image carries ...\" under \"## Legal\""
gpl=$(printf '%s' "$gpl" | sed -E "s#\]\(([a-z][^):]*)\)#](https://github.com/$SLUG/blob/$TAG/\1)#g")

cat <<EOF

### Check your download
\`SHA256SUMS\` holds the checksums of all release files: \`sha256sum -c SHA256SUMS\` (Linux, Git Bash), or compare with \`certutil -hashfile <file> SHA256\` (Windows) or \`shasum -a 256 <file>\` (macOS).

### Source code of the installer's GPL parts
$gpl
EOF
