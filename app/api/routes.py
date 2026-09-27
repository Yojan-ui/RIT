"""API v1 routes (JSON). The React app in frontend/ is the only UI and uses these endpoints."""

from __future__ import annotations

from collections import OrderedDict
from datetime import datetime, timezone
from typing import Annotated

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import Response
from pydantic import ValidationError

from app.core.cache import DomainCache
from app.core.config import Settings, get_settings
from app.engine.dns_resolver import DNSResolver
from app.demo import demo_domains, is_demo, scan_demo
from app.engine.scanner import build_result, scan_domain
from app.models.schemas import DemoDomain, HealthResponse, Narrative, RecentScan, ScanRequest, ScanResult
from app.narrative import generate_narrative, llm_enabled
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
    if is_demo(req.domain):
        result = await scan_demo(req.domain, engine.settings, dkim_selectors=req.dkim_selectors)
    else:
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


@router.get("/demo-domains", response_model=list[DemoDomain])
async def list_demo_domains() -> list[DemoDomain]:
    """Built-in .example domains that scan with no network, one per grade."""
    return [DemoDomain(domain=d, title=s["title"], grade=s["grade"], story=s["story"]) for d, s in demo_domains().items()]


@router.get("/recent", response_model=list[RecentScan])
async def recent(cache: CacheDep, limit: int = 10) -> list[RecentScan]:
    """Domains with a cached scan, newest first."""
    rows = await cache.recent(limit=min(max(limit, 1), 50))
    return [RecentScan(domain=r["domain"], scanned_at=datetime.fromtimestamp(r["created_at"], timezone.utc)) for r in rows]


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


# -- Narrative ----------------------------------------------------------------
NARRATIVE_CACHE_SIZE = 256


async def _narrative_for(domain: str, engine: Engine, request: Request) -> Narrative:
    result = await _scan_with_cache(_get_request(domain), engine)
    cache: OrderedDict = request.app.state.narratives
    # One narrative per scan: a re-scan (new scanned_at) or a config change gets a fresh one.
    key = (result.domain, result.scanned_at.isoformat(), engine.settings.llm_model, llm_enabled(engine.settings))
    if key in cache:
        cache.move_to_end(key)
        return cache[key]
    narrative = await generate_narrative(result, engine.settings)
    cache[key] = narrative
    while len(cache) > NARRATIVE_CACHE_SIZE:
        cache.popitem(last=False)
    return narrative


@router.get("/scan/{domain}/narrative", response_model=Narrative)
async def narrative(domain: str, engine: EngineDep, request: Request) -> Narrative:
    """Plain-English summary, attack scenarios and remediation steps for the latest scan."""
    return await _narrative_for(domain, engine, request)


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
