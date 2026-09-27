from __future__ import annotations

import asyncio
import time

import dns.message
import dns.rcode
import dns.rrset
import httpx
import pytest

from app.engine.dns_resolver import (
    DNSAnswer,
    DNSResolver,
    InvalidDomainError,
    RateLimiter,
    TokenBucket,
    normalize_domain,
    org_domain,
)
from app.models.schemas import ScanRequest


# -- normalisation ----------------------------------------------------------------
@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("Example.COM", "example.com"),
        ("  example.com  ", "example.com"),
        ("https://example.com/path?q=1#frag", "example.com"),
        ("http://example.com/", "example.com"),
        ("example.com/", "example.com"),
        ("example.com.", "example.com"),
        ("example.com:8443", "example.com"),
        ("https://user:pw@mail.example.org:443/x", "mail.example.org"),
        ("user@mail.example.org", "mail.example.org"),
        ("münchen.de", "xn--mnchen-3ya.de"),
        ("https://BÜCHER.example/", "xn--bcher-kva.example"),
        ("пример.рф", "xn--e1afmkfd.xn--p1ai"),
        ("xn--mnchen-3ya.de", "xn--mnchen-3ya.de"),
    ],
)
def test_normalize_domain(raw, expected):
    assert normalize_domain(raw) == expected


@pytest.mark.parametrize(
    "bad",
    [
        "",
        "   ",
        "localhost",
        "-bad.com",
        "bad-.com",
        "exa mple.com",
        "a" * 64 + ".com",
        "example..com",
        "example.123",
        "under_score.com",
    ],
)
def test_normalize_domain_rejects_malformed(bad):
    with pytest.raises(InvalidDomainError):
        normalize_domain(bad)


@pytest.mark.parametrize(
    "ip", ["192.0.2.1", "http://192.0.2.1/", "192.0.2.1:25", "2001:db8::1", "[2001:db8::1]", "https://[::1]:443/"]
)
def test_normalize_domain_rejects_ips(ip):
    with pytest.raises(InvalidDomainError, match="IP addresses"):
        normalize_domain(ip)


def test_scan_request_validates_domain_and_selectors():
    req = ScanRequest(domain="HTTPS://Example.com/", dkim_selectors="s1, Google  s1")
    assert req.domain == "example.com"
    assert req.dkim_selectors == ["s1", "google"]
    with pytest.raises(ValueError):
        ScanRequest(domain="example.com", dkim_selectors=["bad selector!"])


@pytest.mark.parametrize(
    ("name", "org"),
    [
        ("example.com", "example.com"),
        ("mail.eu.example.com", "example.com"),
        ("_dmarc.example.com", "example.com"),
        ("s1._domainkey.shop.example.co.uk", "example.co.uk"),
        ("example.co.uk", "example.co.uk"),
    ],
)
def test_org_domain(name, org):
    assert org_domain(name) == org


# -- rate limiting -----------------------------------------------------------------
async def test_token_bucket_allows_burst_then_throttles():
    bucket = TokenBucket(rate=20, capacity=3)
    start = time.monotonic()
    for _ in range(3):
        await bucket.acquire()
    assert time.monotonic() - start < 0.02  # burst is free
    for _ in range(2):
        await bucket.acquire()
    # Two extra tokens at 20/s take ~0.1s.
    assert 0.08 <= time.monotonic() - start < 0.5


async def test_rate_limiter_buckets_are_per_key():
    limiter = RateLimiter(rate=5, burst=1)
    await limiter.acquire("a.com")
    start = time.monotonic()
    await limiter.acquire("b.com")  # different key: its own full bucket
    assert time.monotonic() - start < 0.02
    await limiter.acquire("a.com")  # same key: waits ~1/5 s
    assert time.monotonic() - start >= 0.15


def test_token_bucket_rejects_bad_config():
    with pytest.raises(ValueError):
        TokenBucket(rate=0, capacity=1)


async def test_resolver_rate_limits_by_scope(monkeypatch):
    resolver = DNSResolver(rate_limiter=RateLimiter(rate=1000, burst=1000))
    keys: list[str] = []

    async def acquire(key):
        keys.append(key)

    async def fake_udp(name, rdtype):
        return DNSAnswer(name=name, rdtype=rdtype, via="udp"), False

    monkeypatch.setattr(resolver.rate_limiter, "acquire", acquire)
    monkeypatch.setattr(resolver, "_query_udp", fake_udp)
    await resolver.txt("_dmarc.example.com")
    await resolver.txt("s1._domainkey.example.com", scope="explicit.com")
    assert keys == ["example.com", "explicit.com"]


