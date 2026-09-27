"""Pydantic models shared by the collectors, the analysis engine and the API.

Two layers:
  * Observations  - raw facts gathered from DNS / SMTP / HTTPS (no judgement).
  * ScanReport    - the scored, judged view the UI renders.

Keeping them separate lets demo fixtures feed canned Observations through the
exact same analysis code the live scanner uses.
"""

from __future__ import annotations

from datetime import datetime
from enum import Enum
from typing import Any, Literal

from pydantic import BaseModel, Field


class Status(str, Enum):
    PASS = "pass"
    WARN = "warn"
    FAIL = "fail"
    INFO = "info"  # applicable, nothing to judge (e.g. null MX)
    ERROR = "error"  # could not be measured; excluded from scoring


# --------------------------------------------------------------------------- #
# Observations (raw collector output)
# --------------------------------------------------------------------------- #


class TxtLookup(BaseModel):
    records: list[str] = Field(default_factory=list)
    error: str | None = None


class SpfLookup(TxtLookup):
    lookup_count: int | None = None  # RFC 7208 §4.6.4 DNS-lookup budget used
    lookup_error: str | None = None
    lookup_incomplete: bool = False  # walk hit a timeout/SERVFAIL; count unknown


class MxHost(BaseModel):
    preference: int
    host: str
    addresses: list[str] = Field(default_factory=list)


class MxLookup(BaseModel):
    hosts: list[MxHost] = Field(default_factory=list)
    null_mx: bool = False  # RFC 7505 "MX 0 ."
    error: str | None = None


class DkimKey(BaseModel):
    selector: str
    record: str


class DkimLookup(BaseModel):
    selectors_tried: list[str] = Field(default_factory=list)
    keys: list[DkimKey] = Field(default_factory=list)
    failed_selectors: list[str] = Field(default_factory=list)  # timed out / SERVFAIL
    error: str | None = None


class MtaStsLookup(BaseModel):
    txt: TxtLookup = Field(default_factory=TxtLookup)
    policy: str | None = None
    policy_error: str | None = None


class StartTlsProbe(BaseModel):
    host: str
    ip: str | None = None
    port: int = 25
    reachable: bool = False
    banner: str | None = None
    ehlo_ok: bool = False
    starttls_offered: bool = False
    tls_version: str | None = None
    cipher: str | None = None
    cert_valid: bool | None = None
    cert_error: str | None = None
    cert_subject: str | None = None
    cert_issuer: str | None = None
    cert_not_after: str | None = None
    error: str | None = None
    duration_ms: int | None = None


class Observations(BaseModel):
    domain: str
    mx: MxLookup = Field(default_factory=MxLookup)
    spf: SpfLookup = Field(default_factory=SpfLookup)
    dkim: DkimLookup = Field(default_factory=DkimLookup)
    dmarc: TxtLookup = Field(default_factory=TxtLookup)
    mta_sts: MtaStsLookup = Field(default_factory=MtaStsLookup)
    tls_rpt: TxtLookup = Field(default_factory=TxtLookup)
    starttls: StartTlsProbe | None = None


# --------------------------------------------------------------------------- #
# Report (judged output)
# --------------------------------------------------------------------------- #


class CheckResult(BaseModel):
    id: str
    name: str
    weight: int
    applicable: bool = True
    status: Status
    score: float = Field(ge=0, le=1, description="Fraction of this vector's weight earned")
    points: float
    summary: str
    findings: list[str] = Field(default_factory=list)
    records: list[str] = Field(default_factory=list)
    details: dict[str, Any] = Field(default_factory=dict)


class AttackPath(BaseModel):
    id: str
    title: str
    severity: int = Field(ge=1, le=5)
    description: str
    state: Literal["open", "closed", "not_applicable"]
    dns_fixable: bool
    remedy: str


class DnsRecord(BaseModel):
    type: str
    host: str
    value: str


class Fix(BaseModel):
    id: str
    title: str
    rationale: str
    record: DnsRecord
    closes: list[str]  # attack-path ids this change closes
    severity_closed: int
    score_before: int
    score_after: int
    effort: Literal["paste", "paste+host", "provider"]
    caveats: list[str] = Field(default_factory=list)


class ScanReport(BaseModel):
    domain: str
    mode: Literal["live", "demo"]
    scanned_at: datetime
    duration_ms: int
    score: int = Field(ge=0, le=100)
    grade: str
    summary: str
    checks: list[CheckResult]
    attack_paths: list[AttackPath]
    one_fix: Fix | None
    other_fixes: list[Fix]
    observations: Observations


class DemoScenario(BaseModel):
    id: str
    domain: str
    title: str
    description: str
