import os
import socket
import struct

import pytest
from fastapi.testclient import TestClient

from app import analysis, main, netguard, tlsprobe
from app.tlsprobe import CertificateResult, KeyExchangeResult

# ── SSRF / input validation ──────────────────────────────────────────────────


@pytest.mark.parametrize("raw,expected", [
    ("cloudflare.com", "cloudflare.com"),
    ("  HTTPS://Google.COM/search?q=1 ", "google.com"),
    ("example.org.", "example.org"),
    ("bücher.de", "xn--bcher-kva.de"),
    ("example.org:443", "example.org"),
])
def test_normalise_accepts(raw, expected):
    assert netguard.normalise_hostname(raw) == expected


@pytest.mark.parametrize("raw", [
    "", "localhost", "127.0.0.1", "10.0.0.5", "192.168.1.1", "[::1]", "http://169.254.169.254/latest/meta-data",
    "printer.local", "db.internal", "foo", "exa mple.com", "-bad.com", "example.org:8443", "user:pw@example.org",
    "a" * 300 + ".com",
])
def test_normalise_rejects(raw):
    with pytest.raises(netguard.TargetError):
        netguard.normalise_hostname(raw)


def _fake_resolve(monkeypatch, *ips):
    def fake(host, port, type=0):
        return [(socket.AF_INET6 if ":" in ip else socket.AF_INET, socket.SOCK_STREAM, 6, "", (ip, port)) for ip in ips]
    monkeypatch.setattr(netguard.socket, "getaddrinfo", fake)


@pytest.mark.parametrize("ip", ["127.0.0.1", "10.1.2.3", "172.16.0.9", "192.168.0.1", "169.254.169.254", "100.64.0.1", "::1", "fd00::1", "::ffff:10.0.0.1", "0.0.0.0", "224.0.0.1"])
def test_resolution_to_private_is_blocked(monkeypatch, ip):
    _fake_resolve(monkeypatch, "93.184.215.14", ip)  # one bad record poisons the lot
    with pytest.raises(netguard.TargetError, match="non-public"):
        netguard.resolve_public("evil.example.com")


def test_resolution_to_public_pins_ipv4(monkeypatch):
    _fake_resolve(monkeypatch, "2606:4700::6810:84e5", "104.16.132.229")
    t = netguard.resolve_public("cloudflare.com")
    assert t.ip == "104.16.132.229" and t.family == socket.AF_INET


# ── ServerHello parsing ──────────────────────────────────────────────────────


def _record(ctype, payload, version=0x0303):
    return struct.pack("!BHH", ctype, version, len(payload)) + payload


def _hs(mtype, body):
    return bytes([mtype]) + len(body).to_bytes(3, "big") + body


def _server_hello(random, suite, exts):
    body = struct.pack("!H", 0x0303) + random + b"\x20" + b"\x00" * 32 + struct.pack("!HB", suite, 0)
    ext_bytes = b"".join(struct.pack("!HH", t, len(v)) + v for t, v in exts)
    return _hs(2, body + struct.pack("!H", len(ext_bytes)) + ext_bytes)


def test_parse_tls13_hybrid():
    sh = _server_hello(b"\x11" * 32, 0x1301, [(0x002B, b"\x03\x04"), (0x0033, struct.pack("!HH", 0x11EC, 4) + b"abcd")])
    r = tlsprobe.parse_server_flight(_record(22, sh) + _record(20, b"\x01"))
    assert (r.tls_version, r.group, r.pq_hybrid, r.cipher_suite) == ("TLS 1.3", "X25519MLKEM768", True, "TLS_AES_128_GCM_SHA256")


def test_parse_hello_retry_request():
    hrr = _server_hello(tlsprobe.HRR_RANDOM, 0x1302, [(0x002B, b"\x03\x04"), (0x0033, struct.pack("!H", 0x0017))])
    r = tlsprobe.parse_server_flight(_record(22, hrr))
    assert r.hello_retry and r.group == "secp256r1" and not r.pq_hybrid


