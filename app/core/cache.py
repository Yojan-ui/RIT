"""SQLite-backed TTL cache for recent domain lookups.

Uses the stdlib ``sqlite3`` module; blocking calls are pushed to a worker thread
via ``asyncio.to_thread`` so the event loop is never blocked.
"""

from __future__ import annotations

import asyncio
import json
import sqlite3
import time
from pathlib import Path
from typing import Any

from app.core.logging import get_logger

log = get_logger("cache")

_SCHEMA = """
CREATE TABLE IF NOT EXISTS domain_cache (
    domain      TEXT PRIMARY KEY,
    payload     TEXT    NOT NULL,
    created_at  REAL    NOT NULL,
    expires_at  REAL    NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_domain_cache_expires ON domain_cache (expires_at);
"""


class DomainCache:
    def __init__(self, path: Path | str, default_ttl: int = 3600) -> None:
        self.path = Path(path) if str(path) != ":memory:" else path
        self.default_ttl = default_ttl
        self._conn: sqlite3.Connection | None = None
        self._lock = asyncio.Lock()

    # -- lifecycle -----------------------------------------------------------
    async def connect(self) -> None:
        await asyncio.to_thread(self._connect_sync)
        log.info("cache ready at %s (ttl=%ss)", self.path, self.default_ttl)

    def _connect_sync(self) -> None:
        if isinstance(self.path, Path):
            self.path.parent.mkdir(parents=True, exist_ok=True)
        self._conn = sqlite3.connect(str(self.path), check_same_thread=False)
        self._conn.execute("PRAGMA journal_mode=WAL")
        self._conn.executescript(_SCHEMA)
        self._conn.commit()

    async def close(self) -> None:
        if self._conn is not None:
            await asyncio.to_thread(self._conn.close)
            self._conn = None

    @property
    def conn(self) -> sqlite3.Connection:
        if self._conn is None:
            raise RuntimeError("DomainCache used before connect()")
        return self._conn

    # -- operations ----------------------------------------------------------
    async def get(self, domain: str) -> dict[str, Any] | None:
        async with self._lock:
            return await asyncio.to_thread(self._get_sync, domain.lower())

    def _get_sync(self, domain: str) -> dict[str, Any] | None:
        row = self.conn.execute(
            "SELECT payload, expires_at FROM domain_cache WHERE domain = ?", (domain,)
        ).fetchone()
        if row is None:
            return None
        payload, expires_at = row
        if expires_at <= time.time():
            self.conn.execute("DELETE FROM domain_cache WHERE domain = ?", (domain,))
            self.conn.commit()
            return None
        return json.loads(payload)

    async def set(self, domain: str, payload: dict[str, Any], ttl: int | None = None) -> None:
        ttl = self.default_ttl if ttl is None else ttl
        async with self._lock:
            await asyncio.to_thread(self._set_sync, domain.lower(), payload, ttl)

    def _set_sync(self, domain: str, payload: dict[str, Any], ttl: int) -> None:
        now = time.time()
        self.conn.execute(
            "INSERT OR REPLACE INTO domain_cache (domain, payload, created_at, expires_at) "
            "VALUES (?, ?, ?, ?)",
            (domain, json.dumps(payload, default=str), now, now + ttl),
        )
        self.conn.commit()

    async def recent(self, limit: int = 10) -> list[dict[str, Any]]:
        async with self._lock:
            return await asyncio.to_thread(self._recent_sync, limit)

    def _recent_sync(self, limit: int) -> list[dict[str, Any]]:
        rows = self.conn.execute(
            "SELECT domain, created_at, expires_at FROM domain_cache "
            "WHERE expires_at > ? ORDER BY created_at DESC LIMIT ?",
            (time.time(), limit),
        ).fetchall()
        return [{"domain": d, "created_at": c, "expires_at": e} for d, c, e in rows]

    async def purge_expired(self) -> int:
        async with self._lock:
            return await asyncio.to_thread(self._purge_sync)

    def _purge_sync(self) -> int:
        cur = self.conn.execute("DELETE FROM domain_cache WHERE expires_at <= ?", (time.time(),))
        self.conn.commit()
        return cur.rowcount
