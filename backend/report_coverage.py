# -*- coding: utf-8 -*-
"""Tracking Coverage report: what % of tracked time is (1) on a ClickUp-matched
task, (2) on a project with no task, (3) on a task that doesn't match ClickUp.
Output -> app/tracking_coverage_report.pdf"""
import db  # noqa
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.lib import colors
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, Flowable
from reportlab.graphics.shapes import Drawing
from reportlab.graphics.charts.piecharts import Pie

BUCKET_SQL = """
SELECT bucket, round(sum(hrs)::numeric,1) hours FROM (
  SELECT a.tracked/3600.0 hrs,
    CASE WHEN a.task_id IS NULL THEN 'PROJECT'
         WHEN h.remote_id IS NULL OR h.remote_id='' THEN 'UNMATCHED'
         WHEN c.task_id IS NOT NULL THEN 'MATCHED' ELSE 'UNMATCHED' END bucket
  FROM hubstaff_activities a
  LEFT JOIN hubstaff_tasks h ON h.id=a.task_id
  LEFT JOIN clickup_tasks c ON c.task_id=h.remote_id
  WHERE coalesce(a.tracked,0)>0 {extra}
) x GROUP BY bucket
"""

df = db.q(BUCKET_SQL.format(extra=""))
H = dict(zip(df["bucket"], df["hours"]))
matched, project, unmatched = H.get("MATCHED", 0), H.get("PROJECT", 0), H.get("UNMATCHED", 0)
total = matched + project + unmatched or 1


def pc(v):
    return v / total * 100


cy = db.q(BUCKET_SQL.format(extra="AND a.date>='2026-01-01'"))
CY = dict(zip(cy["bucket"], cy["hours"]))
m2, p2, u2 = CY.get("MATCHED", 0), CY.get("PROJECT", 0), CY.get("UNMATCHED", 0)
cyt = (m2 + p2 + u2) or 1

INK = colors.HexColor("#0F172A")
SUB = colors.HexColor("#64748B")
TEAL = colors.HexColor("#0D9488")
AMBER = colors.HexColor("#D97706")
BLUE = colors.HexColor("#2563EB")
LINE = colors.HexColor("#E2E8F0")
CARD = colors.HexColor("#F8FAFC")

styles = getSampleStyleSheet()
Sub = ParagraphStyle("Sub", parent=styles["Normal"], fontName="Helvetica", fontSize=9, textColor=SUB, leading=13)
Sec = ParagraphStyle("Sec", parent=styles["Normal"], fontName="Helvetica-Bold", fontSize=11,
                     textColor=colors.HexColor("#0F766E"), spaceBefore=8, spaceAfter=6)
Sm = ParagraphStyle("Sm", parent=styles["Normal"], fontName="Helvetica", fontSize=8, textColor=SUB, leading=11)
Cell = ParagraphStyle("Cell", parent=styles["Normal"], fontName="Helvetica", fontSize=9, textColor=INK)


class Band(Flowable):
    def __init__(self, w, h=22 * mm):
        super().__init__()
        self.w, self.h = w, h

    def wrap(self, *a):
        return self.w, self.h

    def draw(self):
        c = self.canv
        c.setFillColor(INK)
        c.roundRect(0, 0, self.w, self.h, 6, stroke=0, fill=1)
        c.setFillColor(TEAL)
        c.rect(0, 0, 3 * mm, self.h, stroke=0, fill=1)
        c.setFillColor(colors.white)
        c.setFont("Helvetica-Bold", 15)
        c.drawString(8 * mm, self.h - 10 * mm, "Time Tracking Coverage vs ClickUp")
        c.setFillColor(colors.HexColor("#94A3B8"))
        c.setFont("Helvetica", 9)
        c.drawString(8 * mm, self.h - 16 * mm,
                     "How tracked time links to ClickUp tasks  |  All-time + current year")


def stat(label, val, sub, col, w):
    t = Table([[Paragraph(f'<font size=8 color="#64748B">{label}</font>', Sm)],
               [Paragraph(f'<font size=26 color="#{col.hexval()[2:]}"><b>{val}</b></font>', Cell)],
               [Paragraph(f'<font size=8 color="#94A3B8">{sub}</font>', Sm)]], colWidths=[w])
    t.setStyle(TableStyle([("BACKGROUND", (0, 0), (-1, -1), CARD), ("BOX", (0, 0), (-1, -1), 0.6, LINE),
                           ("LEFTPADDING", (0, 0), (-1, -1), 10), ("TOPPADDING", (0, 0), (-1, -1), 5),
                           ("BOTTOMPADDING", (0, 0), (-1, -1), 5)]))
    return t


def donut(w):
    d = Drawing(w, 62 * mm)
    pie = Pie()
    pie.x = w / 2 - 25 * mm
    pie.y = 6
    pie.width = 50 * mm
    pie.height = 50 * mm
    pie.data = [matched, project, unmatched]
    pie.labels = [f"{pc(matched):.0f}%", f"{pc(project):.0f}%", f"{pc(unmatched):.0f}%"]
    pie.slices[0].fillColor = TEAL
    pie.slices[1].fillColor = BLUE
    pie.slices[2].fillColor = AMBER
    pie.slices.strokeColor = colors.white
    pie.slices.strokeWidth = 1.5
    for i in range(3):
        pie.slices[i].fontName = "Helvetica-Bold"
        pie.slices[i].fontSize = 10
    pie.innerRadiusFraction = 0.55
    d.add(pie)
    return d


