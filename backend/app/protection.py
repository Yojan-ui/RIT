"""Abuse protection for a public deployment: per-client rate limits, a cap on concurrent
scans with coalescing of duplicate requests, and a daily budget for paid Claude calls.

All state is in-process, which matches the single-worker deployment (the Dockerfile runs one Uvicorn
worker). Running several workers multiplies every limit by the worker count.
"""

from __future__ import annotations

import asyncio
import math
import time
from collections import OrderedDict
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import TypeVar

from app.config import Settings

T = TypeVar("T")


class RateLimited(Exception):
    def __init__(self, retry_after: int, message: str) -> None:
        super().__init__(message)
        self.retry_after = retry_after


class ServerBusy(Exception):
    """Too many scans are already running and the wait for a slot timed out."""


@dataclass
class _Bucket:
    tokens: float
    updated: float


class ClientLimiter:
    """Non-blocking token bucket per client key: callers are refused, never queued.

    Bounded memory: the least recently seen clients are dropped past ``max_clients``.
    """

    def __init__(self, per_minute: float, burst: int, *, max_clients: int = 10_000, clock: Callable[[], float] = time.monotonic) -> None:
        self.rate = per_minute / 60.0
        self.burst = float(burst)
        self.max_clients = max_clients
        self._clock = clock
        self._buckets: OrderedDict[str, _Bucket] = OrderedDict()

    def take(self, key: str) -> float:
        """Spend one token. Returns 0 when allowed, else the seconds until one is available."""
        now = self._clock()
        bucket = self._buckets.pop(key, None) or _Bucket(self.burst, now)
        bucket.tokens = min(self.burst, bucket.tokens + (now - bucket.updated) * self.rate)
        bucket.updated = now
        self._buckets[key] = bucket
        while len(self._buckets) > self.max_clients:
            self._buckets.popitem(last=False)
        if bucket.tokens >= 1:
            bucket.tokens -= 1
            return 0.0
        return (1 - bucket.tokens) / self.rate


class DailyBudget:
    """Counts uses per UTC day; ``limit`` 0 means unlimited."""

    def __init__(self, limit: int, *, today: Callable[[], str] = lambda: datetime.now(timezone.utc).date().isoformat()) -> None:
        self.limit = limit
        self._today = today
        self._day = today()
        self.used = 0

    def try_spend(self) -> bool:
        day = self._today()
        if day != self._day:
            self._day, self.used = day, 0
        if self.limit and self.used >= self.limit:
            return False
        self.used += 1
        return True


@dataclass
class ScanGate:
    """At most ``max_concurrent`` scans at once; identical concurrent requests share one scan."""

    max_concurrent: int
    queue_timeout: float
    _slots: asyncio.Semaphore = field(init=False)
    _inflight: dict[object, asyncio.Future] = field(default_factory=dict, init=False)

    def __post_init__(self) -> None:
        self._slots = asyncio.Semaphore(self.max_concurrent)

    async def run(self, key: object, scan: Callable[[], Awaitable[T]]) -> T:
        if (pending := self._inflight.get(key)) is not None:
            return await asyncio.shield(pending)
        future: asyncio.Future = asyncio.get_running_loop().create_future()
        self._inflight[key] = future
        try:
            try:
                await asyncio.wait_for(self._slots.acquire(), self.queue_timeout)
            except TimeoutError as exc:
                raise ServerBusy("The scanner is busy with other scans. Try again in a moment.") from exc
            try:
                result = await scan()
            finally:
                self._slots.release()
            future.set_result(result)
            return result
        except BaseException as exc:
            if not future.done():
                if isinstance(exc, asyncio.CancelledError):
                    future.cancel()
                else:
                    future.set_exception(exc)
                    future.exception()  # mark retrieved: waiters re-raise it, nobody else needs to
            raise
        finally:
            self._inflight.pop(key, None)


@dataclass
class Protections:
    api: ClientLimiter
    scans: ClientLimiter
    gate: ScanGate
    llm_budget: DailyBudget

    @classmethod
    def from_settings(cls, s: Settings) -> Protections:
        return cls(
            api=ClientLimiter(s.api_rate_per_minute, s.api_burst),
            scans=ClientLimiter(s.scan_rate_per_minute, s.scan_burst),
            gate=ScanGate(s.max_concurrent_scans, s.scan_queue_timeout),
            llm_budget=DailyBudget(s.llm_daily_budget),
        )

    def check_scan(self, client: str) -> None:
        if wait := self.scans.take(client):
            seconds = max(1, math.ceil(wait))
            raise RateLimited(seconds, f"Too many new scans from your address. Try again in {seconds} seconds.")
