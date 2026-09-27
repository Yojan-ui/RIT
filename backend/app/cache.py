"""SQLite-backed TTL cache of scan observations; also the source of "recent scans".

Stores the raw Observations (plus scan time), not the judged report, so a
cached scan is re-analysed with the current rules when it is served. Uses the
stdlib sqlite3 module; blocking calls run in a worker thread.
"""

from __future__ import annotations

import asyncio
import json
import sqlite3
import time
from pathlib import Path
from typing import Any

_SCHEMA = """
CREATE TABLE IF NOT EXISTS scans (
    domain      TEXT PRIMARY KEY,
    payload     TEXT NOT NULL,
    created_at  REAL NOT NULL,
    expires_at  REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_scans_created ON scans (created_at);
"""


class ScanCache:
    def __init__(self, path: Path | str, ttl: int = 900) -> None:
        self.path = path
        self.ttl = ttl
        self._conn: sqlite3.Connection | None = None
        self._lock = asyncio.Lock()

    def _connection(self) -> sqlite3.Connection:
        # Connect lazily so the app (and tests) work without a startup hook.
        if self._conn is None:
            if str(self.path) != ":memory:":
                Path(self.path).parent.mkdir(parents=True, exist_ok=True)
            self._conn = sqlite3.connect(str(self.path), check_same_thread=False)
            self._conn.execute("PRAGMA journal_mode=WAL")
            self._conn.executescript(_SCHEMA)
        return self._conn

    async def _run(self, fn, *args):
        async with self._lock:
            return await asyncio.to_thread(fn, *args)

    async def get(self, domain: str) -> dict[str, Any] | None:
        return await self._run(self._get, domain.lower())

    def _get(self, domain: str) -> dict[str, Any] | None:
        conn = self._connection()
        row = conn.execute("SELECT payload, expires_at FROM scans WHERE domain = ?", (domain,)).fetchone()
        if row is None:
            return None
        if row[1] <= time.time():
            conn.execute("DELETE FROM scans WHERE domain = ?", (domain,))
            conn.commit()
            return None
        return json.loads(row[0])

    async def put(self, domain: str, payload: dict[str, Any]) -> None:
        await self._run(self._put, domain.lower(), payload)

    def _put(self, domain: str, payload: dict[str, Any]) -> None:
        now = time.time()
        conn = self._connection()
        conn.execute(
            "INSERT OR REPLACE INTO scans (domain, payload, created_at, expires_at) VALUES (?, ?, ?, ?)",
            (domain, json.dumps(payload, default=str), now, now + self.ttl),
        )
        conn.commit()

    async def recent(self, limit: int = 10) -> list[dict[str, Any]]:
        return await self._run(self._recent, limit)

    def _recent(self, limit: int) -> list[dict[str, Any]]:
        rows = self._connection().execute(
            "SELECT domain, payload, created_at FROM scans WHERE expires_at > ? ORDER BY created_at DESC LIMIT ?",
            (time.time(), limit),
        ).fetchall()
        return [{"domain": d, "payload": json.loads(p), "created_at": c} for d, p, c in rows]

    def close(self) -> None:
        if self._conn is not None:
            self._conn.close()
            self._conn = None
