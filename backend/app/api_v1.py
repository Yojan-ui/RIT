"""Versioned JSON API (/api/v1): scans, exports (JSON/PDF), narrative, recent scans, demo domains."""

from __future__ import annotations

from collections import OrderedDict

from fastapi import APIRouter, Query, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import Response

from app import __version__, demo, service
from app.models import DemoDomain, HealthResponse, Narrative, RecentScan, ScanReport, ScanRequest
from app.middleware import client_ip
from app.narrative import generate_narrative, llm_enabled
from app.reports.pdf import render_pdf
from app.scanner import build_report

APP_NAME = "SecureMailScope"
router = APIRouter(prefix="/api/v1", tags=["v1"])


async def _scan(request: Request, domain: str, selectors: list[str] | str | None, refresh: bool = False) -> ScanReport:
    name, parsed = service.parse_request(domain, selectors)
    return await service.scan(name, parsed, refresh=refresh, client=client_ip(request))


def _attachment(report: ScanReport, ext: str) -> dict[str, str]:
    # Normalised domains are [a-z0-9.-] only, so they are safe in a header value.
    return {"Content-Disposition": f'attachment; filename="securemailscope-{report.domain}-{report.scanned_at:%Y%m%d}.{ext}"'}


@router.get("/health", response_model=HealthResponse)
async def health() -> HealthResponse:
    return HealthResponse(app=APP_NAME, version=__version__)


@router.get("/demo-domains", response_model=list[DemoDomain])
async def demo_domains() -> list[DemoDomain]:
    """Built-in .example domains that scan with no network access."""
    out = []
    for scenario in demo.list_scenarios():
        report = build_report(demo.observations_for(scenario.id), mode="demo", duration_ms=0)
        out.append(DemoDomain(domain=scenario.domain, title=scenario.title, grade=report.grade,
                              score=report.score, story=scenario.description))
    return out


@router.get("/recent", response_model=list[RecentScan])
async def recent(limit: int = Query(10, ge=1, le=50)) -> list[RecentScan]:
    """Domains with a cached live scan, newest first."""
    return [RecentScan(domain=r.domain, scanned_at=r.scanned_at, score=r.score, grade=r.grade)
            for r in await service.recent(limit)]


@router.post("/scan", response_model=ScanReport)
async def scan(req: ScanRequest, request: Request) -> ScanReport:
    return await _scan(request, req.domain, req.dkim_selectors, refresh=req.force_refresh)


@router.get("/scan/{domain}", response_model=ScanReport)
async def scan_get(request: Request, domain: str, dkim_selectors: str = "", refresh: bool = False) -> ScanReport:
    """Latest scan (cached for CACHE_TTL seconds unless refresh=true)."""
    return await _scan(request, domain, dkim_selectors, refresh)


NARRATIVE_CACHE_SIZE = 256
_narratives: OrderedDict[tuple, Narrative] = OrderedDict()


@router.get("/scan/{domain}/narrative", response_model=Narrative)
async def narrative(request: Request, domain: str) -> Narrative:
    """Plain-English summary, attack scenarios and remediation steps for the latest scan.

    Written by Claude when configured (and validated against the findings), otherwise by
    the rule-based writer. One narrative per scan: repeat requests don't spend Claude budget.
    """
    report = await _scan(request, domain, None)
    settings = service._settings
    scan_id = "demo" if report.mode == "demo" else report.scanned_at.isoformat()
    key = (report.domain, scan_id, settings.llm_model, llm_enabled(settings))
    if key in _narratives:
        _narratives.move_to_end(key)
        return _narratives[key]
    result = await generate_narrative(report, settings, budget=service.protect.llm_budget)
    _narratives[key] = result
    while len(_narratives) > NARRATIVE_CACHE_SIZE:
        _narratives.popitem(last=False)
    return result


@router.get("/scan/{domain}/json", response_class=Response,
            responses={200: {"content": {"application/json": {}}}})
async def export_json(request: Request, domain: str, dkim_selectors: str = "") -> Response:
    """Download the scan as a JSON file (same body as GET /scan/{domain})."""
    report = await _scan(request, domain, dkim_selectors)
    return Response(report.model_dump_json(indent=2), media_type="application/json",
                    headers=_attachment(report, "json"))


@router.get("/scan/{domain}/pdf", response_class=Response,
            responses={200: {"content": {"application/pdf": {}}}})
async def export_pdf(request: Request, domain: str, dkim_selectors: str = "") -> Response:
    """Download the scan as a formal PDF audit report."""
    report = await _scan(request, domain, dkim_selectors)
    pdf = await run_in_threadpool(render_pdf, report, app_name=APP_NAME, version=__version__)
    return Response(pdf, media_type="application/pdf", headers=_attachment(report, "pdf"))
