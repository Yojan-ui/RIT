"""Domain normalisation, dual-mode DNS resolution and per-domain rate limiting.

Resolution strategy (``mode="auto"``):

1. Query over classic DNS (UDP 53, with dnspython's automatic TCP retry on truncation).
2. If that fails at the *transport* level (timeout, socket error, no reachable
   nameserver), retry the same query as RFC 8484 DNS-over-HTTPS (wire format)
   against each configured DoH endpoint in turn.
3. If DoH succeeds where UDP failed, UDP is considered blocked and subsequent
   queries go straight to DoH for ``udp_blocked_ttl`` seconds.

DNS-level answers (NXDOMAIN, empty answer) are never retried over DoH: they
describe the domain, not our network.
"""

from __future__ import annotations

import asyncio
import ipaddress
import time
from collections.abc import Sequence
from dataclasses import dataclass, field
from typing import Literal

import dns.asyncresolver
import dns.exception
import dns.message
import dns.rcode
import dns.rdatatype
import dns.resolver
import httpx
import idna

from app.core.config import DEFAULT_DOH_ENDPOINTS
from app.core.constants import DOMAIN_REGEX, MULTI_LABEL_SUFFIXES
from app.core.logging import get_logger

log = get_logger("dns")

DNSMode = Literal["auto", "udp", "doh"]
Transport = Literal["udp", "doh"]


# -- input normalisation ------------------------------------------------------
class InvalidDomainError(ValueError):
    """Raised when user input cannot be turned into a valid DNS domain name."""


def _looks_like_ip(value: str) -> bool:
    try:
        ipaddress.ip_address(value)
    except ValueError:
        return False
    return True


def normalize_domain(value: str) -> str:
    """Turn loose user input into a lowercase ASCII (punycode) domain name.

    Accepts bare domains, URLs (``https://example.com/path``), email addresses,
    ``host:port`` and trailing dots. Rejects IP literals and malformed names.
    """
    if not isinstance(value, str):
        raise InvalidDomainError("domain must be a string")
    candidate = value.strip()
    if not candidate:
        raise InvalidDomainError("domain is empty")

    if "://" in candidate:
        candidate = candidate.split("://", 1)[1]
    for sep in ("/", "?", "#"):
        candidate = candidate.split(sep, 1)[0]
    # user@domain (email) or user:pass@host (URL userinfo)
    candidate = candidate.rsplit("@", 1)[-1]

    if candidate.startswith("[") or _looks_like_ip(candidate):
        raise InvalidDomainError("IP addresses are not accepted; enter a domain name")
    if candidate.count(":") == 1:
        host, port = candidate.split(":")
        if port.isdigit():
            candidate = host
    candidate = candidate.rstrip(".")
    if _looks_like_ip(candidate):
        raise InvalidDomainError("IP addresses are not accepted; enter a domain name")
    if not candidate:
        raise InvalidDomainError(f"invalid domain: {value!r}")

    try:
        ascii_name = idna.encode(candidate, uts46=True).decode("ascii").lower()
    except UnicodeError as exc:  # idna.IDNAError subclasses UnicodeError
        raise InvalidDomainError(f"invalid domain: {value!r}") from exc

    if not DOMAIN_REGEX.match(ascii_name):
        raise InvalidDomainError(f"invalid domain: {value!r}")
    return ascii_name


def org_domain(name: str) -> str:
    """Best-effort organisational domain (RFC 7489 §3.2) without the Public Suffix List."""
    labels = [label for label in name.rstrip(".").lower().split(".") if label]
    labels = [label for label in labels if not label.startswith("_")] or labels
    if len(labels) >= 3 and ".".join(labels[-2:]) in MULTI_LABEL_SUFFIXES:
        return ".".join(labels[-3:])
    return ".".join(labels[-2:])


