"""Fetch an MTA-STS policy file (RFC 8461 §3.3) without an SSRF or DNS-rebinding window.

The policy host is resolved once, every address is checked (netguard), and the HTTPS
connection is made to that validated IP, with SNI and certificate verification still
against ``mta-sts.<domain>``. Redirects are not followed (RFC 8461 §3.3).
"""

from __future__ import annotations

import http.client
import socket
import ssl

from app.collectors.netguard import PrivateTargetError, resolve_public

_MAX_POLICY_BYTES = 64 * 1024
_PATH = "/.well-known/mta-sts.txt"


class PolicyFetchError(Exception):
    pass


class _PinnedHTTPSConnection(http.client.HTTPSConnection):
    """HTTPS to a pre-validated IP; TLS SNI and hostname checks use the real host name."""

    def __init__(self, host: str, ip: str, *, timeout: float, context: ssl.SSLContext) -> None:
        super().__init__(host, 443, timeout=timeout, context=context)
        self._pinned_ip = ip

    def connect(self) -> None:
        sock = socket.create_connection((self._pinned_ip, self.port), self.timeout)
        self.sock = self._context.wrap_socket(sock, server_hostname=self.host)


def fetch_policy(domain: str, *, timeout: float, allow_private: bool) -> str:
    host = f"mta-sts.{domain}"
    url = f"https://{host}{_PATH}"
    try:
        addresses = resolve_public(host, 443, allow_private=allow_private)
    except PrivateTargetError as exc:
        raise PolicyFetchError(f"Could not fetch {url}: {exc}") from exc

    context = ssl.create_default_context()
    last: Exception | None = None
    for ip in addresses:
        conn = _PinnedHTTPSConnection(host, ip, timeout=timeout, context=context)
        try:
            conn.request("GET", _PATH, headers={"User-Agent": "SecureMailScope/0.2"})
            response = conn.getresponse()
            if response.status != 200:  # 3xx included: redirects are not followed
                raise PolicyFetchError(f"{url} returned HTTP {response.status}")
            body = response.read(_MAX_POLICY_BYTES + 1)
            if len(body) > _MAX_POLICY_BYTES:
                raise PolicyFetchError(f"{url} is larger than 64 KiB")
            return body.decode("utf-8", "replace")
        except PolicyFetchError:
            raise
        except (OSError, ssl.SSLError, http.client.HTTPException) as exc:
            last = exc  # try the next validated address, as a normal connect would
        finally:
            conn.close()
    raise PolicyFetchError(f"Could not fetch {url}: {last}")
