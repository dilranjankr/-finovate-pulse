# -*- coding: utf-8 -*-
"""Full data documentation PDF: data sources, lineage, coverage, problems, plan.
Output -> app/Data_Documentation.pdf"""
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.lib import colors
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.platypus import (SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle,
                                Flowable, KeepTogether)

INK = colors.HexColor("#0F172A"); SUB = colors.HexColor("#64748B")
TEAL = colors.HexColor("#0D9488"); TEALD = colors.HexColor("#0F766E")
AMBER = colors.HexColor("#D97706"); BLUE = colors.HexColor("#2563EB")
LINE = colors.HexColor("#E2E8F0"); CARD = colors.HexColor("#F8FAFC")

st = getSampleStyleSheet()
Body = ParagraphStyle("Body", parent=st["Normal"], fontName="Helvetica", fontSize=9, textColor=INK, leading=13)
Sub = ParagraphStyle("Sub", parent=st["Normal"], fontName="Helvetica", fontSize=9, textColor=SUB, leading=13)
Sm = ParagraphStyle("Sm", parent=st["Normal"], fontName="Helvetica", fontSize=8, textColor=SUB, leading=11)
Cell = ParagraphStyle("Cell", parent=st["Normal"], fontName="Helvetica", fontSize=8.5, textColor=INK, leading=11)
CellB = ParagraphStyle("CellB", parent=Cell, fontName="Helvetica-Bold")
H1 = ParagraphStyle("H1", parent=st["Normal"], fontName="Helvetica-Bold", fontSize=12, textColor=TEALD,
                    spaceBefore=12, spaceAfter=6)


class Band(Flowable):
    def __init__(self, w, h=26 * mm):
        super().__init__(); self.w, self.h = w, h

    def wrap(self, *a):
        return self.w, self.h

    def draw(self):
        c = self.canv
        c.setFillColor(INK); c.roundRect(0, 0, self.w, self.h, 6, stroke=0, fill=1)
        c.setFillColor(TEAL); c.rect(0, 0, 3 * mm, self.h, stroke=0, fill=1)
        c.setFillColor(colors.white); c.setFont("Helvetica-Bold", 16)
        c.drawString(8 * mm, self.h - 10 * mm, "Finovate Insight - Data Documentation")
        c.setFillColor(colors.HexColor("#94A3B8")); c.setFont("Helvetica", 9.5)
        c.drawString(8 * mm, self.h - 16 * mm, "Hubstaff + ClickUp Operations Dashboard")
        c.drawString(8 * mm, self.h - 21 * mm, "Where every number comes from, and every data problem we found.")


