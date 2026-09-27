"""Per-vector evaluators: Observations -> CheckResult.

Each result carries `details["state"]`, a small normalised vocabulary that the
attack-path model reads, so the judgement lives in exactly one place.
"""

from __future__ import annotations

from typing import Any

from app.analysis.parsers import (
    estimate_dkim_key_bits,
    has_version,
    mx_matches_pattern,
    parse_mta_sts_policy,
    parse_spf,
    parse_tags,
)
from app.models import CheckResult, DkimLookup, MtaStsLookup, MxLookup, Observations, SpfLookup, StartTlsProbe, Status, TxtLookup

# The scoring matrix. Sums to 100; vectors that do not apply to a domain are
# removed from both numerator and denominator (see scoring.overall_score).
WEIGHTS: dict[str, int] = {
    "spf": 15,
    "dkim": 15,
    "dmarc": 25,
    "mx": 10,
    "starttls": 15,
    "mta_sts": 12,
    "tls_rpt": 8,
}

NAMES: dict[str, str] = {
    "spf": "SPF",
    "dkim": "DKIM",
    "dmarc": "DMARC",
    "mx": "MX",
    "starttls": "STARTTLS (port 25)",
    "mta_sts": "MTA-STS",
    "tls_rpt": "TLS-RPT",
}


def _result(
    check_id: str, status: Status, score: float, summary: str, *, state: str,
    findings: list[str] | None = None, records: list[str] | None = None,
    applicable: bool = True, **details: Any,
) -> CheckResult:
    score = round(min(1.0, max(0.0, score)), 2)
    weight = WEIGHTS[check_id]
    return CheckResult(
        id=check_id,
        name=NAMES[check_id],
        weight=weight,
        applicable=applicable,
        status=status,
        score=score if applicable else 0.0,
        points=round(weight * score, 2) if applicable else 0.0,
        summary=summary,
        findings=findings or [],
        records=records or [],
        details={"state": state, **details},
    )


def _not_applicable(check_id: str, summary: str, state: str = "not_applicable") -> CheckResult:
    return _result(check_id, Status.INFO, 0, summary, state=state, applicable=False)


def _unmeasured(check_id: str, error: str) -> CheckResult:
    return _result(check_id, Status.ERROR, 0, f"Could not be measured: {error}", state="unknown", applicable=False)


# --------------------------------------------------------------------------- #
# MX
# --------------------------------------------------------------------------- #


def evaluate_mx(mx: MxLookup) -> CheckResult:
    if mx.error:
        return _unmeasured("mx", mx.error)
    if mx.null_mx:
        return _result("mx", Status.INFO, 1.0, "Null MX (RFC 7505): this domain explicitly accepts no mail.",
                       state="null", records=["0 ."])
    records = [f"{h.preference} {h.host}" for h in mx.hosts]
    if not mx.hosts:
        return _result("mx", Status.FAIL, 0.2, "No MX records. Senders fall back to the domain's A record.",
                       state="missing", findings=[
                           "Publish MX records, or a null MX ('0 .') if this domain never receives mail."])
    unresolved = [h.host for h in mx.hosts if not h.addresses]
    findings = [f"{h.host} does not resolve to any address" for h in mx.hosts if not h.addresses]
    if len(mx.hosts) == 1:
        findings.append("Only one MX host; there is no failover if it goes down.")
    if len(unresolved) == len(mx.hosts):
        return _result("mx", Status.FAIL, 0.3, "No MX host resolves; inbound mail will bounce.",
                       state="broken", findings=findings, records=records)
    if unresolved:
        return _result("mx", Status.WARN, 0.7, f"{len(unresolved)} of {len(mx.hosts)} MX hosts do not resolve.",
                       state="partial", findings=findings, records=records)
    return _result("mx", Status.PASS, 1.0, f"{len(mx.hosts)} MX host(s), all resolving.",
                   state="ok", findings=findings, records=records)


# --------------------------------------------------------------------------- #
# SPF
# --------------------------------------------------------------------------- #


