"""Claude narrative writer.

The model is a wrapper around findings, not a source of them: the prompt is built from
the engine's output only, the response is constrained to a JSON schema, and every
response is checked by ``validation.parse_and_validate`` before it is used. Any failure
raises ``LLMError`` and the caller falls back to the deterministic writer.
"""

from __future__ import annotations

import json

import anthropic

from app.config import Settings
from app.models import ScanReport
from app.narrative.findings import issues

MAX_TOKENS = 16000
# Server-side refusal fallback: a declined request is re-run on Anthropic's recommended
# model for that refusal category, inside the same call.
FALLBACK_BETA = "server-side-fallback-2026-07-01"

SYSTEM_PROMPT = """\
You are the reporting layer of SecureMailScope, a passive email security assessment tool. \
A deterministic engine has already performed every check and computed the score. Your only \
job is to explain, in plain English, what the engine found.

Hard constraints:
- Do not introduce any finding, weakness or observation that is not in the findings given \
to you. If the engine found nothing wrong, say so plainly; do not manufacture advice.
- Do not state a score or grade other than the one supplied.
- Checks listed under "not_assessed" could not be measured from where the scan ran. Describe \
them as not assessed; never as passing and never as failing.
- Every remediation step must cite the finding_id it addresses: the "id" of one of the \
findings, copied exactly (they are check ids such as "dmarc" or "spf").
- Do not speculate about the organisation, its size, its industry or incidents it may have \
had. You know only what is in the findings.

Write for a technically literate executive reading a one-page summary. Explain what an \
attacker could concretely do with each gap, in terms of actions and outcomes rather than \
protocol mechanics. Be direct and specific and avoid filler.

The summary is 2-4 paragraphs of prose with no bullet points or headings. Each attack \
scenario is one concrete scenario tied to a specific finding. Order remediation steps by the \
risk they remove, not by ease. If there are no findings, return empty lists for \
attack_scenarios and remediation_steps."""

OUTPUT_SCHEMA = {
    "type": "object",
    "properties": {
        "summary": {"type": "string"},
        "attack_scenarios": {"type": "array", "items": {"type": "string"}},
        "remediation_steps": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "finding_id": {"type": "string"},
                    "action": {"type": "string"},
                    "rationale": {"type": "string"},
                },
                "required": ["finding_id", "action", "rationale"],
                "additionalProperties": False,
            },
        },
    },
    "required": ["summary", "attack_scenarios", "remediation_steps"],
    "additionalProperties": False,
}


class LLMError(Exception):
    """Claude could not be reached, declined, or returned something unusable."""


def build_user_prompt(result: ScanReport) -> str:
    """Serialise the engine's output for the model. Nothing else about the domain is sent."""
    return json.dumps(
        {
            "domain": result.domain,
            "score": result.score,
            "grade": result.grade,
            "not_assessed": [c.name for c in result.checks if c.status.value == "error"],
            "findings": [
                {
                    "id": i.id,
                    "check": i.check.name,
                    "title": i.title,
                    "severity": i.severity,
                    "detail": i.detail,
                    "engine_recommendation": i.recommendation,
                }
                for i in issues(result)
            ],
            "attack_paths": [
                {"id": p.id, "title": p.title, "impact": p.severity, "state": p.state, "description": p.description}
                for p in result.attack_paths
            ],
        },
        indent=2,
    )


async def complete(result: ScanReport, settings: Settings, client: anthropic.AsyncAnthropic | None = None) -> str:
    """Ask Claude for the narrative JSON. Returns the raw text of the response."""
    request = {
        "model": settings.llm_model,
        "max_tokens": MAX_TOKENS,
        "system": SYSTEM_PROMPT,
        "messages": [{"role": "user", "content": build_user_prompt(result)}],
        "output_config": {"format": {"type": "json_schema", "schema": OUTPUT_SCHEMA}},
    }
    try:
        # Built inside the try: missing or unusable credentials surface as AnthropicError here too.
        client = client or anthropic.AsyncAnthropic(timeout=settings.llm_timeout, max_retries=1)
        if settings.llm_fallbacks:
            response = await client.beta.messages.create(betas=[FALLBACK_BETA], fallbacks="default", **request)
        else:
            response = await client.messages.create(**request)
    except anthropic.AuthenticationError as exc:
        raise LLMError("Claude rejected the API credentials") from exc
    except anthropic.RateLimitError as exc:
        raise LLMError("Claude rate limit reached") from exc
    except anthropic.APITimeoutError as exc:
        raise LLMError("Claude did not respond in time") from exc
    except anthropic.APIConnectionError as exc:
        raise LLMError("could not reach the Claude API") from exc
    except anthropic.APIStatusError as exc:
        raise LLMError(f"Claude API returned HTTP {exc.status_code}") from exc
    except anthropic.AnthropicError as exc:
        raise LLMError(f"Claude client error: {exc}") from exc

    if response.stop_reason == "refusal":
        raise LLMError("Claude declined to write the narrative")
    if response.stop_reason == "max_tokens":
        raise LLMError("Claude's response was cut off")
    text = "".join(block.text for block in response.content if block.type == "text")
    if not text.strip():
        raise LLMError("Claude returned no text")
    return text
