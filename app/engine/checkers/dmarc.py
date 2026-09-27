"""DMARC checker (RFC 7489)."""

from __future__ import annotations

from app.core.constants import DMARC_PREFIX
from app.engine.checkers.base import (
    BaseChecker,
    ScanContext,
    parse_tag_list,
    starts_with_version,
    status_from_findings,
)
from app.engine.dns_resolver import org_domain
from app.models.enums import CheckName, CheckStatus, Severity
from app.models.schemas import CheckResult, Finding

POLICIES = ("none", "quarantine", "reject")
KNOWN_TAGS = frozenset({"v", "p", "sp", "pct", "rua", "ruf", "adkim", "aspf", "fo", "rf", "ri", "np", "psd", "t"})


def is_dmarc(record: str) -> bool:
    return starts_with_version(record, "DMARC1")


def parse_report_uris(value: str) -> list[str]:
    """Split a rua/ruf value into URIs, dropping any ``!size`` limit suffix."""
    return [u.strip().split("!", 1)[0] for u in value.split(",") if u.strip()]


class DMARCChecker(BaseChecker):
    name = CheckName.DMARC

    async def check(self, ctx: ScanContext) -> CheckResult:
        qname = f"{DMARC_PREFIX}.{ctx.domain}"
        answer = await ctx.txt(qname)
        if answer.error:
            return self.dns_error(qname, answer.error)
        records = [r for r in answer.records if is_dmarc(r)]

        # RFC 7489 §6.6.3: fall back to the organisational domain's record.
        policy_domain = ctx.domain
        inherited = False
        org = org_domain(ctx.domain)
        if not records and org != ctx.domain:
            org_answer = await ctx.txt(f"{DMARC_PREFIX}.{org}")
            records = [r for r in org_answer.records if is_dmarc(r)]
            if records:
                policy_domain, inherited = org, True

        if not records:
            return self.result(
                CheckStatus.MISSING,
                "No DMARC record",
                findings=[
                    Finding(
                        title="No DMARC record",
                        detail=f"Nothing at {qname}: receivers apply no policy to mail that spoofs this domain "
                        "and you receive no reports about it.",
                        severity=Severity.HIGH,
                        recommendation=f'Publish "v=DMARC1; p=none; rua=mailto:dmarc@{ctx.domain}" '
                        "to start monitoring, then move to quarantine/reject.",
                    )
                ],
            )

        findings: list[Finding] = []
        if len(records) > 1:
            return self.result(
                CheckStatus.FAIL,
                "Multiple DMARC records",
                records=records,
                findings=[
                    Finding(
                        title="Multiple DMARC records",
                        detail="With more than one record, receivers ignore DMARC entirely (RFC 7489 §6.6.3).",
                        severity=Severity.HIGH,
                        recommendation="Publish exactly one v=DMARC1 record.",
                    )
                ],
            )

        record = records[0]
        tags, problems = parse_tag_list(record)
        for problem in problems:
            findings.append(Finding(title="Malformed record", detail=problem, severity=Severity.MEDIUM))

        if inherited:
            findings.append(
                Finding(
                    title=f"Inherited from {policy_domain}",
                    detail=f"No record at {qname}; the organisational domain's policy applies "
                    "(its sp= tag governs subdomains).",
                    severity=Severity.INFO,
                )
            )

        p = tags.get("p", "").lower()
        sp = tags.get("sp", "").lower() or None
        if p not in POLICIES:
            findings.append(
                Finding(
                    title="Missing or invalid p= tag",
                    detail=f"p={tags.get('p')!r}; the policy tag is required and must be none, quarantine or reject.",
                    severity=Severity.HIGH,
                )
            )
        if sp is not None and sp not in POLICIES:
            findings.append(Finding(title="Invalid sp= tag", detail=f"sp={sp!r}", severity=Severity.MEDIUM))
            sp = None

        effective = (sp or p) if inherited else p
        if effective == "none":
            findings.append(
                Finding(
                    title="Policy is p=none (monitor only)",
                    detail="Spoofed mail is delivered normally; DMARC only produces reports.",
                    severity=Severity.HIGH,
                    recommendation="Once reports show legitimate mail aligning, move to p=quarantine, then p=reject.",
                )
            )
        elif effective == "quarantine":
            findings.append(
                Finding(
                    title="Policy is quarantine",
                    detail="Failing mail is sent to spam. p=reject blocks it outright.",
                    severity=Severity.LOW,
                )
            )
        if not inherited and p in {"quarantine", "reject"} and sp == "none":
            findings.append(
                Finding(
                    title="Subdomain policy sp=none",
                    detail="Subdomains (including non-existent ones) can be spoofed even though the "
                    "main domain is protected.",
                    severity=Severity.MEDIUM,
                    recommendation="Remove sp= or set it to quarantine/reject.",
                )
            )

        pct = 100
        if "pct" in tags:
            try:
                pct = int(tags["pct"])
                if not 0 <= pct <= 100:
                    raise ValueError
            except ValueError:
                findings.append(Finding(title="Invalid pct= tag", detail=f"pct={tags['pct']!r}", severity=Severity.MEDIUM))
                pct = 100
        if pct < 100 and effective in {"quarantine", "reject"}:
            findings.append(
                Finding(
                    title=f"Policy applied to only {pct}% of mail",
                    detail="The rest of failing mail is treated one level more leniently.",
                    severity=Severity.MEDIUM,
                    recommendation="Raise pct to 100 (or remove it).",
                )
            )

        for tag in ("adkim", "aspf"):
            if tag in tags and tags[tag].lower() not in {"r", "s"}:
                findings.append(
                    Finding(title=f"Invalid {tag}= tag", detail=f"{tag}={tags[tag]!r}; must be r or s.", severity=Severity.MEDIUM)
                )

        rua = parse_report_uris(tags.get("rua", ""))
        ruf = parse_report_uris(tags.get("ruf", ""))
        if not rua:
            findings.append(
                Finding(
                    title="No aggregate reporting (rua)",
                    detail="Without rua= you get no visibility into who sends mail as this domain.",
                    severity=Severity.LOW,
                    recommendation=f"Add rua=mailto:dmarc-reports@{ctx.domain}.",
                )
            )
        findings.extend(await self._check_report_destinations(ctx, policy_domain, rua + ruf))

        unknown = sorted(set(tags) - KNOWN_TAGS)
        if unknown:
            findings.append(
                Finding(title="Unknown tags ignored", detail=", ".join(unknown), severity=Severity.INFO)
            )

        return self.result(
            status_from_findings(findings),
            f"p={p or '?'}" + (f", sp={sp}" if sp else "") + (f", pct={pct}" if pct != 100 else ""),
            records=records,
            findings=findings,
            data={
                "record": record,
                "policy_domain": policy_domain,
                "inherited": inherited,
                "tags": tags,
                "policy": p or None,
                "subdomain_policy": sp,
                "effective_policy": effective or None,
                "pct": pct,
                "rua": rua,
                "ruf": ruf,
                "adkim": tags.get("adkim", "r").lower(),
                "aspf": tags.get("aspf", "r").lower(),
            },
        )

    async def _check_report_destinations(self, ctx: ScanContext, policy_domain: str, uris: list[str]) -> list[Finding]:
        findings: list[Finding] = []
        checked: set[str] = set()
        for uri in uris:
            if not uri.lower().startswith("mailto:"):
                findings.append(
                    Finding(
                        title="Unsupported report URI",
                        detail=f"{uri!r}: receivers only deliver DMARC reports to mailto: URIs in practice.",
                        severity=Severity.MEDIUM,
                    )
                )
                continue
            dest = uri[7:].rsplit("@", 1)[-1].strip().rstrip(".").lower()
            if not dest or org_domain(dest) == org_domain(policy_domain) or dest in checked:
                continue
            checked.add(dest)
            # RFC 7489 §7.1: an external destination must opt in to receive reports.
            auth = await ctx.txt(f"{policy_domain}._report._dmarc.{dest}")
            if auth.error is None and not any(is_dmarc(r) for r in auth.records):
                findings.append(
                    Finding(
                        title=f"External report destination {dest} not authorised",
                        detail=f"{policy_domain}._report._dmarc.{dest} has no v=DMARC1 record, so receivers "
                        "will not send reports there (RFC 7489 §7.1).",
                        severity=Severity.MEDIUM,
                        recommendation=f"Ask {dest} to publish the authorisation record, or report to your own domain.",
                    )
                )
        return findings
