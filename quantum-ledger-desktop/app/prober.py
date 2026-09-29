"""DETECT: mock TLS/SSH prober that emits a CycloneDX 1.6 CBOM.

Real deployments would drive OpenSSL 3.5 (`openssl s_client -connect host:443
-groups X25519MLKEM768:X25519 -sigalgs ...`) and `ssh-keyscan`. Here the
"network" is the `estate` table, and each probe returns a placeholder
handshake record shaped like what those tools report.
"""

from __future__ import annotations

import uuid

from .db import Database
from .ledger import now_iso

# Algorithm catalogue: OIDs and NIST PQC security levels as used in CycloneDX cryptoProperties.
ALGORITHMS: dict[str, dict] = {
    "RSA-2048": {"primitive": "signature", "family": "RSA", "oid": "1.2.840.113549.1.1.11", "param": "2048", "nist_level": 0, "standard": "PKCS#1 v1.5 (sha256WithRSAEncryption)"},
    "RSA-3072": {"primitive": "signature", "family": "RSA", "oid": "1.2.840.113549.1.1.11", "param": "3072", "nist_level": 0, "standard": "PKCS#1 v1.5 (sha256WithRSAEncryption)"},
    "ECDSA-P256": {"primitive": "signature", "family": "ECDSA", "oid": "1.2.840.10045.4.3.2", "param": "P-256", "nist_level": 0, "standard": "FIPS 186-5 (ecdsa-with-SHA256)"},
    "ECDSA-P384": {"primitive": "signature", "family": "ECDSA", "oid": "1.2.840.10045.4.3.3", "param": "P-384", "nist_level": 0, "standard": "FIPS 186-5 (ecdsa-with-SHA384)"},
    "ML-DSA-65": {"primitive": "signature", "family": "ML-DSA", "oid": "2.16.840.1.101.3.4.3.18", "param": "65", "nist_level": 3, "standard": "FIPS 204 (Module-Lattice-Based Digital Signature)"},
    "ML-DSA-87": {"primitive": "signature", "family": "ML-DSA", "oid": "2.16.840.1.101.3.4.3.19", "param": "87", "nist_level": 5, "standard": "FIPS 204 (Module-Lattice-Based Digital Signature)"},
    "X25519": {"primitive": "key-agree", "family": "ECDH", "oid": "1.3.101.110", "param": "X25519", "nist_level": 0, "standard": "RFC 7748"},
    "ECDHE-P256": {"primitive": "key-agree", "family": "ECDH", "oid": "1.2.840.10045.3.1.7", "param": "P-256", "nist_level": 0, "standard": "SP 800-56A"},
    "curve25519-sha256": {"primitive": "key-agree", "family": "ECDH", "oid": "1.3.101.110", "param": "X25519", "nist_level": 0, "standard": "RFC 8731"},
    "X25519MLKEM768": {"primitive": "kem", "family": "ML-KEM", "oid": "2.16.840.1.101.3.4.4.2", "param": "768", "nist_level": 3, "standard": "FIPS 203 (ML-KEM-768) hybrid with X25519"},
    "mlkem768x25519-sha256": {"primitive": "kem", "family": "ML-KEM", "oid": "2.16.840.1.101.3.4.4.2", "param": "768", "nist_level": 3, "standard": "FIPS 203 (ML-KEM-768) hybrid with X25519"},
}