def test_parse_tls12_ecdhe_curve():
    sh = _server_hello(b"\x22" * 32, 0xC02F, [])
    ske = _hs(12, b"\x03" + struct.pack("!H", 0x0017) + b"\x41" + b"\x04" * 65)
    r = tlsprobe.parse_server_flight(_record(22, sh + ske) + _record(22, _hs(14, b"")))
    assert (r.tls_version, r.group, r.pq_hybrid) == ("TLS 1.2", "secp256r1", False)


def test_parse_alert():
    r = tlsprobe.parse_server_flight(_record(21, b"\x02\x28"))
    assert r.alert == "handshake_failure"


def test_client_hello_offers_hybrid_share():
    hello = tlsprobe.build_client_hello("example.org")
    assert hello[:3] == b"\x16\x03\x01" and len(hello) - 5 == struct.unpack("!H", hello[3:5])[0]
    assert struct.pack("!HH", 0x11EC, 1216) in hello  # 1184-byte ML-KEM-768 key + 32-byte X25519 key
    assert b"example.org" in hello


# ── Assessment ───────────────────────────────────────────────────────────────


def _cert(key_family="ECDSA", key_name="ECDSA P-256", bits=256, sig="ecdsa-with-SHA256", sig_family="ECDSA", days=80, trusted=True):
    leaf = {
        "subject_cn": "example.org", "subject": "CN=example.org", "issuer_cn": "Test CA", "issuer_org": "Test", "issuer": "CN=Test CA",
        "not_before": "2026-01-01T00:00:00+00:00", "not_after": "2026-12-01T00:00:00+00:00", "days_remaining": days, "serial": "1",
        "sans": ["example.org"], "san_count": 1,
        "public_key": {"family": key_family, "name": key_name, "bits": bits, "oid": "1.2.840.10045.2.1"},
        "signature": {"family": sig_family, "name": sig, "oid": "1.2.840.10045.4.3.2"},
    }
    return CertificateResult(trusted=trusted, verify_error=None if trusted else "self-signed", tls_version="TLS 1.3", cipher_suite="TLS_AES_128_GCM_SHA256", leaf=leaf, chain=[])


def test_hybrid_kex_scores_60_and_is_emerald():
    kx = KeyExchangeResult(tls_version="TLS 1.3", group="X25519MLKEM768", group_code=0x11EC, pq_hybrid=True)
    a = analysis.assess("example.org", kx, _cert())
    assert a["score"] == 60 and a["color"] == "emerald" and a["status"] == "hybrid" and a["urgency"]["level"] == "MEDIUM"
    kex = a["breakdown"][0]
    assert kex["category"] == analysis.SAFE and kex["readiness"] == 100
    assert a["breakdown"][1]["category"] == analysis.SHOR


def test_classical_tls13_is_critical_amber():
    kx = KeyExchangeResult(tls_version="TLS 1.3", group="x25519", group_code=0x1D)
    a = analysis.assess("github.com", kx, _cert())
    assert a["score"] == 10 and a["color"] == "amber" and a["headline"].startswith("CRITICAL: ECDSA P-256 detected - Forgeable by CRQC")
    assert a["urgency"]["level"] == "HIGH"
    assert any("X25519MLKEM768" in r["title"] for r in a["recommendations"])


def test_legacy_rsa1024_tls12_is_crimson():
    kx = KeyExchangeResult(tls_version="TLS 1.2", group="secp256r1", group_code=0x17)
    a = analysis.assess("old.example.com", kx, _cert("RSA", "RSA-1024", 1024, "sha1WithRSAEncryption", "RSA"))
    assert a["score"] == 0 and a["color"] == "crimson" and a["urgency"]["level"] == "CRITICAL"
    assert any(r["title"] == "Enable TLS 1.3" for r in a["recommendations"])


