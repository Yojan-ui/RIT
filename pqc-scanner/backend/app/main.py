"""Public PQC domain scanner API.

    GET /api/scan?domain=example.com   live TLS handshake + PQC assessment + CBOM
    GET /api/health

Environment:
    ALLOWED_ORIGINS   comma-separated CORS origins (default "*"; e.g. https://pqc.example.vercel.app)
    RATE_LIMIT        scans per minute per client IP (default 12)
    TRUST_PROXY       "1" to take the client IP from the last X-Forwarded-For hop (set behind Render/Railway/Fly proxies)
    CACHE_TTL         seconds to cache a domain's result (default 300)
    FRONTEND_DIST     built frontend to serve at / (default: ../frontend/dist next to this backend)

When the frontend has been built (`npm run build` in frontend/), this app also serves it at `/`,
so one Uvicorn process runs the whole demo. API routes under /api keep priority.
"""

from __future__ import annotations

import asyncio
import os
import time
from collections import OrderedDict, defaultdict, deque
from pathlib import Path

from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from . import analysis, netguard, tlsprobe

ALLOWED_ORIGINS = [o.strip() for o in os.environ.get("ALLOWED_ORIGINS", "*").split(",") if o.strip()]
RATE_LIMIT = int(os.environ.get("RATE_LIMIT", "12"))
TRUST_PROXY = os.environ.get("TRUST_PROXY", "0") == "1"
CACHE_TTL = int(os.environ.get("CACHE_TTL", "300"))
SCAN_TIMEOUT = 20.0
FRONTEND_DIST = Path(os.environ.get("FRONTEND_DIST", Path(__file__).resolve().parents[2] / "frontend" / "dist"))

app = FastAPI(
    title="PQC Domain Scanner",
    version="1.0.0",
    description="Live TLS handshake analysis for post-quantum readiness (FIPS 203 ML-KEM, FIPS 204 ML-DSA).",
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_methods=["GET"],
    allow_headers=["*"],
    max_age=600,
)


@app.middleware("http")
async def security_headers(request: Request, call_next):
    response = await call_next(request)
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    response.headers.setdefault("Referrer-Policy", "no-referrer")
    return response


# ── Abuse controls ───────────────────────────────────────────────────────────

_hits: dict[str, deque] = defaultdict(deque)
_slots = asyncio.Semaphore(int(os.environ.get("MAX_CONCURRENT_SCANS", "8")))
_cache: OrderedDict[str, tuple[float, dict]] = OrderedDict()


def client_ip(request: Request) -> str:
    if TRUST_PROXY:
        fwd = request.headers.get("x-forwarded-for")
        if fwd:
            # The platform proxy appends the real peer last; earlier entries are client-supplied and spoofable.
            return fwd.split(",")[-1].strip()
    return request.client.host if request.client else "unknown"


def check_rate(ip: str) -> None:
    now = time.monotonic()
    q = _hits[ip]
    while q and now - q[0] > 60:
        q.popleft()
    if len(q) >= RATE_LIMIT:
        raise HTTPException(429, f"Rate limit: {RATE_LIMIT} scans per minute. Try again shortly.", headers={"Retry-After": "30"})
    q.append(now)


def cache_get(host: str) -> dict | None:
    hit = _cache.get(host)
    if hit and time.monotonic() - hit[0] < CACHE_TTL:
        return hit[1]
    return None


def cache_put(host: str, value: dict) -> None:
    _cache[host] = (time.monotonic(), value)
    _cache.move_to_end(host)
    while len(_cache) > 500:
        _cache.popitem(last=False)


def _short(e: BaseException) -> str:
    return "timed out" if isinstance(e, TimeoutError) else (str(e) or type(e).__name__)[:120]


# ── Scan ─────────────────────────────────────────────────────────────────────


def _probe(target: netguard.Target) -> tuple[tlsprobe.KeyExchangeResult, tlsprobe.CertificateResult]:
    try:
        kx = tlsprobe.probe_key_exchange(target)
    except (ConnectionError, OSError):
        kx = tlsprobe.probe_key_exchange(target)  # one retry: some edges drop the first unusual hello
    return kx, tlsprobe.probe_certificate(target)


