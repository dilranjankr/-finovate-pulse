"""
Finovate Operations Command Center — API
Source: Supabase Postgres when DATABASE_URL is set, else local CSV fallback.
Real (Hubstaff + ClickUp): hours, activity, productivity, billable, client,
department (ClickUp space), team (folder), tasks. Revenue = billable x pay_rate.

Run:  uvicorn main:app --reload --port 8000
"""
import os
import re
import difflib
from functools import lru_cache
from typing import Optional
from zlib import crc32

import numpy as np
import pandas as pd
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

import ai
import db
import org

DOWNLOADS = r"C:\Users\ADMIN\Downloads"
ACT = os.path.join(DOWNLOADS, "hubstaff_activities_rows.csv")
MEM = os.path.join(DOWNLOADS, "hubstaff_members_rows.csv")
SEC = 3600.0

app = FastAPI(title="Finovate Operations Command Center API", version="3.0")
# Allowed origins: comma-separated list in ALLOWED_ORIGINS, or "*" for any (default).
_origins_raw = os.environ.get("ALLOWED_ORIGINS", "*").strip()
_origins = ["*"] if _origins_raw in ("", "*") else [o.strip() for o in _origins_raw.split(",") if o.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=_origins,
    allow_methods=["*"], allow_headers=["*"],
)


def clean(o):
    if isinstance(o, dict):
        return {k: clean(v) for k, v in o.items()}
    if isinstance(o, (list, tuple)):
        return [clean(v) for v in o]
    if isinstance(o, np.generic):
        return o.item()
    if isinstance(o, float):
        return round(o, 2)
    if pd.isna(o) if np.isscalar(o) else False:
        return None
    return o


def grade_letter(s: float) -> str:
    if s >= 90: return "A+"
    if s >= 80: return "A"
    if s >= 75: return "B+"
    if s >= 65: return "B"
    if s >= 50: return "C"
    return "D"


# =================================================================
# LOADERS  -> return (members, g) with a shared schema
#   members: user_id, name, role, status, task_completion, rate, email
#   g (fact, per user/date/dept/team/client/type/flag):
#     user_id, name, date_s, ud, tracked_h, overall_h, billable_h,
#     non_billable_h, revenue, prod_w, tracked, productivity,
#     department, atl, client, client_type, billable(bool)
# =================================================================
def _finalize(members, g):
    g["ud"] = g["user_id"].astype(str) + "|" + g["date_s"].astype(str)
    return members, g


@lru_cache(maxsize=1)
def load():
    if db.has_db():
        try:
            return load_from_db()
        except Exception as e:  # noqa
            print("DB load failed, falling back to CSV:", e)
    return load_from_csv()


def load_from_csv():
    mem = pd.read_csv(MEM, dtype={"user_id": str})
    mem["name"] = mem["name"].fillna("").str.strip()
    mem["email"] = mem["email"].fillna("")
    mem["pay_rate"] = pd.to_numeric(mem["pay_rate"], errors="coerce")

    cols = ["user_id", "date", "overall", "tracked", "productivity", "is_deleted"]
    df = pd.read_csv(ACT, usecols=cols, dtype={"user_id": str})
    df = df[df["is_deleted"].astype(str).str.lower() != "true"].copy()
    df["date"] = pd.to_datetime(df["date"])
    for c in ["overall", "tracked", "productivity"]:
        df[c] = pd.to_numeric(df[c], errors="coerce").fillna(0)
    df["prod_w"] = df["productivity"] * df["tracked"]
    g = df.groupby(["user_id", "date"], as_index=False).agg(
        tracked=("tracked", "sum"), overall=("overall", "sum"), prod_w=("prod_w", "sum"))
    g["date_s"] = g["date"].dt.strftime("%Y-%m-%d")

    active = set(df["user_id"].unique())
    rows = []
    for _, r in mem.iterrows():
        if r["user_id"] not in active:
            continue
        a = org.assign(r["user_id"])
        rate = r["pay_rate"] if pd.notna(r["pay_rate"]) else org.default_rate(a["department"])
        rows.append({"user_id": r["user_id"], "name": r["name"] or f"ID {r['user_id']}",
                     "role": (r["effective_role"] or "").replace("organization_", "").replace("_", " ").title(),
                     "status": a["status"], "task_completion": a["task_completion"],
                     "rate": float(rate), "email": r["email"],
                     "department": a["department"], "atl": a["atl"],
                     "client": a["client"], "client_type": a["client_type"],
                     "billable": a["billable"],
                     "active_tasks": 0, "total_tasks": 0,
                     "task_status": "Active" if a["status"] == "Active" else "Idle"})
    members = pd.DataFrame(rows)

    g = g.merge(members[["user_id", "name", "rate", "department", "atl",
                         "client", "client_type", "billable"]], on="user_id", how="inner")
    g["tracked_h"] = g["tracked"] / SEC
    g["overall_h"] = g["overall"] / SEC
    g["billable_h"] = np.where(g["billable"], g["tracked_h"], 0.0)
    g["non_billable_h"] = np.where(g["billable"], 0.0, g["tracked_h"])
    g["revenue"] = g["billable_h"] * g["rate"]
    g["productivity"] = g["prod_w"] / g["tracked"].replace(0, 1)
    members = members[["user_id", "name", "role", "status", "task_completion", "rate", "email",
                        "client", "active_tasks", "total_tasks", "task_status"]]
    return _finalize(members, g)


@lru_cache(maxsize=1)
def task_meta():
    """Global ClickUp task status distribution + completion % (one cheap query)."""
    if not db.has_db():
        return {"summary": [], "completion": 70.0}
    try:
        t = db.q("""
            SELECT lower(COALESCE(status,'')) AS s, count(*) AS c
            FROM clickup_tasks
            WHERE COALESCE(is_deleted,false)=false AND COALESCE(archived,false)=false
            GROUP BY 1
        """)
    except Exception:
        return {"summary": [], "completion": 70.0}
    cnt = {"Completed": 0, "In Progress": 0, "Review": 0, "Overdue": 0}
    for _, r in t.iterrows():
        s = str(r["s"]); c = int(r["c"])
        if any(w in s for w in ("complete", "done", "closed")):
            cnt["Completed"] += c
        elif "review" in s:
            cnt["Review"] += c
        elif "overdue" in s:
            cnt["Overdue"] += c
        else:
            cnt["In Progress"] += c
    total = sum(cnt.values()) or 1
    return {"summary": [{"name": k, "value": v} for k, v in cnt.items()],
            "completion": float(round(cnt["Completed"] / total * 100))}


def _dept_of(space: str) -> str:
    s = space.split(" - ")[0]
    for suf in [" Department", " Pipeline", " Clients", "-Tax Filing", "- Ledger Labs-", " - LedgerLabs"]:
        s = s.replace(suf, "")
    s = s.replace("-", " ").strip()
    return s or "Other"


def _team_of(space: str) -> str:
    """Team = the part of the ClickUp space AFTER ' - ' (e.g. 'Operations - Titans' -> 'Titans').
    Spaces without a ' - ' divider fall back to the department name."""
    if " - " in space:
        t = space.split(" - ", 1)[1]
        for suf in ["- Ledger Labs-", " Ledger Labs", " LedgerLabs", " Clients"]:
            t = t.replace(suf, "")
        t = t.replace("-", " ").strip()
        return t or _dept_of(space)
    return _dept_of(space)


CLOSED_STATUS = {"closed", "complete", "completed", "finished", "published",
                 "cancelled", "canceled", "done", "archived"}


def _client_cat(folder: str) -> str:
    # Marker in the folder name is the source of truth: (F)=Fixed, (H)=Hourly
    fz = folder.lower().replace(" ", "")
    if "(f)" in fz: return "Fixed"
    if "(h)" in fz: return "Hourly"
    f = folder.lower()
    if "hourly" in f: return "Hourly"
    if "monthly" in f: return "Monthly"
    if "fixed" in f: return "Fixed"
    if "retainer" in f: return "Retainer"
    return "Project"


# Non-billable marker: the token "NB" anywhere in the task or project name,
# bounded by non-alphanumerics — e.g. "NB - Training", "NB-Inbox",
# ".../ NB Tasks - Synergy". "Inbox"/"NBClickUp" are NOT markers.
_NB_RE = re.compile(r"(?<![a-z0-9])nb(?![a-z0-9])", re.I)
# Postgres equivalent (task summary / project name): ~* '(^|[^a-z0-9])nb([^a-z0-9]|$)'


def _is_nb(name: str) -> bool:
    return bool(_NB_RE.search(name or ""))


