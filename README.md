# QuantumLedger

**Post-Quantum Cryptographic Resilience for Critical Infrastructure.**

QuantumLedger inspects the live TLS handshake of any endpoint and measures how exposed it is to a future quantum computer.
It scores that risk with Mosca's theorem, shows the migration to NIST post-quantum standards, and seals each assessment
into a hybrid-signed Merkle ledger that auditors can check for themselves. Everything runs on the operator's own
machine: no cloud services, accounts or telemetry.

```bash
git clone https://github.com/Yojan-ui/RIT.git && cd RIT && ./run_cyber_demo.sh   # → http://localhost:8002
```

---

## The threat

**Harvest Now, Decrypt Later.** Adversaries are already intercepting and archiving encrypted traffic from government,
energy, telecom and financial networks. They do not need to break it today; they only need to store it and wait.

The public-key cryptography protecting that traffic, **RSA** and **elliptic curves (ECC)**, rests on integer factoring
and discrete logarithms. **Shor's algorithm** solves both efficiently on a large enough quantum computer. When one
exists, every archived session becomes plaintext and every classical certificate can be forged.

India's DST task force has set **2029** as the deadline for critical information infrastructure to move to
post-quantum cryptography. A migration on that scale takes years, and it starts with knowing which systems are exposed.

| Today | 2029 | 2033+ |
|---|---|---|
| **Harvest.** Encrypted TLS traffic is recorded at scale. | **Deadline.** The DST task force's target for post-quantum migration of critical systems. | **Decrypt.** A cryptographically relevant quantum computer runs Shor's algorithm on the archive. |

---

## How we are unique

### 1 · Mathematical risk scoring

Every endpoint is scored with **Mosca's theorem**:

> **X + Y > Z ⇒ the data is already exposed.**
> X = the years the data must stay secret · Y = the years the migration will take · Z = the years until a quantum adversary exists (2033 lower bound).

QuantumLedger extends this into a **Context-Weighted Mosca (CWM)** score from 0 to 100:

```
Risk = ((X_ML + Y) / Z) × Exposure × Fragility × 100        (capped at 100)
```

Fragility comes from the real algorithms seen in the handshake: 1.0 for RSA and ECDSA, 0.1 for ML-DSA. Every term is
shown with the endpoint's own values, so the score can be checked by hand rather than taken on trust.

### 2 · Air-gapped execution

**0 cloud dependencies.** The TLS probe, risk engine, CycloneDX CBOM export, PDF compliance report and ledger all run
on the operator's machine. The only outbound connection is the TLS handshake to the endpoint being assessed. Scan
results, topology and evidence never leave the local perimeter. Fonts and every library ship with the build, so nothing
loads from a CDN at runtime.

### 3 · Verifiable proof

Each assessment is sealed into a **hash-chained SHA-256 Merkle ledger**, and every block hash is **hybrid-signed with
ML-DSA-65 (FIPS 204) and classical Ed25519**. A block verifies only if:

- every leaf, the Merkle root and the block hash recompute exactly;
- **both** signatures verify, so a forger has to break both the post-quantum and the classical scheme;
- the signer is the key pinned to this console, so a block re-signed with someone else's valid keys is rejected;
- the block links to the previous block in the chain.

Public keys and full signatures ship in the CBOM export, so a third party can verify the proof independently.

---

## Quick start (run locally)

**Requirements:** Python 3.10+, Node.js 20+ with npm, and macOS or Linux.

```bash
git clone https://github.com/Yojan-ui/RIT.git
cd RIT
./run_cyber_demo.sh
```

Open **http://localhost:8002**.

On the first run the script creates a Python virtual environment, installs the backend and frontend dependencies, and
builds the UI. That is the only step that needs internet access to package registries. After that, QuantumLedger starts
from the local build.

| Option | Effect |
|---|---|
| `PORT=8090 ./run_cyber_demo.sh` | Serve on another port |
| `REBUILD=1 ./run_cyber_demo.sh` | Force a fresh UI build |
| `AR=1 ./run_cyber_demo.sh` | Also serve HTTPS on the LAN so an Android phone can project the scene in WebXR AR |

---

## The demo in five stages

Open the console from the landing page, enter a hostname (or pick a preset), and walk through:

1. **Detect.** A real TLS 1.3 handshake records the key exchange group, the certificate key and its signature, and
   builds a cryptographic inventory (CBOM).
2. **Score.** CWM risk from 0 to 100 with the full Mosca arithmetic. *Validate Math* shows every term.
3. **Defend.** A simulated migration to **X25519MLKEM768** (FIPS 203) and **ML-DSA-65** (FIPS 204), with its measured
   cost per handshake: bytes on the wire and CPU time.
4. **Prove.** The three stage records are sealed into a hybrid-signed Merkle block. A tamper test edits a record and
   shows verification fail.
5. **Rescan.** A verification sweep against the patched configuration, then a one-click **compliance report (PDF)**
   and **CBOM (CycloneDX 1.6 JSON)**.

---

## Architecture

```
┌──────────────────────────── operator machine (localhost) ────────────────────────────┐
│                                                                                        │
│  Browser · React 19 + React Three Fiber                                                │
│  ├─ landing gateway → 3D console (lazy-loaded)                                         │
│  ├─ CWM / Mosca scoring                                                                │
│  ├─ Merkle ledger · Ed25519 + ML-DSA-65 signing (@noble/curves, @noble/post-quantum)   │
│  └─ PDF compliance report · CycloneDX CBOM                                             │
│                     │  /api (same origin)                                              │
│  FastAPI · Python ──┴─ TLS probe (OpenSSL via cryptography) · SSRF guard · benchmarks  │
│                                                                                        │
└───────────────────────────────────────┬────────────────────────────────────────────────┘
                                        │ TLS handshake only
                                        ▼
                                  target endpoint
```

| Path | Contents |
|---|---|
| `run_cyber_demo.sh` | One-command launcher (delegates to `pqc-scanner/`) |
| `pqc-scanner/backend/` | FastAPI service: TLS probe, analysis, live log stream, crypto benchmarks |
| `pqc-scanner/frontend/` | React + Vite UI: landing page, 3D console (`src/hud/`), ledger and reports (`src/lib/`) |
| `pqc-scanner/README.md` | Detailed feature notes: X-ray views, AR handoff, telemetry stream |

---

## Standards

| Standard | Role in QuantumLedger |
|---|---|
| NIST FIPS 203 (ML-KEM) | Target key exchange: X25519MLKEM768 hybrid |
| NIST FIPS 204 (ML-DSA) | Target certificate signatures; ledger block signatures (ML-DSA-65) |
| NIST FIPS 205 (SLH-DSA) | Recognised as quantum-safe in the inventory |
| CycloneDX 1.6 | Cryptographic Bill of Materials export |
| RFC 6962-style Merkle trees | Domain-separated leaf/node hashing in the ledger |

---

## Scope

- **Detection is live; the remediation is simulated.** The Defend and Rescan stages model the patched configuration.
  No change is made to the target server, and the UI and reports say so.
- **Public hostnames only (for now).** An SSRF guard refuses private, loopback and internal addresses, so the scanner
  cannot be pointed into a network it should not reach. Scanning in-perimeter CII hosts means relaxing this guard for a
  trusted deployment.
- **Ledger keys live in the browser.** The signing keys are stored locally for the demo. A production deployment would
  keep them in an HSM or the OS keystore.
