"""End-to-end scans of whole domains from offline fixtures (tests/fixtures/scenarios.json).

Each scenario supplies a DNS zone, HTTP routes and an SMTP behaviour, and pins the grade,
every check status and every attack path exposure the scan must produce.
"""

from __future__ import annotations

import json
import socket

import httpx
import pytest

from app.engine.checkers import transport
from app.engine.checkers.transport import ConnectFailed, TLSProbe, TransportChecker
from app.engine.scanner import scan_domain
from app.engine.scoring import score_results
from tests.conftest import FIXTURES, FakeResolver, NetworkAccessError

SCENARIOS = {k: v for k, v in json.loads((FIXTURES / "scenarios.json").read_text()).items() if not k.startswith("_")}


def _install_smtp(monkeypatch, behaviour: str) -> None:
    async def probe(host: str, port: int, *, timeout: float, helo: str) -> TLSProbe:
        if behaviour == "port25_blocked":
            raise ConnectFailed(f"{host}:{port}: connection timed out")
        if behaviour == "no_starttls":
            return TLSProbe(host=host, banner="220 mx ESMTP", starttls=False)
        assert behaviour == "tls13", behaviour
        return TLSProbe(
            host=host, banner="220 mx ESMTP", starttls=True,
            tls_version="TLSv1.3", cipher="TLS_AES_256_GCM_SHA384", cipher_bits=256,
        )

    async def egress(host: str, port: int, timeout: float) -> bool:
        return behaviour != "port25_blocked"

    monkeypatch.setattr(transport, "probe_with_fallback", probe)
    monkeypatch.setattr(TransportChecker, "egress_probe", staticmethod(egress))


async def _scan(name: str, settings, monkeypatch):
    sc = SCENARIOS[name]
    _install_smtp(monkeypatch, sc["smtp"])
    routes = {
        url: httpx.Response(200, text=body, headers={"content-type": "text/plain"}) for url, body in sc["http"].items()
    }

    def handler(request: httpx.Request) -> httpx.Response:
        if (route := routes.get(str(request.url))) is None:
            raise httpx.ConnectError("no route (test)", request=request)
        return route

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as http:
        return await scan_domain(
            sc["domain"],
            FakeResolver(sc["zone"]),  # type: ignore[arg-type]
            http,
            settings.model_copy(update={"smtp_probe_enabled": True}),
            dkim_selectors=sc["dkim_selectors"],
        )


@pytest.mark.parametrize("name", sorted(SCENARIOS))
async def test_scenario_grade_and_statuses(name, settings, monkeypatch):
    expected = SCENARIOS[name]["expected"]
    result = await _scan(name, settings, monkeypatch)

    statuses = {c.name.value: c.status.value for c in result.checks}
    assert statuses == expected["statuses"], {c.name.value: c.summary for c in result.checks}
    assert result.score.grade.value == expected["grade"]
    if "score" in expected:
        assert result.score.score == expected["score"]
    assert result.score.not_assessed == expected["not_assessed"]


@pytest.mark.parametrize("name", sorted(SCENARIOS))
async def test_scenario_attack_paths(name, settings, monkeypatch):
    expected = SCENARIOS[name]["expected"]
    result = await _scan(name, settings, monkeypatch)

    assert {p.id: p.exposure.value for p in result.attack_matrix} == expected["exposure"]
    assert [p.id for p in result.attack_paths] == [
        pid for pid, ex in expected["exposure"].items() if ex in {"exposed", "partial"}
    ]
    assert (result.one_fix.control.value if result.one_fix else None) == expected["one_fix"]


async def test_unprotected_domain_fix_is_publishable(settings, monkeypatch):
    fix = (await _scan("unprotected", settings, monkeypatch)).one_fix
    assert fix.host == "_dmarc.unprotected.test"
    assert fix.record == "v=DMARC1; p=quarantine; rua=mailto:dmarc-reports@unprotected.test"
    assert fix.score_gain > 0


async def test_blocked_port_25_is_omitted_without_deduction(settings, monkeypatch):
    """The cloud-restricted scan must score exactly what the same scan scores without transport."""
    result = await _scan("cloud_restricted", settings, monkeypatch)
    transport_result = next(c for c in result.checks if c.name.value == "transport")
    assert "blocked" in transport_result.data["reason"]
    assert len(transport_result.data["attempts"]) == 1  # the only MX was tried before blaming egress

    assert "transport" not in result.score.components
    without_transport = score_results([c for c in result.checks if c.name.value != "transport"])
    assert result.score.score == without_transport.score == 100

    path = next(p for p in result.attack_matrix if p.id == "plaintext-interception")
    assert path.fix_control is None  # nothing to fix: it is our network, not their server


def test_offline_guard_blocks_real_network():
    with pytest.raises(NetworkAccessError):
        socket.create_connection(("1.1.1.1", 53), timeout=1)
    with pytest.raises(NetworkAccessError):
        socket.getaddrinfo("example.com", 443)
