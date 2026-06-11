# -*- coding: utf-8 -*-
"""PDF: Name reconciliation — Hubstaff (dashboard) name vs HR sheet name, status,
and what it likely is. Scoped to 2025+ data. Output -> app/Name_Reconciliation.pdf"""
import re
import difflib
import pandas as pd
import db
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.lib import colors
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, Flowable

JOB = r"C:\Users\ADMIN\Downloads\Job Details - Finovate Consulting Pvt Ltd (1).xlsx"
REL = r"C:\Users\ADMIN\Downloads\Relieved Employees - Finovate Consulting Pvt Ltd.xlsx"


def norm(s):
    return re.sub(r'[^a-z0-9]', '', str(s).lower())


def toks(s):
    s = re.sub(r'\b(mr|ms|mrs|dr)\b', '', str(s).lower())
    s = re.sub(r'[^a-z0-9 ]', ' ', s)
    return set(t for t in s.split() if len(t) >= 3)


EXT = {norm(x) for x in [
    "Susan Chalker", "Allison Rinehimer", "Carizza Bernardo", "Michael Hardyman", "Matthew Hidalgo",
    "Nicholas Short", "Neil Maslansky", "Carrie Bowman", "Sheena Ratliff", "Tommy McDonald", "Bryan Hart",
    "Kari Bolton", "Marvin Esquivel", "MARK DI ZAZZO", "Daniel Gregory", "Rachel Galliano", "Jim Kauderer",
    "Daniel Ledbetter", "Phillip Golowatsch", "Daniel Roberts", "Ahnonie Alodia Aguam", "Melissa Knox",
    "Bernadette Bryson", "Christy Nicholas", "Juliet King", "April Hayden", "Kate Carilo", "Trudi Walde",
    "Marcia Vargas Rojas", "Matthew Howard", "Michael Molina", "Peter Tournis", "Ryan Davis", "Arthur Donovan",
    "Cassie Denzler", "Erica Stuart", "test tes",
]}

job = pd.read_excel(JOB)
rel = pd.read_excel(REL)
pool = []  # (norm, tokens, status, fullname, emp)
for _, r in job.iterrows():
    pool.append((norm(r["Full Name"]), toks(r["Full Name"]), "ACTIVE", str(r["Full Name"]), str(r["Employee Number"])))
for _, r in rel.iterrows():
    pool.append((norm(r["Full Name"]), toks(r["Full Name"]), "RELIEVED", str(r["Full Name"]), str(r["Employee Number"])))
pn = [p[0] for p in pool]


def match(nm):
    n = norm(nm); tk = toks(nm)
    for p in pool:
        if n == p[0]:
            return p
    fz = difflib.get_close_matches(n, pn, n=1, cutoff=0.86)
    if fz:
        return next(p for p in pool if p[0] == fz[0])
    best = None; bs = 0
    for p in pool:
        ov = len(tk & p[1])
        if ov > bs:
            bs = ov; best = p
    return best if bs >= 2 else None


def closest(nm):
    n = norm(nm); tk = toks(nm); b = None; bs = 0
    for p in pool:
        sc = difflib.SequenceMatcher(None, n, p[0]).ratio() * 100 + len(tk & p[1]) * 15
        if sc > bs:
            bs = sc; b = p
    return b


hs = db.q("""SELECT user_name nm, round(sum(tracked)/3600.0,0) h FROM hubstaff_activities
             WHERE coalesce(user_name,'')<>'' AND coalesce(tracked,0)>0 AND date>='2025-01-01' GROUP BY 1""")

namediff, unknown, external = [], [], []
exact = 0
for _, row in hs.iterrows():
    nm, h = row["nm"], float(row["h"])
    if norm(nm) in EXT:
        external.append((nm, h)); continue
    m = match(nm)
    if m is None:
        c = closest(nm)
        unknown.append((nm, h, c[3] if c else "-", c[2] if c else "-"))
    elif norm(nm) == m[0]:
        exact += 1
    else:
        namediff.append((nm, h, m[3], m[4], m[2]))

namediff.sort(key=lambda x: -x[1]); unknown.sort(key=lambda x: -x[1]); external.sort(key=lambda x: -x[1])

# ---------------- PDF ----------------
INK = colors.HexColor("#0F172A"); SUB = colors.HexColor("#64748B"); TEAL = colors.HexColor("#0D9488")
TEALD = colors.HexColor("#0F766E"); AMBER = colors.HexColor("#D97706"); BLUE = colors.HexColor("#2563EB")
RED = colors.HexColor("#DC2626"); LINE = colors.HexColor("#E2E8F0"); CARD = colors.HexColor("#F8FAFC")
st = getSampleStyleSheet()
Sub = ParagraphStyle("Sub", parent=st["Normal"], fontName="Helvetica", fontSize=9, textColor=SUB, leading=13)
Sm = ParagraphStyle("Sm", parent=st["Normal"], fontName="Helvetica", fontSize=8, textColor=SUB, leading=11)
Cell = ParagraphStyle("Cell", parent=st["Normal"], fontName="Helvetica", fontSize=8.5, textColor=INK, leading=11)
CellB = ParagraphStyle("CellB", parent=Cell, fontName="Helvetica-Bold")
H1 = ParagraphStyle("H1", parent=st["Normal"], fontName="Helvetica-Bold", fontSize=11, textColor=TEALD, spaceBefore=10, spaceAfter=5)


