"""MTA-STS checker (RFC 8461): TXT record, HTTPS policy and MX coverage."""

from __future__ import annotations

import re
from dataclasses import dataclass, field

import httpx

from app.core.constants import MTA_STS_MAX_AGE_LIMIT, MTA_STS_PREFIX
from app.engine.checkers.base import (
    BaseChecker,
    ScanContext,
    parse_tag_list,
    starts_with_version,
    status_from_findings,
)
from app.engine.checkers.mx import parse_mx
from app.models.enums import CheckName, CheckStatus, Severity
from app.models.schemas import CheckResult, Finding

_ID = re.compile(r"^[A-Za-z0-9]{1,32}$")
POLICY_PATH = "/.well-known/mta-sts.txt"
MAX_POLICY_BYTES = 64 * 1024


@dataclass
class STSPolicy:
    version: str | None = None
    mode: str | None = None
    mx: list[str] = field(default_factory=list)
    max_age: int | None = None
    errors: list[str] = field(default_factory=list)


def parse_policy(text: str) -> STSPolicy:
    """Parse an RFC 8461 §3.2 policy body (``key: value`` lines, CRLF or LF)."""
    policy = STSPolicy()
    for line in text.splitlines():
        line = line.strip()
        if not line:
            continue
        key, sep, value = line.partition(":")
        if not sep:
            policy.errors.append(f"malformed line {line!r}")
            continue
        key, value = key.strip().lower(), value.strip()
        if key == "version":
            policy.version = value
        elif key == "mode":
            policy.mode = value.lower()
        elif key == "mx":
            policy.mx.append(value.lower().rstrip("."))
        elif key == "max_age":
            try:
                policy.max_age = int(value)
            except ValueError:
                policy.errors.append(f"max_age is not an integer: {value!r}")
    if policy.version != "STSv1":
        policy.errors.append(f"version must be STSv1 (got {policy.version!r})")
    if policy.mode not in {"enforce", "testing", "none"}:
        policy.errors.append(f"mode must be enforce, testing or none (got {policy.mode!r})")
    if policy.max_age is None:
        policy.errors.append("max_age is required")
    elif not 0 <= policy.max_age <= MTA_STS_MAX_AGE_LIMIT:
        policy.errors.append(f"max_age must be between 0 and {MTA_STS_MAX_AGE_LIMIT}")
    if policy.mode in {"enforce", "testing"} and not policy.mx:
        policy.errors.append("at least one mx: line is required")
    return policy


def mx_matches(host: str, pattern: str) -> bool:
    """RFC 8461 §4.1: a leading ``*.`` matches exactly one left-most label."""
    host, pattern = host.lower().rstrip("."), pattern.lower().rstrip(".")
    if pattern.startswith("*."):
        head, _, rest = host.partition(".")
        return bool(head) and rest == pattern[2:]
    return host == pattern


