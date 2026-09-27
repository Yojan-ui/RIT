"""Enumerations used across the engine and API."""

from __future__ import annotations

from enum import Enum


class CheckStatus(str, Enum):
    PASS = "pass"
    WARN = "warn"
    FAIL = "fail"
    MISSING = "missing"
    ERROR = "error"
    # The scanner could not measure this control from where it runs (e.g. outbound
    # port 25 blocked). Excluded from scoring rather than counted as a failure.
    NOT_ASSESSED = "not_assessed"


class Severity(str, Enum):
    INFO = "info"
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"
    CRITICAL = "critical"

    @property
    def rank(self) -> int:
        return _SEVERITY_RANK[self]


_SEVERITY_RANK = {s: i for i, s in enumerate(Severity)}


class CheckName(str, Enum):
    MX = "mx"
    SPF = "spf"
    DKIM = "dkim"
    DMARC = "dmarc"
    MTA_STS = "mta_sts"
    TLS_RPT = "tls_rpt"
    TRANSPORT = "transport"
    BIMI = "bimi"
    DNSSEC = "dnssec"


class Grade(str, Enum):
    A = "A"
    B = "B"
    C = "C"
    D = "D"
    F = "F"
