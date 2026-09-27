"""Rule-based narrative writer (ported from legacy/app/ai/deterministic.py).

The fallback whenever the LLM is unavailable, not configured, declines, or produces
output that fails validation. It is complete on its own: the dashboard never depends on
a live API call. Every sentence is assembled from what the engine actually found.
"""

from __future__ import annotations

from app.models.enums import CheckName, CheckStatus, Exposure
from app.models.schemas import AttackPath, CheckResult, Narrative, RemediationStep, ScanResult
from app.narrative.findings import issues

CONTROL_LABEL = {
    "mx": "MX", "spf": "SPF", "dkim": "DKIM", "dmarc": "DMARC",
    "mta_sts": "MTA-STS", "tls_rpt": "TLS-RPT", "transport": "STARTTLS",
}

SCENARIOS = {
    "dmarc.missing": "An attacker can send mail with your exact domain in the From: header and no receiving "
    "server has instructions to reject it. The usual play is an invoice or payment-detail change sent to your "
    "finance team or your customers, arriving from what looks precisely like your domain.",
    "dmarc.policy_none": "Forged mail is reported to you but still delivered. A spoofing campaign runs to "
    "completion; you find out afterwards from the aggregate reports, which is useful for forensics and useless "
    "for prevention.",
    "dmarc.partial": "Only a fraction of failing mail is acted on. An attacker sending in volume gets the "
    "remainder delivered normally.",
    "dmarc.subdomain": "The main domain is protected but its subdomains are not. An attacker registers nothing "
    "and needs nothing: they simply send as billing.<domain> or hr.<domain>, which recipients read as more "
    "official, not less.",
    "spf.missing": "Receivers have no list of authorised senders to check against, so one of the two signals "
    "DMARC depends on is simply absent.",
    "spf.all_pass": "The record explicitly authorises every host on the internet to send as your domain. An "
    "attacker's mail does not merely evade SPF, it passes it.",
    "spf.all_neutral": "Unlisted senders get a neutral result, which receivers weigh the same as having no "
    "policy at all.",
    "spf.softfail": "Mail from servers you haven't listed is marked suspicious rather than rejected, so the "
    "decision falls to each receiver's spam filter.",
    "spf.broken": "Receivers abandon SPF evaluation with a permanent error, so the whole record stops protecting "
    "the domain, including the senders correctly listed in it.",
    "dkim.missing": "Without a DKIM signature, forwarded mail loses SPF alignment and DMARC has only one signal "
    "left, which increases both spoofing exposure and false rejections of your own legitimate mail.",
    "dkim.weak": "A key this short can be factored. An attacker who recovers the private key signs forged mail "
    "that verifies as genuine and passes DMARC alignment, making the forgery indistinguishable from real mail.",
    "dkim.short": "A 1024-bit key is within reach of a well-resourced attacker; recovering it would let them sign "
    "forged mail that verifies correctly.",
    "mta_sts.missing": "Without MTA-STS, an on-path attacker strips the STARTTLS advertisement from your server's "
    "greeting. The sending server sees a host that does not support TLS, falls back to cleartext, and delivers "
    "the message in the clear. Neither side sees an error.",
    "mta_sts.testing": "Failures are reported but delivery proceeds over the downgraded connection, so the "
    "downgrade is observed rather than prevented.",
    "mta_sts.unreachable": "Senders that cannot fetch the policy fall back to opportunistic TLS, so the "
    "protection the DNS record advertises is not actually in effect.",
    "transport.no_starttls": "Mail to this host crosses the internet in cleartext. Anyone on the network path "
    "reads message bodies and attachments, including password-reset links.",
    "transport.weak": "The mail server's encryption is weakened (legacy protocol, weak cipher or a certificate "
    "that doesn't validate), so an on-path attacker can attack the connection or impersonate the server.",
    "reporting.dmarc": "Nobody receives the daily reports naming the hosts that send as your domain, so an ongoing "
    "spoofing campaign produces no signal your team can act on.",
    "reporting.tls": "No one receives reports of failed TLS negotiations, so a downgrade attack or an expired "
    "certificate on your MX produces no alert to your team.",
}


def _has(check: CheckResult | None, *needles: str) -> bool:
    return bool(check) and any(n.lower() in f.title.lower() for f in check.findings for n in needles)


