# SecureMailScope

Email-security posture scanner with a 3D terminal UI. Enter a domain and it grades 7 vectors (**SPF, DKIM, DMARC, MX, MTA-STS, TLS-RPT** and a raw **port-25 STARTTLS** socket probe), maps what is broken to concrete attack paths, and names **The One Fix**: the single DNS change that closes the most of them.

```
backend/    FastAPI assessment engine + API; serves the compiled frontend at /
frontend/   React 19 + Vite + Tailwind v4 terminal UI (Defense Lattice in React Three Fiber)
Dockerfile  Node build stage -> Python image, Uvicorn on $PORT (default 80)
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

## Deploy (Ubuntu VM, custom domain, automatic HTTPS)

The STARTTLS probe needs **outbound TCP 25**, which most PaaS hosts (Render, Heroku, and default AWS/GCP/Azure accounts) block, so run it on a VM where it is open. Infrastructure as code:

| File | Role |
|---|---|
| `deploy.sh` | One-shot, re-runnable setup for a fresh Ubuntu VM: installs Docker and Caddy from their official repositories, clones or updates the code, writes `.env`, runs `docker compose up -d --build`, and configures Caddy |
| `docker-compose.yml` | Builds the image and publishes the app on **127.0.0.1:8000** only (Caddy is the sole public entry point), with a persistent scan-cache volume and log rotation |
| `Caddyfile` | Automatic Let's Encrypt HTTPS for `$DOMAIN`, reverse proxy to `127.0.0.1:8000`, compression, JSON access log |

1. Point the domain's DNS **A/AAAA** record at the VM and allow inbound **80/443**.
2. On the VM:

```bash
curl -fsSLO https://raw.githubusercontent.com/Yojan-ui/SECUREMAILSCOPE/main/deploy.sh
sudo DOMAIN=scan.example.com ACME_EMAIL=you@example.com \
     ANTHROPIC_API_KEY=sk-ant-... SCAN_RATE_PER_MINUTE=100 SCAN_BURST=100 \
     bash deploy.sh
```

Until this branch is merged, fetch the script from `securemailscope-3d-terminal` instead of `main` and add `BRANCH=securemailscope-3d-terminal`. Re-run `sudo bash /opt/securemailscope/deploy.sh` to update: settings are remembered, and any variable you pass again replaces the stored value. Secrets go only to `/opt/securemailscope/.env` (mode 600, git-ignored). The script warns if outbound port 25 is blocked.

Without Caddy: `docker compose up -d --build` serves the app on `http://127.0.0.1:8000`.

## Protecting a public deployment

The live scan is the expensive endpoint: each one opens DNS, HTTPS and **port-25 SMTP** connections to hosts chosen by whoever supplies the domain. Built-in protections (all tunable in `.env.example`):

| Protection | Default |
|---|---|
| New live scans per client IP | 10/min, burst 8. `429` with `Retry-After` once exceeded. Cache hits and demo domains are free |
| All `/api/*` requests per client IP | 120/min, burst 60 (health checks exempt) |
| Concurrent live scans | 8. Identical in-flight requests share one scan; beyond that, `503` after a 20 s queue |
| Claude narratives | 300/day, then the rule-based writer. One narrative per scan (cached) |
| SSRF guard | MX hosts and `mta-sts.<domain>` must resolve only to public addresses; connections go to the validated IP (no DNS rebinding) |
| Request body | 16 KiB max (`413`) |
| Headers | CSP, `X-Frame-Options`, `nosniff`, Referrer/Permissions-Policy, HSTS over HTTPS, `X-Request-ID`, JSON access logs with `LOG_FORMAT=json` |

The dashboard's CSP is strict (no `eval`, no inline script, same-origin only) because it renders attacker-controlled DNS text.

**Client IPs.** Limits are keyed by client IP and kept in-process (the image runs one worker on purpose). `X-Forwarded-For` is trusted only from `FORWARDED_ALLOW_IPS`, so clients can't forge it:

- With `docker-compose.yml` + Caddy: already configured. The Compose network has a fixed gateway (`172.30.0.1`), the only address trusted to forward client IPs, and Caddy replaces any client-sent `X-Forwarded-For`.
- Running the image directly (`docker run -p 80:80`): leave the default. The socket peer is the real client.

Check `client_ip` in the logs (`docker logs securemailscope`) shows real client addresses before sharing the URL.

## Claude-written narratives

`GET /api/v1/scan/{domain}/narrative` uses Claude (`claude-opus-5`, JSON-schema output, server-side refusal fallback) when `ANTHROPIC_API_KEY` is set. Claude only re-expresses the engine's findings: a response that states a different score or grade, cites a check that has no finding, or proposes work for a clean domain is discarded, and the rule-based narrative is served instead (`fallback_reason` says why). Without a key, the rule-based writer is used.

## API

Interactive docs at `/docs`. The versioned API:

| Route | |
|---|---|
| `GET /api/v1/health` | Liveness and version |
| `POST /api/v1/scan` | `{"domain", "dkim_selectors", "force_refresh"}` → full report |
| `GET /api/v1/scan/{domain}` | Latest report (cached for `CACHE_TTL`; `?refresh=true` rescans) |
| `GET /api/v1/scan/{domain}/pdf` | Formal PDF audit report (download) |
| `GET /api/v1/scan/{domain}/json` | Report as a JSON file (download) |
| `GET /api/v1/scan/{domain}/narrative` | Plain-English summary, attack scenarios, remediation steps |
| `GET /api/v1/recent` | Recently scanned domains with score and grade |
| `GET /api/v1/demo-domains` | Built-in `.example` domains that scan without network |

Demo scenarios (`/api/demo`) run canned observations through the real engine, so the UI works without network access. Details: [backend/README.md](backend/README.md), [frontend/README.md](frontend/README.md).
