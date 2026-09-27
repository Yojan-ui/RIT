"""Formal PDF audit report for a scan (reportlab)."""

from __future__ import annotations

from io import BytesIO
from xml.sax.saxutils import escape

from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.pdfgen.canvas import Canvas
from reportlab.platypus import CondPageBreak, KeepTogether, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

from app.analysis.checks import WEIGHTS
from app.models import ScanReport, Status
from app.narrative import write_narrative

INK = colors.HexColor("#111111")
MUTED = colors.HexColor("#666666")
RULE = colors.HexColor("#cccccc")
TONE = {
    Status.PASS: colors.HexColor("#047857"),
    Status.WARN: colors.HexColor("#b45309"),
    Status.FAIL: colors.HexColor("#b91c1c"),
    Status.INFO: MUTED,
    Status.ERROR: MUTED,
}
STATUS_LABEL = {Status.PASS: "PASS", Status.WARN: "WARN", Status.FAIL: "FAIL", Status.INFO: "N/A",
                Status.ERROR: "NOT MEASURED"}
STATE_LABEL = {"open": ("OPEN", TONE[Status.FAIL]), "closed": ("CLOSED", TONE[Status.PASS]),
               "not_applicable": ("N/A", MUTED)}


def _esc(value: object) -> str:
    return escape(str(value))


def _styles() -> dict[str, ParagraphStyle]:
    base = getSampleStyleSheet()["BodyText"]
    body = ParagraphStyle("body", parent=base, fontName="Helvetica", fontSize=9.5, leading=13, textColor=INK,
                          alignment=TA_LEFT)
    return {
        "title": ParagraphStyle("title", parent=body, fontName="Helvetica-Bold", fontSize=20, leading=24),
        "h1": ParagraphStyle("h1", parent=body, fontName="Helvetica-Bold", fontSize=13, leading=17,
                             spaceBefore=10, spaceAfter=4),
        "h2": ParagraphStyle("h2", parent=body, fontName="Helvetica-Bold", fontSize=10.5, leading=14, spaceBefore=6),
        "body": body,
        "muted": ParagraphStyle("muted", parent=body, textColor=MUTED, fontSize=8.5, leading=11.5),
        "cell": ParagraphStyle("cell", parent=body, fontSize=8.5, leading=11),
        # CJK word-wrap lets long DNS strings break anywhere instead of overflowing.
        "mono": ParagraphStyle("mono", parent=body, fontName="Courier", fontSize=8, leading=10.5, wordWrap="CJK"),
    }


def _table(rows: list[list], widths: list[float], *, header: bool = True) -> Table:
    t = Table(rows, colWidths=widths, repeatRows=1 if header else 0)
    style = [
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LINEBELOW", (0, 0), (-1, -1), 0.4, RULE),
        ("TOPPADDING", (0, 0), (-1, -1), 3),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
        ("LEFTPADDING", (0, 0), (-1, -1), 3),
        ("RIGHTPADDING", (0, 0), (-1, -1), 3),
    ]
    if header:
        style += [("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"), ("FONTSIZE", (0, 0), (-1, 0), 8),
                  ("TEXTCOLOR", (0, 0), (-1, 0), MUTED), ("LINEBELOW", (0, 0), (-1, 0), 0.8, INK)]
    t.setStyle(TableStyle(style))
    return t


def _canvas_class(header: str, footer: str):
    """Canvas that stamps a header and a 'page x of y' footer on every page."""

    class NumberedCanvas(Canvas):
        def __init__(self, *args, **kwargs):
            super().__init__(*args, **kwargs)
            self._pages: list[dict] = []

        def showPage(self):  # noqa: N802 (reportlab API)
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
            width, height = A4
            self.setFont("Helvetica", 7.5)
            self.setFillColor(MUTED)
            self.drawString(18 * mm, height - 12 * mm, header)
            self.drawString(18 * mm, 10 * mm, footer)
            self.drawRightString(width - 18 * mm, 10 * mm, f"Page {number} of {total}")
            self.setStrokeColor(RULE)
            self.line(18 * mm, height - 14 * mm, width - 18 * mm, height - 14 * mm)

    return NumberedCanvas


