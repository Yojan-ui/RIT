"""The /api/v1 surface: scans, cache, recent, exports, narrative, demo domains."""

import pytest
from fastapi.testclient import TestClient

from app import demo, main, scanner
from app.collectors.dns_collect import DomainNotFound

client = TestClient(main.app)


@pytest.fixture
def fake_live(monkeypatch):
    """Live scans return the 'startup' observations re-labelled as the requested domain."""
    calls = []

    async def run_scan(domain, selectors, settings):
        calls.append(domain)
        obs = demo.observations_for("startup").model_copy(update={"domain": domain})
        return scanner.build_report(obs, mode="live", duration_ms=5)

    monkeypatch.setattr(scanner, "run_scan", run_scan)
    return calls


def test_health():
    body = client.get("/api/v1/health").json()
    assert body["status"] == "ok" and body["app"] == "SecureMailScope"


def test_demo_domains_are_scannable_without_network():
    domains = client.get("/api/v1/demo-domains").json()
    assert {d["domain"] for d in domains} >= {"fortress.example", "wide-open.example"}
    report = client.get("/api/v1/scan/wide-open.example").json()
    assert report["mode"] == "demo" and report["grade"] == "F"


def test_get_scan_is_cached_until_refresh(fake_live):
    first = client.get("/api/v1/scan/example.com").json()
    second = client.get("/api/v1/scan/example.com").json()
    assert fake_live == ["example.com"]  # second call served from cache
    assert not first["cached"] and second["cached"]
    assert second["score"] == first["score"]
    client.get("/api/v1/scan/example.com", params={"refresh": "true"})
    assert fake_live == ["example.com", "example.com"]


def test_post_scan_force_refresh_and_selector_string(fake_live):
    body = client.post("/api/v1/scan", json={"domain": "Example.COM", "dkim_selectors": "s1 s2"}).json()
    assert body["domain"] == "example.com"
    client.post("/api/v1/scan", json={"domain": "example.com", "force_refresh": True})
    assert len(fake_live) == 2


def test_recent_lists_live_scans_newest_first(fake_live):
    client.get("/api/v1/scan/a.example.com")
    client.get("/api/scan", params={"domain": "b.example.com"})  # UI route feeds recent too
    recent = client.get("/api/v1/recent").json()
    assert [r["domain"] for r in recent] == ["b.example.com", "a.example.com"]
    assert {"score", "grade", "scanned_at"} <= recent[0].keys()


def test_pdf_export(fake_live):
    response = client.get("/api/v1/scan/example.com/pdf")
    assert response.status_code == 200
    assert response.headers["content-type"] == "application/pdf"
    assert response.content.startswith(b"%PDF")
    assert 'filename="securemailscope-example.com-' in response.headers["content-disposition"]


@pytest.mark.parametrize("domain", [s.domain for s in demo.list_scenarios()])
def test_pdf_renders_for_every_scenario(domain):
    assert client.get(f"/api/v1/scan/{domain}/pdf").content.startswith(b"%PDF")


def test_json_export_is_an_attachment(fake_live):
    response = client.get("/api/v1/scan/example.com/json")
    assert response.json()["domain"] == "example.com"
    assert response.headers["content-disposition"].endswith('.json"')


def test_narrative_covers_open_paths_and_server_side_fix():
    body = client.get("/api/v1/scan/wide-open.example/narrative").json()
    assert body["source"] == "deterministic" and "10/100" in body["summary"]
    assert any("Cleartext" in s for s in body["attack_scenarios"])
    assert any(step["record"] is None and "STARTTLS" in step["title"] for step in body["remediation_steps"])


def test_errors_are_json(monkeypatch):
    assert client.get("/api/v1/scan/not a domain").status_code == 422

    async def nx(domain, selectors, settings):
        raise DomainNotFound(domain)

    monkeypatch.setattr(scanner, "run_scan", nx)
    response = client.get("/api/v1/scan/nope.example.org")
    assert response.status_code == 404 and "NXDOMAIN" in response.json()["detail"]
    assert client.get("/api/v1/nope").status_code == 404
