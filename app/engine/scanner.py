"""Orchestrates checkers, scoring and attack-path derivation for a domain."""

from __future__ import annotations

import asyncio

import httpx

from app.core.config import Settings
from app.core.logging import get_logger
from app.engine.attack_paths import active_paths, assess_attack_paths
from app.engine.checkers import CHECKERS, BaseChecker, ScanContext
from app.engine.dns_resolver import DNSResolver
from app.engine.remediation import pick_one_fix
from app.engine.scoring import score_results
from app.models.enums import CheckStatus
from app.models.schemas import CheckResult, ScanResult

log = get_logger("scanner")


async def _run(checker: BaseChecker, ctx: ScanContext) -> CheckResult:
    try:
        return await checker.check(ctx)
    except Exception as exc:  # a single broken checker must not sink the scan
        log.exception("checker %s crashed on %s", checker.name.value, ctx.domain)
        return CheckResult(
            name=checker.name,
            status=CheckStatus.ERROR,
            summary="Internal error while checking",
            data={"error": repr(exc)},
        )


async def scan_domain(
    domain: str,
    resolver: DNSResolver,
    http: httpx.AsyncClient,
    settings: Settings,
    dkim_selectors: list[str] | None = None,
) -> ScanResult:
    ctx = ScanContext(
        domain=domain,
        resolver=resolver,
        http=http,
        settings=settings,
        dkim_selectors=list(dkim_selectors or []),
    )
    results = list(await asyncio.gather(*(_run(cls(), ctx) for cls in CHECKERS)))
    return build_result(domain, results)


def build_result(domain: str, checks: list[CheckResult], **extra) -> ScanResult:
    """Derive score, attack paths and the one fix from raw check results."""
    matrix = assess_attack_paths(checks)
    return ScanResult(
        domain=domain,
        checks=checks,
        score=score_results(checks),
        attack_paths=active_paths(matrix),
        attack_matrix=matrix,
        one_fix=pick_one_fix(domain, checks, matrix),
        **extra,
    )
