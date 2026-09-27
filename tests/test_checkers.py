from __future__ import annotations

import httpx
import pytest

from app.core.constants import COMMON_DKIM_SELECTORS
from app.engine.checkers.dkim import DKIMChecker, analyze_key
from app.engine.checkers.dmarc import DMARCChecker
from app.engine.checkers.mta_sts import MTASTSChecker, mx_matches, parse_policy
from app.engine.checkers.mx import MXChecker
from app.engine.checkers.spf import SPFChecker, parse_spf
from app.engine.checkers.tls_rpt import TLSRPTChecker
from app.models.enums import CheckStatus, Severity
from tests.conftest import RSA_512_SPKI_B64, ed25519_raw_b64


def titles(result) -> list[str]:
    return [f.title for f in result.findings]


def has(result, fragment: str, severity: Severity | None = None) -> bool:
    return any(fragment in f.title and (severity is None or f.severity is severity) for f in result.findings)


# -- MX -----------------------------------------------------------------------------
async def test_mx_pass(make_ctx):
    result = await MXChecker().check(make_ctx("example.com"))
    assert result.status is CheckStatus.PASS
    assert [h["host"] for h in result.data["hosts"]] == ["mx1.example.com", "mx2.example.com"]
    assert result.data["null_mx"] is False


async def test_mx_null(make_ctx):
    result = await MXChecker().check(make_ctx("nomail.test"))
    assert result.status is CheckStatus.PASS
    assert result.data["null_mx"] is True
    assert has(result, "Null MX: domain accepts no mail")


async def test_mx_null_mixed_with_real_mx_fails(make_ctx, fake_resolver):
    fake_resolver.add("mixed.test", "MX", ["0 .", "10 mx.mixed.test"])
    result = await MXChecker().check(make_ctx("mixed.test"))
    assert result.status is CheckStatus.FAIL
    assert has(result, "Null MX mixed", Severity.HIGH)


async def test_mx_missing(make_ctx):
    result = await MXChecker().check(make_ctx("bare.test"))
    assert result.status is CheckStatus.MISSING


async def test_mx_ip_literal(make_ctx, fake_resolver):
    fake_resolver.add("ipmx.test", "MX", ["10 192.0.2.10"])
    result = await MXChecker().check(make_ctx("ipmx.test"))
    assert result.status is CheckStatus.FAIL


async def test_mx_dns_error(make_ctx, fake_resolver):
    fake_resolver.data["broken.test"] = {"ERROR": "SERVFAIL"}
    result = await MXChecker().check(make_ctx("broken.test"))
    assert result.status is CheckStatus.ERROR


# -- SPF ------------------------------------------------------------------------------
def test_parse_spf_terms():
    terms, errors = parse_spf("v=spf1 ip4:192.0.2.0/24 -include:_spf.x.com ~a/24 mx:mail.x.com redirect=_spf.y.com ?all")
    assert errors == []
    assert [(t.qualifier, t.name) for t in terms if not t.modifier] == [
        ("+", "ip4"), ("-", "include"), ("~", "a"), ("+", "mx"), ("?", "all")
    ]
    assert next(t for t in terms if t.modifier).name == "redirect"
    assert next(t for t in terms if t.name == "mx").target == "mail.x.com"


@pytest.mark.parametrize(
    "record",
    ["v=spf1 foo:bar -all", "v=spf1 include -all", "v=spf1 ip4:999.1.1.1 -all", "v=spf1 ip4:2001:db8::/32 -all"],
)
def test_parse_spf_errors(record):
    _, errors = parse_spf(record)
    assert errors


async def test_spf_follows_includes_and_counts(make_ctx):
    result = await SPFChecker().check(make_ctx("example.com"))
    assert result.status is CheckStatus.PASS
    assert result.data["lookup_count"] == 1
    assert result.data["all_result"] == "fail"
    assert result.data["tree"]["children"][0]["domain"] == "_spf.example.com"
    assert result.records == ["v=spf1 include:_spf.example.com -all"]


