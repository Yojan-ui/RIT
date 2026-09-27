"""SMTP TLS Reporting checker (RFC 8460)."""

from __future__ import annotations

from app.core.constants import TLS_RPT_PREFIX
from app.engine.checkers.base import (
    BaseChecker,
    ScanContext,
    parse_tag_list,
    starts_with_version,
    status_from_findings,
)
from app.models.enums import CheckName, CheckStatus, Severity
from app.models.schemas import CheckResult, Finding


class TLSRPTChecker(BaseChecker):
    name = CheckName.TLS_RPT

    async def check(self, ctx: ScanContext) -> CheckResult:
        qname = f"{TLS_RPT_PREFIX}.{ctx.domain}"
        answer = await ctx.txt(qname)
        if answer.error:
            return self.dns_error(qname, answer.error)
        records = [r for r in answer.records if starts_with_version(r, "TLSRPTv1")]

        if not records and await ctx.has_null_mx():
            return self.not_applicable("the domain publishes a null MX and receives no mail")
        if not records:
            return self.result(
                CheckStatus.MISSING,
                "No TLS-RPT record",
                findings=[
                    Finding(
                        title="No TLS reporting",
                        detail="You won't hear about TLS failures or MTA-STS problems senders encounter.",
                        severity=Severity.LOW,
                        recommendation=f'Publish {qname} TXT "v=TLSRPTv1; rua=mailto:tls-reports@{ctx.domain}".',
                    )
                ],
            )
        if len(records) > 1:
            return self.result(
                CheckStatus.FAIL,
                "Multiple TLS-RPT records",
                records=records,
                findings=[
                    Finding(
                        title="Multiple TLS-RPT records",
                        detail="Senders must ignore all of them (RFC 8460 §3).",
                        severity=Severity.MEDIUM,
                    )
                ],
            )

        tags, problems = parse_tag_list(records[0])
        findings = [Finding(title="Malformed record", detail=p, severity=Severity.LOW) for p in problems]
        uris = [u.strip() for u in tags.get("rua", "").split(",") if u.strip()]
        if not uris:
            findings.append(
                Finding(title="Missing rua=", detail="rua= is required (RFC 8460 §3).", severity=Severity.MEDIUM)
            )
        bad = [u for u in uris if not u.lower().startswith(("mailto:", "https:"))]
        if bad:
            findings.append(
                Finding(
                    title="Invalid report URI",
                    detail=f"{', '.join(bad)}: only mailto: and https: are allowed.",
                    severity=Severity.MEDIUM,
                )
            )

        return self.result(
            status_from_findings(findings),
            f"Reports to {', '.join(uris)}" if uris else "Record present but unusable",
            records=records,
            findings=findings,
            data={"record": records[0], "rua": uris},
        )
