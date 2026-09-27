"""Pydantic request/response schemas."""

from __future__ import annotations

from datetime import datetime, timezone

from pydantic import BaseModel, Field, field_validator

from app.core.constants import DKIM_SELECTOR_REGEX
from app.engine.dns_resolver import normalize_domain
from app.models.enums import CheckName, CheckStatus, Exposure, Grade, Severity


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
    # Controls that defend against this path (the matrix columns it depends on).
    enabled_by: list[CheckName] = Field(default_factory=list)
    exposure: Exposure = Exposure.EXPOSED
    # How each deciding control performs for this path specifically (matrix cells).
    # Supporting controls not listed here are shown by their overall check status.
    control_exposure: dict[CheckName, Exposure] = Field(default_factory=dict)
    reason: str = ""
    # The control whose fix closes this path, if one is known.
    fix_control: CheckName | None = None


class Remediation(BaseModel):
    """The single change that removes the most attack-path risk."""

    control: CheckName
    title: str
    action: str
    # DNS record to publish, when the fix is a record change.
    host: str | None = None
    record_type: str | None = None
    record: str | None = None
    closes: list[str] = Field(default_factory=list)
    score_gain: int = 0


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
    # Paths currently exposed or partially exposed.
    attack_paths: list[AttackPath] = Field(default_factory=list)
    # Every known path, including mitigated and unknown ones.
    attack_matrix: list[AttackPath] = Field(default_factory=list)
    one_fix: Remediation | None = None


class RemediationStep(BaseModel):
    priority: int
    finding_id: str
    action: str
    title: str = ""
    severity: Severity | None = None
    rationale: str = ""


class Narrative(BaseModel):
    """Plain-English account of a scan. ``source`` records who wrote it."""

    domain: str
    source: str  # "deterministic" or "llm:<model>"
    summary: str
    attack_scenarios: list[str] = Field(default_factory=list)
    remediation_steps: list[RemediationStep] = Field(default_factory=list)
    model: str | None = None
    generated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    # Why the deterministic writer was used instead of the LLM, if it was.
    fallback_reason: str | None = None


class HealthResponse(BaseModel):
    status: str = "ok"
    app: str
    version: str
