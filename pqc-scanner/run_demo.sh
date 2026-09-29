#!/usr/bin/env bash
# PQC Scanner: one-command local demo.
# Installs backend requirements, builds the frontend if needed, and serves everything
# (React app + API) from a single FastAPI/Uvicorn process.
#
#   ./run_demo.sh              http://localhost:8000
#   PORT=8080 ./run_demo.sh    another port
#   REBUILD=1 ./run_demo.sh    force a fresh frontend build
#   UI=hud ./run_demo.sh       QuantumLedger HUD variant (see run_cyber_demo.sh)
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND="$ROOT/backend"
FRONTEND="$ROOT/frontend"
PORT="${PORT:-8000}"
PYTHON="${PYTHON:-python3}"
UI="${UI:-default}"                      # default | hud
BANNER="${BANNER:-SYSTEM LIVE}"
if [ "$UI" = "hud" ]; then
  DIST="$FRONTEND/dist-hud"; BUILD_SCRIPT="build:hud"
else
  DIST="$FRONTEND/dist"; BUILD_SCRIPT="build"
fi

say() { printf '\033[1m==>\033[0m %s\n' "$*"; }
die() { printf '\033[31merror:\033[0m %s\n' "$*" >&2; exit 1; }

# ── Prerequisites ───────────────────────────────────────────────────────────
command -v "$PYTHON" >/dev/null || die "Python 3.10+ is required ($PYTHON not found)."
"$PYTHON" -c 'import sys; sys.exit(sys.version_info < (3, 10))' || die "Python 3.10+ is required (found $("$PYTHON" --version))."

# ── Backend ─────────────────────────────────────────────────────────────────
if [ ! -x "$BACKEND/.venv/bin/python" ]; then
  say "Creating Python virtual environment"
  "$PYTHON" -m venv "$BACKEND/.venv"
fi
say "Installing backend requirements"
"$BACKEND/.venv/bin/python" -m pip install --quiet --disable-pip-version-check -r "$BACKEND/requirements.txt"

# ── Frontend ────────────────────────────────────────────────────────────────
needs_build=0
if [ "${REBUILD:-0}" = "1" ] || [ ! -f "$DIST/index.html" ]; then
  needs_build=1
elif [ -n "$(find "$FRONTEND/src" "$FRONTEND/index.html" "$FRONTEND/package.json" "$FRONTEND/vite.config.ts" -newer "$DIST/index.html" -print -quit 2>/dev/null)" ]; then
  needs_build=1
fi

if [ "$needs_build" = "1" ]; then
  command -v npm >/dev/null || die "Node.js 20+ and npm are required to build the frontend."
  if [ ! -d "$FRONTEND/node_modules" ]; then
    say "Installing frontend dependencies"
    (cd "$FRONTEND" && npm ci --no-audit --no-fund --loglevel=error)
  fi
  say "Building frontend ($UI)"
  (cd "$FRONTEND" && npm run "$BUILD_SCRIPT" --silent) || die "Frontend build failed."
else
  say "Frontend build is up to date"
fi

# ── Port check ──────────────────────────────────────────────────────────────
# SO_REUSEADDR (as uvicorn uses) so lingering TIME_WAIT sockets from a previous run don't count as busy.
if ! "$BACKEND/.venv/bin/python" -c "import socket; s=socket.socket(); s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1); s.bind(('127.0.0.1', $PORT)); s.listen()" 2>/dev/null; then
  die "Port $PORT is already in use. Stop the other process or run with PORT=<free port>."
fi

# ── Start ───────────────────────────────────────────────────────────────────
URL="http://localhost:$PORT"
say "Starting server on $URL (Ctrl+C to stop)"

# Announce once the API answers; the server itself runs in the foreground.
(
  for _ in $(seq 1 120); do
    if curl -sf "$URL/api/health" >/dev/null 2>&1; then
      printf '\n\033[1;32m  %s: Open %s in your browser\033[0m\n\n' "$BANNER" "$URL"
      exit 0
    fi
    sleep 0.25
  done
  printf '\033[31mServer did not respond on %s within 30 s.\033[0m\n' "$URL" >&2
) &

cd "$BACKEND"
export FRONTEND_DIST="$DIST"
exec "$BACKEND/.venv/bin/python" -m uvicorn app.main:app --host 127.0.0.1 --port "$PORT" --log-level warning
