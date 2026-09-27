"""MX checker: presence, priorities, redundancy and null MX (RFC 7505)."""

from __future__ import annotations

import ipaddress
from dataclasses import dataclass

from app.engine.checkers.base import BaseChecker, ScanContext, status_from_findings
from app.models.enums import CheckName, CheckStatus, Severity
from app.models.schemas import CheckResult, Finding


@dataclass(frozen=True, slots=True)
class MXHost:
    preference: int
    host: str

    @property
    def is_null(self) -> bool:
        return self.host == "."


def parse_mx(records: list[str]) -> list[MXHost]:
    """Parse rendered ``"<pref> <host>"`` strings, sorted by preference then name."""
    hosts: list[MXHost] = []
    for record in records:
        pref, _, host = record.partition(" ")
        try:
            hosts.append(MXHost(int(pref), host.strip().lower() or "."))
        except ValueError:
            continue
    return sorted(hosts, key=lambda h: (h.preference, h.host))


def _is_ip_literal(host: str) -> bool:
    try:
        ipaddress.ip_address(host.strip("[]"))
    except ValueError:
        return False
    return True


class MXChecker(BaseChecker):
    name = CheckName.MX

    async def check(self, ctx: ScanContext) -> CheckResult:
        answer = await ctx.mx()
        if answer.error:
            return self.dns_error(ctx.domain, answer.error)

        hosts = parse_mx(answer.records)
        data = {"hosts": [{"preference": h.preference, "host": h.host} for h in hosts]}
        if not hosts:
            return self.result(
                CheckStatus.MISSING,
                "No MX records",
                data=data | {"nxdomain": answer.nxdomain},
                findings=[
                    Finding(
                        title="No MX records",
                        detail="Senders fall back to the domain's A/AAAA record (RFC 5321 §5.1). "
                        "If the domain does not receive mail, publish a null MX instead.",
                        severity=Severity.LOW,
                        recommendation='Publish "MX 0 ." (RFC 7505) if this domain should not receive mail.',
                    )
                ],
            )

        findings: list[Finding] = []
        nulls = [h for h in hosts if h.is_null]
        data["null_mx"] = bool(nulls)

        if nulls:
            if len(hosts) > 1:
                findings.append(
                    Finding(
                        title="Null MX mixed with other MX records",
                        detail="RFC 7505 §3 forbids publishing other MX records alongside a null MX; "
                        "senders will behave inconsistently.",
                        severity=Severity.HIGH,
                        recommendation="Remove either the null MX or the other MX records.",
                    )
                )
            elif nulls[0].preference != 0:
                findings.append(
                    Finding(
                        title="Null MX has non-zero preference",
                        detail="RFC 7505 §3 specifies preference 0 for a null MX.",
                        severity=Severity.LOW,
                    )
                )
            else:
                findings.append(
                    Finding(
                        title="Null MX: domain accepts no mail",
                        detail="The domain explicitly declares it does not receive email (RFC 7505).",
                        severity=Severity.INFO,
                    )
                )
            return self.result(
                status_from_findings(findings),
                "Null MX published" if len(hosts) == 1 else "Invalid null MX configuration",
                records=answer.records,
                findings=findings,
                data=data,
            )

        for h in hosts:
            if _is_ip_literal(h.host):
                findings.append(
                    Finding(
                        title=f"MX points to an IP address ({h.host})",
                        detail="MX targets must be hostnames (RFC 5321 §5.1); many senders will ignore it.",
                        severity=Severity.HIGH,
                        recommendation="Point the MX at a hostname with A/AAAA records.",
                    )
                )

        if len(hosts) == 1:
            findings.append(
                Finding(
                    title="Single MX host",
                    detail="Only one mail exchanger is published, so there is no failover.",
                    severity=Severity.INFO,
                )
            )
        prefs = [h.preference for h in hosts]
        if len(set(prefs)) < len(prefs):
            findings.append(
                Finding(
                    title="Equal-preference MX hosts",
                    detail="Hosts sharing a preference are load-balanced by senders.",
                    severity=Severity.INFO,
                )
            )

        return self.result(
            status_from_findings(findings),
            f"{len(hosts)} MX host{'s' if len(hosts) != 1 else ''}; primary {hosts[0].host}",
            records=answer.records,
            findings=findings,
            data=data,
        )
