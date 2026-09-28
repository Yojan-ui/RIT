"""Input validation and SSRF protection.

A scan target must be a public DNS hostname. We resolve it once, refuse it if
*any* address is non-public (loopback, RFC 1918, link-local, CGNAT, multicast,
reserved, ...), and then connect to that exact vetted IP. Pinning the IP means
a second DNS answer (DNS rebinding) can't redirect the connection inward.
"""

from __future__ import annotations

import ipaddress
import re
import socket
from dataclasses import dataclass
from urllib.parse import urlsplit

LABEL = re.compile(r"^(?!-)[a-z0-9-]{1,63}(?<!-)$")
BLOCKED_SUFFIXES = (".localhost", ".local", ".internal", ".intranet", ".lan", ".home", ".corp", ".arpa", ".test", ".invalid", ".example")


class TargetError(ValueError):
    """The requested target is malformed or not allowed."""


@dataclass(frozen=True)
class Target:
    hostname: str  # normalised ASCII (punycode) hostname, used for SNI
    ip: str  # the vetted public address we will connect to
    family: int


def normalise_hostname(raw: str) -> str:
    """Accept 'example.com', 'https://example.com/path', 'Example.COM.' and IDNs; return the ASCII hostname."""
    value = (raw or "").strip()
    if not value:
        raise TargetError("Enter a domain name.")
    if len(value) > 2048:
        raise TargetError("Input is too long.")
    if "://" not in value:
        value = "//" + value
    try:
        parts = urlsplit(value)
    except ValueError as e:
        raise TargetError("That doesn't look like a domain name.") from e
    if parts.username or parts.password:
        raise TargetError("Credentials in the URL are not allowed.")
    if parts.port not in (None, 443):
        raise TargetError("Only port 443 is scanned.")
    host = (parts.hostname or "").rstrip(".")
    if not host:
        raise TargetError("That doesn't look like a domain name.")

    try:
        ipaddress.ip_address(host.strip("[]"))
    except ValueError:
        pass
    else:
        raise TargetError("Enter a domain name, not an IP address.")

    try:
        host = host.encode("idna").decode("ascii").lower()
    except UnicodeError as e:
        raise TargetError("Invalid internationalised domain name.") from e

    if host == "localhost" or host.endswith(BLOCKED_SUFFIXES):
        raise TargetError("Internal and reserved domains can't be scanned.")
    if len(host) > 253 or "." not in host:
        raise TargetError("Enter a fully qualified domain, e.g. cloudflare.com.")
    labels = host.split(".")
    if not all(LABEL.match(label) for label in labels) or labels[-1].isdigit():
        raise TargetError("That doesn't look like a valid domain name.")
    return host


def is_public(ip: str) -> bool:
    addr = ipaddress.ip_address(ip)
    if isinstance(addr, ipaddress.IPv6Address) and addr.ipv4_mapped:
        addr = addr.ipv4_mapped
    return addr.is_global and not addr.is_multicast


def resolve_public(hostname: str) -> Target:
    """Resolve and vet. Raises TargetError if it can't resolve or anything resolves to a non-public address."""
    try:
        infos = socket.getaddrinfo(hostname, 443, type=socket.SOCK_STREAM)
    except socket.gaierror as e:
        raise TargetError(f"Could not resolve {hostname}.") from e
    addrs = []
    for family, _, _, _, sockaddr in infos:
        ip = sockaddr[0]
        if not is_public(ip):
            raise TargetError(f"{hostname} resolves to a non-public address ({ip}); refusing to scan.")
        addrs.append((family, ip))
    if not addrs:
        raise TargetError(f"Could not resolve {hostname}.")
    # Prefer IPv4 for reachability from typical PaaS hosts.
    family, ip = sorted(addrs, key=lambda a: a[0] != socket.AF_INET)[0]
    return Target(hostname=hostname, ip=ip, family=family)


def validate(raw: str) -> Target:
    return resolve_public(normalise_hostname(raw))
