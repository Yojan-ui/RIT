"""Static constants shared across the engine and API."""

from __future__ import annotations

import re

API_PREFIX = "/api/v1"

# Hostname check applied *after* IDNA/punycode conversion: labels of 1-63 chars,
# total <= 253, at least one dot, alphabetic or punycode (xn--) TLD.
DOMAIN_REGEX = re.compile(
    r"^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+(?:[a-z]{2,63}|xn--[a-z0-9-]{1,59})$"
)

# DKIM selectors may contain dots (sub-labels) and underscores in the wild.
DKIM_SELECTOR_REGEX = re.compile(r"^[a-z0-9](?:[a-z0-9._-]{0,61}[a-z0-9])?$")

# Common two-label public suffixes, used by the organisational-domain heuristic.
# This is intentionally small; it is not a replacement for the Public Suffix List.
MULTI_LABEL_SUFFIXES: frozenset[str] = frozenset(
    {
        "co.uk", "org.uk", "ac.uk", "gov.uk", "me.uk", "ltd.uk", "plc.uk",
        "com.au", "net.au", "org.au", "edu.au", "gov.au",
        "co.nz", "org.nz", "govt.nz",
        "co.jp", "ne.jp", "or.jp", "ac.jp",
        "co.in", "net.in", "org.in", "gov.in", "ac.in",
        "com.br", "net.br", "org.br", "gov.br",
        "co.za", "org.za", "gov.za",
        "com.cn", "net.cn", "org.cn", "gov.cn",
        "com.mx", "com.sg", "com.hk", "com.tw", "com.tr", "co.kr", "co.il",
    }
)

# Well-known DNS names used by the checkers.
DMARC_PREFIX = "_dmarc"
MTA_STS_PREFIX = "_mta-sts"
TLS_RPT_PREFIX = "_smtp._tls"
BIMI_PREFIX = "default._bimi"
DKIM_SUFFIX = "_domainkey"

# Common DKIM selectors probed when none are supplied (Google Workspace, Microsoft 365,
# generic MTAs and a handful of ESPs).
COMMON_DKIM_SELECTORS: tuple[str, ...] = (
    "google",
    "selector1",
    "selector2",
    "default",
    "k1",
    "k2",
    "k3",
    "dkim",
    "mail",
    "s1",
    "s2",
    "smtp",
    "mxvault",
    "everlytickey1",
    "mandrill",
    "pm",
)

SPF_MAX_DNS_LOOKUPS = 10
SPF_MAX_VOID_LOOKUPS = 2

MTA_STS_MAX_AGE_LIMIT = 31_557_600  # RFC 8461 §3.2: max 1 year

# Score thresholds -> letter grade (inclusive lower bounds, checked top-down).
GRADE_THRESHOLDS: tuple[tuple[int, str], ...] = (
    (90, "A"),
    (80, "B"),
    (65, "C"),
    (50, "D"),
    (0, "F"),
)
