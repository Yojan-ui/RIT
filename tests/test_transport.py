"""Transport checks against a real local SMTP server (asyncio) with STARTTLS."""

from __future__ import annotations

import asyncio
import datetime as dt
import ssl
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

import pytest
from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.x509.oid import NameOID

from app.engine.checkers import transport
from app.engine.checkers.transport import TransportChecker, probe_starttls
from app.engine.scoring import score_results
from app.models.enums import CheckName, CheckStatus, Severity


def _self_signed(tmp_path, *, days_valid: int, cn: str = "localhost"):
    key = ec.generate_private_key(ec.SECP256R1())
    name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, cn)])
    now = dt.datetime.now(dt.timezone.utc)
    cert = (
        x509.CertificateBuilder()
        .subject_name(name)
        .issuer_name(name)
        .public_key(key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(now - dt.timedelta(days=30))
        .not_valid_after(now + dt.timedelta(days=days_valid))
        .add_extension(x509.SubjectAlternativeName([x509.DNSName(cn)]), critical=False)
        .sign(key, hashes.SHA256())
    )
    cert_path, key_path = tmp_path / "cert.pem", tmp_path / "key.pem"
    cert_path.write_bytes(cert.public_bytes(serialization.Encoding.PEM))
    key_path.write_bytes(
        key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption())
    )
    ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    ctx.load_cert_chain(cert_path, key_path)
    return ctx


