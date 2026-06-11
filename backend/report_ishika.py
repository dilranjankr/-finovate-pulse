# -*- coding: utf-8 -*-
"""Build a polished one-employee PDF report.
Default: Ishika Raj, March 2026. Output -> app/Ishika_Raj_March_2026.pdf
"""
from datetime import datetime
from main import employee  # noqa
import db  # noqa
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.lib import colors
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.platypus import (SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle,
                                Flowable)
from reportlab.graphics.shapes import Drawing
from reportlab.graphics.charts.barcharts import VerticalBarChart

NAME = "Ishika Raj"
DFROM, DTO = "2026-03-01", "2026-03-31"
PERIOD = "March 2026"
OUT = f"../{NAME.replace(' ', '_')}_March_2026.pdf"

# --- brand palette ---
INK = colors.HexColor("#0F172A")      # slate-900
SUB = colors.HexColor("#64748B")      # slate-500
TEAL = colors.HexColor("#0D9488")     # teal-600
TEAL_D = colors.HexColor("#0F766E")
AMBER = colors.HexColor("#D97706")
LINE = colors.HexColor("#E2E8F0")
CARDBG = colors.HexColor("#F8FAFC")

data = employee(NAME, DFROM, DTO)
p = data["profile"]
daily = data["daily"]
ck_tasks = data.get("tasks") or []
CLOSED = {"closed", "complete", "completed", "done", "cancelled", "canceled", "archived", "finished"}
active_ck = [t for t in ck_tasks if str(t.get("status", "")).lower() not in CLOSED]

# real projects / tasks worked in March (from Hubstaff time, not the all-time list)
proj = db.q("""
    SELECT coalesce(nullif(p.name,''),'No Project') project,
           round(sum(a.tracked)/3600.0, 1) hrs
    FROM hubstaff_activities a
    LEFT JOIN hubstaff_projects p ON p.id = a.project_id
    WHERE lower(trim(a.user_name))=lower(:nm)
      AND a.date >= :df AND a.date <= :dt AND coalesce(a.tracked,0) > 0
    GROUP BY 1 ORDER BY hrs DESC
""", {"nm": NAME, "df": DFROM, "dt": DTO})
styles = getSampleStyleSheet()
H = ParagraphStyle("H", parent=styles["Normal"], fontName="Helvetica-Bold",
                   fontSize=15, textColor=INK, spaceAfter=2)
SECT = ParagraphStyle("SECT", parent=styles["Normal"], fontName="Helvetica-Bold",
                      fontSize=11, textColor=TEAL_D, spaceBefore=10, spaceAfter=6)
SMALL = ParagraphStyle("SMALL", parent=styles["Normal"], fontName="Helvetica",
                       fontSize=8, textColor=SUB, leading=11)
CELL = ParagraphStyle("CELL", parent=styles["Normal"], fontName="Helvetica",
                      fontSize=8.5, textColor=INK, leading=11)


class HeaderBand(Flowable):
    """Brand header band with employee name + period."""
    def __init__(self, w, h=26 * mm):
        super().__init__()
        self.w, self.h = w, h

    def wrap(self, *a):
        return self.w, self.h

    def draw(self):
        c = self.canv
        c.setFillColor(INK)
        c.roundRect(0, 0, self.w, self.h, 6, stroke=0, fill=1)
        c.setFillColor(TEAL)
        c.roundRect(0, 0, 4 * mm, self.h, 2, stroke=0, fill=1)
        c.rect(2 * mm, 0, 2 * mm, self.h, stroke=0, fill=1)
        c.setFillColor(colors.white)
        c.setFont("Helvetica-Bold", 17)
        c.drawString(9 * mm, self.h - 11 * mm, NAME)
        c.setFillColor(colors.HexColor("#94A3B8"))
        c.setFont("Helvetica", 10)
        c.drawString(9 * mm, self.h - 17 * mm,
                     f"{p['role']}  |  {p['department']}  -  {p['team']}")
        c.setFillColor(TEAL)
        c.setFont("Helvetica-Bold", 12)
        c.drawRightString(self.w - 8 * mm, self.h - 10 * mm, "Performance Report")
        c.setFillColor(colors.HexColor("#CBD5E1"))
        c.setFont("Helvetica", 10)
        c.drawRightString(self.w - 8 * mm, self.h - 16 * mm, PERIOD)