def evaluate_spf(spf: SpfLookup) -> CheckResult:
    if spf.error:
        return _unmeasured("spf", spf.error)
    records = [r for r in spf.records if has_version(r, "spf1")]
    if not records:
        return _result("spf", Status.FAIL, 0, "No SPF record. Anyone can send as this domain's envelope sender.",
                       state="missing")
    if len(records) > 1:
        return _result("spf", Status.FAIL, 0, f"{len(records)} SPF records published; receivers treat this as a "
                       "permanent error (RFC 7208 §4.5).", state="invalid", records=records,
                       findings=["Merge them into a single v=spf1 record."])

    record = parse_spf(records[0])
    findings: list[str] = []
    lookups = spf.lookup_count
    if spf.lookup_error:
        findings.append(spf.lookup_error)
    if any(m.lower().lstrip("+-~?").startswith("ptr") for m in record.mechanisms):
        findings.append("The ptr mechanism is deprecated and slow (RFC 7208 §5.5).")
    common = dict(records=[record.raw], lookup_count=lookups, all_qualifier=record.all_qualifier,
                  mechanisms=record.mechanisms)

    if spf.lookup_incomplete:
        findings = [f for f in findings if f != spf.lookup_error]
        findings.append(f"Could not finish counting DNS lookups ({spf.lookup_error}); the 10-lookup limit "
                        "was not checked.")
    elif (lookups is not None and lookups > 10) or spf.lookup_error:
        if lookups is not None and lookups > 10:
            findings.insert(0, f"Needs {lookups} DNS lookups; the limit is 10, so SPF evaluates to permerror.")
        return _result("spf", Status.FAIL, 0.2, "SPF record is broken (permerror); receivers ignore it.",
                       state="invalid", findings=findings, **common)
    if lookups is not None and lookups >= 8:
        findings.append(f"Uses {lookups}/10 DNS lookups; one more include could break SPF.")

    q = record.all_qualifier
    if q is None and record.redirect:
        return _result("spf", Status.WARN, 0.8, f"Policy delegated via redirect={record.redirect}.",
                       state="delegated", findings=findings, **common)
    if q == "-":
        if not record.mechanisms:
            return _result("spf", Status.PASS, 1.0, "v=spf1 -all: this domain declares it sends no mail.",
                           state="no_send", findings=findings, **common)
        return _result("spf", Status.PASS, 1.0, "Hard fail (-all): unlisted senders are rejected.",
                       state="hardfail", findings=findings, **common)
    if q == "~":
        return _result("spf", Status.WARN, 0.8, "Soft fail (~all): unlisted senders are only marked suspicious.",
                       state="softfail", findings=findings + [
                           "Fine when DMARC is enforcing; otherwise move to -all."], **common)
    if q == "+":
        return _result("spf", Status.FAIL, 0, "+all authorises every server on the internet.",
                       state="permissive", findings=findings, **common)
    summary = "?all (neutral) makes no assertion." if q == "?" else "No 'all' mechanism; the default is neutral."
    return _result("spf", Status.FAIL, 0.3, summary, state="permissive", findings=findings, **common)


# --------------------------------------------------------------------------- #
# DKIM
# --------------------------------------------------------------------------- #


