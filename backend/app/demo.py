"""Canned Observations for UI development.

These go through the real analysis engine, so the reports are exactly what a
live scan of a domain in that state would produce. Domains use the reserved
.example TLD (RFC 2606).
"""

from __future__ import annotations

from collections.abc import Callable

from app.models import (
    DemoScenario,
    DkimKey,
    DkimLookup,
    MtaStsLookup,
    MxHost,
    MxLookup,
    Observations,
    SpfLookup,
    StartTlsProbe,
    TxtLookup,
)

_KEY_2048 = "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA" + "q" * 342 + "IDAQAB"
_KEY_1024 = "MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQC" + "q" * 170 + "QIDAQAB"
_SELECTORS = ["default", "google", "selector1", "selector2", "k1", "s1"]


def _mx(domain: str, *names: str) -> MxLookup:
    return MxLookup(hosts=[MxHost(preference=10 * (i + 1), host=f"{n}.{domain}", addresses=[f"192.0.2.{10 + i}"])
                           for i, n in enumerate(names)])


def _tls_ok(host: str) -> StartTlsProbe:
    return StartTlsProbe(host=host, ip="192.0.2.10", reachable=True, banner=f"{host} ESMTP ready", ehlo_ok=True,
                         starttls_offered=True, tls_version="TLSv1.3", cipher="TLS_AES_256_GCM_SHA384",
                         cert_valid=True, cert_subject=host, cert_issuer="Let's Encrypt",
                         cert_not_after="Dec 20 12:00:00 2026 GMT", duration_ms=412)


def _fortress() -> Observations:
    d = "fortress.example"
    return Observations(
        domain=d,
        mx=_mx(d, "mx1", "mx2"),
        spf=SpfLookup(records=["v=spf1 include:_spf.google.com -all"], lookup_count=4),
        dkim=DkimLookup(selectors_tried=_SELECTORS, keys=[DkimKey(selector="google",
                        record=f"v=DKIM1; k=rsa; p={_KEY_2048}")]),
        dmarc=TxtLookup(records=[f"v=DMARC1; p=reject; rua=mailto:dmarc@{d}; adkim=s; aspf=s"]),
        mta_sts=MtaStsLookup(txt=TxtLookup(records=["v=STSv1; id=2026090101"]),
                             policy=f"version: STSv1\nmode: enforce\nmx: *.{d}\nmax_age: 604800\n"),
        tls_rpt=TxtLookup(records=[f"v=TLSRPTv1; rua=mailto:tls@{d}"]),
        starttls=_tls_ok(f"mx1.{d}"),
    )


def _startup() -> Observations:
    d = "acme-startup.example"
    return Observations(
        domain=d,
        mx=MxLookup(hosts=[MxHost(preference=1, host="aspmx.l.google.com", addresses=["192.0.2.20"]),
                           MxHost(preference=5, host="alt1.aspmx.l.google.com", addresses=["192.0.2.21"])]),
        spf=SpfLookup(records=["v=spf1 include:_spf.google.com include:sendgrid.net ~all"], lookup_count=6),
        dkim=DkimLookup(selectors_tried=_SELECTORS, keys=[DkimKey(selector="google",
                        record=f"v=DKIM1; k=rsa; p={_KEY_2048}")]),
        dmarc=TxtLookup(records=[f"v=DMARC1; p=none; rua=mailto:dmarc@{d}"]),
        starttls=_tls_ok("aspmx.l.google.com"),
    )


def _wide_open() -> Observations:
    d = "wide-open.example"
    return Observations(
        domain=d,
        mx=_mx(d, "mail"),
        dkim=DkimLookup(selectors_tried=_SELECTORS),
        starttls=StartTlsProbe(host=f"mail.{d}", ip="192.0.2.10", reachable=True, banner=f"mail.{d} ESMTP Postfix",
                               ehlo_ok=True, starttls_offered=False, duration_ms=238),
    )


