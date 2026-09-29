# PQC Scanner

Live post-quantum readiness scanner for any public domain. It opens a real TLS connection, offers hybrid
post-quantum key exchange, inspects the certificate chain, and scores the result.

```
backend/    FastAPI API: live TLS probe, SSRF guard, scoring, CycloneDX 1.6 CBOM
frontend/   React + React Three Fiber single page: search, 3D cipher globe, results HUD
```

## How the scan works

1. **Validate & vet** (`app/netguard.py`): accept a hostname only, IDN → punycode, port 443 only. Resolve it and
   refuse if *any* address is loopback, RFC 1918, link-local (incl. `169.254.169.254`), CGNAT, multicast or reserved.
   The connection goes to that vetted IP, so a second DNS answer can't redirect it inward (DNS rebinding).
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

## The frontend: an actionable split screen

Built for an IT administrator who needs to know what's wrong, what to press, and what to hand to compliance.

- **Left: diagnosis.** The WebGL crypto core (`frontend/src/scene/CryptoCore.tsx`) reacts to the result: amber/red and
  unstable when vulnerable, calm emerald once secured. Over it sits one plain-English headline generated from the live
  scan (e.g. "github.com is using an outdated ECDSA P-256 lock.") and a "What this means" line (`frontend/src/lib/diagnosis.ts`).
- **Right: action plan.**
  1. **The vulnerability**: the exact asset (`host:443`, IP, issuer) and each quantum-breakable algorithm, with the
     backend's urgency. The full CBOM sits behind a disclosure.
  2. **The 1-click fix**: a checklist (replace the certificate with ML-DSA-65, enable X25519MLKEM768, anchor proof) and
     **Deploy ML-DSA-65 Quantum Patch**, pinned in a sticky action bar so the next button is always on screen. The
     deployment is simulated and labelled as such; the OpenSSL 3.5 runbook is behind "What the patch does".
  3. **The proof**: "Endpoint Secured. Hash anchored to Ledger." with the block number and SHA-256 block hash (real
     Web Crypto Merkle block, chained in localStorage). Terminal output and a tamper test are behind a disclosure.
- **Export CBOM Report (PDF/JSON)**, pinned top right: a jsPDF-generated report (endpoint, certificate, CBOM table,
  action plan status, ledger proof) and the raw CycloneDX 1.6 JSON (`frontend/src/lib/report.ts`).

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

## Run locally

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
- Render or Railway: new web service from `pqc-scanner/backend`; Docker is detected. The `Procfile` also works with
  their Python buildpacks. Health check path: `/api/health`.
- Fly.io: `cd backend && fly launch --no-deploy`, keep the generated app name in `fly.toml`, then `fly deploy`.
- Set `ALLOWED_ORIGINS=https://<your-app>.vercel.app`.
- Outbound TCP 443 must be allowed (it is by default on all three).

**Frontend** (Vercel): import the repo with root directory `pqc-scanner/frontend` (framework: Vite). Set
`VITE_API_URL=https://<your-backend-host>` and deploy. `vercel.json` adds SPA rewrites and security headers.
