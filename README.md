# SecureMailScope

Email-security posture scanner with a 3D terminal UI. Enter a domain and it grades 7 vectors (**SPF, DKIM, DMARC, MX, MTA-STS, TLS-RPT** and a raw **port-25 STARTTLS** socket probe), maps what is broken to concrete attack paths, and names **The One Fix**: the single DNS change that closes the most of them.

```
backend/    FastAPI assessment engine + API; serves the compiled frontend at /
frontend/   React 19 + Vite + Tailwind v4 terminal UI (Defense Lattice in React Three Fiber)
Dockerfile  Node build stage -> Python image, Uvicorn on $PORT (default 80)
render.yaml Render blueprint
```

## Run locally

```bash
cd backend
python3 -m venv .venv && .venv/bin/pip install -r requirements-dev.txt
.venv/bin/python -m app.frontend build        # compiles frontend/ into backend/static/
.venv/bin/uvicorn app.main:app --port 8080    # http://127.0.0.1:8080
```

For frontend development with hot reload, run `npm run dev` in `frontend/` (http://localhost:5173, proxies `/api` to `http://127.0.0.1:8000`; override with `API_TARGET`).

Tests: `cd backend && .venv/bin/python -m pytest`

Docker: `docker build -t securemailscope . && docker run -p 8080:80 securemailscope`

## What you see

A brutalist terminal (`#050505`, 1px `white/10` rules, square corners, monospace):

- **Left:** Security Posture score (0-100, grade), the 7-vector check matrix, and The One Fix as a raw zone-file record.
- **Right:** the **Defense Lattice**, a wireframe sphere for the domain with 7 orbiting check nodes. Passing links are solid green, warnings glow amber, and failing links snap, scatter and glitch red under three.js `UnrealBloomPass`. A Spline scene is available as an alternate view. Below the viewport is the **Real-Time Telemetry** feed, which replays the scan's DNS/SMTP/TLS observations.
- Below the deck: the attack-path × vector detail table and per-vector cards with raw DNS strings.

Demo scenarios (`/api/demo`) run canned observations through the real engine, so the UI works without network access. Details: [backend/README.md](backend/README.md), [frontend/README.md](frontend/README.md).
