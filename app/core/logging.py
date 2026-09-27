"""Logging setup."""

from __future__ import annotations

import logging
import sys

_FORMAT = "%(asctime)s | %(levelname)-8s | %(name)s | %(message)s"


def configure_logging(level: str = "INFO") -> None:
    root = logging.getLogger()
    if any(getattr(h, "_securemailscope", False) for h in root.handlers):
        root.setLevel(level)
        return
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(logging.Formatter(_FORMAT))
    handler._securemailscope = True  # type: ignore[attr-defined]
    root.addHandler(handler)
    root.setLevel(level)
    # httpx logs every request at INFO (DoH queries, MTA-STS fetches); keep that out of the app log.
    for noisy in ("httpx", "httpcore"):
        logging.getLogger(noisy).setLevel(max(logging.WARNING, root.level))


def get_logger(name: str) -> logging.Logger:
    return logging.getLogger(f"securemailscope.{name}")
