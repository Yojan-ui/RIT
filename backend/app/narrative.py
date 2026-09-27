"""Plain-English narrative of a scan, written deterministically from the report."""

from __future__ import annotations

from datetime import datetime, timezone

from app.models import Narrative, RemediationStep, ScanReport


def write_narrative(report: ScanReport) -> Narrative:
    paths = [p for p in report.attack_paths if p.state != "not_applicable"]
    open_paths = sorted((p for p in paths if p.state == "open"), key=lambda p: -p.severity)
    titles = {p.id: p.title for p in report.attack_paths}

    summary = f"{report.domain} scores {report.score}/100 (grade {report.grade}). "
    if not open_paths:
        summary += "Every assessed attack path is closed."
    else:
        worst = open_paths[0]
        summary += (f"{len(open_paths)} of {len(paths)} assessed attack paths are open; the most serious is "
                    f"{worst.title.lower()}: {worst.description}")
    if report.one_fix:
        fix = report.one_fix
        summary += (f" The single highest-impact change is to {fix.title[0].lower() + fix.title[1:]}, "
                    f"which lifts the score from {fix.score_before} to {fix.score_after}.")
    unmeasured = [c.name for c in report.checks if c.status.value == "error"]
    if unmeasured:
        summary += f" Not measured this scan: {', '.join(unmeasured)}."

    steps = [
        RemediationStep(priority=i + 1, title=f.title, detail=f.rationale, record=f.record,
                        closes=[titles.get(pid, pid) for pid in f.closes])
        for i, f in enumerate(filter(None, [report.one_fix, *report.other_fixes]))
    ]
    for p in open_paths:
        if not p.dns_fixable:  # e.g. cleartext delivery: a mail-server change, not DNS
            steps.append(RemediationStep(priority=len(steps) + 1, title=p.remedy, detail=p.description,
                                         closes=[p.title]))

    return Narrative(
        domain=report.domain,
        summary=summary,
        attack_scenarios=[f"{p.title}: {p.description}" for p in open_paths],
        remediation_steps=steps,
        generated_at=datetime.now(timezone.utc),
    )
