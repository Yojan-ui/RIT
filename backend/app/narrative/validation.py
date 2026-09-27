"""Grounding checks applied to every Claude-written narrative before it is shown.

The rule the layer rests on: the model may re-express what the engine found and may not
add to it. These checks enforce that mechanically, so the answer to "what stops it
hallucinating a vulnerability?" is a function rather than a promise about the prompt.

A narrative is rejected if it:
  1. is not a JSON object in the expected shape, or exceeds the length limits
  2. states a score or grade other than the ones the engine computed
  3. cites a finding id that is not one of the scan's issues
  4. proposes remediation or attack scenarios when the engine found nothing wrong
"""

from __future__ import annotations

import json
import re
from typing import Any

from app.models import ScanReport
from app.narrative.findings import issues

_SCORE_PATTERNS = [
    re.compile(r"\b(\d{1,3})\s*/\s*100\b"),
    re.compile(r"\bscores?\s+(?:of\s+)?(\d{1,3})\b", re.IGNORECASE),
    re.compile(r"\bscore\s+(?:is|of|was)\s+(\d{1,3})\b", re.IGNORECASE),
]
_GRADE_PATTERN = re.compile(r"\bgrade\s+(?:of\s+)?([A-F])[+-]?(?![A-Za-z])", re.IGNORECASE)

MAX_SUMMARY_CHARS = 4000
MAX_SCENARIOS = 8
MAX_STEPS = 15


class ValidationError(Exception):
    """The narrative failed a grounding check and must not be used."""


def parse_and_validate(raw: str, result: ScanReport) -> dict[str, Any]:
    payload = _extract_json(raw)
    _check_shape(payload)
    _check_score_claims(payload, result)
    _check_finding_references(payload, result)
    _check_no_invented_issues(payload, result)
    return payload


def _extract_json(raw: str) -> dict[str, Any]:
    text = raw.strip()
    if text.startswith("```"):
        text = re.sub(r"^```(?:json)?\s*", "", text)
        text = re.sub(r"\s*```$", "", text)
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass
    start, end = text.find("{"), text.rfind("}")
    if start == -1 or end <= start:
        raise ValidationError("response contained no JSON object")
    try:
        return json.loads(text[start : end + 1])
    except json.JSONDecodeError as exc:
        raise ValidationError(f"response was not valid JSON: {exc}") from exc


def _check_shape(payload: Any) -> None:
    if not isinstance(payload, dict):
        raise ValidationError("response was not a JSON object")
    summary = payload.get("summary")
    if not isinstance(summary, str) or not summary.strip():
        raise ValidationError("response has no summary")
    if len(summary) > MAX_SUMMARY_CHARS:
        raise ValidationError("summary exceeded the length limit")
    scenarios = payload.get("attack_scenarios", [])
    if not isinstance(scenarios, list) or len(scenarios) > MAX_SCENARIOS or any(not isinstance(s, str) for s in scenarios):
        raise ValidationError("attack_scenarios is malformed or too long")
    steps = payload.get("remediation_steps", [])
    if not isinstance(steps, list) or len(steps) > MAX_STEPS:
        raise ValidationError("remediation_steps is malformed or too long")
    for step in steps:
        if not isinstance(step, dict) or not isinstance(step.get("action"), str) or not step["action"].strip():
            raise ValidationError("a remediation step has no action")


def _check_score_claims(payload: dict[str, Any], result: ScanReport) -> None:
    """The model may quote the score and grade; it may not invent different ones."""
    text = _all_text(payload)
    actual = result.score
    for pattern in _SCORE_PATTERNS:
        for match in pattern.finditer(text):
            if int(match.group(1)) != actual:
                raise ValidationError(f"narrative claims a score of {match.group(1)} but the engine computed {actual}")
    for match in _GRADE_PATTERN.finditer(text):
        if match.group(1).upper() != result.grade.upper():
            raise ValidationError(
                f"narrative claims grade {match.group(1).upper()} but the engine computed {result.grade}"
            )


def _check_finding_references(payload: dict[str, Any], result: ScanReport) -> None:
    valid = {f.id for f in issues(result)}
    for step in payload.get("remediation_steps", []):
        ref = step.get("finding_id")
        if not ref or ref not in valid:
            raise ValidationError(f"remediation step cites unknown finding id {ref!r}")


def _check_no_invented_issues(payload: dict[str, Any], result: ScanReport) -> None:
    """When the engine found nothing, the narrative may not manufacture work."""
    if issues(result):
        return
    if payload.get("remediation_steps"):
        raise ValidationError("engine found no issues but the narrative proposed remediation steps")
    if payload.get("attack_scenarios"):
        raise ValidationError("engine found no issues but the narrative described attack scenarios")


def _all_text(payload: dict[str, Any]) -> str:
    parts = [str(payload.get("summary", ""))]
    parts.extend(str(s) for s in payload.get("attack_scenarios", []))
    for step in payload.get("remediation_steps", []):
        if isinstance(step, dict):
            parts.extend(str(v) for v in step.values())
    return "\n".join(parts)
