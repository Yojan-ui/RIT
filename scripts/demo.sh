#!/usr/bin/env bash
# One-command demo launcher for SecureMailScope.
#
#   scripts/demo.sh           set up (first run only) and start the dashboard on http://127.0.0.1:8000
#   scripts/demo.sh check     set up, then verify the demo works with no network, and exit
#
# Run it once while online: it creates .venv, installs dependencies and builds the dashboard
# stylesheet. After that it starts with no internet connection at all, and the built-in
# demo domains (*.example) scan fully offline.
set -euo pipefail
cd "$(dirname "$0")/.."

PYTHON="${PYTHON:-python3}"
PORT="${PORT:-8000}"
CSS_OUT="app/static/css/tailwind.css"
TAILWIND_VERSION="$(sed -n 's/^ARG TAILWIND_VERSION=//p' Dockerfile)"
TAILWIND_BIN=".cache/tailwindcss-${TAILWIND_VERSION}"

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

# 2. Dashboard stylesheet (otherwise the dashboard compiles Tailwind from a CDN, which needs internet)
needs_build() {
  [ ! -f "$CSS_OUT" ] && return 0
  [ -n "$(find app/templates app/static/css/tailwind.src.css app/static/css/theme.css -newer "$CSS_OUT" -type f 2>/dev/null)" ]
}
if needs_build; then
  if [ ! -x "$TAILWIND_BIN" ]; then
    case "$(uname -s)-$(uname -m)" in
      Darwin-arm64) asset=macos-arm64 ;;
      Darwin-x86_64) asset=macos-x64 ;;
      Linux-x86_64) asset=linux-x64 ;;
      Linux-aarch64 | Linux-arm64) asset=linux-arm64 ;;
      *) die "no Tailwind binary for $(uname -s)-$(uname -m); build the Docker image instead" ;;
    esac
    say "Downloading Tailwind CLI ${TAILWIND_VERSION} (needs internet once)"
    mkdir -p .cache
    curl --retry 4 --retry-all-errors -fsSL -o "$TAILWIND_BIN.tmp" \
      "https://github.com/tailwindlabs/tailwindcss/releases/download/${TAILWIND_VERSION}/tailwindcss-${asset}" \
      || die "could not download the Tailwind CLI: run this once while online"
    chmod +x "$TAILWIND_BIN.tmp" && mv "$TAILWIND_BIN.tmp" "$TAILWIND_BIN"
  fi
  say "Building $CSS_OUT"
  "$TAILWIND_BIN" -i app/static/css/tailwind.src.css -o "$CSS_OUT" --minify 2>/dev/null
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
