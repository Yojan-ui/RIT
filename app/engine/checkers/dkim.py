"""DKIM checker: probe selectors and assess published keys (RFC 6376, RFC 8301, RFC 8463)."""

from __future__ import annotations

import asyncio
import base64
import binascii
import re

from cryptography.hazmat.primitives.asymmetric import ed25519, rsa
from cryptography.hazmat.primitives.serialization import load_der_public_key

from app.core.constants import COMMON_DKIM_SELECTORS, DKIM_SUFFIX
from app.engine.checkers.base import BaseChecker, ScanContext, parse_tag_list, status_from_findings
from app.models.enums import CheckName, CheckStatus, Severity
from app.models.schemas import CheckResult, Finding


def looks_like_dkim(record: str) -> bool:
    tags, _ = parse_tag_list(record)
    return "p" in tags and tags.get("v", "DKIM1") == "DKIM1"


def analyze_key(selector: str, record: str) -> tuple[dict, list[Finding]]:
    """Decode one DKIM key record. Returns (key info, findings)."""
    tags, problems = parse_tag_list(record)
    key_type = tags.get("k", "rsa").lower()
    raw_p = re.sub(r"\s+", "", tags.get("p", ""))
    hashes = [h.strip().lower() for h in tags.get("h", "").split(":") if h.strip()]
    flags = [t.strip().lower() for t in tags.get("t", "").split(":") if t.strip()]
    info: dict = {
        "selector": selector,
        "key_type": key_type,
        "bits": None,
        "revoked": not raw_p,
        "testing": "y" in flags,
        "hash_algorithms": hashes or ["sha256"],
    }
    label = f"selector '{selector}'"
    findings = [Finding(title=f"Malformed record ({label})", detail=p, severity=Severity.LOW) for p in problems]

    if not raw_p:
        findings.append(Finding(title=f"Revoked key ({label})", detail="Empty p= means the key has been revoked.", severity=Severity.INFO))
        return info, findings

    try:
        key_bytes = base64.b64decode(raw_p, validate=True)
    except (binascii.Error, ValueError):
        findings.append(
            Finding(title=f"Undecodable key ({label})", detail="p= is not valid base64.", severity=Severity.HIGH)
        )
        return info, findings

    if key_type == "ed25519":
        # RFC 8463: the raw 32-byte public key, not DER.
        try:
            ed25519.Ed25519PublicKey.from_public_bytes(key_bytes)
        except ValueError:
            findings.append(Finding(title=f"Invalid Ed25519 key ({label})", detail="Expected 32 raw bytes.", severity=Severity.HIGH))
        else:
            info["bits"] = 256
        return info, findings

    if key_type != "rsa":
        findings.append(Finding(title=f"Unknown key type k={key_type} ({label})", severity=Severity.MEDIUM))
        return info, findings

    try:
        key = load_der_public_key(key_bytes)
    except (ValueError, TypeError):
        findings.append(
            Finding(title=f"Unparseable RSA key ({label})", detail="p= is not a DER-encoded RSA public key.", severity=Severity.HIGH)
        )
        return info, findings
    if not isinstance(key, rsa.RSAPublicKey):
        findings.append(Finding(title=f"Key type mismatch ({label})", detail="k=rsa but the key is not RSA.", severity=Severity.HIGH))
        return info, findings

    bits = key.key_size
    info["bits"] = bits
    if bits < 1024:
        findings.append(
            Finding(
                title=f"{bits}-bit RSA key ({label})",
                detail="Keys under 1024 bits MUST NOT be used and verifiers treat them as invalid (RFC 8301 §3.2); "
                "short keys are also factorable, letting attackers forge signatures.",
                severity=Severity.HIGH,
                recommendation="Rotate to a 2048-bit RSA key.",
            )
        )
    elif bits < 2048:
        findings.append(
            Finding(
                title=f"{bits}-bit RSA key ({label})",
                detail="Signers SHOULD use at least 2048-bit keys (RFC 8301 §3.2).",
                severity=Severity.MEDIUM,
                recommendation="Rotate to a 2048-bit RSA key.",
            )
        )
    if hashes and "sha256" not in hashes:
        findings.append(
            Finding(
                title=f"SHA-1 only ({label})",
                detail="rsa-sha1 MUST NOT be used for signing or verifying (RFC 8301 §3.1).",
                severity=Severity.HIGH,
                recommendation="Remove h= or set h=sha256.",
            )
        )
    if info["testing"]:
        findings.append(
            Finding(
                title=f"Testing mode t=y ({label})",
                detail="Verifiers may treat failures as if the message were unsigned.",
                severity=Severity.LOW,
            )
        )
    return info, findings


