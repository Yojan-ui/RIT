"""Claude-written narratives: request shape, grounding validation and every fallback path.

Uses a fake client, so the suite never calls the real API or spends money.
"""

import asyncio
import dataclasses
import json
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

from app import demo, main, narrative as narrative_pkg, service
from app.narrative import generate_narrative
from app.protection import DailyBudget
from app.scanner import build_report


def _report(scenario="wide-open"):
    return build_report(demo.observations_for(scenario), mode="demo", duration_ms=0)


class FakeClaude:
    """Stands in for anthropic.AsyncAnthropic; records the request, returns a canned reply."""

    def __init__(self, text="", stop_reason="end_turn"):
        self.calls = []
        self._reply = SimpleNamespace(stop_reason=stop_reason, content=[SimpleNamespace(type="text", text=text)])
        self.beta = SimpleNamespace(messages=SimpleNamespace(create=self._create))
        self.messages = SimpleNamespace(create=self._create)

    async def _create(self, **request):
        self.calls.append(request)
        return self._reply


@pytest.fixture
def settings():
    return dataclasses.replace(service._settings, llm_provider="anthropic", llm_model="claude-opus-5")


def _payload(**overrides):
    body = {
        "summary": "wide-open.example scores 10/100 (grade F): anyone can send mail as this domain.",
        "attack_scenarios": ["An attacker sends invoices from billing@wide-open.example and they are delivered."],
        "remediation_steps": [
            {"finding_id": "spf", "action": "Publish an SPF record ending in -all", "rationale": "Stops envelope forgery."},
            {"finding_id": "dmarc", "action": "Publish a DMARC record", "rationale": "Starts spoofing reports."},
        ],
    }
    body.update(overrides)
    return json.dumps(body)


def test_valid_claude_narrative_is_used(settings):
    fake = FakeClaude(_payload())
    result = asyncio.run(generate_narrative(_report(), settings, client=fake))
    assert result.source == "llm:claude-opus-5" and result.fallback_reason is None
    assert [s.finding_id for s in result.remediation_steps] == ["spf", "dmarc"]
    spf_step = result.remediation_steps[0]
    assert spf_step.record is not None and spf_step.record.value == "v=spf1 mx -all"  # engine's record, not Claude's


def test_request_uses_structured_output_and_refusal_fallbacks(settings):
    fake = FakeClaude(_payload())
    asyncio.run(generate_narrative(_report(), settings, client=fake))
    request = fake.calls[0]
    assert request["model"] == "claude-opus-5"
    assert request["betas"] == ["server-side-fallback-2026-07-01"] and request["fallbacks"] == "default"
    assert request["output_config"]["format"]["type"] == "json_schema"
    prompt = json.loads(request["messages"][0]["content"])
    assert prompt["score"] == 10 and prompt["grade"] == "F"
    assert {f["id"] for f in prompt["findings"]} >= {"spf", "dkim", "dmarc", "starttls"}


def test_fallbacks_can_be_turned_off(settings):
    fake = FakeClaude(_payload())
    asyncio.run(generate_narrative(_report(), dataclasses.replace(settings, llm_fallbacks=False), client=fake))
    assert "fallbacks" not in fake.calls[0] and "betas" not in fake.calls[0]


@pytest.mark.parametrize("payload, reason", [
    (_payload(summary="wide-open.example scores 55/100."), "score of 55"),
    (_payload(summary="Grade B posture overall."), "grade B"),
    (_payload(remediation_steps=[{"finding_id": "dnssec", "action": "Sign the zone", "rationale": ""}]), "unknown finding"),
    ("not json at all", "no JSON object"),
])
def test_ungrounded_output_falls_back_to_rule_based_writer(settings, payload, reason):
    result = asyncio.run(generate_narrative(_report(), settings, client=FakeClaude(payload)))
    assert result.source == "deterministic"
    assert "grounding validation" in result.fallback_reason and reason in result.fallback_reason


def test_claude_may_not_invent_issues_for_a_clean_domain(settings):
    invented = _payload(summary="fortress.example scores 100/100.",
                        remediation_steps=[{"finding_id": "spf", "action": "Tighten SPF", "rationale": ""}])
    result = asyncio.run(generate_narrative(_report("fortress"), settings, client=FakeClaude(invented)))
    assert result.source == "deterministic"


@pytest.mark.parametrize("stop_reason, reason", [("refusal", "declined"), ("max_tokens", "cut off")])
def test_refusal_and_truncation_fall_back(settings, stop_reason, reason):
    result = asyncio.run(generate_narrative(_report(), settings, client=FakeClaude(_payload(), stop_reason)))
    assert result.source == "deterministic" and reason in result.fallback_reason


def test_daily_budget_exhausted_skips_claude(settings):
    fake = FakeClaude(_payload())
    budget = DailyBudget(1)
    budget.try_spend()
    result = asyncio.run(generate_narrative(_report(), settings, client=fake, budget=budget))
    assert result.source == "deterministic" and "usage limit" in result.fallback_reason
    assert fake.calls == []


def test_no_credentials_means_rule_based(settings):
    result = asyncio.run(generate_narrative(_report(), dataclasses.replace(settings, llm_provider="auto",
                                                                           llm_credentials_present=False)))
    assert result.source == "deterministic" and result.fallback_reason == "No Claude API key configured"


def test_endpoint_uses_claude_and_caches_per_scan(monkeypatch, settings):
    monkeypatch.setattr(service, "_settings", settings)
    calls = []

    async def fake_complete(result, s, client=None):
        calls.append(result.domain)
        return _payload()

    monkeypatch.setattr(narrative_pkg, "complete", fake_complete)
    http = TestClient(main.app)
    first = http.get("/api/v1/scan/wide-open.example/narrative").json()
    second = http.get("/api/v1/scan/wide-open.example/narrative").json()
    assert first["source"] == "llm:claude-opus-5" and second == first
    assert calls == ["wide-open.example"]  # one Claude call per scan
