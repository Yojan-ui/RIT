"""SCORE: Mosca's inequality.

    X = how long signatures / data must stay trustworthy (shelf life)
    Y = how long it takes to migrate this system
    Z = years until a cryptographically relevant quantum computer (CRQC)

If X + Y > Z, anything protected by a Shor-breakable algorithm will be
forgeable (signatures) or readable (key exchange) while it still matters.
FIPS 204 ML-DSA and FIPS 203 ML-KEM are not broken by Shor's algorithm, so
assets using them are safe regardless of Z.
"""

from __future__ import annotations

from .prober import ALGORITHMS

DEFAULT_Z_YEARS = 7.0  # assumption: CRQC around 2033; editable per assessment

SHOR_BREAKABLE = {"RSA", "ECDSA", "ECDH"}
PQC_SAFE = {"ML-DSA", "ML-KEM"}


def mosca(x: float, y: float, z: float) -> dict:
    return {"x": x, "y": y, "z": z, "x_plus_y": x + y, "holds": x + y > z, "margin_years": round(x + y - z, 2)}


def classify_signature(alg: str) -> str:
    family = ALGORITHMS[alg]["family"]
    if family in PQC_SAFE:
        return "pqc"
    if family in SHOR_BREAKABLE:
        return "shor-breakable"
    return "unknown"


def classify_kex(alg: str) -> dict:
    a = ALGORITHMS[alg]
    if a["family"] == "ML-KEM":
        return {"status": "pq-hybrid", "note": f"{alg}: {a['standard']}"}
    return {"status": "hndl-exposed", "note": f"{alg} is Shor-breakable: traffic recorded today can be decrypted later (harvest now, decrypt later)."}


def score_asset(asset: dict, x: float, y: float, z: float) -> dict:
    """Status + 0-100 risk score for one asset."""
    m = mosca(x, y, z)
    sig_class = classify_signature(asset["signature_alg"])
    kex = classify_kex(asset["key_exchange"])

    if sig_class == "pqc":
        status = "safe"
        risk = 0.0 if kex["status"] == "pq-hybrid" else 15.0
        reason = f"{asset['signature_alg']} ({ALGORITHMS[asset['signature_alg']]['standard']}) resists Shor's algorithm."
    elif sig_class == "shor-breakable" and m["holds"]:
        status = "forgeable"
        # 55 base, up to +25 for how far past the CRQC horizon, +12 internet exposure, +8 classical key exchange
        risk = 55 + min(25.0, m["margin_years"] * 4) + (12 if asset["exposure"] == "internet" else 4) + (8 if kex["status"] == "hndl-exposed" else 0)
        reason = (
            f"X + Y = {m['x_plus_y']:g} > Z = {z:g}: {asset['signature_alg']} signatures made today "
            f"must stay trusted for {x:g} years, but a CRQC could forge them in {z:g}."
        )
    elif sig_class == "shor-breakable":
        status = "vulnerable"
        risk = 35 + (8 if asset["exposure"] == "internet" else 0)
        reason = f"X + Y = {m['x_plus_y']:g} ≤ Z = {z:g}: Shor-breakable, but the migration window is still open."
    else:
        status = "unknown"
        risk = 50.0
        reason = "Unrecognised algorithm."

    return {
        "status": status,
        "risk_score": round(min(100.0, risk), 1),
        "mosca": m,
        "signature_class": sig_class,
        "key_exchange": kex,
        "reason": reason,
    }


def assess(assets: list[dict], estate: dict[str, dict], z: float = DEFAULT_Z_YEARS) -> list[dict]:
    """Score and rank (highest risk first)."""
    ranked = []
    for a in assets:
        e = estate[a["id"]]
        s = score_asset(a, e["shelf_life_years"], e["migration_years"], z)
        ranked.append({**a, **s})
    ranked.sort(key=lambda r: (-r["risk_score"], r["id"]))
    for i, r in enumerate(ranked, 1):
        r["rank"] = i
    return ranked