def _scenario_keys(path: AttackPath, by: dict[CheckName, CheckResult]) -> list[str]:
    """Which scenarios this open path supports, chosen from the underlying check data."""
    dmarc, spf, dkim = by.get(CheckName.DMARC), by.get(CheckName.SPF), by.get(CheckName.DKIM)
    sts = by.get(CheckName.MTA_STS)
    if path.id == "direct-spoofing":
        if dmarc is None or dmarc.status is CheckStatus.MISSING:
            return ["dmarc.missing"]
        return ["dmarc.partial"] if path.exposure is Exposure.PARTIAL else ["dmarc.policy_none"]
    if path.id == "subdomain-spoofing":
        # Missing DMARC is already told by the exact-domain story.
        return [] if dmarc is None or dmarc.status is CheckStatus.MISSING else ["dmarc.subdomain"]
    if path.id == "envelope-spoofing":
        if spf is None or spf.status is CheckStatus.MISSING:
            return ["spf.missing"]
        return [{"pass": "spf.all_pass", "neutral": "spf.all_neutral", "none": "spf.all_neutral",
                 "softfail": "spf.softfail"}.get(spf.data.get("all_result", ""), "spf.broken")]
    if path.id == "unsigned-mail":
        if dkim is None or dkim.status is CheckStatus.MISSING:
            return ["dkim.missing"]
        return ["dkim.short"] if path.exposure is Exposure.PARTIAL else ["dkim.weak"]
    if path.id == "tls-downgrade":
        if sts is None or sts.status is CheckStatus.MISSING:
            return ["mta_sts.missing"]
        if sts.data.get("mode") == "testing":
            return ["mta_sts.testing"]
        return ["mta_sts.unreachable"] if _has(sts, "not retrievable") else ["mta_sts.missing"]
    if path.id == "plaintext-interception":
        return ["transport.no_starttls"] if _has(by.get(CheckName.TRANSPORT), "STARTTLS not offered") else ["transport.weak"]
    if path.id == "undetected-abuse":
        cells = path.control_exposure
        keys = []
        if cells.get(CheckName.DMARC) is Exposure.EXPOSED:
            keys.append("reporting.dmarc")
        if cells.get(CheckName.TLS_RPT) is Exposure.EXPOSED:
            keys.append("reporting.tls")
        return keys
    return []


def _join(items: list[str]) -> str:
    if len(items) <= 1:
        return "".join(items)
    return f"{', '.join(items[:-1])} and {items[-1]}"


def _not_assessed_sentence(result: ScanResult) -> str:
    names = [CONTROL_LABEL.get(n, n) for n in result.score.not_assessed]
    if not names:
        return ""
    verb = "was" if len(names) == 1 else "were"
    return (
        f" {_join(names)} could not be measured from where this scan ran, so {'it' if len(names) == 1 else 'they'} "
        f"{verb} left out of the score rather than counted as passing: a gap in coverage, not a clean result."
    )


def generate(result: ScanResult, fallback_reason: str | None = None) -> Narrative:
    found = issues(result)
    domain = result.domain
    if not found:
        assessed = [CONTROL_LABEL.get(c.name.value, c.name.value) for c in result.checks
                    if c.status not in {CheckStatus.NOT_ASSESSED, CheckStatus.ERROR}]
        summary = (
            f"{domain} passed every check this assessment was able to complete. {_join(assessed)} "
            f"{'were' if len(assessed) != 1 else 'was'} examined and found correctly configured. There is nothing "
            "to remediate." + _not_assessed_sentence(result) + " Email security is not a one-time state: "
            "certificates expire, providers change their sending infrastructure and DKIM keys need rotating, so the "
            "useful next step is scheduled re-assessment, not further hardening."
        )
        return Narrative(domain=domain, source="deterministic", summary=summary, fallback_reason=fallback_reason)

    counts = []
    for label, sev in (("critical", "critical"), ("high-severity", "high")):
        n = sum(f.finding.severity.value == sev for f in found)
        if n:
            counts.append(f"{n} {label}")
    other = sum(f.finding.severity.value not in {"critical", "high"} for f in found)
    if other:
        counts.append(f"{other} lower-severity")
    lead = found[0]
    summary = (
        f"{domain} scores {result.score.score}/100 (grade {result.score.grade.value}). The assessment found "
        f"{_join(counts)} issue{'s' if len(found) != 1 else ''}. The most consequential is "
        f"{lead.finding.title} ({CONTROL_LABEL.get(lead.check.name.value, lead.check.name.value)})"
        + (f": {lead.finding.detail}" if lead.finding.detail else ".")
    )
    exposure = {p.id: p.exposure for p in result.attack_matrix}
    spoofable = exposure.get("direct-spoofing") is Exposure.EXPOSED
    cleartext = exposure.get("plaintext-interception") is Exposure.EXPOSED
    if spoofable and cleartext:
        summary += (
            f" Taken together, the two headline problems are that mail can be forged as @{domain} without being "
            f"rejected, and that mail sent to {domain} can be read in transit. Those are separate failures with "
            "separate fixes, and both are routinely exploited."
        )
    elif spoofable:
        summary += (
            f" The practical consequence is that {domain} is currently spoofable: an attacker can put your domain "
            "in the From: header of a phishing or invoice-fraud message and receiving servers have no instruction "
            "to stop it."
        )
    elif cleartext:
        summary += (
            f" The practical consequence is that mail sent to {domain} is not reliably encrypted in transit and can "
            "be read by anyone on the network path."
        )
    summary += _not_assessed_sentence(result)

    by = {c.name: c for c in result.checks}
    scenarios: list[str] = []
    for path in result.attack_matrix:
        if path.exposure not in {Exposure.EXPOSED, Exposure.PARTIAL}:
            continue
        for key in _scenario_keys(path, by):
            text = SCENARIOS[key].replace("<domain>", domain)
            if text not in scenarios:
                scenarios.append(text)
    steps = [
        RemediationStep(
            priority=n, finding_id=f.id, title=f.finding.title, severity=f.finding.severity,
            action=f.finding.recommendation or "",
        )
        for n, f in enumerate((f for f in found if f.finding.recommendation), start=1)
    ][:8]
    return Narrative(
        domain=domain, source="deterministic", summary=summary, attack_scenarios=scenarios[:5],
        remediation_steps=steps, fallback_reason=fallback_reason,
    )