@lru_cache(maxsize=1)
def clickup_intel():
    """From ClickUp tasks (matched via assignees) derive per-employee:
    Department (space prefix), Team (space), Client (folder), active/total tasks;
    and per-client: active flag + category. Used because Keka is empty."""
    blank = {"emp": {}, "clients": {}}
    if not db.has_db():
        return blank
    from collections import defaultdict
    import json
    # hubstaff_members.name is empty in this project — the real names live on the
    # denormalized activities.user_name. Build the name->uid map from there.
    mem = db.q("select distinct user_id::text uid, lower(trim(user_name)) nm "
               "from hubstaff_activities where coalesce(user_name,'')<>''")
    full, first, dupe, compact = {}, {}, set(), {}
    for _, r in mem.iterrows():
        nm, uid = r["nm"], r["uid"]
        if not nm:
            continue
        full[nm] = uid
        compact[re.sub(r"[^a-z0-9]", "", nm)] = uid
        fn = nm.split()[0] if nm.split() else nm
        if fn in first and first[fn] != uid:
            dupe.add(fn)
        else:
            first[fn] = uid
    try:
        t = db.q("""SELECT coalesce(space_name,'') sp, coalesce(folder_name,'') fo,
                           lower(coalesce(status,'')) st, coalesce(assignees,'') asg,
                           lower(coalesce(priority,'')) pr,
                           coalesce(time_tracked_hrs,0) th,
                           coalesce(nullif(subtask_name,''), parent_task_name, '') nm
                    FROM clickup_tasks
                    WHERE coalesce(is_deleted,false)=false AND coalesce(archived,false)=false""")
    except Exception:
        return blank
    PRIOS = ("urgent", "high", "normal", "low")

    def _stbucket(s):
        if any(w in s for w in ("complete", "done", "closed", "finished", "published")):
            return "completed"
        if "review" in s:
            return "review"
        if "overdue" in s:
            return "overdue"
        return "in_progress"

    e_sp = defaultdict(lambda: defaultdict(int))
    e_fo = defaultdict(lambda: defaultdict(int))
    e_act = defaultdict(int); e_tot = defaultdict(int)
    e_pri = defaultdict(lambda: defaultdict(int))
    e_st = defaultdict(lambda: defaultdict(int))
    e_nb = defaultdict(int); e_bl = defaultdict(int)
    # ClickUp tracked hours per employee: non-billable (NB tasks) vs all — used to
    # derive each person's NB ratio, which then splits their Hubstaff hours.
    e_nbh = defaultdict(float); e_th = defaultdict(float)
    clients = defaultdict(lambda: {"total": 0, "active": 0})
    for _, r in t.iterrows():
        sp, fo, st, pr = r["sp"], r["fo"], r["st"], r["pr"]
        active = st not in CLOSED_STATUS
        bucket = _stbucket(st)
        nb = _is_nb(r["nm"])
        th = float(r["th"] or 0)
        if fo:
            c = clients[fo]; c["total"] += 1; c["active"] += 1 if active else 0
        seen = set()
        # assignees is a JSON array: [{"id","username","email"}, ...]
        try:
            _ass = json.loads(r["asg"]) if r["asg"] else []
        except Exception:
            _ass = []
        for _ao in (_ass if isinstance(_ass, list) else []):
            a = str((_ao or {}).get("username", "")).strip().lower()
            if not a:
                continue
            uid = full.get(a)
            if uid is None:
                uid = compact.get(re.sub(r"[^a-z0-9]", "", a))
            if uid is None:
                fn = a.split()[0] if a.split() else a
                if fn in first and fn not in dupe:
                    uid = first[fn]
            if uid and uid not in seen:
                seen.add(uid)
                if sp: e_sp[uid][sp] += 1
                if fo: e_fo[uid][fo] += 1
                e_tot[uid] += 1
                if active: e_act[uid] += 1
                if pr in PRIOS: e_pri[uid][pr] += 1
                e_st[uid][bucket] += 1
                e_th[uid] += th
                if nb: e_nb[uid] += 1; e_nbh[uid] += th
                else: e_bl[uid] += 1
    emp = {}
    for uid in set(list(e_sp) + list(e_tot)):
        sp = max(e_sp[uid].items(), key=lambda x: x[1])[0] if e_sp[uid] else ""
        fo = max(e_fo[uid].items(), key=lambda x: x[1])[0] if e_fo[uid] else ""
        # ALL spaces/folders this employee has tasks in (employee may belong to
        # many teams over time — used so every team/dept/client is filterable).
        teams = sorted(e_sp[uid].keys()) or ["Unassigned"]
        depts = sorted({_dept_of(s) for s in e_sp[uid].keys()}) or ["Unassigned"]
        clnts = sorted(e_fo[uid].keys()) or ["Unassigned"]
        emp[uid] = {"department": _dept_of(sp) if sp else "Unassigned", "team": sp or "Unassigned",
                    "client": fo or "Unassigned", "active_tasks": e_act[uid], "total_tasks": e_tot[uid],
                    "task_status": "Active" if e_act[uid] > 0 else "Idle",
                    "teams": teams, "depts": depts, "clients": clnts,
                    "pri": {p: e_pri[uid].get(p, 0) for p in PRIOS},
                    "st": {b: e_st[uid].get(b, 0) for b in ("completed", "in_progress", "review", "overdue")},
                    "nb_tasks": e_nb[uid], "bill_tasks": e_bl[uid],
                    "nb_ratio": (e_nbh[uid] / e_th[uid]) if e_th[uid] > 0 else 0.0}
    cdim = {fo: {"active": v["active"] > 0, "category": _client_cat(fo),
                 "total": v["total"], "active_tasks": v["active"]} for fo, v in clients.items()}
    return {"emp": emp, "clients": cdim}


def load_from_db():
    # Accurate hours from hubstaff_activities (validated), enriched with REAL
    # client + project via Hubstaff project/client tables. Aggregated DB-side.
    g = db.q("""
        SELECT
          a.user_id::text AS user_id,
          a.date::text AS date_s,
          COALESCE(NULLIF(cl.name,''), 'Unassigned') AS client,
          COALESCE(NULLIF(p.name,''), 'No Project') AS atl,
          'Unassigned' AS department,
          COALESCE(NULLIF(cl.budget_type,''), NULLIF(p.budget_type,''), 'Unspecified') AS client_type,
          (COALESCE(a.billable,0) > 0) AS billable,
          SUM(COALESCE(a.tracked,0)) AS tracked,
          SUM(COALESCE(a.overall,0)) AS overall,
          SUM(COALESCE(a.billable,0)) AS billable_sec,
          -- This project's activities table has no per-row "productivity" score,
          -- so we proxy it with activity (overall/tracked): prod_w/tracked -> activity %.
          SUM(COALESCE(a.overall,0) * 100) AS prod_w,
          -- Non-billable seconds: time whose Hubstaff TASK name (summary) or
          -- PROJECT name carries the "NB" marker. task_id is often null but
          -- project_id is almost always present, so the project name catches the
          -- "NB Tasks - …" projects that activities without a task fall under.
          SUM(CASE WHEN trim(COALESCE(ht.summary,'')) ~* '(^|[^a-z0-9])nb([^a-z0-9]|$)'
                     OR trim(COALESCE(p.name,'')) ~* '(^|[^a-z0-9])nb([^a-z0-9]|$)'
                   THEN COALESCE(a.tracked,0) ELSE 0 END) AS nb_sec
        FROM hubstaff_activities a
        LEFT JOIN hubstaff_projects p ON p.id = a.project_id
        LEFT JOIN hubstaff_clients cl ON cl.id = p.client_id
        LEFT JOIN hubstaff_tasks ht ON ht.id = a.task_id
        WHERE COALESCE(a.tracked,0) > 0
        GROUP BY 1,2,3,4,5,6,7
    """)
    g["date_s"] = pd.to_datetime(g["date_s"]).dt.strftime("%Y-%m-%d")
    for c in ["tracked", "overall", "billable_sec", "prod_w", "nb_sec"]:
        g[c] = pd.to_numeric(g[c], errors="coerce").fillna(0)
    g["billable"] = g["billable"].astype(bool)
    g["tracked_h"] = g["tracked"] / SEC
    g["overall_h"] = g["overall"] / SEC
    g["billable_h"] = g["billable_sec"] / SEC
    g["non_billable_h"] = (g["tracked"] - g["billable_sec"]).clip(lower=0) / SEC
    g["productivity"] = g["prod_w"] / g["tracked"].replace(0, 1)

    # Real Department / Team / Client + task status from ClickUp
    intel = clickup_intel()
    omap, cdim = intel["emp"], intel["clients"]
    g["department"] = g["user_id"].map(lambda u: (omap.get(u) or {}).get("department") or "Unassigned")
    g["atl"] = g["user_id"].map(lambda u: (omap.get(u) or {}).get("team") or "Unassigned")
    g["client"] = g["user_id"].map(lambda u: (omap.get(u) or {}).get("client") or "Unassigned")
    g["client_type"] = g["client"].map(lambda c: (cdim.get(c) or {}).get("category", "Project"))

    # Billable vs Non-Billable straight from the NB task marker on the Hubstaff
    # task (activities.task_id -> hubstaff_tasks.summary, computed as nb_sec in the
    # query above). Time on "NB - …" tasks is non-billable; time with no linked
    # task (no task_id) defaults to billable.
    g["nb_sec"] = g[["nb_sec", "tracked"]].min(axis=1).clip(lower=0)
    g["non_billable_h"] = g["nb_sec"] / SEC
    g["billable_h"] = (g["tracked"] - g["nb_sec"]).clip(lower=0) / SEC
    g["billable_sec"] = (g["tracked"] - g["nb_sec"]).clip(lower=0)
    g["billable"] = g["nb_sec"] < (g["tracked"] * 0.5)

    # members (user-level)
    mem = db.q("""
        SELECT user_id::text AS user_id, COALESCE(name,'') AS name,
               COALESCE(email,'') AS email,
               COALESCE(effective_role,'') AS role, pay_rate
        FROM hubstaff_members
    """)
    mem["role"] = mem["role"].str.replace("organization_", "", regex=False).str.replace("_", " ", regex=False).str.title()

    comp = task_meta()["completion"]

    # status from recency + member attributes via maps (no per-row scans)
    last = g.groupby("user_id")["date_s"].max()
    gmax_d = pd.to_datetime(g["date_s"].max())
    name_map = dict(zip(mem["user_id"], mem["name"]))
    # hubstaff_members.name is empty in this project — fall back to the denormalized
    # activities.user_name so employees show real names instead of "User <id>".
    try:
        _nm = db.q("select user_id::text uid, max(user_name) un from hubstaff_activities "
                   "where coalesce(user_name,'')<>'' group by 1")
        for _u, _n in zip(_nm["uid"], _nm["un"]):
            if not name_map.get(_u):
                name_map[_u] = _n
    except Exception:
        pass
    rate_map = dict(zip(mem["user_id"], pd.to_numeric(mem["pay_rate"], errors="coerce")))
    role_map = dict(zip(mem["user_id"], mem["role"]))
    email_map = dict(zip(mem["user_id"], mem["email"]))
    rows = []
    for uid in g["user_id"].unique():
        gap = (gmax_d - pd.to_datetime(last.get(uid))).days
        status = "Active" if gap <= 1 else ("Idle" if gap <= 4 else "Offline")
        rate = rate_map.get(uid)
        if pd.isna(rate) or not rate:
            rate = 40.0
        info = omap.get(uid) or {}
        rows.append({"user_id": uid, "name": name_map.get(uid) or f"User {uid}",
                     "role": role_map.get(uid, ""), "status": status,
                     "task_completion": comp, "rate": float(rate),
                     "email": email_map.get(uid, ""),
                     "active_tasks": int(info.get("active_tasks", 0)),
                     "total_tasks": int(info.get("total_tasks", 0)),
                     "task_status": info.get("task_status", "Idle"),
                     "client": info.get("client", "Unassigned"),
                     "dept_set": info.get("depts", []),
                     "team_set": info.get("teams", []),
                     "client_set": info.get("clients", []),
                     "pri": info.get("pri", {"urgent": 0, "high": 0, "normal": 0, "low": 0}),
                     "st": info.get("st", {"completed": 0, "in_progress": 0, "review": 0, "overdue": 0}),
                     "nb_tasks": int(info.get("nb_tasks", 0)), "bill_tasks": int(info.get("bill_tasks", 0))})
    members = pd.DataFrame(rows)
    g["revenue"] = g["billable_h"] * g["user_id"].map(rate_map).fillna(40.0)
    return _finalize(members, g)


