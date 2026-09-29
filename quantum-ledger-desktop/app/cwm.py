"""Context-Weighted Mosca (CWM) risk scoring.

Mosca's inequality says quantum-vulnerable cryptography is a problem when

    X + Y > Z

    X  years needed to migrate the system to post-quantum cryptography
    Y  years the protected data / signatures must stay trustworthy (shelf life)
    Z  years until a cryptographically relevant quantum computer (CRQC)

CWM turns that binary test into a continuous 0-100 score and weights it by
context:

    Risk = ((X_ML + Y) / Z) × Exposure_Weight × Crypto_Fragility × 100, capped at 100

X_ML is not a static guess. It is designed to be supplied by a regression
model (scikit-learn / XGBoost) trained on network-topology datasets such as
Rapid7 Project Sonar, predicting how long an asset of a given type in a given
network zone takes to migrate. This prototype ships a deterministic stand-in
(`predict_migration_time`) with the same interface, so the trained model can be
dropped in without touching the scoring code.
"""

from __future__ import annotations

from enum import Enum

from pydantic import BaseModel, Field


class Severity(str, Enum):
    LOW = "Low"
    HIGH = "High"
    CRITICAL = "CRITICAL"


class CWMConfig(BaseModel):
    """Tunable multipliers. Algorithms not listed default to `default_fragility` (conservative)."""

    exposure_weights: dict[str, float] = Field(
        default_factory=lambda: {"internet": 1.2, "internal": 0.8},
        description="Multiplier by network zone: internet-facing assets are attacked first.",
    )
    crypto_fragility: dict[str, float] = Field(
        default_factory=lambda: {
            "RSA-2048": 1.0,
            "ECDSA-P256": 1.0,
            "ML-DSA-65": 0.1,
            # same families, also in the prober's catalogue
            "RSA-3072": 1.0,
            "ECDSA-P384": 1.0,
            "ML-DSA-87": 0.1,
        },
        description="How breakable the signature algorithm is by a CRQC (1.0 = Shor-breakable, 0.1 = FIPS 204 ML-DSA).",
    )
    default_exposure: float = 1.0
    default_fragility: float = 1.0
    severity_thresholds: tuple[float, float] = Field((40.0, 70.0), description="Scores below the first are Low, below the second High, else CRITICAL.")
    max_score: float = 100.0


DEFAULT_CONFIG = CWMConfig()


class MigrationPrediction(BaseModel):
    """Output of the migration-time model (X_ML)."""

    years: float = Field(..., ge=0, description="Predicted years to migrate this asset to PQC (X_ML).")
    asset_type: str
    network_zone: str
    model: str = Field(..., description="Identifier of the model that produced the prediction.")
    features: dict[str, float | str] = Field(default_factory=dict, description="Inputs the prediction was based on.")


class CWMScore(BaseModel):
    """Full breakdown of one CWM score, so every number on screen can be explained."""

    score: float = Field(..., ge=0, le=100, description="Context-Weighted Mosca risk score, 0-100.")
    severity: Severity
    x_ml: float = Field(..., description="Predicted migration time in years (from the ML model).")
    y_shelf_life: float
    z_crqc: float
    mosca_ratio: float = Field(..., description="(X_ML + Y) / Z; above 1 means Mosca's inequality holds.")
    exposure_weight: float
    crypto_fragility: float
    raw_score: float = Field(..., description="Score before the 100 cap.")
    capped: bool
    prediction: MigrationPrediction


# ── X_ML: migration-time model ────────────────────────────────────────────────

# Baseline years to migrate, by asset type. Stand-in for the trained model's learned effects:
# payment and code-signing systems carry heavy change control, HSMs and partner dependencies;
# a bastion is a single host with a config change.
_BASE_MIGRATION_YEARS: dict[str, float] = {
    "payment-gateway": 4.5,
    "code-signing": 5.0,
    "identity-provider": 3.0,
    "api-service": 1.5,
    "bastion": 0.4,
}
_DEFAULT_BASE_YEARS = 2.5

# Zone effect: internal systems tend to hide legacy dependencies that slow migration.
_ZONE_FACTOR: dict[str, float] = {"internet": 1.0, "internal": 1.25}

MODEL_ID = "cwm-migration-heuristic-v1 (stand-in for XGBoost trained on Rapid7 Sonar)"


def predict_migration_time(asset_type: str, network_zone: str) -> MigrationPrediction:
    """Predict X_ML, the years needed to migrate an asset to post-quantum cryptography.

    Production design: a gradient-boosted regressor (XGBoost, or any scikit-learn
    estimator exposing ``predict``) trained on network-topology data such as
    Rapid7 Project Sonar, with features like asset role, network zone, exposed
    services, TLS stack and dependency fan-out, and the observed migration
    duration as the target. The model is loaded once and called here.

    This prototype returns deterministic values from a lookup table plus a zone
    adjustment, with the same signature and return type, so swapping in the
    trained model is a one-function change. For example ``payment-gateway`` on
    the internet predicts 4.5 years and ``bastion`` on the internal network 0.5.
    """
    base = _BASE_MIGRATION_YEARS.get(asset_type, _DEFAULT_BASE_YEARS)
    zone = _ZONE_FACTOR.get(network_zone, 1.0)
    return MigrationPrediction(
        years=round(base * zone, 2),
        asset_type=asset_type,
        network_zone=network_zone,
        model=MODEL_ID,
        features={"asset_type": asset_type, "network_zone": network_zone, "base_years": base, "zone_factor": zone},
    )


# ── CWM score ─────────────────────────────────────────────────────────────────


def severity_for(score: float, config: CWMConfig = DEFAULT_CONFIG) -> Severity:
    """0-39 Low, 40-69 High, 70-100 CRITICAL (thresholds configurable)."""
    low_max, high_max = config.severity_thresholds
    if score < low_max:
        return Severity.LOW
    if score < high_max:
        return Severity.HIGH
    return Severity.CRITICAL


def cwm_score(
    *,
    asset_type: str,
    network_zone: str,
    signature_alg: str,
    shelf_life_years: float,
    z_years: float,
    config: CWMConfig = DEFAULT_CONFIG,
    prediction: MigrationPrediction | None = None,
) -> CWMScore:
    """Risk = ((X_ML + Y) / Z) × Exposure_Weight × Crypto_Fragility × 100, capped at `config.max_score`.

    `prediction` can be passed in (e.g. from a batched model call); otherwise
    `predict_migration_time` is used.
    """
    if z_years <= 0:
        raise ValueError("z_years must be positive")
    pred = prediction or predict_migration_time(asset_type, network_zone)
    exposure = config.exposure_weights.get(network_zone, config.default_exposure)
    fragility = config.crypto_fragility.get(signature_alg, config.default_fragility)
    ratio = (pred.years + shelf_life_years) / z_years
    raw = ratio * exposure * fragility * 100
    score = round(min(config.max_score, raw), 1)
    return CWMScore(
        score=score,
        severity=severity_for(score, config),
        x_ml=pred.years,
        y_shelf_life=shelf_life_years,
        z_crqc=z_years,
        mosca_ratio=round(ratio, 3),
        exposure_weight=exposure,
        crypto_fragility=fragility,
        raw_score=round(raw, 1),
        capped=raw > config.max_score,
        prediction=pred,
    )
