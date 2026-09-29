"""QuantumLedger launcher (browser mode).

Starts the FastAPI app, which serves both the API and the dashboard, then waits.
Open the printed URL in any browser. Binds to the loopback interface only.

    python main.py              # http://localhost:8000
    python main.py --port 8080  # another port
"""

from __future__ import annotations

import argparse
import socket
import sys

import uvicorn

HOST = "127.0.0.1"
DEFAULT_PORT = 8000


def port_free(port: int) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        try:
            s.bind((HOST, port))
            return True
        except OSError:
            return False


def main() -> int:
    parser = argparse.ArgumentParser(description="QuantumLedger: local API + dashboard")
    parser.add_argument("--port", type=int, default=DEFAULT_PORT)
    args = parser.parse_args()

    if not port_free(args.port):
        print(f"Port {args.port} is already in use. Stop the other process or run: python main.py --port <free port>", file=sys.stderr)
        return 1

    print(f"Server running at http://localhost:{args.port}", flush=True)
    uvicorn.run("app.main:app", host=HOST, port=args.port, log_level="warning")
    return 0


if __name__ == "__main__":
    sys.exit(main())
