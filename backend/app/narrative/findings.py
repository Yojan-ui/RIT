"""The scan's issues, keyed by check id. Shared by the Claude writer and its validator."""

from __future__ import annotations

from dataclasses import dataclass

from app.analysis.checks import WEIGHTS
from app.models import CheckResult, ScanReport, Status


@dataclass(frozen=True, slots=True)
class Issue:
    id: str  # check id, e.g. "dmarc": the id a remediation step must cite
    check: CheckResult
    severity: str  # "high" (FAIL) or "medium" (WARN)
    title: str
    detail: str
    recommendation: str | None  # what the engine itself recommends, if anything


def issues(report: ScanReport) -> list[Issue]:
    """Checks that describe a real weakness, failures first, then by scoring weight.

    Unmeasured and not-applicable checks are left out: a narrative must never turn
    "not assessed" into a problem.
    """
    fixes = {f.id: f for f in filter(None, [report.one_fix, *report.other_fixes])}
    cleartext = next((p for p in report.attack_paths if p.id == "cleartext_delivery" and p.state == "open"), None)
    out = []
    for c in report.checks:
        if not c.applicable or c.status not in (Status.FAIL, Status.WARN):
            continue
        fix = fixes.get(c.id)
        if fix:
            recommendation = f"{fix.title}: publish {fix.record.type} {fix.record.host} = {fix.record.value}"
        elif c.id == "starttls" and cleartext:
            recommendation = cleartext.remedy
        else:
            recommendation = None
        out.append(Issue(
            id=c.id, check=c, severity="high" if c.status == Status.FAIL else "medium",
            title=f"{c.name}: {c.summary}", detail=" ".join([c.summary, *c.findings]), recommendation=recommendation,
        ))
    return sorted(out, key=lambda i: (i.severity != "high", -WEIGHTS.get(i.id, 0)))
