"""Narrative layer: deterministic writer, grounding validator, Claude path (with a fake client)."""

from __future__ import annotations

import json
from types import SimpleNamespace

import anthropic
import httpx2
import pytest

from app.models.enums import CheckName, CheckStatus
from app.models.schemas import CheckResult
from app.narrative import deterministic, generate_narrative
from app.narrative.findings import issues
from app.narrative.llm import FALLBACK_BETA
from app.narrative.validation import ValidationError, parse_and_validate
from tests.test_scenarios import _scan


@pytest.fixture
async def unprotected(settings, monkeypatch):
    return await _scan("unprotected", settings, monkeypatch)


@pytest.fixture
async def hardened(settings, monkeypatch):
    return await _scan("hardened", settings, monkeypatch)


@pytest.fixture
async def cloud(settings, monkeypatch):
    return await _scan("cloud_restricted", settings, monkeypatch)


# -- deterministic writer --------------------------------------------------------------
def test_deterministic_narrative_for_unprotected_domain(unprotected):
    n = deterministic.generate(unprotected)
    assert n.source == "deterministic"
    assert f"{unprotected.score.score}/100 (grade F)" in n.summary
    assert "currently spoofable" in n.summary or "forged as @unprotected.test" in n.summary
    assert any("exact domain in the From: header" in s for s in n.attack_scenarios)
    assert 0 < len(n.attack_scenarios) <= 5
    ids = {f.id for f in issues(unprotected)}
    assert n.remediation_steps and all(step.finding_id in ids for step in n.remediation_steps)
    assert [s.priority for s in n.remediation_steps] == list(range(1, len(n.remediation_steps) + 1))


def test_clean_domain_gets_no_invented_work(hardened):
    n = deterministic.generate(hardened)
    assert "nothing to remediate" in n.summary
    assert n.attack_scenarios == [] and n.remediation_steps == []


def test_not_assessed_is_described_as_a_gap_not_a_pass(cloud):
    n = deterministic.generate(cloud)
    assert "STARTTLS could not be measured" in n.summary
    assert "not a clean result" in n.summary


def test_not_assessed_checks_never_become_issues(cloud):
    assert all(f.check.status is not CheckStatus.NOT_ASSESSED for f in issues(cloud))


# -- validator -----------------------------------------------------------------------------
def _payload(result, **overrides) -> str:
    first = issues(result)[0].id if issues(result) else None
    body = {
        "summary": f"{result.domain} scores {result.score.score}/100 (grade {result.score.grade.value}).",
        "attack_scenarios": ["An attacker spoofs the domain."] if first else [],
        "remediation_steps": [{"finding_id": first, "action": "Publish DMARC.", "rationale": "Stops spoofing."}] if first else [],
    }
    body.update(overrides)
    return json.dumps(body)


def test_validator_accepts_grounded_output(unprotected):
    assert parse_and_validate("```json\n" + _payload(unprotected) + "\n```", unprotected)["summary"]


@pytest.mark.parametrize(
    ("overrides", "message"),
    [
        ({"summary": "The domain scores 97/100."}, "score of 97"),
        ({"summary": "This earns a grade of B overall."}, "grade B"),
        ({"remediation_steps": [{"finding_id": "dmarc.99", "action": "x", "rationale": ""}]}, "unknown finding id"),
        ({"remediation_steps": [{"finding_id": "dkim.1", "action": " ", "rationale": ""}]}, "no action"),
        ({"attack_scenarios": "not a list"}, "malformed"),
        ({"summary": ""}, "no summary"),
    ],
)
def test_validator_rejects_ungrounded_output(unprotected, overrides, message):
    with pytest.raises(ValidationError, match=message):
        parse_and_validate(_payload(unprotected, **overrides), unprotected)


def test_validator_rejects_invented_issues_on_clean_domain(hardened):
    with pytest.raises(ValidationError, match="found no issues"):
        parse_and_validate(_payload(hardened, attack_scenarios=["Attackers could spoof you."]), hardened)


def test_validator_rejects_non_json(unprotected):
    with pytest.raises(ValidationError, match="no JSON"):
        parse_and_validate("I'm sorry, here is a summary.", unprotected)


# -- Claude path, with a fake client ------------------------------------------------------------
class FakeClaude:
    """Stands in for anthropic.AsyncAnthropic: records requests, returns or raises canned results."""

    def __init__(self, text: str = "", stop_reason: str = "end_turn", error: Exception | None = None):
        self.calls: list[dict] = []
        self._text, self._stop, self._error = text, stop_reason, error
        self.messages = SimpleNamespace(create=self._create)
        self.beta = SimpleNamespace(messages=SimpleNamespace(create=self._create))

    async def _create(self, **kwargs):
        self.calls.append(kwargs)
        if self._error:
            raise self._error
        return SimpleNamespace(stop_reason=self._stop, content=[SimpleNamespace(type="text", text=self._text)])


