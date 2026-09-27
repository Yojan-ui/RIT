"""Narrative generation: Claude where configured, the deterministic writer always.

Ported from ``legacy/app/ai``. The engine is the only source of facts; the LLM may only
re-express them, and any response that fails ``validation`` is discarded in favour of the
deterministic narrative rather than shown with a caveat.
"""

from __future__ import annotations

import logging

import anthropic

from app.core.config import Settings
from app.models.schemas import Narrative, RemediationStep, ScanResult
from app.narrative import deterministic
from app.narrative.findings import issues
from app.narrative.llm import LLMError, complete
from app.narrative.validation import ValidationError, parse_and_validate

log = logging.getLogger("securemailscope.narrative")

__all__ = ["generate_narrative"]


def llm_enabled(settings: Settings) -> bool:
    if settings.llm_provider == "none":
        return False
    # "anthropic" lets the SDK resolve credentials itself (e.g. an `ant auth login` profile).
    return settings.llm_provider == "anthropic" or settings.llm_credentials_present


async def generate_narrative(
    result: ScanResult, settings: Settings, client: anthropic.AsyncAnthropic | None = None
) -> Narrative:
    """Produce the narrative, falling back to the rule-based writer on any problem."""
    if not llm_enabled(settings):
        reason = "LLM disabled" if settings.llm_provider == "none" else "No Claude API key configured"
        return deterministic.generate(result, fallback_reason=reason)

    try:
        raw = await complete(result, settings, client)
    except LLMError as exc:
        log.warning("narrative for %s: %s", result.domain, exc)
        return deterministic.generate(result, fallback_reason=str(exc))

    try:
        payload = parse_and_validate(raw, result)
    except ValidationError as exc:
        # A model that drifts from the findings is discarded, never shown with a caveat.
        log.warning("narrative for %s rejected: %s", result.domain, exc)
        return deterministic.generate(result, fallback_reason=f"Claude's output failed grounding validation: {exc}")

    titles = {f.id: f for f in issues(result)}
    return Narrative(
        domain=result.domain,
        source=f"llm:{settings.llm_model}",
        model=settings.llm_model,
        summary=payload["summary"].strip(),
        attack_scenarios=[s.strip() for s in payload.get("attack_scenarios", [])],
        remediation_steps=[
            RemediationStep(
                priority=n,
                finding_id=step["finding_id"],
                title=titles[step["finding_id"]].finding.title,
                severity=titles[step["finding_id"]].finding.severity,
                action=step["action"].strip(),
                rationale=str(step.get("rationale", "")).strip(),
            )
            for n, step in enumerate(payload.get("remediation_steps", []), start=1)
        ],
    )
