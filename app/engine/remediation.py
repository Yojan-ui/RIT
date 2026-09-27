"""Pick the single change that removes the most attack-path risk ("the one fix")."""

from __future__ import annotations

from collections import defaultdict
from datetime import datetime, timezone

from app.core.constants import DMARC_PREFIX, MTA_STS_PREFIX, TLS_RPT_PREFIX
from app.engine.scoring import score_results
from app.models.enums import CheckName, CheckStatus, Exposure, Severity
from app.models.schemas import AttackPath, CheckResult, Remediation

SEVERITY_WEIGHT: dict[Severity, float] = {
    Severity.CRITICAL: 10,
    Severity.HIGH: 6,
    Severity.MEDIUM: 3,
    Severity.LOW: 1,
    Severity.INFO: 0,
}
EXPOSURE_WEIGHT: dict[Exposure, float] = {Exposure.EXPOSED: 1.0, Exposure.PARTIAL: 0.5}

# DMARC tags written first, in this order; anything else keeps its original order after them.
_DMARC_ORDER = ("v", "p", "sp", "rua")


def _top_recommendation(check: CheckResult | None) -> str | None:
    if check is None:
        return None
    ranked = sorted((f for f in check.findings if f.recommendation), key=lambda f: -f.severity.rank)
    return ranked[0].recommendation if ranked else None


def _dmarc_fix(domain: str, check: CheckResult | None) -> Remediation:
    host = f"{DMARC_PREFIX}.{domain}"
    tags: dict[str, str] = dict(check.data.get("tags") or {}) if check else {}
    if check is None or check.status is CheckStatus.MISSING or not tags:
        record = f"v=DMARC1; p=quarantine; rua=mailto:dmarc-reports@{domain}"
        return Remediation(
            control=CheckName.DMARC,
            title="Publish a DMARC policy",
            action="Tell receivers to quarantine mail that fails authentication. If you haven't reviewed "
            "DMARC reports before, run p=none for two weeks first and confirm your real senders pass.",
            host=host,
            record_type="TXT",
            record=record,
        )

    tags["v"] = "DMARC1"
    enforce = tags.get("p", "").lower() not in {"quarantine", "reject"}
    if enforce:
        tags["p"] = "quarantine"
    weak_sp = "sp" in tags and tags["sp"].lower() not in {"quarantine", "reject"}
    if weak_sp:
        tags.pop("sp")  # subdomains inherit p
    partial_pct = tags.pop("pct", "100") != "100"
    add_rua = "rua" not in tags
    if add_rua:
        tags["rua"] = f"mailto:dmarc-reports@{domain}"
    ordered = [k for k in _DMARC_ORDER if k in tags] + [k for k in tags if k not in _DMARC_ORDER]
    record = "; ".join(f"{k}={tags[k]}" for k in ordered)

    if enforce:
        title = "Enforce your DMARC policy"
        action = "Replace the existing record so failing mail is quarantined instead of delivered."
    elif weak_sp or partial_pct:
        title = "Close the gaps in your DMARC policy"
        action = "Replace the existing record so enforcement covers every subdomain and all failing mail."
    else:
        title = "Turn on DMARC reports"
        action = "Replace the existing record to add rua=, so receivers send you daily reports of who sends mail as this domain."
    if add_rua and title != "Turn on DMARC reports":
        action += " It also adds rua= so you get daily reports."
    return Remediation(control=CheckName.DMARC, title=title, action=action, host=host, record_type="TXT", record=record)


def _spf_fix(domain: str, check: CheckResult | None) -> Remediation:
    current = check.data.get("record") if check else None
    if check is None or check.status is CheckStatus.MISSING or not current:
        return Remediation(
            control=CheckName.SPF,
            title="Publish an SPF record",
            action="List the services that send your mail, then reject everything else. "
            'Replace "mx" with your provider\'s include (e.g. include:_spf.google.com).',
            host=domain,
            record_type="TXT",
            record="v=spf1 mx -all",
        )
    tokens = [t for t in current.split() if t.lower().lstrip("+-~?") != "all"]
    if check.data.get("all_result") in {"pass", "neutral", "softfail", "none"}:
        return Remediation(
            control=CheckName.SPF,
            title="End SPF with -all",
            action="Reject mail from servers you haven't listed instead of accepting or flagging it.",
            host=domain,
            record_type="TXT",
            record=" ".join([*tokens, "-all"]),
        )
    return Remediation(
        control=CheckName.SPF,
        title="Repair your SPF record",
        action=_top_recommendation(check) or "Fix the errors listed under the SPF check.",
    )


