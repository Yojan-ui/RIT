"""SCORE: Mosca's inequality, weighted by context (Context-Weighted Mosca).

    X  years to migrate the system, predicted per asset by the migration model (X_ML)
    Y  years signatures / data must stay trustworthy (shelf life)
    Z  years until a cryptographically relevant quantum computer (CRQC)

Two outputs per asset:
  status      the classic Mosca verdict: `forgeable` (Shor-breakable and X + Y > Z),
              `vulnerable` (Shor-breakable, window still open) or `safe` (FIPS 204 ML-DSA)
  risk_score  the continuous 0-100 CWM score with a Low / High / CRITICAL severity
              (see cwm.py for the formula and the ML design)
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

from . import cwm
from .cwm import CWMConfig, CWMScore, Severity
from .prober import ALGORITHMS

DEFAULT_Z_YEARS = 7.0  # assumption: CRQC around 2033; editable per assessment

SHOR_BREAKABLE = {"RSA", "ECDSA", "ECDH"}
PQC_SAFE = {"ML-DSA", "ML-KEM"}

Status = Literal["forgeable", "vulnerable", "safe", "unknown"]


class Mosca(BaseModel):
    x: float = Field(..., description="Migration time (X_ML, years)")
    y: float = Field(..., description="Shelf life (years)")
    z: float = Field(..., description="Years to a CRQC")
    x_plus_y: float
    holds: bool = Field(..., description="X + Y > Z")
    margin_years: float


class KeyExchange(BaseModel):
    status: Literal["pq-hybrid", "hndl-exposed"]
    note: str


class AssetScore(BaseModel):
    status: Status
    risk_score: float = Field(..., ge=0, le=100)
    severity: Severity
    cwm: CWMScore
    mosca: Mosca
    signature_class: Literal["pqc", "shor-breakable", "unknown"]
    key_exchange: KeyExchange
    reason: str


class RankedAsset(AssetScore):
    rank: int
    id: str
    host: str
    port: int
    protocol: str
    service: str
    signature_alg: str
    key_exchange_alg: str
    exposure: str
    asset_type: str


class AssessSummary(BaseModel):
    forgeable: int
    vulnerable: int
    safe: int


class SeveritySummary(BaseModel):
    CRITICAL: int
    High: int
    Low: int


def mosca(x: float, y: float, z: float) -> Mosca:
    return Mosca(x=x, y=y, z=z, x_plus_y=round(x + y, 2), holds=x + y > z, margin_years=round(x + y - z, 2))


def classify_signature(alg: str) -> Literal["pqc", "shor-breakable", "unknown"]:
    family = ALGORITHMS.get(alg, {}).get("family")
    if family in PQC_SAFE:
        return "pqc"
    if family in SHOR_BREAKABLE:
        return "shor-breakable"
    return "unknown"


def classify_kex(alg: str) -> KeyExchange:
    a = ALGORITHMS[alg]
    if a["family"] == "ML-KEM":
        return KeyExchange(status="pq-hybrid", note=f"{alg}: {a['standard']}")
    return KeyExchange(status="hndl-exposed", note=f"{alg} is Shor-breakable: traffic recorded today can be decrypted later (harvest now, decrypt later).")


def score_asset(asset: dict, estate_row: dict, z: float = DEFAULT_Z_YEARS, config: CWMConfig = cwm.DEFAULT_CONFIG) -> AssetScore:
    """Mosca verdict + CWM score for one asset.

    `asset` supplies the live algorithms (signature_alg, key_exchange); `estate_row`
    supplies the context (asset_type, exposure, shelf_life_years).
    """
    risk = cwm.cwm_score(
        asset_type=estate_row.get("asset_type") or "generic",
        network_zone=estate_row.get("exposure") or asset["exposure"],
        signature_alg=asset["signature_alg"],
        shelf_life_years=float(estate_row["shelf_life_years"]),
        z_years=z,
        config=config,
    )
    m = mosca(risk.x_ml, risk.y_shelf_life, z)
    sig_class = classify_signature(asset["signature_alg"])
    kex = classify_kex(asset["key_exchange"])
    alg = asset["signature_alg"]

    if sig_class == "pqc":
        status: Status = "safe"
        reason = f"{alg} ({ALGORITHMS[alg]['standard']}) resists Shor's algorithm; fragility {risk.crypto_fragility:g} keeps the score low."
    elif sig_class == "shor-breakable" and m.holds:
        status = "forgeable"
        reason = (
            f"X_ML + Y = {m.x_plus_y:g} > Z = {z:g}: migrating takes an estimated {risk.x_ml:g} years and "
            f"{alg} signatures must stay trusted for {risk.y_shelf_life:g}, past a CRQC in {z:g}."
        )
    elif sig_class == "shor-breakable":
        status = "vulnerable"
        reason = f"X_ML + Y = {m.x_plus_y:g} ≤ Z = {z:g}: Shor-breakable, but the migration window is still open."
    else:
        status = "unknown"
        reason = "Unrecognised signature algorithm; scored with the default fragility."

    return AssetScore(
        status=status,
        risk_score=risk.score,
        severity=risk.severity,
        cwm=risk,
        mosca=m,
        signature_class=sig_class,
        key_exchange=kex,
        reason=reason,
    )


def assess(assets: list[dict], estate: dict[str, dict], z: float = DEFAULT_Z_YEARS, config: CWMConfig = cwm.DEFAULT_CONFIG) -> list[RankedAsset]:
    """Score every asset and rank by CWM score (highest risk first).

    Ties at the 100 cap are broken by the uncapped raw score, so the most
    over-exposed asset still ranks first.
    """
    scored = []
    for a in assets:
        e = estate[a["id"]]
        s = score_asset(a, e, z, config)
        scored.append((a, e, s))
    scored.sort(key=lambda t: (-t[2].risk_score, -t[2].cwm.raw_score, t[0]["id"]))
    return [
        RankedAsset(
            **s.model_dump(),
            rank=i,
            id=a["id"],
            host=a["host"],
            port=a["port"],
            protocol=a["protocol"],
            service=a["service"],
            signature_alg=a["signature_alg"],
            key_exchange_alg=a["key_exchange"],
            exposure=a["exposure"],
            asset_type=e.get("asset_type") or "generic",
        )
        for i, (a, e, s) in enumerate(scored, 1)
    ]


def summarise(ranked: list[RankedAsset]) -> tuple[AssessSummary, SeveritySummary]:
    count = lambda pred: sum(1 for r in ranked if pred(r))  # noqa: E731
    return (
        AssessSummary(forgeable=count(lambda r: r.status == "forgeable"), vulnerable=count(lambda r: r.status == "vulnerable"), safe=count(lambda r: r.status == "safe")),
        SeveritySummary(CRITICAL=count(lambda r: r.severity == Severity.CRITICAL), High=count(lambda r: r.severity == Severity.HIGH), Low=count(lambda r: r.severity == Severity.LOW)),
    )
