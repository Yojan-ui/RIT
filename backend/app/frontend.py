"""Serve the compiled Vite frontend at "/" and build it on demand.

Vite is configured (frontend/vite.config.ts) to emit straight into
backend/static, so the build and the server agree on one folder:

    python -m app.frontend build     # npm ci (if needed) + npm run build
"""

from __future__ import annotations

import shutil
import subprocess
import sys
from pathlib import Path

from fastapi import HTTPException
from fastapi.responses import FileResponse, HTMLResponse

BACKEND_DIR = Path(__file__).resolve().parent.parent
FRONTEND_DIR = BACKEND_DIR.parent / "frontend"

# Vite content-hashes everything under assets/, so it can be cached forever;
# index.html must always be revalidated so new deploys are picked up.
_IMMUTABLE = {"Cache-Control": "public, max-age=31536000, immutable"}
_REVALIDATE = {"Cache-Control": "no-cache"}

_NOT_BUILT = """<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>SecureMailScope</title>
<style>body{background:#050505;color:#94a3b8;font:14px ui-monospace,monospace;padding:3rem}
code{color:#10b981}a{color:#e2e8f0}</style></head>
<body><h1 style="color:#e2e8f0;font-size:16px">SecureMailScope API is running</h1>
<p>The frontend has not been built yet. Run <code>python -m app.frontend build</code>
from <code>backend/</code>, or use the Docker image.</p>
<p><a href="/docs">API docs</a> &middot; <a href="/api/demo">Demo scenarios</a></p></body></html>"""


class FrontendFiles:
    def __init__(self, root: Path) -> None:
        self.root = root

    def response(self, path: str):
        root = self.root.resolve()
        index = root / "index.html"
        if not index.is_file():
            return HTMLResponse(_NOT_BUILT, status_code=503)

        if path:
            candidate = (root / path).resolve()
            if not candidate.is_relative_to(root):  # ../ traversal
                raise HTTPException(status_code=404)
            if candidate.is_file():
                headers = _IMMUTABLE if candidate.parent == root / "assets" else _REVALIDATE
                return FileResponse(candidate, headers=headers)
            if "." in Path(path).name:
                # Looks like a file (e.g. a stale hashed asset), not a client route.
                raise HTTPException(status_code=404)

        # Unknown extension-less paths fall back to the SPA shell.
        return FileResponse(index, headers=_REVALIDATE)


def _run(cmd: list[str]) -> None:
    print(f"$ {' '.join(cmd)}  (in {FRONTEND_DIR})", flush=True)
    subprocess.run(cmd, cwd=FRONTEND_DIR, check=True)


def build() -> int:
    npm = shutil.which("npm")
    if npm is None:
        print("npm not found on PATH; install Node.js 20+ to build the frontend.", file=sys.stderr)
        return 1
    if not (FRONTEND_DIR / "package.json").is_file():
        print(f"No frontend found at {FRONTEND_DIR}", file=sys.stderr)
        return 1
    try:
        if not (FRONTEND_DIR / "node_modules").is_dir():
            _run([npm, "ci"])
        _run([npm, "run", "build"])
    except subprocess.CalledProcessError as exc:
        return exc.returncode or 1
    print(f"Frontend built into {BACKEND_DIR / 'static'}")
    return 0


if __name__ == "__main__":
    if sys.argv[1:] != ["build"]:
        print("usage: python -m app.frontend build", file=sys.stderr)
        sys.exit(2)
    sys.exit(build())