def kpi_grid(w):
    cards = [
        ("Total Hours", f"{p['total']:.1f}", "hrs", TEAL_D),
        ("Billable", f"{p['billable']:.1f}", "hrs", TEAL),
        ("Non-Billable", f"{p['non_billable']:.1f}", "hrs", AMBER),
        ("Utilization", f"{p['utilization']:.0f}%", "of 8h/day", TEAL_D),
        ("Activity", f"{p['activity']:.0f}%", "mouse/kbd", SUB),
        ("Productivity", f"{p['productivity']:.0f}%", "billable share", TEAL),
        ("Active Days", f"{p['days']}", "days worked", INK),
        ("Avg / Day", f"{p['avg_day']:.1f}", "hrs", INK),
        ("Grade", f"{p['grade']}", "overall", TEAL_D),
    ]
    cw = w / 3.0
    rows = []
    for i in range(0, 9, 3):
        rows.append(cards[i:i + 3])
    celldata = []
    for r in rows:
        line = []
        for (lab, val, sub, col) in r:
            inner = Table([[Paragraph(f'<font size=8 color="#64748B">{lab.upper()}</font>', SMALL)],
                           [Paragraph(f'<font size=20 color="#{col.hexval()[2:]}"><b>{val}</b></font>', CELL)],
                           [Paragraph(f'<font size=7.5 color="#94A3B8">{sub}</font>', SMALL)]],
                          colWidths=[cw - 6])
            inner.setStyle(TableStyle([("TOPPADDING", (0, 0), (-1, -1), 1),
                                       ("BOTTOMPADDING", (0, 0), (-1, -1), 1),
                                       ("LEFTPADDING", (0, 0), (-1, -1), 8),
                                       ("LEFTPADDING", (0, 1), (0, 1), 8)]))
            line.append(inner)
        celldata.append(line)
    t = Table(celldata, colWidths=[cw, cw, cw], rowHeights=[26 * mm / 1.7] * 3)
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), CARDBG),
        ("BOX", (0, 0), (-1, -1), 0.6, LINE),
        ("INNERGRID", (0, 0), (-1, -1), 0.6, LINE),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("TOPPADDING", (0, 0), (-1, -1), 6), ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
    ]))
    return t


def daily_chart(w):
    d = Drawing(w, 60 * mm)
    bc = VerticalBarChart()
    bc.x, bc.y = 16, 22
    bc.width, bc.height = w - 30, 60 * mm - 34
    bill = [r["billable"] for r in daily]
    nb = [r["non_billable"] for r in daily]
    bc.data = [bill, nb]
    bc.categoryAxis.categoryNames = [r["date"][8:] for r in daily]  # day-of-month
    bc.categoryAxis.labels.fontSize = 6
    bc.categoryAxis.labels.fillColor = SUB
    bc.valueAxis.valueMin = 0
    bc.valueAxis.labels.fontSize = 6
    bc.valueAxis.labels.fillColor = SUB
    bc.bars[0].fillColor = TEAL
    bc.bars[1].fillColor = AMBER
    bc.barWidth = 4
    bc.groupSpacing = 3
    bc.categoryAxis.strokeColor = LINE
    bc.valueAxis.strokeColor = LINE
    d.add(bc)
    return d


# ---------------- build document ----------------
doc = SimpleDocTemplate(OUT, pagesize=A4, leftMargin=14 * mm, rightMargin=14 * mm,
                        topMargin=12 * mm, bottomMargin=12 * mm,
                        title=f"{NAME} - {PERIOD} Report", author="Finovate Insight")
W = doc.width
story = [HeaderBand(W), Spacer(1, 6)]

# summary line
story.append(Paragraph(
    f"<b>{NAME}</b> tracked <b>{p['total']:.1f} hours</b> across <b>{p['days']} active days</b> "
    f"in {PERIOD}, at <b>{p['utilization']:.0f}% utilization</b> and a "
    f"<b>{p['productivity']:.0f}% billable</b> rate &mdash; overall grade <b>{p['grade']}</b>.", CELL))
story.append(Spacer(1, 8))

