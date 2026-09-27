"""SecureMailScope API."""

from __future__ import annotations

import asyncio
import time

import logging

from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app import demo
from app.collectors.dns_collect import DomainNotFound
from app.config import get_settings
from app.domain import InvalidDomain, normalize_domain, parse_selectors
from app.frontend import FrontendFiles
from app.models import DemoScenario, ScanReport
from app.scanner import ScanTimeout, build_report, run_scan

log = logging.getLogger("securemailscope")

settings = get_settings()

app = FastAPI(
    title="SecureMailScope API",
    version="0.1.0",
    description="Email-security posture scanner: SPF, DKIM, DMARC, MTA-STS, TLS-RPT, MX and a live STARTTLS probe.",
)
app.add_middleware(CORSMiddleware, allow_origins=settings.cors_origins, allow_methods=["GET"], allow_headers=["*"])


@app.exception_handler(Exception)
async def unhandled_error(request: Request, exc: Exception) -> JSONResponse:
    # Keep every error JSON-shaped ({"detail": ...}) so the UI can always render it.
    log.exception("Unhandled error on %s", request.url.path)
    return JSONResponse(status_code=500, content={"detail": "Internal error while processing the request"})


@app.get("/api/health")
async def health() -> dict[str, str]:
    return {"status": "ok", "version": app.version}


@app.get("/api/scan", response_model=ScanReport)
async def scan(
    domain: str = Query(..., max_length=300, description="Domain, URL or email address to scan"),
    dkim_selectors: str | None = Query(None, description="Comma-separated extra DKIM selectors to try"),
) -> ScanReport:
    try:
        normalized = normalize_domain(domain)
        selectors = parse_selectors(dkim_selectors)
    except InvalidDomain as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    try:
        return await run_scan(normalized, selectors, settings)
    except DomainNotFound:
        raise HTTPException(status_code=404, detail=f"{normalized} does not exist (NXDOMAIN)") from None
    except ScanTimeout as exc:
        raise HTTPException(status_code=504, detail=str(exc)) from None


# ---- Dummy endpoints for UI development (no network access) ---------------- #


@app.get("/api/demo", response_model=list[DemoScenario])
async def demo_scenarios() -> list[DemoScenario]:
    return demo.list_scenarios()


@app.get("/api/demo/{scenario_id}", response_model=ScanReport)
async def demo_scan(
    scenario_id: str,
    delay_ms: int = Query(0, ge=0, le=15000, description="Artificial latency, to exercise loading states"),
) -> ScanReport:
    started = time.monotonic()
    obs = demo.observations_for(scenario_id)
    if obs is None:
        known = ", ".join(s.id for s in demo.list_scenarios())
        raise HTTPException(status_code=404, detail=f"Unknown scenario '{scenario_id}'. Try one of: {known}")
    if delay_ms:
        await asyncio.sleep(delay_ms / 1000)
    return build_report(obs, mode="demo", duration_ms=int((time.monotonic() - started) * 1000))


@app.get("/api/demo-error/{status_code}")
async def demo_error(status_code: int) -> None:
    """Force an error response so the UI's error states can be built."""
    messages = {404: "nonexistent.example does not exist (NXDOMAIN)", 422: "'not a domain' is not a valid domain name",
                500: "Internal server error", 504: "Scan timed out"}
    if status_code not in messages:
        raise HTTPException(status_code=400, detail=f"Supported codes: {sorted(messages)}")
    raise HTTPException(status_code=status_code, detail=messages[status_code])


# ---- Compiled frontend at "/" (registered last so /api/* and /docs win) ---- #

frontend = FrontendFiles(settings.static_dir)


@app.get("/api/{path:path}", include_in_schema=False)
async def unknown_api_route(path: str) -> None:
    # Without this, a typo'd API path would fall through to the SPA shell.
    raise HTTPException(status_code=404, detail=f"Unknown API route: /api/{path}")


@app.get("/{path:path}", include_in_schema=False)
async def serve_frontend(path: str):
    return frontend.response(path)
