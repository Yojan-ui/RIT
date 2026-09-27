"""Async DNS collectors for MX, SPF, DKIM, DMARC, MTA-STS and TLS-RPT."""

from __future__ import annotations

import asyncio
import re

import dns.asyncresolver
import dns.exception
import dns.name
import dns.resolver

from app.analysis.parsers import has_version
from app.models import DkimKey, DkimLookup, MxHost, MxLookup, SpfLookup, TxtLookup

# Selectors used by the major providers. DKIM selectors are not enumerable via
# DNS, so anything outside this list must be supplied by the user.
COMMON_DKIM_SELECTORS = (
    "default", "dkim", "mail", "k1", "k2", "k3", "s1", "s2", "selector1", "selector2",
    "google", "fm1", "fm2", "fm3", "protonmail", "protonmail2", "zoho", "zmail",
    "mandrill", "mxvault", "smtp", "sig1", "everlytic", "pm", "20230601",
)

SPF_LOOKUP_LIMIT = 10
_SPF_LOOKUP_MECHANISMS = {"include", "a", "mx", "ptr", "exists"}
_MAX_MX_HOSTS = 10


class DomainNotFound(Exception):
    pass


class DnsError(Exception):
    pass


class DnsTransientError(DnsError):
    """Timeout or SERVFAIL: the answer is unknown, not wrong (SPF 'temperror')."""


class DnsClient:
    def __init__(self, timeout: float) -> None:
        self._resolver = dns.asyncresolver.Resolver()
        self._resolver.lifetime = timeout

    async def resolve(self, name: str, rdtype: str):
        """Return the answer, or None for NXDOMAIN / no data. Raise DnsError otherwise."""
        try:
            return await self._resolver.resolve(name, rdtype)
        except (dns.resolver.NXDOMAIN, dns.resolver.NoAnswer):
            return None
        except dns.exception.Timeout:
            raise DnsTransientError(f"{rdtype} lookup for {name} timed out") from None
        except dns.resolver.NoNameservers:
            raise DnsTransientError(f"No nameserver answered the {rdtype} query for {name} (SERVFAIL)") from None
        except dns.exception.DNSException as exc:
            raise DnsTransientError(f"{rdtype} lookup for {name} failed: {exc}") from None

    async def txt(self, name: str) -> list[str]:
        answer = await self.resolve(name, "TXT")
        if answer is None:
            return []
        return [b"".join(rdata.strings).decode("utf-8", "replace") for rdata in answer]

    async def addresses(self, name: str) -> list[str]:
        results = await asyncio.gather(self.resolve(name, "A"), self.resolve(name, "AAAA"), return_exceptions=True)
        out: list[str] = []
        for answer in results:
            if isinstance(answer, Exception) or answer is None:
                continue
            out.extend(rdata.address for rdata in answer)
        return out


async def collect_txt(client: DnsClient, name: str) -> TxtLookup:
    try:
        return TxtLookup(records=await client.txt(name))
    except DnsError as exc:
        return TxtLookup(error=str(exc))


async def collect_mx(client: DnsClient, domain: str) -> MxLookup:
    """Also serves as the existence check: raises DomainNotFound on NXDOMAIN."""
    try:
        answer = await client._resolver.resolve(domain, "MX")
    except dns.resolver.NXDOMAIN:
        raise DomainNotFound(domain) from None
    except dns.resolver.NoAnswer:
        return MxLookup()
    except dns.exception.DNSException as exc:
        return MxLookup(error=f"MX lookup failed: {exc.__class__.__name__}")

    records = sorted((r.preference, r.exchange) for r in answer)
    if len(records) == 1 and records[0][1] == dns.name.root:
        return MxLookup(null_mx=True)

    records = records[:_MAX_MX_HOSTS]
    names = [exchange.to_text(omit_final_dot=True).lower() for _, exchange in records]
    addresses = await asyncio.gather(*(client.addresses(name) for name in names))
    return MxLookup(
        hosts=[MxHost(preference=pref, host=name, addresses=addrs)
               for (pref, _), name, addrs in zip(records, names, addresses)]
    )


def _spf_records(txt: list[str]) -> list[str]:
    return [r for r in txt if has_version(r, "spf1")]


async def _count_spf_lookups(client: DnsClient, domain: str, budget: list[int], depth: int) -> None:
    """Walk include:/redirect= chains, spending from `budget` (a 1-item counter)."""
    if depth > 10:
        raise DnsError("SPF include chain is nested more than 10 levels deep")
    records = _spf_records(await client.txt(domain))
    if len(records) != 1:
        raise DnsError(f"{domain} publishes {len(records)} SPF records (referenced via include/redirect)")

    for term in records[0].split()[1:]:
        if budget[0] > SPF_LOOKUP_LIMIT:
            return
        term = term.lower().lstrip("+-~?")
        if term.startswith("redirect="):
            budget[0] += 1
            target = term.split("=", 1)[1]
            if "%{" not in target:
                await _count_spf_lookups(client, target, budget, depth + 1)
            continue
        mechanism = re.split(r"[:/]", term, maxsplit=1)[0]
        if mechanism in _SPF_LOOKUP_MECHANISMS:
            budget[0] += 1
            if mechanism == "include":
                target = term.split(":", 1)[1] if ":" in term else ""
                if target and "%{" not in target:
                    await _count_spf_lookups(client, target, budget, depth + 1)


async def collect_spf(client: DnsClient, domain: str, *, walk_budget: float = 10.0) -> SpfLookup:
    try:
        records = _spf_records(await client.txt(domain))
    except DnsError as exc:
        return SpfLookup(error=str(exc))
    result = SpfLookup(records=records)
    if len(records) == 1:
        budget = [0]
        try:
            # include: chains resolve sequentially; cap the whole walk.
            await asyncio.wait_for(_count_spf_lookups(client, domain, budget, depth=0), timeout=walk_budget)
            result.lookup_count = budget[0]
        except (DnsTransientError, TimeoutError) as exc:
            # Unknown, not broken: don't let a slow nameserver turn SPF into a permerror.
            result.lookup_incomplete = True
            result.lookup_error = str(exc) or f"SPF include walk exceeded {walk_budget:.0f}s"
        except DnsError as exc:
            result.lookup_error = str(exc)
            result.lookup_count = budget[0]
    return result


async def collect_dkim(client: DnsClient, domain: str, extra_selectors: list[str]) -> DkimLookup:
    selectors = list(dict.fromkeys([*extra_selectors, *COMMON_DKIM_SELECTORS]))
    results = await asyncio.gather(
        *(client.txt(f"{selector}._domainkey.{domain}") for selector in selectors), return_exceptions=True
    )
    keys: list[DkimKey] = []
    failed: list[str] = []
    for selector, records in zip(selectors, results):
        if isinstance(records, Exception):
            failed.append(selector)
            continue
        for record in records:
            # Some providers omit v=DKIM1; a p= tag is the defining feature.
            if has_version(record, "DKIM1") or re.search(r"(^|;)\s*p\s*=", record):
                keys.append(DkimKey(selector=selector, record=record))
    error = "Every DKIM selector lookup failed or timed out" if len(failed) == len(selectors) else None
    return DkimLookup(selectors_tried=selectors, keys=keys, failed_selectors=failed, error=error)
