"""SMTP transport check: STARTTLS on the primary MX, with honest degradation.

The probe connects to port 25 of the lowest-preference MX, issues EHLO + STARTTLS and
records the negotiated TLS version, cipher and certificate expiry.

Many networks (cloud providers, residential ISPs) block *outbound* port 25. A failed
connection therefore says nothing about the target on its own. When every MX
attempt fails we probe a known-good SMTP host: if that is unreachable too, egress is
blocked and the check is reported as NOT_ASSESSED (excluded from scoring) instead
of being scored as a failure. The same applies when the remote server refuses to
talk to *us* (e.g. a 554 banner because the scanner's IP is on a blocklist).
"""

from __future__ import annotations

import asyncio
import contextlib
import re
import ssl
import time
from dataclasses import dataclass
from datetime import datetime, timezone

from cryptography import x509
from cryptography.x509.oid import ExtensionOID, NameOID

from app.core.logging import get_logger
from app.engine.checkers.base import BaseChecker, ScanContext, status_from_findings
from app.engine.checkers.mx import parse_mx
from app.models.enums import CheckName, CheckStatus, Severity
from app.models.schemas import CheckResult, Finding

log = get_logger("transport")

WEAK_PROTOCOLS = frozenset({"SSLv2", "SSLv3", "TLSv1", "TLSv1.1"})
WEAK_CIPHER = re.compile(r"(RC4|3DES|DES-CBC|NULL|EXPORT|MD5|anon)", re.IGNORECASE)
EGRESS_CACHE_SECONDS = 600


class ConnectFailed(Exception):
    """TCP connection to the SMTP server could not be established."""


class SMTPRefused(Exception):
    """The server answered but declined the session (non-2xx banner/EHLO)."""


class SMTPProtocolError(Exception):
    """The conversation broke down (timeout, garbage, disconnect) after connecting."""


@dataclass(slots=True)
class TLSProbe:
    host: str
    banner: str
    starttls: bool
    tls_version: str | None = None
    cipher: str | None = None
    cipher_bits: int | None = None
    cert_der: bytes | None = None
    verify_error: str | None = None


async def _read_reply(reader: asyncio.StreamReader, timeout: float) -> tuple[int, list[str]]:
    lines: list[str] = []
    while True:
        try:
            raw = await asyncio.wait_for(reader.readline(), timeout)
        except (TimeoutError, asyncio.TimeoutError) as exc:
            raise SMTPProtocolError("timed out waiting for server reply") from exc
        if not raw:
            raise SMTPProtocolError("connection closed by server")
        line = raw.decode("utf-8", errors="replace").rstrip("\r\n")
        if len(line) < 3 or not line[:3].isdigit():
            raise SMTPProtocolError(f"malformed reply {line[:80]!r}")
        lines.append(line[4:])
        if len(line) == 3 or line[3] != "-":
            return int(line[:3]), lines


def _ssl_context(verify: bool) -> ssl.SSLContext:
    if verify:
        return ssl.create_default_context()
    # Permissive context: observe whatever the server negotiates, including legacy TLS.
    ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE
    ctx.minimum_version = ssl.TLSVersion.MINIMUM_SUPPORTED
    with contextlib.suppress(ssl.SSLError):
        ctx.set_ciphers("ALL:@SECLEVEL=0")
    return ctx


async def probe_starttls(host: str, port: int, *, timeout: float, helo: str, verify: bool) -> TLSProbe:
    try:
        reader, writer = await asyncio.wait_for(asyncio.open_connection(host, port), timeout)
    except (OSError, TimeoutError, asyncio.TimeoutError) as exc:
        raise ConnectFailed(f"{type(exc).__name__}: {exc}".rstrip(": ")) from exc

    try:
        code, banner = await _read_reply(reader, timeout)
        if code != 220:
            raise SMTPRefused(f"banner {code} {' '.join(banner)[:200]}")

        writer.write(f"EHLO {helo}\r\n".encode())
        await writer.drain()
        code, ehlo = await _read_reply(reader, timeout)
        if code != 250:
            raise SMTPRefused(f"EHLO rejected: {code} {' '.join(ehlo)[:200]}")
        extensions = {line.split()[0].upper() for line in ehlo[1:] if line.strip()}
        probe = TLSProbe(host=host, banner=" ".join(banner)[:200], starttls="STARTTLS" in extensions)
        if not probe.starttls:
            return probe

        writer.write(b"STARTTLS\r\n")
        await writer.drain()
        code, reply = await _read_reply(reader, timeout)
        if code != 220:
            raise SMTPRefused(f"STARTTLS rejected: {code} {' '.join(reply)[:200]}")

        await asyncio.wait_for(writer.start_tls(_ssl_context(verify), server_hostname=host), timeout)
        ssl_obj: ssl.SSLObject = writer.get_extra_info("ssl_object")
        probe.tls_version = ssl_obj.version()
        cipher = ssl_obj.cipher()
        if cipher:
            probe.cipher, _, probe.cipher_bits = cipher
        probe.cert_der = ssl_obj.getpeercert(binary_form=True)

        with contextlib.suppress(Exception):
            writer.write(b"QUIT\r\n")
            await asyncio.wait_for(writer.drain(), 2)
        return probe
    finally:
        writer.close()
        with contextlib.suppress(Exception):
            await asyncio.wait_for(writer.wait_closed(), 2)


