"""SQLite storage. One file on disk, no server.

Tables
  estate          simulated network: what each host is actually running (the "truth" the prober sees)
  assets          latest scan results + risk scores
  scans           every CBOM produced, with its SHA-256
  ledger          the tamper-evident hash chain / Merkle log
  ledger_replica  append-only mirror written alongside every block (stands in for a WORM replica)
  attestations    signed tree heads published by /attest/publish
"""

from __future__ import annotations

import json
import os
import sqlite3
import threading
from contextlib import contextmanager
from pathlib import Path

DEFAULT_DB = Path(__file__).resolve().parent.parent / "data" / "quantumledger.db"

SCHEMA = """
CREATE TABLE IF NOT EXISTS estate (
    id TEXT PRIMARY KEY,
    host TEXT NOT NULL,
    port INTEGER NOT NULL,
    protocol TEXT NOT NULL,
    service TEXT NOT NULL,
    signature_alg TEXT NOT NULL,
    key_exchange TEXT NOT NULL,
    exposure TEXT NOT NULL,
    shelf_life_years REAL NOT NULL,
    migration_years REAL NOT NULL,
    asset_type TEXT NOT NULL DEFAULT 'generic'
);
CREATE TABLE IF NOT EXISTS assets (
    id TEXT PRIMARY KEY,
    host TEXT NOT NULL,
    port INTEGER NOT NULL,
    protocol TEXT NOT NULL,
    service TEXT NOT NULL,
    signature_alg TEXT NOT NULL,
    key_exchange TEXT NOT NULL,
    exposure TEXT NOT NULL,
    handshake TEXT NOT NULL,
    status TEXT,
    risk_score REAL,
    mosca TEXT,
    scanned_at TEXT NOT NULL,
    severity TEXT,
    cwm TEXT
);
CREATE TABLE IF NOT EXISTS scans (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ts TEXT NOT NULL,
    cbom TEXT NOT NULL,
    cbom_sha256 TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS ledger (
    idx INTEGER PRIMARY KEY,
    ts TEXT NOT NULL,
    kind TEXT NOT NULL,
    payload TEXT NOT NULL,
    payload_hash TEXT NOT NULL,
    prev_hash TEXT NOT NULL,
    merkle_root TEXT NOT NULL,
    block_hash TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS ledger_replica (
    idx INTEGER PRIMARY KEY,
    ts TEXT NOT NULL,
    kind TEXT NOT NULL,
    payload TEXT NOT NULL,
    payload_hash TEXT NOT NULL,
    prev_hash TEXT NOT NULL,
    merkle_root TEXT NOT NULL,
    block_hash TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS attestations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ts TEXT NOT NULL,
    tree_size INTEGER NOT NULL,
    root_hash TEXT NOT NULL,
    sth TEXT NOT NULL
);
"""


class Database:
    """Thin wrapper: one connection, serialised by a lock (the app is single-user)."""

    def __init__(self, path: str | os.PathLike | None = None):
        self.path = Path(path or os.environ.get("QL_DB", DEFAULT_DB))
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._conn = sqlite3.connect(self.path, check_same_thread=False)
        self._conn.row_factory = sqlite3.Row
        self._conn.execute("PRAGMA journal_mode=WAL")
        self._conn.executescript(SCHEMA)
        self._migrate()
        self._lock = threading.RLock()

    # Columns added after the first release; ALTER TABLE brings older databases up to date.
    _ADDED_COLUMNS = {
        "estate": {"asset_type": "TEXT NOT NULL DEFAULT 'generic'"},
        "assets": {"severity": "TEXT", "cwm": "TEXT"},
    }

    def _migrate(self) -> None:
        for table, columns in self._ADDED_COLUMNS.items():
            existing = {r[1] for r in self._conn.execute(f"PRAGMA table_info({table})")}
            for name, decl in columns.items():
                if name not in existing:
                    self._conn.execute(f"ALTER TABLE {table} ADD COLUMN {name} {decl}")
        self._conn.commit()

    @contextmanager
    def tx(self):
        with self._lock:
            try:
                yield self._conn
                self._conn.commit()
            except Exception:
                self._conn.rollback()
                raise

    def query(self, sql: str, params: tuple = ()) -> list[dict]:
        with self._lock:
            return [dict(r) for r in self._conn.execute(sql, params).fetchall()]

    def one(self, sql: str, params: tuple = ()) -> dict | None:
        rows = self.query(sql, params)
        return rows[0] if rows else None

    def reset(self) -> None:
        with self.tx() as c:
            for table in ("estate", "assets", "scans", "ledger", "ledger_replica", "attestations"):
                c.execute(f"DELETE FROM {table}")


def dumps(obj) -> str:
    return json.dumps(obj, sort_keys=True, separators=(",", ":"))
