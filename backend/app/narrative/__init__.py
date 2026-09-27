"""Narrative generation: Claude where configured, the rule-based writer always.

The engine is the only source of facts; Claude may only re-express them, and any response
that fails ``validation`` is discarded in favour of the rule-based narrative rather than
shown with a caveat.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone

import anthropic

from app.config import Settings
from app.models import Narrative, RemediationStep, ScanReport
from app.narrative.deterministic import write_narrative
from app.narrative.findings import issues
from app.narrative.llm import LLMError, complete
from app.narrative.validation import ValidationError, parse_and_validate
from app.protection import DailyBudget

log = logging.getLogger("securemailscope.narrative")

__all__ = ["generate_narrative", "llm_enabled", "write_narrative"]


def llm_enabled(settings: Settings) -> bool:
    if settings.llm_provider == "none":
        return False
    # "anthropic" lets the SDK resolve credentials itself (e.g. an `ant auth login` profile).
    return settings.llm_provider == "anthropic" or settings.llm_credentials_present


async def generate_narrative(
    result: ScanReport,
    settings: Settings,
    client: anthropic.AsyncAnthropic | None = None,
    budget: DailyBudget | None = None,
) -> Narrative:
    """Produce the narrative, falling back to the rule-based writer on any problem."""
    if not llm_enabled(settings):
        reason = "LLM disabled" if settings.llm_provider == "none" else "No Claude API key configured"
        return write_narrative(result, fallback_reason=reason)
    if budget is not None and not budget.try_spend():
        return write_narrative(result, fallback_reason="today's Claude usage limit for this server has been reached")

    try:
        raw = await complete(result, settings, client)
    except LLMError as exc:
        log.warning("narrative for %s: %s", result.domain, exc)
        return write_narrative(result, fallback_reason=str(exc))

    try:
        payload = parse_and_validate(raw, result)
    except ValidationError as exc:
        # A model that drifts from the findings is discarded, never shown with a caveat.
        log.warning("narrative for %s rejected: %s", result.domain, exc)
        return write_narrative(result, fallback_reason=f"Claude's output failed grounding validation: {exc}")

    by_id = {i.id: i for i in issues(result)}
    fixes = {f.id: f for f in filter(None, [result.one_fix, *result.other_fixes])}
    titles = {p.id: p.title for p in result.attack_paths}
    steps = []
    for n, step in enumerate(payload.get("remediation_steps", []), start=1):
        fid = step["finding_id"]
        fix = fixes.get(fid)
        steps.append(RemediationStep(
            priority=n,
            title=step["action"].strip(),
            detail=str(step.get("rationale", "")).strip() or by_id[fid].title,
            record=fix.record if fix else None,
            closes=[titles.get(pid, pid) for pid in fix.closes] if fix else [],
            finding_id=fid,
        ))
    return Narrative(
        domain=result.domain,
        source=f"llm:{settings.llm_model}",
        model=settings.llm_model,
        summary=payload["summary"].strip(),
        attack_scenarios=[s.strip() for s in payload.get("attack_scenarios", [])],
        remediation_steps=steps,
        generated_at=datetime.now(timezone.utc),
    )
