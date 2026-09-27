"""Runtime settings, read once from environment variables."""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path


def _bool(name: str, default: bool) -> bool:
    raw = os.getenv(name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


def _csv(name: str, default: str) -> list[str]:
    return [item.strip() for item in os.getenv(name, default).split(",") if item.strip()]


@dataclass(frozen=True)
class Settings:
    dns_timeout: float = float(os.getenv("DNS_TIMEOUT", "4"))
    smtp_timeout: float = float(os.getenv("SMTP_TIMEOUT", "8"))
    http_timeout: float = float(os.getenv("HTTP_TIMEOUT", "5"))
    # Budgets for the slow, sequential parts, and a hard ceiling on a whole scan.
    spf_walk_budget: float = float(os.getenv("SPF_WALK_BUDGET", "10"))
    probe_budget: float = float(os.getenv("PROBE_BUDGET", "20"))
    scan_timeout: float = float(os.getenv("SCAN_TIMEOUT", "30"))
    ehlo_hostname: str = os.getenv("EHLO_HOSTNAME", "scanner.securemailscope.local")
    # Refuse to open sockets to private/loopback/link-local targets unless set.
    # A public scanner that follows attacker-controlled MX records is an SSRF
    # vector otherwise.
    allow_private_targets: bool = _bool("ALLOW_PRIVATE_TARGETS", False)
    static_dir: Path = Path(os.getenv("STATIC_DIR", str(Path(__file__).resolve().parent.parent / "static")))
    # Scan cache (SQLite). Also backs /api/v1/recent. Mount a volume at its
    # directory in Docker to keep it across container restarts.
    cache_path: Path = Path(os.getenv("CACHE_PATH", str(Path(__file__).resolve().parent.parent / "data" / "scans.sqlite3")))
    cache_ttl: int = int(os.getenv("CACHE_TTL", "900"))

    # Abuse protection (in-process: run a single Uvicorn worker, or every limit
    # is multiplied by the worker count). Keyed by client IP.
    api_rate_per_minute: float = float(os.getenv("API_RATE_PER_MINUTE", "120"))
    api_burst: int = int(os.getenv("API_BURST", "60"))
    # New live scans (each one opens port-25 and HTTPS connections). Cache hits
    # and the built-in demo domains are not counted.
    scan_rate_per_minute: float = float(os.getenv("SCAN_RATE_PER_MINUTE", "10"))
    scan_burst: int = int(os.getenv("SCAN_BURST", "8"))
    max_concurrent_scans: int = int(os.getenv("MAX_CONCURRENT_SCANS", "8"))
    scan_queue_timeout: float = float(os.getenv("SCAN_QUEUE_TIMEOUT", "20"))

    # Claude-written narratives. "auto" uses Claude when ANTHROPIC_API_KEY (or
    # ANTHROPIC_AUTH_TOKEN) is set; "anthropic" lets the SDK resolve credentials
    # itself (e.g. an `ant auth login` profile); "none" always uses the rule-based writer.
    llm_provider: str = os.getenv("LLM_PROVIDER", "auto").lower()
    llm_model: str = os.getenv("LLM_MODEL", "claude-opus-5")
    llm_timeout: float = float(os.getenv("LLM_TIMEOUT", "90"))
    llm_fallbacks: bool = _bool("LLM_FALLBACKS", True)
    llm_daily_budget: int = int(os.getenv("LLM_DAILY_BUDGET", "300"))  # 0 = unlimited
    llm_credentials_present: bool = bool(os.getenv("ANTHROPIC_API_KEY") or os.getenv("ANTHROPIC_AUTH_TOKEN"))

    log_level: str = os.getenv("LOG_LEVEL", "INFO").upper()
    log_format: str = os.getenv("LOG_FORMAT", "text").lower()  # "text" or "json"
    cors_origins: list[str] = field(
        default_factory=lambda: _csv("CORS_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173")
    )


@lru_cache
def get_settings() -> Settings:
    return Settings()
