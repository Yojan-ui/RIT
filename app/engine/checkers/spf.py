"""SPF checker (RFC 7208).

Walks ``include:`` and ``redirect=`` recursively to count DNS-querying terms against
the 10-lookup limit (§4.6.4), tracks void lookups, and evaluates the effective
``all`` qualifier.
"""

from __future__ import annotations

import ipaddress
import re
from dataclasses import dataclass, field

from app.core.constants import SPF_MAX_DNS_LOOKUPS, SPF_MAX_VOID_LOOKUPS
from app.engine.checkers.base import BaseChecker, ScanContext, status_from_findings
from app.models.enums import CheckName, CheckStatus, Severity
from app.models.schemas import CheckResult, Finding

MECHANISMS = frozenset({"all", "include", "a", "mx", "ptr", "ip4", "ip6", "exists"})
LOOKUP_TERMS = frozenset({"include", "a", "mx", "ptr", "exists", "redirect"})
NEEDS_VALUE = frozenset({"include", "exists", "ip4", "ip6"})
QUALIFIER_NAMES = {"+": "pass", "-": "fail", "~": "softfail", "?": "neutral"}

_MODIFIER = re.compile(r"^([a-z][a-z0-9_.-]*)=(.*)$", re.IGNORECASE)
_SPF_VERSION = re.compile(r"^v=spf1(\s|$)", re.IGNORECASE)

# Safety valve on the recursive walk; well above anything a valid record needs.
MAX_DEPTH = 10
MAX_FETCHES = 40


def is_spf(record: str) -> bool:
    return _SPF_VERSION.match(record.strip()) is not None


@dataclass(slots=True)
class SPFTerm:
    raw: str
    name: str
    qualifier: str = "+"
    value: str | None = None
    modifier: bool = False

    @property
    def target(self) -> str | None:
        """Domain part of the term value (without any ``/cidr`` suffix)."""
        if not self.value:
            return None
        return self.value.split("/", 1)[0].rstrip(".").lower() or None


def parse_spf(record: str) -> tuple[list[SPFTerm], list[str]]:
    """Parse an SPF record into terms. Returns (terms, syntax errors)."""
    tokens = record.split()
    if not tokens or not _SPF_VERSION.match(tokens[0]):
        return [], ["record does not start with v=spf1"]

    terms: list[SPFTerm] = []
    errors: list[str] = []
    for tok in tokens[1:]:
        if m := _MODIFIER.match(tok):
            terms.append(SPFTerm(raw=tok, name=m.group(1).lower(), value=m.group(2), modifier=True))
            continue

        qualifier = "+"
        body = tok
        if tok[0] in QUALIFIER_NAMES:
            qualifier, body = tok[0], tok[1:]
        name, _, value = body.partition(":")
        name, _, cidr = name.partition("/")
        name = name.lower()
        if name not in MECHANISMS:
            errors.append(f"unknown mechanism {tok!r}")
            continue
        if name in NEEDS_VALUE and not value:
            errors.append(f"{name} requires a value in {tok!r}")
            continue
        if name == "all" and (value or cidr):
            errors.append(f"'all' takes no arguments: {tok!r}")
            continue
        if name in {"ip4", "ip6"}:
            try:
                net = ipaddress.ip_network(value, strict=False)
            except ValueError:
                errors.append(f"invalid address in {tok!r}")
                continue
            if (name == "ip4") != (net.version == 4):
                errors.append(f"address family mismatch in {tok!r}")
                continue
        terms.append(SPFTerm(raw=tok, name=name, qualifier=qualifier, value=value or None))
    return terms, errors


@dataclass
class SPFNode:
    domain: str
    record: str | None = None
    lookups: int = 0
    children: list["SPFNode"] = field(default_factory=list)

    def as_dict(self) -> dict:
        return {
            "domain": self.domain,
            "record": self.record,
            "lookups": self.lookups,
            "children": [c.as_dict() for c in self.children],
        }


@dataclass
class SPFEvaluation:
    lookups: int = 0
    void_lookups: int = 0
    fetches: int = 0
    truncated: bool = False
    permerrors: list[str] = field(default_factory=list)
    uses_ptr: bool = False
    macros: list[str] = field(default_factory=list)
    broad_networks: list[str] = field(default_factory=list)


