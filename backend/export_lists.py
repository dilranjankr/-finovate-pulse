"""Export clean CSV lists (Employees / Clients / Departments / Teams) using the
SAME logic the dashboard uses, so you can show exactly where each thing comes
from. Output CSVs land in the app/ folder.

Status rule (time-based, easy to explain):
  ACTIVE   = time tracked in the last 30 days
  IDLE     = worked in last 90 days but nothing in last 30
  INACTIVE = no time tracked in the last 90 days
"""
import csv
from contextlib import contextmanager
from main import load, clickup_intel, _dept_of, _team_of, _client_cat  # noqa
import db  # noqa
import pandas as pd

OUT = ".."  # app/ folder


@contextmanager
def safe_csv(path):
    """Open a CSV for writing; if locked (open in Excel) warn and skip it."""
    try:
        f = open(path, "w", newline="", encoding="utf-8-sig")
    except PermissionError:
        print(f"SKIPPED (close it in Excel first): {path}")
        yield None
        return
    try:
        yield csv.writer(f)
    finally:
        f.close()


members, g = load()

# hours per user from the activities aggregate
hu = (g.groupby("user_id").agg(tracked_h=("tracked_h", "sum"), billable_h=("billable_h", "sum"),
                               non_billable_h=("non_billable_h", "sum"), days=("date_s", "nunique"))
      .reset_index())
m = members.merge(hu, on="user_id", how="left")
for c in ["tracked_h", "billable_h", "non_billable_h", "days"]:
    m[c] = m[c].fillna(0)

# latest data date + 30/90-day activity windows (shared by all sheets)
latest = pd.to_datetime(g["date_s"]).max()
cut30 = (latest - pd.Timedelta(days=30)).strftime("%Y-%m-%d")
cut90 = (latest - pd.Timedelta(days=90)).strftime("%Y-%m-%d")
g30 = g[g["date_s"] >= cut30]
g90 = g[g["date_s"] >= cut90]


def _top(col):
    """For each user_id, the value of `col` carrying the most tracked hours."""
    gg = g.groupby(["user_id", col])["tracked_h"].sum().reset_index()
    gg = gg.sort_values("tracked_h", ascending=False).drop_duplicates("user_id")
    return dict(zip(gg["user_id"], gg[col]))


primary_dept = _top("department")
primary_team = _top("atl")
last_u = g.groupby("user_id")["date_s"].max().to_dict()
h30_u = g30.groupby("user_id")["tracked_h"].sum().to_dict()
h90_u = g90.groupby("user_id")["tracked_h"].sum().to_dict()


def status_of(recent30, recent90):
    if recent30 > 0:
        return "ACTIVE"
    if recent90 > 0:
        return "IDLE (no work 30d)"
    return "INACTIVE"


def setcol(r, col):
    v = r.get(col)
    return "; ".join(v) if isinstance(v, list) else ""


# ---------- 1) employees.csv ----------
with safe_csv(f"{OUT}/employees.csv") as w:
    if w:
        w.writerow(["Employee", "Status", "Last worked", "Primary Department", "Primary Team",
                    "All Teams (ClickUp spaces)", "All Clients (ClickUp folders)",
                    "Tracked_h", "Billable_h", "NonBillable_h", "Active_days"])
        for _, r in m.sort_values("tracked_h", ascending=False).iterrows():
            uid = r["user_id"]
            w.writerow([r["name"], status_of(h30_u.get(uid, 0), h90_u.get(uid, 0)), last_u.get(uid, "-"),
                        primary_dept.get(uid, ""), primary_team.get(uid, ""),
                        setcol(r, "team_set"), setcol(r, "client_set"),
                        round(float(r["tracked_h"]), 1), round(float(r["billable_h"]), 1),
                        round(float(r["non_billable_h"]), 1), int(r["days"])])

# ---------- 2) clients.csv ----------
cdim = clickup_intel()["clients"]
hrs_by = g.groupby("client")["tracked_h"].sum().to_dict()
last_by = g.groupby("client")["date_s"].max().to_dict()
h30_by = g30.groupby("client")["tracked_h"].sum().to_dict()
h90_by = g90.groupby("client")["tracked_h"].sum().to_dict()
all_clients = set()
emp_by_client = {}
for _, r in m.iterrows():
    for c in (r.get("client_set") or []):
        if c and c != "Unassigned":
            all_clients.add(c)
            emp_by_client.setdefault(c, []).append(r["name"])
all_clients.update(c for c in hrs_by if c and c != "Unassigned")
with safe_csv(f"{OUT}/clients.csv") as w:
    if w:
        w.writerow(["Client (ClickUp folder)", "Status", "Type", "Last worked", "Hours last 30d",
                    "Total hours", "Open tasks (ClickUp)", "Total tasks", "Employees on it"])
        for c in sorted(all_clients, key=lambda x: -hrs_by.get(x, 0)):
            info = cdim.get(c, {})
            emps = sorted(set(emp_by_client.get(c, [])))
            w.writerow([c, status_of(h30_by.get(c, 0), h90_by.get(c, 0)), info.get("category", "Project"),
                        last_by.get(c, "-"), round(float(h30_by.get(c, 0.0)), 1),
                        round(float(hrs_by.get(c, 0.0)), 1), int(info.get("active_tasks", 0)),
                        int(info.get("total", 0)), "; ".join(emps[:20])])