story.append(Paragraph("Key Metrics", SECT))
story.append(kpi_grid(W))

story.append(Paragraph("Daily Tracked Hours (Billable vs Non-Billable)", SECT))
story.append(daily_chart(W))
story.append(Paragraph(
    '<font color="#0D9488">&#9632;</font> Billable &nbsp;&nbsp; '
    '<font color="#D97706">&#9632;</font> Non-Billable', SMALL))

# projects worked
story.append(Paragraph("Projects Worked On (March 2026)", SECT))
prows = [[Paragraph("<b>Project</b>", CELL), Paragraph("<b>Hours</b>", CELL),
          Paragraph("<b>Share</b>", CELL)]]
tot = float(proj["hrs"].sum()) or 1
for _, r in proj.iterrows():
    prows.append([Paragraph(str(r["project"]), CELL),
                  Paragraph(f'{r["hrs"]:.1f}', CELL),
                  Paragraph(f'{r["hrs"]/tot*100:.0f}%', CELL)])
pt = Table(prows, colWidths=[W * 0.66, W * 0.17, W * 0.17])
pt.setStyle(TableStyle([
    ("LINEBELOW", (0, 0), (-1, 0), 1, TEAL),
    ("LINEBELOW", (0, 1), (-1, -1), 0.4, LINE),
    ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, CARDBG]),
    ("TOPPADDING", (0, 0), (-1, -1), 4), ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
    ("ALIGN", (1, 0), (-1, -1), "RIGHT"),
]))
story.append(pt)
story.append(Spacer(1, 3))
story.append(Paragraph(
    "Note: in March, 100% of tracked time was logged at the project level "
    "(Hubstaff had no per-task split), so the task list below comes from ClickUp assignments.", SMALL))

# ClickUp assigned tasks (active first) — Hubstaff has no per-task time for her
story.append(Paragraph(
    f"ClickUp Tasks &mdash; Assigned &amp; Active "
    f"({p['active_tasks']} active of {p['total_tasks']} total)", SECT))
show = (active_ck or ck_tasks)[:16]
trows = [[Paragraph("<b>Task</b>", CELL), Paragraph("<b>Client</b>", CELL),
          Paragraph("<b>Status</b>", CELL), Paragraph("<b>Due</b>", CELL)]]
for t in show:
    trows.append([Paragraph(str(t.get("task", ""))[:64], CELL),
                  Paragraph(str(t.get("client", ""))[:24], CELL),
                  Paragraph(str(t.get("status", "")), CELL),
                  Paragraph(str(t.get("due", "") or "-"), CELL)])
tt = Table(trows, colWidths=[W * 0.50, W * 0.22, W * 0.16, W * 0.12])
tt.setStyle(TableStyle([
    ("LINEBELOW", (0, 0), (-1, 0), 1, TEAL),
    ("LINEBELOW", (0, 1), (-1, -1), 0.4, LINE),
    ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, CARDBG]),
    ("TOPPADDING", (0, 0), (-1, -1), 4), ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
    ("VALIGN", (0, 0), (-1, -1), "TOP"),
]))
story.append(tt)

# footer / lineage
story.append(Spacer(1, 10))
story.append(Paragraph(
    "<b>How this is calculated:</b> Hours = Hubstaff tracked time (seconds &divide; 3600). "
    "Department/Team come from the ClickUp space; Billable vs Non-billable from the 'NB' task marker. "
    "Utilization = tracked &divide; (active days &times; 8h), capped at 100%. "
    "Activity = overall &divide; tracked. Productivity = billable share of tracked. "
    "Grade = 0.4&times;Utilization + 0.3&times;Productivity + 0.3&times;Task-completion.", SMALL))
story.append(Spacer(1, 4))
story.append(Paragraph(
    f"Generated by Finovate Insight on {datetime.now():%d %b %Y}. "
    f"Source: Hubstaff (time) + ClickUp (structure). Period: {DFROM} to {DTO}.", SMALL))

doc.build(story)
print("WROTE:", OUT)
print(f"summary -> total={p['total']}h util={p['utilization']}% prod={p['productivity']}% "
      f"days={p['days']} grade={p['grade']} projects={len(proj)} "
      f"clickup_tasks={len(ck_tasks)} active={len(active_ck)}")
