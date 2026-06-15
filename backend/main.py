"""
Finovate Operations Command Center — API
Source: Supabase Postgres when DATABASE_URL is set, else local CSV fallback.
Real (Hubstaff + ClickUp): hours, activity, productivity, billable, client,
department (ClickUp space), team (folder), tasks. Revenue = billable x pay_rate.

Run:  uvicorn main:app --reload --port 8000
"""
import os
import re
import contextvars
import difflib
from functools import lru_cache
from typing import Optional
from zlib import crc32

import numpy as np
import pandas as pd
from fastapi import FastAPI, Header, HTTPException, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

import ai
import auth
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

# ===========================================================================
# AUTH — single owner, owner-invited users, bcrypt + JWT session, scope gate.
# Auth is active only when a write DB is configured; otherwise the API stays
# open (CSV/dev mode) so nobody gets locked out.
# ===========================================================================
_AUTH_OPEN = ("/", "/api/ping", "/api/health")


def _auth_enabled() -> bool:
    return db.has_write()


def _ensure_app_users():
    db.execute("""
        CREATE TABLE IF NOT EXISTS app_users (
            id BIGSERIAL PRIMARY KEY,
            email TEXT UNIQUE NOT NULL,
            password_hash TEXT,
            role TEXT NOT NULL DEFAULT 'employee',
            full_name TEXT,
            linked_user_id TEXT,
            scope_team TEXT,
            status TEXT NOT NULL DEFAULT 'invited',
            invite_token TEXT,
            invite_expires TIMESTAMPTZ,
            created_at TIMESTAMPTZ DEFAULT now(),
            last_login TIMESTAMPTZ
        )""")


def _ensure_app_settings():
    db.execute("""
        CREATE TABLE IF NOT EXISTS app_settings (
            key TEXT PRIMARY KEY,
            value TEXT,
            updated_at TIMESTAMPTZ DEFAULT now()
        )""")


def _set_setting(key: str, value: str):
    db.execute("""INSERT INTO app_settings(key, value, updated_at) VALUES (:k, :v, now())
                  ON CONFLICT (key) DO UPDATE SET value=:v, updated_at=now()""",
               {"k": key, "v": value})


def _bootstrap_owner():
    ex = db.q_write("SELECT id FROM app_users WHERE lower(email)=:e", {"e": auth.owner_email()})
    if ex.empty:
        db.execute("""INSERT INTO app_users(email, password_hash, role, full_name, status)
                      VALUES (:e, :h, 'owner', 'Owner', 'active')""",
                   {"e": auth.owner_email(), "h": auth.hash_password(auth.owner_password())})


@app.on_event("startup")
def _auth_startup():
    if not _auth_enabled():
        print("[auth] write DB not configured — API runs OPEN (no login).")
        return
    try:
        _ensure_app_users()
        _ensure_app_settings()
        _ensure_keka()
        _bootstrap_owner()
        print(f"[auth] ready. owner = {auth.owner_email()}")
    except Exception as e:  # noqa
        print(f"[auth] setup failed ({str(e)[:120]}) — API running OPEN.")


# Per-request data scope (set of allowed hubstaff_user_ids; None = all). Set by
# the auth middleware, read by apply_filters and the drill-down endpoints so a
# signed-in user only ever sees the people their role permits.
_scope_ctx: contextvars.ContextVar = contextvars.ContextVar("scope_uids", default=None)


@lru_cache(maxsize=1)
def _team_history():
    """{uid: [(effective_from 'YYYY-MM-DD', team, dept), ...] sorted asc} from the
    team_history table. Sparse — only employees who transferred have rows. An
    interval applies from its effective_from until the next row's (last = current)."""
    out = {}
    try:
        t = db.q_write("SELECT hubstaff_user_id uid, team, department dept, "
                       "to_char(effective_from,'YYYY-MM-DD') ef FROM team_history "
                       "WHERE coalesce(hubstaff_user_id,'')<>'' AND effective_from IS NOT NULL "
                       "ORDER BY hubstaff_user_id, effective_from")
        for _, r in t.iterrows():
            out.setdefault(str(r["uid"]), []).append(
                (str(r["ef"]), str(r["team"] or "").strip(), str(r["dept"] or "").strip()))
    except Exception:  # noqa  (table may not exist yet)
        pass
    return out


def _home_asof(ivals, date_s):
    """(team, dept) for the interval covering date_s (last effective_from <= date_s),
    else None when date_s precedes every interval."""
    chosen = None
    for ef, tm, dp in ivals:
        if ef <= date_s:
            chosen = (tm, dp)
        else:
            break
    return chosen


@lru_cache(maxsize=64)
def _hr_team_dept_maps(as_of=None):
    """uid -> hr_team / hr_dept, replicating load()'s HR override (EXTERNAL ->
    US Team) so drill-downs can roll non-OPS work to the home team like g does.
    With as_of (a 'YYYY-MM-DD' date), a transferred employee's team/dept is resolved
    as-of that date from team_history; otherwise the current employee_mapping value."""
    tmap, dmap = {}, {}
    try:
        hm = db.q_write("SELECT hubstaff_user_id uid, department, team, status "
                        "FROM employee_mapping WHERE coalesce(hubstaff_user_id,'')<>''")
    except Exception:
        return tmap, dmap

    def _cl(v):
        s = str(v).strip()
        return "" if s.lower() in ("nan", "none", "") else s
    for _, r in hm.iterrows():
        uid = str(r["uid"]); dp, tm = _cl(r["department"]), _cl(r["team"])
        if str(r["status"] or "").upper() == "EXTERNAL":
            dmap[uid] = "US"; tmap[uid] = "US Team"
        elif dp:
            dmap[uid] = dp; tmap[uid] = tm or dp
    if as_of:
        for uid, ivals in _team_history().items():
            r = _home_asof(ivals, as_of)
            if r:
                if r[0]:
                    tmap[uid] = r[0]
                if r[1]:
                    dmap[uid] = r[1]
    return tmap, dmap


@lru_cache(maxsize=1)
def _hr_hierarchy():
    """(by_uid, reports_of) from employee_mapping: identity + who-reports-to-whom."""
    try:
        r = db.q_write("""SELECT hubstaff_user_id uid, hr_full_name name, team, reporting_to
                          FROM employee_mapping WHERE coalesce(hubstaff_user_id,'')<>''""")
    except Exception:
        return {}, {}
    def _s(v):
        return str(v).strip() if pd.notna(v) else ""
    by_uid, reports_of = {}, {}
    for _, x in r.iterrows():
        uid = _s(x["uid"]); nm = _s(x["name"])
        if not uid:
            continue
        by_uid[uid] = {"name": nm, "team": _s(x["team"])}
        mgr = _s(x["reporting_to"])
        if mgr:
            reports_of.setdefault(mgr, []).append({"uid": uid, "name": nm})
    return by_uid, reports_of


def _transitive_reports(manager_name: str) -> set:
    """All hubstaff_user_ids reporting up to `manager_name` (any depth)."""
    _, reports_of = _hr_hierarchy()
    out, seen, stack = set(), set(), [manager_name]
    while stack:
        mgr = stack.pop()
        if mgr in seen:
            continue
        seen.add(mgr)
        for r in reports_of.get(mgr, []):
            out.add(r["uid"]); stack.append(r["name"])
    return out


def scope_uids_for(u: dict):
    """Allowed hubstaff_user_ids for a signed-in user. None = everyone (owner)."""
    role = u.get("role")
    if role == "owner":
        return None
    by_uid, _ = _hr_hierarchy()
    if role == "manager":
        name = u.get("name") or ""
        ids = _transitive_reports(name)
        if u.get("linked_user_id"):
            ids.add(str(u["linked_user_id"]))          # include the manager
        return ids or None
    if role == "lead":
        team = u.get("scope_team") or ""
        return {uid for uid, v in by_uid.items() if v["team"] == team}
    # employee → only themselves
    if u.get("linked_user_id"):
        return {str(u["linked_user_id"])}
    name = u.get("name") or ""
    return {uid for uid, v in by_uid.items() if v["name"] == name}


def _scope_df(df):
    """Restrict any user_id-bearing frame to the caller's permitted people."""
    sc = _scope_ctx.get()
    if sc is not None and df is not None and not df.empty:
        return df[df["user_id"].astype(str).isin(sc)]
    return df


def _scope_allows(uid) -> bool:
    sc = _scope_ctx.get()
    return sc is None or str(uid) in sc


class AuthScopeMiddleware:
    """Pure-ASGI middleware: gates /api with a Bearer token (401 otherwise) and
    publishes the caller's data scope via a contextvar (propagates to sync
    endpoints, unlike BaseHTTPMiddleware)."""
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            return await self.app(scope, receive, send)
        path = scope.get("path", ""); method = scope.get("method", "")
        if (method == "OPTIONS" or not _auth_enabled() or path in _AUTH_OPEN
                or path.startswith("/api/auth/") or not path.startswith("/api")):
            return await self.app(scope, receive, send)
        headers = {k.decode().lower(): v.decode() for k, v in scope.get("headers", [])}
        authz = headers.get("authorization", "")
        user = auth.decode_session(authz[7:]) if authz.lower().startswith("bearer ") else None
        if not user:
            from starlette.responses import JSONResponse
            return await JSONResponse({"detail": "Authentication required"}, status_code=401)(scope, receive, send)
        tok = _scope_ctx.set(scope_uids_for(user))
        try:
            await self.app(scope, receive, send)
        finally:
            _scope_ctx.reset(tok)


app.add_middleware(AuthScopeMiddleware)


def _require(authorization: Optional[str], *roles) -> dict:
    """Decode the Bearer token; optionally require one of `roles`. Raises 401/403."""
    tok = authorization[7:] if authorization and authorization.lower().startswith("bearer ") else ""
    u = auth.decode_session(tok)
    if not u:
        raise HTTPException(status_code=401, detail="Not signed in")
    if roles and u.get("role") not in roles:
        raise HTTPException(status_code=403, detail="Not allowed")
    return u


def _employee_left(linked_user_id: str) -> bool:
    """A linked employee whose HR status is LEFT can no longer sign in."""
    if not linked_user_id:
        return False
    try:
        r = db.q_write("SELECT status FROM employee_mapping WHERE hubstaff_user_id=:u", {"u": linked_user_id})
        return (not r.empty) and str(r.iloc[0]["status"]).strip().upper() == "LEFT"
    except Exception:
        return False


class LoginReq(BaseModel):
    email: str
    password: str


class AcceptReq(BaseModel):
    token: str
    password: str


class ChangePwReq(BaseModel):
    old_password: str
    new_password: str


class CreateUserReq(BaseModel):
    email: str
    role: str = "employee"
    full_name: Optional[str] = None
    linked_user_id: Optional[str] = None
    scope_team: Optional[str] = None


def _user_public(r) -> dict:
    return {"id": int(r["id"]), "email": r["email"], "role": r["role"],
            "full_name": r.get("full_name"), "linked_user_id": r.get("linked_user_id"),
            "scope_team": r.get("scope_team"), "status": r["status"]}


@app.post("/api/auth/login")
def auth_login(body: LoginReq):
    if not _auth_enabled():
        raise HTTPException(status_code=400, detail="Auth not configured")
    r = db.q_write("SELECT * FROM app_users WHERE lower(email)=:e", {"e": body.email.strip().lower()})
    if r.empty:
        raise HTTPException(status_code=401, detail="Invalid email or password")
    u = r.iloc[0]
    if u["status"] == "disabled":
        raise HTTPException(status_code=403, detail="This account is disabled")
    if u["status"] == "invited" or not u["password_hash"]:
        raise HTTPException(status_code=403, detail="Set your password from the invite link first")
    if _employee_left(u.get("linked_user_id")):
        raise HTTPException(status_code=403, detail="This account is no longer active")
    if not auth.verify_password(body.password, u["password_hash"]):
        raise HTTPException(status_code=401, detail="Invalid email or password")
    pub = _user_public(u)
    db.execute("UPDATE app_users SET last_login=now() WHERE id=:i", {"i": pub["id"]})
    return {"token": auth.make_session(pub), "user": pub}


@app.get("/api/auth/me")
def auth_me(authorization: Optional[str] = Header(None)):
    u = _require(authorization)
    r = db.q_write("SELECT * FROM app_users WHERE lower(email)=:e", {"e": str(u["sub"]).lower()})
    if r.empty or r.iloc[0]["status"] != "active":
        raise HTTPException(status_code=401, detail="Session no longer valid")
    return {"user": _user_public(r.iloc[0])}


@app.get("/api/auth/invite")
def auth_invite_info(token: str):
    r = db.q_write("SELECT email, full_name, invite_expires, status FROM app_users WHERE invite_token=:t", {"t": token})
    if r.empty:
        raise HTTPException(status_code=404, detail="Invalid or used invite link")
    u = r.iloc[0]
    exp = u["invite_expires"]
    if exp is not None and pd.Timestamp(exp).tz_localize(None) < pd.Timestamp.utcnow().tz_localize(None):
        raise HTTPException(status_code=410, detail="This invite has expired — ask for a new one")
    return {"email": u["email"], "full_name": u.get("full_name")}


@app.post("/api/auth/accept")
def auth_accept(body: AcceptReq):
    if len(body.password) < 6:
        raise HTTPException(status_code=400, detail="Password must be at least 6 characters")
    r = db.q_write("SELECT * FROM app_users WHERE invite_token=:t", {"t": body.token})
    if r.empty:
        raise HTTPException(status_code=404, detail="Invalid or used invite link")
    u = r.iloc[0]
    exp = u["invite_expires"]
    if exp is not None and pd.Timestamp(exp).tz_localize(None) < pd.Timestamp.utcnow().tz_localize(None):
        raise HTTPException(status_code=410, detail="This invite has expired — ask for a new one")
    db.execute("""UPDATE app_users SET password_hash=:h, status='active', invite_token=NULL,
                  invite_expires=NULL, last_login=now() WHERE id=:i""",
               {"h": auth.hash_password(body.password), "i": int(u["id"])})
    pub = _user_public(u); pub["status"] = "active"
    return {"token": auth.make_session(pub), "user": pub}


@app.post("/api/auth/change_password")
def auth_change_pw(body: ChangePwReq, authorization: Optional[str] = Header(None)):
    u = _require(authorization)
    if len(body.new_password) < 6:
        raise HTTPException(status_code=400, detail="New password must be at least 6 characters")
    r = db.q_write("SELECT * FROM app_users WHERE lower(email)=:e", {"e": str(u["sub"]).lower()})
    if r.empty or not auth.verify_password(body.old_password, r.iloc[0]["password_hash"]):
        raise HTTPException(status_code=403, detail="Current password is incorrect")
    db.execute("UPDATE app_users SET password_hash=:h WHERE id=:i",
               {"h": auth.hash_password(body.new_password), "i": int(r.iloc[0]["id"])})
    return {"ok": True}


