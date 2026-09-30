# PQC Scanner

Live post-quantum readiness scanner for any public domain. It opens a real TLS connection, offers hybrid
post-quantum key exchange, inspects the certificate chain, and scores the result.

```
backend/    FastAPI API: live TLS probe, SSRF guard, scoring, CycloneDX 1.6 CBOM
frontend/   React + React Three Fiber single page: search, 3D cipher globe, results HUD
```

## Run the demo (one command)

Needs Python 3.10+ and Node.js 20+ (Node only for the first build).

```bash
./run_demo.sh            # macOS / Linux
run_demo.bat             # Windows
```

The script creates `backend/.venv`, installs requirements, builds the frontend into `frontend/dist` when it's
missing or out of date, and starts one FastAPI/Uvicorn process that serves the React app at `/` and the API at
`/api`. When it prints **SYSTEM LIVE: Open http://localhost:8000 in your browser**, it's ready. Options:
`PORT=8080` (another port), `REBUILD=1` (force a fresh frontend build). It stops with a clear message if the port
is already taken.

## QuantumLedger HUD variant (port 8002)

```bash
./run_cyber_demo.sh      # macOS / Linux → QUANTUMLEDGER HUD ONLINE: http://localhost:8002
run_cyber_demo.bat       # Windows
```

Same API and the same five-stage logic (both UIs use `frontend/src/pipeline/usePipeline.ts`), presented as a
QuantumLedger holographic HUD where the 3D scene (`src/hud/Story.tsx`) narrates each stage for a non-specialist:

1. **Detect**: client and server joined by a thin white TLS link; a pulsing crimson wiretap siphons it into adversary storage
   (`QuantumLedger: HARVESTING IN PROGRESS`).
2. **Score**: the camera closes on the storage node; a Q-Day countdown dial and Mosca's `X + Y > Z` project out of it in amber,
   using the real X, Y and Z values.
3. **Defend**: the white link shatters, lattice cages (ML-KEM / ML-DSA) wrap client and server, and each new wiretap snaps
   on contact (`QuantumLedger: LATTICE CRYPTOGRAPHY ENGAGED`).
4. **Prove**: the camera pulls back to a Merkle tree; the secured link compresses into a block that drops and snaps into
   the chain, labelled with the real block hash and root (`QuantumLedger: STATE ANCHORED TO BLOCKCHAIN`).
5. **Rescan**: a radar plane drops over the network topology and every node locks to pulsing emerald.

Proof features around the scene:

- **Live telemetry**: the HUD scans through `GET /api/scan/stream` (Server-Sent Events). Every probe step (DNS vetting,
  TCP connect, the ClientHello and its ML-KEM-768 key share, the ServerHello bytes and selected group, the certificate
  chain) is a `pqc.scan` log record streamed to a glass terminal as it happens, alongside the stream's own status.
- **Interactive WebGL**: OrbitControls on the scene (drag to orbit, scroll to zoom, right-drag to pan, double-click to
  re-frame the stage), with a live fps / draw-call readout.
- **Performance impact**: `GET /api/bench` times ECDHE, RSA / ECDSA, ML-KEM-768 and ML-DSA-65 on the host with
  `cryptography` (OpenSSL) and reports real encoded sizes; combined with the probe's measured round trip and
  certificate chain, the widget shows bytes, CPU and latency added per handshake, and whether the server flight
  still fits TCP's initial window.
- **QuantumLedger Compliance Report**: the primary action at the end of Rescan, a branded PDF with the final risk
  score, the full CWM arithmetic, Mosca's inequality, the CBOM, the performance impact and the ledger block hash,
  Merkle root and verification checks.

Spatial and sensory layer:

- **Tabletop hologram (WebXR)**: **◈ Project to AR** in the header. On an AR-capable phone (Android Chrome with
  ARCore) it starts an `immersive-ar` session: a hit-test reticle finds the table, a tap stands the globe there at
  ~22 cm across, and the ML-KEM lattice shield and then the Merkle ledger block lock into place so the viewer can walk
  around them. On a desktop it shows a QR code for the phone. WebXR needs HTTPS, so the handoff is opt-in:
  `AR=1 ./run_cyber_demo.sh` also serves the demo at `https://<lan-ip>:8003` with a self-signed certificate
  (kept in `backend/.certs/`), and `GET /api/xr` tells the desktop page that address. Without `AR=1` the demo stays on
  localhost and the button explains how to enable it. iOS Safari has no WebXR AR. Outside a session nothing changes:
  the browser view keeps its post-processing, camera flights and overlays (`src/hud/xr.ts`, `ArHandoff.tsx`).
