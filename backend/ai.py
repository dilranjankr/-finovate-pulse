"""
Gemini-powered assistant for Finovate Pulse — now AGENTIC.

Two-step flow:
  1) ROUTER: given the live summary CONTEXT + the database SCHEMA, the model either
     answers directly (when the summary already has the facts) OR returns a single
     read-only SQL SELECT to fetch exactly what's needed.
  2) FINAL: if SQL was run, the rows are fed back and the model writes the answer
     with a chart + a one-line insight.

All SQL is executed through a guarded read-only runner passed in by the caller
(see main.py _ai_run_sql), so this module never touches the DB directly.
Returns the shape the frontend renders: {ok, text, kind, bars, donut, insight}.
"""
import json
import os
import urllib.request
import urllib.error

DEFAULT_MODEL = "gemini-3.1-flash-lite"
PALETTE = ["#203070", "#0f9043", "#2f6fbf", "#d9882a", "#37a85f", "#bd8616", "#7b3fc0", "#0d9488"]
DONUT = ["#203070", "#0f9043", "#2f6fbf", "#d9882a", "#37a85f", "#bd8616"]

# ---- database schema given to the model so it can write correct SQL ----------
SCHEMA_DOC = """READ-ONLY Postgres. Units: hubstaff_activities.tracked is in SECONDS (SUM(tracked)/3600.0 = hours); keka *_min columns are minutes (/60.0 = hours).

hubstaff_activities(date DATE, user_id, project_id, task_id, tracked INT seconds, billable BOOL, manual INT, idle INT, user_name, project_name, task_name) -- raw time tracking, one row per user/task/day. The main hours source.
hubstaff_tasks(id, remote_id (= clickup_tasks.task_id), summary (task name), status, assignee_ids JSONB (array of hubstaff user_ids as text), due_at TIMESTAMP, completed_at TIMESTAMP).
hubstaff_members(user_id, name, email, status, job_title).
hubstaff_projects(id, name, status, billable, client_id, budget_hours).
clickup_tasks(task_id, parent_task_name, subtask_name, status, priority, due_date, date_done, time_estimate_hrs, time_tracked_hrs, assignees TEXT, list_name, folder_name (= CLIENT name), space_name (= TEAM / ops space), monthly_budget, task_type, critical BOOL, "Billable", archived). folder_name = client, space_name = team.
keka_attendance(month 'YYYY-MM', emp_no, emp_name, department, work_date DATE, status, shift, effective_min, total_min, overtime_min, late_by_min, short_eff_min, uploaded_by). effective_min=0 => absent or week-off (status like 'WO%').
employee_mapping(hubstaff_name, hubstaff_user_id, hr_full_name, hr_employee_no, status, department, team, total_hours, notes) -- bridges Hubstaff name -> HR identity & current home team.
team_history(hubstaff_user_id, team, department, effective_from DATE, reason) -- dated team transfers.
client_budgets(client, team, type ('Hourly'/'Fixed'), monthly_budget (hours/month)).
xero_invoices(business_name, invoice_date, due_date, total_amount, amount_paid, amount_due, status, overdue_by_days, last_payment_date).
stripe_charges(date, business_name, payment_amount, fee, net_amount, status, amount_refunded).
zoho_invoices(...). xero_customers(business_name, ...). missive_records(communication_date, subject, sentiment, client_complaining BOOL, client_following_up BOOL, priority, module_areas) -- client communications.

JOINS / identity:
  hubstaff_activities.user_id and hubstaff_members.user_id are INTEGER; employee_mapping.hubstaff_user_id and team_history.hubstaff_user_id are TEXT. So CAST when joining: hubstaff_activities a JOIN employee_mapping e ON e.hubstaff_user_id = a.user_id::text.
  activities -> client/team: activities.task_id = hubstaff_tasks.id ; hubstaff_tasks.remote_id = clickup_tasks.task_id ; use clickup_tasks.folder_name (client) / space_name (team).
  keka_attendance has no user_id; join it to people by name: keka_attendance.emp_name = employee_mapping.hr_full_name (or lower(trim(...)) on both).
  A person's home team/department = employee_mapping.team / .department (current).
Tips: always alias SUM(tracked)/3600.0 AS hours and round it. Filter dates with `date BETWEEN '2026-04-01' AND '2026-04-30'`. Today is 2026-06-16. Group by name/team/client. Names live in employee_mapping.hr_full_name or hubstaff_members.name. For per-person matches, employee_mapping.hr_full_name is the display name (e.g. 'Aashima Jain'). Use ILIKE for fuzzy name matches. When you use a CTE, you may freely SELECT FROM it."""

