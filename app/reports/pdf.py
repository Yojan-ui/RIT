"""Render a scan as a formal PDF audit report (ReportLab)."""

from __future__ import annotations

import io
from datetime import datetime, timezone
from xml.sax.saxutils import escape

from reportlab.lib import colors
from reportlab.lib.enums import TA_RIGHT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.pdfgen import canvas
from reportlab.platypus import (
    CondPageBreak,
    KeepTogether,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)

from app.models.enums import CheckStatus, Exposure, Severity
from app.models.schemas import ScanResult

INK = colors.HexColor("#1B2A41")
MUTED = colors.HexColor("#5A6B82")
LINE = colors.HexColor("#D5DDE7")
TINT = colors.HexColor("#EEF2F6")
EXPOSURE_COLOR = {
    Exposure.EXPOSED: colors.HexColor("#C0392B"),
    Exposure.PARTIAL: colors.HexColor("#B7791F"),
    Exposure.MITIGATED: colors.HexColor("#2F7D5B"),
    Exposure.UNKNOWN: colors.HexColor("#7A8699"),
}
EXPOSURE_LABEL = {
    Exposure.EXPOSED: "Open",
    Exposure.PARTIAL: "Partly open",
    Exposure.MITIGATED: "Defended",
    Exposure.UNKNOWN: "Not measured",
}
STATUS_EXPOSURE = {
    CheckStatus.PASS: Exposure.MITIGATED,
    CheckStatus.WARN: Exposure.PARTIAL,
    CheckStatus.FAIL: Exposure.EXPOSED,
    CheckStatus.MISSING: Exposure.EXPOSED,
    CheckStatus.ERROR: Exposure.EXPOSED,
    CheckStatus.NOT_ASSESSED: Exposure.UNKNOWN,
}
STATUS_LABEL = {
    CheckStatus.PASS: "Passing",
    CheckStatus.WARN: "Weak",
    CheckStatus.FAIL: "Failing",
    CheckStatus.MISSING: "Missing",
    CheckStatus.ERROR: "Error",
    CheckStatus.NOT_ASSESSED: "Not assessed",
}
CONTROL_LABEL = {
    "mx": "MX",
    "spf": "SPF",
    "dkim": "DKIM",
    "dmarc": "DMARC",
    "mta_sts": "MTA-STS",
    "tls_rpt": "TLS-RPT",
    "transport": "STARTTLS (transport)",
    "bimi": "BIMI",
    "dnssec": "DNSSEC",
}
SEVERITY_COLOR = {
    Severity.CRITICAL: EXPOSURE_COLOR[Exposure.EXPOSED],
    Severity.HIGH: EXPOSURE_COLOR[Exposure.EXPOSED],
    Severity.MEDIUM: EXPOSURE_COLOR[Exposure.PARTIAL],
    Severity.LOW: MUTED,
    Severity.INFO: MUTED,
}
STANDARDS = (
    "MX: RFC 5321, RFC 7505. SPF: RFC 7208. DKIM: RFC 6376, RFC 8301, RFC 8463. DMARC: RFC 7489. "
    "MTA-STS: RFC 8461. TLS-RPT: RFC 8460. STARTTLS: RFC 3207."
)


def _esc(value: object) -> str:
    return escape(str(value))


def _styles() -> dict[str, ParagraphStyle]:
    base = getSampleStyleSheet()["Normal"]
    body = ParagraphStyle("body", parent=base, fontName="Helvetica", fontSize=9.5, leading=13.5, textColor=INK)
    return {
        "body": body,
        "small": ParagraphStyle("small", parent=body, fontSize=8.5, leading=11.5),
        "muted": ParagraphStyle("muted", parent=body, fontSize=8.5, leading=11.5, textColor=MUTED),
        "cell": ParagraphStyle("cell", parent=body, fontSize=8.5, leading=11),
        "cell_head": ParagraphStyle("cell_head", parent=body, fontName="Helvetica-Bold", fontSize=8, leading=10, textColor=MUTED),
        "title": ParagraphStyle("title", parent=body, fontName="Helvetica-Bold", fontSize=20, leading=24),
        "domain": ParagraphStyle("domain", parent=body, fontName="Helvetica", fontSize=14, leading=18, textColor=MUTED),
        "h1": ParagraphStyle("h1", parent=body, fontName="Helvetica-Bold", fontSize=12.5, leading=16, spaceBefore=14, spaceAfter=6),
        "h2": ParagraphStyle("h2", parent=body, fontName="Helvetica-Bold", fontSize=10.5, leading=14, spaceBefore=8, spaceAfter=3),
        "mono": ParagraphStyle("mono", parent=body, fontName="Courier", fontSize=8.5, leading=11, wordWrap="CJK"),
        "big": ParagraphStyle("big", parent=body, fontName="Helvetica-Bold", fontSize=22, leading=26),
        "right": ParagraphStyle("right", parent=body, alignment=TA_RIGHT),
    }


