import pytest

from app import service
from app.cache import ScanCache


@pytest.fixture(autouse=True)
def isolated_cache(tmp_path, monkeypatch):
    """Every test gets its own empty scan cache (never the real one on disk)."""
    cache = ScanCache(tmp_path / "scans.sqlite3", ttl=900)
    monkeypatch.setattr(service, "cache", cache)
    yield cache
    cache.close()