# ---- step 1: router (answer directly, or emit SQL) ---------------------------
ROUTER_SCHEMA = {
    "type": "OBJECT",
    "properties": {
        "action": {"type": "STRING", "enum": ["answer", "query"]},
        "sql": {"type": "STRING"},
        "text": {"type": "STRING"},
        "insight": {"type": "STRING"},
        "chart_type": {"type": "STRING", "enum": ["bar", "donut", "none"]},
        "chart_data": {
            "type": "ARRAY",
            "items": {"type": "OBJECT",
                      "properties": {"label": {"type": "STRING"}, "value": {"type": "NUMBER"}},
                      "required": ["label", "value"], "propertyOrdering": ["label", "value"]},
        },
    },
    "required": ["action"],
    "propertyOrdering": ["action", "sql", "text", "insight", "chart_type", "chart_data"],
}

FINAL_SCHEMA = {
    "type": "OBJECT",
    "properties": {
        "text": {"type": "STRING"},
        "insight": {"type": "STRING"},
        "chart_type": {"type": "STRING", "enum": ["bar", "donut", "none"]},
        "chart_data": {
            "type": "ARRAY",
            "items": {"type": "OBJECT",
                      "properties": {"label": {"type": "STRING"}, "value": {"type": "NUMBER"}},
                      "required": ["label", "value"], "propertyOrdering": ["label", "value"]},
        },
    },
    "required": ["text", "chart_type"],
    "propertyOrdering": ["text", "insight", "chart_type", "chart_data"],
}

ROUTER_SYSTEM = (
    "You are 'Pulse AI', the analyst inside Finovate's Operations Command Center (bookkeeping firm; "
    "teams do client work tracked in Hubstaff & ClickUp, attendance in Keka, billing in Xero/Stripe). "
    "You are given a live summary CONTEXT (current filtered view) and the database SCHEMA.\n"
    "Decide how to answer the USER QUESTION:\n"
    "- If the CONTEXT clearly already contains the exact facts/numbers needed, set action='answer' and fill "
    "text (+ insight + a chart). \n"
    "- Otherwise set action='query' and write ONE read-only Postgres SELECT (or WITH...SELECT) over the SCHEMA "
    "tables that returns exactly the rows needed (already aggregated, sorted, and LIMITed to <=50). Use ONLY the "
    "tables/columns in the SCHEMA. Never write to the DB. Prefer querying for anything specific: a named person, "
    "client, team, month, budget, attendance, invoice, task, or trend not visible in the summary.\n"
    "Write valid Postgres. Hours = SUM(hubstaff_activities.tracked)/3600.0."
)

FINAL_SYSTEM = (
    "You are 'Pulse AI'. The USER asked a question; you ran a SQL query and got RESULT ROWS (real database data). "
    "Answer using ONLY those rows. Rules:\n"
    "- 'text': 1-3 short sentences with the concrete answer, using the real names/numbers from the rows.\n"
    "- 'insight': ONE extra sentence — a useful observation, comparison, or recommendation a manager would act on "
    "(e.g. an outlier, a risk, a gap). Keep it sharp, not generic.\n"
    "- Include a chart ('bar' for rankings/comparisons, 'donut' for parts-of-a-whole) with 3-10 points taken "
    "straight from the rows, visualizing the SAME items your text discusses. Use 'none' only for a single fact.\n"
    "- Round hours/numbers sensibly. Never invent values beyond the rows."
)

ANSWER_SYSTEM = (
    "You are 'Pulse AI'. Answer the USER QUESTION from the CONTEXT JSON only — never invent numbers. "
    "'text': 1-3 short sentences with real names/numbers. 'insight': one sharp, actionable observation. "
    "Add a chart ('bar'/'donut', 3-10 points from context) for any comparison/ranking/breakdown; 'none' for "
    "greetings or single facts."
)


