"""Serve the built React app (frontend/dist) at /.

- Content-hashed files under /assets are cached for a year; everything else, including
  index.html, is revalidated on every load so a deploy is picked up immediately.
- Any other non-API path returns index.html, so client-side URLs such as /?domain=x work.
- /api/* never falls through to the app: an unknown API path is a JSON 404.
- Without a build (e.g. in development, where Vite serves the app on :5173), / explains how
  to get one instead of failing.
"""

from __future__ import annotations

from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse, HTMLResponse

from app.core.constants import API_PREFIX

IMMUTABLE = "public, max-age=31536000, immutable"
REVALIDATE = "no-cache"

NOT_BUILT = """<!doctype html><html lang="en"><meta charset="utf-8"><title>SecureMailScope</title>
<body style="background:#06080b;color:#e6ebf2;font:14px/1.6 ui-monospace,Menlo,monospace;padding:40px">
<p>The web app hasn't been built.</p>
<p>Development: <code>cd frontend &amp;&amp; npm run dev</code>, then open http://localhost:5173</p>
<p>Production: <code>cd frontend &amp;&amp; npm run build</code>, then reload this page.</p>
<p>The API is running: <a style="color:#33ff88" href="/docs">/docs</a></p></body></html>"""


def mount_frontend(app: FastAPI, dist: Path) -> None:
    dist = dist.resolve()
    index = dist / "index.html"

    def file_response(path: Path) -> FileResponse:
        cache = IMMUTABLE if path.parent.name == "assets" else REVALIDATE
        return FileResponse(path, headers={"cache-control": cache})

    @app.get("/{path:path}", include_in_schema=False)
    async def frontend(path: str):
        if path == API_PREFIX.strip("/") or path.startswith(API_PREFIX.lstrip("/") + "/"):
            raise HTTPException(status_code=404, detail="Not Found")
        if not index.is_file():
            return HTMLResponse(NOT_BUILT, status_code=503, headers={"cache-control": REVALIDATE})
        if path:
            candidate = (dist / path).resolve()
            # Only files inside dist/; anything else (including ../ tricks) gets the app shell.
            if candidate.is_file() and candidate.is_relative_to(dist):
                return file_response(candidate)
        return file_response(index)
