# Reading the mixer's programs

Mackie's own programs on the mixer (`faderlink`, `dspserver`, `glesgui` in `/usr/local/bin`) are
stripped 32-bit ARM C++: no source, no function names. Some questions are only answered in them
(which commands the Bluetooth module takes, how a knob picks its value, the fader table). This
folder sets up Ghidra (the decompiler) and REA, which lets Claude Code ask Ghidra directly:
search a string, follow who uses it, decompile that function, list its calls and data (#201).

Everything runs in WSL Ubuntu on the PC; nothing runs on the mixer. The programs and the Ghidra
project stay in `build/re/` (git-ignored): never commit them, never paste decompiled code into
notes or issues.

## Set up (once per PC)

Every PC needs WSL Ubuntu (`wsl --install -d Ubuntu`), about 2 GB of disk for the tools, and
these steps from the main checkout's root:

```bash
wsl -d Ubuntu -u root -e bash dev/re/setup.sh     # 1. JDK 21, Node 24, Ghidra 12.1.4, REA (a few minutes)
                                                  # 2. build/re/: analyse (a) or copy (b)
bash dev/re/register.sh                           # 3. Git Bash: REA for this repo only
```

Then restart Claude Code in the main checkout; `claude mcp get rea` says `Connected`.

Step 2 puts the three programs in `build/re/`, which is all REA needs: it imports and analyses a
program itself when Claude opens it (REA has no setting for an existing Ghidra project) and throws
that analysis away on close. That costs about a minute for faderlink at the start of each session,
and for dspserver as long as its analysis below. `analyze.sh` also builds a Ghidra project in
`build/re/ghidra/`, for Ghidra's own GUI and headless scripts:

- **(a) Analyse** (the first PC, a new dump or another firmware): needs the dump in
  `/root/dlz/orig.img` ([DEVELOPMENT.md](../../docs/DEVELOPMENT.md), "Getting started") and 16 GB
  of RAM in the PC (WSL gets half by default; below 12 GB `analyze.sh` uses fewer workers and takes
  longer). `wsl -d Ubuntu -u root -e bash dev/re/analyze.sh`, about 45 minutes with 2 workers:
  dspserver takes 41 (nearly all in the switch analysis), faderlink and glesgui under 2 each;
  the project is about 110 MB. `analyze.sh faderlink` redoes one program.
- **(b) Copy from a PC that has it:** copy that PC's `build\re\` folder (for REA the three programs
  are enough) into this checkout's `build\re\`. No dump needed. It is Mackie's code: a USB stick or
  your own network share, never git, a cloud folder or a chat.

- Versions are pinned in `setup.sh` (Ghidra 12.1.4 with JDK 21 is what REA's bridge is verified
  with; Ghidra 12.2 needs JDK 25). Ubuntu's own `nodejs` is too old for REA, so Node comes from
  NodeSource.
- `register.sh` uses Claude Code's local scope (this folder only) and not `rea setup`, which
  registers REA for every project and installs its own instructions next to CLAUDE.md. A worktree
  is another folder: run Claude Code from the main checkout for REA.
- The analysis runs with 2 decompiler workers and a 4 GB heap (1 and 3 GB below 12 GB). With 12
  workers WSL ran out of memory and stopped responding (`Wsl/Service/E_UNEXPECTED`;
  `wsl --shutdown` recovers it).

## Read a program

One session per question, as a time limit:

1. Try the cheap way first: a port-89 capture or a read over SSH shows what the program does.
2. Find an anchor: a log text, a key name, an imported function (`strings` on the copy in
   `build/re/`, or REA's string search).
3. Follow its references to the function that uses it, decompile that, and walk its callers and
   callees until the question is answered. With REA's tools in Claude Code:
   - `open_binary` with the program's absolute WSL path (`/mnt/d/.../build/re/faderlink`) and
     `provider_id: ghidra`
   - `search_strings` for the anchor → `xrefs` on its address → `resolve_containing_procedure` on
     each reference → `procedure_pseudo_code` on that function
   - `procedure_callers` / `procedure_callees` to walk on; `read_bytes` for short strings and
     tables the string search misses (a 2-byte `K.`, for example)
   - `close_binary` at the end. Names set with `set_address_name` are lost on close, so names and
     addresses go into the topic note (step 4).

   Q29 (how a knob turns its key into a value) took about 15 calls this way:
   [faderlink.md](../../notes/components/faderlink.md), "Knobs".
4. Write the fact into its topic note (`notes/components/*.md`), tagged **[static]**, with the
   program, the function's address and the anchor, so it can be found again from a clean dump.
   Describe what the code does; never paste it.
5. Check it on the mixer where you can; then it becomes **[device]**.

The decompiled C is Ghidra's reconstruction: names are ours, types are guesses. A finding is only
as good as the check in step 5.

## Never

- Send the GD32 or the Bluetooth module a command that is not fully understood. Both have their
  own flash, and their protocols most likely have update commands. Only replay what stock itself
  sends, with our own values.
- Analyse in place on the dump mount, or write to it (`analyze.sh` copies first).
- Patch a program beyond the smallest change, on its stock hash, on the card's copy only, with a
  device review at the sensitive-path tier at least (like #188).
