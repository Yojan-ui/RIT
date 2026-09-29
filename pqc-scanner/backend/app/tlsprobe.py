"""Live TLS probes.

1. `probe_key_exchange` sends a hand-built TLS 1.3 ClientHello that offers the
   hybrid post-quantum group X25519MLKEM768 (FIPS 203 ML-KEM-768 + X25519,
   codepoint 0x11EC) alongside classical groups, then reads the plaintext
   ServerHello to see which group the server actually selected. This is needed
   because Python's `ssl` module can neither offer ML-KEM (it links an OpenSSL
   without it) nor report the negotiated group. The probe stops after the
   ServerHello (or, for TLS 1.2, after ServerKeyExchange); it never completes a
   handshake or sends application data.

2. `probe_certificate` does a normal verified handshake with `ssl` to fetch the
   certificate chain, parsed with `cryptography`.
"""

from __future__ import annotations

import os
import socket
import ssl
import struct
from collections.abc import Iterator
from dataclasses import dataclass, field, replace
from datetime import datetime, timezone

import certifi
from cryptography import x509
from cryptography.exceptions import UnsupportedAlgorithm
from cryptography.hazmat.primitives.asymmetric import dsa, ec, ed448, ed25519, rsa, x25519
from cryptography.hazmat.primitives.serialization import Encoding, PublicFormat
from cryptography.x509.oid import ExtensionOID, NameOID

from .netguard import Target

TIMEOUT = 6.0
CONNECT_TIMEOUT = 3.0  # per address; a silent (dropping) address shouldn't eat the whole scan budget
MAX_ADDRESSES = 4
MAX_READ = 96 * 1024

# ── Registries ──────────────────────────────────────────────────────────────

GROUPS: dict[int, str] = {
    0x0017: "secp256r1",
    0x0018: "secp384r1",
    0x0019: "secp521r1",
    0x001D: "x25519",
    0x001E: "x448",
    0x0100: "ffdhe2048",
    0x0101: "ffdhe3072",
    0x0102: "ffdhe4096",
    0x11EB: "SecP256r1MLKEM768",
    0x11EC: "X25519MLKEM768",
    0x11ED: "SecP384r1MLKEM1024",
    0x6399: "X25519Kyber768Draft00",
    0x0200: "MLKEM512",
    0x0201: "MLKEM768",
    0x0202: "MLKEM1024",
}
PQ_GROUPS = {0x11EB, 0x11EC, 0x11ED, 0x6399, 0x0200, 0x0201, 0x0202}

CIPHER_SUITES: dict[int, str] = {
    0x1301: "TLS_AES_128_GCM_SHA256",
    0x1302: "TLS_AES_256_GCM_SHA384",
    0x1303: "TLS_CHACHA20_POLY1305_SHA256",
    0xC02B: "ECDHE-ECDSA-AES128-GCM-SHA256",
    0xC02C: "ECDHE-ECDSA-AES256-GCM-SHA384",
    0xC02F: "ECDHE-RSA-AES128-GCM-SHA256",
    0xC030: "ECDHE-RSA-AES256-GCM-SHA384",
    0xCCA8: "ECDHE-RSA-CHACHA20-POLY1305",
    0xCCA9: "ECDHE-ECDSA-CHACHA20-POLY1305",
    0xC013: "ECDHE-RSA-AES128-SHA",
    0xC014: "ECDHE-RSA-AES256-SHA",
    0x009E: "DHE-RSA-AES128-GCM-SHA256",
    0x009F: "DHE-RSA-AES256-GCM-SHA384",
    0x009C: "AES128-GCM-SHA256",
    0x009D: "AES256-GCM-SHA384",
    0x002F: "AES128-SHA",
    0x0035: "AES256-SHA",
}
OFFERED_SUITES = list(CIPHER_SUITES)

VERSIONS = {0x0304: "TLS 1.3", 0x0303: "TLS 1.2", 0x0302: "TLS 1.1", 0x0301: "TLS 1.0"}

# Signature schemes, including ML-DSA (draft-ietf-tls-mldsa) so a PQ-certificate server can choose it.
SIG_SCHEMES = [0x0905, 0x0904, 0x0906, 0x0403, 0x0503, 0x0603, 0x0807, 0x0808, 0x0804, 0x0805, 0x0806, 0x0401, 0x0501, 0x0601]

ALERTS = {40: "handshake_failure", 47: "illegal_parameter", 50: "decode_error", 70: "protocol_version", 71: "insufficient_security", 80: "internal_error", 112: "unrecognized_name"}