# =================================================================
# FILTERS
# =================================================================
def _vals(x):
    """Accept a single value or a comma-separated multi-select list."""
    if not x:
        return []
    return [v.strip() for v in str(x).split(",") if v.strip()]


def apply_filters(members, g, f):
    has_sets = "team_set" in members.columns
    m = members
    for key, col in [("employee", "name"), ("role", "role"), ("status", "status")]:
        vals = _vals(f.get(key))
        if vals:
            m = m[m[col].isin(vals)]
    # Department / Team / Client by MEMBERSHIP — an employee can belong to many,
    # so selecting any team/dept/client surfaces everyone who works in it.
    if has_sets:
        for key, setcol in [("department", "dept_set"), ("atl", "team_set"), ("client", "client_set")]:
            vals = _vals(f.get(key))
            if vals:
                sv = set(vals)
                m = m[m[setcol].apply(lambda s: bool(sv & set(s or [])))]
    ids = set(m["user_id"])
    d = g[g["user_id"].isin(ids)]
    col_keys = [("client_type", "client_type")] if has_sets else \
        [("department", "department"), ("atl", "atl"), ("client", "client"), ("client_type", "client_type")]
    for key, col in col_keys:
        vals = _vals(f.get(key))
        if vals:
            d = d[d[col].isin(vals)]
    bf = f.get("billable")
    if bf in ("Billable", "Non-Billable") and not d.empty:
        # Scale every row to just its billable (or non-billable) portion, using the
        # NB ratio — so hours, utilization, activity & productivity all reflect that
        # slice, instead of dropping whole rows.
        d = d.copy()
        keep = d["billable_h"] if bf == "Billable" else d["non_billable_h"]
        frac = (keep / d["tracked_h"].replace(0, np.nan)).fillna(0.0)
        for c in ["tracked_h", "overall_h", "tracked", "overall", "prod_w", "revenue"]:
            if c in d.columns:
                d[c] = d[c] * frac
        if bf == "Billable":
            d["billable_h"] = d["tracked_h"]; d["non_billable_h"] = 0.0; d["billable_sec"] = d["tracked"]
        else:
            d["non_billable_h"] = d["tracked_h"]; d["billable_h"] = 0.0; d["billable_sec"] = 0.0
    if f.get("date_from"):
        d = d[d["date_s"] >= f["date_from"]]
    if f.get("date_to"):
        d = d[d["date_s"] <= f["date_to"]]
    # Re-tag grouping dimensions to the active filter, so every chart/table/KPI
    # reflects the selected department/team/client (not the employee's primary).
    if has_sets and not d.empty:
        d = d.copy()
        for key, setcol, gcol in [("department", "dept_set", "department"),
                                  ("atl", "team_set", "atl"), ("client", "client_set", "client")]:
            vals = _vals(f.get(key))
            if not vals:
                continue
            belong = dict(zip(m["user_id"], m[setcol]))
            chosen = {}
            for uid in belong:
                bs = set(belong.get(uid) or [])
                pk = next((v for v in vals if v in bs), None)
                if pk:
                    chosen[uid] = pk
            mapped = d["user_id"].map(chosen)
            d[gcol] = mapped.fillna(d[gcol])
        # client_type follows the (possibly re-tagged) client
        if _vals(f.get("client")):
            intel = clickup_intel()
            cd = intel["clients"]
            d["client_type"] = d["client"].map(lambda c: (cd.get(c) or {}).get("category", "Project"))
    return m, d


def _period_headline(members, g, f):
    """Headline metrics for a given filter window — used for period-over-period."""
    _, dd = apply_filters(members, g, f)
    if dd.empty:
        return {"total": 0.0, "billable": 0.0, "non_billable": 0.0, "util": 0.0, "prod": 0.0, "act": 0.0, "emps": 0}
    b = float(dd["billable_h"].sum()); nb = float(dd["non_billable_h"].sum()); t = b + nb
    ed = int(dd["ud"].nunique()); cap = ed * 8
    tr = float(dd["tracked"].sum())
    return {"total": t, "billable": b, "non_billable": nb,
            "util": min(100.0, t / cap * 100) if cap else 0.0,
            "prod": float(dd["prod_w"].sum() / tr) if tr else 0.0,
            "act": float(dd["overall_h"].sum() / t * 100) if t else 0.0,
            "emps": int(dd["user_id"].nunique())}


def trend_pct(arr):
    n = len(arr)
    if n < 4:
        return 0.0
    h = n // 2
    a, b = sum(arr[:h]), sum(arr[h:])
    return round((b - a) / a * 100, 1) if a else 0.0


def spark(arr, k=24):
    arr = [round(float(x), 1) for x in arr]
    if len(arr) <= k:
        return arr
    step = len(arr) / k
    return [arr[int(i * step)] for i in range(k)]


def group_metrics(d, by):
    grp = d.groupby(by).agg(
        billable=("billable_h", "sum"), non_billable=("non_billable_h", "sum"),
        total=("tracked_h", "sum"), overall=("overall_h", "sum"),
        prod_w=("prod_w", "sum"), tracked=("tracked", "sum"),
        revenue=("revenue", "sum"), empdays=("ud", "nunique"),
        people=("user_id", "nunique")).reset_index()
    cap = (grp["empdays"] * 8).replace(0, 1)
    grp["utilization"] = (grp["total"] / cap * 100).clip(upper=100)
    grp["activity"] = (grp["overall"] / grp["total"].replace(0, 1) * 100)
    grp["avg_day"] = grp["total"] / grp["empdays"].replace(0, 1)
    # Productivity = billable share of tracked time (billable hours / total × 100)
    grp["productivity"] = (grp["billable"] / grp["total"].replace(0, 1) * 100)
    grp["budget"] = grp["empdays"] * 8
    grp["variance"] = grp["total"] - grp["budget"]
    grp["grade"] = (0.5 * grp["utilization"] + 0.5 * grp["productivity"]).apply(grade_letter)
    return grp


