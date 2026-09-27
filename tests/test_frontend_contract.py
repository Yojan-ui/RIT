"""The React app's API contract: generated types stay in step with the backend."""

from __future__ import annotations

import hashlib
import re
from pathlib import Path

from fastapi.testclient import TestClient

from scripts.generate_api_types import SCHEMA_JSON, SCHEMA_TS, openapi_json

FIX = "run: cd frontend && npm run gen:api"


def test_committed_openapi_schema_is_current():
    assert SCHEMA_JSON.read_text() == openapi_json(), FIX


def test_typescript_types_were_generated_from_the_current_schema():
    stamp = re.search(r"openapi\.json sha256: ([0-9a-f]{64})", SCHEMA_TS.read_text())
    assert stamp, FIX
    assert stamp.group(1) == hashlib.sha256(SCHEMA_JSON.read_bytes()).hexdigest(), FIX


def test_response_fields_are_required_in_the_contract():
    """Responses always carry every field, so the generated types must not mark them optional."""
    ts = SCHEMA_TS.read_text()
    for field in ("attack_matrix", "one_fix", "checks", "score", "exposure", "control_exposure"):
        assert re.search(rf"\b{field}: ", ts), field
        assert not re.search(rf"\b{field}\?: ", ts), field


def test_demo_domains_endpoint(client):
    body = client.get("/api/v1/demo-domains").json()
    assert [d["grade"] for d in body] == ["A", "B", "C", "D", "F"]
    assert all(d["domain"].endswith(".example") and d["title"] and d["story"] for d in body)


def test_cors_is_off_by_default(client):
    r = client.get("/api/v1/health", headers={"Origin": "https://evil.example"})
    assert "access-control-allow-origin" not in r.headers


def test_cors_allows_only_configured_origins(tmp_path, monkeypatch):
    monkeypatch.setenv("SMS_CACHE_PATH", str(tmp_path / "c.sqlite3"))
    monkeypatch.setenv("SMS_CORS_ORIGINS", "https://app.securemailscope.example")
    from app.core.config import get_settings

    get_settings.cache_clear()
    import importlib

    import app.main as main_module

    try:
        importlib.reload(main_module)
        with TestClient(main_module.app) as c:
            ok = c.options("/api/v1/scan", headers={
                "Origin": "https://app.securemailscope.example", "Access-Control-Request-Method": "POST",
            })
            assert ok.headers["access-control-allow-origin"] == "https://app.securemailscope.example"
            other = c.get("/api/v1/health", headers={"Origin": "https://evil.example"})
            assert "access-control-allow-origin" not in other.headers
    finally:
        get_settings.cache_clear()
        monkeypatch.delenv("SMS_CORS_ORIGINS")
        importlib.reload(main_module)
