#!/usr/bin/env bash
# One-command demo launcher for SecureMailScope.
#
#   scripts/demo.sh           set up (first run only) and start the dashboard on http://127.0.0.1:8000
#   scripts/demo.sh check     set up, then verify the demo works with no network, and exit
#
# Run it once while online: it creates .venv, installs Python and web dependencies and builds
# the React app. After that it starts with no internet connection at all, and the built-in
# demo domains (*.example) scan fully offline.
set -euo pipefail
cd "$(dirname "$0")/.."

PYTHON="${PYTHON:-python3}"
PORT="${PORT:-8000}"
DIST="frontend/dist/index.html"

say() { printf '\033[1m==>\033[0m %s\n' "$*"; }
die() { printf 'error: %s\n' "$*" >&2; exit 1; }

# 1. Python environment
if [ ! -x .venv/bin/python ]; then
  say "Creating .venv"
  "$PYTHON" -m venv .venv
fi
if ! .venv/bin/python -c "import fastapi, dns, reportlab, anthropic" 2>/dev/null; then
  say "Installing dependencies (needs internet once)"
  .venv/bin/pip install --quiet -r requirements.txt || die "pip install failed: run this once while online"
fi

# 2. The React app (built once; FastAPI serves frontend/dist at /)
command -v npm >/dev/null || die "Node.js 20.19+ is needed to build the web app: https://nodejs.org"
if [ ! -d frontend/node_modules ] || [ frontend/package-lock.json -nt frontend/node_modules ]; then
  say "Installing web app dependencies (needs internet once)"
  (cd frontend && npm ci --no-audit --no-fund) || die "npm ci failed: run this once while online"
fi
if [ ! -f "$DIST" ] || [ -n "$(find frontend/src frontend/index.html frontend/public frontend/vite.config.ts -newer "$DIST" -type f 2>/dev/null)" ]; then
  say "Building the web app"
  (cd frontend && npm run build >/dev/null) || die "web app build failed: run 'cd frontend && npm run build' to see why"
fi

# 3. Pre-flight: every demo domain scans with no network and lands on its intended grade
say "Checking the demo domains"
.venv/bin/python - <<'PY'
import asyncio, socket
from app.core.config import Settings
from app.demo import demo_domains, scan_demo

def no_network(*args, **kwargs):
    raise RuntimeError("demo scan tried to use the network")

socket.getaddrinfo = no_network          # prove the demo is offline-safe
socket.socket.connect = no_network

async def main():
    ok = True
    for domain, spec in demo_domains().items():
        r = await scan_demo(domain, Settings())
        good = r.score.grade.value == spec["grade"]
        ok &= good
        print(f"    {'ok ' if good else 'BAD'} {domain:24} {r.score.score:3}/100  grade {r.score.grade.value}  ({spec['title']})")
    raise SystemExit(0 if ok else 1)

asyncio.run(main())
PY

if [ "${1:-}" = "check" ]; then
  say "Ready. Start the demo with: scripts/demo.sh"
  exit 0
fi

say "Starting SecureMailScope on http://127.0.0.1:${PORT} (Ctrl+C to stop)"
exec .venv/bin/uvicorn app.main:app --host 127.0.0.1 --port "$PORT"