# The simulated estate. shelf_life_years = Y in Mosca (how long signatures/data must stay
# trustworthy). asset_type + exposure feed the migration-time model that predicts X
# (see cwm.predict_migration_time); migration_years is the legacy manual estimate.
DEFAULT_ESTATE: list[dict] = [
    {"id": "payments-gw", "asset_type": "payment-gateway", "host": "payments-gw.corp.local", "port": 443, "protocol": "TLS 1.2", "service": "Payment gateway (signed transaction receipts)",
     "signature_alg": "RSA-2048", "key_exchange": "ECDHE-P256", "exposure": "internet", "shelf_life_years": 10, "migration_years": 3},
    {"id": "sso", "asset_type": "identity-provider", "host": "sso.corp.local", "port": 443, "protocol": "TLS 1.3", "service": "Single sign-on (SAML/OIDC token signing)",
     "signature_alg": "ECDSA-P256", "key_exchange": "X25519", "exposure": "internet", "shelf_life_years": 5, "migration_years": 3},
    {"id": "codesign", "asset_type": "code-signing", "host": "codesign.corp.local", "port": 443, "protocol": "TLS 1.2", "service": "Firmware code-signing service",
     "signature_alg": "RSA-2048", "key_exchange": "ECDHE-P256", "exposure": "internal", "shelf_life_years": 15, "migration_years": 4},
    {"id": "bastion", "asset_type": "bastion", "host": "bastion.corp.local", "port": 22, "protocol": "SSH-2.0", "service": "Admin bastion (host key authentication)",
     "signature_alg": "ECDSA-P256", "key_exchange": "curve25519-sha256", "exposure": "internal", "shelf_life_years": 5, "migration_years": 3},
    {"id": "pqc-pilot", "asset_type": "api-service", "host": "pqc-pilot.corp.local", "port": 443, "protocol": "TLS 1.3", "service": "PQC pilot API",
     "signature_alg": "ML-DSA-65", "key_exchange": "X25519MLKEM768", "exposure": "internet", "shelf_life_years": 10, "migration_years": 0},
]


def seed_estate(db: Database) -> None:
    if db.one("SELECT 1 AS x FROM estate LIMIT 1"):
        # Databases created before asset_type existed: fill it in for the known hosts.
        with db.tx() as c:
            for h in DEFAULT_ESTATE:
                c.execute("UPDATE estate SET asset_type=? WHERE id=? AND asset_type='generic'", (h["asset_type"], h["id"]))
        return
    with db.tx() as c:
        for h in DEFAULT_ESTATE:
            c.execute(
                "INSERT INTO estate (id,host,port,protocol,service,signature_alg,key_exchange,exposure,shelf_life_years,migration_years,asset_type) "
                "VALUES (:id,:host,:port,:protocol,:service,:signature_alg,:key_exchange,:exposure,:shelf_life_years,:migration_years,:asset_type)",
                h,
            )


def probe(host: dict) -> dict:
    """Placeholder handshake record (what `openssl s_client` / `ssh-keyscan` would report)."""
    if host["protocol"].startswith("SSH"):
        return {
            "tool": "ssh-keyscan (simulated)",
            "banner": "SSH-2.0-OpenSSH_9.6",
            "kex": host["key_exchange"],
            "host_key_algorithm": "ecdsa-sha2-nistp256" if host["signature_alg"].startswith("ECDSA") else host["signature_alg"].lower(),
            "simulated": True,
        }
    sig = host["signature_alg"]
    peer_sig = {"RSA-2048": "rsa_pkcs1_sha256", "RSA-3072": "rsa_pkcs1_sha256", "ECDSA-P256": "ecdsa_secp256r1_sha256",
                "ECDSA-P384": "ecdsa_secp384r1_sha384", "ML-DSA-65": "mldsa65", "ML-DSA-87": "mldsa87"}.get(sig, sig)
    return {
        "tool": "openssl s_client 3.5 (simulated)",
        "command": f"openssl s_client -connect {host['host']}:{host['port']} -groups X25519MLKEM768:X25519:P-256 -brief",
        "protocol_version": host["protocol"].replace("TLS ", "TLSv"),
        "negotiated_group": host["key_exchange"],
        "peer_signature_type": peer_sig,
        "certificate": {
            "subject": f"CN={host['host']}",
            "issuer": "CN=Corp Issuing CA 2 (ML-DSA-65)" if sig.startswith("ML-DSA") else "CN=Corp Issuing CA 1",
            "public_key_algorithm": sig,
            "signature_algorithm": sig,
            "not_after": "2028-03-31T23:59:59Z",
        },
        "simulated": True,
    }


def _ref(kind: str, name: str) -> str:
    return f"crypto/{kind}/{name.lower()}"