# -- DoH fallback ------------------------------------------------------------------
def _doh_reply(request: httpx.Request, *, rcode=dns.rcode.NOERROR, txt: list[str] | None = None) -> httpx.Response:
    query = dns.message.from_wire(request.content)
    response = dns.message.make_response(query)
    response.set_rcode(rcode)
    qname = query.question[0].name
    if txt:
        # Include a CNAME to make sure only the wanted rdtype is kept.
        response.answer.append(dns.rrset.from_text(qname, 300, "IN", "CNAME", "alias.example.net."))
        response.answer.append(dns.rrset.from_text(qname, 300, "IN", "TXT", *[f'"{t}"' for t in txt]))
    return httpx.Response(200, content=response.to_wire(), headers={"content-type": "application/dns-message"})


def _resolver_with_doh(handler, **kw) -> DNSResolver:
    client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    return DNSResolver(
        http_client=client,
        doh_endpoints=["https://doh-a.test/dns-query", "https://doh-b.test/dns-query"],
        rate_limiter=RateLimiter(rate=1000, burst=1000),
        **kw,
    )


async def test_doh_fallback_when_udp_blocked(monkeypatch):
    udp_calls = 0

    async def blocked_udp(name, rdtype):
        nonlocal udp_calls
        udp_calls += 1
        return DNSAnswer(name=name, rdtype=rdtype, error="timeout", via="udp"), True

    resolver = _resolver_with_doh(lambda req: _doh_reply(req, txt=["v=spf1 -all"]))
    monkeypatch.setattr(resolver, "_query_udp", blocked_udp)

    first = await resolver.txt("example.com")
    assert first.via == "doh" and first.records == ["v=spf1 -all"] and first.error is None
    assert resolver.udp_blocked

    second = await resolver.txt("example.com")
    assert second.via == "doh"
    assert udp_calls == 1  # sticky: UDP not retried while marked blocked


async def test_no_fallback_for_dns_level_answers(monkeypatch):
    async def nxdomain_udp(name, rdtype):
        return DNSAnswer(name=name, rdtype=rdtype, nxdomain=True, via="udp"), False

    def boom(request):
        raise AssertionError("DoH must not be used for NXDOMAIN")

    resolver = _resolver_with_doh(boom)
    monkeypatch.setattr(resolver, "_query_udp", nxdomain_udp)
    answer = await resolver.txt("missing.example.com")
    assert answer.nxdomain and answer.via == "udp"
    assert not resolver.udp_blocked


async def test_doh_endpoint_failover():
    hits: list[str] = []

    def handler(request):
        hits.append(request.url.host)
        if request.url.host == "doh-a.test":
            return httpx.Response(503)
        return _doh_reply(request, txt=["hello"])

    resolver = _resolver_with_doh(handler, mode="doh")
    answer = await resolver.txt("example.com")
    assert answer.records == ["hello"]
    assert hits == ["doh-a.test", "doh-b.test"]


async def test_doh_nxdomain_and_servfail():
    resolver = _resolver_with_doh(lambda req: _doh_reply(req, rcode=dns.rcode.NXDOMAIN), mode="doh")
    assert (await resolver.txt("nope.example.com")).nxdomain

    resolver = _resolver_with_doh(lambda req: _doh_reply(req, rcode=dns.rcode.SERVFAIL), mode="doh")
    assert (await resolver.txt("broken.example.com")).error == "SERVFAIL"


async def test_both_transports_down_reports_error(monkeypatch):
    async def blocked_udp(name, rdtype):
        return DNSAnswer(name=name, rdtype=rdtype, error="timeout", via="udp"), True

    resolver = _resolver_with_doh(lambda req: httpx.Response(502))
    monkeypatch.setattr(resolver, "_query_udp", blocked_udp)
    answer = await resolver.txt("example.com")
    assert answer.error and "timeout" in answer.error and "doh" in answer.error
    assert not resolver.udp_blocked


async def test_udp_mode_never_uses_doh(monkeypatch):
    async def blocked_udp(name, rdtype):
        return DNSAnswer(name=name, rdtype=rdtype, error="timeout", via="udp"), True

    def boom(request):
        raise AssertionError("DoH must not be used in udp mode")

    resolver = _resolver_with_doh(boom, mode="udp")
    monkeypatch.setattr(resolver, "_query_udp", blocked_udp)
    assert (await resolver.txt("example.com")).error == "timeout"


async def test_real_udp_timeout_is_classified_as_transport_failure():
    # 192.0.2.1 (TEST-NET-1) is never routed: the query times out.
    resolver = DNSResolver(timeout=0.3, nameservers=["192.0.2.1"], mode="udp")
    answer, transport_failed = await asyncio.wait_for(resolver._query_udp("example.com", "TXT"), 5)
    assert transport_failed
    assert answer.error