def evaluate_dkim(dkim: DkimLookup, spf_state: str) -> CheckResult:
    if not dkim.keys and spf_state == "no_send":
        return _not_applicable("dkim", "Domain publishes 'v=spf1 -all' (sends no mail), so DKIM is not required.")
    if not dkim.keys and dkim.error:
        return _unmeasured("dkim", dkim.error)

    records = [f"{k.selector}._domainkey: {k.record}" for k in dkim.keys]
    valid: list[tuple[str, int | None]] = []
    findings: list[str] = []
    revoked = 0
    for key in dkim.keys:
        tags = parse_tags(key.record)
        if "p" not in tags:
            findings.append(f"Selector '{key.selector}' has no p= tag.")
        elif not tags["p"]:
            revoked += 1
            findings.append(f"Selector '{key.selector}' is revoked (empty p=).")
        else:
            bits = estimate_dkim_key_bits(tags)
            valid.append((key.selector, bits))
            if tags.get("t", "").lower().startswith("y"):
                findings.append(f"Selector '{key.selector}' is in test mode (t=y).")

    selectors = [s for s, _ in valid]
    if not valid:
        hint = "Selectors cannot be listed via DNS; if you sign with one we did not try, rescan with " \
               "?dkim_selectors=name."
        if dkim.failed_selectors:
            findings.append(f"{len(dkim.failed_selectors)} selector lookup(s) timed out or failed "
                            f"({', '.join(dkim.failed_selectors[:5])}{'…' if len(dkim.failed_selectors) > 5 else ''}); "
                            "a key there would have been missed.")
        summary = "Only revoked DKIM keys were found." if revoked else \
            f"No DKIM key found at {len(dkim.selectors_tried)} common selectors."
        return _result("dkim", Status.FAIL, 0, summary, state="missing", findings=findings + [hint],
                       records=records, selectors=[])

    sizes = [bits for _, bits in valid if bits]
    weakest = min(sizes) if sizes else None
    label = ", ".join(f"{s} ({b}-bit)" if b else s for s, b in valid)
    if weakest is not None and weakest < 1024:
        return _result("dkim", Status.FAIL, 0.3, f"DKIM key is only ~{weakest} bits and can be factored.",
                       state="weak", findings=findings, records=records, selectors=selectors, min_bits=weakest)
    if weakest is not None and weakest < 2048:
        return _result("dkim", Status.WARN, 0.7, f"DKIM signing found ({label}); rotate to 2048-bit.",
                       state="weak", findings=findings, records=records, selectors=selectors, min_bits=weakest)
    return _result("dkim", Status.PASS, 1.0, f"DKIM signing keys found: {label}.", state="ok",
                   findings=findings, records=records, selectors=selectors, min_bits=weakest)


# --------------------------------------------------------------------------- #
# DMARC
# --------------------------------------------------------------------------- #

_POLICIES = ("none", "quarantine", "reject")


def evaluate_dmarc(dmarc: TxtLookup, *, has_auth: bool) -> CheckResult:
    if dmarc.error:
        return _unmeasured("dmarc", dmarc.error)
    records = [r for r in dmarc.records if has_version(r, "DMARC1")]
    if not records:
        return _result("dmarc", Status.FAIL, 0, "No DMARC record. Receivers have no instruction to reject spoofed "
                       "mail using this exact domain.", state="missing", tags={})
    if len(records) > 1:
        return _result("dmarc", Status.FAIL, 0, "Multiple DMARC records; receivers ignore all of them.",
                       state="missing", records=records, tags={})

    tags = parse_tags(records[0])
    policy = tags.get("p", "").lower()
    if policy not in _POLICIES:
        return _result("dmarc", Status.FAIL, 0, f"Invalid DMARC policy p={policy or '(missing)'}.",
                       state="missing", records=records, tags=tags)
    sp = tags.get("sp", policy).lower()
    if sp not in _POLICIES:
        sp = policy
    try:
        pct = max(0, min(100, int(tags.get("pct", "100"))))
    except ValueError:
        pct = 100
    has_rua = bool(tags.get("rua"))

    findings: list[str] = []
    score = {"none": 0.3, "quarantine": 0.8, "reject": 1.0}[policy]
    if policy != "none" and pct < 100:
        score *= 0.5 + 0.5 * pct / 100
        findings.append(f"pct={pct}: the policy only applies to {pct}% of failing mail.")
    if policy != "none" and sp == "none":
        score -= 0.15
        findings.append("sp=none leaves every subdomain spoofable.")
    if not has_rua:
        score -= 0.1
        findings.append("No rua= address, so you receive no aggregate reports about spoofing attempts.")
    if policy != "none" and not has_auth:
        findings.append("Enforcing DMARC without working SPF or DKIM will reject your own legitimate mail.")

    common = dict(state=policy, records=records, findings=findings, tags=tags, pct=pct, sp=sp, rua=has_rua)
    if policy == "none":
        status = Status.WARN if has_rua else Status.FAIL
        return _result("dmarc", status, score, "p=none: monitoring only. Spoofed mail is still delivered.", **common)
    label = "Reject" if policy == "reject" else "Quarantine"
    status = Status.PASS if pct == 100 and sp != "none" else Status.WARN
    return _result("dmarc", status, score, f"{label} policy: receivers act on mail that fails DMARC.", **common)


