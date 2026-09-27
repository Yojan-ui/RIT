"""Scoring matrix, attack-path model and 'The One Fix'.

Pipeline:  Observations -> checks -> Posture -> attack paths -> ranked fixes

'The One Fix' is found by simulation rather than a lookup table: each candidate
DNS change is applied to a copy of the Observations, the whole analysis is
re-run, and we count which attack paths went from open to closed. The winner
closes the most severity-weighted paths; ties break on score gained, then on
how little work the change needs.
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import date

from app.analysis.checks import evaluate_all
from app.analysis.parsers import parse_spf, parse_tags
from app.models import AttackPath, CheckResult, DkimKey, DnsRecord, Fix, Observations, TxtLookup

# --------------------------------------------------------------------------- #
# Score
# --------------------------------------------------------------------------- #

_GRADES = ((90, "A"), (80, "B"), (65, "C"), (50, "D"))


def overall_score(checks: dict[str, CheckResult]) -> int:
    applicable = [c for c in checks.values() if c.applicable]
    possible = sum(c.weight for c in applicable)
    if not possible:
        return 0
    return round(100 * sum(c.points for c in applicable) / possible)


def grade_for(score: int) -> str:
    return next((grade for floor, grade in _GRADES if score >= floor), "F")


# --------------------------------------------------------------------------- #
# Posture: the handful of facts attack paths care about
# --------------------------------------------------------------------------- #


@dataclass(frozen=True)
class Posture:
    receives_mail: bool
    spf: str
    dkim: str
    dmarc: str  # missing | none | quarantine | reject
    dmarc_sp: str
    dmarc_pct: int
    dmarc_rua: bool
    starttls: str  # ok | bad_cert | legacy_tls | missing | broken | unknown | not_applicable
    mta_sts: str
    tls_rpt: bool

    @classmethod
    def from_checks(cls, checks: dict[str, CheckResult]) -> Posture:
        dmarc = checks["dmarc"].details
        return cls(
            receives_mail=checks["mx"].details["state"] != "null",
            spf=checks["spf"].details["state"],
            dkim=checks["dkim"].details["state"],
            dmarc=dmarc["state"] if dmarc["state"] in {"none", "quarantine", "reject"} else "missing",
            dmarc_sp=dmarc.get("sp", "none"),
            dmarc_pct=dmarc.get("pct", 100),
            dmarc_rua=bool(dmarc.get("rua")),
            starttls=checks["starttls"].details["state"],
            mta_sts=checks["mta_sts"].details["state"],
            tls_rpt=checks["tls_rpt"].details["state"] == "ok",
        )

    @property
    def dmarc_enforced(self) -> bool:
        return self.dmarc in {"quarantine", "reject"} and self.dmarc_pct == 100

    @property
    def subdomains_enforced(self) -> bool:
        return self.dmarc_enforced and self.dmarc_sp in {"quarantine", "reject"}

    @property
    def sends_mail(self) -> bool:
        return self.spf != "no_send"

    @property
    def has_auth(self) -> bool:
        """Legitimate mail can pass DMARC, so enforcing it is safe."""
        return self.spf in {"hardfail", "softfail", "delegated", "no_send"} or self.dkim in {"ok", "weak"}


# --------------------------------------------------------------------------- #
# Attack paths
# --------------------------------------------------------------------------- #


@dataclass(frozen=True)
class _PathSpec:
    id: str
    title: str
    severity: int
    description: str
    remedy: str
    is_open: Callable[[Posture], bool]
    applies: Callable[[Posture], bool] = lambda p: True
    dns_fixable: bool = True


ATTACK_PATHS: tuple[_PathSpec, ...] = (
    _PathSpec(
        "exact_domain_spoofing", "Exact-domain spoofing", 5,
        "An attacker sends mail with your exact domain in the visible From: header and it lands in the inbox.",
        "DMARC at p=quarantine or p=reject with pct=100.",
        lambda p: not p.dmarc_enforced,
    ),
    _PathSpec(
        "subdomain_spoofing", "Subdomain spoofing", 3,
        "Mail from invented subdomains (billing.yourdomain) is delivered even if the apex is protected.",
        "DMARC enforcement that also covers subdomains (sp= not 'none').",
        lambda p: not p.subdomains_enforced,
    ),
    _PathSpec(
        "envelope_spoofing", "Envelope-sender forgery", 2,
        "Nothing tells receivers which servers may use your domain in the SMTP MAIL FROM.",
        "An SPF record ending in -all (or ~all backed by an enforcing DMARC policy).",
        lambda p: p.spf in {"missing", "invalid", "permissive"}
        or (p.spf in {"softfail", "delegated"} and not p.dmarc_enforced),
    ),
    _PathSpec(
        "message_tampering", "Unsigned mail", 2,
        "Without DKIM, receivers cannot prove a message came from you unaltered, and DMARC depends on "
        "SPF alone, which breaks on forwarding.",
        "Publish your mail provider's DKIM key and turn on signing.",
        lambda p: p.dkim == "missing",
        applies=lambda p: p.sends_mail,
    ),
    _PathSpec(
        "starttls_downgrade", "STARTTLS stripping", 4,
        "An on-path attacker removes STARTTLS from the SMTP handshake and reads inbound mail in cleartext.",
        "MTA-STS in enforce mode over a valid certificate.",
        lambda p: not (p.mta_sts == "enforce" and p.starttls in {"ok", "unknown"}),
        applies=lambda p: p.receives_mail,
    ),
    _PathSpec(
        "cleartext_delivery", "Cleartext inbound mail", 4,
        "Your mail server does not offer STARTTLS at all, so every inbound message crosses the internet unencrypted.",
        "Enable STARTTLS on the mail server (a server change, not a DNS change).",
        lambda p: p.starttls in {"missing", "broken"},
        applies=lambda p: p.receives_mail,
        dns_fixable=False,
    ),
    _PathSpec(
        "spoofing_blind_spot", "No spoofing visibility", 1,
        "Without DMARC aggregate reports you cannot see who is sending as your domain.",
        "Add rua=mailto:... to your DMARC record.",
        lambda p: not p.dmarc_rua,
    ),
    _PathSpec(
        "tls_blind_spot", "No TLS failure visibility", 1,
        "Without TLS-RPT, downgrade attacks and certificate failures against your MX go unreported.",
        "Publish a TLS-RPT record.",
        lambda p: not p.tls_rpt,
        applies=lambda p: p.receives_mail,
    ),
)


def evaluate_attack_paths(posture: Posture) -> list[AttackPath]:
    out = []
    for spec in ATTACK_PATHS:
        if not spec.applies(posture):
            state = "not_applicable"
        else:
            state = "open" if spec.is_open(posture) else "closed"
        out.append(AttackPath(id=spec.id, title=spec.title, severity=spec.severity, description=spec.description,
                              state=state, dns_fixable=spec.dns_fixable, remedy=spec.remedy))
    return out


# --------------------------------------------------------------------------- #
# Candidate fixes
# --------------------------------------------------------------------------- #

# Stand-in for "your provider's 2048-bit key" when simulating the DKIM fix:
# 392 base64 chars decode to 294 bytes, which estimate_dkim_key_bits reads as 2048.
_SIMULATED_DKIM_KEY = "A" * 392
_EFFORT_RANK = {"paste": 0, "paste+host": 1, "provider": 2}


@dataclass
class _Candidate:
    id: str
    title: str
    record: DnsRecord
    effort: str
    apply: Callable[[Observations], None]
    caveats: list[str] = field(default_factory=list)


def _dmarc_candidate(obs: Observations, checks: dict[str, CheckResult], p: Posture) -> _Candidate | None:
    if not checks["dmarc"].applicable:
        return None
    domain = obs.domain
    tags = dict(checks["dmarc"].details.get("tags") or {}) if p.dmarc != "missing" else {}
    if not p.sends_mail:
        target = "reject"  # nothing legitimate to break, so skip the quarantine stage
    elif p.has_auth:
        target = "quarantine" if p.dmarc in {"missing", "none"} else "reject"
    else:
        target = p.dmarc if p.dmarc in {"quarantine", "reject"} else "none"
    if p.dmarc == target and p.dmarc_pct == 100 and p.dmarc_rua and (target == "none" or p.subdomains_enforced):
        return None  # nothing left to change

    tags.pop("v", None)
    tags.pop("pct", None)
    tags["p"] = target
    if tags.get("sp", "").lower() == "none" or target == "none":
        tags.pop("sp", None)
    tags.setdefault("rua", f"mailto:dmarc-reports@{domain}")
    ordered = ["p", "sp", "rua", "ruf", "adkim", "aspf", "fo"]
    parts = [f"{k}={tags[k]}" for k in ordered if k in tags]
    parts += [f"{k}={v}" for k, v in tags.items() if k not in ordered]
    value = "v=DMARC1; " + "; ".join(parts)

    caveats = []
    if target == "none":
        caveats.append("This only turns on reporting. Enforcement needs SPF or DKIM passing first, "
                       "or it would reject your own mail.")
    elif target == "quarantine":
        caveats.append("Read the rua aggregate reports for 2-4 weeks, then tighten to p=reject.")
    if "dmarc-reports@" in value and not (checks["dmarc"].details.get("tags") or {}).get("rua"):
        caveats.append(f"Create the dmarc-reports@{domain} mailbox, or point rua= at a DMARC reporting service.")

    def apply(o: Observations) -> None:
        o.dmarc = TxtLookup(records=[value])

    title = {"none": "Publish a DMARC monitoring record", "quarantine": "Enforce DMARC (p=quarantine)",
             "reject": "Tighten DMARC to p=reject"}[target]
    return _Candidate("dmarc", title, DnsRecord(type="TXT", host=f"_dmarc.{domain}", value=value),
                      "paste", apply, caveats)


def _spf_candidate(obs: Observations, checks: dict[str, CheckResult], p: Posture) -> _Candidate | None:
    if p.spf not in {"missing", "permissive", "softfail"} or not checks["spf"].applicable:
        return None
    caveats = []
    if p.spf == "missing":
        value = "v=spf1 mx -all" if p.receives_mail and obs.mx.hosts else "v=spf1 -all"
        caveats.append("List every service that sends as you (e.g. include:_spf.google.com) before publishing, "
                       "or their mail will fail SPF.")
        lookups = 1 if " mx " in value else 0
    else:
        record = parse_spf(checks["spf"].records[0])
        value = " ".join(["v=spf1", *record.mechanisms, "-all"])
        lookups = obs.spf.lookup_count
        if p.spf == "permissive":
            caveats.append("Confirm the listed mechanisms cover all of your senders before switching to -all.")

    def apply(o: Observations) -> None:
        o.spf = o.spf.model_copy(update={"records": [value], "lookup_count": lookups, "lookup_error": None,
                                         "error": None})

    title = "Publish an SPF record" if p.spf == "missing" else "Harden SPF to -all"
    return _Candidate("spf", title, DnsRecord(type="TXT", host=obs.domain, value=value), "paste", apply, caveats)


def _dkim_candidate(obs: Observations, checks: dict[str, CheckResult], p: Posture) -> _Candidate | None:
    if p.dkim not in {"missing", "weak"} or not checks["dkim"].applicable:
        return None

    def apply(o: Observations) -> None:
        o.dkim = o.dkim.model_copy(update={
            "keys": [DkimKey(selector="new", record=f"v=DKIM1; k=rsa; p={_SIMULATED_DKIM_KEY}")], "error": None})

    title = "Publish a DKIM key" if p.dkim == "missing" else "Rotate DKIM to a 2048-bit key"
    return _Candidate(
        "dkim", title,
        DnsRecord(type="TXT", host=f"<selector>._domainkey.{obs.domain}",
                  value="v=DKIM1; k=rsa; p=<2048-bit public key from your mail provider>"),
        "provider", apply,
        ["Generate the key in your mail provider's admin console and turn on signing there; the DNS record "
         "alone does nothing.",
         "If you already sign with a selector the scan did not guess, rescan with ?dkim_selectors=name first."],
    )


def _mta_sts_candidate(obs: Observations, checks: dict[str, CheckResult], p: Posture) -> _Candidate | None:
    if not p.receives_mail or p.mta_sts == "enforce" or not checks["mta_sts"].applicable:
        return None
    if p.starttls not in {"ok", "unknown"}:
        return None  # enforcing over a bad cert / no TLS would block all inbound mail
    policy_id = date.today().strftime("%Y%m%d") + "01"
    mx_lines = "\n".join(f"mx: {h.host}" for h in obs.mx.hosts)
    policy = f"version: STSv1\nmode: enforce\n{mx_lines}\nmax_age: 604800\n"

    def apply(o: Observations) -> None:
        o.mta_sts = o.mta_sts.model_copy(update={
            "txt": TxtLookup(records=[f"v=STSv1; id={policy_id}"]), "policy": policy, "policy_error": None})

    caveats = [f"Also serve https://mta-sts.{obs.domain}/.well-known/mta-sts.txt (valid HTTPS cert) containing:\n"
               + policy, "Consider a week in 'mode: testing' with TLS-RPT on before switching to enforce."]
    if p.starttls == "unknown":
        caveats.append("Port 25 was unreachable from the scanner; confirm your MX certificate is valid first.")
    return _Candidate("mta_sts", "Enforce MTA-STS",
                      DnsRecord(type="TXT", host=f"_mta-sts.{obs.domain}", value=f"v=STSv1; id={policy_id}"),
                      "paste+host", apply, caveats)


def _tls_rpt_candidate(obs: Observations, checks: dict[str, CheckResult], p: Posture) -> _Candidate | None:
    if not p.receives_mail or p.tls_rpt or not checks["tls_rpt"].applicable:
        return None
    value = f"v=TLSRPTv1; rua=mailto:tls-reports@{obs.domain}"

    def apply(o: Observations) -> None:
        o.tls_rpt = TxtLookup(records=[value])

    return _Candidate("tls_rpt", "Publish a TLS-RPT record",
                      DnsRecord(type="TXT", host=f"_smtp._tls.{obs.domain}", value=value), "paste", apply,
                      [f"Create the tls-reports@{obs.domain} mailbox or use a reporting service."])


_CANDIDATE_BUILDERS = (_dmarc_candidate, _spf_candidate, _dkim_candidate, _mta_sts_candidate, _tls_rpt_candidate)


# --------------------------------------------------------------------------- #
# Analysis entry point
# --------------------------------------------------------------------------- #


@dataclass
class Analysis:
    checks: dict[str, CheckResult]
    score: int
    grade: str
    posture: Posture
    attack_paths: list[AttackPath]
    fixes: list[Fix] = field(default_factory=list)

    @property
    def one_fix(self) -> Fix | None:
        return self.fixes[0] if self.fixes else None


def analyze(obs: Observations, *, rank_fixes: bool = True) -> Analysis:
    checks = evaluate_all(obs)
    score = overall_score(checks)
    posture = Posture.from_checks(checks)
    analysis = Analysis(checks, score, grade_for(score), posture, evaluate_attack_paths(posture))
    if rank_fixes:
        analysis.fixes = _rank_fixes(obs, analysis)
    return analysis


def _rank_fixes(obs: Observations, before: Analysis) -> list[Fix]:
    open_before = {a.id: a for a in before.attack_paths if a.state == "open"}
    fixes: list[Fix] = []
    for build in _CANDIDATE_BUILDERS:
        candidate = build(obs, before.checks, before.posture)
        if candidate is None:
            continue
        simulated = obs.model_copy(deep=True)
        candidate.apply(simulated)
        after = analyze(simulated, rank_fixes=False)
        still_open = {a.id for a in after.attack_paths if a.state == "open"}
        closed = [pid for pid in open_before if pid not in still_open]
        if not closed and after.score <= before.score:
            continue
        severity = sum(open_before[pid].severity for pid in closed)
        titles = ", ".join(open_before[pid].title.lower() for pid in closed)
        rationale = (f"Closes {len(closed)} attack path(s) ({titles}) and lifts the score "
                     f"from {before.score} to {after.score}." if closed else
                     f"Closes no attack path on its own but lifts the score from {before.score} to {after.score}.")
        fixes.append(Fix(id=candidate.id, title=candidate.title, rationale=rationale, record=candidate.record,
                         closes=closed, severity_closed=severity, score_before=before.score,
                         score_after=after.score, effort=candidate.effort, caveats=candidate.caveats))
    fixes.sort(key=lambda f: (-f.severity_closed, -(f.score_after - f.score_before), _EFFORT_RANK[f.effort]))
    return fixes
