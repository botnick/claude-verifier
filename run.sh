#!/usr/bin/env bash
# Launcher for macOS / Linux
set -e
cd "$(dirname "$0")"

if ! command -v node >/dev/null 2>&1; then
  cat <<EOF
Node.js not found.
  macOS  →  brew install node     (or download from https://nodejs.org/)
  Linux  →  https://nodejs.org/en/download
EOF
  exit 1
fi

if [ ! -d node_modules ]; then
  echo "First-time setup — installing Electron (≈ 200 MB, one time)…"
  npm install
fi

exec npm start
