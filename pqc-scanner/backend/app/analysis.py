"""Turn probe results into a PQC readiness assessment and a CycloneDX 1.6 CBOM.

Scoring (100 points):
  50  key exchange     hybrid/pure ML-KEM protects today's traffic from harvest-now-decrypt-later
  25  server key       the leaf certificate key that signs every handshake
  15  CA signature     the issuer's signature on the leaf certificate
  10  protocol         TLS 1.3 (required for hybrid ML-KEM groups)

No public website can reach 100 today: public CAs don't yet issue ML-DSA
(FIPS 204) certificates, so the best real-world result is 60 (hybrid key
exchange on TLS 1.3 with a classical certificate).
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone

from .tlsprobe import CertificateResult, KeyExchangeResult

SHOR = "Vulnerable to Shor's Algorithm (0% PQC Ready)"
SAFE = "Quantum-Safe (100% Ready)"

PQ_SIG_FAMILIES = {"ML-DSA", "SLH-DSA", "FN-DSA", "Falcon"}
CLASSICAL_SIG_FAMILIES = {"RSA", "ECDSA", "EdDSA", "DSA"}

GROUP_INFO = {
    "X25519MLKEM768": ("Hybrid ML-KEM-768 + X25519", "FIPS 203 (ML-KEM-768) hybrid", 3),
    "SecP256r1MLKEM768": ("Hybrid ML-KEM-768 + P-256", "FIPS 203 (ML-KEM-768) hybrid", 3),
    "SecP384r1MLKEM1024": ("Hybrid ML-KEM-1024 + P-384", "FIPS 203 (ML-KEM-1024) hybrid", 5),
    "X25519Kyber768Draft00": ("Hybrid Kyber-768 + X25519 (pre-standard draft)", "Kyber draft (superseded by FIPS 203)", 3),
    "MLKEM512": ("ML-KEM-512", "FIPS 203", 1),
    "MLKEM768": ("ML-KEM-768", "FIPS 203", 3),
    "MLKEM1024": ("ML-KEM-1024", "FIPS 203", 5),
}

OIDS = {
    "X25519MLKEM768": "2.16.840.1.101.3.4.4.2",
    "MLKEM768": "2.16.840.1.101.3.4.4.2",
    "MLKEM1024": "2.16.840.1.101.3.4.4.3",
    "x25519": "1.3.101.110",
    "secp256r1": "1.2.840.10045.3.1.7",
    "secp384r1": "1.3.132.0.34",
}

# NIST IR 8547 (initial public draft, Nov 2024): quantum-vulnerable algorithms deprecated after 2030, disallowed after 2035.
NIST_DEPRECATE, NIST_DISALLOW = 2030, 2035


def _sig_is_pq(family: str) -> bool:
    return family in PQ_SIG_FAMILIES


def _component(name, algorithm, safe, weight, category, threat, detail, label=None):
    return {
        "component": name,
        "algorithm": algorithm,
        "quantum_safe": safe,
        "category": label or (SAFE if safe else SHOR),
        "readiness": 100 if safe else 0,
        "weight": weight,
        "points": weight if safe else 0,
        "classification": category,
        "threat": threat,
        "detail": detail,
    }


def assess(domain: str, kx: KeyExchangeResult, cert: CertificateResult) -> dict:
    leaf = cert.leaf
    key, sig = leaf["public_key"], leaf["signature"]
    tls_version = kx.tls_version or cert.tls_version or "unknown"
    is13 = tls_version == "TLS 1.3"
    group = kx.group or "unknown"

    kex_safe = kx.pq_hybrid
    key_safe = _sig_is_pq(key["family"])
    sig_safe = _sig_is_pq(sig["family"])

    kex_class = GROUP_INFO.get(group, (None, None, 0))[0] if kex_safe else (
        "RSA key transport" if "RSA key transport" in group else "Classical (EC)DH"
    )
    breakdown = [
        _component(
            "Key exchange", group, kex_safe, 50, kex_class,
            "Harvest now, decrypt later: recorded traffic becomes readable once a CRQC exists" if not kex_safe else "Protected against harvest-now-decrypt-later",
            "The server chose a hybrid ML-KEM group when offered one." if kex_safe
            else "X25519MLKEM768 was offered in the ClientHello, but the server chose a classical group.",
        ),
        _component(
            "Server key (leaf certificate)", key["name"], key_safe, 25, key["family"],
            "A CRQC could derive the private key and impersonate the server" if not key_safe else "Resists Shor's algorithm",
            f"{key['name']} signs every TLS handshake for {domain}.",
        ),
        _component(
            "Certificate signature (issuing CA)", sig["name"], sig_safe, 15, sig["family"],
            "A CRQC could forge certificates from this CA" if not sig_safe else "Resists Shor's algorithm",
            f"Issued by {leaf.get('issuer_cn') or leaf.get('issuer')}.",
        ),
        _component(
            "Protocol", tls_version, is13, 10, tls_version,
            "Hybrid ML-KEM groups require TLS 1.3" if not is13 else "Supports hybrid ML-KEM groups",
            "TLS 1.3 negotiated." if is13 else f"Server negotiated {tls_version}; post-quantum key exchange is not possible.",
            label="PQC-capable (TLS 1.3)" if is13 else "Blocks PQC (needs TLS 1.3)",
        ),
    ]
    score = sum(c["points"] for c in breakdown)

    weak = []
    if key["family"] == "RSA" and (key.get("bits") or 0) < 2048:
        weak.append(f"{key['name']} is below the 2048-bit minimum even classically")
    if "sha1" in sig["name"].lower():
        weak.append("SHA-1 certificate signature")
    if tls_version in ("TLS 1.0", "TLS 1.1"):
        weak.append(f"{tls_version} is deprecated")
    if "RSA key transport" in group:
        weak.append("RSA key transport has no forward secrecy")

    classical_auth = f"{key['name']}" if not key_safe else None

    if kex_safe and key_safe and sig_safe:
        status, color = "quantum-ready", "emerald"
        badge = "QUANTUM READY"
        headline = f"QUANTUM READY: {group} key exchange with {key['name']} authentication"
    elif kex_safe:
        status, color = "hybrid", "emerald"
        badge = "HYBRID PQC · PARTIAL"
        headline = f"QUANTUM-SAFE KEY EXCHANGE ({group}) · {classical_auth} certificate still forgeable by a CRQC"
    elif is13 and not weak:
        status, color = "classical", "amber"
        badge = "CRITICAL"
        headline = f"CRITICAL: {classical_auth or key['name']} detected - Forgeable by CRQC · no post-quantum key exchange"
    else:
        status, color = "legacy", "crimson"
        badge = "CRITICAL · LEGACY"
        headline = f"CRITICAL: {classical_auth or key['name']} over {tls_version} - Forgeable by CRQC" + (f" · {weak[0]}" if weak else "")

    if weak:
        urgency = {"level": "CRITICAL", "reason": "; ".join(weak) + ". Fix now: these are weak even against classical attackers.", "deadline": "Immediately"}
    elif not kex_safe:
        urgency = {
            "level": "HIGH",
            "reason": "Session keys use classical (EC)DH. Traffic captured today can be decrypted retroactively once a cryptographically relevant quantum computer exists.",
            "deadline": "Now: hybrid ML-KEM is deployable today in OpenSSL 3.5+, BoringSSL, Go 1.24+ and major CDNs",
        }
    elif not (key_safe and sig_safe):
        urgency = {
            "level": "MEDIUM",
            "reason": "Confidentiality is post-quantum. Authentication is still classical, but it can only be forged by a live CRQC, not retroactively.",
            "deadline": f"Before {NIST_DEPRECATE}: NIST IR 8547 deprecates RSA/ECDSA after {NIST_DEPRECATE} and disallows them after {NIST_DISALLOW}",
        }
    else:
        urgency = {"level": "LOW", "reason": "Key exchange and authentication are post-quantum.", "deadline": "Maintain crypto-agility"}

    recs = []
    if not is13:
        recs.append({"priority": 1, "title": "Enable TLS 1.3", "standard": "RFC 8446",
                     "detail": "Hybrid ML-KEM groups only exist in TLS 1.3. Enable it alongside TLS 1.2, then add the hybrid group."})
    if not kex_safe:
        recs.append({"priority": 1, "title": "Enable hybrid ML-KEM key exchange (X25519MLKEM768)", "standard": "FIPS 203 · ML-KEM-768",
                     "detail": "OpenSSL 3.5+: Groups = X25519MLKEM768:X25519 · nginx (built with OpenSSL 3.5): ssl_ecdh_curve X25519MLKEM768:X25519; "
                               "· or turn it on at your CDN (Cloudflare, Google, Akamai and AWS CloudFront support it). Clients without it fall back to X25519."})
    if weak:
        recs.append({"priority": 1, "title": "Replace weak classical parameters", "standard": "NIST SP 800-131A",
                     "detail": "; ".join(weak) + "."})
    if not (key_safe and sig_safe):
        recs.append({"priority": 2, "title": "Plan the certificate move to ML-DSA-65", "standard": "FIPS 204 · ML-DSA-65 (NIST category 3)",
                     "detail": f"Replace {key['name']} / {sig['name']} with ML-DSA-65 once your CA issues it (public CAs don't yet). "
                               "Meanwhile keep certificate automation (ACME) and crypto-agility so the switch is a config change."})
    if leaf["days_remaining"] < 30:
        recs.append({"priority": 1, "title": "Renew the certificate", "standard": "",
                     "detail": f"It expires in {leaf['days_remaining']} days."})
    if not cert.trusted:
        recs.append({"priority": 1, "title": "Fix certificate trust", "standard": "",
                     "detail": f"Certificate did not verify: {cert.verify_error}."})
    if not recs:
        recs.append({"priority": 3, "title": "Keep a live CBOM", "standard": "CycloneDX 1.6",
                     "detail": "Re-scan after every certificate or TLS change to prove the estate stays post-quantum."})

    return {
        "score": score,
        "grade": "A" if score >= 90 else "B" if score >= 60 else "C" if score >= 40 else "D" if score >= 10 else "F",
        "status": status,
        "color": color,
        "badge": badge,
        "headline": headline,
        "urgency": urgency,
        "breakdown": breakdown,
        "recommendations": sorted(recs, key=lambda r: r["priority"]),
        "max_achievable_today": 60,
    }


def _alg_component(ref: str, name: str, primitive: str, level: int, oid: str | None, standard: str, funcs: list[str]) -> dict:
    props = {"primitive": primitive, "executionEnvironment": "software-plain-ram", "implementationPlatform": "generic",
             "cryptoFunctions": funcs, "nistQuantumSecurityLevel": level}
    comp = {"type": "cryptographic-asset", "bom-ref": ref, "name": name,
            "cryptoProperties": {"assetType": "algorithm", "algorithmProperties": props},
            "properties": [{"name": "pqc:classification", "value": SAFE if level > 0 else SHOR},
                           {"name": "pqc:standard", "value": standard}]}
    if oid:
        comp["cryptoProperties"]["oid"] = oid
    return comp


def build_cbom(domain: str, kx: KeyExchangeResult, cert: CertificateResult) -> dict:
    leaf = cert.leaf
    key, sig = leaf["public_key"], leaf["signature"]
    group = kx.group or "unknown"
    ginfo = GROUP_INFO.get(group)
    components = []
    refs = {}

    def add(ref, comp):
        if ref not in refs:
            refs[ref] = comp
            components.append(comp)
        return ref

    g_ref = add(f"crypto/algorithm/{group.lower()}", _alg_component(
        f"crypto/algorithm/{group.lower()}", group, "kem" if ginfo else "key-agree",
        ginfo[2] if ginfo else 0, OIDS.get(group), ginfo[1] if ginfo else "Classical (EC)DH", ["encapsulate", "decapsulate"] if ginfo else ["keygen"]))
    k_ref = add(f"crypto/algorithm/{key['name'].lower().replace(' ', '-')}", _alg_component(
        f"crypto/algorithm/{key['name'].lower().replace(' ', '-')}", key["name"], "signature",
        3 if _sig_is_pq(key["family"]) else 0, key.get("oid"), key["family"], ["sign", "verify"]))
    s_ref = add(f"crypto/algorithm/{sig['name'].lower()}", _alg_component(
        f"crypto/algorithm/{sig['name'].lower()}", sig["name"], "signature",
        3 if _sig_is_pq(sig["family"]) else 0, sig.get("oid"), sig["family"], ["sign", "verify"]))
    cert_ref = add("crypto/certificate/leaf", {
        "type": "cryptographic-asset", "bom-ref": "crypto/certificate/leaf", "name": leaf.get("subject_cn") or domain,
        "cryptoProperties": {"assetType": "certificate", "certificateProperties": {
            "subjectName": leaf["subject"], "issuerName": leaf["issuer"],
            "notValidBefore": leaf["not_before"], "notValidAfter": leaf["not_after"],
            "signatureAlgorithmRef": s_ref, "subjectPublicKeyRef": k_ref, "certificateFormat": "X.509"}},
    })
    chain_refs = []
    for i, c in enumerate(cert.chain):
        ck = c["public_key"]
        ck_ref = add(f"crypto/algorithm/{ck['name'].lower().replace(' ', '-')}", _alg_component(
            f"crypto/algorithm/{ck['name'].lower().replace(' ', '-')}", ck["name"], "signature",
            3 if _sig_is_pq(ck["family"]) else 0, ck.get("oid"), ck["family"], ["sign", "verify"]))
        chain_refs.append(add(f"crypto/certificate/chain-{i + 1}", {
            "type": "cryptographic-asset", "bom-ref": f"crypto/certificate/chain-{i + 1}", "name": c.get("subject_cn") or f"intermediate {i + 1}",
            "cryptoProperties": {"assetType": "certificate", "certificateProperties": {
                "subjectName": c.get("subject_cn"), "issuerName": c.get("issuer_cn"), "notValidAfter": c.get("not_after"),
                "subjectPublicKeyRef": ck_ref, "certificateFormat": "X.509"}},
        }))
    proto_ref = add("crypto/protocol/tls", {
        "type": "cryptographic-asset", "bom-ref": "crypto/protocol/tls", "name": f"{kx.tls_version or cert.tls_version} @ {domain}:443",
        "cryptoProperties": {"assetType": "protocol", "protocolProperties": {
            "type": "tls", "version": (kx.tls_version or cert.tls_version or "").replace("TLS ", ""),
            "cipherSuites": [{"name": kx.cipher_suite or cert.cipher_suite, "algorithms": [g_ref, k_ref]}]}},
    })
    return {
        "bomFormat": "CycloneDX",
        "specVersion": "1.6",
        "serialNumber": f"urn:uuid:{uuid.uuid4()}",
        "version": 1,
        "metadata": {
            "timestamp": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "tools": {"components": [{"type": "application", "name": "pqc-scanner", "version": "1.0.0"}]},
            "component": {"type": "application", "name": domain, "bom-ref": domain},
        },
        "components": components,
        "dependencies": [{"ref": proto_ref, "dependsOn": [g_ref, cert_ref]}, {"ref": cert_ref, "dependsOn": [k_ref, s_ref, *chain_refs]}],
    }


def cbom_rows(cbom: dict) -> list[dict]:
    """Flat rows for the UI table."""
    rows = []
    for c in cbom["components"]:
        cp = c["cryptoProperties"]
        if cp["assetType"] != "algorithm":
            continue
        props = {p["name"]: p["value"] for p in c.get("properties", [])}
        level = cp["algorithmProperties"]["nistQuantumSecurityLevel"]
        rows.append({
            "name": c["name"],
            "primitive": cp["algorithmProperties"]["primitive"],
            "oid": cp.get("oid"),
            "nist_level": level,
            "quantum_safe": level > 0,
            "classification": props.get("pqc:classification"),
            "family": props.get("pqc:standard"),
        })
    return rows
