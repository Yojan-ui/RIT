import pytest

from app import demo
from app.analysis.checks import WEIGHTS, evaluate_dmarc, evaluate_mta_sts, evaluate_spf
from app.analysis.parsers import estimate_dkim_key_bits, mx_matches_pattern, parse_spf, parse_tags
from app.analysis.scoring import analyze
from app.models import MtaStsLookup, MxHost, MxLookup, SpfLookup, Status, TxtLookup


def test_weights_sum_to_100():
    assert sum(WEIGHTS.values()) == 100


# ---- parsers ---------------------------------------------------------------- #


def test_parse_spf_splits_all_and_mechanisms():
    rec = parse_spf("v=spf1 ip4:192.0.2.0/24 include:_spf.google.com ~all")
    assert rec.all_qualifier == "~"
    assert rec.mechanisms == ["ip4:192.0.2.0/24", "include:_spf.google.com"]


def test_parse_tags_first_key_wins_and_lowercases_keys():
    assert parse_tags("v=DMARC1; P=reject; p=none; rua=mailto:a@b.c") == {
        "v": "DMARC1", "p": "reject", "rua": "mailto:a@b.c"}


@pytest.mark.parametrize("key, bits", [(demo._KEY_2048, 2048), (demo._KEY_1024, 1024)])
def test_dkim_key_size_estimate(key, bits):
    assert estimate_dkim_key_bits({"p": key}) == bits


def test_mx_pattern_wildcard_matches_one_label_only():
    assert mx_matches_pattern("mx1.example.com", "*.example.com")
    assert not mx_matches_pattern("a.b.example.com", "*.example.com")
    assert not mx_matches_pattern("example.com", "*.example.com")


# ---- individual checks ------------------------------------------------------ #


def test_spf_over_lookup_limit_is_permerror():
    result = evaluate_spf(SpfLookup(records=["v=spf1 include:a include:b -all"], lookup_count=11))
    assert result.status == Status.FAIL and result.details["state"] == "invalid"


def test_spf_multiple_records_is_invalid():
    result = evaluate_spf(SpfLookup(records=["v=spf1 -all", "v=spf1 mx -all"]))
    assert result.details["state"] == "invalid" and result.score == 0


def test_dmarc_pct_and_missing_rua_reduce_score():
    full = evaluate_dmarc(TxtLookup(records=["v=DMARC1; p=reject; rua=mailto:x@y.z"]), has_auth=True)
    partial = evaluate_dmarc(TxtLookup(records=["v=DMARC1; p=reject; pct=50"]), has_auth=True)
    assert full.score == 1.0 and full.status == Status.PASS
    assert partial.score < full.score and partial.status == Status.WARN


def test_mta_sts_enforce_not_covering_mx_fails():
    mx = MxLookup(hosts=[MxHost(preference=10, host="mx.other.example", addresses=["192.0.2.1"])])
    lookup = MtaStsLookup(txt=TxtLookup(records=["v=STSv1; id=1"]),
                          policy="version: STSv1\nmode: enforce\nmx: *.example.com\nmax_age: 86400\n")
    result = evaluate_mta_sts(lookup, mx, receives_mail=True)
    assert result.status == Status.FAIL and result.details["state"] == "broken"


# ---- whole-pipeline scenarios ---------------------------------------------- #


def _run(scenario_id):
    return analyze(demo.observations_for(scenario_id))


def test_fortress_scores_100_with_no_fix():
    result = _run("fortress")
    assert result.score == 100 and result.grade == "A"
    assert result.one_fix is None
    assert all(a.state != "open" for a in result.attack_paths)


def test_startup_one_fix_is_dmarc_enforcement():
    fix = _run("startup").one_fix
    assert fix.id == "dmarc"
    assert "p=quarantine" in fix.record.value
    assert "exact_domain_spoofing" in fix.closes
    assert fix.score_after > fix.score_before


def test_wide_open_never_recommends_dmarc_enforcement_without_auth():
    result = _run("wide-open")
    dmarc = next(f for f in result.fixes if f.id == "dmarc")
    assert "p=none" in dmarc.record.value  # enforcing would reject the domain's own mail
    assert "mta_sts" not in {f.id for f in result.fixes}  # no STARTTLS -> enforce would break delivery
    cleartext = next(a for a in result.attack_paths if a.id == "cleartext_delivery")
    assert cleartext.state == "open" and not cleartext.dns_fixable


def test_legacy_corp_fix_drops_pct_and_sp_none():
    fix = _run("legacy-corp").one_fix
    assert fix.id == "dmarc"
    assert "pct=" not in fix.record.value and "sp=" not in fix.record.value
    assert set(fix.closes) == {"exact_domain_spoofing", "subdomain_spoofing"}


def test_parked_domain_goes_straight_to_reject_and_skips_mail_checks():
    result = _run("parked")
    assert "p=reject" in result.one_fix.record.value
    assert not result.checks["dkim"].applicable
    assert not result.checks["starttls"].applicable


def test_unreachable_port_25_is_excluded_from_score():
    result = _run("firewalled")
    assert result.checks["starttls"].status == Status.ERROR
    assert not result.checks["starttls"].applicable
    assert result.one_fix.id == "mta_sts"
