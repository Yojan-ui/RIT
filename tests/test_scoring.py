from __future__ import annotations

import pytest

from app.engine.scoring import grade_for, score_results
from app.models.enums import CheckName, CheckStatus, Grade
from app.models.schemas import CheckResult


def _r(name: CheckName, status: CheckStatus) -> CheckResult:
    return CheckResult(name=name, status=status)


@pytest.mark.parametrize(
    ("score", "grade"),
    [(100, Grade.A), (90, Grade.A), (89, Grade.B), (65, Grade.C), (50, Grade.D), (49, Grade.F), (0, Grade.F)],
)
def test_grade_thresholds(score, grade):
    assert grade_for(score) is grade


def test_all_pass_is_100():
    results = [_r(n, CheckStatus.PASS) for n in (CheckName.SPF, CheckName.DMARC, CheckName.DKIM)]
    breakdown = score_results(results)
    assert breakdown.score == 100
    assert breakdown.grade is Grade.A


def test_all_missing_is_0():
    results = [_r(n, CheckStatus.MISSING) for n in (CheckName.SPF, CheckName.DMARC)]
    assert score_results(results).score == 0


def test_warn_gives_half_credit():
    breakdown = score_results([_r(CheckName.SPF, CheckStatus.WARN)])
    assert breakdown.score == 50
    assert breakdown.components == {"spf": 10.0}


def test_weighting_is_relative():
    # DMARC (25) pass + SPF (20) fail -> 25/45 ≈ 56
    results = [_r(CheckName.DMARC, CheckStatus.PASS), _r(CheckName.SPF, CheckStatus.FAIL)]
    assert score_results(results).score == 56


def test_not_assessed_is_removed_from_denominator():
    assessed = [_r(CheckName.DMARC, CheckStatus.PASS), _r(CheckName.SPF, CheckStatus.FAIL)]
    with_na = assessed + [_r(CheckName.TRANSPORT, CheckStatus.NOT_ASSESSED)]
    with_fail = assessed + [_r(CheckName.TRANSPORT, CheckStatus.FAIL)]

    assert score_results(with_na).score == score_results(assessed).score == 56
    assert score_results(with_na).not_assessed == ["transport"]
    assert "transport" not in score_results(with_na).components
    # Scoring it as a failure would have dragged the grade down.
    assert score_results(with_fail).score == 45


def test_everything_not_assessed():
    breakdown = score_results([_r(CheckName.TRANSPORT, CheckStatus.NOT_ASSESSED)])
    assert breakdown.score == 0
    assert breakdown.not_assessed == ["transport"]


def test_empty_results():
    breakdown = score_results([])
    assert breakdown.score == 0
    assert breakdown.grade is Grade.F
