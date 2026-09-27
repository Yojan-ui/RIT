"""Base class and shared helpers for protocol checkers."""

from __future__ import annotations

import re
from abc import ABC, abstractmethod
from collections.abc import Awaitable, Callable, Iterable
from dataclasses import dataclass, field
from typing import Any

import httpx

from app.core.config import Settings
from app.engine.dns_resolver import DNSResolver
from app.models.enums import CheckName, CheckStatus, Severity
from app.models.schemas import CheckResult, Finding


@dataclass(slots=True)
class ScanContext:
    """Everything a checker needs to inspect one domain."""

    domain: str
    resolver: DNSResolver
    http: httpx.AsyncClient
    settings: Settings
    dkim_selectors: list[str] = field(default_factory=list)
    # Optional replacements for the live SMTP probes (used by the offline demo domains).
    smtp_probe: Callable[..., Awaitable[Any]] | None = None
    egress_probe: Callable[[str, int, float], Awaitable[bool]] | None = None

    async def txt(self, name: str):
        return await self.resolver.txt(name, scope=self.domain)

    async def mx(self, name: str | None = None):
        return await self.resolver.mx(name or self.domain, scope=self.domain)

    async def has_null_mx(self) -> bool:
        """True when the domain publishes only a null MX (RFC 7505): it accepts no mail."""
        answer = await self.mx()
        return answer.records == ["0 ."]


class BaseChecker(ABC):
    name: CheckName

    @abstractmethod
    async def check(self, ctx: ScanContext) -> CheckResult: ...

    def result(self, status: CheckStatus, summary: str = "", **kwargs) -> CheckResult:
        return CheckResult(name=self.name, status=status, summary=summary, **kwargs)

    def not_applicable(self, reason: str) -> CheckResult:
        """Scored like NOT_ASSESSED: the control is meaningless for this domain."""
        return self.result(CheckStatus.NOT_ASSESSED, f"Not applicable: {reason}", data={"reason": reason})

    def dns_error(self, qname: str, error: str) -> CheckResult:
        return self.result(
            CheckStatus.ERROR,
            f"DNS lookup for {qname} failed",
            data={"error": error, "qname": qname},
        )


def status_from_findings(findings: Iterable[Finding]) -> CheckStatus:
    """CRITICAL/HIGH -> FAIL, MEDIUM -> WARN, anything else -> PASS."""
    worst = max((f.severity.rank for f in findings), default=Severity.INFO.rank)
    if worst >= Severity.HIGH.rank:
        return CheckStatus.FAIL
    if worst >= Severity.MEDIUM.rank:
        return CheckStatus.WARN
    return CheckStatus.PASS


def parse_tag_list(record: str) -> tuple[dict[str, str], list[str]]:
    """Parse a ``tag=value; tag=value`` record (DMARC, DKIM, MTA-STS, TLS-RPT).

    Returns the tags (first occurrence wins, names lowercased) and a list of problems
    such as duplicate or malformed tags.
    """
    tags: dict[str, str] = {}
    problems: list[str] = []
    for part in record.split(";"):
        part = part.strip()
        if not part:
            continue
        if "=" not in part:
            problems.append(f"malformed tag {part!r}")
            continue
        key, value = part.split("=", 1)
        key = key.strip().lower()
        if key in tags:
            problems.append(f"duplicate tag {key!r}")
            continue
        tags[key] = value.strip()
    return tags, problems


def starts_with_version(record: str, version: str) -> bool:
    """True if a TXT record begins with ``v=<version>`` followed by ``;``, space or end."""
    return re.match(rf"^\s*v\s*=\s*{re.escape(version)}\s*(;|\s|$)", record, re.IGNORECASE) is not None
