"""The single-file browser build (offline_scanner.html) must agree with the Python engine.

The engine <script> is extracted from the HTML and run under Node against the same offline
DNS fixtures as the backend. Every check status, summary and finding, the score, all seven
attack paths and the one fix are compared. Skipped when Node isn't installed.
"""

from __future__ import annotations

import base64
import copy
import json
import shutil
import subprocess
from pathlib import Path

import httpx
import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa

from app.engine.dns_resolver import InvalidDomainError, normalize_domain
from app.engine.scanner import build_result, scan_domain
from app.models.schemas import CheckResult, ScanResult
from tests.conftest import FIXTURES, RSA_512_SPKI_B64, FakeResolver, rsa_spki_b64

ROOT = Path(__file__).resolve().parent.parent
HTML = ROOT / "offline_scanner.html"
HARNESS = Path(__file__).parent / "js" / "offline_harness.cjs"
NODE = shutil.which("node")

pytestmark = pytest.mark.skipif(NODE is None, reason="Node.js is required to run the browser engine")

POLICY = "version: STSv1\r\nmode: {mode}\r\nmx: {mx}\r\nmax_age: {age}\r\n"


def _run_js(job: dict) -> dict:
    proc = subprocess.run(
        [NODE, str(HARNESS), str(HTML)], input=json.dumps(job), capture_output=True, text=True, timeout=60, check=False
    )
    assert proc.returncode == 0, proc.stderr
    return json.loads(proc.stdout)


def _scenarios() -> dict[str, dict]:
    """Phase 5 scenarios plus zones that exercise the less common branches."""
    shipped = {k: v for k, v in json.loads((FIXTURES / "scenarios.json").read_text()).items() if not k.startswith("_")}
    base = json.loads((FIXTURES / "dns_records.json").read_text())
    rsa1024 = rsa_spki_b64(1024)
    extra = {
        "fixture-example": {"domain": "example.com", "zone": base, "http": {
            "https://mta-sts.example.com/.well-known/mta-sts.txt": POLICY.format(mode="enforce", mx="*.example.com", age=604800)}},
        "null-mx": {"domain": "nomail.test", "zone": base, "http": {}},
        "bare": {"domain": "bare.test", "zone": base, "http": {}},
        "messy": {
            "domain": "messy.test",
            "dkim_selectors": ["old", "weak"],
            "zone": {
                "messy.test": {"MX": ["10 mx1.messy.test", "10 mx2.messy.test"],
                               "TXT": ["v=spf1 ptr ip4:10.0.0.0/8 include:a.messy.test include:gone.messy.test ~all"]},
                "a.messy.test": {"TXT": ["v=spf1 include:b.messy.test ?all"]},
                "b.messy.test": {"TXT": ["v=spf1 include:a.messy.test"]},
                "_dmarc.messy.test": {"TXT": ["v=DMARC1; p=reject; sp=none; pct=40; rua=mailto:r@reports.example; adkim=x; zz=1"]},
                "old._domainkey.messy.test": {"TXT": [f"v=DKIM1; k=rsa; t=y; h=sha1; p={RSA_512_SPKI_B64}"]},
                "weak._domainkey.messy.test": {"TXT": [f"v=DKIM1; p={rsa1024}"]},
                "_mta-sts.messy.test": {"TXT": ["v=STSv1; id=bad-id!"]},
                "_smtp._tls.messy.test": {"TXT": ["v=TLSRPTv1; rua=ftp://x.test"]},
            },
            "http": {"https://mta-sts.messy.test/.well-known/mta-sts.txt": POLICY.format(mode="testing", mx="mx1.messy.test", age=3600)},
        },
        "inherited-subdomain": {
            "domain": "mail.shop.co.uk",
            "zone": {
                "mail.shop.co.uk": {"MX": ["5 192.0.2.1"], "TXT": ["v=spf1 +all", "v=spf1 -all"]},
                "_dmarc.shop.co.uk": {"TXT": ["v=DMARC1; p=quarantine; sp=none"]},
                "_mta-sts.mail.shop.co.uk": {"TXT": ["v=STSv1; id=1"]},
            },
            "http": {},  # policy fetch fails: exercises the unreachable-policy path
        },
        "rollout": {  # clean MTA-STS in testing mode, DMARC reports but no TLS-RPT: the "partial" branches
            "domain": "rollout.test",
            "zone": {
                "rollout.test": {"MX": ["10 mx.rollout.test"], "TXT": ["v=spf1 include:_spf.rollout.test -all"]},
                "_spf.rollout.test": {"TXT": ["v=spf1 ip4:198.51.100.0/24 -all"]},
                "_dmarc.rollout.test": {"TXT": ["v=DMARC1; p=reject; rua=mailto:dmarc@rollout.test"]},
                "_mta-sts.rollout.test": {"TXT": ["v=STSv1; id=2026"]},
            },
            "http": {"https://mta-sts.rollout.test/.well-known/mta-sts.txt": POLICY.format(mode="testing", mx="mx.rollout.test", age=604800)},
        },
        "dns-errors": {"domain": "broken.test", "zone": {"broken.test": {"ERROR": "SERVFAIL"}}, "http": {}},
    }
    return {**{k: {kk: v[kk] for kk in ("domain", "dkim_selectors", "zone", "http")} for k, v in shipped.items()}, **extra}


