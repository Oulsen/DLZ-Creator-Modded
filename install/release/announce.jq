# The Discord message of a published release (.github/workflows/announce.yml; tests/announce.sh).
# Input: `gh release view <tag> --json name,body,url`; env TAG. Output: the webhook's JSON.
# Stops (halt_error, exit 5) on notes that still hold release-notes.sh's first line, notes without
# highlights (the "- " lines before the first "### " heading) and a message over Discord's 2000
# characters. A highlight's trailing issue number " (#N)" is dropped.
((.body // "") | gsub("\r"; "")) as $body
| if ($body | contains("Before publishing, replace this line")) then
    "The notes still say \"Before publishing, replace this line\"" | halt_error
  else . end
| ($body | split("\n")) as $lines
| [$lines[:($lines | map(startswith("### ")) | index(true)) // ($lines | length)][]
   | select(startswith("- ")) | sub(" \\(#[0-9]+\\)$"; "")] as $hl
| if ($hl | length) == 0 then "The notes have no highlights (\"- \" lines before the first heading)" | halt_error else . end
| ([$body | capture("\\*\\*Update from (?<v>v[0-9]+\\.[0-9]+\\.[0-9]+)")][0].v) as $from
| ("@everyone DLZ Creator Modded " + (if (.name // "") == "" then env.TAG else .name end) + "!\n\n"
   + ($hl | join("\n")) + "\n\n"
   + (if $from then "Already on " + $from + ": drop the update files into DLZDATA/dlzmod-update and switch on. New install: write the installer image to a card. Both are explained in the README."
      else "New install only: copy your recordings off the card, then write the installer image to it. Explained in the README." end)
   + "\n" + .url) as $text
| if ($text | length) > 2000 then "The message is longer than Discord takes (2000 characters): shorten the highlights" | halt_error else . end
| {content: $text, allowed_mentions: {parse: ["everyone"]}}
