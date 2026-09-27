"""Stable ids for a scan's findings, shared by the narrative writers and the validator."""

from __future__ import annotations

from dataclasses import dataclass

from app.models.enums import CheckStatus, Severity
from app.models.schemas import CheckResult, Finding, ScanResult

_UNMEASURED = {CheckStatus.NOT_ASSESSED, CheckStatus.ERROR}


@dataclass(frozen=True, slots=True)
class IndexedFinding:
    id: str
    check: CheckResult
    finding: Finding


def index_findings(result: ScanResult) -> list[IndexedFinding]:
    """Every finding, keyed ``<check>.<n>`` in check order (e.g. ``dmarc.1``)."""
    return [
        IndexedFinding(f"{check.name.value}.{n}", check, finding)
        for check in result.checks
        for n, finding in enumerate(check.findings, start=1)
    ]


def issues(result: ScanResult) -> list[IndexedFinding]:
    """Findings that describe a real weakness, most severe first.

    Informational notes and anything from a check that could not be measured are left
    out: a narrative must never turn "not assessed" into a problem.
    """
    found = [
        f for f in index_findings(result)
        if f.finding.severity.rank > Severity.INFO.rank and f.check.status not in _UNMEASURED
    ]
    return sorted(found, key=lambda f: -f.finding.severity.rank)