@app.get("/api/users")
def users_list(authorization: Optional[str] = Header(None)):
    _require(authorization, "owner")
    r = db.q_write("""SELECT id, email, role, full_name, linked_user_id, scope_team, status,
                      invite_token, invite_expires, created_at, last_login
                      FROM app_users ORDER BY role, lower(email)""")
    out = []
    for _, x in r.iterrows():
        out.append({
            "id": int(x["id"]), "email": x["email"], "role": x["role"], "full_name": x.get("full_name"),
            "linked_user_id": x.get("linked_user_id"), "scope_team": x.get("scope_team"), "status": x["status"],
            "has_invite": bool(x.get("invite_token")),
            "invite_link": auth.build_invite_link(x["invite_token"]) if x.get("invite_token") else None,
            "last_login": str(x["last_login"])[:16] if pd.notna(x.get("last_login")) else None,
        })
    return {"users": out, "smtp": auth.smtp_configured(), "owner_email": auth.owner_email()}


@app.post("/api/users")
def users_create(body: CreateUserReq, authorization: Optional[str] = Header(None)):
    actor = _require(authorization, "owner")
    email = body.email.strip().lower()
    if not re.match(r"^[^@\s]+@[^@\s]+\.[^@\s]+$", email):
        raise HTTPException(status_code=400, detail="Enter a valid email address")
    if body.role not in ("manager", "lead", "employee"):
        raise HTTPException(status_code=400, detail="Role must be manager, lead or employee")
    ex = db.q_write("SELECT id FROM app_users WHERE lower(email)=:e", {"e": email})
    if not ex.empty:
        raise HTTPException(status_code=409, detail="An account with this email already exists")
    token = auth.new_invite_token()
    db.execute("""INSERT INTO app_users(email, role, full_name, linked_user_id, scope_team,
                  status, invite_token, invite_expires)
                  VALUES (:e,:r,:n,:l,:s,'invited',:t,:x)""",
               {"e": email, "r": body.role, "n": body.full_name, "l": body.linked_user_id,
                "s": body.scope_team, "t": token, "x": auth.invite_expiry()})
    link = auth.build_invite_link(token)
    sent, detail = auth.send_invite_email(email, body.full_name or "", actor.get("name") or "The owner", link)
    return {"ok": True, "invite_link": link, "email_sent": sent, "email_detail": detail}


@app.post("/api/users/{uid}/resend")
def users_resend(uid: int, authorization: Optional[str] = Header(None)):
    actor = _require(authorization, "owner")
    r = db.q_write("SELECT * FROM app_users WHERE id=:i", {"i": uid})
    if r.empty:
        raise HTTPException(status_code=404, detail="User not found")
    u = r.iloc[0]
    token = auth.new_invite_token()
    db.execute("UPDATE app_users SET invite_token=:t, invite_expires=:x, status='invited' WHERE id=:i",
               {"t": token, "x": auth.invite_expiry(), "i": uid})
    link = auth.build_invite_link(token)
    sent, detail = auth.send_invite_email(u["email"], u.get("full_name") or "", actor.get("name") or "The owner", link)
    return {"ok": True, "invite_link": link, "email_sent": sent, "email_detail": detail}


@app.post("/api/users/{uid}/status")
def users_set_status(uid: int, active: bool, authorization: Optional[str] = Header(None)):
    _require(authorization, "owner")
    r = db.q_write("SELECT role FROM app_users WHERE id=:i", {"i": uid})
    if r.empty:
        raise HTTPException(status_code=404, detail="User not found")
    if r.iloc[0]["role"] == "owner":
        raise HTTPException(status_code=400, detail="The owner account cannot be disabled")
    db.execute("UPDATE app_users SET status=:s WHERE id=:i",
               {"s": "active" if active else "disabled", "i": uid})
    return {"ok": True}


class EmailSettingsReq(BaseModel):
    smtp_host: Optional[str] = None
    smtp_port: Optional[str] = None
    smtp_user: Optional[str] = None
    smtp_pass: Optional[str] = None      # blank = keep existing
    smtp_from: Optional[str] = None
    public_app_url: Optional[str] = None


class TestEmailReq(BaseModel):
    to: str


def _setting_source(key: str, env: str) -> str:
    """Where the effective value comes from: 'app', 'env', or 'none'."""
    try:
        r = db.q_write("SELECT value FROM app_settings WHERE key=:k", {"k": key})
        if not r.empty and str(r.iloc[0]["value"] or "").strip():
            return "app"
    except Exception:
        pass
    return "env" if os.environ.get(env, "").strip() else "none"


@app.get("/api/settings/email")
def email_settings_get(authorization: Optional[str] = Header(None)):
    _require(authorization, "owner")
    c = auth.smtp_settings()
    keys = [("smtp_host", "SMTP_HOST"), ("smtp_port", "SMTP_PORT"), ("smtp_user", "SMTP_USER"),
            ("smtp_pass", "SMTP_PASS"), ("smtp_from", "SMTP_FROM"), ("public_app_url", "PUBLIC_APP_URL")]
    return {
        "smtp_host": c["host"], "smtp_port": c["port"], "smtp_user": c["user"],
        "smtp_from": c["from"], "public_app_url": c["public_app_url"],
        "password_set": bool(c["password"]),                 # value never returned
        "ready": auth.smtp_configured(),
        "sources": {k: _setting_source(k, e) for k, e in keys},
    }


@app.post("/api/settings/email")
def email_settings_save(body: EmailSettingsReq, authorization: Optional[str] = Header(None)):
    _require(authorization, "owner")
    mapping = {"smtp_host": body.smtp_host, "smtp_port": body.smtp_port,
               "smtp_user": body.smtp_user, "smtp_from": body.smtp_from,
               "public_app_url": body.public_app_url}
    for k, v in mapping.items():
        if v is not None:
            _set_setting(k, v.strip())
    if body.smtp_pass:                                       # only overwrite when provided
        _set_setting("smtp_pass", body.smtp_pass.strip())
    return {"ok": True, "ready": auth.smtp_configured()}


def _ensure_keka():
    db.execute("""
        CREATE TABLE IF NOT EXISTS keka_attendance (
            id BIGSERIAL PRIMARY KEY,
            month TEXT NOT NULL,
            emp_no TEXT, emp_name TEXT, job_title TEXT, department TEXT, sub_department TEXT,
            reporting_manager TEXT, work_date DATE, status TEXT, shift TEXT,
            in_time TEXT, out_time TEXT, late_by_min INT, early_by_min INT,
            effective_min INT, total_min INT, break_min INT, overtime_min INT, short_eff_min INT,
            UNIQUE(emp_no, work_date)
        )""")
    db.execute("CREATE INDEX IF NOT EXISTS keka_month_idx ON keka_attendance(month)")
    db.execute("CREATE INDEX IF NOT EXISTS keka_name_idx ON keka_attendance(emp_name)")


def _hm_to_min(x):
    """'8:30' / '08:30' / '-1:15' -> minutes; blanks/'0:00' -> 0."""
    s = str(x or "").strip()
    if ":" not in s:
        return 0
    neg = s.startswith("-"); s = s.lstrip("-")
    try:
        h, m = s.split(":")[:2]
        v = int(h) * 60 + int(m)
        return -v if neg else v
    except Exception:
        return 0


@app.post("/api/keka/upload")
async def keka_upload(file: UploadFile = File(...), authorization: Optional[str] = Header(None)):
    """Owner uploads the monthly Keka 'Daily Performance Report' xlsx; rows are
    parsed and upserted into keka_attendance (re-uploading a month replaces it)."""
    _require(authorization, "owner")
    if not db.has_write():
        raise HTTPException(status_code=400, detail="No write DB configured")
    import pandas as _pd
    try:
        data = await file.read()
        from io import BytesIO
        raw = _pd.read_excel(BytesIO(data), sheet_name=0, header=2)
    except Exception as e:  # noqa
        raise HTTPException(status_code=400, detail=f"Could not read Excel: {str(e)[:160]}")
    raw = raw.dropna(subset=["Employee Name"])
    if raw.empty:
        raise HTTPException(status_code=400, detail="No employee rows found — is this the Keka Daily Performance Report?")
    col = {c: c for c in raw.columns}

    def gv(r, name):
        return r[name] if name in col and _pd.notna(r.get(name)) else None
    rows = []
    months = set()
    for _, r in raw.iterrows():
        try:
            wd = _pd.to_datetime(gv(r, "Date"), errors="coerce", dayfirst=True)
        except Exception:
            wd = None
        if wd is None or _pd.isna(wd):
            continue
        mon = wd.strftime("%Y-%m"); months.add(mon)
        rows.append({
            "month": mon, "emp_no": str(gv(r, "Employee Number") or "").strip(),
            "emp_name": str(gv(r, "Employee Name") or "").strip(),
            "job_title": str(gv(r, "Job Title") or "").strip() or None,
            "department": str(gv(r, "Department") or "").strip() or None,
            "sub_department": str(gv(r, "Sub Department") or "").strip() or None,
            "reporting_manager": str(gv(r, "Reporting Manager") or "").strip() or None,
            "work_date": wd.strftime("%Y-%m-%d"), "status": str(gv(r, "Status") or "").strip() or None,
            "shift": str(gv(r, "Shift") or "").strip() or None,
            "in_time": str(gv(r, "In Time") or "").strip() or None,
            "out_time": str(gv(r, "Out Time") or "").strip() or None,
            "late_by_min": _hm_to_min(gv(r, "Late By")), "early_by_min": _hm_to_min(gv(r, "Early By")),
            "effective_min": _hm_to_min(gv(r, "Effective Hours")), "total_min": _hm_to_min(gv(r, "Total Hours")),
            "break_min": _hm_to_min(gv(r, "Break Duration")), "overtime_min": _hm_to_min(gv(r, "Over Time")),
            "short_eff_min": _hm_to_min(gv(r, "Total Short Hours(Effective)")),
        })
    if not rows:
        raise HTTPException(status_code=400, detail="No dated rows parsed")
    # replace the affected month(s), then bulk insert
    for m in months:
        db.execute("DELETE FROM keka_attendance WHERE month=:m", {"m": m})
    ins = """INSERT INTO keka_attendance
        (month,emp_no,emp_name,job_title,department,sub_department,reporting_manager,work_date,status,shift,
         in_time,out_time,late_by_min,early_by_min,effective_min,total_min,break_min,overtime_min,short_eff_min)
        VALUES (:month,:emp_no,:emp_name,:job_title,:department,:sub_department,:reporting_manager,:work_date,:status,:shift,
         :in_time,:out_time,:late_by_min,:early_by_min,:effective_min,:total_min,:break_min,:overtime_min,:short_eff_min)
        ON CONFLICT (emp_no, work_date) DO NOTHING"""
    from sqlalchemy import text as _text
    eng = db._engine_write()
    with eng.begin() as con:
        con.execute(_text(ins), rows)
    keka_effective_hours.cache_clear()        # new attendance changes the capacity
    return {"ok": True, "rows": len(rows), "months": sorted(months),
            "employees": len({r["emp_name"] for r in rows})}


@app.get("/api/attendance")
def attendance(month: Optional[str] = None, authorization: Optional[str] = Header(None)):
    """Keka attendance matched to Hubstaff tracked time for a month: per employee
    effective vs tracked hours, the present-but-untracked gap, real utilization,
    overtime, short hours and attendance. Scope-aware."""
    _require(authorization)
    members, g = load()
    months = []
    try:
        mm = db.q_write("SELECT DISTINCT month FROM keka_attendance ORDER BY month DESC")
        months = mm["month"].tolist()
    except Exception:
        return {"month": None, "rows": [], "summary": {}, "months": []}
    if not month:
        month = months[0] if months else None
    if not month:
        return {"month": None, "rows": [], "summary": {}, "months": []}
    try:
        kr = db.q_write("""
            SELECT emp_name, max(department) department,
                   sum(effective_min) eff, sum(overtime_min) ot,
                   sum(short_eff_min) FILTER (WHERE effective_min>0) sh,
                   count(*) FILTER (WHERE effective_min>0) present_days,
                   count(*) FILTER (WHERE late_by_min>30) late_days,
                   count(*) FILTER (WHERE effective_min=0 AND upper(coalesce(status,'')) NOT LIKE 'WO%') off_days
            FROM keka_attendance WHERE month=:m GROUP BY emp_name""", {"m": month})
    except Exception:
        return {"month": month, "rows": [], "summary": {}, "months": months}
    gm = _scope_df(g[g["date_s"].str.startswith(month)])
    tracked = gm.groupby("user_id")["tracked_h"].sum().to_dict() if (gm is not None and not gm.empty) else {}
    name2uid = {}
    try:
        hm = db.q_write("SELECT hubstaff_user_id uid, hr_full_name nm FROM employee_mapping WHERE coalesce(hubstaff_user_id,'')<>''")
        for _, x in hm.iterrows():
            nm = str(x["nm"] or "").strip().lower()
            if nm:
                name2uid[nm] = str(x["uid"])
    except Exception:
        pass
    sc = _scope_ctx.get()
    rows = []
    for _, r in kr.iterrows():
        nm = str(r["emp_name"]).strip()
        uid = name2uid.get(nm.lower())
        if sc is not None and (uid is None or str(uid) not in sc):
            continue
        eff = float(r["eff"] or 0) / 60.0
        trk = float(tracked.get(str(uid), 0)) if uid else 0.0
        rows.append({"name": nm, "department": r["department"] or "—",
                     "effective_h": round(eff, 1), "tracked_h": round(trk, 1),
                     "gap_h": round(eff - trk, 1), "real_util": round(trk / eff * 100, 0) if eff else 0,
                     "overtime_h": round(float(r["ot"] or 0) / 60.0, 1),
                     "short_h": round(float(r["sh"] or 0) / 60.0, 1),
                     "present_days": int(r["present_days"]), "off_days": int(r["off_days"]),
                     "late_days": int(r["late_days"]), "matched": uid is not None})
    rows.sort(key=lambda x: -x["gap_h"])
    teff = sum(r["effective_h"] for r in rows); ttrk = sum(r["tracked_h"] for r in rows)
    summary = {"employees": len(rows), "matched": sum(1 for r in rows if r["matched"]),
               "effective_h": round(teff), "tracked_h": round(ttrk), "gap_h": round(teff - ttrk),
               "real_util": round(ttrk / teff * 100, 0) if teff else 0,
               "overtime_h": round(sum(r["overtime_h"] for r in rows)),
               "short_h": round(sum(r["short_h"] for r in rows))}
    return clean({"month": month, "rows": rows, "summary": summary, "months": months})


@app.get("/api/attendance/trend")
def attendance_trend(authorization: Optional[str] = Header(None)):
    """Per-month real-utilization / gap across every uploaded Keka month."""
    _require(authorization)
    members, g = load()
    try:
        kr = db.q_write("""SELECT month, sum(effective_min) eff, sum(overtime_min) ot
                           FROM keka_attendance GROUP BY month ORDER BY month""")
    except Exception:
        return {"trend": []}
    name2uid = set()
    try:
        hm = db.q_write("SELECT hubstaff_user_id uid FROM employee_mapping WHERE coalesce(hubstaff_user_id,'')<>''")
        name2uid = {str(x["uid"]) for _, x in hm.iterrows()}
    except Exception:
        pass
    gg = _scope_df(g)
    if gg is not None and not gg.empty:
        gg = gg[gg["user_id"].astype(str).isin(name2uid)].copy()
        gg["mon"] = gg["date_s"].str[:7]
        trk_by_mon = gg.groupby("mon")["tracked_h"].sum().to_dict()
    else:
        trk_by_mon = {}
    out = []
    for _, r in kr.iterrows():
        m = r["month"]; eff = float(r["eff"] or 0) / 60.0; trk = float(trk_by_mon.get(m, 0))
        out.append({"month": m, "effective_h": round(eff), "tracked_h": round(trk),
                    "gap_h": round(eff - trk), "real_util": round(trk / eff * 100, 0) if eff else 0,
                    "overtime_h": round(float(r["ot"] or 0) / 60.0)})
    return {"trend": out}