HRR_RANDOM = bytes.fromhex("CF21AD74E59A6111BE1D8C021E65B891C2A211167ABB8C5E079E09E2C8A8339C")

# ── Address fallback ────────────────────────────────────────────────────────


@dataclass
class AddressFailure:
    ip: str
    reason: str
    timed_out: bool

    def __str__(self) -> str:
        return f"{self.ip} ({self.reason})"


def _describe(e: BaseException) -> str:
    if isinstance(e, TimeoutError | socket.timeout):
        return "no response"
    if isinstance(e, ConnectionRefusedError):
        return "connection refused"
    if isinstance(e, ConnectionResetError):
        return "connection reset"
    return str(e) or type(e).__name__


def reachable_targets(target: Target, failures: list[AddressFailure], *, port: int = 443, timeout: float = CONNECT_TIMEOUT) -> Iterator[Target]:
    """Yield `target` pinned to each vetted address that accepts a TCP connection, in preference order.

    Some hosts publish several A records where one silently drops traffic (a dead
    origin or a strict firewall edge): connecting only to the first address makes
    the whole scan time out. Addresses that don't connect within `timeout` are
    recorded in `failures` and skipped. Only addresses already vetted as public by
    netguard are tried, so the SSRF guarantees are unchanged.
    """
    candidates = target.addresses or ((target.family, target.ip),)
    for family, ip in candidates[:MAX_ADDRESSES]:
        try:
            with socket.create_connection((ip, port), timeout=timeout):
                pass
        except OSError as e:
            failures.append(AddressFailure(ip, _describe(e), isinstance(e, TimeoutError | socket.timeout)))
            continue
        yield replace(target, ip=ip, family=family)


# ── ClientHello ─────────────────────────────────────────────────────────────


def _u8(b: bytes) -> bytes:
    return struct.pack("!B", len(b)) + b


def _u16(b: bytes) -> bytes:
    return struct.pack("!H", len(b)) + b


def _u24(b: bytes) -> bytes:
    return struct.pack("!I", len(b))[1:] + b


def _ext(ext_type: int, body: bytes) -> bytes:
    return struct.pack("!H", ext_type) + _u16(body)


def mlkem768_encapsulation_key() -> bytes:
    """A well-formed ML-KEM-768 encapsulation key (FIPS 203 §7.2 modulus check passes).

    t̂ is all-zero coefficients (each < q), followed by a random 32-byte seed ρ.
    The server can encapsulate to it, which is all the probe needs: we never
    decapsulate or finish the handshake.
    """
    return bytes(3 * 384) + os.urandom(32)


def build_client_hello(hostname: str) -> bytes:
    x25519_pub = x25519.X25519PrivateKey.generate().public_key().public_bytes(Encoding.Raw, PublicFormat.Raw)
    hybrid_share = mlkem768_encapsulation_key() + x25519_pub  # draft-ietf-tls-ecdhe-mlkem: ML-KEM first, then X25519

    groups = [0x11EC, 0x001D, 0x0017, 0x0018, 0x0019]
    extensions = b"".join([
        _ext(0x0000, _u16(b"\x00" + _u16(hostname.encode()))),  # server_name
        _ext(0x000A, _u16(b"".join(struct.pack("!H", g) for g in groups))),  # supported_groups
        _ext(0x000B, _u8(b"\x00")),  # ec_point_formats: uncompressed
        _ext(0x000D, _u16(b"".join(struct.pack("!H", s) for s in SIG_SCHEMES))),  # signature_algorithms
        _ext(0x0010, _u16(_u8(b"h2") + _u8(b"http/1.1"))),  # ALPN
        _ext(0x002B, _u8(struct.pack("!HH", 0x0304, 0x0303))),  # supported_versions
        _ext(0x002D, _u8(b"\x01")),  # psk_key_exchange_modes: psk_dhe_ke
        _ext(0x0033, _u16(  # key_share
            struct.pack("!H", 0x11EC) + _u16(hybrid_share)
            + struct.pack("!H", 0x001D) + _u16(x25519_pub)
        )),
        _ext(0xFF01, _u8(b"")),  # renegotiation_info
    ])
    body = (
        struct.pack("!H", 0x0303)
        + os.urandom(32)
        + _u8(os.urandom(32))  # legacy_session_id (middlebox compatibility)
        + _u16(b"".join(struct.pack("!H", c) for c in OFFERED_SUITES))
        + _u8(b"\x00")
        + _u16(extensions)
    )
    handshake = b"\x01" + _u24(body)
    return b"\x16\x03\x01" + _u16(handshake)


