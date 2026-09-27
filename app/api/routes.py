"""API v1 routes: JSON endpoints plus HTMX partials used by the dashboard."""

from __future__ import annotations

from typing import Annotated

import httpx
from fastapi import APIRouter, Depends, Form, HTTPException, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import HTMLResponse, Response
from pydantic import ValidationError

from app.core.cache import DomainCache
from app.core.config import Settings, get_settings
from app.engine.dns_resolver import DNSResolver
from app.engine.scanner import build_result, scan_domain
from app.models.schemas import HealthResponse, ScanRequest, ScanResult
from app.reports.pdf import render_pdf

router = APIRouter()


def get_cache(request: Request) -> DomainCache:
    return request.app.state.cache


class Engine:
    """Bundle of shared, app-lifetime resources a scan needs."""

    def __init__(self, request: Request) -> None:
        state = request.app.state
        self.cache: DomainCache = state.cache
        self.resolver: DNSResolver = state.resolver
        self.http: httpx.AsyncClient = state.http
        self.settings: Settings = state.settings


CacheDep = Annotated[DomainCache, Depends(get_cache)]
EngineDep = Annotated[Engine, Depends(Engine)]


async def _scan_with_cache(req: ScanRequest, engine: Engine) -> ScanResult:
    # Custom selectors change the DKIM result, so don't serve a cached default scan for them.
    use_cache = not req.force_refresh and not req.dkim_selectors
    if use_cache and (hit := await engine.cache.get(req.domain)):
        cached = ScanResult.model_validate(hit)
        # Re-derive analysis so cached scans pick up rule changes made since they were stored.
        return build_result(cached.domain, cached.checks, scanned_at=cached.scanned_at, cached=True)
    result = await scan_domain(
        req.domain, engine.resolver, engine.http, engine.settings, dkim_selectors=req.dkim_selectors
    )
    await engine.cache.set(req.domain, result.model_dump(mode="json"))
    return result


# -- JSON API -----------------------------------------------------------------
@router.get("/health", response_model=HealthResponse)
async def health(settings: Annotated[Settings, Depends(get_settings)]) -> HealthResponse:
    return HealthResponse(app=settings.app_name, version=settings.version)


@router.post("/scan", response_model=ScanResult)
async def scan(req: ScanRequest, engine: EngineDep) -> ScanResult:
    return await _scan_with_cache(req, engine)


@router.get("/recent")
async def recent(cache: CacheDep, limit: int = 10) -> list[dict]:
    return await cache.recent(limit=min(max(limit, 1), 50))


# -- HTMX partials ------------------------------------------------------------
@router.post("/ui/scan", response_class=HTMLResponse, include_in_schema=False)
async def scan_partial(
    request: Request,
    engine: EngineDep,
    domain: Annotated[str, Form()],
    dkim_selectors: Annotated[str, Form()] = "",
    force_refresh: Annotated[bool, Form()] = False,
) -> HTMLResponse:
    templates = request.app.state.templates
    try:
        req = ScanRequest(domain=domain, dkim_selectors=dkim_selectors, force_refresh=force_refresh)
    except ValidationError as exc:
        message = "; ".join(str(e["msg"]).removeprefix("Value error, ") for e in exc.errors())
        return templates.TemplateResponse(request, "partials/error.html", {"message": message})
    result = await _scan_with_cache(req, engine)
    response = templates.TemplateResponse(request, "partials/scan_result.html", {"result": result})
    response.headers["HX-Trigger"] = "scan-complete"
    return response


@router.get("/ui/recent", response_class=HTMLResponse, include_in_schema=False)
async def recent_partial(request: Request, cache: CacheDep) -> HTMLResponse:
    items = await cache.recent(limit=8)
    return request.app.state.templates.TemplateResponse(
        request, "partials/recent.html", {"items": items}
    )


def _get_request(domain: str, dkim_selectors: str = "") -> ScanRequest:
    try:
        return ScanRequest(domain=domain, dkim_selectors=dkim_selectors)
    except ValidationError as exc:
        message = "; ".join(str(e["msg"]).removeprefix("Value error, ") for e in exc.errors())
        raise HTTPException(status_code=422, detail=message) from exc


def _attachment(result: ScanResult, ext: str) -> dict[str, str]:
    # Normalised domains are [a-z0-9.-] only, so they are safe in a header value.
    return {"Content-Disposition": f'attachment; filename="securemailscope-{result.domain}-{result.scanned_at:%Y%m%d}.{ext}"'}


@router.get("/scan/{domain}", response_model=ScanResult)
async def scan_get(domain: str, engine: EngineDep) -> ScanResult:
    return await _scan_with_cache(_get_request(domain), engine)


# -- Exports ------------------------------------------------------------------
@router.get("/scan/{domain}/json", response_class=Response, responses={200: {"content": {"application/json": {}}}})
async def export_json(domain: str, engine: EngineDep, dkim_selectors: str = "") -> Response:
    """Download the scan as a JSON file. Same body as ``GET /scan/{domain}``."""
    result = await _scan_with_cache(_get_request(domain, dkim_selectors), engine)
    return Response(result.model_dump_json(indent=2), media_type="application/json", headers=_attachment(result, "json"))


@router.get("/scan/{domain}/pdf", response_class=Response, responses={200: {"content": {"application/pdf": {}}}})
async def export_pdf(domain: str, engine: EngineDep, dkim_selectors: str = "") -> Response:
    """Download the scan as a formal PDF audit report."""
    result = await _scan_with_cache(_get_request(domain, dkim_selectors), engine)
    pdf = await run_in_threadpool(
        render_pdf, result, app_name=engine.settings.app_name, version=engine.settings.version
    )
    return Response(pdf, media_type="application/pdf", headers=_attachment(result, "pdf"))