@app.get("/api/workforce")
def workforce(date_from: Optional[str] = None, date_to: Optional[str] = None,
              department: Optional[str] = None, atl: Optional[str] = None,
              employee: Optional[str] = None, client: Optional[str] = None,
              client_type: Optional[str] = None, billable: Optional[str] = None,
              status: Optional[str] = None):
    """Workforce + flow metrics for the scope/period: attendance %, overtime,
    short hours, cross-team share and the office -> tracked -> billable funnel."""
    members, g = load()
    f = {"date_from": date_from, "date_to": date_to, "department": department, "atl": atl,
         "employee": employee, "client": client, "client_type": client_type,
         "billable": billable, "status": status}
    _, d = apply_filters(members, g, f)
    blank = {"has_keka": False, "attendance_pct": 0, "present_days": 0, "off_days": 0,
             "overtime_h": 0, "short_h": 0, "late_days": 0, "cross_team_pct": 0,
             "cross_team_h": 0, "total_tracked_h": 0,
             "funnel": {"office_h": 0, "tracked_h": 0, "billable_h": 0}}
    if d.empty:
        return blank
    tracked_h = float(d["tracked_h"].sum()); billable_h = float(d["billable_h"].sum())
    # cross-team: activity team (atl) != employee's HR home team (as-of the period)
    home, _dep = _hr_team_dept_maps(date_to or date_from)
    dd = d.copy(); dd["home"] = dd["user_id"].astype(str).map(home)
    cross_mask = dd["home"].notna() & (dd["home"] != "") & (dd["atl"] != dd["home"])
    cross_h = float(dd.loc[cross_mask, "tracked_h"].sum())
    out = dict(blank)
    out.update({"cross_team_h": round(cross_h, 1), "total_tracked_h": round(tracked_h, 1),
                "cross_team_pct": round(cross_h / tracked_h * 100, 0) if tracked_h else 0})
    df_, dt_ = str(d["date_s"].min()), str(d["date_s"].max())
    uids = {str(u) for u in d["user_id"].unique()}
    office_h = 0.0
    try:
        hm = db.q_write("SELECT hubstaff_user_id uid, lower(trim(hr_full_name)) nm "
                        "FROM employee_mapping WHERE coalesce(hubstaff_user_id,'')<>'' "
                        "AND coalesce(hr_full_name,'')<>''")
        names = sorted({str(x["nm"]) for _, x in hm.iterrows() if str(x["uid"]) in uids and x["nm"]})
        if names:
            kr = db.q_write("""
                SELECT round(sum(effective_min)/60.0) eff, round(sum(overtime_min)/60.0) ot,
                       round(sum(short_eff_min) FILTER (WHERE effective_min>0)/60.0) sh,
                       count(*) FILTER (WHERE effective_min>0) present,
                       count(*) FILTER (WHERE late_by_min>30) late,
                       count(*) FILTER (WHERE effective_min=0 AND upper(coalesce(status,'')) NOT LIKE 'WO%') off
                FROM keka_attendance
                WHERE lower(trim(emp_name)) = ANY(:names) AND work_date BETWEEN :df AND :dt
            """, {"names": names, "df": df_, "dt": dt_})
            if not kr.empty:
                r = kr.iloc[0]
                office_h = float(r["eff"] or 0)
                present = int(r["present"] or 0); off = int(r["off"] or 0)
                out.update({"has_keka": office_h > 0, "overtime_h": int(r["ot"] or 0),
                            "short_h": int(r["sh"] or 0), "late_days": int(r["late"] or 0),
                            "present_days": present, "off_days": off,
                            "attendance_pct": round(present / (present + off) * 100, 0) if (present + off) else 0})
    except Exception:  # noqa
        pass
    # Funnel "Office hours" must use the SAME capacity as the Utilization KPI
    # (_user_cap_hours = Keka effective, with an 8h×working-days fallback for anyone
    # without attendance) — otherwise the funnel's Tracked% (Keka-only denominator)
    # wouldn't match the KPI. So Tracked ÷ Office here == the Utilization KPI.
    cap_h = sum(_user_cap_hours(d).values()) if not d.empty else 0.0
    out["funnel"] = {"office_h": round(cap_h), "tracked_h": round(tracked_h), "billable_h": round(billable_h)}
    return clean(out)


@app.get("/api/keka/status")
def keka_status(authorization: Optional[str] = Header(None)):
    _require(authorization, "owner")
    try:
        r = db.q_write("""SELECT month, count(*) rows, count(DISTINCT emp_name) employees,
                          round(sum(effective_min)/60.0) eff_h
                          FROM keka_attendance GROUP BY month ORDER BY month DESC""")
    except Exception:
        return {"months": []}
    return {"months": [{"month": x["month"], "rows": int(x["rows"]), "employees": int(x["employees"]),
                        "effective_hours": float(x["eff_h"] or 0)} for _, x in r.iterrows()]}


@app.post("/api/settings/email/test")
def email_settings_test(body: TestEmailReq, authorization: Optional[str] = Header(None)):
    actor = _require(authorization, "owner")
    if not re.match(r"^[^@\s]+@[^@\s]+\.[^@\s]+$", body.to.strip()):
        raise HTTPException(status_code=400, detail="Enter a valid email address")
    link = auth.build_invite_link("test-link-preview")
    sent, detail = auth.send_invite_email(body.to.strip(), "there", actor.get("name") or "Finovate Insight", link)
    if not sent:
        raise HTTPException(status_code=400, detail=f"Could not send: {detail}")
    return {"ok": True}


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


# --- Accurate attribution helpers (Fix 1) ---
_OPS_TEAMS = ["Titans", "Syndicates", "Synergy", "Alliance", "Falcons", "Mavericks", "Bravix"]
# Minimum tracked hours for someone to count as "having worked" a team/scope in
# the filter dropdowns — drops sub-minute tracking traces that mis-listed people.
MIN_MEMBER_H = 1.0
_INTERNAL_KW = ["emailing", "training", "nb tasks", "admin-operational", "admin operational",
                "introductory", "operational works", "company maintenance", "master project",
                "new initiatives", "initiatives", "tracker", "audit & reporting", "employee process",
                "accounting - finovate", "marketing -ledgerlabs", "marketing - ledgerlabs",
                "& management", "maintenance"]


def norm_team(raw: str) -> str:
    """Normalize a raw team/space (ClickUp space or Hubstaff project prefix) to a clean team name."""
    s = (raw or "").strip(); low = s.lower()
    if not s or low in ("(unknown)", "no project"):
        return "Unassigned"
    if "archived" in low:
        return "Archived Projects"
    if "operations" in low and "ledger" not in low:
        for t in _OPS_TEAMS:
            if t.lower()[:6] in low:   # stem match (handles Syndicate/Syndicates)
                return t
        return "Operations (other)"
    if "ledger labs" in low or low.startswith("ll:"):
        return "Ledger Labs (Internal)"
    if "marketing" in low:
        return "Marketing"
    if "training" in low:
        return "Training"
    if "admin" in low:
        return "Admin"
    if "onboarding" in low:
        return "Onboarding"
    if "tax" in low or "client tracking" in low:
        return "Tax"
    if low.startswith("hr"):
        return "HR"
    if "audit" in low:
        return "Audit"
    if any(k in low for k in ["developer", "odoo", "it ai", "r&d", "automation", "config"]):
        return "IT / R&D"
    if "praduman" in low:
        return "Praduman Singh"
    if "personal" in low:
        return "Personal"
    if "operation lead" in low:
        return "Operations (other)"
    if any(k in low for k in ["test supabase", "sales", "indian", "tracker", "billable hours"]):
        return "Unassigned"
    return s


def dept_of_team(team: str) -> str:
    if team in _OPS_TEAMS or (team or "").startswith("Operations"):
        return "Operations"
    return team or "Unassigned"


def client_kind(client: str) -> str:
    c = (client or "").lower()
    if any(k in c for k in _INTERNAL_KW):
        return "Internal"
    cz = c.replace(" ", "")
    if "(f)" in cz:
        return "Fixed"
    if "(h)" in cz:
        return "Hourly"
    return "Project"


_NON_CLIENT = ("(no client)", "Unassigned", "No Project")


def real_clients(d):
    """Activity frame restricted to REAL external clients — excludes internal
    buckets (NB Tasks, Training, Accounting …). Single source of truth so the
    Active Clients count and its drill-down list always agree."""
    if d is None or d.empty:
        return d
    return d[(d["client_type"] != "Internal") & (~d["client"].isin(_NON_CLIENT))]