# --------------------------------------------------------------------------- #
# STARTTLS
# --------------------------------------------------------------------------- #


def evaluate_starttls(probe: StartTlsProbe | None, receives_mail: bool) -> CheckResult:
    if not receives_mail:
        return _not_applicable("starttls", "Domain does not receive mail; nothing to probe.")
    if probe is None:
        return _unmeasured("starttls", "No MX host was available to probe.")
    target = f"{probe.host} ({probe.ip})" if probe.ip else probe.host
    details = probe.model_dump(exclude={"host"})
    if not probe.reachable:
        return _result("starttls", Status.ERROR, 0,
                       f"Could not reach {target} on port 25: {probe.error or 'unknown error'}. Many networks block "
                       "outbound port 25, so this vector is excluded from the score.",
                       state="unknown", applicable=False, host=probe.host)
    if probe.error and not probe.tls_version:
        state = "missing" if not probe.starttls_offered else "broken"
        return _result("starttls", Status.FAIL, 0, f"{target}: {probe.error}", state=state, host=probe.host, **details)
    if not probe.starttls_offered:
        return _result("starttls", Status.FAIL, 0, f"{target} does not offer STARTTLS; mail arrives in cleartext.",
                       state="missing", host=probe.host, **details)

    findings: list[str] = []
    score, state = 1.0, "ok"
    if probe.tls_version in {"TLSv1", "TLSv1.1", "SSLv3"}:
        score, state = 0.4, "legacy_tls"
        findings.append(f"Negotiated {probe.tls_version}, which is deprecated (RFC 8996).")
    if probe.cert_valid is False or (probe.cert_valid is None and probe.cert_error):
        score = min(score, 0.6)
        state = "bad_cert" if state == "ok" else state
        findings.append(f"Certificate would fail MTA-STS validation: {probe.cert_error}.")
    status = Status.PASS if score == 1.0 else Status.WARN
    summary = f"{target} negotiates {probe.tls_version} ({probe.cipher})."
    return _result("starttls", status, score, summary, state=state, findings=findings, host=probe.host, **details)


# --------------------------------------------------------------------------- #
# MTA-STS
# --------------------------------------------------------------------------- #