def build_tasks_db(name):
    try:
        t = db.q("""
            SELECT COALESCE(NULLIF(subtask_name,''), parent_task_name) AS task,
                   COALESCE(list_name, space_name, '—') AS client,
                   COALESCE(time_estimate_hrs,0) AS estimated,
                   COALESCE(time_tracked_hrs,0) AS tracked,
                   COALESCE(status,'') AS status,
                   to_char(due_date,'YYYY-MM-DD') AS due
            FROM clickup_tasks
            WHERE COALESCE(is_deleted,false)=false AND assignees ILIKE :nm
            ORDER BY due_date NULLS LAST LIMIT 40
        """, {"nm": f"%{name}%"})
        return t.fillna("").to_dict("records")
    except Exception:
        return []


def build_tasks_sample(uid, name, client):
    h = crc32(str(uid).encode()); n = 6 + (h % 7)
    sts = ["Completed", "In Progress", "Review", "Overdue"]
    nm = ["Month-end close", "Bank reconciliation", "GST filing", "Payroll run", "Audit prep",
          "Vendor invoices", "AR follow-up", "Financial statements", "Tax computation"]
    out = []
    for i in range(n):
        hh = crc32(f"{uid}-{i}".encode())
        out.append({"task": nm[hh % len(nm)], "client": client or "—",
                    "estimated": 4 + (hh % 16), "tracked": round((4 + hh % 16) * (0.5 + (hh % 80) / 100), 1),
                    "status": sts[hh % 4] if i else "Completed", "due": f"2026-04-{(hh % 27) + 1:02d}"})
    return out


@app.get("/api/health")
def health():
    src = "supabase" if db.has_db() else "csv"
    info = {"source": src}
    if db.has_db():
        info.update(db.ping())
    try:
        m, g = load()
        info.update({"members": int(len(m)), "fact_rows": int(len(g)),
                     "date_min": g["date_s"].min(), "date_max": g["date_s"].max()})
    except Exception as e:  # noqa
        info["load_error"] = str(e)[:300]
    return clean(info)


@app.get("/api/filters")
def filters(department: Optional[str] = None, atl: Optional[str] = None):
    members, g = load()

    def srt(vals):
        v = sorted([x for x in set(vals) if x not in (None, "", "—")])
        if "Unassigned" in v:
            v = [x for x in v if x != "Unassigned"] + ["Unassigned"]
        return v

    dep_vals, atl_vals = _vals(department), _vals(atl)
    has_sets = "team_set" in members.columns

    if has_sets:
        # Every team / department / client an employee touches (not just primary),
        # so ALL of them are filterable. Cascading scopes teams/employees/clients.
        all_depts, all_teams, all_clients = set(), set(), set()
        for _, r in members.iterrows():
            all_depts.update(r["dept_set"] or [])
            all_teams.update(r["team_set"] or [])
            all_clients.update(r["client_set"] or [])
        teams_scoped = [t for t in all_teams if _dept_of(t) in dep_vals] if dep_vals else list(all_teams)

        def emp_ok(r):
            if dep_vals and not (set(dep_vals) & set(r["dept_set"] or [])):
                return False
            if atl_vals and not (set(atl_vals) & set(r["team_set"] or [])):
                return False
            return True

        emp_rows = members[members.apply(emp_ok, axis=1)]
        employees = sorted(emp_rows["name"].dropna().unique().tolist())
        if dep_vals:
            clients_scoped = {c for _, r in members.iterrows()
                              if (set(dep_vals) & set(r["dept_set"] or []))
                              for c in (r["client_set"] or [])}
        else:
            clients_scoped = all_clients
        client_types = srt({_client_cat(c) for c in all_clients})
        return clean({
            "date_min": g["date_s"].min(), "date_max": g["date_s"].max(),
            "departments": srt(all_depts),
            "atls": srt(teams_scoped),
            "employees": employees,
            "clients": srt(clients_scoped),
            "client_types": client_types,
            "total_members": int(len(members)),
            "source": "supabase" if db.has_db() else "csv",
        })

    # CSV fallback (no ClickUp membership) — use the single-column values
    dim = g.groupby("user_id").agg(department=("department", "first"), atl=("atl", "first"),
                                   client=("client", "first"), client_type=("client_type", "first")).reset_index()
    dim = dim.merge(members[["user_id", "name"]], on="user_id", how="left")
    dep_scope = dim[dim["department"].isin(dep_vals)] if dep_vals else dim
    atl_scope = dep_scope[dep_scope["atl"].isin(atl_vals)] if atl_vals else dep_scope
    return clean({
        "date_min": g["date_s"].min(), "date_max": g["date_s"].max(),
        "departments": srt(dim["department"]),
        "atls": srt(dep_scope["atl"]),
        "employees": sorted(atl_scope["name"].dropna().unique().tolist()),
        "clients": srt(dep_scope["client"]),
        "client_types": srt(dim["client_type"]),
        "total_members": int(len(members)),
        "source": "supabase" if db.has_db() else "csv",
    })


