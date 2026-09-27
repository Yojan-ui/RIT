"""Input normalisation: turn whatever the user pasted into a bare domain."""

from __future__ import annotations

import ipaddress
import re

_LABEL = re.compile(r"^(?!-)[a-z0-9-]{1,63}(?<!-)$")
_SELECTOR = re.compile(r"^[a-z0-9](?:[a-z0-9._-]{0,62})$")


class InvalidDomain(ValueError):
    pass


def normalize_domain(raw: str) -> str:
    """Accept 'Example.com', 'https://example.com/path', 'user@example.com'.

    Returns the lower-case ASCII (IDNA/punycode) form or raises InvalidDomain.
    """
    value = raw.strip().lower()
    if "://" in value:
        value = value.split("://", 1)[1]
    value = value.split("/", 1)[0].split("?", 1)[0].split("#", 1)[0]
    if "@" in value:
        value = value.rsplit("@", 1)[1]
    value = value.split(":", 1)[0].rstrip(".")

    if not value:
        raise InvalidDomain("Enter a domain such as example.com")
    try:
        ipaddress.ip_address(value)
    except ValueError:
        pass
    else:
        raise InvalidDomain("IP addresses are not supported; enter a domain name")

    try:
        ascii_value = value.encode("idna").decode("ascii")
    except UnicodeError as exc:
        raise InvalidDomain(f"'{raw.strip()}' is not a valid domain name") from exc

    labels = ascii_value.split(".")
    if len(ascii_value) > 253 or len(labels) < 2 or not all(_LABEL.match(label) for label in labels):
        raise InvalidDomain(f"'{raw.strip()}' is not a valid domain name")
    if labels[-1].isdigit():
        raise InvalidDomain(f"'{raw.strip()}' is not a valid domain name")
    return ascii_value


def parse_selectors(raw: str | None) -> list[str]:
    """Parse a comma-separated list of extra DKIM selectors."""
    if not raw:
        return []
    selectors = []
    for item in raw.split(","):
        item = item.strip().lower()
        if not item:
            continue
        if not _SELECTOR.match(item):
            raise InvalidDomain(f"'{item}' is not a valid DKIM selector")
        selectors.append(item)
    if len(selectors) > 10:
        raise InvalidDomain("At most 10 custom DKIM selectors are allowed")
    return selectors
