"""Pydantic request/response schemas."""

from __future__ import annotations

from datetime import datetime, timezone

from pydantic import BaseModel, Field, field_validator

from app.core.constants import DKIM_SELECTOR_REGEX
from app.engine.dns_resolver import normalize_domain
from app.models.enums import CheckName, CheckStatus, Grade, Severity


class ScanRequest(BaseModel):
    domain: str = Field(..., examples=["example.com"])
    dkim_selectors: list[str] = Field(default_factory=list)
    force_refresh: bool = False

    @field_validator("domain")
    @classmethod
    def _validate_domain(cls, v: str) -> str:
        return normalize_domain(v)

    @field_validator("dkim_selectors", mode="before")
    @classmethod
    def _validate_selectors(cls, v):
        if isinstance(v, str):
            v = v.replace(",", " ").split()
        selectors: list[str] = []
        for raw in v or []:
            sel = str(raw).strip().lower()
            if not sel:
                continue
            if not DKIM_SELECTOR_REGEX.match(sel):
                raise ValueError(f"invalid DKIM selector: {raw!r}")
            if sel not in selectors:
                selectors.append(sel)
        if len(selectors) > 20:
            raise ValueError("at most 20 DKIM selectors may be supplied")
        return selectors


class Finding(BaseModel):
    title: str
    detail: str = ""
    severity: Severity = Severity.INFO
    recommendation: str | None = None


class CheckResult(BaseModel):
    name: CheckName
    status: CheckStatus
    summary: str = ""
    records: list[str] = Field(default_factory=list)
    findings: list[Finding] = Field(default_factory=list)
    data: dict = Field(default_factory=dict)


class AttackPath(BaseModel):
    id: str
    title: str
    description: str
    severity: Severity
    enabled_by: list[CheckName] = Field(default_factory=list)


class ScoreBreakdown(BaseModel):
    score: int = Field(..., ge=0, le=100)
    grade: Grade
    components: dict[str, float] = Field(default_factory=dict)
    # Checks excluded from the denominator because they could not be measured.
    not_assessed: list[str] = Field(default_factory=list)


class ScanResult(BaseModel):
    domain: str
    scanned_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    cached: bool = False
    checks: list[CheckResult] = Field(default_factory=list)
    score: ScoreBreakdown
    attack_paths: list[AttackPath] = Field(default_factory=list)


class HealthResponse(BaseModel):
    status: str = "ok"
    app: str
    version: str