@app.get("/api/command")
def command(
    date_from: Optional[str] = None, date_to: Optional[str] = None,
    department: Optional[str] = None, atl: Optional[str] = None,
    employee: Optional[str] = None, client: Optional[str] = None,
    client_type: Optional[str] = None, billable: Optional[str] = None,
    status: Optional[str] = None,
):
    members, g = load()
    f = dict(date_from=date_from, date_to=date_to, department=department, atl=atl,
             employee=employee, client=client, client_type=client_type,
             billable=billable, status=status)
    m, d = apply_filters(members, g, f)
    empty = d.empty

    daily = (d.groupby("date_s").agg(
        billable=("billable_h", "sum"), non_billable=("non_billable_h", "sum"),
        total=("tracked_h", "sum"), prod_w=("prod_w", "sum"),
        tracked=("tracked", "sum"), revenue=("revenue", "sum"),
        users=("user_id", "nunique")).reset_index().sort_values("date_s")) if not empty else pd.DataFrame()

    bill = float(d["billable_h"].sum()) if not empty else 0.0
    nonb = float(d["non_billable_h"].sum()) if not empty else 0.0
    total = bill + nonb
    empdays = int(d["ud"].nunique()) if not empty else 0
    people = int(d["user_id"].nunique()) if not empty else 0
    cap = empdays * 8
    util = min(100.0, total / cap * 100) if cap else 0.0
    prod = float(bill / total * 100) if total else 0.0  # productivity = billable share
    revenue = float(d["revenue"].sum()) if not empty else 0.0
    budget = cap
    variance = total - budget

    emp = group_metrics(d, "user_id") if not empty else pd.DataFrame()
    if not emp.empty:
        emp = emp.merge(members[["user_id", "name", "status", "task_completion",
                                 "active_tasks", "total_tasks", "task_status", "client"]], on="user_id", how="left")
        emp["grade_score"] = 0.4 * emp["utilization"] + 0.3 * emp["productivity"] + 0.3 * emp["task_completion"].fillna(70)
        emp["grade"] = emp["grade_score"].apply(grade_letter)
        avg_grade = grade_letter(float(emp["grade_score"].mean()))
    else:
        avg_grade = "—"

    util_daily = (daily["total"] / (daily["users"] * 8).replace(0, 1) * 100).tolist() if not empty else []
    prod_daily = (daily["billable"] / daily["total"].replace(0, 1) * 100).tolist() if not empty else []

    def kpi(v, series, unit=""):
        return {"value": round(v, 1), "trend": trend_pct(series), "spark": spark(series), "unit": unit}

    act = float(d["overall_h"].sum() / total * 100) if total else 0.0

    # ---- Period-over-period: same-length window immediately before the current one ----
    prev = None
    if date_from and date_to:
        try:
            from datetime import datetime, timedelta
            cf = datetime.strptime(date_from, "%Y-%m-%d")
            ct = datetime.strptime(date_to, "%Y-%m-%d")
            dur = (ct - cf).days + 1
            if dur >= 1:
                pt = cf - timedelta(days=1)
                pf = pt - timedelta(days=dur - 1)
                prev = _period_headline(members, g, {**f, "date_from": pf.strftime("%Y-%m-%d"),
                                                     "date_to": pt.strftime("%Y-%m-%d")})
                prev["from"] = pf.strftime("%Y-%m-%d")
                prev["to"] = pt.strftime("%Y-%m-%d")
                prev["days"] = dur
                # No meaningful comparison if the previous window has no data
                if prev.get("total", 0) <= 0 and prev.get("emps", 0) <= 0:
                    prev = None
        except Exception:
            prev = None

    # Previous-period rows (same filters, shifted window) — for per-group deltas
    d_prev = None
    if prev:
        try:
            _, d_prev = apply_filters(members, g, {**f, "date_from": prev["from"], "date_to": prev["to"]})
        except Exception:
            d_prev = None

    def _delta(curv, key):
        if not prev:
            return None
        pv = prev.get(key, 0) or 0
        if pv == 0:
            return 100.0 if curv > 0 else 0.0
        return round((curv - pv) / pv * 100, 1)

    bill_pct = float(bill / total * 100) if total else 0.0
    avg_hpe = float(total / people) if people else 0.0
    s = (lambda c: daily[c].tolist()) if not empty else (lambda c: [])
    kpis = {
        "billable_hours": kpi(bill, s("billable"), "h"),
        "non_billable_hours": kpi(nonb, s("non_billable"), "h"),
        "total_hours": kpi(total, s("total"), "h"),
        "utilization": kpi(util, util_daily, "%"),
        "productivity": kpi(prod, prod_daily, "%"),
        "activity": kpi(act, util_daily, "%"),
        "budget_hours": kpi(budget, [(x * 8) for x in (daily["users"].tolist() if not empty else [])], "h"),
        "actual_hours": kpi(total, s("total"), "h"),
        "variance": kpi(variance, ([t - u * 8 for t, u in zip(daily["total"], daily["users"])] if not empty else []), "h"),
        "active_employees": {"value": people, "trend": 0, "spark": [], "unit": ""},
        "avg_hours_per_emp": kpi(avg_hpe, [], "h"),
        "billable_pct": kpi(bill_pct, [], "%"),
        "avg_grade": {"value": avg_grade, "trend": 0, "spark": [], "unit": ""},
    }

    # Replace the spark-based trend with a real previous-period delta when comparable
    if prev:
        for kkey, (pkey, curv) in {
            "billable_hours": ("billable", bill), "non_billable_hours": ("non_billable", nonb),
            "total_hours": ("total", total), "actual_hours": ("total", total),
            "utilization": ("util", util), "productivity": ("prod", prod), "activity": ("act", act),
            "active_employees": ("emps", people),
        }.items():
            dv = _delta(curv, pkey)
            if dv is not None and kkey in kpis:
                kpis[kkey]["trend"] = dv

    hours_distribution = [{"name": "Billable", "value": round(bill, 1)},
                          {"name": "Non-Billable", "value": round(nonb, 1)}]
    hours_trend = [{"date": r.date_s, "billable": round(r.billable, 1),
                    "non_billable": round(r.non_billable, 1), "hours": round(r.total, 1)}
                   for r in daily.itertuples()] if not empty else []
    top_clients = ((d.groupby("client")["tracked_h"].sum().round(1).sort_values(ascending=False)
                    .head(6).reset_index().rename(columns={"tracked_h": "hours"}).to_dict("records"))
                   if not empty else [])

    task_summary = _task_summary(d, emp, m)

    # primary team per employee
    if not empty:
        pa = d.groupby(["user_id", "atl"])["tracked_h"].sum().reset_index()
        pa = pa.loc[pa.groupby("user_id")["tracked_h"].idxmax()].set_index("user_id")["atl"].to_dict()
    else:
        pa = {}

    teams = []
    if not empty:
        for _, r in group_metrics(d, "atl").sort_values("billable", ascending=False).head(50).iterrows():
            teams.append({"team": r["atl"], "team_size": int(r["people"]),
                          "billable": round(r["billable"], 1), "non_billable": round(r["non_billable"], 1),
                          "total": round(r["total"], 1), "utilization": round(r["utilization"], 0),
                          "productivity": round(r["productivity"], 0), "grade": r["grade"],
                          "revenue": round(r["revenue"], 0), "budget": round(r["budget"], 0),
                          "variance": round(r["variance"], 0), "status": "Active"})

    employees_tbl = []
    if not emp.empty:
        for _, r in emp.sort_values("billable", ascending=False).head(200).iterrows():
            employees_tbl.append({"name": r["name"], "team": pa.get(r["user_id"], "—"),
                                  "billable": round(r["billable"], 1), "non_billable": round(r["non_billable"], 1),
                                  "utilization": round(r["utilization"], 0), "activity": round(r["activity"], 0),
                                  "productivity": round(r["productivity"], 0), "avg_day": round(r["avg_day"], 1),
                                  "days": int(r["empdays"]), "grade": r["grade"],
                                  "active_tasks": int(r.get("active_tasks") or 0),
                                  "task_status": r.get("task_status") or "Idle",
                                  "client": r.get("client") or "—"})

    columns, table_rows, level, view = _table(f, d, emp, members, d_prev)

    live = m["status"].value_counts().to_dict() if not m.empty else {}
    live_activity = {"active": int(live.get("Active", 0)), "idle": int(live.get("Idle", 0)),
                     "offline": int(live.get("Offline", 0))}
    grade_order = ["A+", "A", "B+", "B", "C", "D"]
    gc = emp["grade"].value_counts().to_dict() if not emp.empty else {}
    grade_distribution = [{"grade": x, "count": int(gc.get(x, 0))} for x in grade_order]
    budget_vs_actual = {"budget": round(budget, 0), "actual": round(total, 0), "variance": round(variance, 0)}
    alerts = _alerts(emp, members, d, task_summary, live_activity, people)
    insights = _insights(d, emp)
    summary = {
        "employees": people, "active_days": int(d["date_s"].nunique()) if not empty else 0,
        "departments": int(d["department"].nunique()) if not empty else 0,
        "teams": int(d["atl"].nunique()) if not empty else 0,
        "clients": int(d["client"].nunique()) if not empty else 0,
        "avg_hours_per_emp": round(total / people, 1) if people else 0,
        "billable_pct": round(bill / total * 100, 0) if total else 0,
        "tasks_active_emp": int((emp["task_status"] == "Active").sum()) if not emp.empty else 0,
    }

    # Top 3 / Bottom 3 employees by grade score
    def erow(r):
        return {"name": r["name"], "team": pa.get(r["user_id"], "—"), "grade": r["grade"],
                "billable": round(r["billable"], 1), "utilization": round(r["utilization"], 0),
                "activity": round(r["activity"], 0), "active_tasks": int(r.get("active_tasks") or 0),
                "task_status": r.get("task_status") or "Idle"}
    if not emp.empty:
        tb = emp.sort_values("grade_score", ascending=False)
        top3 = [erow(r) for _, r in tb.head(3).iterrows()]
        bottom3 = [erow(r) for _, r in tb.tail(3).iloc[::-1].iterrows()]
    else:
        top3, bottom3 = [], []

    # Clients (ClickUp folders) with active/inactive + category
    cdim = clickup_intel()["clients"]
    clients_summary = []
    if not empty:
        ch = d.groupby("client")["tracked_h"].sum().sort_values(ascending=False)
        for cl, hrs in ch.head(60).items():
            if cl == "Unassigned":
                continue
            info = cdim.get(cl, {})
            clients_summary.append({"client": cl, "hours": round(float(hrs), 1),
                                    "active": bool(info.get("active", False)),
                                    "category": info.get("category", "Project"),
                                    "active_tasks": int(info.get("active_tasks", 0)),
                                    "total_tasks": int(info.get("total", 0))})
    present = set(d["client"].unique()) - {"Unassigned"} if not empty else set()
    active_clients = sum(1 for c in present if (cdim.get(c) or {}).get("active"))
    clients_status = {"active": active_clients, "inactive": len(present) - active_clients}

    # At-a-glance task counts
    task_total = int(sum(t["value"] for t in task_summary))
    completed_t = int(next((t["value"] for t in task_summary if t["name"] == "Completed"), 0))
    summary["total_tasks"] = task_total
    summary["active_tasks"] = task_total - completed_t

    # Client Health (active / at-risk / inactive)
    client_health = {"active": 0, "at_risk": 0, "inactive": 0}
    if not empty:
        chh = d[d["client"] != "Unassigned"].groupby("client")["tracked_h"].sum()
        q25 = float(chh.quantile(0.25)) if len(chh) else 0.0
        for cl, hrs in chh.items():
            at = int((cdim.get(cl) or {}).get("active_tasks", 0))
            if at == 0:
                client_health["inactive"] += 1
            elif hrs < q25:
                client_health["at_risk"] += 1
            else:
                client_health["active"] += 1

    # Project Health (from teams' utilization)
    project_health = {"on_track": 0, "at_risk": 0, "delayed": 0}
    if not empty:
        for _, r in group_metrics(d, "atl").iterrows():
            u = r["utilization"]
            if u >= 75:
                project_health["on_track"] += 1
            elif u >= 60:
                project_health["at_risk"] += 1
            else:
                project_health["delayed"] += 1

    resource = {"capacity": round(util, 0), "availability": max(0.0, round(100 - util, 0))}

    # Activity heatmap matrix: Department (rows) x Week (cols), tracked hours
    heatmap = {"weeks": [], "rows": []}
    if not empty:
        dw = d[["department", "date_s", "tracked_h"]].copy()
        dw["week"] = pd.to_datetime(dw["date_s"]).dt.strftime("%G-W%V")
        wk = sorted(dw["week"].unique())
        piv = dw.groupby(["department", "week"])["tracked_h"].sum()
        dep_tot = dw.groupby("department")["tracked_h"].sum().sort_values(ascending=False)
        hrows = []
        for dep in dep_tot.index:
            vals = [round(float(piv.get((dep, w), 0.0)), 0) for w in wk]
            hrows.append({"label": dep, "values": vals, "total": round(float(dep_tot[dep]), 0)})
        heatmap = {"weeks": ["W" + w.split("-W")[1] for w in wk], "rows": hrows}

    # Task "grade" (priority) per employee + overall, for the current scope
    task_priority = {"urgent": 0, "high": 0, "normal": 0, "low": 0}
    employee_tasks = []
    if not m.empty and "pri" in m.columns:
        for _, r in m.iterrows():
            p = r.get("pri") or {}
            pu = int(p.get("urgent", 0)); ph = int(p.get("high", 0))
            pn = int(p.get("normal", 0)); pl = int(p.get("low", 0))
            tot = pu + ph + pn + pl
            task_priority["urgent"] += pu; task_priority["high"] += ph
            task_priority["normal"] += pn; task_priority["low"] += pl
            if tot > 0 or int(r.get("active_tasks", 0)) > 0:
                employee_tasks.append({
                    "name": r["name"], "urgent": pu, "high": ph, "normal": pn, "low": pl,
                    "total": tot, "active": int(r.get("active_tasks", 0)),
                    "status": r.get("task_status", "Idle"),
                    "nb": int(r.get("nb_tasks", 0)), "billable": int(r.get("bill_tasks", 0))})
        employee_tasks.sort(key=lambda x: (-(x["urgent"] * 3 + x["high"] * 2 + x["normal"]), -x["total"]))
        employee_tasks = employee_tasks[:60]

    # Hierarchy flow (Sankey): Department -> Team -> Client (top clients), hours = flow
    hierarchy = {"nodes": [], "links": []}
    if not empty:
        dt = d.groupby(["department", "atl"])["tracked_h"].sum().reset_index()
        top_cl = list(d.groupby("client")["tracked_h"].sum().sort_values(ascending=False).head(10).index)
        tc = d[d["client"].isin(top_cl)].groupby(["atl", "client"])["tracked_h"].sum().reset_index()
        depts = sorted(dt["department"].unique().tolist())
        h_teams = sorted(pd.unique(pd.concat([dt["atl"], tc["atl"]])).tolist())
        clnts = [c for c in top_cl if c in set(tc["client"])]
        d_idx = {n: i for i, n in enumerate(depts)}
        t_idx = {n: len(depts) + i for i, n in enumerate(h_teams)}
        c_idx = {n: len(depts) + len(h_teams) + i for i, n in enumerate(clnts)}
        nodes = ([{"name": n, "layer": 0} for n in depts]
                 + [{"name": n, "layer": 1} for n in h_teams]
                 + [{"name": n, "layer": 2} for n in clnts])
        links = []
        for _, r in dt.iterrows():
            if float(r["tracked_h"]) > 0:
                links.append({"source": d_idx[r["department"]], "target": t_idx[r["atl"]], "value": round(float(r["tracked_h"]), 1)})
        for _, r in tc.iterrows():
            if r["atl"] in t_idx and r["client"] in c_idx and float(r["tracked_h"]) > 0:
                links.append({"source": t_idx[r["atl"]], "target": c_idx[r["client"]], "value": round(float(r["tracked_h"]), 1)})
        hierarchy = {"nodes": nodes, "links": links}

    return clean({
        "task_priority": task_priority, "employee_tasks": employee_tasks,
        "hierarchy": hierarchy,
        "context": {"level": level, "view": view, "label": employee or atl or department or "Company (All)"},
        "summary": summary,
        "period": {"comparable": bool(prev), "current": {"from": date_from, "to": date_to, "days": (prev or {}).get("days")},
                   "previous": prev} if prev else {"comparable": False},
        "kpis": kpis, "hours_distribution": hours_distribution, "hours_trend": hours_trend,
        "top_clients": top_clients, "task_summary": task_summary,
        "teams": teams, "employees": employees_tbl, "total_employees": int(len(members)),
        "top3": top3, "bottom3": bottom3,
        "clients_summary": clients_summary, "clients_status": clients_status,
        "table": {"level": level, "view": view, "columns": columns, "rows": table_rows},
        "live_activity": live_activity, "grade_distribution": grade_distribution,
        "budget_vs_actual": budget_vs_actual, "alerts": alerts, "insights": insights,
        "client_health": client_health, "project_health": project_health, "resource": resource,
        "heatmap": heatmap,
        "source": "supabase" if db.has_db() else "csv",
    })