# -- rate limiting --------------------------------------------------------------
class TokenBucket:
    """Classic token bucket: ``capacity`` burst, refilled at ``rate`` tokens/second."""

    def __init__(self, rate: float, capacity: int) -> None:
        if rate <= 0 or capacity < 1:
            raise ValueError("rate must be > 0 and capacity >= 1")
        self.rate = rate
        self.capacity = float(capacity)
        self.tokens = float(capacity)
        self.updated = time.monotonic()
        self._lock = asyncio.Lock()  # FIFO fairness between waiters

    def _refill(self) -> None:
        now = time.monotonic()
        self.tokens = min(self.capacity, self.tokens + (now - self.updated) * self.rate)
        self.updated = now

    async def acquire(self) -> None:
        async with self._lock:
            while True:
                self._refill()
                if self.tokens >= 1:
                    self.tokens -= 1
                    return
                await asyncio.sleep((1 - self.tokens) / self.rate)

    @property
    def idle(self) -> bool:
        self._refill()
        return self.tokens >= self.capacity and not self._lock.locked()


class RateLimiter:
    """A token bucket per key (normally the organisational domain being queried)."""

    def __init__(self, rate: float = 20.0, burst: int = 40, max_buckets: int = 4096) -> None:
        self.rate = rate
        self.burst = burst
        self.max_buckets = max_buckets
        self._buckets: dict[str, TokenBucket] = {}

    async def acquire(self, key: str) -> None:
        bucket = self._buckets.get(key)
        if bucket is None:
            if len(self._buckets) >= self.max_buckets:
                self._prune()
            bucket = self._buckets[key] = TokenBucket(self.rate, self.burst)
        await bucket.acquire()

    def _prune(self) -> None:
        for key in [k for k, b in self._buckets.items() if b.idle]:
            del self._buckets[key]


# -- resolution -------------------------------------------------------------------
@dataclass(slots=True)
class DNSAnswer:
    name: str
    rdtype: str
    records: list[str] = field(default_factory=list)
    nxdomain: bool = False
    error: str | None = None
    via: Transport | None = None

    @property
    def ok(self) -> bool:
        return self.error is None and not self.nxdomain

    @property
    def empty(self) -> bool:
        """True for NXDOMAIN or NOERROR/NODATA - a "void lookup" in SPF terms."""
        return self.error is None and not self.records


def render_rdata(rdtype: str, rdata) -> str:
    if rdtype == "TXT":
        # TXT records may be split into multiple <=255-byte strings; join them.
        return b"".join(rdata.strings).decode("utf-8", errors="replace")
    if rdtype == "MX":
        exchange = rdata.exchange.to_text()
        return f"{rdata.preference} {exchange if exchange == '.' else exchange.rstrip('.')}"
    return rdata.to_text()


