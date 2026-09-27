import pytest

from app.domain import InvalidDomain, normalize_domain, parse_selectors


@pytest.mark.parametrize("raw, expected", [
    ("Example.COM", "example.com"),
    ("https://www.example.com/path?q=1", "www.example.com"),
    ("alice@example.co.uk", "example.co.uk"),
    ("example.com.", "example.com"),
    ("bücher.example", "xn--bcher-kva.example"),
])
def test_normalize_domain(raw, expected):
    assert normalize_domain(raw) == expected


@pytest.mark.parametrize("raw", ["", "localhost", "192.0.2.1", "-bad.example", "a..b", "exa mple.com", "1.2.3.4"])
def test_normalize_domain_rejects(raw):
    with pytest.raises(InvalidDomain):
        normalize_domain(raw)


def test_parse_selectors():
    assert parse_selectors("s1, Google ,") == ["s1", "google"]
    with pytest.raises(InvalidDomain):
        parse_selectors("bad selector")