def test_full_pqc_is_quantum_ready():
    kx = KeyExchangeResult(tls_version="TLS 1.3", group="X25519MLKEM768", group_code=0x11EC, pq_hybrid=True)
    a = analysis.assess("pq.example", kx, _cert("ML-DSA", "ML-DSA-65", None, "ML-DSA-65", "ML-DSA"))
    assert a["score"] == 100 and a["badge"] == "QUANTUM READY"


def test_cbom_is_cyclonedx():
    kx = KeyExchangeResult(tls_version="TLS 1.3", group="X25519MLKEM768", group_code=0x11EC, pq_hybrid=True, cipher_suite="TLS_AES_128_GCM_SHA256")
    cbom = analysis.build_cbom("example.org", kx, _cert())
    assert cbom["bomFormat"] == "CycloneDX" and cbom["specVersion"] == "1.6"
    rows = {r["name"]: r for r in analysis.cbom_rows(cbom)}
    assert rows["X25519MLKEM768"]["quantum_safe"] and rows["X25519MLKEM768"]["nist_level"] == 3
    assert not rows["ECDSA P-256"]["quantum_safe"]


# ── API ──────────────────────────────────────────────────────────────────────


@pytest.fixture
def client():
    main._cache.clear()
    main._hits.clear()
    return TestClient(main.app)


def test_api_rejects_ssrf_targets(client):
    for bad in ["localhost", "127.0.0.1", "192.168.0.1", "metadata.google.internal"]:
        r = client.get("/api/scan", params={"domain": bad})
        assert r.status_code == 400, bad


def test_api_scan_with_stubbed_network(client, monkeypatch):
    monkeypatch.setattr(netguard, "resolve_public", lambda h: netguard.Target(h, "93.184.215.14", socket.AF_INET))
    monkeypatch.setattr(tlsprobe, "probe_key_exchange", lambda t: KeyExchangeResult(tls_version="TLS 1.3", group="X25519MLKEM768", group_code=0x11EC, pq_hybrid=True, cipher_suite="TLS_AES_128_GCM_SHA256"))
    monkeypatch.setattr(tlsprobe, "probe_certificate", lambda t: _cert())
    r = client.get("/api/scan", params={"domain": "https://Example.org/x"}).json()
    assert r["domain"] == "example.org" and r["assessment"]["score"] == 60 and r["cached"] is False
    assert client.get("/api/scan", params={"domain": "example.org"}).json()["cached"] is True


def test_api_rate_limit(client, monkeypatch):
    monkeypatch.setattr(main, "RATE_LIMIT", 2)
    monkeypatch.setattr(netguard, "resolve_public", lambda h: (_ for _ in ()).throw(netguard.TargetError("nope")))
    codes = [client.get("/api/scan", params={"domain": f"site{i}.com"}).status_code for i in range(3)]
    assert codes == [400, 400, 429]


def test_cors_header(client):
    r = client.get("/api/health", headers={"Origin": "https://pqc-scanner.vercel.app"})
    assert r.headers.get("access-control-allow-origin") in ("*", "https://pqc-scanner.vercel.app")


@pytest.mark.skipif(os.environ.get("LIVE") != "1", reason="set LIVE=1 to hit the network")
@pytest.mark.parametrize("domain", ["google.com", "github.com"])
def test_live(client, domain):
    r = client.get("/api/scan", params={"domain": domain})
    assert r.status_code == 200
    assert r.json()["tls"]["version"] in ("TLS 1.2", "TLS 1.3")


@pytest.mark.skipif(not (main.FRONTEND_DIST / "index.html").is_file(), reason="frontend not built")
def test_serves_frontend_and_keeps_api(client):
    root = client.get("/")
    assert root.status_code == 200 and "text/html" in root.headers["content-type"] and '<div id="root">' in root.text
    assert client.get("/api/health").json() == {"status": "ok"}
    assert client.get("/docs").status_code == 200
    asset = next((main.FRONTEND_DIST / "assets").glob("*.js")).name
    assert client.get(f"/assets/{asset}").status_code == 200