async def probe_with_fallback(host: str, port: int, *, timeout: float, helo: str) -> TLSProbe:
    """Try a validating handshake first; if it fails, retry permissively to still read the details."""
    try:
        return await probe_starttls(host, port, timeout=timeout, helo=helo, verify=True)
    except ssl.SSLCertVerificationError as exc:
        verify_error = exc.verify_message or str(exc)
    except ssl.SSLError as exc:
        verify_error = f"handshake failed with a strict client: {exc.reason or exc}"
    probe = await probe_starttls(host, port, timeout=timeout, helo=helo, verify=False)
    probe.verify_error = verify_error
    return probe


_egress_cache: tuple[float, bool] | None = None


async def port25_egress_open(host: str, port: int, timeout: float) -> bool:
    """Can this machine open outbound SMTP connections at all? Cached for 10 minutes."""
    global _egress_cache
    if _egress_cache and time.monotonic() - _egress_cache[0] < EGRESS_CACHE_SECONDS:
        return _egress_cache[1]
    try:
        _, writer = await asyncio.wait_for(asyncio.open_connection(host, port), timeout)
    except (OSError, TimeoutError, asyncio.TimeoutError):
        ok = False
    else:
        writer.close()
        with contextlib.suppress(Exception):
            await writer.wait_closed()
        ok = True
    _egress_cache = (time.monotonic(), ok)
    return ok


def describe_certificate(der: bytes) -> dict:
    cert = x509.load_der_x509_certificate(der)
    not_after = cert.not_valid_after_utc

    def cn(name: x509.Name) -> str | None:
        attrs = name.get_attributes_for_oid(NameOID.COMMON_NAME)
        return str(attrs[0].value) if attrs else None

    try:
        san = cert.extensions.get_extension_for_oid(ExtensionOID.SUBJECT_ALTERNATIVE_NAME)
        dns_names = san.value.get_values_for_type(x509.DNSName)
    except x509.ExtensionNotFound:
        dns_names = []
    return {
        "subject_cn": cn(cert.subject),
        "issuer_cn": cn(cert.issuer),
        "san": dns_names[:20],
        "not_before": cert.not_valid_before_utc.isoformat(),
        "not_after": not_after.isoformat(),
        "days_remaining": (not_after - datetime.now(timezone.utc)).days,
    }