def build_cbom(hosts: list[dict], handshakes: dict[str, dict]) -> dict:
    """CycloneDX 1.6 CBOM: algorithms, certificates and protocols as cryptographic-asset components."""
    components: dict[str, dict] = {}
    dependencies: list[dict] = []

    def algorithm(name: str) -> str:
        ref = _ref("algorithm", name)
        if ref not in components:
            a = ALGORITHMS[name]
            funcs = ["sign", "verify"] if a["primitive"] == "signature" else (["encapsulate", "decapsulate"] if a["primitive"] == "kem" else ["keygen"])
            components[ref] = {
                "type": "cryptographic-asset",
                "bom-ref": ref,
                "name": name,
                "cryptoProperties": {
                    "assetType": "algorithm",
                    "algorithmProperties": {
                        "primitive": a["primitive"],
                        "parameterSetIdentifier": a["param"],
                        "executionEnvironment": "software-plain-ram",
                        "implementationPlatform": "generic",
                        "cryptoFunctions": funcs,
                        "nistQuantumSecurityLevel": a["nist_level"],
                    },
                    "oid": a["oid"],
                },
                "properties": [{"name": "ql:standard", "value": a["standard"]}],
            }
        return ref

    for h in hosts:
        hs = handshakes[h["id"]]
        sig_ref = algorithm(h["signature_alg"])
        kx_ref = algorithm(h["key_exchange"])
        proto_ref = f"crypto/protocol/{h['id']}"
        proto_type = "ssh" if h["protocol"].startswith("SSH") else "tls"
        components[proto_ref] = {
            "type": "cryptographic-asset",
            "bom-ref": proto_ref,
            "name": f"{h['protocol']} @ {h['host']}:{h['port']}",
            "cryptoProperties": {
                "assetType": "protocol",
                "protocolProperties": {
                    "type": proto_type,
                    "version": h["protocol"].split(" ")[-1].replace("SSH-", ""),
                    "cipherSuites": [{"name": hs.get("negotiated_group") or hs.get("kex"), "algorithms": [kx_ref, sig_ref]}],
                },
            },
            "properties": [
                {"name": "ql:service", "value": h["service"]},
                {"name": "ql:exposure", "value": h["exposure"]},
                {"name": "ql:probe", "value": hs["tool"]},
            ],
        }
        deps = [sig_ref, kx_ref]
        if proto_type == "tls":
            cert_ref = f"crypto/certificate/{h['id']}"
            cert = hs["certificate"]
            components[cert_ref] = {
                "type": "cryptographic-asset",
                "bom-ref": cert_ref,
                "name": cert["subject"],
                "cryptoProperties": {
                    "assetType": "certificate",
                    "certificateProperties": {
                        "subjectName": cert["subject"],
                        "issuerName": cert["issuer"],
                        "notValidAfter": cert["not_after"],
                        "signatureAlgorithmRef": sig_ref,
                        "subjectPublicKeyRef": sig_ref,
                        "certificateFormat": "X.509",
                    },
                },
            }
            deps.append(cert_ref)
        dependencies.append({"ref": proto_ref, "dependsOn": deps})

    return {
        "bomFormat": "CycloneDX",
        "specVersion": "1.6",
        "serialNumber": f"urn:uuid:{uuid.uuid4()}",
        "version": 1,
        "metadata": {
            "timestamp": now_iso(),
            "tools": {"components": [{"type": "application", "name": "QuantumLedger prober", "version": "0.1.0"}]},
            "component": {"type": "application", "name": "corp-estate", "bom-ref": "corp-estate"},
        },
        "components": list(components.values()),
        "dependencies": dependencies,
    }


def scan(db: Database) -> tuple[list[dict], dict]:
    """Probe every host in the estate; return per-asset records and the CBOM."""
    seed_estate(db)
    hosts = db.query("SELECT * FROM estate ORDER BY id")
    handshakes = {h["id"]: probe(h) for h in hosts}
    ts = now_iso()
    assets = [
        {
            "id": h["id"], "host": h["host"], "port": h["port"], "protocol": h["protocol"], "service": h["service"], "asset_type": h["asset_type"],
            "signature_alg": h["signature_alg"], "key_exchange": h["key_exchange"], "exposure": h["exposure"],
            "handshake": handshakes[h["id"]], "scanned_at": ts,
        }
        for h in hosts
    ]
    return assets, build_cbom(hosts, handshakes)