- **Cryptographic sonification (Web Audio)**: synthesised, no audio files, and fired by the same state as the 3D
  scene (`src/hud/sfx.ts`). DETECT: Geiger-counter clicks, one per parsed telemetry record, accelerating with each
  Shor-vulnerable primitive (RSA / ECDSA / classical ECDHE) the probe reports. DEFEND: a sub-bass sweep while the
  lattice grows, then a resonant chime when it locks. PROVE: a mechanical vault lock on the exact frame the block
  snaps into the chain. Toggle with **♪ SFX** (remembered per browser); audio starts after the first click.
- **Spatial glass panels**: on wide screens the diagnostics (score) panel and the live telemetry terminal are
  `CSS3DRenderer` objects on a rig that lazily follows the camera. They sit in their columns, angled inward like a
  wraparound display, and tilt with the cursor (`src/hud/spatial.tsx`). Narrow screens, AR and reduced motion fall
  back to flat or still panels.

A caption bar explains each beat in plain language. Side panels show only real scan data (TLS link, certificate serial,
timestamped event log). The header coordinates are the console's (Bengaluru), not the target's.

It builds to `frontend/dist-hud` (`npm run build:hud`, dev server `npm run dev:hud` on :5182) and runs alongside the
standard demo on :8000. `run_cyber_demo.sh` is a thin wrapper around `run_demo.sh` (`UI=hud`, `PORT=8002`).

## How the scan works

1. **Validate & vet** (`app/netguard.py`): accept a hostname only, IDN → punycode, port 443 only. Resolve it and
   refuse if *any* address is loopback, RFC 1918, link-local (incl. `169.254.169.254`), CGNAT, multicast or reserved.
   The connection goes to that vetted IP, so a second DNS answer can't redirect it inward (DNS rebinding).
   If a host publishes several addresses and one drops traffic (e.g. `nta.ac.in`, where one of two A records
   never answers on 443), the scanner falls back through the vetted addresses with a 3 s connect timeout, also
   skipping any that accept TCP but fail the TLS handshake, and reports the skipped ones in `skipped_addresses`.
2. **Key-exchange probe** (`app/tlsprobe.py`): a hand-built TLS 1.3 ClientHello offers **X25519MLKEM768**
   (FIPS 203 ML-KEM-768 + X25519, codepoint `0x11EC`) plus classical groups, and the plaintext ServerHello reveals
   which group the server picked. Python's `ssl` can't do this itself (its OpenSSL has no ML-KEM, and it doesn't
   expose the negotiated group). The probe reads only the ServerHello (or, for TLS 1.2, ServerKeyExchange) and never
   finishes a handshake.
3. **Certificate probe**: a normal verified `ssl` handshake fetches the chain; `cryptography` extracts key type/size,
   signature algorithm, CN, issuer, validity, SANs. ML-DSA / SLH-DSA are recognised by OID.
4. **Assessment** (`app/analysis.py`):

   | Component | Points | Quantum-safe when |
   |---|---|---|
   | Key exchange | 50 | server chooses a hybrid/pure ML-KEM group |
   | Server key (leaf certificate) | 25 | ML-DSA / SLH-DSA |
   | Certificate signature (CA) | 15 | ML-DSA / SLH-DSA |
   | Protocol | 10 | TLS 1.3 (required for hybrid groups) |

   RSA / ECDSA / (EC)DH are labelled *Vulnerable to Shor's Algorithm (0% PQC Ready)*; ML-KEM hybrids and ML-DSA,
   *Quantum-Safe (100% Ready)*. **60/100 is the best a public site can score today**, because public CAs don't issue
   ML-DSA certificates yet. Urgency: HIGH without PQ key exchange (harvest now, decrypt later), MEDIUM with it (NIST
   IR 8547: RSA/ECC deprecated after 2030, disallowed after 2035).

   Globe colour: **emerald** = hybrid PQ key exchange detected · **amber** = TLS 1.3 but classical key exchange ·
   **crimson** = legacy (TLS ≤ 1.2, RSA key transport, weak keys or SHA-1).

Results from live tests (Sept 2026): cloudflare.com, google.com, example.org and microsoft.com negotiate X25519MLKEM768
(score 60); github.com uses classical x25519 (score 10).

## The frontend: a five-step pipeline