async def test_spf_recursive_lookup_limit(make_ctx, fake_resolver):
    # 4 top-level includes, each with 2 nested includes + an 'a' => 4 * (1 + 2 + 1) = 16 lookups.
    fake_resolver.add("big.test", "TXT", ["v=spf1 " + " ".join(f"include:p{i}.big.test" for i in range(4)) + " -all"])
    for i in range(4):
        fake_resolver.add(f"p{i}.big.test", "TXT", [f"v=spf1 include:n{i}a.big.test include:n{i}b.big.test a -all"])
        for suffix in "ab":
            fake_resolver.add(f"n{i}{suffix}.big.test", "TXT", ["v=spf1 ip4:198.51.100.0/24 -all"])
    result = await SPFChecker().check(make_ctx("big.test"))
    assert result.data["lookup_count"] == 16
    assert result.status is CheckStatus.FAIL
    assert has(result, "Too many DNS lookups (16 > 10)", Severity.HIGH)


async def test_spf_exactly_ten_is_allowed(make_ctx, fake_resolver):
    fake_resolver.add("ten.test", "TXT", ["v=spf1 " + " ".join(f"include:i{i}.ten.test" for i in range(10)) + " -all"])
    for i in range(10):
        fake_resolver.add(f"i{i}.ten.test", "TXT", ["v=spf1 ip4:203.0.113.1 -all"])
    result = await SPFChecker().check(make_ctx("ten.test"))
    assert result.data["lookup_count"] == 10
    assert not has(result, "Too many DNS lookups")
    assert has(result, "Close to the lookup limit", Severity.LOW)


@pytest.mark.parametrize(
    ("record", "status", "fragment", "severity"),
    [
        ("v=spf1 +all", CheckStatus.FAIL, "+all", Severity.CRITICAL),
        ("v=spf1 all", CheckStatus.FAIL, "+all", Severity.CRITICAL),
        ("v=spf1 ip4:192.0.2.1 ?all", CheckStatus.WARN, "?all", Severity.MEDIUM),
        ("v=spf1 ip4:192.0.2.1 ~all", CheckStatus.PASS, "~all (softfail)", Severity.LOW),
        ("v=spf1 ip4:192.0.2.1", CheckStatus.WARN, "No 'all' mechanism", Severity.MEDIUM),
        ("v=spf1 ptr -all", CheckStatus.PASS, "ptr", Severity.LOW),
        ("v=spf1 ip4:10.0.0.0/8 -all", CheckStatus.FAIL, "broad IP range", Severity.HIGH),
    ],
)
async def test_spf_all_qualifiers_and_mechanisms(make_ctx, fake_resolver, record, status, fragment, severity):
    fake_resolver.add("q.test", "TXT", [record])
    result = await SPFChecker().check(make_ctx("q.test"))
    assert result.status is status, titles(result)
    assert has(result, fragment, severity), titles(result)


async def test_spf_softfail_vs_fail_reported(make_ctx, fake_resolver):
    fake_resolver.add("soft.test", "TXT", ["v=spf1 mx ~all"])
    fake_resolver.add("hard.test", "TXT", ["v=spf1 mx -all"])
    soft = await SPFChecker().check(make_ctx("soft.test"))
    hard = await SPFChecker().check(make_ctx("hard.test"))
    assert soft.data["all_result"] == "softfail"
    assert hard.data["all_result"] == "fail"
    assert not hard.findings


async def test_spf_redirect_supplies_all(make_ctx, fake_resolver):
    fake_resolver.add("r.test", "TXT", ["v=spf1 redirect=_spf.r.test"])
    fake_resolver.add("_spf.r.test", "TXT", ["v=spf1 ip4:192.0.2.1 -all"])
    result = await SPFChecker().check(make_ctx("r.test"))
    assert result.data["all_result"] == "fail"
    assert result.data["lookup_count"] == 1
    assert result.status is CheckStatus.PASS


