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
    cors_origins: list[str] = field(
        default_factory=lambda: _csv("CORS_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173")
    )


@lru_cache
def get_settings() -> Settings:
    return Settings()
