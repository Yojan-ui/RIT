"""DEFEND: Python stand-in for shield.js.

Upgrades a forgeable TLS asset to:
  signature      ML-DSA-65        (FIPS 204, NIST security category 3)
  key exchange   X25519MLKEM768   (FIPS 203 ML-KEM-768 hybridised with X25519, TLS group 0x11EC)

The OpenSSL 3.5 commands below are placeholders: they are recorded as the
migration runbook and evidence, not executed.
"""

from __future__ import annotations

import hashlib

from .db import dumps
from .ledger import now_iso

TARGET_SIGNATURE = "ML-DSA-65"
TARGET_KEX = "X25519MLKEM768"


class RemediationError(ValueError):
    pass


def plan(asset: dict) -> list[dict]:
    host = asset["host"]
    key = f"/etc/quantumledger/keys/{asset['id']}.mldsa65.key"
    return [
        {"step": "Generate ML-DSA-65 key pair (FIPS 204)", "command": f"openssl genpkey -algorithm ML-DSA-65 -out {key}"},
        {"step": "Create CSR signed with ML-DSA-65", "command": f'openssl req -new -key {key} -subj "/CN={host}" -out {asset["id"]}.csr'},
        {"step": "Issue certificate from the ML-DSA-65 issuing CA", "command": f"openssl x509 -req -in {asset['id']}.csr -CA ca-mldsa65.pem -CAkey ca-mldsa65.key -days 365 -out {asset['id']}.pem"},
        {"step": "Enable hybrid ML-KEM key exchange (FIPS 203)", "command": "openssl.cnf: Groups = X25519MLKEM768:X25519   |   nginx: ssl_ecdh_curve X25519MLKEM768:X25519;"},
        {"step": "Re-probe and confirm negotiated parameters", "command": f"openssl s_client -connect {host}:{asset['port']} -groups X25519MLKEM768 -brief"},
    ]


def upgrade(asset: dict) -> dict:
    """Return the before/after record for migrating `asset`. Raises if it isn't a migratable TLS asset."""
    if not asset["protocol"].startswith("TLS"):
        raise RemediationError(f"{asset['id']}: only TLS endpoints are handled by the demo migration (got {asset['protocol']}).")
    if asset["signature_alg"] == TARGET_SIGNATURE and asset["key_exchange"] == TARGET_KEX:
        raise RemediationError(f"{asset['id']} already uses {TARGET_SIGNATURE} with {TARGET_KEX}.")

    steps = plan(asset)
    after = {"signature_alg": TARGET_SIGNATURE, "key_exchange": TARGET_KEX, "protocol": "TLS 1.3"}
    handshake = {
        "tool": "openssl s_client 3.5 (simulated)",
        "protocol_version": "TLSv1.3",
        "negotiated_group": TARGET_KEX,
        "peer_signature_type": "mldsa65",
        "certificate": {
            "subject": f"CN={asset['host']}",
            "issuer": "CN=Corp Issuing CA 2 (ML-DSA-65)",
            "public_key_algorithm": TARGET_SIGNATURE,
            "signature_algorithm": TARGET_SIGNATURE,
        },
        "simulated": True,
    }
    evidence = {"asset": asset["id"], "steps": steps, "post_handshake": handshake}
    return {
        "asset": asset["id"],
        "host": asset["host"],
        "before": {"signature_alg": asset["signature_alg"], "key_exchange": asset["key_exchange"], "protocol": asset["protocol"]},
        "after": after,
        "steps": steps,
        "post_handshake": handshake,
        "evidence_sha256": hashlib.sha256(dumps(evidence).encode()).hexdigest(),
        "completed_at": now_iso(),
        "simulated": True,
    }