async def test_spf_include_without_record_is_permerror(make_ctx, fake_resolver):
    fake_resolver.add("i.test", "TXT", ["v=spf1 include:gone.test include:nospf.test -all"])
    fake_resolver.add("nospf.test", "TXT", ["some-verification=1"])
    result = await SPFChecker().check(make_ctx("i.test"))
    assert result.status is CheckStatus.FAIL
    details = " ".join(f.detail for f in result.findings)
    assert "gone.test has no SPF record" in details and "nospf.test has no SPF record" in details
    assert result.data["void_lookup_count"] == 1  # gone.test is NXDOMAIN; nospf.test has TXT


async def test_spf_void_lookup_limit(make_ctx, fake_resolver):
    fake_resolver.add("v.test", "TXT", ["v=spf1 " + " ".join(f"include:void{i}.test" for i in range(3)) + " -all"])
    result = await SPFChecker().check(make_ctx("v.test"))
    assert result.data["void_lookup_count"] == 3
    assert has(result, "Too many void lookups", Severity.HIGH)


async def test_spf_include_loop_detected(make_ctx, fake_resolver):
    fake_resolver.add("loop-a.test", "TXT", ["v=spf1 include:loop-b.test -all"])
    fake_resolver.add("loop-b.test", "TXT", ["v=spf1 include:loop-a.test -all"])
    result = await SPFChecker().check(make_ctx("loop-a.test"))
    assert any("include loop" in f.detail for f in result.findings)
    assert result.status is CheckStatus.FAIL


async def test_spf_multiple_records(make_ctx, fake_resolver):
    fake_resolver.add("dup.test", "TXT", ["v=spf1 -all", "v=spf1 mx -all"])
    result = await SPFChecker().check(make_ctx("dup.test"))
    assert has(result, "Multiple SPF records", Severity.HIGH)


async def test_spf_macros_not_followed(make_ctx, fake_resolver):
    fake_resolver.add("m.test", "TXT", ["v=spf1 exists:%{i}._spf.m.test include:%{d}.inc.test -all"])
    result = await SPFChecker().check(make_ctx("m.test"))
    assert result.data["lookup_count"] == 2
    assert has(result, "Macros not evaluated")


async def test_spf_missing(make_ctx):
    result = await SPFChecker().check(make_ctx("bare.test"))
    assert result.status is CheckStatus.MISSING


# -- DMARC ----------------------------------------------------------------------------
async def test_dmarc_reject(make_ctx):
    result = await DMARCChecker().check(make_ctx("example.com"))
    assert result.status is CheckStatus.PASS
    assert result.data["policy"] == "reject"
    assert result.data["adkim"] == "s" and result.data["aspf"] == "r"
    assert result.data["rua"] == ["mailto:dmarc@example.com"]


async def test_dmarc_all_tags_parsed(make_ctx, fake_resolver):
    fake_resolver.add(
        "_dmarc.t.test",
        "TXT",
        ["v=DMARC1;p=quarantine;sp=reject;pct=50;rua=mailto:a@t.test!10m,mailto:b@t.test;ruf=mailto:f@t.test;adkim=r;aspf=s;fo=1"],
    )
    result = await DMARCChecker().check(make_ctx("t.test"))
    d = result.data
    assert (d["policy"], d["subdomain_policy"], d["pct"], d["adkim"], d["aspf"]) == ("quarantine", "reject", 50, "r", "s")
    assert d["rua"] == ["mailto:a@t.test", "mailto:b@t.test"]
    assert d["ruf"] == ["mailto:f@t.test"]
    assert has(result, "only 50%", Severity.MEDIUM)
    assert result.status is CheckStatus.WARN


async def test_dmarc_p_none_fails(make_ctx, fake_resolver):
    fake_resolver.add("_dmarc.n.test", "TXT", ["v=DMARC1; p=none; rua=mailto:d@n.test"])
    result = await DMARCChecker().check(make_ctx("n.test"))
    assert result.status is CheckStatus.FAIL
    assert has(result, "p=none", Severity.HIGH)


