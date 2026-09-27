"""FastAPI application entrypoint: ``uvicorn app.main:app``."""

from __future__ import annotations

from collections import OrderedDict
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

import httpx
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates

from app.api.routes import router as api_router
from app.core.cache import DomainCache
from app.core.config import get_settings
from app.core.constants import API_PREFIX
from app.core.logging import configure_logging, get_logger
from app.demo import demo_domains, is_demo
from app.engine.dns_resolver import DNSResolver, RateLimiter

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
    templates = Jinja2Templates(directory=str(settings.templates_dir))
    css_dir = settings.static_dir / "css"
    # Prebuilt stylesheet (Docker image) when present; otherwise the dev CDN build plus the theme.
    templates.env.globals["tailwind_built"] = (css_dir / "tailwind.css").is_file()
    templates.env.globals["tailwind_theme"] = (css_dir / "theme.css").read_text()
    templates.env.globals["is_demo"] = is_demo
    app.state.templates = templates
    app.mount("/static", StaticFiles(directory=str(settings.static_dir)), name="static")
    app.include_router(api_router, prefix=API_PREFIX, tags=["v1"])
    if settings.cors_origins:
        app.add_middleware(
            CORSMiddleware,
            allow_origins=settings.cors_origins,
            allow_methods=["GET", "POST"],
            allow_headers=["content-type"],
        )

    @app.get("/", response_class=HTMLResponse, include_in_schema=False)
    async def dashboard(request: Request, domain: str = "") -> HTMLResponse:
        return app.state.templates.TemplateResponse(
            request,
            "index.html",
            # ?domain=... pre-fills the form and scans on load, so a result can be bookmarked or linked.
            {"app_name": settings.app_name, "version": settings.version, "demos": demo_domains(), "domain": domain[:253]},
        )

    return app


app = create_app()