def _api(key, model, system, prompt, schema):
    url = (f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={key}")
    body = {
        "systemInstruction": {"parts": [{"text": system}]},
        "contents": [{"role": "user", "parts": [{"text": prompt}]}],
        "generationConfig": {"temperature": 0.2, "maxOutputTokens": 2048,
                             "responseMimeType": "application/json", "responseSchema": schema,
                             "thinkingConfig": {"thinkingBudget": 0}},
    }
    req = urllib.request.Request(url, data=json.dumps(body).encode("utf-8"),
                                headers={"Content-Type": "application/json"}, method="POST")
    with urllib.request.urlopen(req, timeout=30) as resp:
        payload = json.loads(resp.read().decode("utf-8"))
    cand = payload["candidates"][0]
    parts = cand.get("content", {}).get("parts", [])
    raw = "".join(p.get("text", "") for p in parts if isinstance(p, dict) and p.get("text"))
    return _parse_json(raw)


def _to_frontend(obj: dict, sql: str | None = None) -> dict:
    text = (obj.get("text") or "").strip() or "Here's what I found."
    insight = (obj.get("insight") or "").strip()
    ctype = obj.get("chart_type") or "none"
    rows = obj.get("chart_data") or []
    rows = [r for r in rows if isinstance(r, dict) and r.get("label") is not None][:10]
    out = {"ok": True, "text": text, "kind": "none"}
    if insight:
        out["insight"] = insight
    if sql:
        out["sql"] = sql
    if ctype == "bar" and rows:
        out["kind"] = "bar"
        out["bars"] = [{"label": str(r["label"]), "value": float(r.get("value") or 0),
                        "color": PALETTE[i % len(PALETTE)]} for i, r in enumerate(rows)]
    elif ctype == "donut" and rows:
        data = [{"name": str(r["label"]), "value": float(r.get("value") or 0)} for r in rows]
        total = sum(d["value"] for d in data)
        out["kind"] = "donut"
        out["donut"] = {"data": data, "colors": DONUT,
                        "center": {"value": (f"{round(total):,}" if total else "0"), "label": "Total"}}
    return out


def answer(question: str, context: dict, sql_runner=None) -> dict:
    """Agentic answer. sql_runner(sql)->{rows|error} is the guarded DB runner."""
    key = os.environ.get("GEMINI_API_KEY", "").strip()
    if not key:
        return {"ok": False, "reason": "no_key"}
    model = os.environ.get("GEMINI_MODEL", "").strip() or DEFAULT_MODEL
    ctx_json = json.dumps(context, ensure_ascii=False)
    # Step 1 — router
    try:
        if sql_runner is None:
            obj = _api(key, model, ANSWER_SYSTEM, f"CONTEXT:\n{ctx_json}\n\nUSER QUESTION:\n{question}", FINAL_SCHEMA)
            return _to_frontend(obj or {})
        router = _api(key, model, ROUTER_SYSTEM,
                      f"SCHEMA:\n{SCHEMA_DOC}\n\nCONTEXT (current summary):\n{ctx_json}\n\nUSER QUESTION:\n{question}",
                      ROUTER_SCHEMA)
    except urllib.error.HTTPError as e:
        return {"ok": False, "reason": f"http_{e.code}", "detail": e.read().decode("utf-8", "ignore")[:300]}
    except Exception as e:  # noqa: BLE001
        return {"ok": False, "reason": "network", "detail": str(e)[:200]}
    if not router:
        return {"ok": False, "reason": "parse"}
    if router.get("action") != "query" or not (router.get("sql") or "").strip():
        return _to_frontend(router)
    # Step 2 — run the SQL, feed rows back
    run = sql_runner((router.get("sql") or "").strip())
    if run.get("error"):
        # Let the model gracefully explain / fall back to the summary.
        try:
            obj = _api(key, model, ANSWER_SYSTEM,
                       f"CONTEXT:\n{ctx_json}\n\nNOTE: a database lookup failed ({run['error']}). "
                       f"Answer from CONTEXT if possible, else say you couldn't fetch it.\n\nUSER QUESTION:\n{question}",
                       FINAL_SCHEMA)
            return _to_frontend(obj or {})
        except Exception:  # noqa: BLE001
            return {"ok": False, "reason": "sql", "detail": run["error"]}
    rows_json = json.dumps(run.get("rows", [])[:60], ensure_ascii=False, default=str)
    try:
        obj = _api(key, model, FINAL_SYSTEM,
                   f"USER QUESTION:\n{question}\n\nSQL RUN:\n{run.get('sql', '')}\n\n"
                   f"RESULT ROWS (JSON, {run.get('row_count', 0)} total):\n{rows_json}",
                   FINAL_SCHEMA)
    except Exception as e:  # noqa: BLE001
        return {"ok": False, "reason": "final", "detail": str(e)[:200]}
    return _to_frontend(obj or {}, sql=run.get("sql"))


def _parse_json(raw: str):
    """Tolerant JSON parse: strips markdown fences and repairs truncated output."""
    s = (raw or "").strip()
    if s.startswith("```"):
        s = s.split("```", 2)[1] if s.count("```") >= 2 else s.strip("`")
        if s.lstrip().lower().startswith("json"):
            s = s.lstrip()[4:]
    s = s.strip()
    try:
        return json.loads(s)
    except Exception:  # noqa: BLE001
        pass
    start = s.find("{")
    if start == -1:
        return None
    depth, instr, esc = 0, False, False
    for i in range(start, len(s)):
        ch = s[i]
        if instr:
            if esc:
                esc = False
            elif ch == "\\":
                esc = True
            elif ch == '"':
                instr = False
            continue
        if ch == '"':
            instr = True
        elif ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                try:
                    return json.loads(s[start:i + 1])
                except Exception:  # noqa: BLE001
                    return None
    return None
