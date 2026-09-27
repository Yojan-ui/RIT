"""Guard against using the scanner to reach private networks (SSRF)."""

from __future__ import annotations

import ipaddress
import socket


class PrivateTargetError(Exception):
    pass


def is_public_ip(address: str) -> bool:
    try:
        return ipaddress.ip_address(address).is_global
    except ValueError:
        return False


def ensure_public_host(hostname: str, port: int) -> None:
    """Raise if *any* address the hostname resolves to is non-public.

    Note: a DNS-rebinding attacker can still race between this check and the
    connection; the SMTP probe avoids that by connecting to a pre-vetted IP.
    """
    infos = socket.getaddrinfo(hostname, port, proto=socket.IPPROTO_TCP)
    addresses = {info[4][0] for info in infos}
    if not addresses or not all(is_public_ip(a) for a in addresses):
        raise PrivateTargetError(f"{hostname} resolves to a non-public address")