class SPFChecker(BaseChecker):
    name = CheckName.SPF

    async def check(self, ctx: ScanContext) -> CheckResult:
        answer = await ctx.txt(ctx.domain)
        if answer.error:
            return self.dns_error(ctx.domain, answer.error)

        records = [r for r in answer.records if is_spf(r)]
        if not records:
            return self.result(
                CheckStatus.MISSING,
                "No SPF record",
                findings=[
                    Finding(
                        title="No SPF record",
                        detail="Receivers cannot tell which servers may send for this domain.",
                        severity=Severity.HIGH,
                        recommendation='Publish a TXT record such as "v=spf1 include:<provider> -all", '
                        'or "v=spf1 -all" if the domain sends no mail.',
                    )
                ],
            )

        findings: list[Finding] = []
        if len(records) > 1:
            findings.append(
                Finding(
                    title="Multiple SPF records",
                    detail="More than one v=spf1 record is a permanent error (RFC 7208 §4.5); "
                    "receivers treat SPF as broken.",
                    severity=Severity.HIGH,
                    recommendation="Merge them into a single record.",
                )
            )

        ev = SPFEvaluation()
        root = SPFNode(ctx.domain)
        effective_all = await self._walk(ctx, ctx.domain, 0, ev, root, (ctx.domain,), records[0])

        findings.extend(self._findings(ev, effective_all))
        all_label = QUALIFIER_NAMES.get(effective_all, "none") if effective_all else "none"
        return self.result(
            status_from_findings(findings),
            f"{ev.lookups}/{SPF_MAX_DNS_LOOKUPS} DNS lookups, all={all_label}",
            records=records,
            findings=findings,
            data={
                "record": records[0],
                "lookup_count": ev.lookups,
                "void_lookup_count": ev.void_lookups,
                "all_qualifier": effective_all,
                "all_result": all_label,
                "truncated": ev.truncated,
                "tree": root.as_dict(),
            },
        )

    async def _walk(
        self,
        ctx: ScanContext,
        domain: str,
        depth: int,
        ev: SPFEvaluation,
        node: SPFNode,
        chain: tuple[str, ...],
        record: str | None = None,
    ) -> str | None:
        """Walk one SPF record. Returns the qualifier of its effective ``all`` (or None)."""
        if record is None:
            ev.fetches += 1
            answer = await ctx.resolver.txt(domain)
            if answer.error:
                ev.permerrors.append(f"could not resolve SPF for {domain} ({answer.error})")
                return None
            if answer.empty:
                ev.void_lookups += 1
            spf = [r for r in answer.records if is_spf(r)]
            if not spf:
                ev.permerrors.append(f"{domain} has no SPF record")
                return None
            if len(spf) > 1:
                ev.permerrors.append(f"{domain} publishes multiple SPF records")
            record = spf[0]
        node.record = record

        terms, errors = parse_spf(record)
        ev.permerrors.extend(f"{domain}: {e}" for e in errors)

        all_qualifier: str | None = None
        redirect: str | None = None
        for term in terms:
            if term.modifier:
                if term.name == "redirect":
                    redirect = term.value
                continue
            if term.name == "all":
                all_qualifier = term.qualifier
            if term.name in {"ip4", "ip6"} and term.value:
                net = ipaddress.ip_network(term.value, strict=False)
                if net.prefixlen <= (8 if net.version == 4 else 16):
                    ev.broad_networks.append(f"{domain}: {term.raw}")
            if term.name not in LOOKUP_TERMS:
                continue

            ev.lookups += 1
            node.lookups += 1
            if term.name == "ptr":
                ev.uses_ptr = True
            if term.name == "include":
                await self._follow(ctx, term.value or "", depth, ev, node, chain)

        # RFC 7208 §6.1: redirect is ignored when the record contains "all".
        if redirect is not None and all_qualifier is None:
            ev.lookups += 1
            node.lookups += 1
            return await self._follow(ctx, redirect, depth, ev, node, chain)
        return all_qualifier

    async def _follow(
        self, ctx: ScanContext, target: str, depth: int, ev: SPFEvaluation, node: SPFNode, chain: tuple[str, ...]
    ) -> str | None:
        target = target.rstrip(".").lower()
        if "%" in target:
            ev.macros.append(target)  # macros depend on the sender; can't be expanded statically
            return None
        if target in chain:
            ev.permerrors.append(f"include loop: {' -> '.join(chain + (target,))}")
            return None
        if depth + 1 > MAX_DEPTH or ev.fetches >= MAX_FETCHES:
            ev.truncated = True
            return None
        child = SPFNode(target)
        node.children.append(child)
        return await self._walk(ctx, target, depth + 1, ev, child, chain + (target,))

    @staticmethod
    def _findings(ev: SPFEvaluation, all_q: str | None) -> list[Finding]:
        findings: list[Finding] = []
        if ev.lookups > SPF_MAX_DNS_LOOKUPS:
            findings.append(
                Finding(
                    title=f"Too many DNS lookups ({ev.lookups} > {SPF_MAX_DNS_LOOKUPS})",
                    detail="Exceeding the lookup limit is a permanent error (RFC 7208 §4.6.4); "
                    "most receivers treat the domain as having no valid SPF.",
                    severity=Severity.HIGH,
                    recommendation="Flatten includes or remove unused senders.",
                )
            )
        elif ev.lookups >= SPF_MAX_DNS_LOOKUPS - 2:
            findings.append(
                Finding(
                    title=f"Close to the lookup limit ({ev.lookups}/{SPF_MAX_DNS_LOOKUPS})",
                    detail="A provider adding a nested include could push the record over the limit.",
                    severity=Severity.LOW,
                )
            )
        if ev.void_lookups > SPF_MAX_VOID_LOOKUPS:
            findings.append(
                Finding(
                    title=f"Too many void lookups ({ev.void_lookups} > {SPF_MAX_VOID_LOOKUPS})",
                    detail="Includes that resolve to nothing count as void lookups; more than two "
                    "is a permanent error (RFC 7208 §4.6.4).",
                    severity=Severity.HIGH,
                )
            )
        for err in ev.permerrors:
            findings.append(
                Finding(
                    title="SPF permanent error",
                    detail=err,
                    severity=Severity.HIGH,
                    recommendation="Fix the record so receivers can evaluate it.",
                )
            )
        if ev.uses_ptr:
            findings.append(
                Finding(
                    title="Uses the ptr mechanism",
                    detail="'ptr' is slow, unreliable and SHOULD NOT be used (RFC 7208 §5.5).",
                    severity=Severity.LOW,
                    recommendation="Replace ptr with ip4/ip6 or include mechanisms.",
                )
            )
        for net in ev.broad_networks:
            findings.append(
                Finding(
                    title="Very broad IP range authorised",
                    detail=f"{net} authorises a huge address range to send as this domain.",
                    severity=Severity.HIGH,
                )
            )
        if ev.macros:
            findings.append(
                Finding(
                    title="Macros not evaluated",
                    detail=f"Macro terms ({', '.join(ev.macros)}) depend on the sender and were "
                    "counted but not followed.",
                    severity=Severity.INFO,
                )
            )
        if ev.truncated:
            findings.append(
                Finding(
                    title="Evaluation truncated",
                    detail="The include tree was too deep or large to walk fully; lookup counts are a minimum.",
                    severity=Severity.MEDIUM,
                )
            )

        if all_q == "+":
            findings.append(
                Finding(
                    title="+all authorises every host",
                    detail="Any server on the internet passes SPF for this domain.",
                    severity=Severity.CRITICAL,
                    recommendation="Replace +all with -all (or ~all while rolling out).",
                )
            )
        elif all_q == "?":
            findings.append(
                Finding(
                    title="?all (neutral)",
                    detail="Unauthorised senders get a neutral result, which gives receivers nothing to act on.",
                    severity=Severity.MEDIUM,
                    recommendation="Use -all (fail) or ~all (softfail).",
                )
            )
        elif all_q == "~":
            findings.append(
                Finding(
                    title="~all (softfail)",
                    detail="Unauthorised senders are marked suspicious rather than rejected. This is "
                    "fine alongside an enforcing DMARC policy; on its own, -all is stronger.",
                    severity=Severity.LOW,
                )
            )
        elif all_q is None:
            findings.append(
                Finding(
                    title="No 'all' mechanism",
                    detail="With no terminating 'all' (and no redirect), unmatched senders default to neutral.",
                    severity=Severity.MEDIUM,
                    recommendation="End the record with -all or ~all.",
                )
            )
        return findings
