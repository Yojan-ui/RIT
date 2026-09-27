from __future__ import annotations

from app.core.cache import DomainCache
from app.engine.attack_paths import RULES, assess_attack_paths, derive_attack_paths
from app.engine.checkers import CHECKERS
from app.engine.scanner import scan_domain
from app.engine.remediation import pick_one_fix
from app.models.enums import CheckName, CheckStatus, Exposure
from app.models.schemas import CheckResult


async def test_scan_domain_runs_every_checker(fake_resolver, http_client, settings):
    result = await scan_domain("example.com", fake_resolver, http_client, settings)
    by_name = {c.name: c for c in result.checks}
    assert set(by_name) == {cls.name for cls in CHECKERS}
    assert by_name[CheckName.SPF].status is CheckStatus.PASS
    assert by_name[CheckName.DMARC].status is CheckStatus.PASS
    assert by_name[CheckName.MTA_STS].status is CheckStatus.PASS
    # DKIM (no selector found) and transport (probe disabled) are excluded, not failed.
    assert set(result.score.not_assessed) == {"dkim", "transport"}
    assert result.score.score == 100


async def test_scan_domain_isolates_crashing_checker(fake_resolver, http_client, settings, monkeypatch):
    from app.engine.checkers.spf import SPFChecker

    async def boom(self, ctx):
        raise RuntimeError("kaboom")

    monkeypatch.setattr(SPFChecker, "check", boom)
    result = await scan_domain("example.com", fake_resolver, http_client, settings)
    spf = next(c for c in result.checks if c.name is CheckName.SPF)
    assert spf.status is CheckStatus.ERROR
    assert "kaboom" in spf.data["error"]


def _dmarc(policy: str, **tags) -> CheckResult:
    tags = {"v": "DMARC1", "p": policy, **tags}
    return CheckResult(
        name=CheckName.DMARC,
        status=CheckStatus.PASS if policy != "none" else CheckStatus.WARN,
        data={
            "tags": tags,
            "policy": policy,
            "subdomain_policy": tags.get("sp"),
            "pct": int(tags.get("pct", 100)),
            "rua": [tags["rua"]] if "rua" in tags else [],
        },
    )


def _exposure(results: list[CheckResult]) -> dict[str, Exposure]:
    return {p.id: p.exposure for p in assess_attack_paths(results)}


def test_matrix_always_has_seven_paths_in_order():
    matrix = assess_attack_paths([])
    assert len(RULES) == 7
    assert [p.id for p in matrix] == [r.path.id for r in RULES]
    assert {p.exposure for p in matrix} == {Exposure.UNKNOWN}


def test_attack_paths_from_missing_dmarc():
    paths = derive_attack_paths([CheckResult(name=CheckName.DMARC, status=CheckStatus.MISSING)])
    assert [p.id for p in paths] == ["direct-spoofing", "subdomain-spoofing", "undetected-abuse"]


def test_attack_paths_none_when_passing_or_not_assessed():
    assert derive_attack_paths([CheckResult(name=CheckName.MTA_STS, status=CheckStatus.NOT_ASSESSED)]) == []
    exposure = _exposure([CheckResult(name=CheckName.DMARC, status=CheckStatus.PASS)])
    assert exposure["direct-spoofing"] is Exposure.MITIGATED


def test_dmarc_policy_levels():
    assert _exposure([_dmarc("none")])["direct-spoofing"] is Exposure.EXPOSED
    assert _exposure([_dmarc("reject", pct="50")])["direct-spoofing"] is Exposure.PARTIAL
    enforced_parent = _exposure([_dmarc("reject", sp="none")])
    assert enforced_parent["direct-spoofing"] is Exposure.MITIGATED
    assert enforced_parent["subdomain-spoofing"] is Exposure.EXPOSED


def test_spf_all_qualifiers():
    def spf(result: str) -> Exposure:
        check = CheckResult(name=CheckName.SPF, status=CheckStatus.PASS, data={"all_result": result, "record": "v=spf1"})
        return _exposure([check])["envelope-spoofing"]

    assert spf("fail") is Exposure.MITIGATED
    assert spf("softfail") is Exposure.PARTIAL
    assert spf("neutral") is Exposure.EXPOSED
    assert spf("pass") is Exposure.EXPOSED


def test_reporting_needs_both_rua_and_tlsrpt():
    tlsrpt = CheckResult(name=CheckName.TLS_RPT, status=CheckStatus.PASS)
    assert _exposure([_dmarc("reject", rua="mailto:r@example.com"), tlsrpt])["undetected-abuse"] is Exposure.MITIGATED
    assert _exposure([_dmarc("reject"), tlsrpt])["undetected-abuse"] is Exposure.PARTIAL


