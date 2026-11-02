#!/bin/bash
# Registers REA's MCP server with Claude Code for this repo only (#201): local scope, so other
# projects do not load it, no REA skill, nothing in the repo (no .mcp.json). The server runs in WSL
# Ubuntu with Ghidra; it imports and analyses a program itself when Claude opens it (it has no
# setting for an existing Ghidra project). Restart Claude Code afterwards.
# Not `rea setup`: that registers for every project and installs its own instructions.
#
# Usage (Git Bash, from the main checkout, not a worktree: local scope is per folder):
#   bash dev/re/register.sh            register (again: replaces the old entry)
#   bash dev/re/register.sh remove     unregister
set -euo pipefail
export MSYS_NO_PATHCONV=1
unset CLAUDE_CONFIG_DIR

REPO=$(cd "$(dirname "$0")/../.." && pwd)
cd "$REPO"
claude mcp remove --scope local rea >/dev/null 2>&1 || true
[ "${1:-}" = remove ] && { echo "register: removed"; exit 0; }

claude mcp add --scope local rea -- wsl.exe -d Ubuntu -u root -e env \
  GHIDRA_INSTALL_DIR=/opt/ghidra_12.1.4_PUBLIC JAVA_HOME=/usr/lib/jvm/java-21-openjdk-amd64 \
  REA_ANALYSIS_PROVIDER=ghidra rea mcp
claude mcp get rea | grep -E 'Scope|Status'
