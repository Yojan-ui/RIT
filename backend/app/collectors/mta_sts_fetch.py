"""Fetch an MTA-STS policy file (RFC 8461 §3.3)."""

from __future__ import annotations

import urllib.error
import urllib.request

from app.collectors.netguard import ensure_public_host

_MAX_POLICY_BYTES = 64 * 1024


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    # RFC 8461 §3.3: "HTTP 3xx redirects MUST NOT be followed."
    def redirect_request(self, req, fp, code, msg, headers, newurl):  # noqa: D401
        return None


class PolicyFetchError(Exception):
    pass


def fetch_policy(domain: str, *, timeout: float, allow_private: bool) -> str:
    host = f"mta-sts.{domain}"
    url = f"https://{host}/.well-known/mta-sts.txt"
    try:
        if not allow_private:
            ensure_public_host(host, 443)
        opener = urllib.request.build_opener(_NoRedirect)
        request = urllib.request.Request(url, headers={"User-Agent": "SecureMailScope/0.1"})
        with opener.open(request, timeout=timeout) as response:
            body = response.read(_MAX_POLICY_BYTES + 1)
    except urllib.error.HTTPError as exc:
        raise PolicyFetchError(f"{url} returned HTTP {exc.code}") from exc
    except urllib.error.URLError as exc:
        raise PolicyFetchError(f"Could not fetch {url}: {exc.reason}") from exc
    except Exception as exc:  # DNS failure, TLS error, PrivateTargetError, timeout
        raise PolicyFetchError(f"Could not fetch {url}: {exc}") from exc
    if len(body) > _MAX_POLICY_BYTES:
        raise PolicyFetchError(f"{url} is larger than 64 KiB")
    return body.decode("utf-8", "replace")