class MTASTSChecker(BaseChecker):
    name = CheckName.MTA_STS

    async def check(self, ctx: ScanContext) -> CheckResult:
        qname = f"{MTA_STS_PREFIX}.{ctx.domain}"
        answer = await ctx.txt(qname)
        if answer.error:
            return self.dns_error(qname, answer.error)
        records = [r for r in answer.records if starts_with_version(r, "STSv1")]

        if not records and await ctx.has_null_mx():
            return self.not_applicable("the domain publishes a null MX and receives no mail")
        if not records:
            return self.result(
                CheckStatus.MISSING,
                "No MTA-STS policy",
                findings=[
                    Finding(
                        title="No MTA-STS",
                        detail="Sending servers use opportunistic TLS, so an on-path attacker can strip "
                        "STARTTLS and read or alter inbound mail.",
                        severity=Severity.MEDIUM,
                        recommendation=f"Publish {qname} TXT \"v=STSv1; id=<n>\" and a policy at "
                        f"https://mta-sts.{ctx.domain}{POLICY_PATH}.",
                    )
                ],
            )
        if len(records) > 1:
            return self.result(
                CheckStatus.FAIL,
                "Multiple MTA-STS records",
                records=records,
                findings=[
                    Finding(
                        title="Multiple MTA-STS TXT records",
                        detail="Senders treat this as if no policy exists (RFC 8461 §3.1).",
                        severity=Severity.HIGH,
                    )
                ],
            )

        findings: list[Finding] = []
        tags, _ = parse_tag_list(records[0])
        policy_id = tags.get("id", "")
        if not _ID.match(policy_id):
            findings.append(
                Finding(
                    title="Invalid id= in TXT record",
                    detail=f"id={policy_id!r}; must be 1-32 alphanumeric characters.",
                    severity=Severity.HIGH,
                )
            )

        url = f"https://mta-sts.{ctx.domain}{POLICY_PATH}"
        data: dict = {"record": records[0], "id": policy_id, "policy_url": url}
        policy_text, fetch_problem = await self._fetch_policy(ctx.http, url)
        if fetch_problem:
            findings.append(fetch_problem)
            return self.result(status_from_findings(findings), "Policy could not be fetched", records=records, findings=findings, data=data)

        policy = parse_policy(policy_text or "")
        data |= {"mode": policy.mode, "mx_patterns": policy.mx, "max_age": policy.max_age}
        for err in policy.errors:
            findings.append(Finding(title="Invalid policy", detail=err, severity=Severity.HIGH))

        if policy.mode == "testing":
            findings.append(
                Finding(
                    title="Policy in testing mode",
                    detail="Failures are reported (via TLS-RPT) but not enforced; downgrades still succeed.",
                    severity=Severity.MEDIUM,
                    recommendation="Switch to mode: enforce once TLS-RPT reports are clean.",
                )
            )
        elif policy.mode == "none":
            findings.append(
                Finding(title="Policy mode is none", detail="MTA-STS is effectively disabled.", severity=Severity.HIGH)
            )
        if policy.max_age is not None and 0 <= policy.max_age < 86_400:
            findings.append(
                Finding(
                    title=f"Short max_age ({policy.max_age}s)",
                    detail="Policies should be cached for weeks (RFC 8461 recommends 1 week or more) so they "
                    "survive an attacker blocking the policy fetch.",
                    severity=Severity.LOW,
                )
            )

        if policy.mx:
            mx_answer = await ctx.mx()
            hosts = [h.host for h in parse_mx(mx_answer.records) if not h.is_null]
            uncovered = [h for h in hosts if not any(mx_matches(h, p) for p in policy.mx)]
            data["uncovered_mx"] = uncovered
            if uncovered:
                findings.append(
                    Finding(
                        title="MX hosts not covered by the policy",
                        detail=f"{', '.join(uncovered)} not matched by {', '.join(policy.mx)}. "
                        + ("Senders enforcing the policy will refuse to deliver to them." if policy.mode == "enforce" else ""),
                        severity=Severity.HIGH if policy.mode == "enforce" else Severity.MEDIUM,
                        recommendation="Add matching mx: lines to the policy.",
                    )
                )

        return self.result(
            status_from_findings(findings),
            f"mode={policy.mode or '?'}, max_age={policy.max_age}",
            records=records,
            findings=findings,
            data=data,
        )

    @staticmethod
    async def _fetch_policy(http: httpx.AsyncClient, url: str) -> tuple[str | None, Finding | None]:
        def problem(detail: str) -> tuple[None, Finding]:
            return None, Finding(
                title="Policy not retrievable",
                detail=f"{url}: {detail}. Senders ignore an MTA-STS record whose policy cannot be fetched.",
                severity=Severity.HIGH,
                recommendation="Serve the policy over HTTPS with a valid certificate for mta-sts.<domain>.",
            )

        try:
            # RFC 8461 §3.3: HTTP redirects MUST NOT be followed.
            resp = await http.get(url, follow_redirects=False)
        except httpx.ConnectError as exc:
            return problem(f"connection failed ({exc.__class__.__name__}: {exc})")
        except httpx.HTTPError as exc:
            return problem(exc.__class__.__name__)
        if resp.is_redirect:
            return problem(f"redirects to {resp.headers.get('location')!r}, which senders will not follow")
        if resp.status_code != 200:
            return problem(f"HTTP {resp.status_code}")
        if len(resp.content) > MAX_POLICY_BYTES:
            return problem("policy is larger than 64 KiB")
        content_type = resp.headers.get("content-type", "")
        if not content_type.lower().startswith("text/plain"):
            return problem(f"Content-Type is {content_type!r}; it must be text/plain")
        return resp.text, None
