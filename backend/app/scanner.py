"""Live scan orchestration: collect Observations concurrently, then analyze."""

from __future__ import annotations

import asyncio
import time
from datetime import datetime, timezone

from app.analysis.scoring import analyze
from app.collectors.dns_collect import DnsClient, collect_dkim, collect_mx, collect_spf, collect_txt
from app.collectors.mta_sts_fetch import PolicyFetchError, fetch_policy
from app.collectors.netguard import is_public_ip
from app.collectors.smtp_probe import probe_starttls
from app.analysis.parsers import has_version
from app.config import Settings
from app.models import MtaStsLookup, MxLookup, Observations, ScanReport, StartTlsProbe

_MAX_PROBE_HOSTS = 2


async def _collect_mta_sts(client: DnsClient, domain: str, settings: Settings) -> MtaStsLookup:
    txt = await collect_txt(client, f"_mta-sts.{domain}")
    result = MtaStsLookup(txt=txt)
    if any(has_version(r, "STSv1") for r in txt.records):
        try:
            result.policy = await asyncio.to_thread(
                fetch_policy, domain, timeout=settings.http_timeout, allow_private=settings.allow_private_targets)
        except PolicyFetchError as exc:
            result.policy_error = str(exc)
    return result


class ScanTimeout(Exception):
    pass


async def _collect_starttls(mx: MxLookup, settings: Settings) -> StartTlsProbe | None:
    """Probe within `probe_budget`; on overrun, report the vector as unmeasured."""
    if mx.null_mx or not mx.hosts:
        return None
    try:
        return await asyncio.wait_for(_probe_mx_hosts(mx, settings), timeout=settings.probe_budget)
    except TimeoutError:
        return StartTlsProbe(host=mx.hosts[0].host,
                             error=f"STARTTLS probe exceeded its {settings.probe_budget:.0f}s budget")


async def _probe_mx_hosts(mx: MxLookup, settings: Settings) -> StartTlsProbe | None:
    last: StartTlsProbe | None = None
    for host in mx.hosts[:_MAX_PROBE_HOSTS]:
        candidates = [a for a in host.addresses if settings.allow_private_targets or is_public_ip(a)]
        # Prefer IPv4: many scanner hosts lack outbound IPv6.
        candidates.sort(key=lambda a: ":" in a)
        if not candidates:
            reason = "does not resolve" if not host.addresses else "resolves only to non-public addresses"
            last = StartTlsProbe(host=host.host, error=f"{host.host} {reason}; probe skipped")
            continue
        last = await asyncio.to_thread(
            probe_starttls, host.host, candidates[0], timeout=settings.smtp_timeout, ehlo_name=settings.ehlo_hostname)
        if last.reachable:
            return last
    return last


async def collect(domain: str, dkim_selectors: list[str], settings: Settings) -> Observations:
    client = DnsClient(timeout=settings.dns_timeout)
    mx = await collect_mx(client, domain)  # raises DomainNotFound
    spf, dkim, dmarc, mta_sts, tls_rpt, starttls = await asyncio.gather(
        collect_spf(client, domain, walk_budget=settings.spf_walk_budget),
        collect_dkim(client, domain, dkim_selectors),
        collect_txt(client, f"_dmarc.{domain}"),
        _collect_mta_sts(client, domain, settings),
        collect_txt(client, f"_smtp._tls.{domain}"),
        _collect_starttls(mx, settings),
    )
    return Observations(domain=domain, mx=mx, spf=spf, dkim=dkim, dmarc=dmarc, mta_sts=mta_sts,
                        tls_rpt=tls_rpt, starttls=starttls)


def build_report(obs: Observations, *, mode: str, duration_ms: int) -> ScanReport:
    result = analyze(obs)
    open_paths = [a for a in result.attack_paths if a.state == "open"]
    if not open_paths:
        summary = "No open attack paths found."
    else:
        worst = max(open_paths, key=lambda a: a.severity)
        summary = f"{len(open_paths)} open attack path(s); most severe: {worst.title.lower()}."
    return ScanReport(
        domain=obs.domain,
        mode=mode,
        scanned_at=datetime.now(timezone.utc),
        duration_ms=duration_ms,
        score=result.score,
        grade=result.grade,
        summary=summary,
        checks=list(result.checks.values()),
        attack_paths=result.attack_paths,
        one_fix=result.one_fix,
        other_fixes=result.fixes[1:],
        observations=obs,
    )


async def run_scan(domain: str, dkim_selectors: list[str], settings: Settings) -> ScanReport:
    started = time.monotonic()
    try:
        obs = await asyncio.wait_for(collect(domain, dkim_selectors, settings), timeout=settings.scan_timeout)
    except TimeoutError:
        raise ScanTimeout(f"Scan of {domain} exceeded {settings.scan_timeout:.0f}s") from None
    return build_report(obs, mode="live", duration_ms=int((time.monotonic() - started) * 1000))
