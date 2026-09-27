from __future__ import annotations

from app.core.cache import DomainCache
from app.engine.attack_paths import derive_attack_paths
from app.engine.checkers import CHECKERS
from app.engine.scanner import scan_domain
from app.models.enums import CheckName, CheckStatus
from app.models.schemas import CheckResult


async def test_scan_domain_runs_every_checker(fake_resolver, http_client, settings):
    result = await scan_domain("example.com", fake_resolver, http_client, settings)
    by_name = {c.name: c for c in result.checks}
    assert set(by_name) == {cls.name for cls in CHECKERS}
    assert by_name[CheckName.SPF].status is CheckStatus.PASS
    assert by_name[CheckName.DMARC].status is CheckStatus.PASS
    assert by_name[CheckName.MTA_STS].status is CheckStatus.PASS
    # DKIM (no selector found) and transport (probe disabled) are excluded, not failed.
    assert set(result.score.not_assessed) == {"dkim", "transport"}
    assert result.score.score == 100


async def test_scan_domain_isolates_crashing_checker(fake_resolver, http_client, settings, monkeypatch):
    from app.engine.checkers.spf import SPFChecker

    async def boom(self, ctx):
        raise RuntimeError("kaboom")

    monkeypatch.setattr(SPFChecker, "check", boom)
    result = await scan_domain("example.com", fake_resolver, http_client, settings)
    spf = next(c for c in result.checks if c.name is CheckName.SPF)
    assert spf.status is CheckStatus.ERROR
    assert "kaboom" in spf.data["error"]


def test_attack_paths_from_missing_dmarc():
    paths = derive_attack_paths([CheckResult(name=CheckName.DMARC, status=CheckStatus.MISSING)])
    assert [p.id for p in paths] == ["direct-spoofing"]


def test_attack_paths_none_when_passing_or_not_assessed():
    assert derive_attack_paths([CheckResult(name=CheckName.DMARC, status=CheckStatus.PASS)]) == []
    assert derive_attack_paths([CheckResult(name=CheckName.MTA_STS, status=CheckStatus.NOT_ASSESSED)]) == []


async def test_cache_roundtrip_and_ttl(tmp_path):
    cache = DomainCache(tmp_path / "c.sqlite3", default_ttl=60)
    await cache.connect()
    try:
        assert await cache.get("example.com") is None
        await cache.set("Example.com", {"hello": "world"})
        assert await cache.get("example.com") == {"hello": "world"}
        assert [r["domain"] for r in await cache.recent()] == ["example.com"]

        await cache.set("expired.com", {"x": 1}, ttl=0)
        assert await cache.get("expired.com") is None
    finally:
        await cache.close()


# -- API ------------------------------------------------------------------------------
def test_health(client):
    r = client.get("/api/v1/health")
    assert r.status_code == 200
    assert r.json()["status"] == "ok"


def test_dashboard_renders(client):
    r = client.get("/")
    assert r.status_code == 200
    assert "htmx" in r.text and 'name="dkim_selectors"' in r.text


def test_scan_api_uses_cache(client):
    first = client.post("/api/v1/scan", json={"domain": "https://Example.com/"}).json()
    second = client.post("/api/v1/scan", json={"domain": "example.com"}).json()
    assert first["domain"] == "example.com"
    assert first["cached"] is False
    assert second["cached"] is True
    assert client.get("/api/v1/recent").json()[0]["domain"] == "example.com"


def test_scan_api_custom_selectors_bypass_cache(client):
    client.post("/api/v1/scan", json={"domain": "example.com"})
    r = client.post("/api/v1/scan", json={"domain": "example.com", "dkim_selectors": ["mine"]}).json()
    assert r["cached"] is False
    dkim = next(c for c in r["checks"] if c["name"] == "dkim")
    assert dkim["status"] == "missing"


def test_scan_api_rejects_ip(client):
    r = client.post("/api/v1/scan", json={"domain": "192.0.2.1"})
    assert r.status_code == 422
    assert client.get("/api/v1/scan/192.0.2.1").status_code == 422


def test_scan_partial_renders_result(client):
    r = client.post("/api/v1/ui/scan", data={"domain": "example.com"})
    assert r.status_code == 200
    assert r.headers["hx-trigger"] == "scan-complete"
    assert "Not assessed from this network" in r.text
    assert "status-not_assessed" in r.text


def test_scan_partial_invalid_domain(client):
    r = client.post("/api/v1/ui/scan", data={"domain": "not a domain"})
    assert r.status_code == 200
    assert "invalid domain" in r.text
    r = client.post("/api/v1/ui/scan", data={"domain": "10.0.0.1"})
    assert "IP addresses are not accepted" in r.text
