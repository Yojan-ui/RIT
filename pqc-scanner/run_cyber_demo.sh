#!/usr/bin/env bash
# PQC Scanner, Stark-HUD variant: same API and five-stage logic, "Jarvis diagnostics" UI.
# Runs alongside the standard demo (which uses :8000).
#
#   ./run_cyber_demo.sh              http://localhost:8002
#   PORT=8090 ./run_cyber_demo.sh    another port
#   REBUILD=1 ./run_cyber_demo.sh    force a fresh HUD build
set -euo pipefail
export UI=hud
export PORT="${PORT:-8002}"
export BANNER="STARK-HUD SCANNER ONLINE"
exec "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/run_demo.sh"