def _table(rows: list[list], widths: list[float], *, header: bool = True, extra: list | None = None) -> Table:
    table = Table(rows, colWidths=widths, repeatRows=1 if header else 0)
    style = [
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 5),
        ("RIGHTPADDING", (0, 0), (-1, -1), 5),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
        ("LINEBELOW", (0, 0), (-1, -1), 0.5, LINE),
    ]
    if header:
        style += [("BACKGROUND", (0, 0), (-1, 0), TINT), ("LINEBELOW", (0, 0), (-1, 0), 0.8, INK)]
    table.setStyle(TableStyle(style + (extra or [])))
    return table


def _canvas_class(header: str, footer: str):
    """Canvas that draws the running header and a 'Page X of Y' footer on every page."""

    class ReportCanvas(canvas.Canvas):
        def __init__(self, *args, **kwargs):
            super().__init__(*args, **kwargs)
            self._pages: list[dict] = []

        def showPage(self):  # noqa: N802 (ReportLab API)
            self._pages.append(dict(self.__dict__))
            self._startPage()

        def save(self):
            total = len(self._pages)
            for number, state in enumerate(self._pages, start=1):
                self.__dict__.update(state)
                self._chrome(number, total)
                super().showPage()
            super().save()

        def _chrome(self, number: int, total: int) -> None:
            width, height = self._pagesize
            self.saveState()
            self.setStrokeColor(LINE)
            self.setLineWidth(0.6)
            self.line(20 * mm, height - 14 * mm, width - 20 * mm, height - 14 * mm)
            self.line(20 * mm, 14 * mm, width - 20 * mm, 14 * mm)
            self.setFillColor(MUTED)
            self.setFont("Helvetica", 7.5)
            self.drawString(20 * mm, height - 12 * mm, "Email security audit report")
            self.drawRightString(width - 20 * mm, height - 12 * mm, header)
            self.drawString(20 * mm, 10 * mm, footer)
            self.drawRightString(width - 20 * mm, 10 * mm, f"Page {number} of {total}")
            self.restoreState()

    return ReportCanvas


