"""Pure parsers for the record formats we evaluate. No network access."""

from __future__ import annotations

import base64
import binascii
import re
from dataclasses import dataclass, field


def has_version(record: str, version: str) -> bool:
    """True if the record starts with `v=<version>` (case-insensitive)."""
    return re.match(rf"^\s*v\s*=\s*{re.escape(version)}(\s|;|$)", record, re.IGNORECASE) is not None


def parse_tags(record: str) -> dict[str, str]:
    """Parse `k=v; k2=v2` tag lists (DMARC, DKIM, MTA-STS TXT, TLS-RPT). First key wins."""
    tags: dict[str, str] = {}
    for part in record.split(";"):
        if "=" not in part:
            continue
        key, value = part.split("=", 1)
        key = key.strip().lower()
        if key and key not in tags:
            tags[key] = value.strip()
    return tags


@dataclass
class SpfRecord:
    raw: str
    mechanisms: list[str] = field(default_factory=list)  # every term except all/redirect
    all_qualifier: str | None = None  # "+", "-", "~", "?" or None if absent
    redirect: str | None = None


def parse_spf(raw: str) -> SpfRecord:
    record = SpfRecord(raw=raw)
    for term in raw.split()[1:]:
        lower = term.lower()
        if lower.startswith("redirect="):
            record.redirect = term.split("=", 1)[1]
            continue
        qualifier = term[0] if term[0] in "+-~?" else "+"
        body = term[1:] if term[0] in "+-~?" else term
        if body.lower() == "all":
            record.all_qualifier = qualifier
        else:
            record.mechanisms.append(term)
    return record


def estimate_dkim_key_bits(tags: dict[str, str]) -> int | None:
    """Estimate key size from the base64 public key in `p=`.

    RSA SubjectPublicKeyInfo carries ~38 bytes of DER overhead; the rest is the
    modulus + exponent, so (len - 38) * 8 rounded to 512 gives the key size
    (294 bytes -> 2048, 162 -> 1024, 550 -> 4096).
    """
    if tags.get("k", "rsa").lower() == "ed25519":
        return 256
    try:
        der = base64.b64decode(re.sub(r"\s+", "", tags.get("p", "")), validate=True)
    except (binascii.Error, ValueError):
        return None
    if len(der) <= 38:
        return None
    return max(512, round((len(der) - 38) * 8 / 512) * 512)


@dataclass
class MtaStsPolicy:
    version: str | None = None
    mode: str | None = None
    mx: list[str] = field(default_factory=list)
    max_age: int | None = None


def parse_mta_sts_policy(text: str) -> MtaStsPolicy:
    policy = MtaStsPolicy()
    for line in text.splitlines():
        if ":" not in line:
            continue
        key, value = (part.strip() for part in line.split(":", 1))
        key = key.lower()
        if key == "version":
            policy.version = value
        elif key == "mode":
            policy.mode = value.lower()
        elif key == "mx":
            policy.mx.append(value.lower().rstrip("."))
        elif key == "max_age":
            try:
                policy.max_age = int(value)
            except ValueError:
                policy.max_age = None
    return policy


def mx_matches_pattern(host: str, pattern: str) -> bool:
    """RFC 8461 §4.1: `*.example.com` matches exactly one extra leftmost label."""
    host = host.lower().rstrip(".")
    pattern = pattern.lower().rstrip(".")
    if pattern.startswith("*."):
        head, _, rest = host.partition(".")
        return bool(head) and rest == pattern[2:]
    return host == pattern