def tbl(data, widths, head=True):
    t = Table(data, colWidths=widths)
    style = [("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, CARD]),
             ("LINEBELOW", (0, 0), (-1, -1), 0.4, LINE),
             ("VALIGN", (0, 0), (-1, -1), "TOP"),
             ("TOPPADDING", (0, 0), (-1, -1), 4), ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
             ("LEFTPADDING", (0, 0), (-1, -1), 6), ("RIGHTPADDING", (0, 0), (-1, -1), 6)]
    if head:
        style += [("BACKGROUND", (0, 0), (-1, 0), INK), ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
                  ("LINEBELOW", (0, 0), (-1, 0), 1, TEAL)]
    t.setStyle(TableStyle(style))
    return t


def P(txt, s=Cell):
    return Paragraph(txt, s)


doc = SimpleDocTemplate("../Data_Documentation.pdf", pagesize=A4, leftMargin=14 * mm, rightMargin=14 * mm,
                        topMargin=12 * mm, bottomMargin=12 * mm, title="Finovate Insight - Data Documentation")
W = doc.width
s = [Band(W), Spacer(1, 8)]

# 1. Sources
s.append(Paragraph("1. Data Sources (kahaan se aata hai)", H1))
s.append(Paragraph("Dashboard 2 systems ko Supabase (Postgres) me jodta hai:", Sub))
s.append(Spacer(1, 4))
s.append(tbl([[P("System", CellB), P("Kya deta hai", CellB), P("Tables", CellB)],
              [P("Hubstaff", CellB), P("Time / ghante"), P("hubstaff_activities, _projects, _clients, _tasks, _members", Sm)],
              [P("ClickUp", CellB), P("Structure (Dept/Team/Client/tasks)"), P("clickup_tasks", Sm)]],
             [W * 0.16, W * 0.40, W * 0.44]))
s.append(Spacer(1, 4))
s.append(Paragraph("Total tracked: ~350,853 hours &nbsp;|&nbsp; Employees: 230 &nbsp;|&nbsp; Clients: 333 "
                   "&nbsp;|&nbsp; Teams: 19 &nbsp;|&nbsp; Departments: ~13", Sm))

# 2. Lineage
s.append(Paragraph("2. Har cheez kaise banti hai (lineage)", H1))
s.append(tbl([[P("Field", CellB), P("Source", CellB), P("Rule", CellB)],
              [P("Department"), P("ClickUp space_name"), P("'-' se pehle. e.g. Operations - Titans -> Operations")],
              [P("Team"), P("ClickUp space_name"), P("poora space naam")],
              [P("Client"), P("ClickUp folder_name"), P("folder = client")],
              [P("Client type"), P("folder naam"), P("(F)=Fixed, (H)=Hourly, warna Project")],
              [P("Employee"), P("Hubstaff user_name"), P("ClickUp assignees se naam/email match")],
              [P("Hours"), P("Hubstaff tracked"), P("seconds / 3600")],
              [P("Billable/NB"), P("task/project naam"), P("'NB' marker = non-billable")]],
             [W * 0.18, W * 0.27, W * 0.55]))
s.append(Spacer(1, 5))
s.append(Paragraph("<b>Hubstaff &harr; ClickUp link:</b> hubstaff_tasks.remote_id = clickup_tasks.task_id "
                   "(integration 189908). Match hone par task naam 99.97% same. ClickUp me Hubstaff ID nahi "
                   "&mdash; link ek-tarfa.", Sub))
s.append(Spacer(1, 4))
s.append(Paragraph("<b>Formulas:</b> Utilization = tracked / (days x 8h), capped 100%. Activity = overall/tracked. "
                   "Productivity = billable share. Grade = 0.4 Util + 0.3 Prod + 0.3 Task-completion.", Sm))

# 3. Coverage
s.append(Paragraph("3. Matching Coverage", H1))
s.append(tbl([[P("Category", CellB), P("All-time", CellB), P("2026", CellB)],
              [P("Task + matched to ClickUp"), P("53.4%"), P("61.6%")],
              [P("Project-level (no task)"), P("20.8%"), P("30.7%")],
              [P("Task but unmatched"), P("25.8%"), P("7.8%")]],
             [W * 0.50, W * 0.25, W * 0.25]))
s.append(Spacer(1, 3))
s.append(Paragraph("Jab task pe ClickUp ID hota hai, woh ~89% match karta hai (2026). Overall isliye kam, "
                   "kyunki ~30% time bina task ke seedha project pe track hota hai.", Sm))

# 4. Problems
s.append(Paragraph("4. Problems (data-verified)", H1))
probs = [
    ("A1", "ClickUp tasks ka Space label BLANK (e.g. Operations - Bravix) -> Dept/Team map nahi hota", "~23,321 h"),
    ("A2", "Naam variants: Ledger Labs-, Ledger Labs Inc., 'marketing' (lowercase) - standard nahi", "naming"),
    ("A3", "ClickUp se DELETE ho chuke tasks (zyadatar 2023-24 purana)", "~51,000 h"),
    ("B4", "Hubstaff projects me Client linked nahi (sab '(no client)')", "all projects"),
    ("B5", "Hubstaff member names blank (asli naam activities.user_name me)", "data hygiene"),
    ("B6", "Galat 8-char task IDs - 0 match", "520 tasks"),
    ("B7", "Bina task ke seedha project pe tracking (Training/Emailing/Admin/NB)", "21% time"),
    ("C8", "DOUBLE-COUNTING: har employee ke saare ghante ek 'primary' team me -> team totals 3.4x, "
           "dept totals 2.3x inflated", "BIG"),
    ("C9", "Utilization 'active days' use karta hai; company rule (Mon-Fri + 1st Sat) = 'working days' hona chahiye", "metric"),
    ("D10", "Archived Projects = purane projects ka store-room (168 me 165 band); 'Emailing & Training' "
            "(17,931 h) internal kaam galti se yahan", "65,724 h"),
]
rows = [[P("#", CellB), P("Problem", CellB), P("Impact", CellB)]]
for n, t, i in probs:
    rows.append([P(n, CellB), P(t), Paragraph(i, ParagraphStyle("imp", parent=Cell, textColor=colors.HexColor("#DC2626"), fontName="Helvetica-Bold"))])
s.append(tbl(rows, [W * 0.06, W * 0.74, W * 0.20]))

# 5. Plan
s.append(Paragraph("5. Fix / Action Plan", H1))
s.append(tbl([[P("Phase", CellB), P("Kaam", CellB), P("Owner", CellB), P("Asar", CellB)],
              [P("1"), P("Attribution task-ID link se rebuild + working-days utilization"), P("Dashboard"), P("Turant sahi")],
              [P("2"), P("ClickUp blank Space bharo (Bravix se), naam standardize, delete mat karo"), P("ClickUp admin"), P("53% -> ~76%")],
              [P("3"), P("Hubstaff projects-client link, member names, 8-char ID"), P("Hubstaff admin"), P("Clean data")],
              [P("4"), P("Recurring kaam ke liye standing ClickUp tasks"), P("Team leads"), P("31% ghatega")]],
             [W * 0.08, W * 0.50, W * 0.21, W * 0.21]))
s.append(Spacer(1, 4))
s.append(Paragraph("<b>Target:</b> abhi 53% exact match -> Phase 1+2 ke baad ~90%, asli client hours, "
                   "working-day utilization.", Sub))

# 6. Proof
s.append(Paragraph("6. Proof (verified)", H1))
for t in ["Match link: 45,113 Hubstaff tasks me 35,428 ClickUp se match, 99.97% same naam.",
          "Double-counting: sab team totals ka jod = 1,204,967 h (OLD) vs actual 350,853 h = 3.4x inflated.",
          "Sohan Singh: OLD har team me poora 6,874 h; NEW asli split (Titans 4,275 + Archived 1,344 + "
          "Alliance 680...) = 6,874 h, no double-count.",
          "Utilization: Sohan March active-days 100% vs working-days 94%."]:
    s.append(Paragraph("&bull; " + t, Sm))

s.append(Spacer(1, 10))
s.append(Paragraph("Generated by Finovate Insight  |  Source: Hubstaff (time) + ClickUp (structure)  |  "
                   "Supabase Postgres.", Sm))

doc.build(s)
print("WROTE ../Data_Documentation.pdf")
