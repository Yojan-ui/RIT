import sqlite3

import pytest
from fastapi.testclient import TestClient

from app import cwm
from app.cwm import CWMConfig, Severity, cwm_score, predict_migration_time, severity_for
from app.main import create_app


def test_predictor_examples_and_zone_effect():
    assert predict_migration_time("payment-gateway", "internet").years == 4.5
    assert predict_migration_time("bastion", "internal").years == 0.5
    # same asset type, internal zone is slower (hidden legacy dependencies)
    assert predict_migration_time("payment-gateway", "internal").years > 4.5
    unknown = predict_migration_time("mainframe", "dmz")
    assert unknown.years == 2.5 and "XGBoost" in unknown.model


def test_formula_matches_spec():
    # ((0.5 + 5) / 7) * 0.8 * 1.0 * 100 = 62.857…
    s = cwm_score(asset_type="bastion", network_zone="internal", signature_alg="ECDSA-P256", shelf_life_years=5, z_years=7)
    assert s.x_ml == 0.5 and s.exposure_weight == 0.8 and s.crypto_fragility == 1.0
    assert s.score == 62.9 and s.severity == Severity.HIGH and not s.capped


def test_score_is_capped_at_100():
    s = cwm_score(asset_type="payment-gateway", network_zone="internet", signature_alg="RSA-2048", shelf_life_years=10, z_years=7)
    assert s.raw_score == 248.6 and s.score == 100 and s.capped and s.severity == Severity.CRITICAL


def test_ml_dsa_fragility_drops_score():
    classical = cwm_score(asset_type="api-service", network_zone="internet", signature_alg="RSA-2048", shelf_life_years=10, z_years=7)
    pqc = cwm_score(asset_type="api-service", network_zone="internet", signature_alg="ML-DSA-65", shelf_life_years=10, z_years=7)
    assert pqc.crypto_fragility == 0.1
    assert pqc.score == 19.7 and pqc.severity == Severity.LOW
    assert pqc.score < classical.score


@pytest.mark.parametrize("score,label", [(0, "Low"), (39.9, "Low"), (40, "High"), (69.9, "High"), (70, "CRITICAL"), (100, "CRITICAL")])
def test_severity_bands(score, label):
    assert severity_for(score).value == label


def test_config_is_tunable_and_unknowns_are_conservative():
    cfg = CWMConfig(exposure_weights={"internet": 2.0, "internal": 0.5})
    s = cwm_score(asset_type="bastion", network_zone="internal", signature_alg="ECDSA-P256", shelf_life_years=5, z_years=7, config=cfg)
    assert s.exposure_weight == 0.5 and s.score == 39.3 and s.severity == Severity.LOW
    unknown_alg = cwm_score(asset_type="bastion", network_zone="internal", signature_alg="Falcon-512", shelf_life_years=5, z_years=7)
    assert unknown_alg.crypto_fragility == cwm.DEFAULT_CONFIG.default_fragility == 1.0


def test_invalid_z_rejected():
    with pytest.raises(ValueError):
        cwm_score(asset_type="bastion", network_zone="internal", signature_alg="RSA-2048", shelf_life_years=5, z_years=0)


def test_assess_endpoint_returns_cwm(tmp_path):
    client = TestClient(create_app(tmp_path / "ql.db"))
    client.post("/scan")
    r = client.post("/assess", json={"z_years": 7}).json()
    by_id = {a["id"]: a for a in r["ranked"]}
    assert r["severity_summary"] == {"CRITICAL": 3, "High": 1, "Low": 1}
    assert r["config"]["exposure_weights"] == {"internet": 1.2, "internal": 0.8}
    assert by_id["payments-gw"]["cwm"]["x_ml"] == 4.5 and by_id["payments-gw"]["severity"] == "CRITICAL"
    assert by_id["bastion"]["risk_score"] == 62.9 and by_id["bastion"]["severity"] == "High"
    assert by_id["pqc-pilot"]["risk_score"] == 19.7 and by_id["pqc-pilot"]["severity"] == "Low"
    # ties at 100 broken by raw score: the payment gateway ranks first
    assert r["ranked"][0]["id"] == "payments-gw"
    # stored for the dashboard
    assets = {a["id"]: a for a in client.get("/assets").json()["assets"]}
    assert assets["bastion"]["severity"] == "High" and assets["bastion"]["cwm"]["mosca_ratio"] == 0.786


def test_remediation_drops_severity(tmp_path):
    client = TestClient(create_app(tmp_path / "ql.db"))
    client.post("/scan")
    client.post("/assess")
    fix = client.post("/remediate/demo").json()
    assert fix["asset"] == "payments-gw"
    assert (fix["risk_before"], fix["severity_before"]) == (100.0, "CRITICAL")
    assert (fix["risk_after"], fix["severity_after"]) == (24.9, "Low")


def test_old_database_is_migrated(tmp_path):
    path = tmp_path / "old.db"
    con = sqlite3.connect(path)
    con.executescript("""
        CREATE TABLE estate (id TEXT PRIMARY KEY, host TEXT NOT NULL, port INTEGER NOT NULL, protocol TEXT NOT NULL,
            service TEXT NOT NULL, signature_alg TEXT NOT NULL, key_exchange TEXT NOT NULL, exposure TEXT NOT NULL,
            shelf_life_years REAL NOT NULL, migration_years REAL NOT NULL);
        INSERT INTO estate VALUES ('bastion','bastion.corp.local',22,'SSH-2.0','Admin bastion','ECDSA-P256','curve25519-sha256','internal',5,3);
        CREATE TABLE assets (id TEXT PRIMARY KEY, host TEXT NOT NULL, port INTEGER NOT NULL, protocol TEXT NOT NULL,
            service TEXT NOT NULL, signature_alg TEXT NOT NULL, key_exchange TEXT NOT NULL, exposure TEXT NOT NULL,
            handshake TEXT NOT NULL, status TEXT, risk_score REAL, mosca TEXT, scanned_at TEXT NOT NULL);
    """)
    con.commit()
    con.close()
    client = TestClient(create_app(path))
    client.post("/scan")
    r = client.post("/assess").json()
    assert r["ranked"][0]["asset_type"] == "bastion" and r["ranked"][0]["risk_score"] == 62.9
