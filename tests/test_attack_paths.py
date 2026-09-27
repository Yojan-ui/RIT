"""Every resolution of every attack path rule: exposed, partial, mitigated and unknown."""

from __future__ import annotations

import pytest

from app.engine.attack_paths import RULES, assess_attack_paths
from app.models.enums import CheckName, CheckStatus, Exposure, Severity
from app.models.schemas import CheckResult, Finding

S, E, N = CheckStatus, Exposure, CheckName


def check(name: CheckName, status: CheckStatus, findings: list[Finding] | None = None, **data) -> CheckResult:
    return CheckResult(name=name, status=status, summary=f"{name.value} {status.value}", findings=findings or [], data=data)


def dmarc(p: str | None, *, sp: str | None = None, pct: int = 100, rua: bool = True, status: S = S.PASS) -> CheckResult:
    return check(N.DMARC, status, policy=p, subdomain_policy=sp, pct=pct, rua=["mailto:r@x.test"] if rua else [])


def spf(all_result: str, status: S = S.PASS) -> CheckResult:
    return check(N.SPF, status, all_result=all_result, record=f"v=spf1 {all_result}")


def sts(mode: str | None, status: S = S.PASS) -> CheckResult:
    return check(N.MTA_STS, status, mode=mode)


WEAK_KEY = [Finding(title="1024-bit RSA key", severity=Severity.MEDIUM)]

# (path id, check results, expected exposure, expected fix control)
CASES = [
    # 1. Exact-domain spoofing: decided by DMARC p=
    ("direct-spoofing", [], E.UNKNOWN, None),
    ("direct-spoofing", [check(N.DMARC, S.ERROR)], E.UNKNOWN, None),
    ("direct-spoofing", [check(N.DMARC, S.MISSING)], E.EXPOSED, N.DMARC),
    ("direct-spoofing", [dmarc("none", status=S.FAIL)], E.EXPOSED, N.DMARC),
    ("direct-spoofing", [dmarc(None, status=S.FAIL)], E.EXPOSED, N.DMARC),
    ("direct-spoofing", [dmarc("reject", pct=25)], E.PARTIAL, N.DMARC),
    ("direct-spoofing", [dmarc("quarantine")], E.MITIGATED, None),
    ("direct-spoofing", [dmarc("reject")], E.MITIGATED, None),
    # 2. Subdomain spoofing: sp=, falling back to p=
    ("subdomain-spoofing", [check(N.DMARC, S.NOT_ASSESSED)], E.UNKNOWN, None),
    ("subdomain-spoofing", [check(N.DMARC, S.MISSING)], E.EXPOSED, N.DMARC),
    ("subdomain-spoofing", [dmarc("reject", sp="none")], E.EXPOSED, N.DMARC),
    ("subdomain-spoofing", [dmarc("reject", pct=50)], E.PARTIAL, N.DMARC),
    ("subdomain-spoofing", [dmarc("reject")], E.MITIGATED, None),
    ("subdomain-spoofing", [dmarc("none", sp="quarantine", status=S.FAIL)], E.MITIGATED, None),
    # 3. Envelope sender spoofing: SPF and its all qualifier
    ("envelope-spoofing", [check(N.SPF, S.ERROR)], E.UNKNOWN, None),
    ("envelope-spoofing", [check(N.SPF, S.MISSING)], E.EXPOSED, N.SPF),
    ("envelope-spoofing", [spf("pass", S.FAIL)], E.EXPOSED, N.SPF),
    ("envelope-spoofing", [spf("neutral")], E.EXPOSED, N.SPF),
    ("envelope-spoofing", [spf("none")], E.EXPOSED, N.SPF),
    ("envelope-spoofing", [spf("fail", S.FAIL)], E.EXPOSED, N.SPF),  # e.g. over the lookup limit
    ("envelope-spoofing", [spf("softfail")], E.PARTIAL, N.SPF),
    ("envelope-spoofing", [spf("fail")], E.MITIGATED, None),
    ("envelope-spoofing", [check(N.SPF, S.PASS)], E.MITIGATED, None),  # no detail data: trust status
    # 4. Tampering and forwarding breakage: DKIM
    ("unsigned-mail", [check(N.DKIM, S.NOT_ASSESSED)], E.UNKNOWN, None),
    ("unsigned-mail", [check(N.DKIM, S.MISSING)], E.EXPOSED, N.DKIM),
    ("unsigned-mail", [check(N.DKIM, S.FAIL)], E.EXPOSED, N.DKIM),
    ("unsigned-mail", [check(N.DKIM, S.WARN, WEAK_KEY)], E.PARTIAL, N.DKIM),
    ("unsigned-mail", [check(N.DKIM, S.PASS)], E.MITIGATED, None),
    # 5. STARTTLS downgrade: MTA-STS mode
    ("tls-downgrade", [check(N.MTA_STS, S.NOT_ASSESSED)], E.UNKNOWN, None),
    ("tls-downgrade", [check(N.MTA_STS, S.MISSING)], E.EXPOSED, N.MTA_STS),
    ("tls-downgrade", [check(N.MTA_STS, S.FAIL)], E.EXPOSED, N.MTA_STS),  # policy fetch failed
    ("tls-downgrade", [sts("none", S.FAIL)], E.EXPOSED, N.MTA_STS),
    ("tls-downgrade", [sts("enforce", S.FAIL)], E.EXPOSED, N.MTA_STS),  # e.g. MX not covered
    ("tls-downgrade", [sts("testing", S.WARN)], E.PARTIAL, N.MTA_STS),
    ("tls-downgrade", [sts("enforce")], E.MITIGATED, None),
    # 6. Weak transport encryption: live STARTTLS probe
    ("plaintext-interception", [check(N.TRANSPORT, S.NOT_ASSESSED)], E.UNKNOWN, None),
    ("plaintext-interception", [check(N.TRANSPORT, S.FAIL)], E.EXPOSED, N.TRANSPORT),
    ("plaintext-interception", [check(N.TRANSPORT, S.WARN)], E.PARTIAL, N.TRANSPORT),
    ("plaintext-interception", [check(N.TRANSPORT, S.PASS)], E.MITIGATED, None),
    # 7. Undetected abuse: DMARC rua= and TLS-RPT
    ("undetected-abuse", [], E.UNKNOWN, None),
    ("undetected-abuse", [check(N.DMARC, S.ERROR), check(N.TLS_RPT, S.NOT_ASSESSED)], E.UNKNOWN, None),
    ("undetected-abuse", [check(N.DMARC, S.MISSING), check(N.TLS_RPT, S.MISSING)], E.EXPOSED, N.DMARC),
    ("undetected-abuse", [dmarc("reject", rua=False), check(N.TLS_RPT, S.MISSING)], E.EXPOSED, N.DMARC),
    ("undetected-abuse", [dmarc("reject"), check(N.TLS_RPT, S.MISSING)], E.PARTIAL, N.TLS_RPT),
    ("undetected-abuse", [dmarc("reject", rua=False), check(N.TLS_RPT, S.PASS)], E.PARTIAL, N.DMARC),
    ("undetected-abuse", [dmarc("reject"), check(N.TLS_RPT, S.PASS)], E.MITIGATED, None),
    ("undetected-abuse", [dmarc("reject"), check(N.TLS_RPT, S.NOT_ASSESSED)], E.MITIGATED, None),  # null MX
]


