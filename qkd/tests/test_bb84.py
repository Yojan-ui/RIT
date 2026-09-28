from fastapi.testclient import TestClient

from app.bb84 import BB84Config, run_bb84
from app.main import app

client = TestClient(app)


def test_clean_channel_has_zero_errors_and_matching_keys():
    r = run_bb84(BB84Config(n_qubits=512, seed=7))
    assert r["metrics"]["true_qber"] == 0
    assert r["key"]["keys_match"]
    assert r["key"]["status"] == "established"
    assert r["key"]["final_key"] == r["key"]["alice_key"]


def test_matching_basis_always_reproduces_alice_bit_without_eve():
    r = run_bb84(BB84Config(n_qubits=256, seed=3))
    for q in r["qubits"]:
        if q["bases_match"]:
            assert q["bob_bit"] == q["alice_bit"]


def test_full_intercept_gives_about_25_percent_qber_and_aborts():
    r = run_bb84(BB84Config(n_qubits=2048, intercept_rate=1.0, seed=11))
    assert 0.20 < r["metrics"]["true_qber"] < 0.30
    assert r["metrics"]["eavesdropper_detected"]
    assert r["key"]["final_key"] is None


def test_eve_in_correct_basis_never_causes_an_error():
    r = run_bb84(BB84Config(n_qubits=1024, intercept_rate=1.0, seed=5))
    for q in r["qubits"]:
        if q["bases_match"] and not q["state_disturbed"]:
            assert q["bob_bit"] == q["alice_bit"]
            assert q["eve_bit"] == q["alice_bit"]


def test_channel_noise_raises_qber():
    r = run_bb84(BB84Config(n_qubits=2048, channel_noise=0.15, seed=9))
    assert 0.05 < r["metrics"]["true_qber"] < 0.16


def test_same_seed_same_transmission_with_and_without_eve():
    a = run_bb84(BB84Config(n_qubits=64, seed=42))
    b = run_bb84(BB84Config(n_qubits=64, seed=42, intercept_rate=1.0))
    assert a["alice"] == b["alice"]
    assert a["bob"]["bases"] == b["bob"]["bases"]


def test_sample_and_key_partition_the_sifted_bits():
    r = run_bb84(BB84Config(n_qubits=128, seed=1))
    s = r["sifting"]
    assert sorted(s["sample_indices"] + s["key_indices"]) == s["sifted_indices"]
    assert r["key"]["length"] == len(s["key_indices"])


def test_endpoints():
    assert client.get("/api/health").json()["status"] == "ok"

    clean = client.post("/api/simulate-clean", json={"n_qubits": 8, "seed": 1, "include_circuit": True})
    assert clean.status_code == 200
    body = clean.json()
    assert body["scenario"] == "clean"
    assert "OPENQASM 2.0" in body["circuit"]["qasm"]
    assert len(body["qubits"]) == 8

    attack = client.post("/api/simulate-attack", json={"n_qubits": 1024, "seed": 2})
    assert attack.json()["metrics"]["eavesdropper_detected"]

    assert client.post("/api/simulate-clean").status_code == 200  # empty body → defaults
    assert client.post("/api/simulate-clean", json={"n_qubits": 999999}).status_code == 422

    cmp = client.post("/api/compare", json={"n_qubits": 256}).json()
    assert cmp["clean"]["alice"] == cmp["attack"]["alice"]

    sweep = client.get("/api/qber-sweep", params={"n_qubits": 1024, "steps": 5, "seed": 3}).json()
    assert [p["intercept_rate"] for p in sweep["points"]] == [0, 0.25, 0.5, 0.75, 1.0]
    assert sweep["points"][0]["qber"] == 0
