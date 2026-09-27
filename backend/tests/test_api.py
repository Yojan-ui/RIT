import pytest
from fastapi.testclient import TestClient

from app import demo, main
from app.collectors.dns_collect import DomainNotFound

client = TestClient(main.app)


def test_health():
    assert client.get("/api/health").json()["status"] == "ok"


def test_demo_list_and_every_scenario_renders():
    scenarios = client.get("/api/demo").json()
    assert {s["id"] for s in scenarios} == set(demo.SCENARIOS)
    for s in scenarios:
        body = client.get(f"/api/demo/{s['id']}").json()
        assert body["mode"] == "demo"
        assert 0 <= body["score"] <= 100
        assert len(body["checks"]) == 7


def test_unknown_demo_is_404():
    assert client.get("/api/demo/nope").status_code == 404


def test_demo_error_endpoint():
    assert client.get("/api/demo-error/504").status_code == 504


def test_scan_rejects_bad_domain():
    response = client.get("/api/scan", params={"domain": "not a domain"})
    assert response.status_code == 422


def test_scan_maps_nxdomain_to_404(monkeypatch):
    async def fake_run_scan(domain, selectors, settings):
        raise DomainNotFound(domain)

    monkeypatch.setattr(main, "run_scan", fake_run_scan)
    assert client.get("/api/scan", params={"domain": "nope.example"}).status_code == 404


def test_scan_normalises_input(monkeypatch):
    seen = {}

    async def fake_run_scan(domain, selectors, settings):
        seen.update(domain=domain, selectors=selectors)
        from app.scanner import build_report
        return build_report(demo.observations_for("startup"), mode="live", duration_ms=1)

    monkeypatch.setattr(main, "run_scan", fake_run_scan)
    response = client.get("/api/scan", params={"domain": "https://Example.com/x", "dkim_selectors": "s1,s2"})
    assert response.status_code == 200
    assert seen == {"domain": "example.com", "selectors": ["s1", "s2"]}


@pytest.fixture
def built_frontend(tmp_path, monkeypatch):
    (tmp_path / "assets").mkdir()
    (tmp_path / "index.html").write_text("<title>SecureMailScope</title>")
    (tmp_path / "assets" / "app-abc123.js").write_text("console.log(1)")
    (tmp_path / "favicon.svg").write_text("<svg/>")
    monkeypatch.setattr(main.frontend, "root", tmp_path)
    return tmp_path


def test_root_serves_built_index(built_frontend):
    response = client.get("/")
    assert response.status_code == 200 and "SecureMailScope" in response.text
    assert response.headers["cache-control"] == "no-cache"


def test_hashed_assets_are_cached_immutably(built_frontend):
    response = client.get("/assets/app-abc123.js")
    assert response.status_code == 200
    assert "immutable" in response.headers["cache-control"]
    assert client.get("/favicon.svg").headers["cache-control"] == "no-cache"


def test_client_routes_fall_back_to_index_but_missing_files_404(built_frontend):
    assert "SecureMailScope" in client.get("/some/client/route").text
    assert client.get("/assets/stale-999.js").status_code == 404


def test_path_traversal_is_blocked(built_frontend):
    (built_frontend.parent / "secret.txt").write_text("nope")
    response = client.get("/..%2fsecret.txt")
    assert "nope" not in response.text


def test_unknown_api_route_is_json_404(built_frontend):
    response = client.get("/api/nope")
    assert response.status_code == 404 and response.json()["detail"].startswith("Unknown API route")


def test_unbuilt_frontend_explains_how_to_build(tmp_path, monkeypatch):
    monkeypatch.setattr(main.frontend, "root", tmp_path / "missing")
    response = client.get("/")
    assert response.status_code == 503 and "python -m app.frontend build" in response.text


def test_frontend_files_rejects_dotdot_directly(built_frontend):
    from fastapi import HTTPException

    (built_frontend.parent / "secret.txt").write_text("nope")
    with pytest.raises(HTTPException) as exc:
        main.frontend.response("../secret.txt")
    assert exc.value.status_code == 404