class Band(Flowable):
    def __init__(self, w, h=24 * mm):
        super().__init__(); self.w, self.h = w, h

    def wrap(self, *a):
        return self.w, self.h

    def draw(self):
        c = self.canv; c.setFillColor(INK); c.roundRect(0, 0, self.w, self.h, 6, stroke=0, fill=1)
        c.setFillColor(TEAL); c.rect(0, 0, 3 * mm, self.h, stroke=0, fill=1)
        c.setFillColor(colors.white); c.setFont("Helvetica-Bold", 15)
        c.drawString(8 * mm, self.h - 10 * mm, "Employee Name Reconciliation: Hubstaff vs HR")
        c.setFillColor(colors.HexColor("#94A3B8")); c.setFont("Helvetica", 9)
        c.drawString(8 * mm, self.h - 16 * mm, "Dashboard name vs HR sheet name, status, and likely resolution")
        c.drawString(8 * mm, self.h - 21 * mm, "Scope: data from 2025 onwards")


# --- clean palette ---
HEAD = colors.HexColor("#0D9488")     # teal header
ZEBRA = colors.HexColor("#F1F5F9")    # light slate
GREEN = colors.HexColor("#16A34A")
SugStyle = ParagraphStyle("Sug", parent=Cell, fontName="Helvetica-Bold")


def P(x, s=Cell):
    return Paragraph(str(x), s)


def sug(text, color):
    return Paragraph(f'<font color="#{color.hexval()[2:]}">{text}</font>', SugStyle)


doc = SimpleDocTemplate("../Name_Reconciliation.pdf", pagesize=A4, leftMargin=16 * mm, rightMargin=16 * mm,
                        topMargin=12 * mm, bottomMargin=14 * mm, title="Name Reconciliation")
W = doc.width
s = [Band(W), Spacer(1, 10)]
total = len(hs)
s.append(Paragraph(
    f"Since 2025, <b>{total}</b> people tracked time. <b>{exact}</b> already match the HR sheet exactly. "
    f"The rest are listed below with a suggested fix.", Sub))
s.append(Spacer(1, 8))

# ---- ONE clean 3-column table ----
rows = [[P("Name in Hubstaff / ClickUp", CellB), P("Name in Excel (HR)", CellB), P("Suggested", CellB)]]
for nm, h, hrn, emp, statu in namediff:                       # same person, spelling differs
    rows.append([P(nm), P(hrn), sug("Same person - use HR name", GREEN)])
for nm, h, c, statu in unknown:                               # no clean match
    if c and c != "-":
        rows.append([P(nm), P(c), sug("Verify - likely same", AMBER)])
    else:
        rows.append([P(nm), P("- not found -"), sug("Not in HR sheet", RED)])
for nm, h in external:                                        # client-side
    rows.append([P(nm), P("- not staff -"), sug("External / client - exclude", SUB)])

t = Table(rows, colWidths=[W * 0.36, W * 0.34, W * 0.30], repeatRows=1)
t.setStyle(TableStyle([
    ("BACKGROUND", (0, 0), (-1, 0), HEAD), ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
    ("FONTSIZE", (0, 0), (-1, 0), 9.5),
    ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, ZEBRA]),
    ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
    ("TOPPADDING", (0, 0), (-1, -1), 6), ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
    ("LEFTPADDING", (0, 0), (-1, -1), 9), ("RIGHTPADDING", (0, 0), (-1, -1), 9),
    ("LINEBELOW", (0, 0), (-1, 0), 1.2, colors.white),
    ("ROUNDEDCORNERS", [4, 4, 4, 4]),
]))
s.append(t)
s.append(Spacer(1, 8))
s.append(Paragraph(
    '<font color="#16A34A">&#9632;</font> Same person, just different spelling &nbsp;&nbsp; '
    '<font color="#D97706">&#9632;</font> Verify &nbsp;&nbsp; '
    '<font color="#DC2626">&#9632;</font> Not in HR &nbsp;&nbsp; '
    '<font color="#64748B">&#9632;</font> External/client', Sm))
s.append(Spacer(1, 6))
s.append(Paragraph(
    "Why names differ: Hubstaff and the HR sheet are matched by NAME only (no shared ID). "
    "Hubstaff has informal names (Mr. Atul, garimajoshi); HR has formal names (Atul, Garima). "
    "Adding the HR Employee Number to each Hubstaff user would make matching 100%.", Sm))

doc.build(s)
print("WROTE ../Name_Reconciliation.pdf")
print(f"2025+ total={total}  exact={exact}  name-diff={len(namediff)}  unknown={len(unknown)}  external={len(external)}")