A stepper over the WebGL core walks through **Detect → Score → Defend → Prove → Rescan**, one glass card at a time
(Framer Motion stagger reveals; a shared `layoutId` moves the active step marker and morphs the algorithm chips).

1. **Detect**: live scan; the signature and key-exchange algorithms as chips marked vulnerable or quantum-safe, plus a
   plain-English explanation. Full CBOM behind a disclosure.
2. **Score**: Context-Weighted Mosca, `((X_ML + Y) / Z) × Exp × Fragility × 100` capped at 100 (same model as
   QuantumLedger's backend; `frontend/src/lib/cwm.ts`). X_ML is predicted from the asset type you pick (a public domain is
   internet-facing, Exp 1.2); fragility is 1.0 for RSA/ECDSA and 0.1 for ML-DSA. The gauge fills through Low (0–39),
   High (40–69) and CRITICAL (70–100); **Validate Math** shows the formula with this endpoint's values.
3. **Defend**: *Deploy ML-DSA/ML-KEM Patch* morphs the chips to **ML-DSA-65** (FIPS 204) and **X25519MLKEM768**
   (FIPS 203) and shifts the core from red/amber to cyan/green. Simulated and labelled as such; the OpenSSL runbook is behind a disclosure.
4. **Prove**: anchors a real Web Crypto SHA-256 Merkle block and types it out as terminal output; tamper test behind a
   disclosure.
5. **Rescan**: a verification pass against the patched configuration; the score ring goes to 100 (PQC-ready). It states
   that the live server is unchanged.

After step 5 a **Quantum safety impact** card compares before and after: algorithms, CWM risk (e.g. 100 CRITICAL → 21.4
Low), PQC score (→ 100) and the count of quantum-vulnerable algorithms (→ 0).

**Export CBOM Report (PDF/JSON)** stays pinned top right. The JSON is built from the current UI state
(`frontend/src/lib/cyclonedx.ts`): the scanned algorithms before the patch, ML-DSA-65 + X25519MLKEM768 after it, with
the CWM score and ledger block as metadata properties. It validates against the CycloneDX 1.6 schema. If the scanner API is unreachable, Detect falls back to a
labelled demo dataset (`frontend/src/lib/demo.ts`) so the pipeline still runs offline.

## API

`GET /api/scan?domain=cloudflare.com` returns TLS version, cipher suite, negotiated group, certificate details,
assessment (score, status, headline, urgency, breakdown, recommendations) and the full CycloneDX 1.6 CBOM.
`GET /api/health`. Errors: `400` invalid or blocked target, `429` rate limit, `502` handshake failed, `504` timeout.

| Env var | Default | Purpose |
|---|---|---|
| `ALLOWED_ORIGINS` | `*` | CORS origins, comma-separated (set to your Vercel URL in production) |
| `RATE_LIMIT` | `12` | scans per minute per client IP |
| `TRUST_PROXY` | `0` (`1` in Docker) | use the last `X-Forwarded-For` hop as the client IP |
| `CACHE_TTL` | `300` | seconds to cache a domain's result |
| `MAX_CONCURRENT_SCANS` | `8` | parallel handshakes |

## Run for development

```bash
cd backend
python3 -m venv .venv && .venv/bin/pip install -r requirements-dev.txt
.venv/bin/uvicorn app.main:app --port 8010      # http://127.0.0.1:8010/docs
.venv/bin/python -m pytest -q                   # add LIVE=1 to include real-network tests

cd ../frontend
npm install
npm run dev                                      # http://localhost:5180 (proxies /api → :8010)
```

`?domain=example.org` in the page URL scans on load, which is handy for sharing a result.

## Deploy

**Backend** (Render / Railway / Fly.io): all three build the included `Dockerfile` and inject `$PORT`.
- Render or Railway: new web service with root directory `backend` (inside this project); Docker is detected. The `Procfile` also works with
  their Python buildpacks. Health check path: `/api/health`.
- Fly.io: `cd backend && fly launch --no-deploy`, keep the generated app name in `fly.toml`, then `fly deploy`.
- Set `ALLOWED_ORIGINS=https://<your-app>.vercel.app`.
- Outbound TCP 443 must be allowed (it is by default on all three).

**Frontend** (Vercel): import the repo with root directory `frontend` (inside this project) (framework: Vite). Set
`VITE_API_URL=https://<your-backend-host>` and deploy. `vercel.json` adds SPA rewrites and security headers.
