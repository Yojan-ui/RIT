"""Runtime configuration loaded from environment variables (prefix ``SMS_``)."""

from __future__ import annotations

import os
from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic import BaseModel, Field

BASE_DIR = Path(__file__).resolve().parent.parent
PROJECT_ROOT = BASE_DIR.parent

DEFAULT_DOH_ENDPOINTS = ["https://cloudflare-dns.com/dns-query", "https://dns.google/dns-query"]


def _env(name: str, default: str) -> str:
    return os.getenv(f"SMS_{name}", default)


def _env_bool(name: str, default: bool) -> bool:
    return _env(name, str(default)).strip().lower() in {"1", "true", "yes", "on"}


def _env_list(name: str, default: list[str]) -> list[str]:
    raw = os.getenv(f"SMS_{name}")
    if raw is None:
        return list(default)
    return [item.strip() for item in raw.split(",") if item.strip()]


class Settings(BaseModel):
    app_name: str = "SecureMailScope"
    version: str = "0.1.0"
    env: str = "development"
    log_level: str = "INFO"

    cache_path: Path = PROJECT_ROOT / "data" / "cache.sqlite3"
    cache_ttl_seconds: int = Field(default=3600, ge=0)

    # DNS
    dns_mode: Literal["auto", "udp", "doh"] = "auto"
    dns_timeout_seconds: float = Field(default=5.0, gt=0)
    dns_nameservers: list[str] = Field(default_factory=list)
    doh_endpoints: list[str] = Field(default_factory=lambda: list(DEFAULT_DOH_ENDPOINTS))
    dns_rate_per_second: float = Field(default=20.0, gt=0)
    dns_burst: int = Field(default=40, ge=1)

    # HTTP (MTA-STS policy fetch, DoH)
    http_timeout_seconds: float = Field(default=8.0, gt=0)

    # SMTP transport probe
    smtp_probe_enabled: bool = True
    smtp_port: int = Field(default=25, ge=1, le=65535)
    smtp_timeout_seconds: float = Field(default=15.0, gt=0)
    smtp_helo_name: str = "securemailscope.invalid"
    smtp_max_mx_attempts: int = Field(default=2, ge=1)
    # Known-good SMTP host used to tell "port 25 egress blocked" apart from "MX down".
    smtp_egress_probe_host: str = "gmail-smtp-in.l.google.com"

    # Narrative layer. "auto" calls Claude only when credentials are in the environment
    # (ANTHROPIC_API_KEY or ANTHROPIC_AUTH_TOKEN, read by the SDK itself); otherwise, and on
    # any failure, the deterministic writer is used. "none" never calls an LLM.
    llm_provider: Literal["auto", "anthropic", "none"] = "auto"
    llm_model: str = "claude-opus-5"
    llm_timeout_seconds: float = Field(default=90.0, gt=0)
    # Server-side refusal fallback (re-runs a declined request on Anthropic's recommended model).
    llm_fallbacks: bool = True
    llm_credentials_present: bool = False

    # Browser origins allowed to call the API cross-origin (only needed when the React app is
    # hosted separately from the backend; same-origin and the Vite dev proxy need nothing).
    cors_origins: list[str] = Field(default_factory=list)

    templates_dir: Path = BASE_DIR / "templates"
    static_dir: Path = BASE_DIR / "static"

    @classmethod
    def from_env(cls) -> "Settings":
        cache_path = Path(_env("CACHE_PATH", str(PROJECT_ROOT / "data" / "cache.sqlite3")))
        if not cache_path.is_absolute():
            cache_path = PROJECT_ROOT / cache_path
        return cls(
            env=_env("ENV", "development"),
            log_level=_env("LOG_LEVEL", "INFO").upper(),
            cache_path=cache_path,
            cache_ttl_seconds=int(_env("CACHE_TTL_SECONDS", "3600")),
            dns_mode=_env("DNS_MODE", "auto").lower(),  # type: ignore[arg-type]
            dns_timeout_seconds=float(_env("DNS_TIMEOUT_SECONDS", "5.0")),
            dns_nameservers=_env_list("DNS_NAMESERVERS", []),
            doh_endpoints=_env_list("DOH_ENDPOINTS", DEFAULT_DOH_ENDPOINTS),
            dns_rate_per_second=float(_env("DNS_RATE_PER_SECOND", "20")),
            dns_burst=int(_env("DNS_BURST", "40")),
            http_timeout_seconds=float(_env("HTTP_TIMEOUT_SECONDS", "8.0")),
            smtp_probe_enabled=_env_bool("SMTP_PROBE_ENABLED", True),
            smtp_port=int(_env("SMTP_PORT", "25")),
            smtp_timeout_seconds=float(_env("SMTP_TIMEOUT_SECONDS", "15.0")),
            smtp_helo_name=_env("SMTP_HELO_NAME", "securemailscope.invalid"),
            smtp_max_mx_attempts=int(_env("SMTP_MAX_MX_ATTEMPTS", "2")),
            smtp_egress_probe_host=_env("SMTP_EGRESS_PROBE_HOST", "gmail-smtp-in.l.google.com"),
            cors_origins=_env_list("CORS_ORIGINS", []),
            llm_provider=_env("LLM_PROVIDER", "auto").lower(),  # type: ignore[arg-type]
            llm_model=_env("LLM_MODEL", "claude-opus-5"),
            llm_timeout_seconds=float(_env("LLM_TIMEOUT_SECONDS", "90")),
            llm_fallbacks=_env_bool("LLM_FALLBACKS", True),
            llm_credentials_present=bool(os.getenv("ANTHROPIC_API_KEY") or os.getenv("ANTHROPIC_AUTH_TOKEN")),
        )


@lru_cache
def get_settings() -> Settings:
    return Settings.from_env()