def _case_id(case) -> str:
    path, results, exposure, _ = case
    inputs = ",".join(f"{r.name.value}={r.status.value}" for r in results) or "no-results"
    return f"{path}[{inputs}]->{exposure.value}"


@pytest.mark.parametrize(("path_id", "results", "exposure", "fix"), CASES, ids=[_case_id(c) for c in CASES])
def test_path_resolution(path_id, results, exposure, fix):
    path = next(p for p in assess_attack_paths(results) if p.id == path_id)
    assert path.exposure is exposure, path.reason
    assert path.fix_control is fix
    assert path.reason  # every resolution explains itself


def test_every_path_reaches_every_exposure_state():
    covered = {(path, exposure) for path, _, exposure, _ in CASES}
    missing = [(r.path.id, e.value) for r in RULES for e in Exposure if (r.path.id, e) not in covered]
    assert not missing


def test_weak_dkim_reason_names_the_finding():
    path = next(p for p in assess_attack_paths([check(N.DKIM, S.WARN, WEAK_KEY)]) if p.id == "unsigned-mail")
    assert "1024-bit RSA key" in path.reason


@pytest.mark.parametrize(
    ("results", "cells"),
    [
        ([dmarc("none", sp="reject", status=S.FAIL)], {"direct-spoofing": E.EXPOSED, "subdomain-spoofing": E.MITIGATED}),
        (
            [dmarc("reject", rua=False), check(N.TLS_RPT, S.PASS)],
            {"undetected-abuse": {N.DMARC: E.EXPOSED, N.TLS_RPT: E.MITIGATED}},
        ),
    ],
)
def test_matrix_cells(results, cells):
    by_id = {p.id: p for p in assess_attack_paths(results)}
    for path_id, expected in cells.items():
        got = by_id[path_id].control_exposure
        assert got == (expected if isinstance(expected, dict) else {N.DMARC: expected})
