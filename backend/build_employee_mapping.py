# -*- coding: utf-8 -*-
"""Build the employee name-mapping (Hubstaff name -> HR identity) for every
dashboard employee, and emit:
  app/employee_mapping.csv   (editable mapping "section")
  app/employee_mapping.sql   (CREATE TABLE + INSERTs to run in Supabase SQL editor)
"""
import re
import csv
import difflib
import pandas as pd
import db

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
pool = []
for _, r in job.iterrows():
    pool.append((norm(r["Full Name"]), toks(r["Full Name"]), "ACTIVE", r))
for _, r in rel.iterrows():
    pool.append((norm(r["Full Name"]), toks(r["Full Name"]), "RELIEVED", r))
pn = [p[0] for p in pool]


def match(nm):
    n = norm(nm); tk = toks(nm)
    for p in pool:
        if n == p[0]:
            return p, "exact"
    fz = difflib.get_close_matches(n, pn, n=1, cutoff=0.86)
    if fz:
        return next(p for p in pool if p[0] == fz[0]), "name-diff"
    best = None; bs = 0
    for p in pool:
        ov = len(tk & p[1])
        if ov > bs:
            bs = ov; best = p
    if bs >= 2:
        return best, "name-diff"
    return None, None


hs = db.q("""SELECT user_id::text uid, user_name nm, round(sum(tracked)/3600.0,1) h, max(date)::text last
             FROM hubstaff_activities WHERE coalesce(user_name,'')<>'' AND coalesce(tracked,0)>0 GROUP BY 1,2""")

rows = []
for _, x in hs.iterrows():
    nm, uid, h, last = x["nm"], x["uid"], float(x["h"]), x["last"]
    rec = {"hubstaff_name": nm, "hubstaff_user_id": uid, "total_hours": h, "last_worked": last,
           "hr_employee_no": "", "hr_full_name": "", "status": "", "department": "", "team": "",
           "job_title": "", "reporting_to": "", "exit_date": "", "confidence": ""}
    if norm(nm) in EXT:
        rec.update(status="EXTERNAL", confidence="external", hr_full_name="(client / not staff)")
    else:
        m, conf = match(nm)
        if m is None:
            rec.update(status="UNKNOWN", confidence="none")
        else:
            r = m[3]
            rec["status"] = m[2]
            rec["confidence"] = conf
            rec["hr_employee_no"] = str(r["Employee Number"])
            rec["hr_full_name"] = str(r["Full Name"])
            rec["job_title"] = str(r["Job Title"])
            rec["department"] = str(r["Department"])
            rec["team"] = str(r.get("Team Name", r.get("Team", "")))
            if m[2] == "ACTIVE":
                rec["reporting_to"] = str(r.get("Reporting To", ""))
            else:
                rec["exit_date"] = str(r["Exit Date"])[:10]
    rows.append(rec)

cols = ["hubstaff_name", "hubstaff_user_id", "hr_employee_no", "hr_full_name", "status",
        "department", "team", "job_title", "reporting_to", "exit_date", "confidence",
        "total_hours", "last_worked"]

# CSV (editable mapping section)
with open("../employee_mapping.csv", "w", newline="", encoding="utf-8-sig") as f:
    w = csv.DictWriter(f, fieldnames=cols)
    w.writeheader()
    for r in sorted(rows, key=lambda x: (-x["total_hours"])):
        w.writerow(r)

# SQL (run in Supabase SQL editor)
def sq(v):
    if v is None or v == "":
        return "NULL"
    return "'" + str(v).replace("'", "''") + "'"

with open("../employee_mapping.sql", "w", encoding="utf-8") as f:
    f.write("""-- Employee name mapping: Hubstaff name -> HR identity
-- Run this in Supabase SQL Editor (you are authenticated as admin there).
DROP TABLE IF EXISTS employee_mapping;
CREATE TABLE employee_mapping (
  hubstaff_name     text PRIMARY KEY,
  hubstaff_user_id  text,
  hr_employee_no    text,
  hr_full_name      text,
  status            text,           -- ACTIVE / RELIEVED / EXTERNAL / UNKNOWN
  department        text,
  team              text,
  job_title         text,
  reporting_to      text,
  exit_date         date,
  confidence        text,           -- exact / name-diff / external / none
  total_hours       numeric,
  last_worked       date,
  reviewed          boolean DEFAULT false,   -- set true after a human checks the row
  updated_at        timestamptz DEFAULT now()
);
""")
    for r in sorted(rows, key=lambda x: (-x["total_hours"])):
        vals = [sq(r["hubstaff_name"]), sq(r["hubstaff_user_id"]), sq(r["hr_employee_no"]),
                sq(r["hr_full_name"]), sq(r["status"]), sq(r["department"]), sq(r["team"]),
                sq(r["job_title"]), sq(r["reporting_to"]), sq(r["exit_date"] or None),
                sq(r["confidence"]), str(r["total_hours"]), sq(r["last_worked"] or None)]
        f.write("INSERT INTO employee_mapping (hubstaff_name,hubstaff_user_id,hr_employee_no,"
                "hr_full_name,status,department,team,job_title,reporting_to,exit_date,confidence,"
                "total_hours,last_worked) VALUES (" + ",".join(vals) + ");\n")
    f.write("\n-- read-only role can SELECT it:\n")
    f.write("GRANT SELECT ON employee_mapping TO finovate_viewer;\n")

from collections import Counter
c = Counter(r["status"] for r in rows)
print("WROTE ../employee_mapping.csv and ../employee_mapping.sql")
print("rows:", len(rows), "| status counts:", dict(c))
