# QuantumLedger — prototype

**SIH 2026 · Team High Cortisol**

An offline, browser-based app that finds digital signatures a quantum computer could forge, migrates them to
post-quantum standards, and proves the fix with a tamper-evident Merkle log.

| Stage | What it does | Endpoint |
|---|---|---|
| 1 · Detect | Mock TLS/SSH prober builds a **CycloneDX 1.6 CBOM** | `POST /scan` |
| 2 · Score | **Context-Weighted Mosca**: a 0–100 risk score with Low / High / CRITICAL severity, plus the Mosca verdict (*forgeable* / *vulnerable* / *safe*) | `POST /assess` |
| 3 · Defend | `shield` upgrades the riskiest RSA-2048 TLS asset to **ML-DSA-65** (FIPS 204) + **X25519MLKEM768** (FIPS 203) | `POST /remediate/demo` |
| 4 · Prove | Every step is a block in a SHA-256 hash chain + Merkle tree; signed tree heads are published | `POST /attest/publish`, `GET /ledger/verify` |
| Tamper demo | An "insider" edits a historical record in SQLite; verification then fails | `POST /ledger/tamper` |
| Recovery | Repairs the live ledger from the append-only replica | `POST /restore` |

Helpers: `GET /cbom`, `GET /assets`, `GET /ledger`, `GET /ledger/proof/{idx}` (Merkle inclusion proof),
`POST /reset`, `GET /health`. Interactive API docs at `/docs`.

## Run

```bash
python3 -m venv .venv && .venv/bin/pip install -r requirements-dev.txt

.venv/bin/python main.py                  # prints "Server running at http://localhost:8000"
.venv/bin/python main.py --port 8080      # if 8000 is taken
.venv/bin/python -m pytest -q             # engine tests
```

`main.py` starts uvicorn bound to **127.0.0.1 only** and serves the API and dashboard together; open the
printed URL in any browser. Stop it with Ctrl+C. Data lives in `data/quantumledger.db` (override with `QL_DB`).

## Demo script (≈2 minutes)

1. **Scan Estate**: five endpoints, 16 CBOM components; block #0.
2. **Score & Rank** (Z = 7): payments gateway, code signing and SSO score 100 (CRITICAL), the SSH bastion 62.9 (High), the PQC pilot 19.7 (Low).
3. **Migrate to ML-DSA**: `payments-gw` goes RSA-2048 → ML-DSA-65 with X25519MLKEM768; risk 99 → 0. Re-scanning shows the change.
4. **Publish Attestation**, then **Verify Ledger**: green, and it matches the signed tree head.
5. **Tamper Ledger (Demo)**: the insider relabels the forgeable RSA-2048 gateway as "ML-DSA-65 / safe" in the
   historical assessment (block #1). Verification fails at block #1: its payload hash no longer matches, every later
   Merkle root is invalid, and the signed tree head no longer matches. Attestation is refused.
6. **Restore**: block #1 comes back from the replica and the ledger verifies again.

## Layout

```
main.py              launcher: serves API + dashboard on http://localhost:8000
app/main.py          FastAPI app + endpoints, serves the dashboard
app/prober.py        DETECT: mock OpenSSL 3.5 / ssh-keyscan probes → CycloneDX 1.6 CBOM
app/scoring.py       SCORE: Mosca verdict + CWM ranking, typed Pydantic results
app/cwm.py           Context-Weighted Mosca formula, multipliers, migration-time model (X_ML)
app/shield.py        DEFEND: Python stand-in for shield.js (ML-DSA-65 + X25519MLKEM768 runbook)
app/ledger.py        PROVE: MerkleTree (RFC 6962-style) + hash-chained ledger, verify / tamper / restore
app/db.py            SQLite schema and access
app/static/          dashboard (plain HTML/CSS/JS, system fonts, no CDNs)
app/static/bg.js     3D particle-network backdrop in raw WebGL (local, ~30 fps, pauses when hidden)
tests/               pytest suite
```

## What is simulated

This is a prototype. These parts are placeholders, and the UI and API mark them `simulated`:

- **Handshakes**: the "network" is the `estate` table. Probes return records shaped like `openssl s_client`
  (OpenSSL 3.5) and `ssh-keyscan` output; no sockets are opened.
- **Migration**: `shield` records the OpenSSL 3.5 commands (`openssl genpkey -algorithm ML-DSA-65`, TLS
  `Groups = X25519MLKEM768:X25519`) as the runbook and evidence; it does not execute them.
- **Attestation signature**: the signed tree head is labelled ML-DSA-65 (FIPS 204) but signed with
  HMAC-SHA3-512 using a local device key, because the Python standard library has no ML-DSA. Swap in
  OpenSSL 3.5 or liboqs for a real signature.
- **Migration time (X_ML)**: `cwm.predict_migration_time` is a deterministic stand-in with the interface of a trained
  model (designed for XGBoost / scikit-learn on network-topology data such as Rapid7 Sonar). No model is trained or shipped.
- **Z = 7 years** (CRQC around 2033) is an adjustable assumption, not a prediction.

The hash chain, Merkle tree, inclusion proofs, CBOM structure and scoring arithmetic are real.

## Scoring: Context-Weighted Mosca (CWM)

```
Risk = ((X_ML + Y) / Z) × Exposure_Weight × Crypto_Fragility × 100      capped at 100
```

| Term | Source |
|---|---|
| X_ML | predicted years to migrate, from `predict_migration_time(asset_type, network_zone)` |
| Y | shelf life: how long the asset's signatures/data must stay trustworthy (estate) |
| Z | years to a CRQC (request, default 7) |
| Exposure | internet 1.2 · internal 0.8 |
| Fragility | RSA-2048 1.0 · ECDSA-P256 1.0 · ML-DSA-65 0.1 (unlisted algorithms default to 1.0) |

Severity: 0–39 Low · 40–69 High · 70–100 CRITICAL. Scores that hit the cap are ranked by their uncapped
value, so the most over-exposed asset comes first. Multipliers and thresholds live in `CWMConfig` and are
returned with every `/assess` response.

| Asset | Type · zone | X_ML | Y | Score |
|---|---|---|---|---|
| payments-gw | payment-gateway · internet | 4.5 | 10 | 100 (raw 248.6) CRITICAL |
| codesign | code-signing · internal | 6.25 | 15 | 100 (raw 242.9) CRITICAL |
| sso | identity-provider · internet | 3.0 | 5 | 100 (raw 137.1) CRITICAL |
| bastion | bastion · internal | 0.5 | 5 | 62.9 High |
| pqc-pilot | api-service · internet | 1.5 | 10 | 19.7 Low |

After the demo migration the payment gateway drops to 24.9 (Low): ML-DSA-65's fragility of 0.1 does the work.

## Terminology

- **FIPS 203 — ML-KEM** (Module-Lattice-Based Key-Encapsulation Mechanism). ML-KEM-768 is NIST category 3;
  `X25519MLKEM768` is the hybrid TLS 1.3 group (codepoint 0x11EC) supported by OpenSSL 3.5.
- **FIPS 204 — ML-DSA** (Module-Lattice-Based Digital Signature Algorithm). ML-DSA-65 is NIST category 3,
  OID 2.16.840.1.101.3.4.3.18.
- **Forgeable**: a Shor-breakable signature (RSA, ECDSA) whose required lifetime plus migration time exceeds
  the time to a cryptographically relevant quantum computer (X + Y > Z).