def render_pdf(report: ScanReport, *, app_name: str = "SecureMailScope", version: str = "") -> bytes:
    st = _styles()
    narrative = write_narrative(report)
    width = A4[0] - 36 * mm
    titles = {p.id: p.title for p in report.attack_paths}
    story: list = []

    # -- Cover block -----------------------------------------------------------
    story += [
        Paragraph("Email Security Audit Report", st["title"]),
        Spacer(1, 3 * mm),
        _table(
            [
                [Paragraph("<b>Domain</b>", st["cell"]), Paragraph(_esc(report.domain), st["cell"])],
                [Paragraph("<b>Scanned</b>", st["cell"]),
                 Paragraph(f"{report.scanned_at:%Y-%m-%d %H:%M:%S} UTC"
                           + (" (cached result)" if report.cached else ""), st["cell"])],
                [Paragraph("<b>Source</b>", st["cell"]),
                 Paragraph("Live scan" if report.mode == "live" else "Built-in demo scenario (no network)", st["cell"])],
                [Paragraph("<b>Posture score</b>", st["cell"]),
                 Paragraph(f"<b>{report.score} / 100</b> &nbsp; grade <b>{_esc(report.grade)}</b>", st["cell"])],
            ],
            [35 * mm, width - 35 * mm],
            header=False,
        ),
        Paragraph("Executive summary", st["h1"]),
        Paragraph(_esc(narrative.summary), st["body"]),
    ]

    # -- 1. Priority remediation -------------------------------------------------
    story.append(Paragraph("1. Priority remediation", st["h1"]))
    fix = report.one_fix
    if fix:
        block = [
            Paragraph(f"<b>The One Fix: {_esc(fix.title)}</b>", st["h2"]),
            Paragraph(_esc(fix.rationale), st["body"]),
            Spacer(1, 2 * mm),
            _table(
                [
                    ["Type", Paragraph(_esc(fix.record.type), st["mono"])],
                    ["Host", Paragraph(_esc(fix.record.host), st["mono"])],
                    ["Value", Paragraph(_esc(fix.record.value), st["mono"])],
                ],
                [20 * mm, width - 20 * mm],
                header=False,
            ),
        ]
        if fix.closes:
            block.append(Paragraph("Closes: " + ", ".join(_esc(titles.get(i, i)) for i in fix.closes), st["muted"]))
        for caveat in fix.caveats:
            block.append(Paragraph("Note: " + _esc(caveat).replace("\n", "<br/>"), st["muted"]))
        story.append(KeepTogether(block))
        if report.other_fixes:
            story.append(Paragraph("Further changes, in order of impact", st["h2"]))
            rows = [["#", "Change", "Record", "Score"]]
            for i, f in enumerate(report.other_fixes, start=2):
                rows.append([str(i), Paragraph(_esc(f.title), st["cell"]),
                             Paragraph(_esc(f"{f.record.type} {f.record.host}"), st["mono"]),
                             f"+{f.score_after - f.score_before}"])
            story.append(_table(rows, [8 * mm, 60 * mm, width - 88 * mm, 20 * mm]))
    else:
        story.append(Paragraph("No DNS change is required: every attack path a DNS record can close is closed.",
                               st["body"]))
    server_side = [s for s in narrative.remediation_steps if s.record is None]
    for step in server_side:
        story.append(Paragraph(f"<b>Server-side:</b> {_esc(step.title)}. {_esc(step.detail)}", st["body"]))

    # -- 2. Attack path assessment -------------------------------------------------
    story += [CondPageBreak(40 * mm), Paragraph("2. Attack path assessment", st["h1"]),
              Paragraph("Techniques attackers use against email, ordered by severity (1-5), and whether this "
                        "domain is exposed to each.", st["muted"])]
    rows = [["Sev", "Attack path", "State", "Remedy"]]
    for p in sorted(report.attack_paths, key=lambda p: (-p.severity, p.title)):
        label, colour = STATE_LABEL[p.state]
        rows.append([str(p.severity), Paragraph(f"<b>{_esc(p.title)}</b><br/>{_esc(p.description)}", st["cell"]),
                     Paragraph(f'<font color="{colour.hexval()}"><b>{label}</b></font>', st["cell"]),
                     Paragraph(_esc(p.remedy), st["cell"])])
    story.append(_table(rows, [10 * mm, 75 * mm, 20 * mm, width - 105 * mm]))

    # -- 3. Control results ---------------------------------------------------------
    story += [CondPageBreak(40 * mm), Paragraph("3. Control results", st["h1"])]
    rows = [["Control", "Result", "Points", "Summary"]]
    for c in report.checks:
        points = f"{c.points:.1f} / {c.weight}" if c.applicable else "not scored"
        rows.append([Paragraph(f"<b>{_esc(c.name)}</b>", st["cell"]),
                     Paragraph(f'<font color="{TONE[c.status].hexval()}"><b>{STATUS_LABEL[c.status]}</b></font>',
                               st["cell"]),
                     points, Paragraph(_esc(c.summary), st["cell"])])
    story.append(_table(rows, [32 * mm, 24 * mm, 20 * mm, width - 76 * mm]))

    # -- 4. Detailed findings ---------------------------------------------------------
    story += [CondPageBreak(40 * mm), Paragraph("4. Detailed findings", st["h1"])]
    for c in report.checks:
        block = [Paragraph(f"{_esc(c.name)} ({STATUS_LABEL[c.status]})", st["h2"])]
        block += [Paragraph("• " + _esc(f), st["body"]) for f in c.findings] or [Paragraph("No findings.", st["muted"])]
        if c.records:
            block.append(Paragraph("Published records:", st["muted"]))
            block += [Paragraph(_esc(r).replace("\n", "<br/>"), st["mono"]) for r in c.records]
        story.append(KeepTogether(block))

    # -- 5. Scope and methodology ---------------------------------------------------------
    weights = ", ".join(f"{k.replace('_', '-').upper()} {v}" for k, v in WEIGHTS.items())
    story += [
        CondPageBreak(40 * mm),
        Paragraph("5. Scope and methodology", st["h1"]),
        Paragraph(
            "Seven vectors were assessed from public DNS and the domain's mail servers: SPF (including the "
            "10-DNS-lookup limit), DKIM (common selectors), DMARC, MX, MTA-STS (record and HTTPS policy), TLS-RPT, "
            "and a raw port-25 STARTTLS probe that verifies the certificate against the MX hostname.", st["body"]),
        Paragraph(f"Scoring weights (total 100): {_esc(weights)}. Vectors that do not apply, or that could not be "
                  "measured (for example when outbound port 25 is blocked), are excluded from the total rather than "
                  "counted as failures.", st["body"]),
        Paragraph("The One Fix is chosen by simulating each candidate DNS change, re-running the analysis, and "
                  "ranking by the severity of attack paths closed, then score gained, then effort. Changes that "
                  "could break legitimate mail are never recommended.", st["body"]),
        Paragraph("Limitations: DKIM selectors cannot be listed through DNS, so keys on unusual selectors may be "
                  "missed. The report reflects DNS and server state at scan time.", st["muted"]),
    ]

    buffer = BytesIO()
    doc = SimpleDocTemplate(buffer, pagesize=A4, leftMargin=18 * mm, rightMargin=18 * mm, topMargin=20 * mm,
                            bottomMargin=18 * mm, title=f"Email security audit: {report.domain}", author=app_name)
    header = f"{app_name} {version}".strip() + f"  ·  {report.domain}"
    footer = f"Generated {report.scanned_at:%Y-%m-%d %H:%M} UTC"
    doc.build(story, canvasmaker=_canvas_class(header, footer))
    return buffer.getvalue()