@asynccontextmanager
async def smtp_server(tls: ssl.SSLContext | None, *, banner: str = "220 mx.test ESMTP ready") -> AsyncIterator[int]:
    """Minimal ESMTP server. Advertises STARTTLS only when ``tls`` is given."""

    async def handle(reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
        try:
            writer.write(f"{banner}\r\n".encode())
            await writer.drain()
            if not banner.startswith("220"):
                return
            while line := await reader.readline():
                cmd = line.decode().strip().upper()
                if cmd.startswith("EHLO"):
                    exts = ["250-mx.test", "250-PIPELINING", "250-SIZE 10240000"]
                    if tls and writer.get_extra_info("ssl_object") is None:
                        exts.append("250-STARTTLS")
                    exts.append("250 8BITMIME")
                    writer.write(("\r\n".join(exts) + "\r\n").encode())
                elif cmd == "STARTTLS" and tls:
                    writer.write(b"220 2.0.0 Ready to start TLS\r\n")
                    await writer.drain()
                    await writer.start_tls(tls)
                    continue
                elif cmd == "QUIT":
                    writer.write(b"221 2.0.0 Bye\r\n")
                    await writer.drain()
                    return
                else:
                    writer.write(b"502 5.5.2 Command not recognized\r\n")
                await writer.drain()
        except (ConnectionError, ssl.SSLError):
            pass
        finally:
            writer.close()

    server = await asyncio.start_server(handle, "127.0.0.1", 0)
    port = server.sockets[0].getsockname()[1]
    try:
        yield port
    finally:
        server.close()
        await server.wait_closed()


@pytest.fixture
def mx_localhost(fake_resolver):
    fake_resolver.add("local.test", "MX", ["10 localhost", "20 localhost"])


def _ctx(make_ctx, port: int, **kw):
    return make_ctx("local.test", smtp_probe_enabled=True, smtp_port=port, smtp_timeout_seconds=3, **kw)


@pytest.fixture(autouse=True)
def _reset_egress_cache():
    transport._egress_cache = None
    yield
    transport._egress_cache = None


async def test_probe_extracts_tls_details(tmp_path):
    async with smtp_server(_self_signed(tmp_path, days_valid=90)) as port:
        probe = await probe_starttls("localhost", port, timeout=3, helo="scanner.test", verify=False)
    assert probe.starttls
    assert probe.tls_version in {"TLSv1.2", "TLSv1.3"}
    assert probe.cipher and probe.cipher_bits
    assert probe.cert_der


async def test_starttls_with_self_signed_cert_warns(make_ctx, mx_localhost, tmp_path):
    async with smtp_server(_self_signed(tmp_path, days_valid=90)) as port:
        result = await TransportChecker().check(_ctx(make_ctx, port))
    assert result.status is CheckStatus.WARN, result.findings
    assert result.data["starttls"] is True
    assert result.data["tls_version"] in {"TLSv1.2", "TLSv1.3"}
    assert result.data["certificate_valid"] is False
    assert "self-signed" in result.data["verify_error"]
    assert result.data["certificate"]["subject_cn"] == "localhost"
    assert 88 <= result.data["certificate"]["days_remaining"] <= 90


async def test_expired_certificate_fails(make_ctx, mx_localhost, tmp_path):
    async with smtp_server(_self_signed(tmp_path, days_valid=-1)) as port:
        result = await TransportChecker().check(_ctx(make_ctx, port))
    assert result.status is CheckStatus.FAIL
    assert any(f.title == "Certificate expired" and f.severity is Severity.HIGH for f in result.findings)


async def test_certificate_expiring_soon(make_ctx, mx_localhost, tmp_path):
    async with smtp_server(_self_signed(tmp_path, days_valid=10)) as port:
        result = await TransportChecker().check(_ctx(make_ctx, port))
    assert any("expires in" in f.title and f.severity is Severity.MEDIUM for f in result.findings)


async def test_no_starttls_fails(make_ctx, mx_localhost):
    async with smtp_server(None) as port:
        result = await TransportChecker().check(_ctx(make_ctx, port))
    assert result.status is CheckStatus.FAIL
    assert result.findings[0].title == "STARTTLS not offered"


async def test_port_25_blocked_is_not_assessed(make_ctx, mx_localhost, monkeypatch):
    """Honest degradation: MX unreachable *and* reference host unreachable => not our target's fault."""
    async with smtp_server(None) as port:
        pass  # server closed: port now refuses connections

    async def egress_blocked(host, port, timeout):
        return False

    monkeypatch.setattr(TransportChecker, "egress_probe", staticmethod(egress_blocked))
    result = await TransportChecker().check(_ctx(make_ctx, port))
    assert result.status is CheckStatus.NOT_ASSESSED
    assert "blocked" in result.data["reason"]
    assert len(result.data["attempts"]) == 2  # both MX hosts tried first

    # ...and it is removed from the denominator rather than scored as zero.
    from app.models.schemas import CheckResult

    breakdown = score_results([CheckResult(name=CheckName.DMARC, status=CheckStatus.PASS), result])
    assert breakdown.score == 100
    assert breakdown.not_assessed == ["transport"]


async def test_mx_down_but_egress_open_fails(make_ctx, mx_localhost, monkeypatch):
    async with smtp_server(None) as port:
        pass

    async def egress_open(host, port, timeout):
        return True

    monkeypatch.setattr(TransportChecker, "egress_probe", staticmethod(egress_open))
    result = await TransportChecker().check(_ctx(make_ctx, port))
    assert result.status is CheckStatus.FAIL
    assert result.findings[0].title == "MX hosts unreachable"


async def test_server_refusing_scanner_is_not_assessed(make_ctx, mx_localhost):
    async with smtp_server(None, banner="554 5.7.1 Your IP is listed on a blocklist") as port:
        result = await TransportChecker().check(_ctx(make_ctx, port))
    assert result.status is CheckStatus.NOT_ASSESSED
    assert "554" in result.data["reason"]


async def test_egress_probe_result_is_cached(monkeypatch):
    calls = 0

    async def fake_open(host, port):
        nonlocal calls
        calls += 1
        raise OSError("blocked")

    monkeypatch.setattr(transport.asyncio, "open_connection", fake_open)
    assert await transport.port25_egress_open("ref.test", 25, 1) is False
    assert await transport.port25_egress_open("ref.test", 25, 1) is False
    assert calls == 1


async def test_probe_disabled_and_null_mx(make_ctx):
    disabled = await TransportChecker().check(make_ctx("example.com", smtp_probe_enabled=False))
    assert disabled.status is CheckStatus.NOT_ASSESSED
    null_mx = await TransportChecker().check(make_ctx("nomail.test", smtp_probe_enabled=True))
    assert null_mx.status is CheckStatus.NOT_ASSESSED
    assert null_mx.summary.startswith("Not applicable")
