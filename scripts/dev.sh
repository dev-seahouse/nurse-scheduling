#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" &> /dev/null && pwd)"
START_BACKEND="$SCRIPT_DIR/start_backend.sh"
START_FRONTEND="$SCRIPT_DIR/start_frontend.sh"

BACKEND_PID=""
FRONTEND_PID=""

log() { printf '\033[1;36m[dev]\033[0m %s\n' "$*"; }

cleanup() {
  echo
  log "Stopping dev servers..."
  [ -n "$BACKEND_PID" ] && kill "$BACKEND_PID" 2>/dev/null || true
  [ -n "$FRONTEND_PID" ] && kill "$FRONTEND_PID" 2>/dev/null || true
  wait "$BACKEND_PID" "$FRONTEND_PID" 2>/dev/null || true
  log "Stopped."
}
trap cleanup EXIT INT TERM

if [ ! -x "$START_BACKEND" ]; then
  echo "Error: start_backend.sh not found at $START_BACKEND" >&2
  exit 1
fi
if [ ! -x "$START_FRONTEND" ]; then
  echo "Error: start_frontend.sh not found at $START_FRONTEND" >&2
  exit 1
fi

log "Starting backend  -> http://127.0.0.1:8000  (docs: /docs)"
"$START_BACKEND" &
BACKEND_PID=$!

log "Starting frontend -> http://127.0.0.1:3000"
"$START_FRONTEND" &
FRONTEND_PID=$!

echo
log "Both servers are starting. Press Ctrl+C to stop both."
echo

# Exit (and trigger cleanup) as soon as either server dies.
wait -n "$FRONTEND_PID" "$BACKEND_PID" 2>/dev/null || true
