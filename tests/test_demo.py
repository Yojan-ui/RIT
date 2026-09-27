"""Built-in demo domains: fixed grades, no network, labelled as demos."""

from __future__ import annotations

import re
import subprocess
from pathlib import Path

import pytest

from app.demo import demo_domains, scan_demo
from app.engine.scanner import build_result
from app.models.schemas import CheckResult

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
    pdf = client.get("/api/v1/scan/hardened.example/pdf").content
    assert pdf.startswith(b"%PDF-")




def test_pdf_marks_demo_reports():
    from app.reports.pdf import render_pdf

    def text(domain):
        pdf = render_pdf(build_result(domain, [CheckResult(name="dmarc", status="pass")]), app_name="S", version="1", compress=False)
        return re.sub(rb"\) Tj \(", b"", pdf)

    assert b"Demonstration report" in text("hardened.example")
    assert b"Demonstration report" not in text("example.com")






def test_demo_launcher_script():
    script = ROOT / "scripts/demo.sh"
    assert script.stat().st_mode & 0o111, "scripts/demo.sh must be executable"
    assert subprocess.run(["bash", "-n", str(script)], capture_output=True).returncode == 0
    text = script.read_text()
    assert "npm ci" in text and "npm run build" in text  # builds the React app that / serves
