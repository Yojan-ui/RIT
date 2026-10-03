"""Handshake crypto benchmark, measured on this host with `cryptography` (OpenSSL).

Times the per-handshake public-key operations of classical TLS (ECDHE, RSA / ECDSA)
against the post-quantum replacements (ML-KEM-768 inside X25519MLKEM768, ML-DSA-65), plus the
other NIST levels' parameter sets the console can switch to (ML-KEM-1024, ML-DSA-44 / 87), and reports the real encoded sizes that go on the wire. Computed once, then cached.
"""

from __future__ import annotations

import functools
import platform
import time
from collections.abc import Callable

import cryptography
from cryptography.hazmat.backends.openssl.backend import backend as ossl
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.asymmetric import ec, mldsa, mlkem, padding, rsa, x25519
from cryptography.hazmat.primitives.serialization import Encoding, PublicFormat

MSG = b"QuantumLedger TLS 1.3 CertificateVerify transcript hash" * 2


def _time(fn: Callable[[], object], budget: float = 0.1, batches: int = 5) -> float:
    """Best-of-`batches` mean microseconds per call (after one warm-up); robust to scheduler noise."""
    fn()
    best = float("inf")
    for _ in range(batches):
        runs, start = 0, time.perf_counter()
        while True:
            fn()
            runs += 1
            elapsed = time.perf_counter() - start
            if runs >= 3 and elapsed >= budget / batches:
                break
        best = min(best, elapsed / runs * 1e6)
    return best


def _spki(pub) -> int:
    return len(pub.public_bytes(Encoding.DER, PublicFormat.SubjectPublicKeyInfo))


def _sig_rsa(bits: int) -> dict:
    k = rsa.generate_private_key(public_exponent=65537, key_size=bits)
    pss = padding.PSS(mgf=padding.MGF1(hashes.SHA256()), salt_length=32)
    sig = k.sign(MSG, pss, hashes.SHA256())
    pub = k.public_key()
    return {
        "sign_us": _time(lambda: k.sign(MSG, pss, hashes.SHA256())),
        "verify_us": _time(lambda: pub.verify(sig, MSG, pss, hashes.SHA256())),
        "public_key_bytes": _spki(pub),
        "signature_bytes": len(sig),
    }


def _sig_ecdsa(curve: ec.EllipticCurve) -> dict:
    k = ec.generate_private_key(curve)
    sig = k.sign(MSG, ec.ECDSA(hashes.SHA256()))
    pub = k.public_key()
    return {
        "sign_us": _time(lambda: k.sign(MSG, ec.ECDSA(hashes.SHA256()))),
        "verify_us": _time(lambda: pub.verify(sig, MSG, ec.ECDSA(hashes.SHA256()))),
        "public_key_bytes": _spki(pub),
        "signature_bytes": len(sig),
    }


def _sig_mldsa(cls: type) -> dict:
    k = cls.generate()
    sig = k.sign(MSG)
    pub = k.public_key()
    return {
        "sign_us": _time(lambda: k.sign(MSG)),
        "verify_us": _time(lambda: pub.verify(sig, MSG)),
        "public_key_bytes": len(pub.public_bytes_raw()),
        "signature_bytes": len(sig),
    }


def _kex_x25519() -> dict:
    peer = x25519.X25519PrivateKey.generate().public_key()

    def server() -> None:  # ephemeral keygen + shared secret, one side of the handshake
        x25519.X25519PrivateKey.generate().exchange(peer)

    return {"server_us": _time(server), "client_us": _time(server), "client_share_bytes": 32, "server_share_bytes": 32}


def _kex_p256() -> dict:
    peer = ec.generate_private_key(ec.SECP256R1()).public_key()

    def side() -> None:
        ec.generate_private_key(ec.SECP256R1()).exchange(ec.ECDH(), peer)

    return {"server_us": _time(side), "client_us": _time(side), "client_share_bytes": 65, "server_share_bytes": 65}


def _kex_mlkem(cls: type) -> dict:
    """Pure ML-KEM. Client: keygen + decapsulate. Server: encapsulate."""
    dk = cls.generate()
    ek = dk.public_key()
    _, ct = ek.encapsulate()
    keygen = _time(lambda: cls.generate())
    encap = _time(lambda: ek.encapsulate())
    decap = _time(lambda: dk.decapsulate(ct))
    ek_len = len(ek.public_bytes_raw())
    return {
        "server_us": encap,
        "client_us": keygen + decap,
        "client_share_bytes": ek_len,
        "server_share_bytes": len(ct),
        "mlkem": {"keygen_us": keygen, "encaps_us": encap, "decaps_us": decap, "encapsulation_key_bytes": ek_len, "ciphertext_bytes": len(ct)},
    }


def _kex_x25519mlkem768(pure: dict) -> dict:
    """Hybrid: X25519 ECDHE + ML-KEM-768 (the pure ML-KEM-768 timings plus one X25519 exchange per side)."""
    x = _kex_x25519()
    return {
        "server_us": x["server_us"] + pure["server_us"],
        "client_us": x["client_us"] + pure["client_us"],
        "client_share_bytes": pure["client_share_bytes"] + 32,
        "server_share_bytes": pure["server_share_bytes"] + 32,
        "mlkem": pure["mlkem"],
    }


@functools.cache
def run() -> dict:
    started = time.perf_counter()
    mlkem768 = _kex_mlkem(mlkem.MLKEM768PrivateKey)
    out = {
        "host": f"{platform.system()} {platform.machine()} · Python {platform.python_version()}",
        "library": f"cryptography {cryptography.__version__} · {ossl.openssl_version_text()}",
        "kex": {"x25519": _kex_x25519(), "secp256r1": _kex_p256(), "X25519MLKEM768": _kex_x25519mlkem768(mlkem768), "MLKEM768": mlkem768, "MLKEM1024": _kex_mlkem(mlkem.MLKEM1024PrivateKey)},
        "sig": {
            "RSA-2048": _sig_rsa(2048),
            "RSA-3072": _sig_rsa(3072),
            "RSA-4096": _sig_rsa(4096),
            "ECDSA P-256": _sig_ecdsa(ec.SECP256R1()),
            "ECDSA P-384": _sig_ecdsa(ec.SECP384R1()),
            "ML-DSA-44": _sig_mldsa(mldsa.MLDSA44PrivateKey),
            "ML-DSA-65": _sig_mldsa(mldsa.MLDSA65PrivateKey),
            "ML-DSA-87": _sig_mldsa(mldsa.MLDSA87PrivateKey),
        },
    }
    out["measured_in_ms"] = round((time.perf_counter() - started) * 1000)
    return out