def run_scan(raw_domain: str) -> dict:
    started = time.perf_counter()
    target = netguard.validate(raw_domain)

    # Fall back through the host's vetted addresses: skip ones that don't accept TCP,
    # and ones that accept TCP but fail the TLS handshake (e.g. a strict WAF edge).
    failures: list[tlsprobe.AddressFailure] = []
    for candidate in tlsprobe.reachable_targets(target, failures):
        try:
            kx, cert = _probe(candidate)
        except (ConnectionError, OSError) as e:
            failures.append(tlsprobe.AddressFailure(candidate.ip, f"TLS handshake failed: {_short(e)}", isinstance(e, TimeoutError)))
            continue
        target = candidate
        break
    else:
        tried = ", ".join(str(f) for f in failures) or target.ip
        if failures and all(f.timed_out for f in failures):
            raise HTTPException(504, f"{target.hostname}:443 did not respond on any address ({tried}).")
        raise HTTPException(502, f"Could not complete a TLS handshake with {target.hostname}:443 ({tried}).")

    if failures:
        kx.notes.append(f"Skipped unreachable address(es): {', '.join(str(f) for f in failures)}. Scanned {target.ip}.")
    if kx.alert and not kx.tls_version:
        kx.notes.append(f"Server rejected the PQ-capable ClientHello with alert '{kx.alert}'; details below come from a standard handshake.")
        kx.tls_version = cert.tls_version

    assessment = analysis.assess(target.hostname, kx, cert)
    cbom = analysis.build_cbom(target.hostname, kx, cert)
    return {
        "domain": target.hostname,
        "resolved_ip": target.ip,
        "addresses": [ip for _, ip in target.addresses] or [target.ip],
        "skipped_addresses": [{"ip": f.ip, "reason": f.reason} for f in failures],
        "scanned_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "duration_ms": round((time.perf_counter() - started) * 1000),
        "tls": {
            "version": kx.tls_version or cert.tls_version,
            "cipher_suite": kx.cipher_suite or cert.cipher_suite,
            "key_exchange": {
                "group": kx.group,
                "group_code": f"0x{kx.group_code:04X}" if kx.group_code is not None else None,
                "pq_hybrid": kx.pq_hybrid,
                "offered": ["X25519MLKEM768", "x25519", "secp256r1", "secp384r1", "secp521r1"],
                "hello_retry": kx.hello_retry,
                "method": kx.kex_method,
                "notes": kx.notes,
            },
        },
        "certificate": {**cert.leaf, "trusted": cert.trusted, "verify_error": cert.verify_error, "chain": cert.chain},
        "assessment": assessment,
        "cbom_summary": analysis.cbom_rows(cbom),
        "cbom": cbom,
    }


@app.get("/api/scan")
async def scan(request: Request, domain: str = Query(..., min_length=1, max_length=2048, description="Hostname, e.g. cloudflare.com")):
    try:
        host = netguard.normalise_hostname(domain)
    except netguard.TargetError as e:
        raise HTTPException(400, str(e)) from e
    cached = cache_get(host)
    if cached:
        return {**cached, "cached": True}
    check_rate(client_ip(request))
    async with _slots:
        try:
            result = await asyncio.wait_for(asyncio.to_thread(run_scan, host), SCAN_TIMEOUT)
        except netguard.TargetError as e:
            raise HTTPException(400, str(e)) from e
        except asyncio.TimeoutError as e:
            raise HTTPException(504, f"Scan of {host} timed out.") from e
    cache_put(host, result)
    return {**result, "cached": False}


@app.get("/api/health")
async def health():
    return {"status": "ok"}


# Serve the built React app at / (registered last, so /api and /docs keep priority).
if (FRONTEND_DIST / "index.html").is_file():
    app.mount("/", StaticFiles(directory=FRONTEND_DIST, html=True), name="frontend")
else:

    @app.get("/", include_in_schema=False)
    async def root():
        return {
            "service": "pqc-scanner",
            "scan": "/api/scan?domain=cloudflare.com",
            "docs": "/docs",
            "frontend": f"not built: run `npm run build` in frontend/ (looked in {FRONTEND_DIST})",
        }
