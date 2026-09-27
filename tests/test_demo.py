"""Built-in demo domains: fixed grades, no network, labelled as demos, same in both editions."""

from __future__ import annotations

import json
import re
import subprocess
from pathlib import Path

import pytest

from app.demo import demo_domains, scan_demo
from app.models.schemas import CheckResult
from app.engine.scanner import build_result
from tests.test_offline_build import NODE, _check_view, _path_view, _run_js

ROOT = Path(__file__).resolve().parent.parent
DEMOS = demo_domains()


def test_every_grade_is_covered_by_a_reserved_example_domain():
    assert sorted(spec["grade"] for spec in DEMOS.values()) == ["A", "B", "C", "D", "F"]
    assert all(domain.endswith(".example") for domain in DEMOS)  # RFC 2606: can never be a real domain


@pytest.mark.parametrize("domain", sorted(DEMOS))
async def test_demo_scans_offline_to_its_intended_grade(domain, settings):
    """The autouse offline guard fails this test if a demo scan touches the network."""
    result = await scan_demo(domain, settings)
    assert result.score.grade.value == DEMOS[domain]["grade"]
    assert len(result.attack_matrix) == 7
    assert (result.one_fix is None) == (DEMOS[domain]["grade"] == "A")


async def test_hardened_demo_is_a_clean_hundred(settings):
    result = await scan_demo("hardened.example", settings)
    assert result.score.score == 100 and result.score.not_assessed == []
    assert {c.status.value for c in result.checks} == {"pass"}


def test_demo_scan_through_the_api(client):
    body = client.get("/api/v1/scan/monitor-only.example").json()
    assert body["score"]["grade"] == "C" and body["one_fix"]["title"] == "Enforce your DMARC policy"
    html = client.post("/api/v1/ui/scan", data={"domain": "unprotected.example"}).text
    assert "Built-in demo domain" in html
    pdf = client.get("/api/v1/scan/hardened.example/pdf").content
    assert pdf.startswith(b"%PDF-")


def test_real_domains_are_not_labelled_as_demos(client):
    assert "Built-in demo domain" not in client.post("/api/v1/ui/scan", data={"domain": "example.com"}).text


def test_pdf_marks_demo_reports():
    from app.reports.pdf import render_pdf

    def text(domain):
        pdf = render_pdf(build_result(domain, [CheckResult(name="dmarc", status="pass")]), app_name="S", version="1", compress=False)
        return re.sub(rb"\) Tj \(", b"", pdf)

    assert b"Demonstration report" in text("hardened.example")
    assert b"Demonstration report" not in text("example.com")


def test_dashboard_offers_demo_chips_and_deep_links(client):
    page = client.get("/").text
    for spec in DEMOS.values():
        assert spec["title"] in page
    linked = client.get("/", params={"domain": "rollout.example"}).text
    assert 'value="rollout.example"' in linked and 'hx-trigger="load"' in linked
    hostile = client.get("/", params={"domain": '"><script>alert(1)</script>'}).text
    assert "<script>alert(1)</script>" not in hostile


def test_dashboard_loads_nothing_from_the_internet(client):
    """Fonts and htmx are self-hosted so the demo works with no Wi-Fi (Tailwind is prebuilt by scripts/demo.sh)."""
    page = client.get("/").text
    external = [u for u in re.findall(r'(?:src|href)="(https?://[^"]+)"', page) if "/static/" not in u]
    assert all("tailwindcss/browser" in u for u in external), external
    assert (ROOT / "app/static/js/vendor/htmx.min.js").stat().st_size > 10_000
    for font in ("archivo-latin-standard-normal.woff2", "jetbrains-mono-latin-wght-normal.woff2"):
        assert (ROOT / "app/static/fonts" / font).read_bytes()[:4] == b"wOF2"


def test_browser_edition_embeds_the_current_demo_zones():
    html = (ROOT / "offline_scanner.html").read_text()
    embedded = re.search(r'<script id="demo-zones" type="application/json">(.*?)</script>', html, re.S).group(1)
    assert json.loads(embedded) == json.loads((ROOT / "app/demo/zones.json").read_text()), (
        "run: python scripts/sync_browser_edition.py"
    )


@pytest.mark.skipif(NODE is None, reason="Node.js is required to run the browser engine")
async def test_browser_demo_matches_server_demo(settings):
    js = _run_js({"demos": sorted(DEMOS)})["demos"]
    for domain in sorted(DEMOS):
        server = await scan_demo(domain, settings)
        # A browser never probes SMTP: compare against the server result with the browser's transport verdict.
        js_transport = next(c for c in js[domain]["checks"] if c["name"] == "transport")
        checks = [CheckResult.model_validate(js_transport) if c.name.value == "transport" else c for c in server.checks]
        py = json.loads(build_result(domain, checks).model_dump_json())
        assert [_check_view(c) for c in js[domain]["checks"]] == [_check_view(c) for c in py["checks"]], domain
        assert js[domain]["score"] == py["score"], domain
        assert [_path_view(p) for p in js[domain]["attack_matrix"]] == [_path_view(p) for p in py["attack_matrix"]]


def test_demo_launcher_script():
    script = ROOT / "scripts/demo.sh"
    assert script.stat().st_mode & 0o111, "scripts/demo.sh must be executable"
    assert subprocess.run(["bash", "-n", str(script)], capture_output=True).returncode == 0
    assert "sed -n 's/^ARG TAILWIND_VERSION=//p' Dockerfile" in script.read_text()  # one source for the version
