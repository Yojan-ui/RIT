"""Timeouts must degrade to 'unmeasured' or 504, never to a wrong verdict."""

import asyncio
import time

from fastapi.testclient import TestClient

from app import main, scanner
from app.analysis.checks import evaluate_dkim, evaluate_spf
from app.collectors import dns_collect
from app.collectors.dns_collect import DnsTransientError, collect_spf
from app.config import Settings
from app.models import DkimLookup, MxHost, MxLookup, SpfLookup, Status


class FakeDns:
    """Minimal DnsClient stand-in: TXT answers from a dict, or raise / stall."""

    def __init__(self, txt: dict[str, list[str]], fail: set[str] = frozenset(), stall: set[str] = frozenset()):
        self._txt, self._fail, self._stall = txt, fail, stall

    async def txt(self, name: str) -> list[str]:
        if name in self._stall:
            await asyncio.sleep(10)
        if name in self._fail:
            raise DnsTransientError(f"TXT lookup for {name} timed out")
        return self._txt.get(name, [])


def test_spf_include_timeout_is_incomplete_not_permerror():
    dns = FakeDns({"example.com": ["v=spf1 include:slow.example -all"]}, fail={"slow.example"})
    lookup = asyncio.run(collect_spf(dns, "example.com"))
    assert lookup.lookup_incomplete and lookup.lookup_count is None

    result = evaluate_spf(lookup)
    assert result.details["state"] == "hardfail"  # the policy itself is still -all
    assert result.status == Status.PASS
    assert any("not checked" in f for f in result.findings)


def test_spf_walk_budget_caps_a_stalling_chain():
    dns = FakeDns({"example.com": ["v=spf1 include:tarpit.example ~all"]}, stall={"tarpit.example"})
    started = time.monotonic()
    lookup = asyncio.run(collect_spf(dns, "example.com", walk_budget=0.2))
    assert time.monotonic() - started < 2
    assert lookup.lookup_incomplete


def test_real_permerror_in_include_is_still_invalid():
    dns = FakeDns({"example.com": ["v=spf1 include:dup.example -all"],
                   "dup.example": ["v=spf1 -all", "v=spf1 mx -all"]})
    result = evaluate_spf(asyncio.run(collect_spf(dns, "example.com")))
    assert result.details["state"] == "invalid"


def test_dkim_reports_selectors_it_could_not_check():
    result = evaluate_dkim(DkimLookup(selectors_tried=["a", "b"], failed_selectors=["b"]), spf_state="hardfail")
    assert any("timed out" in f for f in result.findings)


def test_probe_budget_marks_starttls_unmeasured(monkeypatch):
    def slow_probe(*args, **kwargs):
        time.sleep(1)

    monkeypatch.setattr(scanner, "probe_starttls", slow_probe)
    mx = MxLookup(hosts=[MxHost(preference=10, host="mx.example", addresses=["93.184.216.34"])])
    probe = asyncio.run(scanner._collect_starttls(mx, Settings(probe_budget=0.1)))
    assert not probe.reachable and "budget" in probe.error


def test_whole_scan_deadline_returns_504(monkeypatch):
    async def stuck_collect(domain, selectors, settings):
        await asyncio.sleep(10)

    monkeypatch.setattr(scanner, "collect", stuck_collect)
    monkeypatch.setattr(main, "settings", Settings(scan_timeout=0.1))
    response = TestClient(main.app).get("/api/scan", params={"domain": "example.com"})
    assert response.status_code == 504
    assert "exceeded" in response.json()["detail"]


def test_unexpected_errors_are_json(monkeypatch):
    async def boom(domain, selectors, settings):
        raise RuntimeError("kaboom")

    monkeypatch.setattr(main, "run_scan", boom)
    response = TestClient(main.app, raise_server_exceptions=False).get("/api/scan", params={"domain": "example.com"})
    assert response.status_code == 500
    assert response.json() == {"detail": "Internal error while processing the request"}


def test_dns_timeout_maps_to_transient(monkeypatch):
    import dns.exception

    client = dns_collect.DnsClient(timeout=1)

    async def raise_timeout(*args, **kwargs):
        raise dns.exception.Timeout()

    monkeypatch.setattr(client._resolver, "resolve", raise_timeout)
    try:
        asyncio.run(client.txt("example.com"))
    except DnsTransientError as exc:
        assert "timed out" in str(exc)
    else:
        raise AssertionError("expected DnsTransientError")