async def _python_result(sc: dict, js_transport: dict, settings) -> ScanResult:
    routes = {u: httpx.Response(200, text=t, headers={"content-type": "text/plain"}) for u, t in sc["http"].items()}

    def handler(request: httpx.Request) -> httpx.Response:
        if (route := routes.get(str(request.url))) is None:
            raise httpx.ConnectError("no route (test)", request=request)
        return route

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as http:
        scanned = await scan_domain(
            sc["domain"], FakeResolver(copy.deepcopy(sc["zone"])), http,  # type: ignore[arg-type]
            settings.model_copy(update={"smtp_probe_enabled": False}), dkim_selectors=sc.get("dkim_selectors") or [],
        )
    # A browser can never probe SMTP, so compare against the backend with the browser's transport verdict.
    checks = [CheckResult.model_validate(js_transport) if c.name.value == "transport" else c for c in scanned.checks]
    return build_result(scanned.domain, checks)


def _check_view(check: dict) -> dict:
    return {
        "status": check["status"],
        "summary": check["summary"],
        "findings": sorted((f["severity"], f["title"]) for f in check["findings"]),
        "records": check["records"],
    }


def _path_view(p: dict) -> dict:
    return {k: p[k] for k in ("id", "title", "severity", "enabled_by", "exposure", "reason", "fix_control", "control_exposure")}


SCENARIOS = _scenarios()  # built once: it contains a freshly generated DKIM key


@pytest.fixture(scope="module")
def js_scans() -> dict:
    return _run_js({"scenarios": SCENARIOS})["scenarios"]


@pytest.mark.parametrize("name", sorted(SCENARIOS))
async def test_browser_engine_matches_backend(name, js_scans, settings):
    js = js_scans[name]
    js_transport = next(c for c in js["checks"] if c["name"] == "transport")
    py = json.loads((await _python_result(SCENARIOS[name], js_transport, settings)).model_dump_json())

    assert js["domain"] == py["domain"]
    assert [c["name"] for c in js["checks"]] == [c["name"] for c in py["checks"]]
    for js_check, py_check in zip(js["checks"], py["checks"]):
        assert _check_view(js_check) == _check_view(py_check), js_check["name"]
    assert js["score"] == py["score"]
    assert [_path_view(p) for p in js["attack_matrix"]] == [_path_view(p) for p in py["attack_matrix"]]
    assert [p["id"] for p in js["attack_paths"]] == [p["id"] for p in py["attack_paths"]]
    assert js["one_fix"] == py["one_fix"]


def test_browser_grades_for_shipped_scenarios(js_scans):
    """Transport can't be probed in a browser, so it is excluded, never counted against the domain."""
    assert js_scans["unprotected"]["score"]["grade"] == "F"
    assert js_scans["hardened"]["score"]["grade"] == "A"
    assert js_scans["hardened"]["score"]["score"] == 100
    assert js_scans["cloud_restricted"]["score"]["not_assessed"] == ["transport"]
    for scan in js_scans.values():
        transport = next(c for c in scan["checks"] if c["name"] == "transport")
        assert transport["status"] == "not_assessed"
        assert "transport" not in scan["score"]["components"]


def test_domain_normalisation_matches_backend():
    inputs = [
        "Example.COM", "https://www.Example.com/path?q=1", "user@example.org", "example.com.", "example.com:443",
        "Bücher.de", "xn--bcher-kva.de", "192.0.2.1", "[2001:db8::1]", "not a domain", "", "localhost", "a..b.com",
        "sub.example.co.uk",
    ]
    js = _run_js({"domains": inputs})["domains"]
    for raw, got in zip(inputs, js):
        try:
            expected = normalize_domain(raw)
        except InvalidDomainError:
            assert isinstance(got, dict) and "error" in got, (raw, got)
        else:
            assert got == expected, raw


def test_doh_answers_are_normalised_like_the_backend():
    rdata = [
        ["TXT", '"v=spf1 -all"'],
        ["TXT", '"v=DKIM1; k=rsa; p=MIIB" "IjANBgkq"'],
        ["TXT", '"say \\"hi\\" \\059 ok"'],
        ["TXT", "unquoted value"],
        ["MX", "10 MX1.Example.COM."],
        ["MX", "0 ."],
    ]
    assert _run_js({"rdata": rdata})["rdata"] == [
        "v=spf1 -all",
        "v=DKIM1; k=rsa; p=MIIBIjANBgkq",
        'say "hi" ; ok',
        "unquoted value",
        "10 mx1.example.com",
        "0 .",
    ]


def test_rsa_key_sizes_match_cryptography():
    keys = {512: RSA_512_SPKI_B64}
    for bits in (1024, 2048, 3072):
        der = rsa.generate_private_key(public_exponent=65537, key_size=bits).public_key().public_bytes(
            serialization.Encoding.DER, serialization.PublicFormat.SubjectPublicKeyInfo
        )
        keys[bits] = base64.b64encode(der).decode()
    assert _run_js({"rsa": list(keys.values())})["rsa"] == list(keys)


def test_html_is_self_contained():
    """No external scripts, stylesheets, fonts or images: the file must work on its own."""
    html = HTML.read_text()
    for needle in ('<script src=', '<link rel="stylesheet"', "@import", "fonts.googleapis", "<img src=\"http"):
        assert needle not in html, needle
    # The only network endpoints are the two DoH providers.
    assert "https://cloudflare-dns.com/dns-query" in html and "https://dns.google/resolve" in html