def evaluate_mta_sts(mta_sts: MtaStsLookup, mx: MxLookup, receives_mail: bool) -> CheckResult:
    if not receives_mail:
        return _not_applicable("mta_sts", "Domain does not receive mail; MTA-STS is not needed.")
    if mta_sts.txt.error:
        return _unmeasured("mta_sts", mta_sts.txt.error)
    records = [r for r in mta_sts.txt.records if has_version(r, "STSv1")]
    if not records:
        return _result("mta_sts", Status.FAIL, 0, "No MTA-STS record. An attacker on the network path can strip "
                       "STARTTLS and read inbound mail.", state="missing")
    findings: list[str] = []
    if len(records) > 1:
        findings.append("Multiple _mta-sts TXT records; senders will ignore MTA-STS.")
    if not parse_tags(records[0]).get("id"):
        findings.append("The _mta-sts TXT record is missing its id= tag.")
    if mta_sts.policy is None:
        return _result("mta_sts", Status.FAIL, 0.1, f"TXT record exists but the policy file is unavailable: "
                       f"{mta_sts.policy_error or 'unknown error'}.", state="broken", records=records, findings=findings)

    policy = parse_mta_sts_policy(mta_sts.policy)
    common = dict(records=records + [mta_sts.policy.strip()], mode=policy.mode, mx_patterns=policy.mx,
                  max_age=policy.max_age)
    if policy.version != "STSv1" or policy.mode not in {"none", "testing", "enforce"}:
        return _result("mta_sts", Status.FAIL, 0.1, "Policy file is malformed (bad version or mode).",
                       state="broken", findings=findings, **common)
    if policy.max_age is not None and policy.max_age < 86400:
        findings.append(f"max_age={policy.max_age}s is under a day; senders re-fetch too often to be protected.")
    if policy.mode == "none":
        return _result("mta_sts", Status.WARN, 0.2, "MTA-STS mode is 'none' (policy withdrawn).",
                       state="none", findings=findings, **common)
    uncovered = [h.host for h in mx.hosts if not any(mx_matches_pattern(h.host, p) for p in policy.mx)]
    if uncovered:
        findings.append(f"Policy does not list MX host(s): {', '.join(uncovered)}.")
    if policy.mode == "testing":
        return _result("mta_sts", Status.WARN, 0.5, "MTA-STS in testing mode: failures are reported, not blocked.",
                       state="testing", findings=findings, **common)
    if uncovered:
        return _result("mta_sts", Status.FAIL, 0.2, "Enforce policy does not cover every MX; compliant senders "
                       "will refuse to deliver to those hosts.", state="broken", findings=findings, **common)
    return _result("mta_sts", Status.PASS, 1.0, "MTA-STS enforced: senders refuse unencrypted or unverified delivery.",
                   state="enforce", findings=findings, **common)


# --------------------------------------------------------------------------- #
# TLS-RPT
# --------------------------------------------------------------------------- #


def evaluate_tls_rpt(tls_rpt: TxtLookup, receives_mail: bool) -> CheckResult:
    if not receives_mail:
        return _not_applicable("tls_rpt", "Domain does not receive mail; TLS reporting is not needed.")
    if tls_rpt.error:
        return _unmeasured("tls_rpt", tls_rpt.error)
    records = [r for r in tls_rpt.records if has_version(r, "TLSRPTv1")]
    if not records:
        return _result("tls_rpt", Status.FAIL, 0, "No TLS-RPT record; failed or downgraded TLS deliveries go unseen.",
                       state="missing")
    if len(records) > 1:
        return _result("tls_rpt", Status.FAIL, 0, "Multiple TLS-RPT records; senders ignore them.",
                       state="missing", records=records)
    rua = parse_tags(records[0]).get("rua", "")
    targets = [t.strip() for t in rua.split(",") if t.strip()]
    if not targets or not all(t.lower().startswith(("mailto:", "https:")) for t in targets):
        return _result("tls_rpt", Status.FAIL, 0.2, "TLS-RPT record has no valid rua= (mailto: or https:).",
                       state="missing", records=records)
    return _result("tls_rpt", Status.PASS, 1.0, f"TLS failure reports go to {', '.join(targets)}.",
                   state="ok", records=records)


# --------------------------------------------------------------------------- #


def evaluate_all(obs: Observations) -> dict[str, CheckResult]:
    mx = evaluate_mx(obs.mx)
    receives_mail = mx.details["state"] not in {"null"}
    spf = evaluate_spf(obs.spf)
    dkim = evaluate_dkim(obs.dkim, spf.details["state"])
    has_auth = spf.details["state"] in {"hardfail", "softfail", "delegated", "no_send"} or \
        dkim.details["state"] in {"ok", "weak"}
    return {
        "spf": spf,
        "dkim": dkim,
        "dmarc": evaluate_dmarc(obs.dmarc, has_auth=has_auth),
        "mx": mx,
        "starttls": evaluate_starttls(obs.starttls, receives_mail),
        "mta_sts": evaluate_mta_sts(obs.mta_sts, obs.mx, receives_mail),
        "tls_rpt": evaluate_tls_rpt(obs.tls_rpt, receives_mail),
    }