class DKIMChecker(BaseChecker):
    name = CheckName.DKIM

    async def check(self, ctx: ScanContext) -> CheckResult:
        selectors = list(dict.fromkeys([*ctx.dkim_selectors, *COMMON_DKIM_SELECTORS]))
        answers = await asyncio.gather(*(ctx.txt(f"{s}.{DKIM_SUFFIX}.{ctx.domain}") for s in selectors))

        # A record returned for (nearly) every guessed selector is a *._domainkey wildcard.
        seen: dict[str, int] = {}
        for answer in answers:
            for record in answer.records:
                seen[record] = seen.get(record, 0) + 1
        wildcard = next((r for r, n in seen.items() if n >= 3 and looks_like_dkim(r)), None)

        keys: list[dict] = []
        findings: list[Finding] = []
        records: list[str] = []
        errors: dict[str, str] = {}
        if wildcard is not None:
            info, key_findings = analyze_key("*", wildcard)
            info["wildcard"] = True
            keys.append(info)
            findings.extend(key_findings)
            records.append(f"*: {wildcard}")
        for selector, answer in zip(selectors, answers):
            if answer.error:
                errors[selector] = answer.error
                continue
            for record in answer.records:
                if record == wildcard:
                    continue
                if not looks_like_dkim(record):
                    continue
                info, key_findings = analyze_key(selector, record)
                keys.append(info)
                findings.extend(key_findings)
                records.append(f"{selector}: {record}")

        data = {"selectors_probed": selectors, "keys": keys, "errors": errors}
        active = [k for k in keys if not k["revoked"]]
        if active:
            strongest = max((k["bits"] or 0) for k in active)
            return self.result(
                status_from_findings(findings),
                f"{len(active)} active key{'s' if len(active) != 1 else ''} "
                f"({', '.join(k['selector'] for k in active)}); strongest {strongest} bits",
                records=records,
                findings=findings,
                data=data,
            )

        if wildcard is not None and not active:
            findings.append(
                Finding(
                    title="Wildcard revoked DKIM key",
                    detail="Every selector resolves to an empty (revoked) key, so no DKIM signature can "
                    "ever validate for this domain. This is a common hardening step for domains that send no mail.",
                    severity=Severity.INFO,
                )
            )
            return self.result(
                CheckStatus.PASS,
                "Wildcard revoked key: domain signs no mail",
                records=records,
                findings=findings,
                data=data | {"wildcard": True},
            )

        if errors and len(errors) == len(selectors):
            return self.dns_error(f"*.{DKIM_SUFFIX}.{ctx.domain}", next(iter(errors.values())))

        if ctx.dkim_selectors:
            findings.append(
                Finding(
                    title="No DKIM key at the supplied selectors",
                    detail=f"Checked {', '.join(ctx.dkim_selectors)} plus {len(COMMON_DKIM_SELECTORS)} common selectors.",
                    severity=Severity.HIGH,
                    recommendation="Publish a DKIM key and sign outgoing mail.",
                )
            )
            return self.result(CheckStatus.MISSING, "No DKIM key found", records=records, findings=findings, data=data)

        # Selectors are not discoverable via DNS, so failing to guess one is not proof of absence.
        findings.append(
            Finding(
                title="No DKIM key at common selectors",
                detail=f"Probed {len(selectors)} common selectors without finding an active key. DKIM may still be "
                "configured under a custom selector (see the s= tag of a DKIM-Signature header).",
                severity=Severity.INFO,
                recommendation="Re-scan with your selector to assess the key.",
            )
        )
        return self.result(
            CheckStatus.NOT_ASSESSED,
            "No key at common selectors; supply a selector to assess",
            records=records,
            findings=findings,
            data=data,
        )
