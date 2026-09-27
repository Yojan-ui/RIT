"""Abuse protection and hardening for a public deployment (ported from the pre-3D app)."""

import asyncio
import logging
import socket

import pytest
from fastapi.testclient import TestClient

from app import demo, main, scanner, service
from app.collectors import mta_sts_fetch
from app.collectors.mta_sts_fetch import PolicyFetchError, fetch_policy
from app.collectors.netguard import PrivateTargetError, is_public_ip, resolve_public
from app.models import MxHost, MxLookup
from app.protection import ClientLimiter, DailyBudget, Protections, ScanGate, ServerBusy
from app.scanner import build_report

client = TestClient(main.app)


def _addrinfo(*addresses):
    return lambda host, port, *a, **k: [(socket.AF_INET, socket.SOCK_STREAM, 6, "", (ip, port)) for ip in addresses]


@pytest.fixture
def fake_live(monkeypatch):
    calls = []

    async def run_scan(domain, selectors, settings):
        calls.append(domain)
        obs = demo.observations_for("startup").model_copy(update={"domain": domain})
        return build_report(obs, mode="live", duration_ms=1)

    monkeypatch.setattr(scanner, "run_scan", run_scan)
    return calls


def _limits(monkeypatch, **overrides):
    import dataclasses

    settings = dataclasses.replace(service._settings, **overrides)
    monkeypatch.setattr(service, "protect", Protections.from_settings(settings))


# ---- SSRF guard -------------------------------------------------------------


@pytest.mark.parametrize("address, public", [
    ("8.8.8.8", True),
    ("2001:4860:4860::8888", True),
    ("10.0.0.1", False),
    ("127.0.0.1", False),
    ("169.254.169.254", False),  # cloud metadata
    ("::1", False),
    ("::ffff:10.0.0.1", False),  # IPv4-mapped private address
    ("::ffff:8.8.8.8", True),
    ("224.0.0.1", False),  # multicast
    ("fe80::1%en0", False),
    ("not-an-ip", False),
])
def test_is_public(address, public):
    assert is_public_ip(address) is public


def test_resolve_public_blocks_any_internal_address(monkeypatch):
    monkeypatch.setattr(socket, "getaddrinfo", _addrinfo("93.184.216.34", "10.0.0.5"))
    with pytest.raises(PrivateTargetError, match="10.0.0.5"):
        resolve_public("mixed.example", 443)
    assert resolve_public("mixed.example", 443, allow_private=True) == ["93.184.216.34", "10.0.0.5"]


def test_mta_sts_policy_host_on_internal_address_is_not_fetched(monkeypatch):
    monkeypatch.setattr(socket, "getaddrinfo", _addrinfo("169.254.169.254"))

    def no_connect(*args, **kwargs):
        raise AssertionError("must not connect to an internal address")

    monkeypatch.setattr(socket, "create_connection", no_connect)
    with pytest.raises(PolicyFetchError, match="non-public"):
        fetch_policy("evil.example", timeout=1, allow_private=False)


def test_mta_sts_fetch_connects_to_the_validated_ip(monkeypatch):
    """No DNS rebinding: the connection goes to the address that was checked, not a re-resolve."""
    monkeypatch.setattr(socket, "getaddrinfo", _addrinfo("93.184.216.34"))
    seen = []

    def record(address, timeout=None, *args, **kwargs):
        seen.append(address)
        raise OSError("stop here")

    monkeypatch.setattr(mta_sts_fetch.socket, "create_connection", record)
    with pytest.raises(PolicyFetchError):
        fetch_policy("example.com", timeout=1, allow_private=False)
    assert seen == [("93.184.216.34", 443)]


def test_smtp_probe_refuses_internal_mx(monkeypatch):
    def no_probe(*args, **kwargs):
        raise AssertionError("must not probe an internal MX")

    monkeypatch.setattr(scanner, "probe_starttls", no_probe)
    mx = MxLookup(hosts=[MxHost(preference=10, host="mx.evil.example", addresses=["10.0.0.5", "::ffff:127.0.0.1"])])
    probe = asyncio.run(scanner._collect_starttls(mx, service._settings))
    assert not probe.reachable and "non-public" in probe.error


# ---- Limiters, budget, gate -----------------------------------------------------


def test_client_limiter_refuses_after_burst_and_refills():
    now = [0.0]
    limiter = ClientLimiter(per_minute=60, burst=2, clock=lambda: now[0])
    assert limiter.take("a") == 0 and limiter.take("a") == 0
    assert limiter.take("a") == pytest.approx(1.0)  # one token per second
    assert limiter.take("b") == 0  # other clients unaffected
    now[0] += 1.0
    assert limiter.take("a") == 0


def test_client_limiter_memory_is_bounded():
    limiter = ClientLimiter(per_minute=60, burst=1, max_clients=3)
    for n in range(10):
        limiter.take(f"client-{n}")
    assert len(limiter._buckets) == 3


def test_daily_budget_resets_each_day():
    day = ["2026-09-28"]
    budget = DailyBudget(2, today=lambda: day[0])
    assert budget.try_spend() and budget.try_spend() and not budget.try_spend()
    day[0] = "2026-09-29"
    assert budget.try_spend()


