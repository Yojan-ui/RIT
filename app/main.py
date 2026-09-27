"""FastAPI application entrypoint: ``uvicorn app.main:app``."""

from __future__ import annotations

from collections import OrderedDict
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

import httpx
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.routes import router as api_router
from app.core.cache import DomainCache
from app.core.config import get_settings
from app.core.constants import API_PREFIX
from app.core.logging import configure_logging, get_logger
from app.engine.dns_resolver import DNSResolver, RateLimiter
from app.web import mount_frontend

settings = get_settings()
configure_logging(settings.log_level)
log = get_logger("main")


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    cache = DomainCache(settings.cache_path, default_ttl=settings.cache_ttl_seconds)
    await cache.connect()
    purged = await cache.purge_expired()
    if purged:
        log.info("purged %d expired cache entries", purged)
    http = httpx.AsyncClient(
        timeout=settings.http_timeout_seconds,
        follow_redirects=False,
        headers={"user-agent": f"{settings.app_name}/{settings.version}"},
    )
    app.state.settings = settings
    app.state.cache = cache
    app.state.http = http
    app.state.narratives = OrderedDict()
    app.state.resolver = DNSResolver(
        timeout=settings.dns_timeout_seconds,
        nameservers=settings.dns_nameservers or None,
        mode=settings.dns_mode,
        doh_endpoints=settings.doh_endpoints,
        http_client=http,
        rate_limiter=RateLimiter(rate=settings.dns_rate_per_second, burst=settings.dns_burst),
    )
    log.info(
        "%s %s started (%s, dns=%s, smtp probe %s)",
        settings.app_name,
        settings.version,
        settings.env,
        settings.dns_mode,
        "on" if settings.smtp_probe_enabled else "off",
    )
    try:
        yield
    finally:
        await http.aclose()
        await cache.close()


def create_app() -> FastAPI:
    app = FastAPI(title=settings.app_name, version=settings.version, lifespan=lifespan)
    app.include_router(api_router, prefix=API_PREFIX, tags=["v1"])
    if settings.cors_origins:
        app.add_middleware(
            CORSMiddleware,
            allow_origins=settings.cors_origins,
            allow_methods=["GET", "POST"],
            allow_headers=["content-type"],
        )
    # Registered last: the React app catches every path the API and /docs don't.
    mount_frontend(app, settings.frontend_dist)
    return app


app = create_app()