async def test_dmarc_sp_none_weakens_subdomains(make_ctx, fake_resolver):
    fake_resolver.add("_dmarc.s.test", "TXT", ["v=DMARC1; p=reject; sp=none; rua=mailto:d@s.test"])
    result = await DMARCChecker().check(make_ctx("s.test"))
    assert has(result, "sp=none", Severity.MEDIUM)


@pytest.mark.parametrize(
    ("record", "fragment"),
    [
        ("v=DMARC1; rua=mailto:d@x.test", "Missing or invalid p="),
        ("v=DMARC1; p=block", "Missing or invalid p="),
        ("v=DMARC1; p=reject; pct=150", "Invalid pct="),
        ("v=DMARC1; p=reject; adkim=x", "Invalid adkim="),
        ("v=DMARC1; p=reject; aspf=strict", "Invalid aspf="),
    ],
)
async def test_dmarc_invalid_tags(make_ctx, fake_resolver, record, fragment):
    fake_resolver.add("_dmarc.x.test", "TXT", [record])
    result = await DMARCChecker().check(make_ctx("x.test"))
    assert has(result, fragment), titles(result)


async def test_dmarc_missing_and_multiple(make_ctx, fake_resolver):
    assert (await DMARCChecker().check(make_ctx("bare.test"))).status is CheckStatus.MISSING
    fake_resolver.add("_dmarc.two.test", "TXT", ["v=DMARC1; p=reject", "v=DMARC1; p=none"])
    assert (await DMARCChecker().check(make_ctx("two.test"))).status is CheckStatus.FAIL


async def test_dmarc_inherits_from_org_domain(make_ctx):
    result = await DMARCChecker().check(make_ctx("mail.example.com"))
    assert result.data["inherited"] is True
    assert result.data["policy_domain"] == "example.com"
    assert result.status is CheckStatus.PASS


async def test_dmarc_external_rua_needs_authorisation(make_ctx, fake_resolver):
    fake_resolver.add("_dmarc.ext.test", "TXT", ["v=DMARC1; p=reject; rua=mailto:r@vendor.test,mailto:r@ok-vendor.test"])
    fake_resolver.add("vendor.test", "TXT", [])  # exists, but no authorisation record below it
    fake_resolver.add("ext.test._report._dmarc.ok-vendor.test", "TXT", ["v=DMARC1"])
    result = await DMARCChecker().check(make_ctx("ext.test"))
    assert has(result, "vendor.test not authorised", Severity.MEDIUM)
    assert not has(result, "ok-vendor.test not authorised")


# -- DKIM -------------------------------------------------------------------------------
def test_analyze_key_rsa_2048(rsa2048_b64):
    info, findings = analyze_key("s1", f"v=DKIM1; k=rsa; p={rsa2048_b64}")
    assert info["bits"] == 2048
    assert findings == []


def test_analyze_key_rsa_1024(rsa1024_b64):
    info, findings = analyze_key("s1", f"v=DKIM1; p={rsa1024_b64}")
    assert info["bits"] == 1024
    assert [f.severity for f in findings] == [Severity.MEDIUM]


def test_analyze_key_rsa_512():
    info, findings = analyze_key("s1", f"v=DKIM1; k=rsa; p={RSA_512_SPKI_B64}")
    assert info["bits"] == 512
    assert findings[0].severity is Severity.HIGH and "RFC 8301" in findings[0].detail


def test_analyze_key_handles_whitespace_in_p(rsa2048_b64):
    spaced = " ".join(rsa2048_b64[i : i + 64] for i in range(0, len(rsa2048_b64), 64))
    info, _ = analyze_key("s1", f"v=DKIM1; p={spaced}")
    assert info["bits"] == 2048


def test_analyze_key_ed25519():
    info, findings = analyze_key("ed", f"v=DKIM1; k=ed25519; p={ed25519_raw_b64()}")
    assert info["key_type"] == "ed25519" and info["bits"] == 256
    assert findings == []