def test_scan_gate_coalesces_identical_scans():
    calls = []

    async def run():
        gate = ScanGate(max_concurrent=4, queue_timeout=1)

        async def scan():
            calls.append(1)
            await asyncio.sleep(0.05)
            return "report"

        return await asyncio.gather(gate.run("k", scan), gate.run("k", scan))

    assert asyncio.run(run()) == ["report", "report"]
    assert calls == [1]


def test_scan_gate_reports_busy_when_full():
    async def run():
        gate = ScanGate(max_concurrent=1, queue_timeout=0.05)
        release = asyncio.Event()

        async def slow():
            await release.wait()

        holder = asyncio.create_task(gate.run("a", slow))
        await asyncio.sleep(0.01)
        try:
            with pytest.raises(ServerBusy):
                await gate.run("b", slow)
        finally:
            release.set()
            await holder

    asyncio.run(run())


def test_scan_gate_shares_failures_with_waiters():
    async def run():
        gate = ScanGate(max_concurrent=2, queue_timeout=1)

        async def boom():
            await asyncio.sleep(0.02)
            raise RuntimeError("scan failed")

        return await asyncio.gather(gate.run("k", boom), gate.run("k", boom), return_exceptions=True)

    results = asyncio.run(run())
    assert all(isinstance(r, RuntimeError) for r in results)


# ---- HTTP surface -------------------------------------------------------------


def test_scan_rate_limit_returns_429_with_retry_after(monkeypatch, fake_live):
    _limits(monkeypatch, scan_burst=2, scan_rate_per_minute=1)
    assert client.get("/api/v1/scan/one.example.com").status_code == 200
    assert client.get("/api/scan", params={"domain": "two.example.com"}).status_code == 200
    blocked = client.get("/api/v1/scan/three.example.com")
    assert blocked.status_code == 429
    assert int(blocked.headers["retry-after"]) >= 1
    assert "Too many new scans" in blocked.json()["detail"]
    # Cache hits and built-in demo domains cost no port-25 traffic, so they are not limited.
    assert client.get("/api/v1/scan/one.example.com").json()["cached"] is True
    assert client.get("/api/v1/scan/wide-open.example").status_code == 200
    assert fake_live == ["one.example.com", "two.example.com"]


def test_scan_gate_full_returns_503(monkeypatch):
    async def busy(*args, **kwargs):
        raise ServerBusy("The scanner is busy with other scans. Try again in a moment.")

    monkeypatch.setattr(service.protect.gate, "run", busy)
    response = client.get("/api/v1/scan/example.com")
    assert response.status_code == 503 and response.headers["retry-after"] == "10"


def test_api_rate_limit_spares_health_checks(monkeypatch):
    _limits(monkeypatch, api_burst=3, api_rate_per_minute=1)
    for _ in range(3):
        assert client.get("/api/demo").status_code == 200
    assert client.get("/api/demo").status_code == 429
    assert client.get("/api/health").status_code == 200
    assert client.get("/api/v1/health").status_code == 200


def test_security_headers_on_app_and_api():
    for path in ("/", "/api/demo"):
        headers = client.get(path).headers
        assert headers["x-content-type-options"] == "nosniff"
        assert headers["x-frame-options"] == "DENY"
        csp = headers["content-security-policy"]
        assert "frame-ancestors 'none'" in csp and "object-src 'none'" in csp
        assert "'unsafe-inline'" not in csp and "'unsafe-eval'" not in csp  # renders untrusted DNS data
        assert "connect-src 'self';" in csp


def test_spline_page_is_isolated_with_its_own_policy(tmp_path, monkeypatch):
    (tmp_path / "index.html").write_text("app")
    (tmp_path / "spline.html").write_text("scene")
    monkeypatch.setattr(main.frontend, "root", tmp_path)
    headers = client.get("/spline.html").headers
    csp = headers["content-security-policy"]
    assert "'unsafe-eval'" in csp and "https://unpkg.com" in csp and "https://*.spline.design" in csp
    assert "frame-ancestors 'self'" in csp and headers["x-frame-options"] == "SAMEORIGIN"
    # ...and none of that leaks to the dashboard itself.
    assert "unpkg.com" not in client.get("/").headers["content-security-policy"]


def test_docs_get_their_own_csp_and_https_gets_hsts():
    https = TestClient(main.app, base_url="https://testserver")
    response = https.get("/docs")
    assert "cdn.jsdelivr.net" in response.headers["content-security-policy"]
    assert response.headers["strict-transport-security"].startswith("max-age=")
    assert "strict-transport-security" not in client.get("/docs").headers


def test_request_ids_are_echoed_or_generated():
    assert client.get("/api/demo", headers={"x-request-id": "judge-req-0001"}).headers["x-request-id"] == "judge-req-0001"
    generated = client.get("/api/demo", headers={"x-request-id": "bad id!"}).headers["x-request-id"]
    assert generated != "bad id!" and len(generated) == 32


def test_oversized_request_body_is_refused():
    response = client.post("/api/v1/scan", content=b"x" * (17 * 1024), headers={"content-type": "application/json"})
    assert response.status_code == 413


def test_requests_are_logged_as_structured_records(caplog):
    with caplog.at_level(logging.INFO, logger="securemailscope.http"):
        client.get("/api/demo")
        client.get("/api/health")  # liveness polls are not logged
    records = [r for r in caplog.records if r.name == "securemailscope.http"]
    assert [r.path for r in records] == ["/api/demo"]
    assert records[0].status == 200 and records[0].client_ip and records[0].request_id
