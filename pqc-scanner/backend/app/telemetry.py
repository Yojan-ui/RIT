"""Scan telemetry: every probe step is logged to the `pqc.scan` logger and, while a
streaming request is bound, forwarded to that client as a structured event.

The sink lives in a context variable, so concurrent scans (each on its own worker
thread) only ever see their own events.
"""

from __future__ import annotations

import contextvars
import logging
import time
from collections.abc import Callable
from typing import Any

log = logging.getLogger("pqc.scan")

Sink = Callable[[dict[str, Any]], None]
_sink: contextvars.ContextVar[Sink | None] = contextvars.ContextVar("pqc_telemetry_sink", default=None)


def emit(stage: str, msg: str, level: int = logging.INFO, **data: Any) -> None:
    log.log(level, "[%s] %s", stage, msg)
    sink = _sink.get()
    if sink:
        event: dict[str, Any] = {"t": time.time(), "level": logging.getLevelName(level), "logger": log.name, "stage": stage, "msg": msg}
        if data:
            event["data"] = data
        sink(event)


def bind(sink: Sink) -> contextvars.Token:
    return _sink.set(sink)


def unbind(token: contextvars.Token) -> None:
    _sink.reset(token)


def hexdump(b: bytes, n: int = 16) -> str:
    return " ".join(f"{x:02x}" for x in b[:n]) + (" …" if len(b) > n else "")