# ---------- 3) departments.csv ----------
from main import _dept_of  # noqa
dep_emps, dep_teams = {}, {}
for _, r in m.iterrows():
    for d in (r.get("dept_set") or []):
        dep_emps.setdefault(d, set()).add(r["name"])
    for t in (r.get("team_set") or []):
        dep_teams.setdefault(_dept_of(t), set()).add(t)
dh = g.groupby("department")["tracked_h"].sum().to_dict()
dh30 = g30.groupby("department")["tracked_h"].sum().to_dict()
with safe_csv(f"{OUT}/departments.csv") as w:
    if w:
        w.writerow(["Department", "Status", "Employees", "Teams (count)", "Teams",
                    "Hours last 30d", "Total hours"])
        for d in sorted(dep_emps, key=lambda x: -dh.get(x, 0)):
            teams = sorted(dep_teams.get(d, set()))
            w.writerow([d, status_of(dh30.get(d, 0), dh.get(d, 0)), len(dep_emps[d]), len(teams),
                        "; ".join(teams), round(float(dh30.get(d, 0.0)), 1), round(float(dh.get(d, 0.0)), 1)])

# ---------- 4) teams.csv ----------
team_emps = {}
for _, r in m.iterrows():
    for t in (r.get("team_set") or []):
        team_emps.setdefault(t, set()).add(r["name"])
th = g.groupby("atl")["tracked_h"].sum().to_dict()
th30 = g30.groupby("atl")["tracked_h"].sum().to_dict()
with safe_csv(f"{OUT}/teams.csv") as w:
    if w:
        w.writerow(["Team (ClickUp space)", "Status", "Department", "Employees",
                    "Hours last 30d", "Total hours"])
        for t in sorted(team_emps, key=lambda x: -th.get(x, 0)):
            w.writerow([t, status_of(th30.get(t, 0), th.get(t, 0)), _dept_of(t), len(team_emps[t]),
                        round(float(th30.get(t, 0.0)), 1), round(float(th.get(t, 0.0)), 1)])

# ---------- 5) RULE PROOF: raw ClickUp -> derived names ----------
# Straight from clickup_tasks, applying the SAME _dept_of/_team_of/_client_cat
# rules the dashboard uses, so the manager can see exactly how each raw name maps.
ct = db.q("""SELECT coalesce(space_name,'') sp, coalesce(folder_name,'') fo, count(*) n
             FROM clickup_tasks
             WHERE coalesce(is_deleted,false)=false AND coalesce(archived,false)=false
             GROUP BY 1,2""")

# 5a) space -> Department / Team
sp_tasks = ct.groupby("sp")["n"].sum().to_dict()
with safe_csv(f"{OUT}/mapping_space_to_dept_team.csv") as w:
    if w:
        w.writerow(["ClickUp Space (raw)", "==> Department (rule: before ' - ')",
                    "==> Team (rule: after ' - ')", "ClickUp tasks"])
        for sp in sorted(sp_tasks, key=lambda x: -sp_tasks[x]):
            if not sp:
                continue
            w.writerow([sp, _dept_of(sp), _team_of(sp), int(sp_tasks[sp])])

# 5b) folder -> Client / Type (and which space it sits under)
fo_rows = {}
for _, r in ct.iterrows():
    fo, sp, n = r["fo"], r["sp"], int(r["n"])
    if not fo:
        continue
    d = fo_rows.setdefault(fo, {"n": 0, "spaces": set()})
    d["n"] += n
    if sp:
        d["spaces"].add(sp)
with safe_csv(f"{OUT}/mapping_folder_to_client.csv") as w:
    if w:
        w.writerow(["ClickUp Folder (raw)", "==> Client name", "==> Type (rule: (F)/(H) marker)",
                    "Under Space(s)", "==> Department", "ClickUp tasks"])
        for fo in sorted(fo_rows, key=lambda x: -fo_rows[x]["n"]):
            spaces = sorted(fo_rows[fo]["spaces"])
            dept = "; ".join(sorted({_dept_of(s) for s in spaces})) or "-"
            w.writerow([fo, fo, _client_cat(fo), "; ".join(spaces), dept, int(fo_rows[fo]["n"])])

print("DONE. Files in app/ folder: employees.csv, clients.csv, departments.csv, teams.csv,")
print("      mapping_space_to_dept_team.csv, mapping_folder_to_client.csv")
# quick active/inactive tally for clients
act = sum(1 for c in all_clients if h30_by.get(c, 0) > 0)
idle = sum(1 for c in all_clients if h30_by.get(c, 0) == 0 and h90_by.get(c, 0) > 0)
ina = len(all_clients) - act - idle
print(f"clients -> ACTIVE={act}  IDLE={idle}  INACTIVE={ina}  (total {len(all_clients)})")
print(f"windows -> latest={latest.date()}  30d-cutoff={cut30}  90d-cutoff={cut90}")