def render_pdf(
    result: ScanResult,
    *,
    app_name: str,
    version: str,
    generated_at: datetime | None = None,
    compress: bool = True,
) -> bytes:
    st = _styles()
    generated_at = generated_at or datetime.now(timezone.utc)
    matrix = result.attack_matrix
    tally = {e: sum(p.exposure is e for p in matrix) for e in Exposure}
    width = A4[0] - 40 * mm
    story: list = []

    # -- Title block and headline figures ---------------------------------------------
    story += [
        Paragraph("Email Security Audit Report", st["title"]),
        Paragraph(_esc(result.domain), st["domain"]),
        Spacer(1, 3 * mm),
        Paragraph(
            f"Scan performed {result.scanned_at:%d %B %Y at %H:%M} UTC"
            + (" (served from cache)" if result.cached else "")
            + f". Report generated by {_esc(app_name)} v{_esc(version)}.",
            st["muted"],
        ),
        Spacer(1, 6 * mm),
    ]
    grade_color = {"A": Exposure.MITIGATED, "B": Exposure.MITIGATED, "C": Exposure.PARTIAL}.get(
        result.score.grade.value, Exposure.EXPOSED
    )
    figures = [
        [
            Paragraph(f'<font color="{EXPOSURE_COLOR[grade_color].hexval()}">{result.score.grade.value}</font>', st["big"]),
            Paragraph(f"{result.score.score}<font size=11>/100</font>", st["big"]),
            Paragraph(f'<font color="{EXPOSURE_COLOR[Exposure.EXPOSED].hexval()}">{tally[Exposure.EXPOSED]}</font>', st["big"]),
            Paragraph(str(tally[Exposure.PARTIAL]), st["big"]),
            Paragraph(str(tally[Exposure.MITIGATED]), st["big"]),
        ],
        [Paragraph(t, st["muted"]) for t in ("Grade", "Score", "Paths open", "Partly open", "Defended")],
    ]
    story.append(
        _table(
            figures,
            [width / 5] * 5,
            header=False,
            extra=[("LINEBELOW", (0, 0), (-1, 0), 0, colors.white), ("BOX", (0, 0), (-1, -1), 0.6, LINE)],
        )
    )

    # -- Executive summary ------------------------------------------------------------------
    open_titles = [p.title for p in matrix if p.exposure is Exposure.EXPOSED]
    summary = (
        f"{_esc(result.domain)} scored <b>{result.score.score}/100 (grade {result.score.grade.value})</b> "
        f"across the controls that could be measured. "
    )
    if open_titles:
        summary += (
            f"{len(open_titles)} of {len(matrix)} assessed attack paths are open: "
            + "; ".join(_esc(t) for t in open_titles)
            + ". "
        )
    elif tally[Exposure.PARTIAL]:
        summary += f"No attack path is fully open, but {tally[Exposure.PARTIAL]} are only partly defended. "
    else:
        summary += "No attack path is open. "
    if result.one_fix:
        summary += f"Highest-impact change: <b>{_esc(result.one_fix.title)}</b> (section 1)."
    story += [Paragraph("Executive summary", st["h1"]), Paragraph(summary, st["body"])]
    if result.score.not_assessed:
        names = ", ".join(CONTROL_LABEL.get(n, n) for n in result.score.not_assessed)
        story.append(
            Paragraph(
                f"Not assessed from the scanner's network and excluded from the score (not counted as failures): {_esc(names)}.",
                st["muted"],
            )
        )

    # -- 1. Priority remediation -------------------------------------------------------------
    story.append(Paragraph("1. Priority remediation", st["h1"]))
    fix = result.one_fix
    if fix:
        block = [
            Paragraph(f"<b>{_esc(fix.title)}</b>", st["h2"]),
            Paragraph(_esc(fix.action), st["body"]),
        ]
        if fix.record:
            record = _table(
                [
                    [Paragraph(f"{_esc(fix.record_type)} record at <b>{_esc(fix.host)}</b>", st["small"])],
                    [Paragraph(_esc(fix.record), st["mono"])],
                ],
                [width],
                header=False,
                extra=[("BACKGROUND", (0, 0), (-1, -1), TINT), ("BOX", (0, 0), (-1, -1), 0.6, LINE)],
            )
            block += [Spacer(1, 2 * mm), record]
        titles = {p.id: p.title for p in matrix}
        closes = ", ".join(_esc(titles.get(i, i)) for i in fix.closes)
        gain = f" Expected score change: +{fix.score_gain} points." if fix.score_gain else ""
        block += [Spacer(1, 2 * mm), Paragraph(f"Closes or narrows: {closes}.{gain}", st["muted"])]
        # Keep each heading with its first line so it is never orphaned, but let long
        # sections (e.g. several DKIM keys) flow across pages instead of jumping whole.
        story.append(KeepTogether(block[:2]))
        story += block[2:]
    else:
        story.append(Paragraph("No remediation is required: every attack path is defended or could not be measured.", st["body"]))

    # -- 2. Attack path assessment ---------------------------------------------------------------
    story += [
        CondPageBreak(40 * mm),
        Paragraph("2. Attack path assessment", st["h1"]),
        Paragraph("Seven techniques attackers use against email, ordered by impact, and how exposed this domain is to each.", st["muted"]),
        Spacer(1, 2 * mm),
    ]
    rows = [[Paragraph(h, st["cell_head"]) for h in ("Attack path", "Impact", "Exposure", "Assessment")]]
    for p in matrix:
        rows.append(
            [
                Paragraph(f"<b>{_esc(p.title)}</b>", st["cell"]),
                Paragraph(p.severity.value.capitalize(), st["cell"]),
                Paragraph(f'<font color="{EXPOSURE_COLOR[p.exposure].hexval()}"><b>{EXPOSURE_LABEL[p.exposure]}</b></font>', st["cell"]),
                Paragraph(_esc(p.reason or p.description), st["cell"]),
            ]
        )
    story.append(_table(rows, [0.27 * width, 0.11 * width, 0.14 * width, 0.48 * width]))

    # -- 3. Control results ------------------------------------------------------------------------
    story += [CondPageBreak(40 * mm), Paragraph("3. Control results", st["h1"])]
    rows = [[Paragraph(h, st["cell_head"]) for h in ("Control", "Status", "Points", "Result")]]
    for c in result.checks:
        points = result.score.components.get(c.name.value)
        rows.append(
            [
                Paragraph(f"<b>{_esc(CONTROL_LABEL.get(c.name.value, c.name.value))}</b>", st["cell"]),
                Paragraph(
                    f'<font color="{EXPOSURE_COLOR[STATUS_EXPOSURE[c.status]].hexval()}"><b>{STATUS_LABEL[c.status]}</b></font>',
                    st["cell"],
                ),
                Paragraph(
                    f"{points:g}" if points is not None
                    else "excluded" if c.name.value in result.score.not_assessed
                    else "not scored",
                    st["cell"],
                ),
                Paragraph(_esc(c.summary), st["cell"]),
            ]
        )
    story.append(_table(rows, [0.22 * width, 0.14 * width, 0.11 * width, 0.53 * width]))

    # -- 4. Detailed findings ------------------------------------------------------------------------
    story += [CondPageBreak(40 * mm), Paragraph("4. Detailed findings", st["h1"])]
    for c in result.checks:
        block = [Paragraph(f"{_esc(CONTROL_LABEL.get(c.name.value, c.name.value))}: {STATUS_LABEL[c.status].lower()}", st["h2"])]
        for record in c.records:
            block.append(Paragraph(_esc(record), st["mono"]))
        if not c.findings:
            block.append(Paragraph("No findings.", st["muted"]))
        rows = []
        for f in sorted(c.findings, key=lambda f: -f.severity.rank):
            text = f"<b>{_esc(f.title)}</b>"
            if f.detail:
                text += f"<br/>{_esc(f.detail)}"
            if f.recommendation:
                text += f"<br/><i>Recommendation:</i> {_esc(f.recommendation)}"
            sev = f'<font color="{SEVERITY_COLOR[f.severity].hexval()}"><b>{f.severity.value.capitalize()}</b></font>'
            rows.append([Paragraph(sev, st["cell"]), Paragraph(text, st["cell"])])
        if rows:
            block += [Spacer(1, 1.5 * mm), _table(rows, [0.14 * width, 0.86 * width], header=False)]
        # Keep each heading with its first line so it is never orphaned, but let long
        # sections (e.g. several DKIM keys) flow across pages instead of jumping whole.
        story.append(KeepTogether(block[:2]))
        story += block[2:]

    # -- 5. Scope and methodology ---------------------------------------------------------------------
    story += [
        CondPageBreak(35 * mm),
        Paragraph("5. Scope and methodology", st["h1"]),
        Paragraph(
            "Controls were assessed from public DNS, the published MTA-STS policy and, where the scanner's network "
            "allows outbound port 25, a live STARTTLS session with the primary MX. Controls that could not be measured "
            "are reported as not assessed and removed from the score's denominator rather than scored as failures. "
            "DKIM selectors cannot be enumerated through DNS; unless the scan was given the domain's selectors, "
            "an absent key at common selectors is not treated as proof of absence.",
            st["body"],
        ),
        Spacer(1, 2 * mm),
        Paragraph(f"Standards referenced: {STANDARDS}", st["muted"]),
        Spacer(1, 2 * mm),
        Paragraph(
            "This report reflects the domain's configuration at the time of the scan. DNS and mail server changes made "
            "afterwards are not reflected.",
            st["muted"],
        ),
    ]

    buffer = io.BytesIO()
    doc = SimpleDocTemplate(
        buffer,
        pagesize=A4,
        leftMargin=20 * mm,
        rightMargin=20 * mm,
        topMargin=22 * mm,
        bottomMargin=22 * mm,
        title=f"Email security audit: {result.domain}",
        author=f"{app_name} {version}",
        subject="Email security posture audit",
        pageCompression=1 if compress else 0,
        invariant=1,
    )
    doc.build(
        story,
        canvasmaker=_canvas_class(
            header=result.domain,
            footer=f"Generated {generated_at:%Y-%m-%d %H:%M} UTC by {app_name} v{version}",
        ),
    )
    return buffer.getvalue()
