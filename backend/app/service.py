"""One scan path for every route: demo lookup, cache, live scan, error mapping."""

from __future__ import annotations

from datetime import datetime

from fastapi import HTTPException

from app import demo, scanner
from app.cache import ScanCache
from app.collectors.dns_collect import DomainNotFound
from app.config import Settings, get_settings
from app.domain import InvalidDomain, normalize_domain, parse_selectors
from app.models import Observations, ScanReport

_settings = get_settings()
cache = ScanCache(_settings.cache_path, ttl=_settings.cache_ttl)


def parse_request(domain: str, selectors: list[str] | str | None) -> tuple[str, list[str]]:
    """Validate user input or raise a 422 with a readable message."""
    if isinstance(selectors, list):
        selectors = ",".join(selectors)
    try:
        return normalize_domain(domain), parse_selectors(selectors.replace(" ", ",") if selectors else None)
    except InvalidDomain as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


def _report_from_cache(hit: dict) -> ScanReport:
    # Re-analyse stored observations so cached scans reflect current scoring rules.
    return scanner.build_report(
        Observations.model_validate(hit["observations"]),
        mode="live",
        duration_ms=hit.get("duration_ms", 0),
        scanned_at=datetime.fromisoformat(hit["scanned_at"]),
        cached=True,
    )


async def scan(domain: str, selectors: list[str], *, refresh: bool, settings: Settings | None = None) -> ScanReport:
    """Scan `domain` (already normalised). Raises HTTPException for NXDOMAIN / timeouts."""
    settings = settings or _settings

    obs = demo.observations_for_domain(domain)
    if obs is not None:  # built-in .example scenarios touch no network
        return scanner.build_report(obs, mode="demo", duration_ms=0)

    if not refresh and not selectors and (hit := await cache.get(domain)):
        return _report_from_cache(hit)

    try:
        report = await scanner.run_scan(domain, selectors, settings)
    except DomainNotFound:
        raise HTTPException(status_code=404, detail=f"{domain} does not exist (NXDOMAIN)") from None
    except scanner.ScanTimeout as exc:
        raise HTTPException(status_code=504, detail=str(exc)) from None

    await cache.put(domain, {
        "observations": report.observations.model_dump(mode="json"),
        "scanned_at": report.scanned_at.isoformat(),
        "duration_ms": report.duration_ms,
    })
    return report


async def recent(limit: int) -> list[ScanReport]:
    return [_report_from_cache(row["payload"]) for row in await cache.recent(limit)]