_NB_SQL = r"(^|[^a-z0-9])nb([^a-z0-9]|$)"


def _tracked_breakdown(uids, date_from, date_to):
    """Aggregate tracked hours split two ways: time logged on a task vs only on
    a project (no task), and billable vs non-billable (NB marker)."""
    blank = {"task_h": 0.0, "task_billable_h": 0.0, "task_non_billable_h": 0.0,
             "project_h": 0.0, "project_billable_h": 0.0, "project_non_billable_h": 0.0}
    if not db.has_db() or not uids:
        return blank
    where = ["coalesce(a.tracked,0) > 0", "a.user_id::text = ANY(:uids)"]
    params = {"uids": list(uids), "nb": _NB_SQL}
    if date_from:
        where.append("a.date >= :df"); params["df"] = date_from
    if date_to:
        where.append("a.date <= :dt"); params["dt"] = date_to
    nb_cond = ("(trim(coalesce(ht.summary,'')) ~* :nb "
               "OR trim(coalesce(p.name,'')) ~* :nb)")
    try:
        df = db.q(f"""
            SELECT
              sum(CASE WHEN a.task_id IS NOT NULL THEN a.tracked ELSE 0 END) task_sec,
              sum(CASE WHEN a.task_id IS NOT NULL AND {nb_cond} THEN a.tracked ELSE 0 END) task_nb,
              sum(CASE WHEN a.task_id IS NULL THEN a.tracked ELSE 0 END) proj_sec,
              sum(CASE WHEN a.task_id IS NULL AND {nb_cond} THEN a.tracked ELSE 0 END) proj_nb
            FROM hubstaff_activities a
            LEFT JOIN hubstaff_projects p ON p.id = a.project_id
            LEFT JOIN hubstaff_tasks ht ON ht.id = a.task_id
            WHERE {" AND ".join(where)}
        """, params)
    except Exception as e:  # noqa
        print("breakdown failed:", e)
        return blank
    r = df.iloc[0]
    task = float(r["task_sec"] or 0); tnb = float(r["task_nb"] or 0)
    proj = float(r["proj_sec"] or 0); pnb = float(r["proj_nb"] or 0)
    return {"task_h": round(task / SEC, 1),
            "task_billable_h": round(max(0.0, task - tnb) / SEC, 1),
            "task_non_billable_h": round(tnb / SEC, 1),
            "project_h": round(proj / SEC, 1),
            "project_billable_h": round(max(0.0, proj - pnb) / SEC, 1),
            "project_non_billable_h": round(pnb / SEC, 1)}


@app.get("/api/breakdown")
def breakdown(
    date_from: Optional[str] = None, date_to: Optional[str] = None,
    department: Optional[str] = None, atl: Optional[str] = None,
    employee: Optional[str] = None, client: Optional[str] = None,
    client_type: Optional[str] = None, billable: Optional[str] = None,
    status: Optional[str] = None,
):
    members, g = load()
    f = dict(date_from=date_from, date_to=date_to, department=department, atl=atl,
             employee=employee, client=client, client_type=client_type,
             billable=billable, status=status)
    m, _ = apply_filters(members, g, f)
    uids = [str(x) for x in m["user_id"].unique().tolist()] if not m.empty else []
    return clean(_tracked_breakdown(uids, date_from, date_to))


