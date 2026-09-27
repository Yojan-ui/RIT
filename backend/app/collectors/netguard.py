"""Outbound connection guard against server-side request forgery (SSRF).

Anyone can ask the scanner to check any domain, and that domain's DNS decides where the
scanner connects: its MX hosts (SMTP probe) and ``mta-sts.<domain>`` (policy fetch). Without
a guard, a domain whose MX points at 127.0.0.1, 10.0.0.5 or the cloud metadata address
169.254.169.254 turns the scanner into a proxy into its own network.

Callers resolve once, check every address, and then connect to a validated IP (never
re-resolving the name), which closes the DNS-rebinding window; TLS still verifies against
the original hostname.
"""

from __future__ import annotations

import ipaddress
import socket


class PrivateTargetError(Exception):
    pass


def is_public_ip(address: str) -> bool:
    try:
        ip = ipaddress.ip_address(address.split("%", 1)[0])
    except ValueError:
        return False
    if isinstance(ip, ipaddress.IPv6Address) and ip.ipv4_mapped is not None:
        ip = ip.ipv4_mapped  # ::ffff:10.0.0.1 is 10.0.0.1
    return ip.is_global and not ip.is_multicast


def resolve_public(hostname: str, port: int, *, allow_private: bool = False) -> list[str]:
    """Resolve ``hostname`` and return its addresses, all validated, or raise PrivateTargetError.

    Every address must be public: a mix would let an attacker pair a decoy public address
    with an internal one.
    """
    try:
        infos = socket.getaddrinfo(hostname, port, proto=socket.IPPROTO_TCP)
    except socket.gaierror as exc:
        raise PrivateTargetError(f"{hostname} does not resolve ({exc.strerror or exc})") from exc
    addresses = list(dict.fromkeys(info[4][0] for info in infos))
    if not addresses:
        raise PrivateTargetError(f"{hostname} does not resolve")
    if not allow_private:
        internal = [a for a in addresses if not is_public_ip(a)]
        if internal:
            raise PrivateTargetError(f"{hostname} resolves to a non-public address ({internal[0]})")
    return addresses