class TransportChecker(BaseChecker):
    name = CheckName.TRANSPORT
    egress_probe = staticmethod(port25_egress_open)

    async def check(self, ctx: ScanContext) -> CheckResult:
        s = ctx.settings
        if not s.smtp_probe_enabled:
            return self.not_assessed("SMTP probing is disabled in this deployment (SMS_SMTP_PROBE_ENABLED=false).")

        answer = await ctx.mx()
        if answer.error:
            return self.not_assessed(f"Could not resolve MX records ({answer.error}).")
        hosts = [h for h in parse_mx(answer.records) if not h.is_null]
        if not hosts:
            return self.not_applicable("the domain publishes no usable MX host")

        attempts: list[dict] = []
        for mx in hosts[: s.smtp_max_mx_attempts]:
            try:
                probe = await probe_with_fallback(
                    mx.host, s.smtp_port, timeout=s.smtp_timeout_seconds, helo=s.smtp_helo_name
                )
            except ConnectFailed as exc:
                attempts.append({"host": mx.host, "error": str(exc)})
                continue
            except SMTPRefused as exc:
                return self.not_assessed(
                    f"{mx.host} refused the scanner's session ({exc}). This usually reflects the scanner's IP "
                    "reputation rather than the server's configuration.",
                    attempts=attempts + [{"host": mx.host, "error": str(exc)}],
                )
            except (SMTPProtocolError, ssl.SSLError, OSError, TimeoutError, asyncio.TimeoutError) as exc:
                return self.not_assessed(
                    f"The SMTP conversation with {mx.host} did not complete ({type(exc).__name__}: {exc}).",
                    attempts=attempts + [{"host": mx.host, "error": str(exc)}],
                )
            return self._assess(probe, mx.preference, attempts)

        # Every MX attempt failed to connect: is it them, or us?
        if not await self.egress_probe(s.smtp_egress_probe_host, s.smtp_port, s.smtp_timeout_seconds):
            return self.not_assessed(
                f"Outbound port {s.smtp_port} appears to be blocked from the scanner's network "
                f"(a reference SMTP server was also unreachable), so the MX could not be tested.",
                attempts=attempts,
            )
        return self.result(
            CheckStatus.FAIL,
            "MX unreachable on port 25",
            findings=[
                Finding(
                    title="MX hosts unreachable",
                    detail="Could not connect to "
                    + "; ".join(f"{a['host']} ({a['error']})" for a in attempts)
                    + ", while a reference SMTP server was reachable.",
                    severity=Severity.HIGH,
                    recommendation="Check that the MX accepts connections on port 25.",
                )
            ],
            data={"attempts": attempts},
        )

    def not_assessed(self, reason: str, attempts: list[dict] | None = None) -> CheckResult:
        return self.result(
            CheckStatus.NOT_ASSESSED,
            "Not assessed from this network",
            findings=[Finding(title="Transport not assessed", detail=reason, severity=Severity.INFO)],
            data={"reason": reason, "attempts": attempts or []},
        )

    def _assess(self, probe: TLSProbe, preference: int, attempts: list[dict]) -> CheckResult:
        findings: list[Finding] = []
        data: dict = {
            "host": probe.host,
            "preference": preference,
            "banner": probe.banner,
            "starttls": probe.starttls,
            "attempts": attempts,
        }
        if not probe.starttls:
            findings.append(
                Finding(
                    title="STARTTLS not offered",
                    detail=f"{probe.host} does not advertise STARTTLS; inbound mail travels in plaintext.",
                    severity=Severity.HIGH,
                    recommendation="Enable STARTTLS with a valid certificate on every MX.",
                )
            )
            return self.result(CheckStatus.FAIL, f"{probe.host}: no STARTTLS", findings=findings, data=data)

        data |= {
            "tls_version": probe.tls_version,
            "cipher": probe.cipher,
            "cipher_bits": probe.cipher_bits,
            "certificate_valid": probe.verify_error is None,
            "verify_error": probe.verify_error,
        }
        if probe.tls_version in WEAK_PROTOCOLS:
            findings.append(
                Finding(
                    title=f"Legacy protocol {probe.tls_version}",
                    detail="The best protocol the server offers is deprecated (RFC 8996).",
                    severity=Severity.HIGH,
                    recommendation="Enable TLS 1.2 and 1.3.",
                )
            )
        if probe.cipher and WEAK_CIPHER.search(probe.cipher):
            findings.append(
                Finding(title=f"Weak cipher {probe.cipher}", severity=Severity.MEDIUM, recommendation="Prefer AEAD ciphers (AES-GCM, ChaCha20-Poly1305).")
            )
        if probe.verify_error:
            findings.append(
                Finding(
                    title="Certificate does not validate",
                    detail=f"{probe.verify_error}. Opportunistic TLS still encrypts, but senders enforcing "
                    "MTA-STS will refuse to deliver.",
                    severity=Severity.MEDIUM,
                    recommendation="Install a publicly trusted certificate matching the MX hostname.",
                )
            )

        if probe.cert_der:
            try:
                cert = describe_certificate(probe.cert_der)
            except ValueError as exc:
                findings.append(Finding(title="Unparseable certificate", detail=str(exc), severity=Severity.MEDIUM))
            else:
                data["certificate"] = cert
                days = cert["days_remaining"]
                if days < 0:
                    findings.append(
                        Finding(title="Certificate expired", detail=f"Expired {cert['not_after']}.", severity=Severity.HIGH)
                    )
                elif days < 14:
                    findings.append(
                        Finding(title=f"Certificate expires in {days} days", detail=cert["not_after"], severity=Severity.MEDIUM)
                    )
                elif days < 30:
                    findings.append(
                        Finding(title=f"Certificate expires in {days} days", detail=cert["not_after"], severity=Severity.LOW)
                    )

        return self.result(
            status_from_findings(findings),
            f"{probe.host}: {probe.tls_version}, {probe.cipher}",
            findings=findings,
            data=data,
        )
