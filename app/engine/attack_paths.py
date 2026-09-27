"""Map weak or missing controls to concrete attacker techniques."""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass

from app.models.enums import CheckName, CheckStatus, Severity
from app.models.schemas import AttackPath, CheckResult

Results = dict[CheckName, CheckResult]

_WEAK = {CheckStatus.FAIL, CheckStatus.MISSING}


def _is_weak(results: Results, name: CheckName) -> bool:
    r = results.get(name)
    return r is not None and r.status in _WEAK


@dataclass(frozen=True, slots=True)
class Rule:
    path: AttackPath
    applies: Callable[[Results], bool]


RULES: tuple[Rule, ...] = (
    Rule(
        AttackPath(
            id="direct-spoofing",
            title="Direct domain spoofing",
            description="Without an enforcing DMARC policy, attackers can send mail whose "
            "From: header uses this exact domain and receivers will likely deliver it.",
            severity=Severity.CRITICAL,
            enabled_by=[CheckName.DMARC],
        ),
        lambda r: _is_weak(r, CheckName.DMARC),
    ),
    Rule(
        AttackPath(
            id="envelope-spoofing",
            title="Envelope sender spoofing",
            description="A missing or permissive SPF record lets any host claim to send "
            "on behalf of this domain at the SMTP envelope level.",
            severity=Severity.HIGH,
            enabled_by=[CheckName.SPF],
        ),
        lambda r: _is_weak(r, CheckName.SPF),
    ),
    Rule(
        AttackPath(
            id="tls-downgrade",
            title="SMTP TLS downgrade",
            description="Without MTA-STS, an on-path attacker can strip STARTTLS and read "
            "or modify inbound mail in transit.",
            severity=Severity.MEDIUM,
            enabled_by=[CheckName.MTA_STS],
        ),
        lambda r: _is_weak(r, CheckName.MTA_STS),
    ),
)


def derive_attack_paths(results: list[CheckResult]) -> list[AttackPath]:
    by_name = {r.name: r for r in results}
    return [rule.path for rule in RULES if rule.applies(by_name)]
