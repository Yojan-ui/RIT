from __future__ import annotations

import base64
import copy
import ipaddress
import json
import socket
from collections.abc import Callable
from pathlib import Path

import httpx
import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ed25519, rsa
from fastapi.testclient import TestClient

from app.core.config import Settings
from app.engine.checkers.base import ScanContext
from app.engine.dns_resolver import DNSAnswer

FIXTURES = Path(__file__).parent / "fixtures"

MTA_STS_POLICY = "version: STSv1\r\nmode: enforce\r\nmx: mx1.example.com\r\nmx: *.example.com\r\nmax_age: 604800\r\n"


# -- offline guard -------------------------------------------------------------------
_LOOPBACK_NAMES = {"localhost", "localhost.localdomain"}


class NetworkAccessError(RuntimeError):
    """Raised when a test tries to reach anything other than loopback."""


def _is_loopback(host) -> bool:
    if host is None or isinstance(host, bytes):
        host = host.decode() if host else "localhost"
    if host in _LOOPBACK_NAMES:
        return True
    try:
        return ipaddress.ip_address(host.split("%")[0]).is_loopback
    except ValueError:
        return False


@pytest.fixture(autouse=True)
def _offline(monkeypatch):
    """Fail fast on real network access so the suite provably runs offline.

    Loopback stays allowed for the local SMTP servers in test_transport.py.
    """
    real_getaddrinfo = socket.getaddrinfo
    real_connect, real_connect_ex = socket.socket.connect, socket.socket.connect_ex

    def guarded_getaddrinfo(host, *args, **kwargs):
        if not _is_loopback(host):
            raise NetworkAccessError(f"test attempted DNS lookup of {host!r}")
        return real_getaddrinfo(host, *args, **kwargs)

    def check(sock, address):
        if sock.family in (socket.AF_INET, socket.AF_INET6) and not _is_loopback(address[0]):
            raise NetworkAccessError(f"test attempted to connect to {address!r}")

    def guarded_connect(sock, address):
        check(sock, address)
        return real_connect(sock, address)

    def guarded_connect_ex(sock, address):
        check(sock, address)
        return real_connect_ex(sock, address)

    monkeypatch.setattr(socket, "getaddrinfo", guarded_getaddrinfo)
    monkeypatch.setattr(socket.socket, "connect", guarded_connect)
    monkeypatch.setattr(socket.socket, "connect_ex", guarded_connect_ex)


class FakeResolver:
    """Drop-in replacement for DNSResolver backed by an in-memory zone map.

    A zone entry may contain ``"ERROR": "<msg>"`` to simulate a failed lookup.
    """

    def __init__(self, data: dict[str, dict[str, list[str]]]) -> None:
        self.data = copy.deepcopy(data)
        self.queries: list[tuple[str, str, str | None]] = []

    def add(self, name: str, rdtype: str, records: list[str]) -> None:
        self.data.setdefault(name, {})[rdtype] = list(records)

    async def query(self, name: str, rdtype: str, *, scope: str | None = None) -> DNSAnswer:
        self.queries.append((name, rdtype, scope))
        zone = self.data.get(name)
        if zone is None:
            return DNSAnswer(name=name, rdtype=rdtype, nxdomain=True, via="udp")
        if "ERROR" in zone:
            return DNSAnswer(name=name, rdtype=rdtype, error=zone["ERROR"], via="udp")
        return DNSAnswer(name=name, rdtype=rdtype, records=list(zone.get(rdtype, [])), via="udp")

    async def txt(self, name: str, *, scope: str | None = None) -> DNSAnswer:
        return await self.query(name, "TXT", scope=scope)

    async def mx(self, name: str, *, scope: str | None = None) -> DNSAnswer:
        return await self.query(name, "MX", scope=scope)


@pytest.fixture
def dns_fixture() -> dict:
    return json.loads((FIXTURES / "dns_records.json").read_text())


@pytest.fixture
def fake_resolver(dns_fixture) -> FakeResolver:
    return FakeResolver(dns_fixture)


@pytest.fixture
def http_routes() -> dict[str, httpx.Response | Callable[[httpx.Request], httpx.Response]]:
    """URL -> canned response for the mocked HTTP client. Tests may add/replace entries."""
    return {
        "https://mta-sts.example.com/.well-known/mta-sts.txt": httpx.Response(
            200, text=MTA_STS_POLICY, headers={"content-type": "text/plain; charset=utf-8"}
        )
    }


@pytest.fixture
async def http_client(http_routes):
    def handler(request: httpx.Request) -> httpx.Response:
        route = http_routes.get(str(request.url))
        if route is None:
            raise httpx.ConnectError("no route (test)", request=request)
        return route(request) if callable(route) else route

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        yield client


@pytest.fixture
def settings(tmp_path) -> Settings:
    return Settings(cache_path=tmp_path / "cache.sqlite3", smtp_probe_enabled=False)


@pytest.fixture
def make_ctx(fake_resolver, http_client, settings) -> Callable[..., ScanContext]:
    def _make(domain: str = "example.com", selectors: list[str] | None = None, **overrides) -> ScanContext:
        return ScanContext(
            domain=domain,
            resolver=fake_resolver,  # type: ignore[arg-type]
            http=http_client,
            settings=settings.model_copy(update=overrides),
            dkim_selectors=selectors or [],
        )

    return _make


# -- DKIM key material ---------------------------------------------------------
# rsa.generate_private_key refuses < 1024 bits, so this 512-bit key was made with OpenSSL.
RSA_512_SPKI_B64 = (
    "MFwwDQYJKoZIhvcNAQEBBQADSwAwSAJBANJS9tOvSvU4CovwfCZHjzz9oQRJNokVw4xgKl+VeSOiPk92YWSywCp0dTCR8jn6mqsQ3b4iFmSuW5zkxHCbLL0CAwEAAQ=="
)


def rsa_spki_b64(bits: int) -> str:
    key = rsa.generate_private_key(public_exponent=65537, key_size=bits).public_key()
    der = key.public_bytes(serialization.Encoding.DER, serialization.PublicFormat.SubjectPublicKeyInfo)
    return base64.b64encode(der).decode()


def ed25519_raw_b64() -> str:
    raw = ed25519.Ed25519PrivateKey.generate().public_key().public_bytes(
        serialization.Encoding.Raw, serialization.PublicFormat.Raw
    )
    return base64.b64encode(raw).decode()


@pytest.fixture(scope="session")
def rsa2048_b64() -> str:
    return rsa_spki_b64(2048)


@pytest.fixture(scope="session")
def rsa1024_b64() -> str:
    return rsa_spki_b64(1024)


# -- app client ---------------------------------------------------------------------
@pytest.fixture
def client(tmp_path, monkeypatch, fake_resolver, http_client, settings):
    monkeypatch.setenv("SMS_CACHE_PATH", str(tmp_path / "cache.sqlite3"))
    monkeypatch.setenv("SMS_SMTP_PROBE_ENABLED", "false")
    from app.core.config import get_settings

    get_settings.cache_clear()
    import importlib

    import app.main as main_module

    importlib.reload(main_module)
    with TestClient(main_module.app) as c:
        main_module.app.state.resolver = fake_resolver
        main_module.app.state.http = http_client
        main_module.app.state.settings = settings
        yield c
    get_settings.cache_clear()
