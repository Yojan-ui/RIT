"""Raw-socket STARTTLS probe for an MX host on port 25.

Deliberately uses plain `socket` + `ssl` rather than smtplib so we control
every step and can report exactly where a conversation broke:

    TCP connect -> 220 banner -> EHLO -> STARTTLS offered? -> 220 -> TLS handshake

The certificate is first verified against the system trust store *and* the MX
hostname (what an MTA-STS-enforcing sender would do). If that fails, we
reconnect without verification purely to record which TLS version/cipher the
server negotiates.
"""

from __future__ import annotations

import socket
import ssl
import time

from app.models import StartTlsProbe

_MAX_REPLY_BYTES = 64 * 1024


class _SmtpError(Exception):
    pass


class _NoStartTls(Exception):
    pass


class _SmtpConversation:
    """Minimal line-oriented SMTP client over a raw socket."""

    def __init__(self, sock: socket.socket) -> None:
        self.sock = sock
        self._buffer = b""

    def send(self, line: str) -> None:
        self.sock.sendall(line.encode("ascii") + b"\r\n")

    def _read_line(self) -> bytes:
        while b"\r\n" not in self._buffer and b"\n" not in self._buffer:
            if len(self._buffer) > _MAX_REPLY_BYTES:
                raise _SmtpError("SMTP reply exceeded 64 KiB")
            chunk = self.sock.recv(4096)
            if not chunk:
                raise _SmtpError("Server closed the connection")
            self._buffer += chunk
        sep = b"\r\n" if b"\r\n" in self._buffer else b"\n"
        line, self._buffer = self._buffer.split(sep, 1)
        return line

    def read_reply(self) -> tuple[int, list[str]]:
        """Read a (possibly multi-line) reply: '250-foo' ... '250 bar'."""
        lines: list[str] = []
        while True:
            raw = self._read_line().decode("utf-8", "replace")
            if len(raw) < 3 or not raw[:3].isdigit():
                raise _SmtpError(f"Malformed SMTP reply: {raw[:80]!r}")
            lines.append(raw[4:])
            if len(raw) == 3 or raw[3] == " ":
                return int(raw[:3]), lines

    @property
    def has_buffered_data(self) -> bool:
        return bool(self._buffer)


def _verified_context() -> ssl.SSLContext:
    return ssl.create_default_context()


def _unverified_context() -> ssl.SSLContext:
    ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE
    try:  # let us *observe* legacy TLS instead of failing the handshake
        ctx.minimum_version = ssl.TLSVersion.TLSv1
        ctx.set_ciphers("DEFAULT:@SECLEVEL=0")
    except (ValueError, ssl.SSLError):
        pass
    return ctx


def _negotiate(
    result: StartTlsProbe, *, host: str, ip: str, port: int, timeout: float, ehlo_name: str,
    context: ssl.SSLContext,
) -> ssl.SSLSocket:
    sock = socket.create_connection((ip, port), timeout=timeout)
    try:
        smtp = _SmtpConversation(sock)
        code, lines = smtp.read_reply()
        result.reachable = True
        result.banner = (lines[0] if lines else "")[:200]
        if code != 220:
            raise _SmtpError(f"Server greeted with {code} instead of 220: {result.banner}")

        smtp.send(f"EHLO {ehlo_name}")
        code, lines = smtp.read_reply()
        if code != 250:
            raise _SmtpError(f"EHLO rejected with {code}")
        result.ehlo_ok = True
        capabilities = {line.split(" ", 1)[0].upper() for line in lines[1:] if line}
        if "STARTTLS" not in capabilities:
            raise _NoStartTls()
        result.starttls_offered = True

        smtp.send("STARTTLS")
        code, lines = smtp.read_reply()
        if code != 220:
            raise _SmtpError(f"STARTTLS refused with {code}: {' '.join(lines)[:120]}")
        if smtp.has_buffered_data:
            # Plaintext bytes after "220 ready" = command-injection bug (CVE-2011-0411 class).
            raise _SmtpError("Server sent unexpected data after STARTTLS; aborting")

        return context.wrap_socket(sock, server_hostname=host)
    except BaseException:
        sock.close()
        raise


def _quit(conn: socket.socket) -> None:
    try:
        conn.sendall(b"QUIT\r\n")
    except OSError:
        pass


def _name_attr(name: tuple, key: str) -> str | None:
    for rdn in name or ():
        for attr, value in rdn:
            if attr == key:
                return value
    return None


def probe_starttls(
    host: str, ip: str, *, port: int = 25, timeout: float = 8.0,
    ehlo_name: str = "scanner.securemailscope.local",
) -> StartTlsProbe:
    """Probe one MX host. Never raises; failures are recorded on the result."""
    result = StartTlsProbe(host=host, ip=ip, port=port)
    started = time.monotonic()
    kwargs = dict(host=host, ip=ip, port=port, timeout=timeout, ehlo_name=ehlo_name)
    try:
        try:
            tls = _negotiate(result, context=_verified_context(), **kwargs)
            result.cert_valid = True
        except ssl.SSLCertVerificationError as exc:
            result.cert_valid = False
            result.cert_error = exc.verify_message or str(exc)
            tls = _negotiate(result, context=_unverified_context(), **kwargs)
        except ssl.SSLError as exc:
            # Handshake failed for a non-certificate reason, commonly a server
            # that only speaks TLS < 1.2. Retry permissively to observe it.
            result.cert_error = f"Verified handshake failed: {exc.reason or exc}"
            tls = _negotiate(result, context=_unverified_context(), **kwargs)

        with tls:
            result.tls_version = tls.version()
            cipher = tls.cipher()
            result.cipher = cipher[0] if cipher else None
            cert = tls.getpeercert() if result.cert_valid else None
            if cert:
                result.cert_subject = _name_attr(cert.get("subject"), "commonName")
                result.cert_issuer = _name_attr(cert.get("issuer"), "organizationName") or _name_attr(
                    cert.get("issuer"), "commonName"
                )
                result.cert_not_after = cert.get("notAfter")
            _quit(tls)
    except _NoStartTls:
        result.starttls_offered = False
    except _SmtpError as exc:
        result.error = str(exc)
    except socket.timeout:
        result.error = f"Timed out after {timeout:.0f}s" + (" (after banner)" if result.reachable else " connecting to port 25")
    except ConnectionRefusedError:
        result.error = "Connection refused on port 25"
    except ssl.SSLError as exc:
        result.error = f"TLS handshake failed: {exc.reason or exc}"
    except OSError as exc:
        result.error = f"Connection failed: {exc.strerror or exc}"
    finally:
        result.duration_ms = int((time.monotonic() - started) * 1000)
    return result