@pytest.mark.parametrize(
    ("record", "fragment", "severity"),
    [
        ("v=DKIM1; p=", "Revoked key", Severity.INFO),
        ("v=DKIM1; p=!!!notbase64", "Undecodable key", Severity.HIGH),
        ("v=DKIM1; p=aGVsbG8=", "Unparseable RSA key", Severity.HIGH),
        ("v=DKIM1; k=ed25519; p=aGVsbG8=", "Invalid Ed25519 key", Severity.HIGH),
    ],
)
def test_analyze_key_problems(record, fragment, severity):
    _, findings = analyze_key("x", record)
    assert any(fragment in f.title and f.severity is severity for f in findings)


def test_analyze_key_sha1_and_testing(rsa2048_b64):
    _, findings = analyze_key("x", f"v=DKIM1; h=sha1; t=y; p={rsa2048_b64}")
    sev = {f.title.split(" (")[0]: f.severity for f in findings}
    assert sev == {"SHA-1 only": Severity.HIGH, "Testing mode t=y": Severity.LOW}


async def test_dkim_probes_selectors(make_ctx, fake_resolver, rsa2048_b64, rsa1024_b64):
    fake_resolver.add("google._domainkey.example.com", "TXT", [f"v=DKIM1; k=rsa; p={rsa2048_b64}"])
    fake_resolver.add("selector1._domainkey.example.com", "TXT", [f"v=DKIM1; k=rsa; p={rsa1024_b64}"])
    result = await DKIMChecker().check(make_ctx("example.com"))
    assert result.status is CheckStatus.WARN
    assert {k["selector"]: k["bits"] for k in result.data["keys"]} == {"google": 2048, "selector1": 1024}
    probed = {q[0] for q in fake_resolver.queries}
    assert {f"{s}._domainkey.example.com" for s in COMMON_DKIM_SELECTORS} <= probed
    assert all(scope == "example.com" for _, _, scope in fake_resolver.queries)


async def test_dkim_custom_selector_probed_first(make_ctx, fake_resolver, rsa2048_b64):
    fake_resolver.add("custom2024._domainkey.example.com", "TXT", [f"v=DKIM1; p={rsa2048_b64}"])
    result = await DKIMChecker().check(make_ctx("example.com", selectors=["custom2024"]))
    assert result.status is CheckStatus.PASS
    assert result.data["selectors_probed"][0] == "custom2024"


async def test_dkim_nothing_found_is_not_assessed(make_ctx):
    # Absence at guessed selectors is not proof that DKIM is missing.
    result = await DKIMChecker().check(make_ctx("example.com"))
    assert result.status is CheckStatus.NOT_ASSESSED


async def test_dkim_nothing_at_supplied_selector_is_missing(make_ctx):
    result = await DKIMChecker().check(make_ctx("example.com", selectors=["mine"]))
    assert result.status is CheckStatus.MISSING


async def test_dkim_wildcard_revoked(make_ctx, fake_resolver):
    for sel in COMMON_DKIM_SELECTORS:
        fake_resolver.add(f"{sel}._domainkey.nomail.test", "TXT", ["v=DKIM1; p="])
    result = await DKIMChecker().check(make_ctx("nomail.test"))
    assert result.status is CheckStatus.PASS
    assert result.data["wildcard"] is True
    assert len(result.data["keys"]) == 1


# -- MTA-STS -----------------------------------------------------------------------------
def test_parse_policy_valid():
    policy = parse_policy("version: STSv1\nmode: enforce\nmx: mail.example.com\nmx: *.example.net\nmax_age: 86400\n")
    assert policy.errors == []
    assert policy.mode == "enforce" and policy.max_age == 86400
    assert policy.mx == ["mail.example.com", "*.example.net"]


def test_parse_policy_invalid():
    policy = parse_policy("version: STSv2\nmode: strict\nmax_age: forever\n")
    assert len(policy.errors) == 4  # version, mode, max_age int, max_age required