# ── ServerHello parsing ─────────────────────────────────────────────────────


@dataclass
class KeyExchangeResult:
    tls_version: str | None = None
    cipher_suite: str | None = None
    group: str | None = None
    group_code: int | None = None
    pq_hybrid: bool = False
    hello_retry: bool = False
    kex_method: str | None = None  # "(EC)DHE", "RSA key transport", ...
    alert: str | None = None
    notes: list[str] = field(default_factory=list)


class _Reader:
    def __init__(self, data: bytes):
        self.data, self.pos = data, 0

    def take(self, n: int) -> bytes:
        if self.pos + n > len(self.data):
            raise ValueError("truncated")
        out = self.data[self.pos : self.pos + n]
        self.pos += n
        return out

    def u8(self) -> int:
        return self.take(1)[0]

    def u16(self) -> int:
        return struct.unpack("!H", self.take(2))[0]

    def u24(self) -> int:
        return int.from_bytes(self.take(3), "big")

    def remaining(self) -> int:
        return len(self.data) - self.pos


def parse_server_flight(records: bytes) -> KeyExchangeResult:
    """Parse plaintext records from the server: alerts, ServerHello/HRR, and (TLS 1.2) ServerKeyExchange."""
    res = KeyExchangeResult()
    hs = bytearray()
    r = _Reader(records)
    while r.remaining() >= 5:
        ctype = r.u8()
        r.u16()
        length = r.u16()
        if r.remaining() < length:
            break
        payload = r.take(length)
        if ctype == 21 and len(payload) >= 2:  # alert
            res.alert = ALERTS.get(payload[1], f"alert {payload[1]}")
            return res
        if ctype == 22:
            hs += payload
        elif ctype == 20:  # change_cipher_spec: everything after is encrypted (TLS 1.3)
            break

    h = _Reader(bytes(hs))
    while h.remaining() >= 4:
        mtype = h.u8()
        mlen = h.u24()
        if h.remaining() < mlen:
            break
        msg = _Reader(h.take(mlen))
        if mtype == 2:  # ServerHello / HelloRetryRequest
            legacy_version = msg.u16()
            random = msg.take(32)
            msg.take(msg.u8())  # session id
            suite = msg.u16()
            msg.u8()  # compression
            res.cipher_suite = CIPHER_SUITES.get(suite, f"0x{suite:04X}")
            res.hello_retry = random == HRR_RANDOM
            version = legacy_version
            if msg.remaining() >= 2:
                exts = _Reader(msg.take(msg.u16()))
                while exts.remaining() >= 4:
                    etype, elen = exts.u16(), exts.u16()
                    e = _Reader(exts.take(elen))
                    if etype == 0x002B:  # supported_versions
                        version = e.u16()
                    elif etype == 0x0033:  # key_share: group (+ key in ServerHello; bare group in HRR)
                        res.group_code = e.u16()
            res.tls_version = VERSIONS.get(version, f"0x{version:04X}")
            if version == 0x0304:
                res.kex_method = "(EC)DHE / KEM"
                break  # the rest of a TLS 1.3 flight is encrypted
            res.kex_method = "RSA key transport" if res.cipher_suite and not res.cipher_suite.startswith(("ECDHE", "DHE")) else "(EC)DHE"
        elif mtype == 12:  # ServerKeyExchange (TLS 1.2)
            if res.cipher_suite and res.cipher_suite.startswith("ECDHE") and msg.u8() == 3:  # named_curve
                res.group_code = msg.u16()
            elif res.cipher_suite and res.cipher_suite.startswith("DHE"):
                p_len = msg.u16()
                res.group = f"ffdhe (finite-field DH, {p_len * 8}-bit)"
        elif mtype == 14:  # ServerHelloDone
            break

    if res.group_code is not None:
        res.group = GROUPS.get(res.group_code, f"0x{res.group_code:04X}")
        res.pq_hybrid = res.group_code in PQ_GROUPS
    if res.hello_retry:
        res.notes.append(f"Server sent HelloRetryRequest selecting {res.group}.")
    if res.kex_method == "RSA key transport":
        res.group = "RSA key transport (no forward secrecy)"
    return res


