# QuantumLedger — desktop prototype

**SIH 2026 · Team High Cortisol**

An offline desktop app that finds digital signatures a quantum computer could forge, migrates them to
post-quantum standards, and proves the fix with a tamper-evident Merkle log.

| Stage | What it does | Endpoint |
|---|---|---|
| 1 · Detect | Mock TLS/SSH prober builds a **CycloneDX 1.6 CBOM** | `POST /scan` |
| 2 · Score | **Mosca's inequality** X + Y > Z; RSA/ECDSA → *forgeable*, ML-DSA-65 → *safe*; risk-ranked | `POST /assess` |
| 3 · Defend | `shield` upgrades the riskiest RSA-2048 TLS asset to **ML-DSA-65** (FIPS 204) + **X25519MLKEM768** (FIPS 203) | `POST /remediate/demo` |
| 4 · Prove | Every step is a block in a SHA-256 hash chain + Merkle tree; signed tree heads are published | `POST /attest/publish`, `GET /ledger/verify` |
| Tamper demo | An "insider" edits a historical record in SQLite; verification then fails | `POST /ledger/tamper` |
| Recovery | Repairs the live ledger from the append-only replica | `POST /restore` |

Helpers: `GET /cbom`, `GET /assets`, `GET /ledger`, `GET /ledger/proof/{idx}` (Merkle inclusion proof),
`POST /reset`, `GET /health`. Interactive API docs at `/docs`.

## Run

```bash
python3 -m venv .venv && .venv/bin/pip install -r requirements-dev.txt

.venv/bin/python main.py                  # desktop window (pywebview)
.venv/bin/python main.py --server-only    # same app in a browser: http://127.0.0.1:8742
.venv/bin/python -m pytest -q             # engine tests
```

`main.py` starts uvicorn in a daemon thread bound to **127.0.0.1 only**, waits for `/health`, then opens a
native window. Closing the window exits the app. Data lives in `data/quantumledger.db` (override with `QL_DB`).

## Demo script (≈2 minutes)

1. **Scan Estate**: five endpoints, 16 CBOM components; block #0.
2. **Score & Rank** (Z = 7): four assets *forgeable* (payments gateway, code signing, SSO, SSH bastion), the PQC pilot *safe*.
3. **Migrate to ML-DSA**: `payments-gw` goes RSA-2048 → ML-DSA-65 with X25519MLKEM768; risk 99 → 0. Re-scanning shows the change.
4. **Publish Attestation**, then **Verify Ledger**: green, and it matches the signed tree head.
5. **Tamper Ledger (Demo)**: the insider relabels the forgeable RSA-2048 gateway as "ML-DSA-65 / safe" in the
   historical assessment (block #1). Verification fails at block #1: its payload hash no longer matches, every later
   Merkle root is invalid, and the signed tree head no longer matches. Attestation is refused.
6. **Restore**: block #1 comes back from the replica and the ledger verifies again.

## Layout

```
main.py              pywebview launcher (server in a background daemon thread)
app/main.py          FastAPI app + endpoints, serves the dashboard
app/prober.py        DETECT: mock OpenSSL 3.5 / ssh-keyscan probes → CycloneDX 1.6 CBOM
app/scoring.py       SCORE: Mosca's inequality + risk ranking
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
- **Z = 7 years** (CRQC around 2033) is an adjustable assumption, not a prediction.

The hash chain, Merkle tree, inclusion proofs, CBOM structure and Mosca scoring are real.

## Terminology

- **FIPS 203 — ML-KEM** (Module-Lattice-Based Key-Encapsulation Mechanism). ML-KEM-768 is NIST category 3;
  `X25519MLKEM768` is the hybrid TLS 1.3 group (codepoint 0x11EC) supported by OpenSSL 3.5.
- **FIPS 204 — ML-DSA** (Module-Lattice-Based Digital Signature Algorithm). ML-DSA-65 is NIST category 3,
  OID 2.16.840.1.101.3.4.3.18.
- **Forgeable**: a Shor-breakable signature (RSA, ECDSA) whose required lifetime plus migration time exceeds
  the time to a cryptographically relevant quantum computer (X + Y > Z).
