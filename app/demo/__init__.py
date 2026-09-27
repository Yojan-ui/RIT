"""Built-in demo domains that scan with no network at all.

Each domain in ``zones.json`` uses an RFC 2606 ``.example`` name, so it can never collide
with a real domain. Its DNS records, MTA-STS policy and STARTTLS behaviour are fixed, which
makes the grade identical at every demo, including on a laptop with no Wi-Fi. The scan
still runs through the real checkers, scoring, attack paths and one-fix logic; only the
three network edges (DNS, HTTPS, SMTP) are replaced.
"""

from __future__ import annotations

import json
from functools import cache
from pathlib import Path

import httpx

from app.core.config import Settings
from app.engine.checkers.transport import ConnectFailed, TLSProbe
from app.engine.dns_resolver import DNSAnswer
from app.engine.scanner import scan_domain
from app.models.schemas import ScanResult

ZONES_PATH = Path(__file__).with_name("zones.json")


@cache
def demo_domains() -> dict[str, dict]:
    data = json.loads(ZONES_PATH.read_text())
    return {name: spec for name, spec in data.items() if not name.startswith("_")}


def is_demo(domain: str) -> bool:
    return domain in demo_domains()


class DemoResolver:
    """Answers DNS queries from a demo zone; any other name is NXDOMAIN."""

    def __init__(self, zone: dict[str, dict[str, list[str]]]) -> None:
        self.zone = zone

    async def query(self, name: str, rdtype: str, *, scope: str | None = None) -> DNSAnswer:
        records = self.zone.get(name.rstrip(".").lower())
        if records is None:
            return DNSAnswer(name=name, rdtype=rdtype, nxdomain=True)
        return DNSAnswer(name=name, rdtype=rdtype, records=list(records.get(rdtype, [])))

    async def txt(self, name: str, *, scope: str | None = None) -> DNSAnswer:
        return await self.query(name, "TXT", scope=scope)

    async def mx(self, name: str, *, scope: str | None = None) -> DNSAnswer:
        return await self.query(name, "MX", scope=scope)


def _http_client(routes: dict[str, str]) -> httpx.AsyncClient:
    def handler(request: httpx.Request) -> httpx.Response:
        body = routes.get(str(request.url))
        if body is None:
            raise httpx.ConnectError("host does not exist (demo domain)", request=request)
        return httpx.Response(200, text=body, headers={"content-type": "text/plain; charset=utf-8"})

    return httpx.AsyncClient(transport=httpx.MockTransport(handler))


def _smtp_probe(behaviour: str):
    async def probe(host: str, port: int, *, timeout: float, helo: str) -> TLSProbe:
        if behaviour == "no_starttls":
            return TLSProbe(host=host, banner=f"220 {host} ESMTP", starttls=False)
        if behaviour == "tls13":
            return TLSProbe(
                host=host, banner=f"220 {host} ESMTP", starttls=True,
                tls_version="TLSv1.3", cipher="TLS_AES_256_GCM_SHA384", cipher_bits=256,
            )
        raise ConnectFailed(f"{host}:{port}: connection refused")

    return probe


async def _egress_open(host: str, port: int, timeout: float) -> bool:
    return True


async def scan_demo(domain: str, settings: Settings, dkim_selectors: list[str] | None = None) -> ScanResult:
    spec = demo_domains()[domain]
    async with _http_client(spec["http"]) as http:
        return await scan_domain(
            domain,
            DemoResolver(spec["zone"]),  # type: ignore[arg-type]
            http,
            settings.model_copy(update={"smtp_probe_enabled": True}),
            dkim_selectors=dkim_selectors,
            smtp_probe=_smtp_probe(spec["smtp"]),
            egress_probe=_egress_open,
        )
