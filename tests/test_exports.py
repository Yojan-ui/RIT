"""JSON and PDF export endpoints, and the PDF renderer itself."""

from __future__ import annotations

import json
import re
from datetime import datetime, timezone

from app.engine.scanner import build_result
from app.models.enums import CheckName, CheckStatus, Severity
from app.models.schemas import CheckResult, Finding
from app.reports.pdf import render_pdf


def _filename(response) -> str:
    match = re.fullmatch(r'attachment; filename="(.+)"', response.headers["content-disposition"])
    assert match, response.headers["content-disposition"]
    return match.group(1)


def test_json_export(client):
    r = client.get("/api/v1/scan/Example.COM/json")
    assert r.status_code == 200
    assert r.headers["content-type"] == "application/json"
    assert re.fullmatch(r"securemailscope-example\.com-\d{8}\.json", _filename(r))
    body = json.loads(r.content)
    assert body["domain"] == "example.com"
    assert len(body["attack_matrix"]) == 7
    assert {"score", "checks", "attack_paths", "one_fix"} <= body.keys()


def test_json_export_matches_scan_api(client):
    exported = client.get("/api/v1/scan/example.com/json").json()
    fetched = client.get("/api/v1/scan/example.com").json()
    exported.pop("cached"), fetched.pop("cached")
    assert exported == fetched


def test_json_export_with_selectors_bypasses_cache(client):
    client.get("/api/v1/scan/example.com/json")
    r = client.get("/api/v1/scan/example.com/json", params={"dkim_selectors": "mine"}).json()
    assert r["cached"] is False
    assert next(c for c in r["checks"] if c["name"] == "dkim")["status"] == "missing"


def test_pdf_export(client):
    r = client.get("/api/v1/scan/example.com/pdf")
    assert r.status_code == 200
    assert r.headers["content-type"] == "application/pdf"
    assert re.fullmatch(r"securemailscope-example\.com-\d{8}\.pdf", _filename(r))
    assert r.content.startswith(b"%PDF-")
    assert r.content.rstrip().endswith(b"%%EOF")


def test_exports_reject_invalid_domains(client):
    for fmt in ("json", "pdf"):
        r = client.get(f"/api/v1/scan/10.0.0.1/{fmt}")
        assert r.status_code == 422
        assert "IP addresses are not accepted" in r.json()["detail"]
        assert client.get(f"/api/v1/scan/example.com/{fmt}", params={"dkim_selectors": "bad selector!"}).status_code == 422


def _hostile_result():
    checks = [
        CheckResult(name=CheckName.DMARC, status=CheckStatus.MISSING, summary="No DMARC record"),
        CheckResult(
            name=CheckName.SPF,
            status=CheckStatus.FAIL,
            summary="v=spf1 +all <script>",
            records=['v=spf1 include:<evil>&"x" +all ' + "A" * 400],
            findings=[
                Finding(
                    title="Unclosed <b>markup & ampersands",
                    detail="<para><font color=red>not markup</font>",
                    severity=Severity.CRITICAL,
                    recommendation="Use -all & stop <this>.",
                )
            ],
        ),
        CheckResult(name=CheckName.TRANSPORT, status=CheckStatus.NOT_ASSESSED, summary="Not assessed from this network"),
    ]
    return build_result("hostile.test", checks, scanned_at=datetime(2026, 9, 27, 12, 0, tzinfo=timezone.utc))


def _render(result) -> bytes:
    return render_pdf(
        result, app_name="SecureMailScope", version="9.9.9",
        generated_at=datetime(2026, 9, 27, 12, 5, tzinfo=timezone.utc), compress=False,
    )


def _text(pdf: bytes) -> bytes:
    """Join adjacent text-show operations, which ReportLab splits around < and >."""
    return re.sub(rb"\) Tj \(", b"", pdf)


def test_pdf_contains_audit_sections_and_escapes_markup():
    pdf = _text(_render(_hostile_result()))
    for text in (
        b"Email Security Audit Report",
        b"hostile.test",
        b"Executive summary",
        b"1. Priority remediation",
        b"Publish a DMARC policy",
        b"2. Attack path assessment",
        b"3. Control results",
        b"4. Detailed findings",
        b"5. Scope and methodology",
        b"Generated 2026-09-27 12:05 UTC by SecureMailScope v9.9.9",
    ):
        assert text in pdf, text
    # Finding text is rendered literally, not interpreted as ReportLab markup.
    assert b"Unclosed <b>markup & ampersands" in pdf
    assert b"<para><font color=red>not markup</font>" in pdf
    assert b"Page 1 of " in pdf


def test_pdf_is_deterministic_for_the_same_input():
    result = _hostile_result()
    assert _render(result) == _render(result)


def test_pdf_notes_excluded_controls():
    pdf = _render(_hostile_result())
    assert b"excluded from the score" in pdf
    assert b"STARTTLS \\(transport\\)" in pdf  # PDF string syntax escapes parentheses
