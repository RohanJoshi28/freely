#!/usr/bin/env bash
# Runs the frontend dev server and opens the "Freely Dev" shell app, which
# loads its UI from http://localhost:1420. Edit anything under src/ and the
# app hot-reloads; only src-tauri/ changes need a new GitHub build.
#
# Usage: scripts/dev-shell.sh [path/to/Freely Dev.app]
set -euo pipefail
cd "$(dirname "$0")/.."

APP="${1:-$HOME/coffee/build-dev/macos/Freely Dev.app}"
if [ ! -d "$APP" ]; then
  echo "Freely Dev.app not found at: $APP" >&2
  echo "Build it: gh workflow run build.yml -f variant=devshell, then download the artifact." >&2
  exit 1
fi

pkill -f "Freely Dev.app/Contents/MacOS" 2>/dev/null || true

if ! curl -sf -o /dev/null http://localhost:1420; then
  npx vite &
  VITE_PID=$!
  trap 'kill $VITE_PID 2>/dev/null || true' EXIT
  for _ in $(seq 1 60); do
    curl -sf -o /dev/null http://localhost:1420 && break
    sleep 0.5
  done
fi

open "$APP"
echo "Freely Dev is running against http://localhost:1420 — edit src/ and it reloads. Ctrl+C here stops the dev server."
wait