def _claude_settings(settings, **extra):
    return settings.model_copy(update={"llm_credentials_present": True, **extra})


async def test_claude_narrative_is_used_when_grounded(unprotected, settings):
    fake = FakeClaude(_payload(unprotected))
    n = await generate_narrative(unprotected, _claude_settings(settings), client=fake)
    assert n.source == "llm:claude-opus-5" and n.fallback_reason is None
    assert n.remediation_steps[0].title  # enriched from the engine's own finding
    request = fake.calls[0]
    assert request["model"] == "claude-opus-5"
    assert request["fallbacks"] == "default" and request["betas"] == [FALLBACK_BETA]
    assert request["output_config"]["format"]["type"] == "json_schema"
    sent = json.loads(request["messages"][0]["content"])
    assert sent["score"] == unprotected.score.score
    assert {f["id"] for f in sent["findings"]} == {f.id for f in issues(unprotected)}


async def test_fallbacks_can_be_turned_off(unprotected, settings):
    fake = FakeClaude(_payload(unprotected))
    await generate_narrative(unprotected, _claude_settings(settings, llm_fallbacks=False), client=fake)
    assert "fallbacks" not in fake.calls[0] and "betas" not in fake.calls[0]


async def test_claude_output_that_lies_about_the_score_is_discarded(unprotected, settings):
    fake = FakeClaude(_payload(unprotected, summary="The domain scores 88/100."))
    n = await generate_narrative(unprotected, _claude_settings(settings), client=fake)
    assert n.source == "deterministic"
    assert "failed grounding validation" in n.fallback_reason and "88" in n.fallback_reason


@pytest.mark.parametrize(
    ("fake", "reason"),
    [
        (FakeClaude(stop_reason="refusal"), "declined"),
        (FakeClaude(stop_reason="max_tokens", text="{"), "cut off"),
        (FakeClaude(error=anthropic.APIConnectionError(request=httpx2.Request("POST", "https://api.anthropic.com"))), "could not reach"),
        (FakeClaude(error=anthropic.APITimeoutError(request=httpx2.Request("POST", "https://api.anthropic.com"))), "in time"),
        (
            FakeClaude(error=anthropic.RateLimitError(
                "slow down", response=httpx2.Response(429, request=httpx2.Request("POST", "https://api.anthropic.com")), body=None,
            )),
            "rate limit",
        ),
    ],
)
async def test_claude_failures_fall_back_to_deterministic(unprotected, settings, fake, reason):
    n = await generate_narrative(unprotected, _claude_settings(settings), client=fake)
    assert n.source == "deterministic"
    assert reason in n.fallback_reason
    assert n.summary == deterministic.generate(unprotected).summary


async def test_no_credentials_means_no_call(unprotected, settings):
    fake = FakeClaude(_payload(unprotected))
    n = await generate_narrative(unprotected, settings, client=fake)
    assert fake.calls == [] and n.fallback_reason == "No Claude API key configured"
    n = await generate_narrative(unprotected, _claude_settings(settings, llm_provider="none"), client=fake)
    assert fake.calls == [] and n.fallback_reason == "LLM disabled"


async def test_real_client_without_network_falls_back(unprotected, settings, monkeypatch):
    """With a key but no reachable API (the offline guard), the scan still gets a narrative."""
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-ant-test-not-a-real-key")
    n = await generate_narrative(unprotected, _claude_settings(settings, llm_timeout_seconds=5))
    assert n.source == "deterministic" and n.fallback_reason


# -- API --------------------------------------------------------------------------------------------
def test_narrative_endpoints(client):
    body = client.get("/api/v1/scan/example.com/narrative").json()
    assert body["domain"] == "example.com" and body["source"] == "deterministic" and body["summary"]
    again = client.get("/api/v1/scan/example.com/narrative").json()
    assert again["generated_at"] == body["generated_at"]  # memoised per scan

    html = client.get("/api/v1/ui/narrative/example.com")
    assert html.status_code == 200 and "rule-based writer" in html.text
    assert client.get("/api/v1/scan/10.0.0.1/narrative").status_code == 422


def test_scan_result_loads_narrative_lazily(client):
    r = client.post("/api/v1/ui/scan", data={"domain": "example.com"})
    assert 'hx-get="/api/v1/ui/narrative/example.com"' in r.text


def test_mx_findings_are_reported_even_though_mx_is_unscored():
    result_checks = [CheckResult(name=CheckName.MX, status=CheckStatus.PASS)]
    from app.engine.scanner import build_result

    assert "mx" not in build_result("example.com", result_checks).score.components


def test_narrative_leads_with_the_heaviest_weighted_problem(unprotected):
    """SPF and DMARC findings are both high severity; DMARC is worth more points, so it leads."""
    n = deterministic.generate(unprotected)
    assert "The most consequential is No DMARC record (DMARC)" in n.summary
    assert n.remediation_steps[0].title == "No DMARC record"