class DNSResolver:
    def __init__(
        self,
        timeout: float = 5.0,
        nameservers: list[str] | None = None,
        *,
        mode: DNSMode = "auto",
        doh_endpoints: Sequence[str] = DEFAULT_DOH_ENDPOINTS,
        http_client: httpx.AsyncClient | None = None,
        rate_limiter: RateLimiter | None = None,
        udp_blocked_ttl: float = 300.0,
    ) -> None:
        self.timeout = timeout
        self.mode = mode
        self.doh_endpoints = list(doh_endpoints)
        self.rate_limiter = rate_limiter or RateLimiter()
        self.udp_blocked_ttl = udp_blocked_ttl
        self._udp_blocked_until = 0.0
        self._http = http_client
        self._owns_http = http_client is None

        self._resolver = dns.asyncresolver.Resolver()
        self._resolver.lifetime = timeout
        self._resolver.timeout = timeout
        if nameservers:
            self._resolver.nameservers = nameservers

    @property
    def udp_blocked(self) -> bool:
        return time.monotonic() < self._udp_blocked_until

    async def aclose(self) -> None:
        if self._owns_http and self._http is not None:
            await self._http.aclose()
            self._http = None

    def _client(self) -> httpx.AsyncClient:
        if self._http is None:
            self._http = httpx.AsyncClient(timeout=self.timeout)
            self._owns_http = True
        return self._http

    # -- public API -------------------------------------------------------------
    async def query(self, name: str, rdtype: str, *, scope: str | None = None) -> DNSAnswer:
        """Resolve ``name``/``rdtype``. ``scope`` selects the rate-limit bucket."""
        await self.rate_limiter.acquire(scope or org_domain(name))

        if self.mode == "doh" or (self.mode == "auto" and self.udp_blocked):
            return await self._query_doh(name, rdtype)

        answer, transport_failed = await self._query_udp(name, rdtype)
        if not (transport_failed and self.mode == "auto"):
            return answer

        doh_answer = await self._query_doh(name, rdtype)
        if doh_answer.error is None:
            if not self.udp_blocked:
                log.warning(
                    "UDP DNS unavailable (%s); using DoH for the next %.0fs",
                    answer.error,
                    self.udp_blocked_ttl,
                )
            self._udp_blocked_until = time.monotonic() + self.udp_blocked_ttl
            return doh_answer
        if doh_answer.error in _DNS_RCODE_ERRORS:
            # DoH got a real DNS answer (e.g. SERVFAIL): that's the domain's problem.
            return doh_answer
        answer.error = f"{answer.error}; {doh_answer.error}"
        return answer

    async def txt(self, name: str, *, scope: str | None = None) -> DNSAnswer:
        return await self.query(name, "TXT", scope=scope)

    async def mx(self, name: str, *, scope: str | None = None) -> DNSAnswer:
        return await self.query(name, "MX", scope=scope)

    # -- transports -------------------------------------------------------------
    async def _query_udp(self, name: str, rdtype: str) -> tuple[DNSAnswer, bool]:
        """Returns the answer and whether a failure (if any) was at the transport level."""
        answer = DNSAnswer(name=name, rdtype=rdtype, via="udp")
        try:
            result = await self._resolver.resolve(name, rdtype, raise_on_no_answer=False)
        except dns.resolver.NXDOMAIN:
            answer.nxdomain = True
        except dns.exception.Timeout:
            answer.error = "timeout"
            return answer, True
        except dns.resolver.NoNameservers as exc:
            # Either every server SERVFAILed or none were reachable; let DoH decide.
            answer.error = "no nameservers answered"
            log.debug("udp %s %s: %s", rdtype, name, exc)
            return answer, True
        except OSError as exc:
            answer.error = f"socket error: {exc.strerror or exc}"
            return answer, True
        except dns.exception.DNSException as exc:
            answer.error = type(exc).__name__
        else:
            answer.records = [render_rdata(rdtype, r) for r in (result.rrset or [])]
        return answer, False

    async def _query_doh(self, name: str, rdtype: str) -> DNSAnswer:
        query = dns.message.make_query(name, rdtype)
        query.id = 0  # RFC 8484 §4.1: use ID 0 for cache friendliness
        wire = query.to_wire()
        headers = {"content-type": "application/dns-message", "accept": "application/dns-message"}

        last_error = "no DoH endpoints configured"
        for url in self.doh_endpoints:
            try:
                resp = await self._client().post(url, content=wire, headers=headers, timeout=self.timeout)
                resp.raise_for_status()
                message = dns.message.from_wire(resp.content)
            except (httpx.HTTPError, dns.exception.DNSException) as exc:
                last_error = f"doh {httpx.URL(url).host}: {type(exc).__name__}"
                log.debug("doh %s %s via %s failed: %s", rdtype, name, url, exc)
                continue
            return self._from_message(name, rdtype, message)
        return DNSAnswer(name=name, rdtype=rdtype, error=last_error, via="doh")

    @staticmethod
    def _from_message(name: str, rdtype: str, message: dns.message.Message) -> DNSAnswer:
        answer = DNSAnswer(name=name, rdtype=rdtype, via="doh")
        rcode = message.rcode()
        if rcode == dns.rcode.NXDOMAIN:
            answer.nxdomain = True
            return answer
        if rcode != dns.rcode.NOERROR:
            answer.error = dns.rcode.to_text(rcode)
            return answer
        wanted = dns.rdatatype.from_text(rdtype)
        for rrset in message.answer:  # may include a CNAME chain; keep only the wanted type
            if rrset.rdtype == wanted:
                answer.records.extend(render_rdata(rdtype, r) for r in rrset)
        return answer


_DNS_RCODE_ERRORS = frozenset({"SERVFAIL", "REFUSED", "FORMERR", "NOTIMP"})
