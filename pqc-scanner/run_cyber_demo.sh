#!/usr/bin/env bash
# PQC Scanner, QuantumLedger HUD variant: same API and five-stage logic, holographic 3D storytelling UI.
# Runs alongside the standard demo (which uses :8000).
#
#   ./run_cyber_demo.sh              http://localhost:8002
#   PORT=8090 ./run_cyber_demo.sh    another port
#   REBUILD=1 ./run_cyber_demo.sh    force a fresh HUD build
#   AR=1 ./run_cyber_demo.sh         also serve https://<lan-ip>:8003 so a phone can scan the AR QR code
set -euo pipefail
export UI=hud
export PORT="${PORT:-8002}"
export BANNER="QUANTUMLEDGER HUD ONLINE"
exec "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/run_demo.sh"