@pytest.mark.parametrize(
    ("host", "pattern", "ok"),
    [
        ("mx1.example.com", "mx1.example.com", True),
        ("MX1.Example.com.", "mx1.example.com", True),
        ("mx1.example.com", "*.example.com", True),
        ("a.b.example.com", "*.example.com", False),
        ("example.com", "*.example.com", False),
        ("mx1.example.org", "*.example.com", False),
    ],
)
def test_mx_matches(host, pattern, ok):
    assert mx_matches(host, pattern) is ok


async def test_mta_sts_enforce(make_ctx):
    result = await MTASTSChecker().check(make_ctx("example.com"))
    assert result.status is CheckStatus.PASS, titles(result)
    assert result.data["mode"] == "enforce"
    assert result.data["uncovered_mx"] == []


async def test_mta_sts_testing_mode_and_uncovered_mx(make_ctx, http_routes):
    http_routes["https://mta-sts.example.com/.well-known/mta-sts.txt"] = httpx.Response(
        200, text="version: STSv1\nmode: testing\nmx: mx1.example.com\nmax_age: 3600\n", headers={"content-type": "text/plain"}
    )
    result = await MTASTSChecker().check(make_ctx("example.com"))
    assert result.status is CheckStatus.WARN
    assert has(result, "testing mode", Severity.MEDIUM)
    assert has(result, "Short max_age", Severity.LOW)
    assert result.data["uncovered_mx"] == ["mx2.example.com"]


@pytest.mark.parametrize(
    ("response", "fragment"),
    [
        (httpx.Response(404), "HTTP 404"),
        (httpx.Response(301, headers={"location": "https://elsewhere.test/"}), "redirects"),
        (httpx.Response(200, text="version: STSv1", headers={"content-type": "text/html"}), "text/plain"),
    ],
)
async def test_mta_sts_policy_fetch_problems(make_ctx, http_routes, response, fragment):
    http_routes["https://mta-sts.example.com/.well-known/mta-sts.txt"] = response
    result = await MTASTSChecker().check(make_ctx("example.com"))
    assert result.status is CheckStatus.FAIL
    assert fragment in result.findings[0].detail


async def test_mta_sts_unreachable(make_ctx, http_routes):
    http_routes.clear()
    result = await MTASTSChecker().check(make_ctx("example.com"))
    assert result.status is CheckStatus.FAIL
    assert has(result, "Policy not retrievable", Severity.HIGH)


async def test_mta_sts_missing_and_null_mx(make_ctx):
    assert (await MTASTSChecker().check(make_ctx("bare.test"))).status is CheckStatus.MISSING
    na = await MTASTSChecker().check(make_ctx("nomail.test"))
    assert na.status is CheckStatus.NOT_ASSESSED and na.summary.startswith("Not applicable")


async def test_mta_sts_bad_id(make_ctx, fake_resolver):
    fake_resolver.add("_mta-sts.example.com", "TXT", ["v=STSv1; id=not-valid!"])
    result = await MTASTSChecker().check(make_ctx("example.com"))
    assert has(result, "Invalid id=", Severity.HIGH)


# -- TLS-RPT -------------------------------------------------------------------------------
async def test_tls_rpt(make_ctx, fake_resolver):
    ok = await TLSRPTChecker().check(make_ctx("example.com"))
    assert ok.status is CheckStatus.PASS and ok.data["rua"] == ["mailto:tls-reports@example.com"]

    fake_resolver.add("_smtp._tls.bad.test", "TXT", ["v=TLSRPTv1; rua=ftp://x.test"])
    bad = await TLSRPTChecker().check(make_ctx("bad.test"))
    assert bad.status is CheckStatus.WARN and has(bad, "Invalid report URI")

    fake_resolver.add("_smtp._tls.norua.test", "TXT", ["v=TLSRPTv1;"])
    assert has(await TLSRPTChecker().check(make_ctx("norua.test")), "Missing rua=")

    assert (await TLSRPTChecker().check(make_ctx("bare.test"))).status is CheckStatus.MISSING
    assert (await TLSRPTChecker().check(make_ctx("nomail.test"))).status is CheckStatus.NOT_ASSESSED