doc = SimpleDocTemplate("../tracking_coverage_report.pdf", pagesize=A4, leftMargin=16 * mm,
                        rightMargin=16 * mm, topMargin=12 * mm, bottomMargin=14 * mm,
                        title="Tracking Coverage vs ClickUp", author="Finovate Insight")
W = doc.width
story = [Band(W), Spacer(1, 8)]
story.append(Paragraph(
    f"Of <b>{total:,.0f} total tracked hours</b>, "
    f"<b>{pc(matched):.0f}%</b> is on tasks linked to ClickUp, "
    f"<b>{pc(project):.0f}%</b> is tracked directly on a project (no task), and "
    f"<b>{pc(unmatched):.0f}%</b> is on tasks that don't match any ClickUp task.", Sub))
story.append(Spacer(1, 8))

cw = (W - 12) / 3.0
story.append(Table([[stat("TASK + MATCHED TO CLICKUP", f"{pc(matched):.1f}%", f"{matched:,.0f} h", TEAL, cw),
                     stat("TRACKED ON PROJECT (NO TASK)", f"{pc(project):.1f}%", f"{project:,.0f} h", BLUE, cw),
                     stat("TASK BUT UNMATCHED", f"{pc(unmatched):.1f}%", f"{unmatched:,.0f} h", AMBER, cw)]],
                   colWidths=[cw, cw, cw], hAlign="LEFT"))
story.append(Spacer(1, 4))
story.append(donut(W))
story.append(Paragraph(
    '<font color="#0D9488">&#9632;</font> Task matched to ClickUp &nbsp;&nbsp;'
    '<font color="#2563EB">&#9632;</font> Project-level (no task) &nbsp;&nbsp;'
    '<font color="#D97706">&#9632;</font> Task unmatched', Sm))

story.append(Paragraph("Breakdown", Sec))
rows = [[Paragraph("<b>Category</b>", Cell), Paragraph("<b>Hours</b>", Cell), Paragraph("<b>Share</b>", Cell), Paragraph("<b>Meaning</b>", Cell)],
        [Paragraph("Task &mdash; matched to ClickUp", Cell), Paragraph(f"{matched:,.0f}", Cell), Paragraph(f"{pc(matched):.1f}%", Cell), Paragraph("Task ID found in ClickUp (exact link)", Sm)],
        [Paragraph("Tracked on project (no task)", Cell), Paragraph(f"{project:,.0f}", Cell), Paragraph(f"{pc(project):.1f}%", Cell), Paragraph("No task created &mdash; time logged on the project", Sm)],
        [Paragraph("Task &mdash; unmatched to ClickUp", Cell), Paragraph(f"{unmatched:,.0f}", Cell), Paragraph(f"{pc(unmatched):.1f}%", Cell), Paragraph("Task exists in Hubstaff but not found in ClickUp data", Sm)],
        [Paragraph("<b>Total</b>", Cell), Paragraph(f"<b>{total:,.0f}</b>", Cell), Paragraph("<b>100%</b>", Cell), Paragraph("", Sm)]]
t = Table(rows, colWidths=[W * 0.30, W * 0.13, W * 0.12, W * 0.45])
t.setStyle(TableStyle([("LINEBELOW", (0, 0), (-1, 0), 1, TEAL), ("LINEBELOW", (0, 1), (-1, -2), 0.4, LINE),
                       ("LINEABOVE", (0, -1), (-1, -1), 0.8, INK), ("ROWBACKGROUNDS", (0, 1), (-1, -2), [colors.white, CARD]),
                       ("ALIGN", (1, 0), (2, -1), "RIGHT"), ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                       ("TOPPADDING", (0, 0), (-1, -1), 5), ("BOTTOMPADDING", (0, 0), (-1, -1), 5)]))
story.append(t)

story.append(Paragraph("Current Year (2026) &mdash; for context", Sec))
story.append(Paragraph(
    f"In 2026 so far: <b>{m2/cyt*100:.0f}%</b> matched, <b>{p2/cyt*100:.0f}%</b> project-level, "
    f"<b>{u2/cyt*100:.0f}%</b> unmatched. Of the time that DID have a task, "
    f"<b>{m2/((m2+u2) or 1)*100:.0f}%</b> matched ClickUp &mdash; current tracking links far better than older years.", Sub))

story.append(Spacer(1, 10))
story.append(Paragraph(
    "Definitions: Hours = Hubstaff tracked time. 'Matched' = the activity's task carries a ClickUp task ID "
    "(hubstaff_tasks.remote_id) that exists in ClickUp. 'Project-level' = the activity has no task at all. "
    "'Unmatched' = a Hubstaff task exists but its ClickUp ID isn't in the ClickUp data (deleted / not synced) "
    "or it never had one.", Sm))

doc.build(story)
print("WROTE ../tracking_coverage_report.pdf")
print(f"ALL-TIME -> matched={pc(matched):.1f}%  project={pc(project):.1f}%  unmatched={pc(unmatched):.1f}%  (total {total:,.0f}h)")
print(f"2026     -> matched={m2/cyt*100:.1f}%  project={p2/cyt*100:.1f}%  unmatched={u2/cyt*100:.1f}%")
