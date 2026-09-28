"""QuantumLedger desktop launcher.

Starts the FastAPI server on 127.0.0.1 in a background daemon thread, then
opens a native window (pywebview) pointed at it. Closing the window exits the
process, and the daemon thread with it. Nothing listens on a public interface.

    python main.py                 # desktop app
    python main.py --server-only   # API + dashboard in your browser (http://127.0.0.1:8742)
"""

from __future__ import annotations

import argparse
import socket
import sys
import threading
import time
import urllib.request

import uvicorn

HOST = "127.0.0.1"
DEFAULT_PORT = 8742


def pick_port(preferred: int) -> int:
    """Use the preferred port if free, otherwise let the OS choose one."""
    for port in (preferred, 0):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            try:
                s.bind((HOST, port))
                return s.getsockname()[1]
            except OSError:
                continue
    raise RuntimeError("No free local port")


def start_server(port: int) -> uvicorn.Server:
    config = uvicorn.Config("app.main:app", host=HOST, port=port, log_level="warning")
    server = uvicorn.Server(config)
    threading.Thread(target=server.run, name="quantumledger-api", daemon=True).start()
    return server


def wait_until_ready(url: str, timeout: float = 15.0) -> None:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        try:
            with urllib.request.urlopen(f"{url}/health", timeout=1) as r:
                if r.status == 200:
                    return
        except OSError:
            time.sleep(0.1)
    raise RuntimeError(f"API did not start at {url}")


def main() -> int:
    parser = argparse.ArgumentParser(description="QuantumLedger desktop prototype")
    parser.add_argument("--port", type=int, default=DEFAULT_PORT)
    parser.add_argument("--server-only", action="store_true", help="run the local API without opening a window")
    args = parser.parse_args()

    port = pick_port(args.port)
    url = f"http://{HOST}:{port}"

    if args.server_only:
        print(f"QuantumLedger API on {url}  (docs: {url}/docs)")
        uvicorn.run("app.main:app", host=HOST, port=port, log_level="info")
        return 0

    server = start_server(port)
    wait_until_ready(url)

    import webview  # imported late so --server-only works without a GUI toolkit

    webview.create_window(
        "QuantumLedger · Team High Cortisol",
        url,
        width=1440,
        height=900,
        min_size=(1024, 680),
        background_color="#0b0f17",
    )
    webview.start()  # blocks until the window is closed
    server.should_exit = True
    return 0


if __name__ == "__main__":
    sys.exit(main())
