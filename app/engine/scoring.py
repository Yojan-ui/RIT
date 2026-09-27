"""Turn a set of check results into a 0-100 score and a letter grade."""

from __future__ import annotations

from app.core.constants import GRADE_THRESHOLDS
from app.models.enums import CheckName, CheckStatus, Grade
from app.models.schemas import CheckResult, ScoreBreakdown

# Relative importance of each check, summing to 100. Unlisted checks (MX, DNSSEC, BIMI) are
# still run and reported but contribute nothing to the score.
# DMARC leads because it is the only control that tells receivers to *reject* forged mail;
# transport is next because a missing or broken STARTTLS exposes every inbound message.
WEIGHTS: dict[CheckName, float] = {
    CheckName.DMARC: 30,
    CheckName.TRANSPORT: 25,
    CheckName.SPF: 20,
    CheckName.DKIM: 15,
    CheckName.MTA_STS: 7,
    CheckName.TLS_RPT: 3,
}

# Fraction of a check's weight awarded for each status. NOT_ASSESSED is deliberately
# absent: those checks are removed from the denominator instead of scored as zero.
STATUS_CREDIT: dict[CheckStatus, float] = {
    CheckStatus.PASS: 1.0,
    CheckStatus.WARN: 0.5,
    CheckStatus.FAIL: 0.0,
    CheckStatus.MISSING: 0.0,
    CheckStatus.ERROR: 0.0,
}


def grade_for(score: int) -> Grade:
    for threshold, letter in GRADE_THRESHOLDS:
        if score >= threshold:
            return Grade(letter)
    return Grade.F


def score_results(results: list[CheckResult]) -> ScoreBreakdown:
    """Score the checks that were actually assessed, normalised to 100."""
    components: dict[str, float] = {}
    not_assessed: list[str] = []
    earned = 0.0
    possible = 0.0
    for result in results:
        weight = WEIGHTS.get(result.name, 0.0)
        if weight == 0:
            continue
        if result.status is CheckStatus.NOT_ASSESSED:
            not_assessed.append(result.name.value)
            continue
        credit = weight * STATUS_CREDIT[result.status]
        components[result.name.value] = round(credit, 2)
        earned += credit
        possible += weight

    score = round(100 * earned / possible) if possible else 0
    return ScoreBreakdown(score=score, grade=grade_for(score), components=components, not_assessed=not_assessed)
