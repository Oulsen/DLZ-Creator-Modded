#!/bin/bash
# Installs the tools to read the mixer's programs (#201) in WSL Ubuntu: OpenJDK 21, Node.js 24
# (NodeSource; Ubuntu's own is too old for REA), Ghidra 12.1.4 (sha256 checked) in /opt, and REA
# (rea-agents). Safe to run again: what is already there is kept. Nothing here touches the dump.
#
# Usage (repo root): wsl -d Ubuntu -u root -e bash dev/re/setup.sh
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive

GHIDRA_VER=12.1.4
GHIDRA_ZIP=ghidra_12.1.4_PUBLIC_20260921.zip
GHIDRA_SHA=ddac49f903da9d5bac833e5cc79395098b9c33cfd3279be5f31bd00387d2d4db
GHIDRA_DIR=/opt/ghidra_${GHIDRA_VER}_PUBLIC
REA_VER=6.8.0

[ "$(id -u)" = 0 ] || { echo "setup: run as root (wsl -u root)" >&2; exit 1; }

echo "== JDK 21, procps, unzip"
apt-get update -q
apt-get install -y -q ca-certificates curl gnupg unzip procps openjdk-21-jdk

echo "== Node.js 24 (NodeSource)"
if ! node -v 2>/dev/null | grep -q '^v24\.'; then
  install -d -m 0755 /etc/apt/keyrings
  curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key \
    | gpg --dearmor --yes -o /etc/apt/keyrings/nodesource.gpg
  echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_24.x nodistro main" \
    > /etc/apt/sources.list.d/nodesource.list
  printf 'Package: nodejs\nPin: origin deb.nodesource.com\nPin-Priority: 600\n' > /etc/apt/preferences.d/nodesource
  apt-get update -q
  apt-get install -y -q nodejs
fi
node -v

echo "== Ghidra $GHIDRA_VER"
if [ ! -x "$GHIDRA_DIR/support/analyzeHeadless" ]; then
  zip=/opt/$GHIDRA_ZIP
  curl -fL --retry 3 -o "$zip" \
    "https://github.com/NationalSecurityAgency/ghidra/releases/download/Ghidra_${GHIDRA_VER}_build/$GHIDRA_ZIP"
  echo "$GHIDRA_SHA  $zip" | sha256sum -c -
  unzip -q "$zip" -d /opt
  rm -f "$zip"
fi
grep '^application.version' "$GHIDRA_DIR/Ghidra/application.properties"

echo "== REA $REA_VER"
if [ "$(rea --version 2>/dev/null)" != "$REA_VER" ]; then
  npm install --global --no-fund --no-audit "rea-agents@$REA_VER"
fi
rea --version

echo "== REA's check (Hopper and IDA may fail: not used)"
GHIDRA_INSTALL_DIR=$GHIDRA_DIR JAVA_HOME=/usr/lib/jvm/java-21-openjdk-amd64 rea doctor --json \
  | grep -o '"name":"ghidra[a-z_-]*","ok":[a-z]*' || true
echo "== done"