def test_one_fix_prefers_dmarc_and_builds_record():
    results = [
        CheckResult(name=CheckName.DMARC, status=CheckStatus.MISSING),
        CheckResult(name=CheckName.MTA_STS, status=CheckStatus.MISSING),
        CheckResult(name=CheckName.SPF, status=CheckStatus.PASS, data={"all_result": "fail", "record": "v=spf1 -all"}),
    ]
    fix = pick_one_fix("example.com", results, assess_attack_paths(results))
    assert fix is not None and fix.control is CheckName.DMARC
    assert fix.host == "_dmarc.example.com"
    assert fix.record == "v=DMARC1; p=quarantine; rua=mailto:dmarc-reports@example.com"
    assert set(fix.closes) == {"direct-spoofing", "subdomain-spoofing", "undetected-abuse"}
    assert fix.score_gain > 0


def test_one_fix_upgrades_existing_dmarc_record():
    results = [_dmarc("none", sp="none", pct="20", rua="mailto:r@example.com", fo="1")]
    fix = pick_one_fix("example.com", results, assess_attack_paths(results))
    assert fix.title == "Enforce your DMARC policy"
    assert fix.record == "v=DMARC1; p=quarantine; rua=mailto:r@example.com; fo=1"


def test_one_fix_tightens_spf_softfail():
    spf = CheckResult(
        name=CheckName.SPF,
        status=CheckStatus.PASS,
        data={"all_result": "softfail", "record": "v=spf1 include:_spf.google.com ~all"},
    )
    fix = pick_one_fix("example.com", [spf], assess_attack_paths([spf]))
    assert fix.record == "v=spf1 include:_spf.google.com -all"


def test_one_fix_none_when_nothing_open():
    results = [_dmarc("reject", rua="mailto:r@example.com")]
    assert pick_one_fix("example.com", results, assess_attack_paths(results)) is None


async def test_cache_roundtrip_and_ttl(tmp_path):
    cache = DomainCache(tmp_path / "c.sqlite3", default_ttl=60)
    await cache.connect()
    try:
        assert await cache.get("example.com") is None
        await cache.set("Example.com", {"hello": "world"})
        assert await cache.get("example.com") == {"hello": "world"}
        assert [r["domain"] for r in await cache.recent()] == ["example.com"]

        await cache.set("expired.com", {"x": 1}, ttl=0)
        assert await cache.get("expired.com") is None
    finally:
        await cache.close()


# -- API ------------------------------------------------------------------------------
def test_health(client):
    r = client.get("/api/v1/health")
    assert r.status_code == 200
    assert r.json()["status"] == "ok"




def test_scan_api_uses_cache(client):
    first = client.post("/api/v1/scan", json={"domain": "https://Example.com/"}).json()
    second = client.post("/api/v1/scan", json={"domain": "example.com"}).json()
    assert first["domain"] == "example.com"
    assert first["cached"] is False
    assert second["cached"] is True
    assert client.get("/api/v1/recent").json()[0]["domain"] == "example.com"


def test_scan_api_custom_selectors_bypass_cache(client):
    client.post("/api/v1/scan", json={"domain": "example.com"})
    r = client.post("/api/v1/scan", json={"domain": "example.com", "dkim_selectors": ["mine"]}).json()
    assert r["cached"] is False
    dkim = next(c for c in r["checks"] if c["name"] == "dkim")
    assert dkim["status"] == "missing"


def test_scan_api_rejects_ip(client):
    r = client.post("/api/v1/scan", json={"domain": "192.0.2.1"})
    assert r.status_code == 422
    assert client.get("/api/v1/scan/192.0.2.1").status_code == 422






def test_one_fix_titles_rua_only_change_accurately():
    results = [_dmarc("reject", sp="reject")]
    fix = pick_one_fix("example.com", results, assess_attack_paths(results))
    assert fix.title == "Turn on DMARC reports"
    assert fix.record == "v=DMARC1; p=reject; sp=reject; rua=mailto:dmarc-reports@example.com"
    assert fix.closes == ["undetected-abuse"]


def test_matrix_cells_reflect_the_path_not_the_whole_check():
    by_id = {p.id: p for p in assess_attack_paths([_dmarc("none", sp="reject", rua="mailto:r@example.com")])}
    assert by_id["direct-spoofing"].control_exposure == {CheckName.DMARC: Exposure.EXPOSED}
    assert by_id["subdomain-spoofing"].control_exposure == {CheckName.DMARC: Exposure.MITIGATED}
    assert by_id["undetected-abuse"].control_exposure[CheckName.DMARC] is Exposure.MITIGATED


def test_scan_api_explains_invalid_domains(client):
    r = client.post("/api/v1/scan", json={"domain": "not a domain"})
    assert r.status_code == 422 and "invalid domain" in r.text
    r = client.post("/api/v1/scan", json={"domain": "10.0.0.1"})
    assert r.status_code == 422 and "IP addresses are not accepted" in r.text


def test_recent_scans_are_typed(client):
    client.post("/api/v1/scan", json={"domain": "example.com"})
    body = client.get("/api/v1/recent").json()
    assert body[0]["domain"] == "example.com" and body[0]["scanned_at"].endswith(("Z", "+00:00"))