def _tracked_lists(uids, date_from, date_to, limit=500):
    """Drill-down lists: tracked hours per task (task-linked time) and per
    project (project-only time), each split billable / non-billable."""
    blank = {"by_task": [], "by_project": []}
    if not db.has_db() or not uids:
        return blank
    where = ["coalesce(a.tracked,0) > 0", "a.user_id::text = ANY(:uids)"]
    params = {"uids": list(uids), "nb": _NB_SQL}
    if date_from:
        where.append("a.date >= :df"); params["df"] = date_from
    if date_to:
        where.append("a.date <= :dt"); params["dt"] = date_to
    nb_expr = ("CASE WHEN trim(coalesce(ht.summary,'')) ~* :nb "
               "OR trim(coalesce(p.name,'')) ~* :nb THEN a.tracked ELSE 0 END")
    base = (" FROM hubstaff_activities a "
            " LEFT JOIN hubstaff_projects p ON p.id = a.project_id "
            " LEFT JOIN hubstaff_tasks ht ON ht.id = a.task_id "
            " WHERE " + " AND ".join(where))

    def _q(label_expr, extra):
        try:
            df = db.q(f"SELECT {label_expr} g, sum(a.tracked) t, sum({nb_expr}) nb "
                      f"{base} AND {extra} GROUP BY 1 ORDER BY 2 DESC LIMIT {limit}", params)
        except Exception as e:  # noqa
            print("list failed:", e); return []
        out = []
        for _, r in df.iterrows():
            tot = float(r["t"] or 0); nb = float(r["nb"] or 0)
            out.append({"name": r["g"], "total": round(tot / SEC, 1),
                        "billable": round(max(0.0, tot - nb) / SEC, 1),
                        "non_billable": round(nb / SEC, 1)})
        return out

    return {"by_task": _q("coalesce(nullif(ht.summary,''),'(unnamed task)')", "a.task_id IS NOT NULL"),
            "by_project": _q("coalesce(nullif(p.name,''),'(no project)')", "a.task_id IS NULL")}


@app.get("/api/breakdown_list")
def breakdown_list(
    date_from: Optional[str] = None, date_to: Optional[str] = None,
    department: Optional[str] = None, atl: Optional[str] = None,
    employee: Optional[str] = None, client: Optional[str] = None,
    client_type: Optional[str] = None, billable: Optional[str] = None,
    status: Optional[str] = None,
):
    members, g = load()
    f = dict(date_from=date_from, date_to=date_to, department=department, atl=atl,
             employee=employee, client=client, client_type=client_type,
             billable=billable, status=status)
    m, _ = apply_filters(members, g, f)
    uids = [str(x) for x in m["user_id"].unique().tolist()] if not m.empty else []
    return clean(_tracked_lists(uids, date_from, date_to))


@lru_cache(maxsize=1)
def _clickup_assignee_names():
    if not db.has_db():
        return ()
    try:
        # assignees is a JSON array [{"id","username","email"}, ...]; pull usernames.
        t = db.q("""SELECT DISTINCT trim(elem->>'username') a
                    FROM clickup_tasks,
                    LATERAL jsonb_array_elements(
                      CASE WHEN coalesce(assignees,'') ~ '^\\s*\\[' THEN assignees::jsonb
                           ELSE '[]'::jsonb END) elem
                    WHERE coalesce(is_deleted,false)=false
                      AND coalesce(trim(elem->>'username'),'') <> ''""")
        return tuple(x for x in t["a"].tolist() if x)
    except Exception:
        return ()


@app.get("/api/unassigned")
def unassigned():
    """Diagnostic: employees that fell into 'Unassigned' and WHY (no ClickUp match)."""
    members, g = load()
    nm = dict(zip(members["user_id"], members["name"]))
    un = (g[g["department"] == "Unassigned"].groupby("user_id")
          .agg(hours=("tracked_h", "sum"), days=("date_s", "nunique")).reset_index())
    cu = list(_clickup_assignee_names())
    cu_low = {c.lower().strip(): c for c in cu}
    cu_keys = list(cu_low.keys())
    # name with spaces/punctuation stripped — catches "garimajoshi" == "garima joshi"
    cu_compact = {re.sub(r"[^a-z0-9]", "", c.lower()): c for c in cu}
    rows = []
    for _, r in un.iterrows():
        name = nm.get(r["user_id"], str(r["user_id"]))
        low = str(name).lower().strip()
        compact = re.sub(r"[^a-z0-9]", "", low)
        near = difflib.get_close_matches(low, cu_keys, n=1, cutoff=0.86)
        if compact and compact in cu_compact and cu_compact[compact].lower().strip() != low:
            reason, suggestion = "Same name, different format in ClickUp", cu_compact[compact]
        elif near:
            reason, suggestion = "Likely a spelling difference in ClickUp", cu_low[near[0]]
        else:
            reason, suggestion = "Not assigned to any ClickUp task", ""
        rows.append({"name": name, "hours": round(float(r["hours"]), 1),
                     "days": int(r["days"]), "reason": reason, "suggestion": suggestion})
    rows.sort(key=lambda x: -x["hours"])
    return clean({"rows": rows, "count": len(rows),
                  "total_hours": round(float(un["hours"].sum()), 1) if not un.empty else 0.0,
                  "total_members": int(len(members))})


@app.get("/api/raw")
def raw(
    date_from: Optional[str] = None, date_to: Optional[str] = None,
    department: Optional[str] = None, atl: Optional[str] = None,
    employee: Optional[str] = None, client: Optional[str] = None,
    client_type: Optional[str] = None, billable: Optional[str] = None,
    status: Optional[str] = None,
):
    members, g = load()
    f = dict(date_from=date_from, date_to=date_to, department=department, atl=atl,
             employee=employee, client=client, client_type=client_type,
             billable=billable, status=status)
    m, d = apply_filters(members, g, f)
    if d.empty:
        return {"rows": [], "total": 0, "shown": 0}
    nm = dict(zip(members["user_id"], members["name"]))
    dd = d.sort_values("date_s", ascending=False).head(4000)
    rows = [{
        "employee": nm.get(r.user_id, r.user_id), "date": r.date_s,
        "department": r.department, "team": r.atl, "client": r.client,
        "client_type": r.client_type, "billable": "Billable" if r.billable else "Non-Billable",
        "tracked_h": round(float(r.tracked_h), 2), "overall_h": round(float(r.overall_h), 2),
        "productivity": round(float(r.productivity), 0),
    } for r in dd.itertuples()]
    return clean({"rows": rows, "total": int(len(d)), "shown": len(rows)})


@app.get("/api/employee")
def employee(name: str, date_from: Optional[str] = None, date_to: Optional[str] = None):
    members, g = load()
    row = members[members["name"] == name]
    if row.empty:
        return {"found": False}
    mr = row.iloc[0]
    uid = mr["user_id"]
    d = g[g["user_id"] == uid]
    if date_from:
        d = d[d["date_s"] >= date_from]
    if date_to:
        d = d[d["date_s"] <= date_to]
    tracked = float(d["tracked_h"].sum())
    bill = float(d["billable_h"].sum())
    overall = float(d["overall_h"].sum())
    empdays = int(d["date_s"].nunique())
    cap = empdays * 8
    util = min(100.0, tracked / cap * 100) if cap else 0.0
    act = overall / tracked * 100 if tracked else 0.0
    prod = float(bill / tracked * 100) if tracked else 0.0  # productivity = billable share
    tc = float(mr.get("task_completion", 70))
    grade = grade_letter(0.4 * util + 0.3 * prod + 0.3 * tc)
    dept = d["department"].mode().iloc[0] if not d.empty else "Unassigned"
    team = d["atl"].mode().iloc[0] if not d.empty else "Unassigned"
    client = d["client"].mode().iloc[0] if not d.empty else "Unassigned"

    daily = (d.groupby("date_s").agg(tracked_h=("tracked_h", "sum"), billable_h=("billable_h", "sum"),
             overall_h=("overall_h", "sum"), prod_w=("prod_w", "sum"), tr=("tracked", "sum"))
             .reset_index().sort_values("date_s"))
    daily_rows = [{"date": r.date_s, "hours": round(r.tracked_h, 2), "billable": round(r.billable_h, 2),
                   "non_billable": round(r.tracked_h - r.billable_h, 2),
                   "activity": round(r.overall_h / r.tracked_h * 100, 0) if r.tracked_h else 0,
                   "productivity": round(r.billable_h / r.tracked_h * 100, 0) if r.tracked_h else 0} for r in daily.itertuples()]
    tasks = build_tasks_db(name) if db.has_db() else build_tasks_sample(uid, name, client)

    return clean({
        "found": True,
        "profile": {
            "name": name, "team": team, "department": dept, "client": client,
            "role": mr.get("role", ""), "status": mr.get("status", "Idle"),
            "task_status": mr.get("task_status", "Idle"), "active_tasks": int(mr.get("active_tasks", 0) or 0),
            "total_tasks": int(mr.get("total_tasks", 0) or 0),
            "grade": grade, "billable": round(bill, 1), "non_billable": round(tracked - bill, 1),
            "total": round(tracked, 1), "utilization": round(util, 0), "activity": round(act, 0),
            "productivity": round(prod, 0), "days": empdays, "avg_day": round(tracked / empdays, 1) if empdays else 0,
        },
        "daily": daily_rows, "tasks": tasks,
    })


