"""Map weak or missing controls to concrete attacker techniques.

Every rule is assessed against the scan and lands in one of four exposure states, so
the dashboard can show the full matrix (including what is already defended) rather than
only the problems.
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass

from app.models.enums import CheckName, CheckStatus, Exposure, Severity
from app.models.schemas import AttackPath, CheckResult

Results = dict[CheckName, CheckResult]

_UNMEASURED = {CheckStatus.NOT_ASSESSED, CheckStatus.ERROR}


@dataclass(frozen=True, slots=True)
class Assessment:
    exposure: Exposure
    reason: str
    fix: CheckName | None = None
    # Per-control state for rules decided by more than one control.
    cells: dict[CheckName, Exposure] | None = None


def _unmeasured(r: CheckResult | None, what: str) -> Assessment | None:
    if r is None:
        return Assessment(Exposure.UNKNOWN, f"{what} was not checked.")
    if r.status in _UNMEASURED:
        return Assessment(Exposure.UNKNOWN, r.summary or f"{what} could not be measured.")
    return None


def _worst_finding(r: CheckResult) -> str:
    """Title of the most severe finding, falling back to the check summary."""
    worst = max(r.findings, key=lambda f: f.severity.rank, default=None)
    return worst.title if worst and worst.severity.rank > Severity.INFO.rank else r.summary


def _from_status(r: CheckResult, fix: CheckName) -> Assessment:
    """Fallback when a result lacks the detail data a rule normally reads."""
    if r.status is CheckStatus.PASS:
        return Assessment(Exposure.MITIGATED, r.summary)
    if r.status is CheckStatus.WARN:
        return Assessment(Exposure.PARTIAL, _worst_finding(r), fix)
    return Assessment(Exposure.EXPOSED, _worst_finding(r), fix)


def _dmarc_enforcement(r: CheckResult, policy: str | None, label: str) -> Assessment:
    fix = CheckName.DMARC
    if r.status is CheckStatus.MISSING:
        return Assessment(Exposure.EXPOSED, "No DMARC record, so receivers have no policy to enforce.", fix)
    if "policy" not in r.data:
        return _from_status(r, fix)
    if policy not in {"quarantine", "reject"}:
        if policy == "none":
            return Assessment(Exposure.EXPOSED, f"{label}=none only monitors; spoofed mail is still delivered.", fix)
        return Assessment(Exposure.EXPOSED, f"DMARC is unusable ({r.summary}).", fix)
    pct = r.data.get("pct", 100)
    if pct < 100:
        return Assessment(Exposure.PARTIAL, f"{label}={policy} applies to only {pct}% of failing mail.", fix)
    return Assessment(Exposure.MITIGATED, f"{label}={policy} is enforced on all failing mail.")


def _direct_spoofing(r: Results) -> Assessment:
    dmarc = r.get(CheckName.DMARC)
    if a := _unmeasured(dmarc, "DMARC"):
        return a
    return _dmarc_enforcement(dmarc, dmarc.data.get("policy"), "p")


def _subdomain_spoofing(r: Results) -> Assessment:
    dmarc = r.get(CheckName.DMARC)
    if a := _unmeasured(dmarc, "DMARC"):
        return a
    sp = dmarc.data.get("subdomain_policy")
    return _dmarc_enforcement(dmarc, sp or dmarc.data.get("policy"), "sp" if sp else "p (inherited by subdomains)")


def _envelope_spoofing(r: Results) -> Assessment:
    spf = r.get(CheckName.SPF)
    if a := _unmeasured(spf, "SPF"):
        return a
    fix = CheckName.SPF
    if spf.status is CheckStatus.MISSING:
        return Assessment(Exposure.EXPOSED, "No SPF record, so any server may claim to send for this domain.", fix)
    if "all_result" not in spf.data:
        return _from_status(spf, fix)
    result = spf.data["all_result"]
    if result == "pass":
        return Assessment(Exposure.EXPOSED, "+all authorises every server on the internet.", fix)
    if result in {"neutral", "none"}:
        return Assessment(Exposure.EXPOSED, "SPF has no failing all, so unlisted servers are not rejected.", fix)
    if spf.status is CheckStatus.FAIL:
        return Assessment(Exposure.EXPOSED, f"SPF is broken: {_worst_finding(spf)}.", fix)
    if result == "softfail":
        return Assessment(Exposure.PARTIAL, "~all marks unlisted servers as suspicious but doesn't reject them.", fix)
    return Assessment(Exposure.MITIGATED, "-all rejects servers that aren't listed.")


def _unsigned_mail(r: Results) -> Assessment:
    dkim = r.get(CheckName.DKIM)
    if a := _unmeasured(dkim, "DKIM"):
        return a
    fix = CheckName.DKIM
    if dkim.status is CheckStatus.MISSING:
        return Assessment(Exposure.EXPOSED, "No DKIM key, so mail can't be signed or checked for tampering.", fix)
    if dkim.status is CheckStatus.FAIL:
        return Assessment(Exposure.EXPOSED, f"DKIM is unsafe: {_worst_finding(dkim)}.", fix)
    if dkim.status is CheckStatus.WARN:
        return Assessment(Exposure.PARTIAL, f"DKIM works, but: {_worst_finding(dkim)}.", fix)
    return Assessment(Exposure.MITIGATED, dkim.summary or "DKIM signing keys look sound.")


def _tls_downgrade(r: Results) -> Assessment:
    sts = r.get(CheckName.MTA_STS)
    if a := _unmeasured(sts, "MTA-STS"):
        return a
    fix = CheckName.MTA_STS
    if sts.status is CheckStatus.MISSING:
        return Assessment(Exposure.EXPOSED, "No MTA-STS policy, so senders fall back to plaintext if TLS is stripped.", fix)
    if "mode" not in sts.data:
        return _from_status(sts, fix)
    mode = sts.data["mode"]
    if sts.status is CheckStatus.FAIL or mode in {None, "none"}:
        return Assessment(Exposure.EXPOSED, f"MTA-STS isn't in effect: {_worst_finding(sts)}.", fix)
    if mode == "testing":
        return Assessment(Exposure.PARTIAL, "mode: testing reports downgrades but doesn't block them.", fix)
    return Assessment(Exposure.MITIGATED, "mode: enforce makes senders refuse to deliver without valid TLS.")


def _plaintext_interception(r: Results) -> Assessment:
    transport = r.get(CheckName.TRANSPORT)
    if a := _unmeasured(transport, "SMTP transport"):
        return a
    fix = CheckName.TRANSPORT
    if transport.status in {CheckStatus.FAIL, CheckStatus.MISSING}:
        return Assessment(Exposure.EXPOSED, _worst_finding(transport) or "The primary MX doesn't offer usable TLS.", fix)
    if transport.status is CheckStatus.WARN:
        return Assessment(Exposure.PARTIAL, f"TLS works, but: {_worst_finding(transport)}.", fix)
    return Assessment(Exposure.MITIGATED, transport.summary or "The primary MX offers modern TLS.")


def _undetected_abuse(r: Results) -> Assessment:
    dmarc, tlsrpt = r.get(CheckName.DMARC), r.get(CheckName.TLS_RPT)
    dmarc_known = dmarc is not None and dmarc.status not in _UNMEASURED
    tlsrpt_known = tlsrpt is not None and tlsrpt.status not in _UNMEASURED
    if not dmarc_known and not tlsrpt_known:
        return Assessment(Exposure.UNKNOWN, "Neither DMARC nor TLS-RPT reporting could be measured.")
    has_rua = dmarc_known and bool(dmarc.data.get("rua"))
    has_tlsrpt = tlsrpt_known and tlsrpt.status in {CheckStatus.PASS, CheckStatus.WARN}
    cells = {
        CheckName.DMARC: (Exposure.MITIGATED if has_rua else Exposure.EXPOSED) if dmarc_known else Exposure.UNKNOWN,
        CheckName.TLS_RPT: (Exposure.MITIGATED if has_tlsrpt else Exposure.EXPOSED) if tlsrpt_known else Exposure.UNKNOWN,
    }
    if has_rua and (has_tlsrpt or not tlsrpt_known):
        return Assessment(Exposure.MITIGATED, "Aggregate reports show who sends as this domain.", cells=cells)
    if has_rua:
        return Assessment(
            Exposure.PARTIAL, "DMARC reports arrive, but TLS delivery failures go unreported.", CheckName.TLS_RPT, cells
        )
    if has_tlsrpt:
        return Assessment(Exposure.PARTIAL, "TLS failures are reported, but spoofing attempts aren't.", CheckName.DMARC, cells)
    return Assessment(Exposure.EXPOSED, "No DMARC rua= or TLS-RPT, so abuse happens without anyone noticing.", CheckName.DMARC, cells)


@dataclass(frozen=True, slots=True)
class Rule:
    path: AttackPath
    assess: Callable[[Results], Assessment]


RULES: tuple[Rule, ...] = (
    Rule(
        AttackPath(
            id="direct-spoofing",
            title="Exact-domain spoofing",
            description="Attackers send mail with this exact domain in the From: header, the "
            "classic CEO-fraud and invoice-scam setup.",
            severity=Severity.CRITICAL,
            enabled_by=[CheckName.DMARC, CheckName.SPF, CheckName.DKIM],
        ),
        _direct_spoofing,
    ),
    Rule(
        AttackPath(
            id="subdomain-spoofing",
            title="Subdomain spoofing",
            description="Attackers invent a subdomain such as billing.<domain> and send from it; "
            "a lax subdomain policy lets it through even when the parent is protected.",
            severity=Severity.HIGH,
            enabled_by=[CheckName.DMARC],
        ),
        _subdomain_spoofing,
    ),
    Rule(
        AttackPath(
            id="envelope-spoofing",
            title="Envelope sender spoofing",
            description="Any server claims to send on the domain's behalf at the SMTP level, "
            "which also poisons bounce handling and weakens DMARC alignment.",
            severity=Severity.HIGH,
            enabled_by=[CheckName.SPF],
        ),
        _envelope_spoofing,
    ),
    Rule(
        AttackPath(
            id="unsigned-mail",
            title="Tampering and forwarding breakage",
            description="Without DKIM, messages can be altered undetected, and forwarded mail "
            "fails DMARC because SPF alone doesn't survive forwarding.",
            severity=Severity.HIGH,
            enabled_by=[CheckName.DKIM],
        ),
        _unsigned_mail,
    ),
    Rule(
        AttackPath(
            id="tls-downgrade",
            title="STARTTLS downgrade",
            description="An on-path attacker strips STARTTLS so inbound mail is sent in "
            "plaintext, where it can be read or modified.",
            severity=Severity.MEDIUM,
            enabled_by=[CheckName.MTA_STS],
        ),
        _tls_downgrade,
    ),
    Rule(
        AttackPath(
            id="plaintext-interception",
            title="Weak transport encryption",
            description="Missing STARTTLS, legacy protocols or a bad certificate on the MX let "
            "inbound mail be intercepted or impersonated in transit.",
            severity=Severity.MEDIUM,
            enabled_by=[CheckName.TRANSPORT],
        ),
        _plaintext_interception,
    ),
    Rule(
        AttackPath(
            id="undetected-abuse",
            title="Undetected abuse",
            description="Spoofing campaigns and TLS failures happen silently because nobody "
            "receives the reports that would reveal them.",
            severity=Severity.LOW,
            enabled_by=[CheckName.DMARC, CheckName.TLS_RPT],
        ),
        _undetected_abuse,
    ),
)


def assess_attack_paths(results: list[CheckResult]) -> list[AttackPath]:
    """Assess every rule, in matrix order."""
    by_name = {r.name: r for r in results}
    matrix: list[AttackPath] = []
    for rule in RULES:
        a = rule.assess(by_name)
        # The first listed control decides the path unless the rule reports cells itself.
        cells = a.cells if a.cells is not None else {rule.path.enabled_by[0]: a.exposure}
        matrix.append(
            rule.path.model_copy(
                update={"exposure": a.exposure, "reason": a.reason, "fix_control": a.fix, "control_exposure": cells}
            )
        )
    return matrix


def active_paths(matrix: list[AttackPath]) -> list[AttackPath]:
    return [p for p in matrix if p.exposure in {Exposure.EXPOSED, Exposure.PARTIAL}]


def derive_attack_paths(results: list[CheckResult]) -> list[AttackPath]:
    """Paths that are currently exposed or partially exposed."""
    return active_paths(assess_attack_paths(results))
