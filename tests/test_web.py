"""Serving the built React app at / (app/web.py)."""

from __future__ import annotations

import importlib

import pytest
from fastapi.testclient import TestClient

INDEX = "<!doctype html><div id=root></div><script type=module src=/assets/index-abc123.js></script>"


def _client(tmp_path, monkeypatch, dist):
    monkeypatch.setenv("SMS_CACHE_PATH", str(tmp_path / "c.sqlite3"))
    monkeypatch.setenv("SMS_FRONTEND_DIST", str(dist))
    monkeypatch.setenv("SMS_SMTP_PROBE_ENABLED", "false")
    from app.core.config import get_settings

    get_settings.cache_clear()
    import app.main as main_module

    importlib.reload(main_module)
    return TestClient(main_module.app)


@pytest.fixture
def web(tmp_path, monkeypatch):
    dist = tmp_path / "dist"
    (dist / "assets").mkdir(parents=True)
    (dist / "index.html").write_text(INDEX)
    (dist / "assets" / "index-abc123.js").write_text("console.log('app')")
    (dist / "favicon.svg").write_text("<svg/>")
    (tmp_path / "secret.txt").write_text("outside dist")
    with _client(tmp_path, monkeypatch, dist) as c:
        yield c
    from app.core.config import get_settings

    get_settings.cache_clear()


def test_root_serves_the_app_shell_uncached(web):
    r = web.get("/")
    assert r.status_code == 200 and r.text == INDEX
    assert r.headers["cache-control"] == "no-cache"


def test_client_side_urls_fall_back_to_the_app(web):
    assert web.get("/?domain=monitor-only.example").text == INDEX
    assert web.get("/some/client/route").text == INDEX


def test_hashed_assets_are_cached_forever(web):
    r = web.get("/assets/index-abc123.js")
    assert r.text == "console.log('app')"
    assert "immutable" in r.headers["cache-control"]
    assert web.get("/favicon.svg").headers["cache-control"] == "no-cache"


def test_api_paths_never_fall_through_to_the_app(web):
    r = web.get("/api/v1/does-not-exist")
    assert r.status_code == 404 and r.json() == {"detail": "Not Found"}
    assert web.get("/api/v1/health").json()["status"] == "ok"
    assert web.get("/openapi.json").json()["info"]["title"] == "SecureMailScope"


def test_files_outside_dist_are_not_served(web):
    for path in ("/../secret.txt", "/%2e%2e/secret.txt", "/assets/../../secret.txt"):
        assert "outside dist" not in web.get(path).text


def test_missing_build_explains_itself(tmp_path, monkeypatch):
    with _client(tmp_path, monkeypatch, tmp_path / "no-build") as c:
        r = c.get("/")
        assert r.status_code == 503 and "npm run build" in r.text
        assert c.get("/api/v1/health").status_code == 200
    from app.core.config import get_settings

    get_settings.cache_clear()
