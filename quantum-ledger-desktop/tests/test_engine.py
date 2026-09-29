import json

import pytest
from fastapi.testclient import TestClient

from app.ledger import MerkleTree
from app.main import create_app
from app.scoring import mosca, score_asset


@pytest.fixture
def client(tmp_path):
    return TestClient(create_app(tmp_path / "ql.db"))


def test_mosca_inequality():
    assert mosca(10, 3, 7).holds is True
    assert mosca(2, 1, 7).holds is False
    assert mosca(4, 3, 7).holds is False  # equality is not "greater than"


def test_scoring_flags_classical_signatures_and_clears_ml_dsa():
    estate = {"asset_type": "payment-gateway", "exposure": "internet", "shelf_life_years": 10}
    base = {"exposure": "internet", "key_exchange": "X25519"}
    rsa = score_asset({**base, "signature_alg": "RSA-2048"}, estate, 7)
    assert rsa.status == "forgeable" and rsa.severity.value == "CRITICAL"
    ecdsa = score_asset({**base, "signature_alg": "ECDSA-P256"}, {**estate, "asset_type": "identity-provider", "shelf_life_years": 5}, 7)
    assert ecdsa.status == "forgeable"
    safe = score_asset({**base, "signature_alg": "ML-DSA-65", "key_exchange": "X25519MLKEM768"}, estate, 7)
    assert safe.status == "safe" and safe.severity.value == "Low" and safe.risk_score < rsa.risk_score


def test_merkle_inclusion_proofs():
    leaves = [f"block-{i}".encode() for i in range(7)]
    tree = MerkleTree(leaves)
    for i, leaf in enumerate(leaves):
        assert MerkleTree.verify_proof(leaf, tree.proof(i), tree.root())
    assert not MerkleTree.verify_proof(b"forged", tree.proof(3), tree.root())


def test_scan_produces_cyclonedx_cbom(client):
    r = client.post("/scan").json()
    assert r["block"]["idx"] == 0
    cbom = client.get("/cbom").json()
    assert cbom["bomFormat"] == "CycloneDX" and cbom["specVersion"] == "1.6"
    algs = {c["name"]: c for c in cbom["components"] if c["cryptoProperties"]["assetType"] == "algorithm"}
    assert algs["ML-DSA-65"]["cryptoProperties"]["algorithmProperties"]["nistQuantumSecurityLevel"] == 3
    assert algs["RSA-2048"]["cryptoProperties"]["algorithmProperties"]["nistQuantumSecurityLevel"] == 0
    assert algs["X25519MLKEM768"]["cryptoProperties"]["oid"] == "2.16.840.1.101.3.4.4.2"


def test_full_pipeline_and_tamper_evidence(client):
    client.post("/scan")
    assessed = client.post("/assess", json={"z_years": 7}).json()
    status = {a["id"]: a["status"] for a in assessed["ranked"]}
    assert status["payments-gw"] == "forgeable" and status["sso"] == "forgeable" and status["pqc-pilot"] == "safe"
    assert status["bastion"] == "vulnerable"  # X_ML 0.5 + Y 5 < Z 7

    fix = client.post("/remediate/demo").json()
    assert fix["asset"] == "payments-gw" and fix["before"]["signature_alg"] == "RSA-2048"
    assert fix["after"] == {"signature_alg": "ML-DSA-65", "key_exchange": "X25519MLKEM768", "protocol": "TLS 1.3"}
    assert fix["status_after"] == "safe" and fix["risk_after"] < fix["risk_before"]

    # the migrated host now probes as ML-DSA-65
    rescanned = {a["id"]: a for a in client.post("/scan").json()["assets"]}
    assert rescanned[fix["asset"]]["signature_alg"] == "ML-DSA-65"

    sth = client.post("/attest/publish").json()["sth"]
    assert sth["signature_algorithm"] == "ML-DSA-65 (FIPS 204)" and sth["signature_simulated"] is True

    ok = client.get("/ledger/verify").json()
    assert ok["valid"] and ok["blocks_checked"] == 5  # scan, assess, remediate, scan, attest

    tampered = client.post("/ledger/tamper").json()["tampered"]
    # the insider falsifies the risk assessment (block 1): the top forgeable RSA-2048 asset → "safe"
    assert tampered["idx"] == 1 and tampered["kind"] == "assessment"
    assert tampered["change"]["before"] == "RSA-2048 / forgeable" and tampered["change"]["after"] == "ML-DSA-65 / safe"

    bad = client.get("/ledger/verify").json()
    assert bad["valid"] is False
    assert bad["first_invalid_block"] == 1 and bad["altered_blocks"] == [1]
    assert bad["roots_invalidated"] == 4  # every Merkle root from the altered block onward
    assert bad["latest_attestation_matches"] is False
    assert client.post("/attest/publish").status_code == 409  # won't sign a broken log

    restored = client.post("/restore").json()
    assert restored["repaired_blocks"] == [1]
    assert restored["verification"]["valid"] is True


def test_inclusion_proof_endpoint(client):
    client.post("/scan")
    client.post("/assess")
    p = client.get("/ledger/proof/0").json()
    assert p["verified"] and p["tree_size"] == 2


def test_preconditions(client):
    assert client.post("/assess").status_code == 409
    assert client.post("/remediate/demo").status_code == 409
    assert client.post("/ledger/tamper").status_code == 409
    assert client.get("/").status_code == 200
