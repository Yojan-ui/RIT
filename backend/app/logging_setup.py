"""Logging setup."""

from __future__ import annotations

import json
import logging
import sys
from datetime import datetime, timezone

_FORMAT = "%(asctime)s | %(levelname)-8s | %(name)s | %(message)s"


# Standard LogRecord attributes; anything else on a record came from `extra=` and is emitted as a field.
_RESERVED = set(logging.makeLogRecord({}).__dict__) | {"message", "asctime"}


class JsonFormatter(logging.Formatter):
    """One JSON object per line: ts, level, logger, msg, plus any `extra=` fields."""

    def format(self, record: logging.LogRecord) -> str:
        entry = {
            "ts": datetime.fromtimestamp(record.created, timezone.utc).isoformat(timespec="milliseconds"),
            "level": record.levelname.lower(),
            "logger": record.name,
            "msg": record.getMessage(),
        }
        entry.update({k: v for k, v in record.__dict__.items() if k not in _RESERVED and not k.startswith("_")})
        if record.exc_info:
            entry["exc"] = self.formatException(record.exc_info)
        return json.dumps(entry, default=str)


def configure_logging(level: str = "INFO", fmt: str = "text") -> None:
    root = logging.getLogger()
    formatter = JsonFormatter() if fmt == "json" else logging.Formatter(_FORMAT)
    for h in root.handlers:
        if getattr(h, "_securemailscope", False):
            h.setFormatter(formatter)
            root.setLevel(level)
            return
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(formatter)
    handler._securemailscope = True  # type: ignore[attr-defined]
    root.addHandler(handler)
    root.setLevel(level)
    if fmt == "json":
        # uvicorn installs its own plain-text handlers; route its records through ours instead so
        # every line in a JSON log parses as JSON. A logger uvicorn has switched off (e.g. the
        # access log under --no-access-log has no handlers) stays off.
        for name in ("uvicorn", "uvicorn.error", "uvicorn.access"):
            lg = logging.getLogger(name)
            if lg.handlers:
                lg.handlers.clear()
                lg.propagate = True
    # httpx logs every request at INFO (DoH queries, MTA-STS fetches); keep that out of the app log.
    for noisy in ("httpx", "httpcore"):
        logging.getLogger(noisy).setLevel(max(logging.WARNING, root.level))


def get_logger(name: str) -> logging.Logger:
    return logging.getLogger(f"securemailscope.{name}")
