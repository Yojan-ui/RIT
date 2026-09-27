"""Protocol checkers. Register new checkers in ``CHECKERS``."""

from app.engine.checkers.base import BaseChecker, ScanContext
from app.engine.checkers.dkim import DKIMChecker
from app.engine.checkers.dmarc import DMARCChecker
from app.engine.checkers.mta_sts import MTASTSChecker
from app.engine.checkers.mx import MXChecker
from app.engine.checkers.spf import SPFChecker
from app.engine.checkers.tls_rpt import TLSRPTChecker
from app.engine.checkers.transport import TransportChecker

CHECKERS: list[type[BaseChecker]] = [
    MXChecker,
    SPFChecker,
    DKIMChecker,
    DMARCChecker,
    MTASTSChecker,
    TLSRPTChecker,
    TransportChecker,
]

__all__ = [
    "BaseChecker",
    "CHECKERS",
    "DKIMChecker",
    "DMARCChecker",
    "MTASTSChecker",
    "MXChecker",
    "SPFChecker",
    "ScanContext",
    "TLSRPTChecker",
    "TransportChecker",
]