def _dkim_fix(domain: str, check: CheckResult | None) -> Remediation:
    if check is not None and check.status is not CheckStatus.MISSING and (rec := _top_recommendation(check)):
        return Remediation(control=CheckName.DKIM, title="Strengthen DKIM", action=rec)
    return Remediation(
        control=CheckName.DKIM,
        title="Turn on DKIM signing",
        action="Enable DKIM in your mail provider's admin console and publish the public key it gives you "
        f"as a TXT record at <selector>._domainkey.{domain}. Use a 2048-bit RSA key.",
    )


def _mta_sts_fix(domain: str, check: CheckResult | None) -> Remediation:
    if check is not None and check.data.get("mode") == "testing":
        return Remediation(
            control=CheckName.MTA_STS,
            title="Switch MTA-STS to enforce",
            action=f"Change mode: testing to mode: enforce in https://mta-sts.{domain}/.well-known/mta-sts.txt, "
            "then bump the id in the TXT record below so senders refetch it.",
            host=f"{MTA_STS_PREFIX}.{domain}",
            record_type="TXT",
            record=f"v=STSv1; id={datetime.now(timezone.utc):%Y%m%d}",
        )
    if check is not None and check.status is not CheckStatus.MISSING:
        return Remediation(
            control=CheckName.MTA_STS,
            title="Repair MTA-STS",
            action=_top_recommendation(check) or "Fix the errors listed under the MTA-STS check.",
        )
    return Remediation(
        control=CheckName.MTA_STS,
        title="Publish an MTA-STS policy",
        action=f"Serve a policy at https://mta-sts.{domain}/.well-known/mta-sts.txt listing your MX hosts "
        "(start with mode: testing), then publish the TXT record below.",
        host=f"{MTA_STS_PREFIX}.{domain}",
        record_type="TXT",
        record=f"v=STSv1; id={datetime.now(timezone.utc):%Y%m%d}",
    )


def _tls_rpt_fix(domain: str, check: CheckResult | None) -> Remediation:
    return Remediation(
        control=CheckName.TLS_RPT,
        title="Turn on TLS reporting",
        action="Receive daily reports from senders about TLS failures delivering to your domain.",
        host=f"{TLS_RPT_PREFIX}.{domain}",
        record_type="TXT",
        record=f"v=TLSRPTv1; rua=mailto:tls-reports@{domain}",
    )


def _transport_fix(domain: str, check: CheckResult | None) -> Remediation:
    return Remediation(
        control=CheckName.TRANSPORT,
        title="Harden TLS on your mail server",
        action=_top_recommendation(check) or "Offer STARTTLS with TLS 1.2+ and a publicly trusted certificate.",
    )


_BUILDERS = {
    CheckName.DMARC: _dmarc_fix,
    CheckName.SPF: _spf_fix,
    CheckName.DKIM: _dkim_fix,
    CheckName.MTA_STS: _mta_sts_fix,
    CheckName.TLS_RPT: _tls_rpt_fix,
    CheckName.TRANSPORT: _transport_fix,
}


def _score_gain(results: list[CheckResult], control: CheckName) -> int:
    before = score_results(results).score
    fixed = [r.model_copy(update={"status": CheckStatus.PASS}) if r.name is control else r for r in results]
    return max(0, score_results(fixed).score - before)


def pick_one_fix(domain: str, results: list[CheckResult], matrix: list[AttackPath]) -> Remediation | None:
    """Return the fix that closes the most weighted attack-path risk, or None if nothing is open."""
    risk: dict[CheckName, float] = defaultdict(float)
    closes: dict[CheckName, list[str]] = defaultdict(list)
    for path in matrix:
        weight = EXPOSURE_WEIGHT.get(path.exposure)
        if weight is None or path.fix_control not in _BUILDERS:
            continue
        risk[path.fix_control] += SEVERITY_WEIGHT[path.severity] * weight
        closes[path.fix_control].append(path.id)
    if not risk:
        return None

    gains = {control: _score_gain(results, control) for control in risk}
    best = max(risk, key=lambda c: (risk[c], gains[c]))
    by_name = {r.name: r for r in results}
    fix = _BUILDERS[best](domain, by_name.get(best))
    return fix.model_copy(update={"closes": closes[best], "score_gain": gains[best]})