def _working_days(start: str, end: str) -> int:
    """Company rule: Mon-Fri working + FIRST Saturday of each month working;
    all other Saturdays + every Sunday = off. Counts working days in [start, end]."""
    from datetime import date, timedelta
    try:
        d = date.fromisoformat(str(start)[:10]); e = date.fromisoformat(str(end)[:10])
    except Exception:
        return 0
    if e < d:
        return 0
    n = 0; cur = d
    while cur <= e:
        w = cur.weekday()  # Mon=0 .. Sun=6
        if w <= 4:                      # Mon-Fri
            n += 1
        elif w == 5 and cur.day <= 7:   # first Saturday of the month
            n += 1
        cur += timedelta(days=1)
    return n


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
    # Accurate hours from hubstaff_activities, attributed PER ACTIVITY to its REAL
    # team/client (Fix 1): ClickUp task-ID link (remote_id = task_id) gives the
    # real ClickUp space/folder; when no task links, the Hubstaff project name
    # ("Team / Client") is parsed as a fallback. No more "dump all hours into the
    # employee's primary folder" — so team/dept/client totals are real (no double-count).
    g = db.q("""
        SELECT
          a.user_id::text AS user_id,
          a.date::text AS date_s,
          CASE WHEN c.task_id IS NOT NULL AND COALESCE(c.space_name,'')<>'' THEN c.space_name
               ELSE COALESCE(NULLIF(split_part(p.name,' / ',1),''), 'No Project') END AS team_raw,
          CASE WHEN c.task_id IS NOT NULL AND COALESCE(c.folder_name,'')<>'' THEN c.folder_name
               WHEN p.name LIKE '%/%' THEN trim(split_part(p.name,' / ',2))
               ELSE COALESCE(NULLIF(p.name,''), 'No Project') END AS client_raw,
          (COALESCE(a.billable,0) > 0) AS billable,
          (c.task_id IS NOT NULL) AS clickup_linked,
          (a.task_id IS NOT NULL) AS has_task,
          SUM(COALESCE(a.tracked,0)) AS tracked,
          SUM(COALESCE(a.overall,0)) AS overall,
          SUM(COALESCE(a.billable,0)) AS billable_sec,
          SUM(COALESCE(a.overall,0) * 100) AS prod_w,
          SUM(CASE WHEN trim(COALESCE(ht.summary,'')) ~* '(^|[^a-z0-9])nb([^a-z0-9]|$)'
                     OR trim(COALESCE(p.name,'')) ~* '(^|[^a-z0-9])nb([^a-z0-9]|$)'
                   THEN COALESCE(a.tracked,0) ELSE 0 END) AS nb_sec
        FROM hubstaff_activities a
        LEFT JOIN hubstaff_projects p ON p.id = a.project_id
        LEFT JOIN hubstaff_tasks ht ON ht.id = a.task_id
        LEFT JOIN clickup_tasks c ON c.task_id = ht.remote_id
        WHERE COALESCE(a.tracked,0) > 0
        GROUP BY 1,2,3,4,5,6,7
    """)
    g["date_s"] = pd.to_datetime(g["date_s"]).dt.strftime("%Y-%m-%d")
    for c in ["tracked", "overall", "billable_sec", "prod_w", "nb_sec"]:
        g[c] = pd.to_numeric(g[c], errors="coerce").fillna(0)
    g["billable"] = g["billable"].astype(bool)
    g["clickup_linked"] = g["clickup_linked"].astype(bool)
    g["has_task"] = g["has_task"].astype(bool)
    g["tracked_h"] = g["tracked"] / SEC
    g["overall_h"] = g["overall"] / SEC
    g["billable_h"] = g["billable_sec"] / SEC
    g["non_billable_h"] = (g["tracked"] - g["billable_sec"]).clip(lower=0) / SEC
    g["productivity"] = g["prod_w"] / g["tracked"].replace(0, 1)

    # REAL per-activity Team / Department / Client (normalized). Replaces the old
    # "primary folder for everything" approach.
    intel = clickup_intel()
    omap, cdim = intel["emp"], intel["clients"]
    g["atl"] = g["team_raw"].map(norm_team)
    g["department"] = g["atl"].map(dept_of_team)
    g["client"] = g["client_raw"].fillna("(no client)").replace("", "(no client)")
    g["client_type"] = g["client"].map(client_kind)

    # Department / Team come from the HR mapping (employee's home dept/team) so the
    # dropdowns show the real HR org structure. Status + display name also from HR.
    # Cross-team note: within Operations, an employee's work on ANOTHER Operations
    # sub-team's task still shows under that sub-team (per-activity); only non-HR
    # work buckets (Archived/Ledger Labs/Training…) roll up to the home team.
    hr_status_map, hr_name_map, hr_team_map, hr_dept_map = {}, {}, {}, {}
    OPS = set(_OPS_TEAMS)
    try:
        hm = db.q("SELECT hubstaff_user_id uid, hr_full_name, department, team, status "
                  "FROM employee_mapping WHERE coalesce(hubstaff_user_id,'')<>''")

        def _cl(v):
            s = str(v).strip()
            return "" if s.lower() in ("nan", "none", "") else s

        for _, r in hm.iterrows():
            uid = str(r["uid"]); stt = (r["status"] or "UNKNOWN")
            hr_status_map[uid] = stt
            nm = _cl(r["hr_full_name"])
            if nm and "client" not in nm.lower() and "not staff" not in nm.lower():
                hr_name_map[uid] = nm
            dp, tm = _cl(r["department"]), _cl(r["team"])
            if stt == "EXTERNAL":
                hr_dept_map[uid] = "US"; hr_team_map[uid] = "US Team"
            elif dp:
                hr_dept_map[uid] = dp
                hr_team_map[uid] = tm if tm else dp
        if hr_team_map:
            ao = g["atl"]  # per-activity team (Titans, Bravix, Archived Projects, …)
            # DATE-AWARE home team: an employee who transferred teams has rows in
            # team_history; their activity is attributed to the team they were in ON
            # that activity's date. Everyone else uses the static current home team.
            hist = _team_history()

            def _home(u, ds):  # -> (team, dept) for this row's user + date
                if u in hist:
                    r = _home_asof(hist[u], ds)
                    if r:
                        return (r[0] or hr_team_map.get(u) or "Unassigned",
                                r[1] or hr_dept_map.get(u) or "Unassigned")
                return (hr_team_map.get(u) or "Unassigned", hr_dept_map.get(u) or "Unassigned")

            resolved = [(a, None) if a in OPS else (None, _home(u, ds))
                        for u, a, ds in zip(g["user_id"], ao, g["date_s"])]
            g["atl"] = [a if a is not None else hd[0] for a, hd in resolved]
            g["department"] = ["Operations" if a is not None else hd[1] for a, hd in resolved]
    except Exception as _e:  # noqa
        print("HR mapping override skipped:", str(_e)[:120])

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
    # Hours-based membership sets (Fix 1, Part B): an employee belongs to a
    # team/dept/client only where they actually TRACKED time (not just had a task).
    team_sets = g.groupby("user_id")["atl"].apply(lambda s: sorted(set(s))).to_dict()
    dept_sets = g.groupby("user_id")["department"].apply(lambda s: sorted(set(s))).to_dict()
    client_sets = g.groupby("user_id")["client"].apply(lambda s: sorted(set(s))).to_dict()
    # primary = the team/client with the most hours (for display)
    prim_team = (g.groupby(["user_id", "atl"])["tracked_h"].sum().reset_index()
                 .sort_values("tracked_h", ascending=False).drop_duplicates("user_id")
                 .set_index("user_id")["atl"].to_dict())
    prim_client = (g.groupby(["user_id", "client"])["tracked_h"].sum().reset_index()
                   .sort_values("tracked_h", ascending=False).drop_duplicates("user_id")
                   .set_index("user_id")["client"].to_dict())
    # Reliable per-employee task counts via the stable ClickUp identity map.
    rel_counts = _emp_task_counts()
    rows = []
    for uid in g["user_id"].unique():
        gap = (gmax_d - pd.to_datetime(last.get(uid))).days
        status = "Active" if gap <= 1 else ("Idle" if gap <= 4 else "Offline")
        rate = rate_map.get(uid)
        if pd.isna(rate) or not rate:
            rate = 40.0
        info = omap.get(uid) or {}
        # Task counts come straight from the reliable Hubstaff-id assignment (same
        # source as the Assigned Tasks list), 0 when the person has none — we do NOT
        # fall back to ClickUp username matching, which lands a namesake's tasks on
        # the wrong person (e.g. two people share a first name).
        _tot, _act = rel_counts.get(str(uid), (0, 0))
        _tstat = "Active" if _act > 0 else "Idle"
        rows.append({"user_id": uid, "name": hr_name_map.get(uid) or name_map.get(uid) or f"User {uid}",
                     "role": role_map.get(uid, ""), "status": status,
                     "task_completion": comp, "rate": float(rate),
                     "email": email_map.get(uid, ""),
                     "active_tasks": int(_act),
                     "total_tasks": int(_tot),
                     "task_status": _tstat,
                     "hr_status": hr_status_map.get(uid, "UNKNOWN"),
                     "client": prim_client.get(uid, "Unassigned"),
                     "dept_set": dept_sets.get(uid, []),
                     "team_set": team_sets.get(uid, []),
                     "client_set": client_sets.get(uid, []),
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


def apply_filters(members, g, f, scope="home"):
    has_sets = "team_set" in members.columns
    m = members
    # ROLE SCOPE (security): restrict to the signed-in user's permitted people
    # BEFORE any user-supplied filter, so no filter can widen beyond their scope.
    sc = _scope_ctx.get()
    if sc is not None:
        m = m[m["user_id"].astype(str).isin(sc)]
    for key, col in [("employee", "name"), ("role", "role"), ("status", "status")]:
        vals = _vals(f.get(key))
        if vals:
            m = m[m[col].isin(vals)]
    dep_vals = _vals(f.get("department")); atl_vals = _vals(f.get("atl"))
    if scope == "home" and (dep_vals or atl_vals):
        # HOME-team model (default): a team/department selects its GENUINE HR HOME
        # members and keeps ALL their activity — so the metrics show that team's own
        # people (a cross-team helper from another home team is NOT pulled in). Each
        # person's work is still attributed per-activity, so By Team shows where the
        # home members also worked. The Over Budget view calls with scope="activity"
        # to instead count everyone who worked on the team's clients.
        home, hdept = _hr_team_dept_maps(f.get("date_to") or f.get("date_from"))
        m = m[m["user_id"].apply(
            lambda u: (not atl_vals or home.get(str(u)) in atl_vals)
            and (not dep_vals or hdept.get(str(u)) in dep_vals))]
        ids = set(m["user_id"])
        d = g[g["user_id"].isin(ids)]
        for key, col in [("client", "client"), ("client_type", "client_type")]:
            vals = _vals(f.get(key))
            if vals:
                d = d[d[col].isin(vals)]
    else:
        # PER-ACTIVITY model (Over Budget, or no team/dept filter): everyone who
        # tracked time on the selected team/dept/client, restricted to that activity.
        if has_sets:
            for key, setcol in [("department", "dept_set"), ("atl", "team_set"), ("client", "client_set")]:
                vals = _vals(f.get(key))
                if vals:
                    sv = set(vals)
                    m = m[m[setcol].apply(lambda s: bool(sv & set(s or [])))]
        ids = set(m["user_id"])
        d = g[g["user_id"].isin(ids)]
        for key, col in [("department", "department"), ("atl", "atl"),
                         ("client", "client"), ("client_type", "client_type")]:
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
    return m, d


def _period_headline(members, g, f):
    """Headline metrics for a given filter window — used for period-over-period."""
    _, dd = apply_filters(members, g, f)
    if dd.empty:
        return {"total": 0.0, "billable": 0.0, "non_billable": 0.0, "util": 0.0, "prod": 0.0, "act": 0.0, "emps": 0}
    b = float(dd["billable_h"].sum()); nb = float(dd["non_billable_h"].sum()); t = b + nb
    cap = sum(_user_cap_hours(dd).values())  # REAL office-hour capacity (Keka)
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


def _user_wdays(d):
    """Fix 6: expected WORKING days (Mon-Fri + 1st Saturday) per user across their
    active span within the filtered data — fallback capacity when no Keka data."""
    if d.empty:
        return {}
    span = d.groupby("user_id")["date_s"].agg(["min", "max"])
    return {u: max(1, _working_days(r["min"], r["max"])) for u, r in span.iterrows()}


@lru_cache(maxsize=64)
def keka_effective_hours(date_from, date_to):
    """{hubstaff_uid: office hours} from Keka daily effective time over the range —
    the REAL utilization denominator (replaces the flat 8h/day assumption)."""
    out = {}
    if not db.has_write():
        return out
    try:
        hm = db.q_write("SELECT hubstaff_user_id uid, lower(trim(hr_full_name)) nm "
                        "FROM employee_mapping WHERE coalesce(hubstaff_user_id,'')<>'' "
                        "AND coalesce(hr_full_name,'')<>''")
        n2u = {str(x["nm"]): str(x["uid"]) for _, x in hm.iterrows() if x["nm"]}
        where, params = [], {}
        if date_from:
            where.append("work_date >= :df"); params["df"] = date_from
        if date_to:
            where.append("work_date <= :dt"); params["dt"] = date_to
        w = (" WHERE " + " AND ".join(where)) if where else ""
        kr = db.q_write(f"SELECT lower(trim(emp_name)) nm, sum(effective_min) eff "
                        f"FROM keka_attendance{w} GROUP BY 1", params)
        for _, x in kr.iterrows():
            uid = n2u.get(str(x["nm"]))
            if uid and float(x["eff"] or 0) > 0:
                out[uid] = float(x["eff"]) / 60.0
    except Exception:  # noqa
        pass
    return out


def _user_cap_hours(d):
    """{uid: capacity HOURS}: real Keka office hours for the active range when
    available, else working-days × 8 (fallback for anyone without attendance)."""
    wd = _user_wdays(d)
    if not wd:
        return {}
    keka = keka_effective_hours(str(d["date_s"].min()), str(d["date_s"].max()))
    return {u: float(keka.get(str(u)) or (wd[u] * 8)) for u in wd}


def group_metrics(d, by):
    grp = d.groupby(by).agg(
        billable=("billable_h", "sum"), non_billable=("non_billable_h", "sum"),
        total=("tracked_h", "sum"), overall=("overall_h", "sum"),
        prod_w=("prod_w", "sum"), tracked=("tracked", "sum"),
        revenue=("revenue", "sum"), empdays=("ud", "nunique"),
        people=("user_id", "nunique")).reset_index()
    # Capacity = REAL office hours (Keka effective) per user, split across the groups
    # they appear in proportional to hours — so utilization = tracked ÷ office time.
    ch = _user_cap_hours(d)
    if by == "user_id":
        grp["caph"] = grp["user_id"].map(lambda u: ch.get(u, 0.0))
    else:
        utot = d.groupby("user_id")["tracked_h"].sum().to_dict()
        gu = d.groupby([by, "user_id"])["tracked_h"].sum().reset_index()
        gu["capd"] = [ch.get(u, 0.0) * (h / utot.get(u, 1) if utot.get(u, 0) else 0)
                      for u, h in zip(gu["user_id"], gu["tracked_h"])]
        caps_s = gu.groupby(by)["capd"].sum()
        grp["caph"] = grp[by].map(caps_s).fillna(0.0)
    cap = grp["caph"].replace(0, 1)
    grp["utilization"] = (grp["total"] / cap * 100).clip(upper=100)
    grp["activity"] = (grp["overall"] / grp["total"].replace(0, 1) * 100)
    grp["avg_day"] = grp["total"] / grp["empdays"].replace(0, 1)
    # Productivity = billable share of tracked time (billable hours / total × 100)
    grp["productivity"] = (grp["billable"] / grp["total"].replace(0, 1) * 100)
    grp["wdays"] = grp["caph"] / 8.0          # office-hours expressed as days
    grp["budget"] = grp["caph"]               # capacity hours
    grp["variance"] = grp["total"] - grp["budget"]
    grp["grade"] = (0.5 * grp["utilization"] + 0.5 * grp["productivity"]).apply(grade_letter)
    return grp


@lru_cache(maxsize=1)
def _emp_clickup_map():
    """{hubstaff_user_id(str) -> clickup_user_id(str)} from employee_mapping.
    Built by link_clickup.py (co-occurrence of tasks linked in both systems, then
    unambiguous name match) and owner-editable in the mapping admin. This is the
    stable identity bridge between Hubstaff and ClickUp — replaces fragile
    assignee-name matching, so a person's tasks never land on a namesake."""
    if not db.has_db():
        return {}
    try:
        t = db.q("SELECT hubstaff_user_id::text uid, clickup_user_id::text cid "
                 "FROM employee_mapping WHERE coalesce(clickup_user_id,'')<>''")
        return {str(r["uid"]): str(r["cid"]) for _, r in t.iterrows()}
    except Exception:
        return {}


def build_tasks_db(uid, date_from=None, date_to=None):
    # An employee's tasks come from HUBSTAFF first: hubstaff_tasks.assignee_ids holds
    # Hubstaff user ids, so we match on the employee's hubstaff_user_id (no name
    # matching). Only LIVE tasks (status active/completed — archived/deleted excluded)
    # count as "in Hubstaff". ClickUp is joined only to enrich estimate / client.
    # When the person has NO live Hubstaff tasks, we fall back to ClickUp via the
    # stable identity map (employee_mapping.clickup_user_id).
    # When a date range is given, list ONLY tasks DUE in that period (status as it
    # stands — closed or still open), so the list matches the selected window.
    try:
        import json
        uid_i = int(float(str(uid)))
    except (TypeError, ValueError):
        return []
    hb_due = ck_due = ""
    p_hb = {"u": json.dumps([uid_i])}
    if date_from and date_to:
        hb_due = "AND COALESCE(ct.due_date, ht.due_at)::date BETWEEN :df AND :dt"
        ck_due = "AND due_date::date BETWEEN :df AND :dt"
        p_hb["df"] = date_from; p_hb["dt"] = date_to
    try:
        t = db.q(f"""
            SELECT COALESCE(NULLIF(ct.subtask_name,''), ct.parent_task_name, ht.summary) AS task,
                   COALESCE(ct.list_name, ct.space_name, hp.name, '—') AS client,
                   COALESCE(ct.time_estimate_hrs,0) AS estimated,
                   COALESCE(ct.time_tracked_hrs,0) AS tracked,
                   COALESCE(NULLIF(ct.status,''), ht.status, '') AS status,
                   to_char(COALESCE(ct.due_date, ht.due_at), 'YYYY-MM-DD') AS due
            FROM hubstaff_tasks ht
            LEFT JOIN clickup_tasks ct
                   ON ct.task_id = ht.remote_id AND COALESCE(ct.is_deleted,false)=false
            LEFT JOIN hubstaff_projects hp ON hp.id = ht.project_id
            WHERE ht.assignee_ids @> :u AND ht.status IN ('active','completed') {hb_due}
            ORDER BY COALESCE(ct.due_date, ht.due_at) DESC NULLS LAST LIMIT 60
        """, p_hb)
        if t is not None and not t.empty:
            return t.fillna("").to_dict("records")
        # Fallback: ClickUp by mapped id (only when no live Hubstaff tasks).
        cid = _emp_clickup_map().get(str(uid_i))
        if cid:
            p_ck = {"one": json.dumps([{"id": int(cid)}])}
            if date_from and date_to:
                p_ck["df"] = date_from; p_ck["dt"] = date_to
            t = db.q(f"""
                SELECT COALESCE(NULLIF(subtask_name,''), parent_task_name, '—') AS task,
                       COALESCE(list_name, space_name, '—') AS client,
                       COALESCE(time_estimate_hrs,0) AS estimated,
                       COALESCE(time_tracked_hrs,0) AS tracked,
                       COALESCE(status,'') AS status,
                       to_char(due_date,'YYYY-MM-DD') AS due
                FROM clickup_tasks
                WHERE coalesce(is_deleted,false)=false AND coalesce(archived,false)=false
                  AND (CASE WHEN coalesce(assignees,'') ~ '^\\s*\\['
                            THEN assignees::jsonb ELSE '[]'::jsonb END) @> :one {ck_due}
                ORDER BY due_date DESC NULLS LAST LIMIT 60
            """, p_ck)
            return t.fillna("").to_dict("records")
        return []
    except Exception:
        return []


@lru_cache(maxsize=1)
def _emp_task_counts():
    """Per-employee task counts {uid: (total, active)}, HUBSTAFF-first:
    total/active come from hubstaff_tasks assigned to the person's Hubstaff id
    (live tasks: total = active+completed, active = status 'active'). Only when the
    person has NO live Hubstaff tasks do we fall back to their ClickUp id (via the
    stable identity map) and count ClickUp tasks (active = status not closed)."""
    if not db.has_db():
        return {}
    out = {}
    try:
        # PRIMARY: Hubstaff assignment, live tasks only.
        hb = db.q("""
            SELECT e.val AS uid,
                   COUNT(*) FILTER (WHERE ht.status IN ('active','completed')) AS total,
                   COUNT(*) FILTER (WHERE ht.status = 'active') AS active
            FROM hubstaff_tasks ht
            CROSS JOIN LATERAL jsonb_array_elements_text(ht.assignee_ids) AS e(val)
            WHERE jsonb_typeof(ht.assignee_ids)='array'
            GROUP BY e.val
        """)
        for _, r in hb.iterrows():
            out[str(r["uid"])] = (int(r["total"]), int(r["active"]))
        # FALLBACK: ClickUp by mapped id, ONLY for people with no live Hubstaff tasks.
        byck = db.q("""
            SELECT (a->>'id') cid,
                   COUNT(*) total,
                   COUNT(*) FILTER (WHERE lower(coalesce(status,'')) <> ALL(:closed)) active
            FROM clickup_tasks,
                 LATERAL jsonb_array_elements(
                   CASE WHEN coalesce(assignees,'') ~ '^\\s*\\['
                        THEN assignees::jsonb ELSE '[]'::jsonb END) a
            WHERE coalesce(is_deleted,false)=false AND coalesce(archived,false)=false
              AND coalesce(a->>'id','')<>''
            GROUP BY a->>'id'
        """, {"closed": list(CLOSED_STATUS)})
        ck = {str(r["cid"]): (int(r["total"]), int(r["active"])) for _, r in byck.iterrows()}
        for hub, cid in _emp_clickup_map().items():
            cur = out.get(str(hub))
            if (cur is None or cur[0] == 0) and str(cid) in ck:
                out[str(hub)] = ck[str(cid)]
        return out
    except Exception:
        return {}


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
def filters(department: Optional[str] = None, atl: Optional[str] = None,
            date_from: Optional[str] = None, date_to: Optional[str] = None):
    members, g = load()

    def srt(vals):
        v = sorted([x for x in set(vals) if x not in (None, "", "—")])
        if "Unassigned" in v:
            v = [x for x in v if x != "Unassigned"] + ["Unassigned"]
        return v

    dep_vals, atl_vals = _vals(department), _vals(atl)
    has_sets = "team_set" in members.columns

    # Dropdowns are scoped to (a) the caller's permitted people and (b) the
    # SELECTED PERIOD — only departments/teams/clients/employees with data in
    # that window appear. date_min/date_max below still use the full history.
    gp = _scope_df(g)
    if date_from:
        gp = gp[gp["date_s"] >= date_from]
    if date_to:
        gp = gp[gp["date_s"] <= date_to]

    # name -> HR status (ACTIVE / RELIEVED / EXTERNAL / UNKNOWN) for the dropdown dots
    emp_status = {}
    if "hr_status" in members.columns:
        for _, mr in members.iterrows():
            nm = mr.get("name")
            if isinstance(nm, str) and nm:
                emp_status[nm] = str(mr.get("hr_status") or "UNKNOWN")

    if has_sets:
        name_map = dict(zip(members["user_id"], members["name"]))
        # cascade: department -> teams/clients within that dept (by activity)
        scope = gp[gp["department"].isin(dep_vals)] if dep_vals else gp
        all_depts = set(gp["department"].unique())
        teams_scoped = set(scope["atl"].unique())
        clients_scoped = set(scope["client"].unique())
        client_types = srt(set(gp["client_type"].unique()))
        # EMPLOYEES = genuine HR HOME-team members of the selected dept/team who have
        # activity in the period. Cross-team workers are NOT listed here — their work
        # still shows in the By Department / By Team graphs (per-activity attribution).
        home_map, hdept_map = _hr_team_dept_maps(date_to or date_from)
        seen = {str(u) for u in gp["user_id"].unique()}          # active in the period (scope)
        if atl_vals or dep_vals:
            # Unmapped users (not in employee_mapping) have no home team/dept; their
            # activity rolls into "Unassigned" in the metrics, so list them there too
            # — keeps the dropdown consistent with the By Department/Team graphs.
            emp_uids = [u for u in seen
                        if (not atl_vals or (home_map.get(u) or "Unassigned") in atl_vals)
                        and (not dep_vals or (hdept_map.get(u) or "Unassigned") in dep_vals)]
        else:
            emp_uids = list(seen)
        employees = sorted({name_map.get(u) for u in emp_uids if name_map.get(u)})
        return clean({
            "date_min": g["date_s"].min(), "date_max": g["date_s"].max(),
            "departments": srt(all_depts),
            "atls": srt(teams_scoped),
            "employees": employees,
            "clients": srt(clients_scoped),
            "client_types": client_types,
            "employee_status": emp_status,
            "total_members": int(len(members)),
            "source": "supabase" if db.has_db() else "csv",
        })

    # CSV fallback (no ClickUp membership) — use the single-column values
    dim = gp.groupby("user_id").agg(department=("department", "first"), atl=("atl", "first"),
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
        "employee_status": emp_status,
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
        total=("tracked_h", "sum"), prod_w=("prod_w", "sum"), overall=("overall_h", "sum"),
        tracked=("tracked", "sum"), revenue=("revenue", "sum"),
        ud=("ud", "nunique"), users=("user_id", "nunique")).reset_index().sort_values("date_s")) if not empty else pd.DataFrame()

    # per-day KPI series (utilization / activity / productivity) for KPI drill-down
    kpi_daily = []
    if not empty:
        for r in daily.itertuples():
            tot = float(r.total) or 0.0
            cap_d = int(r.ud) * 8
            kpi_daily.append({
                "date": r.date_s,
                "utilization": round(min(100.0, tot / cap_d * 100) if cap_d else 0.0, 1),
                "activity": round(float(r.overall) / tot * 100, 1) if tot else 0.0,
                "productivity": round(float(r.billable) / tot * 100, 1) if tot else 0.0,
                "hours": round(tot, 1),
                "active": round(float(r.overall), 1),
                "billable": round(float(r.billable), 1),
                "capacity": cap_d,
            })

    bill = float(d["billable_h"].sum()) if not empty else 0.0
    nonb = float(d["non_billable_h"].sum()) if not empty else 0.0
    total = bill + nonb
    empdays = int(d["ud"].nunique()) if not empty else 0
    people = int(d["user_id"].nunique()) if not empty else 0
    cap = sum(_user_cap_hours(d).values()) if not empty else 0  # REAL office-hour capacity (Keka)
    util = min(100.0, total / cap * 100) if cap else 0.0
    prod = float(bill / total * 100) if total else 0.0  # productivity = billable share
    revenue = float(d["revenue"].sum()) if not empty else 0.0
    budget = cap
    variance = total - budget

    emp = group_metrics(d, "user_id") if not empty else pd.DataFrame()
    if not emp.empty:
        emp = emp.merge(members[["user_id", "name", "status", "task_completion",
                                 "active_tasks", "total_tasks", "task_status", "hr_status", "client"]], on="user_id", how="left")
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

    # Scope tasks to people ACTIVE in the current (date-filtered) data, so task
    # status/priority update with the date filter too — not only membership.
    active_uids = set(d["user_id"]) if not empty else set()
    m_scope = m[m["user_id"].isin(active_uids)] if not empty else m.iloc[0:0]
    task_summary = _task_summary(d, emp, m_scope)

    # primary team per employee
    if not empty:
        pa = d.groupby(["user_id", "atl"])["tracked_h"].sum().reset_index()
        pa = pa.loc[pa.groupby("user_id")["tracked_h"].idxmax()].set_index("user_id")["atl"].to_dict()
    else:
        pa = {}

    def _grouprows(by, frame=None):
        out = []
        if empty:
            return out
        src = d if frame is None else frame
        for _, r in group_metrics(src, by).sort_values("billable", ascending=False).head(60).iterrows():
            out.append({"team": r[by], "team_size": int(r["people"]),
                        "billable": round(r["billable"], 1), "non_billable": round(r["non_billable"], 1),
                        "total": round(r["total"], 1), "utilization": round(r["utilization"], 0),
                        "activity": round(r["activity"], 0),
                        "productivity": round(r["productivity"], 0), "grade": r["grade"],
                        "revenue": round(r["revenue"], 0), "budget": round(r["budget"], 0),
                        "variance": round(r["variance"], 0), "status": "Active"})
        return out

    # By Team / By Department — grouped per ACTIVITY (the ClickUp space worked in).
    # With the home-team filter model, a team filter already restricts to that team's
    # own people, so these bars show where those people worked (their spread).
    teams = _grouprows("atl")
    departments = _grouprows("department")

    employees_tbl = []
    if not emp.empty:
        # all clients each employee touches (from ClickUp membership), not just primary
        cset = dict(zip(members["user_id"], members["client_set"])) if "client_set" in members.columns else {}
        for _, r in emp.sort_values("billable", ascending=False).head(200).iterrows():
            clist = [c for c in (cset.get(r["user_id"]) or []) if c and c != "Unassigned"]
            employees_tbl.append({"name": r["name"], "team": pa.get(r["user_id"], "—"),
                                  "billable": round(r["billable"], 1), "non_billable": round(r["non_billable"], 1),
                                  "utilization": round(r["utilization"], 0), "activity": round(r["activity"], 0),
                                  "productivity": round(r["productivity"], 0), "avg_day": round(r["avg_day"], 1),
                                  "days": int(r["empdays"]), "grade": r["grade"],
                                  "active_tasks": int(r.get("active_tasks") or 0),
                                  "task_status": r.get("task_status") or "Idle",
                                  "hr_status": r.get("hr_status") or "UNKNOWN",
                                  "client": r.get("client") or "—",
                                  "clients": sorted(clist)})

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
    # real external clients only — exclude internal buckets (NB Tasks, Training,
    # Accounting, "(no client)" …) so the count is meaningful and lines up with
    # the budgeted-client list instead of inflating with non-client folders.
    _n_clients = int(real_clients(d)["client"].nunique()) if not empty else 0
    summary = {
        "employees": people, "active_days": int(d["date_s"].nunique()) if not empty else 0,
        "departments": int(d["department"].nunique()) if not empty else 0,
        "teams": int(d["atl"].nunique()) if not empty else 0,
        "clients": _n_clients,
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

    # Clients — ALL clients in scope (every ClickUp folder the in-scope people
    # touch), not just the few that carry primary-mapped Hubstaff hours.
    cdim = clickup_intel()["clients"]
    hrs_by = d.groupby("client")["tracked_h"].sum().to_dict() if not empty else {}
    scope_clients = set()
    if "client_set" in m.columns and not m.empty:
        for cs in m["client_set"]:
            scope_clients.update(c for c in (cs or []) if c and c != "Unassigned")
    scope_clients.update(c for c in hrs_by if c and c != "Unassigned")
    clients_summary = []
    for cl in scope_clients:
        info = cdim.get(cl, {})
        clients_summary.append({"client": cl, "hours": round(float(hrs_by.get(cl, 0.0)), 1),
                                "active": bool(info.get("active", False)),
                                "category": info.get("category", "Project"),
                                "active_tasks": int(info.get("active_tasks", 0)),
                                "total_tasks": int(info.get("total", 0))})
    clients_summary.sort(key=lambda c: -c["hours"])
    # Header count is date-aware: clients actually worked on in the selected
    # period (matches the employees/active-days counts). The Client Health
    # section still lists every in-scope client.
    summary["clients"] = sum(1 for c in clients_summary if c["hours"] > 0)
    active_clients = sum(1 for c in clients_summary if c["hours"] > 0)
    clients_status = {"active": active_clients, "inactive": len(scope_clients) - active_clients}

    # At-a-glance task counts
    task_total = int(sum(t["value"] for t in task_summary))
    completed_t = int(next((t["value"] for t in task_summary if t["name"] == "Completed"), 0))
    summary["total_tasks"] = task_total
    summary["active_tasks"] = task_total - completed_t

    # Client Health (active / at-risk / inactive) over ALL in-scope clients:
    # active = has tracked hours this period; at-risk = ClickUp-active but no
    # tracked hours; inactive = no active tasks and no hours.
    client_health = {"active": 0, "at_risk": 0, "inactive": 0}
    for c in clients_summary:
        if c["hours"] > 0:
            client_health["active"] += 1
        elif c["active_tasks"] > 0:
            client_health["at_risk"] += 1
        else:
            client_health["inactive"] += 1

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
    if not m_scope.empty and "pri" in m_scope.columns:
        for _, r in m_scope.iterrows():
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
        "kpis": kpis, "hours_distribution": hours_distribution, "hours_trend": hours_trend, "kpi_daily": kpi_daily,
        "top_clients": top_clients, "task_summary": task_summary,
        "teams": teams, "departments": departments, "employees": employees_tbl, "total_employees": int(len(members)),
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


def _tracked_breakdown(d):
    """Task-vs-project split of the ALREADY-FILTERED activity frame `d`, so it
    matches the dashboard's Total Hours exactly (same per-activity team/client
    scope). Billable split uses the same billable flag as everywhere else."""
    blank = {"task_h": 0.0, "task_billable_h": 0.0, "task_non_billable_h": 0.0,
             "project_h": 0.0, "project_billable_h": 0.0, "project_non_billable_h": 0.0}
    if d is None or d.empty or "has_task" not in d.columns:
        return blank
    tk = d[d["has_task"]]; pr = d[~d["has_task"]]
    return {"task_h": round(float(tk["tracked_h"].sum()), 1),
            "task_billable_h": round(float(tk["billable_h"].sum()), 1),
            "task_non_billable_h": round(float(tk["non_billable_h"].sum()), 1),
            "project_h": round(float(pr["tracked_h"].sum()), 1),
            "project_billable_h": round(float(pr["billable_h"].sum()), 1),
            "project_non_billable_h": round(float(pr["non_billable_h"].sum()), 1)}


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
    _, d = apply_filters(members, g, f)
    return clean(_tracked_breakdown(d))


def _tracked_lists(uids, f, limit=500):
    """Drill-down lists: tracked hours per task vs per project, billable split.
    Computes the SAME per-activity team/client as g and applies the active
    filters (team/client/dept/type/billable) so the list matches Total Hours."""
    blank = {"by_task": [], "by_project": []}
    if not db.has_db() or not uids:
        return blank
    where = ["coalesce(a.tracked,0) > 0", "a.user_id::text = ANY(:uids)"]
    params = {"uids": list(uids)}
    if f.get("date_from"):
        where.append("a.date >= :df"); params["df"] = f["date_from"]
    if f.get("date_to"):
        where.append("a.date <= :dt"); params["dt"] = f["date_to"]
    try:
        df = db.q(f"""
            SELECT
              coalesce(nullif(ht.summary,''),'(unnamed task)') AS task_name,
              coalesce(nullif(p.name,''),'(no project)') AS proj_name,
              (a.task_id IS NOT NULL) AS has_task,
              CASE WHEN c.task_id IS NOT NULL AND coalesce(c.space_name,'')<>'' THEN c.space_name
                   ELSE coalesce(nullif(split_part(p.name,' / ',1),''),'No Project') END AS team_raw,
              CASE WHEN c.task_id IS NOT NULL AND coalesce(c.folder_name,'')<>'' THEN c.folder_name
                   WHEN p.name LIKE '%/%' THEN trim(split_part(p.name,' / ',2))
                   ELSE coalesce(nullif(p.name,''),'No Project') END AS client_raw,
              (coalesce(a.billable,0) > 0) AS billable,
              sum(coalesce(a.tracked,0)) AS tracked
            FROM hubstaff_activities a
            LEFT JOIN hubstaff_projects p ON p.id = a.project_id
            LEFT JOIN hubstaff_tasks ht ON ht.id = a.task_id
            LEFT JOIN clickup_tasks c ON c.task_id = ht.remote_id
            WHERE {" AND ".join(where)}
            GROUP BY 1,2,3,4,5,6
        """, params)
    except Exception as e:  # noqa
        print("list failed:", e); return blank
    if df.empty:
        return blank
    # same per-activity attribution as g, then apply the active scope filters
    df["atl"] = df["team_raw"].map(norm_team)
    df["department"] = df["atl"].map(dept_of_team)
    df["client"] = df["client_raw"].fillna("(no client)").replace("", "(no client)")
    df["client_type"] = df["client"].map(client_kind)
    for key, col in [("department", "department"), ("atl", "atl"), ("client", "client"), ("client_type", "client_type")]:
        vals = _vals(f.get(key))
        if vals:
            df = df[df[col].isin(vals)]
    df["tracked"] = pd.to_numeric(df["tracked"], errors="coerce").fillna(0)
    df["billable"] = df["billable"].astype(bool)
    bf = f.get("billable")
    if bf == "Billable":
        df = df[df["billable"]]
    elif bf == "Non-Billable":
        df = df[~df["billable"]]
    if df.empty:
        return blank

    def _agg(sub, by, with_project):
        out = []
        for keys, grp in sub.groupby(by):
            keys = keys if isinstance(keys, tuple) else (keys,)
            tot = float(grp["tracked"].sum())
            bil = float(grp.loc[grp["billable"], "tracked"].sum())
            row = {"name": keys[0], "total": round(tot / SEC, 1),
                   "billable": round(bil / SEC, 1), "non_billable": round((tot - bil) / SEC, 1)}
            if with_project:
                row["project"] = keys[1]
            out.append(row)
        out.sort(key=lambda r: -r["total"])
        return out[:limit]

    return {"by_task": _agg(df[df["has_task"]], ["task_name", "proj_name"], True),
            "by_project": _agg(df[~df["has_task"]], ["proj_name"], False)}


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
    _, d = apply_filters(members, g, f)
    uids = [str(x) for x in d["user_id"].unique().tolist()] if not d.empty else []
    return clean(_tracked_lists(uids, f))


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


@app.get("/api/hours_detail")
def hours_detail(
    date_from: Optional[str] = None, date_to: Optional[str] = None,
    department: Optional[str] = None, atl: Optional[str] = None,
    employee: Optional[str] = None, client: Optional[str] = None,
    client_type: Optional[str] = None, billable: Optional[str] = None,
    status: Optional[str] = None,
):
    """Total-hours drill-down: who tracked what — employee x project x task,
    split billable / non-billable. Honours the active scope + date filter."""
    members, g = load()
    f = dict(date_from=date_from, date_to=date_to, department=department, atl=atl,
             employee=employee, client=client, client_type=client_type,
             billable=billable, status=status)
    _, d = apply_filters(members, g, f)
    uids = [str(x) for x in d["user_id"].unique().tolist()] if not d.empty else []
    if not db.has_db() or not uids:
        return {"rows": [], "count": 0}
    where = ["coalesce(a.tracked,0) > 0", "a.user_id::text = ANY(:uids)"]
    params = {"uids": list(uids), "nb": _NB_SQL}
    if date_from:
        where.append("a.date >= :df"); params["df"] = date_from
    if date_to:
        where.append("a.date <= :dt"); params["dt"] = date_to
    # Non-billable = time on NB-marked tasks/projects (same definition as the
    # Total Hours card). team_raw/client_raw are computed exactly like g so the
    # same scope filter applies — totals then match the card precisely.
    nb_expr = ("CASE WHEN trim(coalesce(ht.summary,'')) ~* :nb "
               "OR trim(coalesce(p.name,'')) ~* :nb THEN a.tracked ELSE 0 END")
    sql = f"""
        SELECT a.user_id::text uid,
               coalesce(nullif(a.user_name,''), 'User '||a.user_id::text) emp,
               coalesce(nullif(p.name,''), 'No Project') project,
               coalesce(nullif(ht.summary,''),
                        CASE WHEN a.task_id IS NULL THEN '(project only — no task)' ELSE '(unnamed task)' END) task,
               CASE WHEN c.task_id IS NOT NULL AND coalesce(c.space_name,'')<>'' THEN c.space_name
                    ELSE coalesce(nullif(split_part(p.name,' / ',1),''),'No Project') END AS team_raw,
               CASE WHEN c.task_id IS NOT NULL AND coalesce(c.folder_name,'')<>'' THEN c.folder_name
                    WHEN p.name LIKE '%/%' THEN trim(split_part(p.name,' / ',2))
                    ELSE coalesce(nullif(p.name,''),'No Project') END AS client_raw,
               sum(a.tracked) t, sum({nb_expr}) nbsec
        FROM hubstaff_activities a
        LEFT JOIN hubstaff_projects p ON p.id = a.project_id
        LEFT JOIN hubstaff_tasks ht ON ht.id = a.task_id
        LEFT JOIN clickup_tasks c ON c.task_id = ht.remote_id
        WHERE {' AND '.join(where)}
        GROUP BY 1, 2, 3, 4, 5, 6
    """
    try:
        df = db.q(sql, params)
    except Exception as e:  # noqa
        print("hours_detail failed:", e); return {"rows": [], "count": 0}
    if df.empty:
        return {"rows": [], "count": 0}
    # EXACT same per-activity attribution as g: norm_team, then roll non-OPS work
    # up to the HR home team (so totals match the Total Hours card precisely).
    OPS = set(_OPS_TEAMS); tmap, dmap = _hr_team_dept_maps(f.get("date_to") or f.get("date_from"))
    raw = df["team_raw"].map(norm_team)
    df["atl"] = [a if a in OPS else (tmap.get(str(u)) or "Unassigned") for u, a in zip(df["uid"], raw)]
    df["department"] = ["Operations" if a in OPS else (dmap.get(str(u)) or "Unassigned") for u, a in zip(df["uid"], raw)]
    df["client"] = df["client_raw"].fillna("(no client)").replace("", "(no client)")
    df["client_type"] = df["client"].map(client_kind)
    for key, col in [("department", "department"), ("atl", "atl"), ("client", "client"), ("client_type", "client_type")]:
        vals = _vals(f.get(key))
        if vals:
            df = df[df[col].isin(vals)]
    if df.empty:
        return {"rows": [], "count": 0}
    df["t"] = pd.to_numeric(df["t"], errors="coerce").fillna(0)
    df["nbsec"] = pd.to_numeric(df["nbsec"], errors="coerce").fillna(0)
    agg = df.groupby(["emp", "project", "task"], as_index=False).agg(t=("t", "sum"), nbsec=("nbsec", "sum"))
    rows = []
    for r in agg.itertuples():
        tot = float(r.t); nbv = min(float(r.nbsec), tot); bil = tot - nbv
        if billable == "Billable":
            if bil <= 0:
                continue
            rows.append({"employee": r.emp, "project": r.project, "task": r.task,
                         "total": round(bil / SEC, 1), "billable": round(bil / SEC, 1), "non_billable": 0.0})
        elif billable == "Non-Billable":
            if nbv <= 0:
                continue
            rows.append({"employee": r.emp, "project": r.project, "task": r.task,
                         "total": round(nbv / SEC, 1), "billable": 0.0, "non_billable": round(nbv / SEC, 1)})
        else:
            rows.append({"employee": r.emp, "project": r.project, "task": r.task,
                         "total": round(tot / SEC, 1), "billable": round(bil / SEC, 1),
                         "non_billable": round(nbv / SEC, 1)})
    rows.sort(key=lambda x: -x["total"])
    return clean({"rows": rows[:1000], "count": len(rows[:1000])})


@app.get("/api/compare_trend")
def compare_trend(kind: str, names: str,
                  date_from: Optional[str] = None, date_to: Optional[str] = None):
    """Per-entity daily tracked-hours series for the trend overlay in the
    multi-select comparison. kind = employee | team | department."""
    members, g = load()
    name_list = [n.strip() for n in names.split(",") if n.strip()]
    setcol = {"team": "team_set", "department": "dept_set"}.get(kind)
    all_dates: set = set()
    raw = []
    for nm in name_list:
        if kind == "employee":
            uids = set(members[members["name"] == nm]["user_id"])
        elif setcol and setcol in members.columns:
            uids = set(members[members[setcol].apply(lambda s: nm in (s or []))]["user_id"])
        else:
            uids = set()
        d = g[g["user_id"].isin(uids)]
        if date_from:
            d = d[d["date_s"] >= date_from]
        if date_to:
            d = d[d["date_s"] <= date_to]
        daily = d.groupby("date_s")["tracked_h"].sum() if not d.empty else pd.Series(dtype=float)
        raw.append((nm, daily))
        all_dates.update(daily.index)
    dates = sorted(all_dates)
    series = [{"name": nm, "values": [round(float(daily.get(dt, 0.0)), 1) for dt in dates]} for nm, daily in raw]
    return clean({"dates": dates, "series": series})


@app.get("/api/employee")
def employee(name: str, date_from: Optional[str] = None, date_to: Optional[str] = None):
    members, g = load()
    row = members[members["name"] == name]
    if row.empty:
        return {"found": False}
    mr = row.iloc[0]
    uid = mr["user_id"]
    if not _scope_allows(uid):            # role scope: can't view people outside it
        return {"found": False}
    d = g[g["user_id"] == uid]
    if date_from:
        d = d[d["date_s"] >= date_from]
    if date_to:
        d = d[d["date_s"] <= date_to]
    tracked = float(d["tracked_h"].sum())
    bill = float(d["billable_h"].sum())
    overall = float(d["overall_h"].sum())
    empdays = int(d["date_s"].nunique())
    # Capacity = REAL office hours from Keka for the period; fallback to working
    # days × 8 when this employee has no attendance data.
    wdays = _working_days(d["date_s"].min(), d["date_s"].max()) if not d.empty else 0
    keka_h = keka_effective_hours(str(d["date_s"].min()), str(d["date_s"].max())) if not d.empty else {}
    cap = float(keka_h.get(str(uid)) or max(wdays, 1) * 8)
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
    tasks = build_tasks_db(uid, date_from, date_to) if db.has_db() else build_tasks_sample(uid, name, client)

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


def _period_months(date_from, date_to):
    from datetime import date as _date
    try:
        days = (_date.fromisoformat(date_to) - _date.fromisoformat(date_from)).days + 1 if (date_from and date_to) else 30
    except Exception:
        days = 30
    return max(days / 30.0, 0.1)


@app.get("/api/client")
def client_profile(name: str, date_from: Optional[str] = None, date_to: Optional[str] = None):
    """Per-client drill-down: hours, billable mix, budget vs actual, people, trend."""
    members, g = load()
    d = _scope_df(g[g["client"] == name])
    if date_from:
        d = d[d["date_s"] >= date_from]
    if date_to:
        d = d[d["date_s"] <= date_to]
    if d.empty:
        return {"found": False}
    tracked = float(d["tracked_h"].sum()); bill = float(d["billable_h"].sum()); nb = tracked - bill
    team = d["atl"].mode().iloc[0] if not d["atl"].mode().empty else "Unassigned"
    dept = d["department"].mode().iloc[0] if not d["department"].mode().empty else "Unassigned"
    days = int(d["date_s"].nunique())
    bud = client_budgets()
    b = bud.get(re.sub(r"\s*\([fh]\)\s*$", "", str(name).strip(), flags=re.I).strip().lower())
    months = _period_months(date_from, date_to)
    budget = round(b["budget"] * months, 1) if b else None
    name_map = dict(zip(members["user_id"], members["name"]))
    pe = (d.groupby("user_id").agg(h=("tracked_h", "sum"), billh=("billable_h", "sum"),
          dd=("date_s", "nunique")).reset_index().sort_values("h", ascending=False))
    people = [{"name": name_map.get(r.user_id, f"User {r.user_id}"), "hours": round(r.h, 1),
               "billable": round(r.billh, 1), "days": int(r.dd)} for r in pe.itertuples()]
    daily = (d.groupby("date_s").agg(h=("tracked_h", "sum"), b=("billable_h", "sum"))
             .reset_index().sort_values("date_s"))
    daily_rows = [{"date": r.date_s, "billable": round(r.b, 2), "non_billable": round(r.h - r.b, 2)}
                  for r in daily.itertuples()]
    return clean({
        "found": True,
        "profile": {
            "client": name, "team": team, "department": dept, "type": (b["type"] if b else ""),
            "total": round(tracked, 1), "billable": round(bill, 1), "non_billable": round(nb, 1),
            "billable_pct": round(bill / tracked * 100, 0) if tracked else 0,
            "budget": budget, "variance": round(tracked - budget, 1) if budget is not None else None,
            "over": bool(tracked > budget) if budget is not None else None,
            "people": len(people), "days": days, "last_worked": d["date_s"].max(),
        },
        "people": people, "daily": daily_rows,
    })


@app.get("/api/team")
def team_profile(name: str, date_from: Optional[str] = None, date_to: Optional[str] = None,
                 employee: Optional[str] = None, atl: Optional[str] = None,
                 department: Optional[str] = None, client: Optional[str] = None,
                 client_type: Optional[str] = None, billable: Optional[str] = None,
                 status: Optional[str] = None):
    """Per-team drill-down: capacity/utilization, members, top clients, trend.
    Scoped to the active filter — so clicking a team bar shows the team within the
    current view (e.g. just the filtered employee's work in that team) instead of the
    team's company-wide totals."""
    members, g = load()
    f = {"date_from": date_from, "date_to": date_to, "employee": employee, "atl": atl,
         "department": department, "client": client, "client_type": client_type,
         "billable": billable, "status": status}
    _, d = apply_filters(members, g, f)
    if not d.empty:
        d = d[d["atl"] == name]      # `name` is the ClickUp space (per-activity team)
    if d.empty:
        return {"found": False}
    tracked = float(d["tracked_h"].sum()); bill = float(d["billable_h"].sum()); nb = tracked - bill
    dept = d["department"].mode().iloc[0] if not d["department"].mode().empty else "Unassigned"
    gm = group_metrics(d, "atl")
    r0 = gm.iloc[0]
    name_map = dict(zip(members["user_id"], members["name"]))
    pe = (d.groupby("user_id").agg(h=("tracked_h", "sum"), billh=("billable_h", "sum"),
          ov=("overall_h", "sum"), dd=("date_s", "nunique")).reset_index().sort_values("h", ascending=False))
    ppl = [{"name": name_map.get(r.user_id, f"User {r.user_id}"), "hours": round(r.h, 1),
            "billable": round(r.billh, 1), "days": int(r.dd),
            "activity": round(r.ov / r.h * 100, 0) if r.h else 0} for r in pe.itertuples()]
    cl = (d.groupby("client").agg(h=("tracked_h", "sum"), billh=("billable_h", "sum"))
          .reset_index().sort_values("h", ascending=False).head(12))
    clients = [{"client": r.client, "hours": round(r.h, 1), "billable": round(r.billh, 1)} for r in cl.itertuples()]
    daily = (d.groupby("date_s").agg(h=("tracked_h", "sum"), b=("billable_h", "sum"))
             .reset_index().sort_values("date_s"))
    daily_rows = [{"date": r.date_s, "billable": round(r.b, 2), "non_billable": round(r.h - r.b, 2)}
                  for r in daily.itertuples()]
    return clean({
        "found": True,
        "profile": {
            "team": name, "department": dept, "people": len(ppl),
            "total": round(tracked, 1), "billable": round(bill, 1), "non_billable": round(nb, 1),
            "billable_pct": round(bill / tracked * 100, 0) if tracked else 0,
            "utilization": round(float(r0["utilization"]), 0), "activity": round(float(r0["activity"]), 0),
            "productivity": round(float(r0["productivity"]), 0), "grade": r0["grade"],
            "clients": int(d["client"].nunique()), "days": int(d["date_s"].nunique()),
        },
        "members": ppl, "clients": clients, "daily": daily_rows,
    })


def _task_summary(d, emp, members):
    ts = {"Completed": 0, "In Progress": 0, "Review": 0, "Overdue": 0}
    # Scope-aware: aggregate per-employee task status for the employees in scope.
    # When the schema carries per-member status ("st"), always return the scoped
    # result (even zero) so it tracks the active filter instead of a global total.
    if "st" in members.columns:
        for _, r in members.iterrows():
            s = r.get("st") or {}
            ts["Completed"] += int(s.get("completed", 0))
            ts["In Progress"] += int(s.get("in_progress", 0))
            ts["Review"] += int(s.get("review", 0))
            ts["Overdue"] += int(s.get("overdue", 0))
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
        rows = build_tasks_db(uid, f.get("date_from"), f.get("date_to")) if db.has_db() else \
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


# =================================================================
# EMPLOYEE MAPPING (Hubstaff name <-> HR identity) — editable from the app
# =================================================================
_MAP_DDL = """
CREATE TABLE employee_mapping (
  hubstaff_name     text PRIMARY KEY,
  hubstaff_user_id  text,
  hr_employee_no    text,
  hr_full_name      text,
  status            text,
  department        text,
  team              text,
  job_title         text,
  reporting_to      text,
  exit_date         date,
  confidence        text,
  total_hours       numeric,
  last_worked       date,
  reviewed          boolean DEFAULT false,
  clickup_user_id   text,
  clickup_link_source text,
  updated_at        timestamptz DEFAULT now()
)
"""

_TEAMHIST_DDL = """
CREATE TABLE IF NOT EXISTS team_history (
  id serial PRIMARY KEY,
  hubstaff_user_id text,
  team text,
  department text,
  effective_from date,
  created_at timestamptz DEFAULT now()
)
"""


@app.get("/api/mapping")
def mapping_get():
    try:
        df = db.q_write("SELECT * FROM employee_mapping ORDER BY total_hours DESC NULLS LAST")
    except Exception:
        return {"exists": False, "write": db.has_write(), "count": 0, "rows": []}
    # per-employee transfer history (sparse) for the dropdown + display
    hist = {}
    try:
        h = db.q_write("SELECT hubstaff_user_id uid, team, department dept, "
                       "to_char(effective_from,'YYYY-MM-DD') ef FROM team_history "
                       "ORDER BY hubstaff_user_id, effective_from")
        for _, r in h.iterrows():
            hist.setdefault(str(r["uid"]), []).append(
                {"team": r["team"], "department": r["dept"], "effective_from": r["ef"]})
    except Exception:  # noqa
        pass
    rows = []
    for _, r in df.iterrows():
        d = {}
        for k, v in r.items():
            if pd.isna(v):
                d[k] = None
            elif hasattr(v, "isoformat"):          # date / timestamp
                d[k] = str(v)[:10]
            elif isinstance(v, (bool, str)):
                d[k] = v
            elif isinstance(v, (int, float)):
                d[k] = v
            else:                                   # Decimal / numpy
                d[k] = float(v) if k == "total_hours" else str(v)
        d["history"] = hist.get(str(d.get("hubstaff_user_id") or ""), [])
        rows.append(d)
    # dropdown source lists
    teams = sorted({str(r.get("team")).strip() for r in rows if r.get("team") and str(r.get("team")).strip()})
    depts = sorted({str(r.get("department")).strip() for r in rows if r.get("department") and str(r.get("department")).strip()})
    return {"exists": True, "write": db.has_write(), "count": len(rows), "rows": rows,
            "teams": teams, "departments": depts}


@app.post("/api/mapping/save")
def mapping_save(payload: dict):
    if not db.has_write():
        return {"ok": False, "reason": "no_write", "detail": "Set DATABASE_URL_WRITE in backend/.env"}
    name = (payload or {}).get("hubstaff_name")
    if not name:
        return {"ok": False, "reason": "no_name"}
    editable = ["hr_employee_no", "hr_full_name", "status", "department", "team",
                "job_title", "reporting_to", "exit_date", "reviewed", "clickup_user_id"]
    sets, params = [], {"k_name": name}
    for k in editable:
        if k in payload:
            sets.append(f"{k} = :{k}")
            v = payload[k]
            params[k] = (None if v == "" else v)
    if not sets:
        return {"ok": False, "reason": "no_fields"}
    sets.append("updated_at = now()")
    try:
        db.execute(f"UPDATE employee_mapping SET {', '.join(sets)} WHERE hubstaff_name = :k_name", params)
        load.cache_clear()  # dashboard re-reads dept/team/status from the updated mapping
        _hr_hierarchy.cache_clear(); _hr_team_dept_maps.cache_clear(); keka_effective_hours.cache_clear()
        _emp_clickup_map.cache_clear(); _emp_task_counts.cache_clear()  # ClickUp identity link
        return {"ok": True}
    except Exception as e:  # noqa
        return {"ok": False, "reason": "db", "detail": str(e)[:200]}


@app.post("/api/mapping/transfer")
def mapping_transfer(payload: dict):
    """Record a team transfer with an effective date. Activity before the date keeps
    the OLD team, after it the NEW team (date-aware attribution via team_history).
    payload: {hubstaff_name, new_team, new_department?, effective_from 'YYYY-MM-DD'}."""
    if not db.has_write():
        return {"ok": False, "reason": "no_write", "detail": "Set DATABASE_URL_WRITE in backend/.env"}
    p = payload or {}
    name = (p.get("hubstaff_name") or "").strip()
    new_team = (p.get("new_team") or "").strip()
    eff = (p.get("effective_from") or "").strip()
    if not name or not new_team or not eff:
        return {"ok": False, "reason": "missing", "detail": "need hubstaff_name, new_team, effective_from"}
    try:
        row = db.q_write("SELECT hubstaff_user_id uid, team, department FROM employee_mapping "
                         "WHERE hubstaff_name = :n", {"n": name})
        if row.empty or not str(row.iloc[0]["uid"] or "").strip():
            return {"ok": False, "reason": "no_uid", "detail": "employee has no hubstaff_user_id"}
        uid = str(row.iloc[0]["uid"]).strip()
        cur_team = str(row.iloc[0]["team"] or "").strip()
        cur_dept = str(row.iloc[0]["department"] or "").strip()
        new_dept = (p.get("new_department") or cur_dept or "").strip()
        db.execute(_TEAMHIST_DDL)
        # Baseline: if no history yet, anchor the CURRENT team from an early date so all
        # pre-transfer activity keeps it. Use the employee's earliest activity date.
        existing = db.q_write("SELECT count(*) c FROM team_history WHERE hubstaff_user_id = :u", {"u": uid})
        if int(existing["c"][0]) == 0 and cur_team:
            base = db.q("SELECT to_char(min(date),'YYYY-MM-DD') d FROM hubstaff_activities WHERE user_id::text = :u", {"u": uid})
            base_from = (base["d"][0] if not base.empty and base["d"][0] else "2000-01-01")
            db.execute("INSERT INTO team_history (hubstaff_user_id, team, department, effective_from) "
                       "VALUES (:u,:t,:d,:f)", {"u": uid, "t": cur_team, "d": cur_dept, "f": base_from})
        # The transfer itself.
        db.execute("INSERT INTO team_history (hubstaff_user_id, team, department, effective_from) "
                   "VALUES (:u,:t,:d,:f)", {"u": uid, "t": new_team, "d": new_dept, "f": eff})
        # Current team/dept on employee_mapping = the latest (new) values.
        db.execute("UPDATE employee_mapping SET team=:t, department=:d, updated_at=now() "
                   "WHERE hubstaff_name=:n", {"t": new_team, "d": new_dept, "n": name})
        try:
            db.execute("GRANT SELECT ON team_history TO finovate_viewer")
        except Exception:
            pass
        load.cache_clear()
        _hr_hierarchy.cache_clear(); _hr_team_dept_maps.cache_clear(); keka_effective_hours.cache_clear()
        _team_history.cache_clear()
        return {"ok": True}
    except Exception as e:  # noqa
        return {"ok": False, "reason": "db", "detail": str(e)[:200]}


@app.post("/api/mapping/init")
def mapping_init():
    """One-time: create the table and seed it from app/employee_mapping.csv."""
    if not db.has_write():
        return {"ok": False, "reason": "no_write", "detail": "Set DATABASE_URL_WRITE in backend/.env"}
    import csv as _csv
    path = os.path.join(os.path.dirname(__file__), "..", "employee_mapping.csv")
    if not os.path.exists(path):
        return {"ok": False, "reason": "no_csv", "detail": "Run build_employee_mapping.py first"}
    try:
        db.execute("DROP TABLE IF EXISTS employee_mapping")
        db.execute(_MAP_DDL)
        ins = ("INSERT INTO employee_mapping (hubstaff_name,hubstaff_user_id,hr_employee_no,"
               "hr_full_name,status,department,team,job_title,reporting_to,exit_date,confidence,"
               "total_hours,last_worked) VALUES (:hubstaff_name,:hubstaff_user_id,:hr_employee_no,"
               ":hr_full_name,:status,:department,:team,:job_title,:reporting_to,:exit_date,"
               ":confidence,:total_hours,:last_worked) ON CONFLICT (hubstaff_name) DO NOTHING")
        n = 0
        with open(path, encoding="utf-8-sig") as fh:
            for r in _csv.DictReader(fh):
                r = {k: (None if (v is None or v == "") else v) for k, v in r.items()}
                r["total_hours"] = float(r["total_hours"]) if r.get("total_hours") else None
                db.execute(ins, r)
                n += 1
        try:
            db.execute("GRANT SELECT ON employee_mapping TO finovate_viewer")
        except Exception:
            pass
        load.cache_clear()  # dashboard re-reads with the fresh mapping
        _hr_hierarchy.cache_clear(); _hr_team_dept_maps.cache_clear(); keka_effective_hours.cache_clear()
        return {"ok": True, "rows": n}
    except Exception as e:  # noqa
        return {"ok": False, "reason": "db", "detail": str(e)[:300]}


@app.get("/api/task_delivery")
def task_delivery(date_from: Optional[str] = None, date_to: Optional[str] = None,
                  department: Optional[str] = None, atl: Optional[str] = None,
                  employee: Optional[str] = None, client: Optional[str] = None,
                  client_type: Optional[str] = None, billable: Optional[str] = None,
                  status: Optional[str] = None):
    """On-time delivery for the tasks WORKED (tracked) in the period — so a task
    tracked this month shows even if its due date is a later month. Completion is
    judged as-of the period end vs the task's own due date. When a
    department/team/employee/client filter is applied, scopes to those people."""
    act, p = _td_worked_scope(date_from, date_to, department, atl, employee, client,
                              client_type, billable, status)
    if act is None:
        return {"due": 0, "on_time": 0, "late": 0, "open": 0, "on_time_pct": 0.0}
    asof = "h.completed_at::date <= :dt" if date_to else "true"
    sql = f"""
      WITH worked AS (SELECT DISTINCT a.task_id tid FROM hubstaff_activities a WHERE {' AND '.join(act)})
      SELECT
        count(*) due,
        count(*) FILTER (WHERE h.completed_at IS NOT NULL AND {asof}
                         AND (h.due_at IS NULL OR h.completed_at::date <= h.due_at::date)) on_time,
        count(*) FILTER (WHERE h.completed_at IS NOT NULL AND {asof}
                         AND h.due_at IS NOT NULL AND h.completed_at::date > h.due_at::date) late,
        count(*) FILTER (WHERE h.completed_at IS NULL OR NOT ({asof})) open
      FROM worked w JOIN hubstaff_tasks h ON h.id = w.tid
    """
    try:
        r = db.q(sql, p).iloc[0]
        due = int(r["due"]) or 0
        ot = int(r["on_time"]); lt = int(r["late"]); op = int(r["open"])
        return {"due": due, "on_time": ot, "late": lt, "open": op,
                "on_time_pct": round(ot / due * 100, 1) if due else 0.0}
    except Exception as e:  # noqa
        return {"due": 0, "on_time": 0, "late": 0, "open": 0, "on_time_pct": 0.0, "error": str(e)[:150]}


def _td_worked_scope(date_from, date_to, department, atl, employee, client,
                     client_type, billable, status):
    """Shared scope for Task Delivery: the activity-WHERE clauses selecting tasks
    TRACKED in the period (optionally by the filtered people). Returns (clauses, params),
    or (None, _) when a filter resolves to nobody."""
    p = {}
    act = ["a.task_id IS NOT NULL"]
    if date_from:
        act.append("a.date >= :df"); p["df"] = date_from
    if date_to:
        act.append("a.date <= :dt"); p["dt"] = date_to
    if any([department, atl, employee, client]):
        try:
            members, g = load()
            f = {"department": department, "atl": atl, "employee": employee, "client": client,
                 "client_type": client_type, "billable": billable, "status": status}
            m, _ = apply_filters(members, g, f)
            uids = [str(u) for u in m["user_id"].unique()]
            if not uids:
                return None, p
            act.append("a.user_id::text = ANY(:uids)"); p["uids"] = uids
        except Exception:  # noqa
            pass
    return act, p


@app.get("/api/task_delivery_list")
def task_delivery_list(bucket: str, date_from: Optional[str] = None, date_to: Optional[str] = None,
                       department: Optional[str] = None, atl: Optional[str] = None,
                       employee: Optional[str] = None, client: Optional[str] = None,
                       client_type: Optional[str] = None, billable: Optional[str] = None,
                       status: Optional[str] = None):
    """The actual tasks behind a Task Delivery bucket (on_time / late / open), same
    scope as /api/task_delivery — tasks WORKED in the period — for the click modal."""
    act, p = _td_worked_scope(date_from, date_to, department, atl, employee, client,
                              client_type, billable, status)
    if act is None:
        return {"bucket": bucket, "rows": [], "count": 0}
    asof = "h.completed_at::date <= :dt" if date_to else "true"
    conds = {
        "on_time": f"h.completed_at IS NOT NULL AND {asof} AND (h.due_at IS NULL OR h.completed_at::date <= h.due_at::date)",
        "late": f"h.completed_at IS NOT NULL AND {asof} AND h.due_at IS NOT NULL AND h.completed_at::date > h.due_at::date",
        "open": f"h.completed_at IS NULL OR NOT ({asof})",
    }
    cond = conds.get(bucket, "true")
    sql = f"""
      WITH worked AS (SELECT DISTINCT a.task_id tid FROM hubstaff_activities a WHERE {' AND '.join(act)})
      SELECT COALESCE(NULLIF(c.parent_task_name,''), h.summary, '—') AS task,
             COALESCE(c.folder_name, c.list_name, '—') AS client,
             to_char(h.due_at, 'YYYY-MM-DD') AS due,
             to_char(h.completed_at, 'YYYY-MM-DD') AS completed,
             COALESCE(NULLIF(c.status,''), h.status, '') AS status
      FROM worked w JOIN hubstaff_tasks h ON h.id = w.tid
      LEFT JOIN clickup_tasks c ON c.task_id = h.remote_id AND COALESCE(c.is_deleted,false)=false
      WHERE ({cond})
      ORDER BY h.due_at DESC NULLS LAST LIMIT 300
    """
    try:
        rows = db.q(sql, p).fillna("").to_dict("records")
        return {"bucket": bucket, "rows": rows, "count": len(rows)}
    except Exception as e:  # noqa
        return {"bucket": bucket, "rows": [], "count": 0, "error": str(e)[:150]}


def _budget_norm(c):
    return re.sub(r"\s*\([fh]\)\s*$", "", str(c).strip(), flags=re.I).strip().lower()


_BUDGET_DDL = """
CREATE TABLE IF NOT EXISTS client_budgets (
  client          text PRIMARY KEY,
  team            text,
  type            text,
  monthly_budget  numeric,
  updated_at      timestamptz DEFAULT now()
)
"""


@lru_cache(maxsize=1)
def client_budgets():
    """{normalized_client -> {budget(monthly hrs), type, team, client}}. Reads the
    editable client_budgets DB table; falls back to client_budgets.csv only if the
    table is missing or empty (first run / no DB write)."""
    out = {}
    # 1) DB table (preferred — editable from the UI).
    if db.has_db():
        try:
            t = db.q("SELECT client, team, type, monthly_budget FROM client_budgets "
                     "WHERE coalesce(monthly_budget,0) > 0")
            for _, r in t.iterrows():
                cn = (r["client"] or "").strip()
                if cn:
                    out[_budget_norm(cn)] = {"budget": float(r["monthly_budget"]),
                                             "type": (r["type"] or "").strip(),
                                             "team": (r["team"] or "").strip(), "client": cn}
            if out:
                return out
        except Exception:  # noqa  (table not created yet)
            pass
    # 2) CSV fallback.
    import csv as _csv
    here = os.path.dirname(__file__)
    path = os.path.join(here, "client_budgets.csv")
    if not os.path.exists(path):
        path = os.path.join(here, "..", "client_budgets.csv")
    if not os.path.exists(path):
        return out
    try:
        with open(path, encoding="utf-8-sig") as fh:
            for r in _csv.DictReader(fh):
                cn = (r.get("client") or "").strip()
                try:
                    bud = float(r.get("monthly_budget") or 0)
                except Exception:
                    bud = 0
                if cn and bud > 0:
                    out[_budget_norm(cn)] = {"budget": bud, "type": (r.get("type") or "").strip(),
                                             "team": (r.get("team") or "").strip(), "client": cn}
    except Exception:  # noqa
        pass
    return out


@app.get("/api/budgets")
def budgets_list(authorization: Optional[str] = Header(None)):
    """All client budget rows (for the management table). Owner only."""
    _require(authorization, "owner")
    try:
        df = db.q_write("SELECT client, team, type, monthly_budget FROM client_budgets ORDER BY client")
        rows = [{"client": r["client"], "team": (r["team"] or ""), "type": (r["type"] or ""),
                 "monthly_budget": float(r["monthly_budget"]) if r["monthly_budget"] is not None else 0.0}
                for _, r in df.iterrows()]
        return {"exists": True, "write": db.has_write(), "count": len(rows), "rows": rows}
    except Exception:
        return {"exists": False, "write": db.has_write(), "count": 0, "rows": []}


@app.post("/api/budgets/save")
def budgets_save(payload: dict, authorization: Optional[str] = Header(None)):
    """Add or update one client budget. Owner only."""
    _require(authorization, "owner")
    if not db.has_write():
        return {"ok": False, "reason": "no_write", "detail": "Set DATABASE_URL_WRITE in backend/.env"}
    client = str((payload or {}).get("client", "")).strip()
    if not client:
        return {"ok": False, "reason": "no_client"}
    try:
        bud = float(payload.get("monthly_budget") or 0)
    except Exception:
        return {"ok": False, "reason": "bad_budget"}
    try:
        db.execute(_BUDGET_DDL)
        db.execute("""
            INSERT INTO client_budgets (client, team, type, monthly_budget, updated_at)
            VALUES (:c, :t, :ty, :b, now())
            ON CONFLICT (client) DO UPDATE
              SET team=:t, type=:ty, monthly_budget=:b, updated_at=now()
        """, {"c": client, "t": (payload.get("team") or "").strip(),
              "ty": (payload.get("type") or "").strip(), "b": bud})
        try:
            db.execute("GRANT SELECT ON client_budgets TO finovate_viewer")
        except Exception:
            pass
        client_budgets.cache_clear()
        return {"ok": True}
    except Exception as e:  # noqa
        return {"ok": False, "reason": "db", "detail": str(e)[:200]}


@app.post("/api/budgets/delete")
def budgets_delete(payload: dict, authorization: Optional[str] = Header(None)):
    """Delete a client budget row. Owner only."""
    _require(authorization, "owner")
    if not db.has_write():
        return {"ok": False, "reason": "no_write"}
    client = str((payload or {}).get("client", "")).strip()
    if not client:
        return {"ok": False, "reason": "no_client"}
    try:
        db.execute("DELETE FROM client_budgets WHERE client = :c", {"c": client})
        client_budgets.cache_clear()
        return {"ok": True}
    except Exception as e:  # noqa
        return {"ok": False, "reason": "db", "detail": str(e)[:200]}


@app.post("/api/budgets/init")
def budgets_init(authorization: Optional[str] = Header(None)):
    """One-time: create client_budgets and seed it from client_budgets.csv. Owner only."""
    _require(authorization, "owner")
    if not db.has_write():
        return {"ok": False, "reason": "no_write", "detail": "Set DATABASE_URL_WRITE in backend/.env"}
    import csv as _csv
    here = os.path.dirname(__file__)
    path = os.path.join(here, "client_budgets.csv")
    if not os.path.exists(path):
        path = os.path.join(here, "..", "client_budgets.csv")
    try:
        db.execute(_BUDGET_DDL)
        n = 0
        if os.path.exists(path):
            with open(path, encoding="utf-8-sig") as fh:
                for r in _csv.DictReader(fh):
                    cn = (r.get("client") or "").strip()
                    if not cn:
                        continue
                    try:
                        bud = float(r.get("monthly_budget") or 0)
                    except Exception:
                        bud = 0
                    db.execute("""INSERT INTO client_budgets (client, team, type, monthly_budget)
                        VALUES (:c,:t,:ty,:b) ON CONFLICT (client) DO NOTHING""",
                        {"c": cn, "t": (r.get("team") or "").strip(),
                         "ty": (r.get("type") or "").strip(), "b": bud})
                    n += 1
        try:
            db.execute("GRANT SELECT ON client_budgets TO finovate_viewer")
        except Exception:
            pass
        client_budgets.cache_clear()
        return {"ok": True, "rows": n}
    except Exception as e:  # noqa
        return {"ok": False, "reason": "db", "detail": str(e)[:300]}


def _client_period_tasks(uids, date_from, date_to):
    """{folder -> {'done','open'}}: distinct ClickUp tasks that had Hubstaff time
    logged in the period (per client), split by closed vs open status."""
    out = {}
    if not db.has_db() or not uids:
        return out
    where = ["coalesce(a.tracked,0) > 0", "a.user_id::text = ANY(:uids)", "a.task_id IS NOT NULL"]
    params = {"uids": list(uids)}
    if date_from:
        where.append("a.date >= :df"); params["df"] = date_from
    if date_to:
        where.append("a.date <= :dt"); params["dt"] = date_to
    # done/open from HUBSTAFF completion (ht.completed_at), not ClickUp status — the
    # ClickUp join only supplies the folder (= client) for grouping.
    closed = "ht.completed_at IS NOT NULL"
    try:
        df = db.q(f"""
            SELECT coalesce(c.folder_name,'') fo,
                   count(DISTINCT CASE WHEN {closed} THEN c.task_id END) done,
                   count(DISTINCT CASE WHEN NOT ({closed}) THEN c.task_id END) opn
            FROM hubstaff_activities a
            JOIN hubstaff_tasks ht ON ht.id = a.task_id
            JOIN clickup_tasks c ON c.task_id = ht.remote_id
            WHERE {' AND '.join(where)}
            GROUP BY 1
        """, params)
    except Exception as e:  # noqa
        print("period tasks failed:", e); return out
    for _, r in df.iterrows():
        fo = r["fo"]
        if fo:
            out[fo] = {"done": int(r["done"] or 0), "open": int(r["opn"] or 0)}
    return out


@app.get("/api/clients")
def clients_list(date_from: Optional[str] = None, date_to: Optional[str] = None,
                 department: Optional[str] = None, atl: Optional[str] = None,
                 employee: Optional[str] = None, client: Optional[str] = None,
                 client_type: Optional[str] = None, billable: Optional[str] = None,
                 status: Optional[str] = None):
    """Real external clients worked in the scope/period — for the Active Clients
    drill-down. Excludes internal buckets (NB Tasks, Training, Accounting …)."""
    members, g = load()
    f = {"date_from": date_from, "date_to": date_to, "department": department, "atl": atl,
         "employee": employee, "client": client, "client_type": client_type,
         "billable": billable, "status": status}
    _, d = apply_filters(members, g, f)
    d = real_clients(d)
    if d is None or d.empty:
        return {"clients": [], "count": 0, "total_hours": 0}
    tasks = _client_period_tasks([str(x) for x in d["user_id"].unique()], date_from, date_to)
    grp = d.groupby("client").agg(hours=("tracked_h", "sum"), billable=("billable_h", "sum"),
                                  people=("user_id", "nunique")).reset_index()
    rows = []
    for r in grp.itertuples():
        ci = tasks.get(r.client, {})
        rows.append({"client": r.client, "type": client_kind(r.client),
                     "hours": round(float(r.hours), 1),
                     "billable_pct": round(float(r.billable) / float(r.hours) * 100, 0) if r.hours else 0,
                     "people": int(r.people),
                     "tasks_done": int(ci.get("done", 0)), "tasks_open": int(ci.get("open", 0))})
    rows.sort(key=lambda x: -x["hours"])
    return {"clients": rows, "count": len(rows), "total_hours": round(float(d["tracked_h"].sum()), 0)}


@app.get("/api/budget")
def budget(date_from: Optional[str] = None, date_to: Optional[str] = None,
           department: Optional[str] = None, atl: Optional[str] = None,
           employee: Optional[str] = None, client: Optional[str] = None,
           client_type: Optional[str] = None, billable: Optional[str] = None,
           status: Optional[str] = None):
    """Per-client Budget vs Actual. Monthly budget (Resource sheet) is scaled to the
    selected period; actual = tracked hours on that client in the period/scope."""
    members, g = load()
    f = {"date_from": date_from, "date_to": date_to, "department": department, "atl": atl,
         "employee": employee, "client": client, "client_type": client_type,
         "billable": billable, "status": status}
    # Over Budget is PER-ACTIVITY on purpose: a client's budget is consumed by anyone
    # who works it, so count cross-team helpers too (unlike the home-team metrics).
    _, d = apply_filters(members, g, f, scope="activity")
    bud = client_budgets()
    empty = {"clients": [], "total_budget": 0, "total_actual": 0, "on_budget": 0, "over": 0, "count": 0}
    if d.empty or not bud:
        return empty
    from datetime import date as _date
    try:
        days = (_date.fromisoformat(date_to) - _date.fromisoformat(date_from)).days + 1 if (date_from and date_to) else 30
    except Exception:
        days = 30
    months = max(days / 30.0, 0.1)

    def _n(c):
        return re.sub(r"\s*\([fh]\)\s*$", "", str(c).strip(), flags=re.I).strip().lower()
    actual = d.groupby("client")["tracked_h"].sum()
    bil_by = d.groupby("client")["billable_h"].sum().to_dict()
    # period-scoped task counts: tasks that had time logged in this window
    tasks = _client_period_tasks([str(x) for x in d["user_id"].unique()], date_from, date_to)
    rows = []
    for cn, act in actual.items():
        b = bud.get(_n(cn))
        if not b:
            continue
        pb = b["budget"] * months
        act = float(act); over = act > pb
        # task completion for this client in the period (closed vs open)
        ci = tasks.get(cn, {})
        tdone = int(ci.get("done", 0)); topen = int(ci.get("open", 0))
        ttot = tdone + topen
        # Client Health Score: budget adherence (50%) + task completion (30%)
        # + billable share (20%) -> A–F grade.
        bilpct = (float(bil_by.get(cn, 0)) / act * 100) if act else 0.0
        budget_score = 100.0 if not over else max(0.0, 100.0 - ((act - pb) / pb * 100 if pb else 100))
        task_score = (tdone / ttot * 100) if ttot else 70.0
        hscore = 0.5 * budget_score + 0.3 * task_score + 0.2 * bilpct
        rows.append({"client": cn, "type": b["type"], "team": b["team"],
                     "budget": round(pb, 1), "actual": round(act, 1),
                     "variance": round(act - pb, 1), "over": over,
                     "pct": round(act / pb * 100, 0) if pb else 0,
                     "tasks_total": ttot, "tasks_open": topen, "tasks_done": tdone,
                     "billable_pct": round(bilpct, 0),
                     "health": grade_letter(hscore), "health_score": round(hscore)})
    rows.sort(key=lambda x: -x["actual"])
    tb = sum(r["budget"] for r in rows); ta = sum(r["actual"] for r in rows)
    over = sum(1 for r in rows if r["over"])
    return {"clients": rows, "total_budget": round(tb, 0), "total_actual": round(ta, 0),
            "on_budget": len(rows) - over, "over": over, "count": len(rows)}


@app.get("/")
def root():
    return {"status": "ok", "service": "Finovate Operations Command Center",
            "source": "supabase" if db.has_db() else "csv",
            "write": db.has_write(),
            "ai": bool(os.environ.get("GEMINI_API_KEY", "").strip())}
