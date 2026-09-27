import dataclasses

import pytest

from app import api_v1, service
from app.cache import ScanCache
from app.protection import Protections


@pytest.fixture(autouse=True)
def isolated_cache(tmp_path, monkeypatch):
    """Every test gets its own empty scan cache (never the real one on disk)."""
    cache = ScanCache(tmp_path / "scans.sqlite3", ttl=900)
    monkeypatch.setattr(service, "cache", cache)
    yield cache
    cache.close()


@pytest.fixture(autouse=True)
def isolated_protections(monkeypatch):
    """Fresh rate limiters per test; the narrative writer never calls the real Claude API."""
    settings = dataclasses.replace(service._settings, llm_provider="none")
    monkeypatch.setattr(service, "_settings", settings)
    monkeypatch.setattr(service, "protect", Protections.from_settings(settings))
    monkeypatch.setattr(api_v1, "_narratives", type(api_v1._narratives)())
    return settings
