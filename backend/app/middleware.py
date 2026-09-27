"""HTTP hardening for a public deployment: request IDs, a per-client API rate limit, a
request-body cap, security headers (including a Content Security Policy) and structured
access logs. Ported from the pre-3D app and adapted to the 3D frontend.
"""

from __future__ import annotations

import math
import re
import time
import uuid

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse, Response

from app import service
from app.logging_setup import get_logger

log = get_logger("http")

MAX_BODY_BYTES = 16 * 1024  # the only request body is a small JSON scan request
_REQUEST_ID = re.compile(r"^[A-Za-z0-9._-]{8,64}$")
# Liveness endpoints: never rate-limited and not access-logged (the UI and Docker poll them).
HEALTH_PATHS = {"/api/health", "/api/v1/health"}

# The app renders attacker-controlled DNS data (anyone can publish any TXT record), so its
# policy stays strict: same-origin scripts, styles and connections only, no eval, no inline
# script.
# font-src allows data: because Vite inlines very small font files.
APP_CSP = (
    "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; "
    "font-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; "
    "form-action 'self'; frame-ancestors 'none'"
)
# FastAPI's /docs and /redoc pages load their UI from jsDelivr and use an inline bootstrap script.
DOCS_CSP = (
    "default-src 'self'; script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; "
    "style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://fonts.googleapis.com; "
    "img-src 'self' data: https://fastapi.tiangolo.com https://cdn.redoc.ly; font-src 'self' https://fonts.gstatic.com; "
    "connect-src 'self'; worker-src 'self' blob:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'"
)
SECURITY_HEADERS = {
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY",
    "referrer-policy": "strict-origin-when-cross-origin",
    "cross-origin-opener-policy": "same-origin",
    "permissions-policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
}


def client_ip(request: Request) -> str:
    # Behind a reverse proxy, Uvicorn's --proxy-headers sets this from X-Forwarded-For, but only
    # for proxies listed in FORWARDED_ALLOW_IPS; otherwise it is the socket peer and can't be spoofed.
    return request.client.host if request.client else "unknown"


def install(app: FastAPI) -> None:
    @app.middleware("http")
    async def protect(request: Request, call_next) -> Response:
        started = time.perf_counter()
        incoming = request.headers.get("x-request-id", "")
        request_id = incoming if _REQUEST_ID.match(incoming) else uuid.uuid4().hex
        request.state.request_id = request_id
        ip = client_ip(request)
        path = request.url.path

        response: Response
        length = request.headers.get("content-length")
        if length and (not length.isdigit() or int(length) > MAX_BODY_BYTES):
            response = JSONResponse({"detail": "Request body too large."}, status_code=413)
        elif path.startswith("/api/") and path not in HEALTH_PATHS and (wait := service.protect.api.take(ip)):
            seconds = max(1, math.ceil(wait))
            response = JSONResponse(
                {"detail": f"Too many requests from your address. Try again in {seconds} seconds."},
                status_code=429,
                headers={"retry-after": str(seconds)},
            )
        else:
            response = await call_next(request)

        response.headers["x-request-id"] = request_id
        for name, value in SECURITY_HEADERS.items():
            response.headers.setdefault(name, value)
        docs = path in ("/docs", "/redoc") or path.startswith("/docs/")
        response.headers.setdefault("content-security-policy", DOCS_CSP if docs else APP_CSP)
        if request.url.scheme == "https":
            response.headers.setdefault("strict-transport-security", "max-age=31536000; includeSubDomains")

        if path not in HEALTH_PATHS:
            log.info(
                "request",
                extra={
                    "request_id": request_id,
                    "method": request.method,
                    "path": path,
                    "status": response.status_code,
                    "duration_ms": round((time.perf_counter() - started) * 1000, 1),
                    "client_ip": ip,
                },
            )
        return response
