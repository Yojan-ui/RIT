# SecureMailScope

Email security posture scanner built with FastAPI, dnspython, and an HTMX dashboard.

## Quick start

```bash
python3 -m venv .venv && source .venv/bin/activate   # Python 3.11+
pip install -r requirements.txt                       # or: pip install -e ".[dev]"
uvicorn app.main:app --reload
```

- Dashboard: http://127.0.0.1:8000/
- API docs:  http://127.0.0.1:8000/docs
- API base:  `/api/v1` (`GET /health`, `POST /scan`, `GET /scan/{domain}`, `GET /recent`)
- Exports:   `GET /scan/{domain}/json` (JSON download) and `GET /scan/{domain}/pdf` (formal PDF
  audit report). Both accept an optional `?dkim_selectors=s1,s2`.

```bash
curl -X POST localhost:8000/api/v1/scan -H 'content-type: application/json' \
  -d '{"domain": "example.com", "dkim_selectors": ["s1"], "force_refresh": true}'
```

Run tests with `pytest`. The suite runs fully offline: an autouse fixture fails any test that
touches the network beyond loopback. `tests/fixtures/scenarios.json` holds end-to-end scan
scenarios (unprotected domain → F, hardened domain → A, port 25 blocked → A with transport
excluded), each pinning the grade, every check status and all seven attack path outcomes.

## What it checks

| Check | Standard | Notes |
|---|---|---|
| MX | RFC 5321, RFC 7505 | presence, priorities, null MX, IP-literal targets |
| SPF | RFC 7208 | recursive `include:`/`redirect=` walk, 10-lookup and 2-void-lookup limits, `all` qualifier, loops, `ptr`, over-broad ranges |
| DKIM | RFC 6376, 8301, 8463 | probes your selectors plus common ones; decodes keys with `cryptography` for RSA bit length, Ed25519, SHA-1-only, testing mode, wildcard records |
| DMARC | RFC 7489 | all tags; org-domain fallback; `p=none`, `sp=none`, `pct<100`; external `rua` authorisation |
| MTA-STS | RFC 8461 | TXT id, HTTPS policy fetch (no redirects, text/plain), mode, max_age, MX coverage |
| TLS-RPT | RFC 8460 | record and `rua` URI schemes |
| Transport | RFC 3207 | STARTTLS on the primary MX: TLS version, cipher, certificate validity and expiry |

### Attack paths and the one fix

Every scan assesses seven attack paths (exact-domain spoofing, subdomain spoofing, envelope
spoofing, tampering/forwarding breakage, STARTTLS downgrade, weak transport encryption,
undetected abuse) as `exposed`, `partial`, `mitigated` or `unknown` (`attack_matrix` in the API).
`one_fix` is the single remediation that closes the most severity-weighted exposure, with the
DNS record to publish where one applies and the score gain it would bring.
Rules live in `app/engine/attack_paths.py`, remediation in `app/engine/remediation.py`.

### Honest degradation

Checks that can't be measured from where the scanner runs are reported as
`not_assessed` and **removed from the score's denominator**, never scored as failures:

- **Transport**: if every MX refuses TCP on port 25, the scanner probes a known-good
  SMTP host (`SMS_SMTP_EGRESS_PROBE_HOST`). If that is unreachable too, outbound port 25
  is blocked on *our* side. A 5xx banner aimed at the scanner's IP is treated the same way.
- **DKIM**: selectors can't be enumerated via DNS, so finding nothing at common
  selectors isn't proof of absence. Supply your selector to get a real verdict.
- **MTA-STS / TLS-RPT / transport** are "not applicable" for null-MX domains.

### DNS

`SMS_DNS_MODE=auto` queries over UDP 53 and falls back to DNS-over-HTTPS (RFC 8484,
Cloudflare then Google) when UDP fails at the transport level, then sticks to DoH for
5 minutes. All queries pass through a per-domain token bucket
(`SMS_DNS_RATE_PER_SECOND`, `SMS_DNS_BURST`).

## Layout

```
app/
  core/       config (SMS_* env vars), constants, logging, SQLite TTL cache
  engine/     dns_resolver (normalisation, UDP/DoH, rate limiting), scanner, scoring, attack_paths
    checkers/ mx, spf, dkim, dmarc, mta_sts, tls_rpt, transport
  models/     pydantic schemas + enums
  api/        v1 router (JSON + HTMX partials)
  reports/    PDF audit report (ReportLab)
  templates/  Jinja2 templates (base, index, partials/)
  static/     css, js, assets
tests/        fixtures/, test_dns_resolver.py, test_checkers.py, test_transport.py,
              test_engine.py, test_scoring.py, test_attack_paths.py, test_scenarios.py,
              test_exports.py
```

## Adding a checker

Subclass `app.engine.checkers.base.BaseChecker`, set `name`, implement `async check(ctx: ScanContext)`,
and append the class to `CHECKERS` in `app/engine/checkers/__init__.py`. Scoring weights live in
`app/engine/scoring.py`; attack-path rules live in `app/engine/attack_paths.py`.

## Configuration

See `.env.example`. Cached scans live in `data/cache.sqlite3` and expire after
`SMS_CACHE_TTL_SECONDS` (default 3600).