def _task_summary(d, emp, members):
    ts = {"Completed": 0, "In Progress": 0, "Review": 0, "Overdue": 0}
    # Scope-aware: aggregate per-employee task status for the employees in scope
    if "st" in members.columns and not members.empty:
        for _, r in members.iterrows():
            s = r.get("st") or {}
            ts["Completed"] += int(s.get("completed", 0))
            ts["In Progress"] += int(s.get("in_progress", 0))
            ts["Review"] += int(s.get("review", 0))
            ts["Overdue"] += int(s.get("overdue", 0))
        if sum(ts.values()) > 0:
            return [{"name": k, "value": v} for k, v in ts.items()]
    if db.has_db():
        m = task_meta()["summary"]
        if m:
            return m
    if emp.empty:
        return [{"name": k, "value": v} for k, v in ts.items()]
    for _, r in emp.iterrows():
        for tk in build_tasks_sample(r["user_id"], r.get("name", ""), ""):
            ts[tk["status"]] = ts.get(tk["status"], 0) + 1
    return [{"name": k, "value": v} for k, v in ts.items()]


def _table(f, d, emp, members, d_prev=None):
    def _ptot(by):
        if d_prev is None or d_prev.empty:
            return {}
        return d_prev.groupby(by)["tracked_h"].sum().to_dict()

    def _trd(cur, prv):
        if not prv or prv <= 0:
            return None
        return round((cur - prv) / prv * 100, 1)

    if f.get("employee"):
        row = members[members["name"] == f["employee"]]
        uid = row.iloc[0]["user_id"] if not row.empty else None
        rows = build_tasks_db(f["employee"]) if db.has_db() else \
            build_tasks_sample(uid, f["employee"], "")
        return ["task", "client", "estimated", "tracked", "status", "due"], rows, "employee", "Tasks"
    if f.get("atl"):
        pt = _ptot("user_id")
        nm2uid = dict(zip(members["name"], members["user_id"]))
        gg = emp.sort_values("billable", ascending=False) if not emp.empty else emp
        rows = [{"employee": r["name"], "days": int(r["empdays"]), "billable": round(r["billable"], 1),
                 "non_billable": round(r["non_billable"], 1), "utilization": round(r["utilization"], 0),
                 "activity": round(r["activity"], 0), "grade": r["grade"],
                 "tasks": int(r.get("active_tasks") or 0), "task_status": r.get("task_status") or "Idle",
                 "total_trend": _trd(r["billable"] + r["non_billable"], pt.get(nm2uid.get(r["name"]), 0))}
                for _, r in gg.iterrows()] if not emp.empty else []
        return ["employee", "days", "billable", "non_billable", "utilization", "activity", "grade", "tasks", "task_status"], rows, "atl", "Employees"
    if f.get("department"):
        pt = _ptot("atl")
        gg = group_metrics(d, "atl") if not d.empty else pd.DataFrame()
        rows = [{"name": r["atl"], "team_size": int(r["people"]), "billable": round(r["billable"], 1),
                 "non_billable": round(r["non_billable"], 1), "total": round(r["total"], 1),
                 "utilization": round(r["utilization"], 0), "activity": round(r["activity"], 0),
                 "productivity": round(r["productivity"], 0), "grade": r["grade"],
                 "total_trend": _trd(r["total"], pt.get(r["atl"], 0))}
                for _, r in gg.sort_values("billable", ascending=False).iterrows()] if not (d.empty) else []
        return ["name", "team_size", "billable", "non_billable", "total", "utilization", "activity", "productivity", "grade"], rows, "department", "ATLs / Teams"
    pt = _ptot("department")
    gg = group_metrics(d, "department") if not d.empty else pd.DataFrame()
    rows = [{"name": r["department"], "team_size": int(r["people"]), "billable": round(r["billable"], 1),
             "non_billable": round(r["non_billable"], 1), "total": round(r["total"], 1),
             "utilization": round(r["utilization"], 0), "activity": round(r["activity"], 0),
             "productivity": round(r["productivity"], 0), "grade": r["grade"],
             "total_trend": _trd(r["total"], pt.get(r["department"], 0))}
            for _, r in gg.sort_values("billable", ascending=False).iterrows()] if not d.empty else []
    return (["name", "team_size", "billable", "non_billable", "total", "utilization", "activity",
             "productivity", "grade"], rows, "company", "Departments")


def _alerts(emp, members, d, task_summary, live, people):
    over_budget = 0
    if not d.empty:
        cl = d.groupby("client")["tracked_h"].sum()
        if len(cl):
            over_budget = int((cl > cl.mean() * 1.5).sum())
    util_low = int((emp["utilization"] < 60).sum()) if not emp.empty else 0
    overdue = int(next((t["value"] for t in task_summary if t["name"] == "Overdue"), 0))
    idle = int(live.get("idle", 0))
    missing = max(0, int(len(members)) - int(people))
    return [
        {"title": "Clients over budget", "count": over_budget, "severity": "danger"},
        {"title": "Employees utilization < 60%", "count": util_low, "severity": "warn"},
        {"title": "Tasks overdue", "count": overdue, "severity": "warn"},
        {"title": "Employees idle > 1 hour", "count": idle, "severity": "info"},
        {"title": "Missing timesheets", "count": missing, "severity": "muted"},
    ]


def _insights(d, emp):
    if d.empty:
        return ["No data for the current selection."]
    out = []
    by = d.groupby("atl").agg(rev=("revenue", "sum"), tot=("tracked_h", "sum"),
                              ov=("overall_h", "sum"), ud=("ud", "nunique")).reset_index()
    by["util"] = by["tot"] / (by["ud"] * 8).replace(0, 1) * 100
    by = by[by["tot"] > 0]
    if len(by):
        b = by.sort_values("util", ascending=False).iloc[0]
        w = by.sort_values("util").iloc[0]
        out.append(f"Top team by utilization: {b['atl']} ({b['util']:.0f}%).")
        out.append(f"Lowest utilization: {w['atl']} ({w['util']:.0f}%) — needs attention.")
    cl = d.groupby("client")["revenue"].sum().sort_values(ascending=False)
    if len(cl) and cl.iloc[0] > 0:
        out.append(f"Most profitable client: {cl.index[0]} (${cl.iloc[0]:,.0f}).")
    tot = d["tracked_h"].sum(); bl = d["billable_h"].sum()
    out.append(f"Billable mix: {bl / tot * 100:.0f}% of {tot:,.0f} tracked hours.")
    return out


def _ai_context(f: dict) -> dict:
    """Compact snapshot of the current (filtered) view for the AI."""
    c = command(**f)
    k = c.get("kpis", {})

    def kv(name):
        return k.get(name, {}).get("value")

    teams = [{"team": t["team"], "size": t["team_size"], "hours": round(t["total"], 1),
              "utilization": t["utilization"], "productivity": t["productivity"], "grade": t["grade"]}
             for t in c.get("teams", [])[:25]]
    emps = [{"name": e["name"], "team": e["team"], "billable_h": round(e["billable"], 1),
             "utilization": e["utilization"], "activity": e["activity"], "grade": e["grade"],
             "active_tasks": e["active_tasks"], "client": e.get("client", "")}
            for e in c.get("employees", [])[:60]]
    clients = [{"client": cl["client"], "hours": round(cl["hours"], 1), "active": cl["active"],
                "category": cl["category"], "active_tasks": cl["active_tasks"]}
               for cl in c.get("clients_summary", [])[:40]]
    return {
        "scope": c.get("context", {}),
        "totals": {
            "employees": c["summary"]["employees"], "departments": c["summary"]["departments"],
            "teams": c["summary"]["teams"], "clients": c["summary"]["clients"],
            "total_hours": kv("total_hours"), "billable_hours": kv("billable_hours"),
            "non_billable_hours": kv("non_billable_hours"), "utilization_pct": kv("utilization"),
            "activity_pct": kv("activity"), "productivity_pct": kv("productivity"),
            "billable_pct": c["summary"]["billable_pct"], "avg_grade": kv("avg_grade"),
            "active_tasks": c["summary"]["active_tasks"], "total_tasks": c["summary"]["total_tasks"],
        },
        "hours_distribution": c.get("hours_distribution"),
        "grade_distribution": c.get("grade_distribution"),
        "task_summary": c.get("task_summary"),
        "client_health": c.get("client_health"),
        "project_health": c.get("project_health"),
        "live_activity": c.get("live_activity"),
        "teams": teams,
        "employees": emps,
        "clients": clients,
    }


@app.post("/api/ask")
def ask(payload: dict):
    question = (payload or {}).get("question", "").strip()
    if not question:
        return {"ok": False, "reason": "empty"}
    f = (payload or {}).get("filters") or {}
    f = {k: f.get(k) for k in ("date_from", "date_to", "department", "atl",
                               "employee", "client", "client_type", "billable", "status")}
    try:
        ctx = _ai_context(f)
    except Exception as e:  # noqa: BLE001
        return {"ok": False, "reason": "context", "detail": str(e)[:200]}
    res = ai.answer(question, clean(ctx))
    return clean(res)


@app.get("/")
def root():
    return {"status": "ok", "service": "Finovate Operations Command Center",
            "source": "supabase" if db.has_db() else "csv",
            "ai": bool(os.environ.get("GEMINI_API_KEY", "").strip())}