def _recv_flight(sock: socket.socket) -> bytes:
    """Read until we have a ServerHello plus (for TLS 1.2) enough of the flight, or the peer stops."""
    buf = bytearray()
    while len(buf) < MAX_READ:
        try:
            chunk = sock.recv(16384)
        except socket.timeout:
            break
        if not chunk:
            break
        buf += chunk
        res = parse_server_flight(bytes(buf))
        done_13 = res.tls_version == "TLS 1.3"
        done_12 = res.tls_version and res.tls_version != "TLS 1.3" and (res.group_code is not None or res.group or res.kex_method == "RSA key transport" and b"\x0e\x00\x00\x00" in buf)
        if res.alert or res.hello_retry or done_13 or done_12:
            break
    return bytes(buf)


def probe_key_exchange(target: Target) -> KeyExchangeResult:
    with socket.socket(target.family, socket.SOCK_STREAM) as sock:
        sock.settimeout(TIMEOUT)
        sock.connect((target.ip, 443))
        sock.sendall(build_client_hello(target.hostname))
        data = _recv_flight(sock)
    if not data:
        raise ConnectionError("Server closed the connection without responding to the ClientHello.")
    return parse_server_flight(data)


# ── Certificates ────────────────────────────────────────────────────────────

SIG_OIDS = {
    "1.2.840.113549.1.1.5": "sha1WithRSAEncryption",
    "1.2.840.113549.1.1.11": "sha256WithRSAEncryption",
    "1.2.840.113549.1.1.12": "sha384WithRSAEncryption",
    "1.2.840.113549.1.1.13": "sha512WithRSAEncryption",
    "1.2.840.113549.1.1.10": "RSASSA-PSS",
    "1.2.840.10045.4.3.2": "ecdsa-with-SHA256",
    "1.2.840.10045.4.3.3": "ecdsa-with-SHA384",
    "1.2.840.10045.4.3.4": "ecdsa-with-SHA512",
    "1.3.101.112": "Ed25519",
    "1.3.101.113": "Ed448",
    "2.16.840.1.101.3.4.3.17": "ML-DSA-44",
    "2.16.840.1.101.3.4.3.18": "ML-DSA-65",
    "2.16.840.1.101.3.4.3.19": "ML-DSA-87",
    **{f"2.16.840.1.101.3.4.3.{n}": f"SLH-DSA ({n})" for n in range(20, 32)},
}
PQ_KEY_OIDS = {
    "2.16.840.1.101.3.4.3.17": "ML-DSA-44",
    "2.16.840.1.101.3.4.3.18": "ML-DSA-65",
    "2.16.840.1.101.3.4.3.19": "ML-DSA-87",
    **{f"2.16.840.1.101.3.4.3.{n}": "SLH-DSA" for n in range(20, 32)},
}
CURVE_NAMES = {"secp256r1": "P-256", "secp384r1": "P-384", "secp521r1": "P-521"}


def _name_attr(name: x509.Name, oid) -> str | None:
    attrs = name.get_attributes_for_oid(oid)
    return str(attrs[0].value) if attrs else None


def describe_public_key(cert: x509.Certificate) -> dict:
    oid = cert.public_key_algorithm_oid.dotted_string
    if oid in PQ_KEY_OIDS:
        name = PQ_KEY_OIDS[oid]
        return {"family": "ML-DSA" if name.startswith("ML-DSA") else "SLH-DSA", "name": name, "bits": None, "oid": oid}
    try:
        pk = cert.public_key()
    except (UnsupportedAlgorithm, ValueError):
        return {"family": "unknown", "name": f"OID {oid}", "bits": None, "oid": oid}
    if isinstance(pk, rsa.RSAPublicKey):
        return {"family": "RSA", "name": f"RSA-{pk.key_size}", "bits": pk.key_size, "oid": oid}
    if isinstance(pk, ec.EllipticCurvePublicKey):
        curve = CURVE_NAMES.get(pk.curve.name, pk.curve.name)
        return {"family": "ECDSA", "name": f"ECDSA {curve}", "bits": pk.curve.key_size, "curve": pk.curve.name, "oid": oid}
    if isinstance(pk, ed25519.Ed25519PublicKey):
        return {"family": "EdDSA", "name": "Ed25519", "bits": 256, "oid": oid}
    if isinstance(pk, ed448.Ed448PublicKey):
        return {"family": "EdDSA", "name": "Ed448", "bits": 456, "oid": oid}
    if isinstance(pk, dsa.DSAPublicKey):
        return {"family": "DSA", "name": f"DSA-{pk.key_size}", "bits": pk.key_size, "oid": oid}
    return {"family": "unknown", "name": type(pk).__name__, "bits": None, "oid": oid}


