#!/usr/bin/env bash
# QuantumLedger: run from the repository root. Delegates to pqc-scanner/run_cyber_demo.sh
# (same flags: PORT=…, REBUILD=1, AR=1). Serves http://localhost:8002 by default.
set -euo pipefail
exec "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/pqc-scanner/run_cyber_demo.sh" "$@"