def _legacy_corp() -> Observations:
    d = "legacy-corp.example"
    includes = " ".join(f"include:_spf{i}.vendor{i}.example" for i in range(1, 8))
    return Observations(
        domain=d,
        mx=_mx(d, "mx-a", "mx-b", "mx-c"),
        spf=SpfLookup(records=[f"v=spf1 a mx {includes} ~all"], lookup_count=13),
        dkim=DkimLookup(selectors_tried=_SELECTORS, keys=[DkimKey(selector="selector1",
                        record=f"v=DKIM1; k=rsa; p={_KEY_1024}")]),
        dmarc=TxtLookup(records=[f"v=DMARC1; p=reject; pct=25; sp=none; rua=mailto:dmarc@{d}"]),
        mta_sts=MtaStsLookup(txt=TxtLookup(records=["v=STSv1; id=legacy1"]),
                             policy=f"version: STSv1\nmode: testing\nmx: mx-a.{d}\nmx: mx-b.{d}\nmax_age: 3600\n"),
        tls_rpt=TxtLookup(records=[f"v=TLSRPTv1; rua=mailto:tls@{d}"]),
        starttls=StartTlsProbe(host=f"mx-a.{d}", ip="192.0.2.10", reachable=True, banner=f"mx-a.{d} ESMTP",
                               ehlo_ok=True, starttls_offered=True, tls_version="TLSv1.2",
                               cipher="ECDHE-RSA-AES128-GCM-SHA256", cert_valid=False,
                               cert_error="Hostname mismatch, certificate is not valid for 'mx-a.legacy-corp.example'",
                               duration_ms=655),
    )


def _parked() -> Observations:
    d = "parked-brand.example"
    return Observations(
        domain=d,
        mx=MxLookup(null_mx=True),
        spf=SpfLookup(records=["v=spf1 -all"], lookup_count=0),
        dkim=DkimLookup(selectors_tried=_SELECTORS),
        dmarc=TxtLookup(records=["v=DMARC1; p=none"]),
    )


def _firewalled() -> Observations:
    d = "port25-blocked.example"
    obs = _startup().model_copy(update={"domain": d}, deep=True)
    obs.dmarc = TxtLookup(records=[f"v=DMARC1; p=quarantine; rua=mailto:dmarc@{d}"])
    obs.starttls = StartTlsProbe(host="aspmx.l.google.com", ip="192.0.2.20", reachable=False,
                                 error="Timed out after 8s connecting to port 25", duration_ms=8003)
    return obs


SCENARIOS: dict[str, tuple[DemoScenario, Callable[[], Observations]]] = {
    s.id: (s, fn) for s, fn in [
        (DemoScenario(id="fortress", domain="fortress.example", title="Fortress",
                      description="Every control in place: DMARC reject, MTA-STS enforce, 2048-bit DKIM."), _fortress),
        (DemoScenario(id="startup", domain="acme-startup.example", title="Typical startup",
                      description="Google Workspace defaults: SPF ~all, DKIM on, DMARC stuck at p=none."), _startup),
        (DemoScenario(id="wide-open", domain="wide-open.example", title="Wide open",
                      description="No SPF, DKIM or DMARC, and the MX does not offer STARTTLS."), _wide_open),
        (DemoScenario(id="legacy-corp", domain="legacy-corp.example", title="Legacy enterprise",
                      description="SPF over the 10-lookup limit, 1024-bit DKIM, DMARC pct=25, bad MX cert."),
         _legacy_corp),
        (DemoScenario(id="parked", domain="parked-brand.example", title="Parked domain",
                      description="Null MX and v=spf1 -all, but DMARC is only p=none."), _parked),
        (DemoScenario(id="firewalled", domain="port25-blocked.example", title="Port 25 blocked",
                      description="Scanner could not reach the MX; STARTTLS shows as unmeasured."), _firewalled),
    ]
}


def list_scenarios() -> list[DemoScenario]:
    return [scenario for scenario, _ in SCENARIOS.values()]


def observations_for(scenario_id: str) -> Observations | None:
    entry = SCENARIOS.get(scenario_id)
    return entry[1]() if entry else None