def describe_signature(cert: x509.Certificate) -> dict:
    oid = cert.signature_algorithm_oid.dotted_string
    name = SIG_OIDS.get(oid) or getattr(cert.signature_algorithm_oid, "_name", None) or oid
    if name.startswith(("ML-DSA", "SLH-DSA")):
        family = name.split(" ")[0].rsplit("-", 1)[0] if name.startswith("ML-DSA") else "SLH-DSA"
    elif "RSA" in name:
        family = "RSA"
    elif name.startswith("ecdsa"):
        family = "ECDSA"
    elif name.startswith("Ed"):
        family = "EdDSA"
    else:
        family = "unknown"
    return {"family": family, "name": name, "oid": oid}


def describe_certificate(der: bytes) -> dict:
    cert = x509.load_der_x509_certificate(der)
    try:
        sans = cert.extensions.get_extension_for_oid(ExtensionOID.SUBJECT_ALTERNATIVE_NAME).value.get_values_for_type(x509.DNSName)
    except x509.ExtensionNotFound:
        sans = []
    now = datetime.now(timezone.utc)
    return {
        "subject_cn": _name_attr(cert.subject, NameOID.COMMON_NAME),
        "subject": cert.subject.rfc4514_string(),
        "issuer_cn": _name_attr(cert.issuer, NameOID.COMMON_NAME),
        "issuer_org": _name_attr(cert.issuer, NameOID.ORGANIZATION_NAME),
        "issuer": cert.issuer.rfc4514_string(),
        "not_before": cert.not_valid_before_utc.isoformat(),
        "not_after": cert.not_valid_after_utc.isoformat(),
        "days_remaining": (cert.not_valid_after_utc - now).days,
        "serial": format(cert.serial_number, "x"),
        "sans": sans[:12],
        "san_count": len(sans),
        "public_key": describe_public_key(cert),
        "signature": describe_signature(cert),
    }


@dataclass
class CertificateResult:
    trusted: bool
    verify_error: str | None
    tls_version: str | None
    cipher_suite: str | None
    leaf: dict
    chain: list[dict]


def _chain_der(sock: ssl.SSLSocket) -> list[bytes]:
    getter = getattr(sock, "get_unverified_chain", None)
    if not getter:
        return []
    out = []
    for c in getter() or []:
        out.append(c if isinstance(c, (bytes, bytearray)) else c.public_bytes(ssl._ssl.ENCODING_DER))  # type: ignore[attr-defined]
    return out


def probe_certificate(target: Target) -> CertificateResult:
    def handshake(ctx: ssl.SSLContext):
        raw = socket.socket(target.family, socket.SOCK_STREAM)
        raw.settimeout(TIMEOUT)
        raw.connect((target.ip, 443))
        tls = ctx.wrap_socket(raw, server_hostname=target.hostname)
        try:
            return tls.version(), tls.cipher(), tls.getpeercert(binary_form=True), _chain_der(tls)
        finally:
            tls.close()

    verified = ssl.create_default_context(cafile=certifi.where())
    try:
        version, cipher, leaf_der, chain = handshake(verified)
        trusted, err = True, None
    except ssl.SSLCertVerificationError as e:
        insecure = ssl.create_default_context(cafile=certifi.where())
        insecure.check_hostname = False
        insecure.verify_mode = ssl.CERT_NONE
        version, cipher, leaf_der, chain = handshake(insecure)
        trusted, err = False, e.verify_message or str(e)

    if not leaf_der:
        raise ConnectionError("Server did not present a certificate.")
    chain_desc = []
    for der in chain[1:]:
        try:
            d = describe_certificate(der)
            chain_desc.append({k: d[k] for k in ("subject_cn", "issuer_cn", "not_after", "public_key", "signature")})
        except ValueError:
            continue
    return CertificateResult(
        trusted=trusted,
        verify_error=err,
        tls_version={"TLSv1.3": "TLS 1.3", "TLSv1.2": "TLS 1.2", "TLSv1.1": "TLS 1.1", "TLSv1": "TLS 1.0"}.get(version or "", version),
        cipher_suite=cipher[0] if cipher else None,
        leaf=describe_certificate(leaf_der),
        chain=chain_desc,
    )
