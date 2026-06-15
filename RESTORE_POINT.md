# Restore Point — Finovate Pulse (snapshot 2026-06-15)

This is a **stable checkpoint**. If you ever need to come back to exactly this
working state, this document tells you how, and what the app does as of now.

- **Git tag:** `stable-2026-06-15`
- **Commit:** `80b8446` (branch `main`)
- **Remote:** https://github.com/dilranjankr/-finovate-pulse
- **Local archive:** `../finovate-pulse-backup-2026-06-15.zip` (code only, no
  node_modules / .next / .git / secrets)

---

## 1. How to return to this exact point

**From the existing repo:**
```bash
cd app
git fetch --tags
git checkout stable-2026-06-15      # detached HEAD at the snapshot
# or branch off it:
git checkout -b restore-jun15 stable-2026-06-15
```

**Fresh clone:**
```bash
git clone https://github.com/dilranjankr/-finovate-pulse.git
cd -finovate-pulse
git checkout stable-2026-06-15
```

**From the local zip** (if GitHub is unavailable): unzip
`finovate-pulse-backup-2026-06-15.zip`, then follow §4 (run locally). You still
need `backend/.env` (not in the zip — see §3) and the Supabase database (§5).

---

## 2. What the app is

**Finovate Pulse** — an operations-intelligence dashboard for **Finovate
Consulting** (bookkeeping for US clients). It unifies three sources:

- **Hubstaff** — time tracking (the hours of truth)
- **ClickUp** — tasks (planned/assigned work; space = team, folder = client)
- **Keka** — HR attendance (real office hours, OT, short hours, leave)

into one view: utilization, productivity, task delivery, budgets, workforce, and
per team / department / client / employee drill-downs.

**Two services:**
- `backend/` — FastAPI (port 8000), reads Supabase + optional Gemini AI
- `frontend/` — Next.js 16 (port 3000), calls the backend

---

## 3. Secrets — `backend/.env` (NOT in git, NOT in the zip)

Recreate from `.env.example`. Keys it needs:
```
DATABASE_URL=postgresql://finovate_viewer.<ref>:<pass>@<host>:5432/postgres   # read
DATABASE_URL_WRITE=postgresql://postgres.<ref>:<pass>@<host>:5432/postgres     # write (mapping/budgets/keka edits)
JWT_SECRET=<long random>                  # login sessions
OWNER_EMAIL=admin@finovate.com
OWNER_PASSWORD=owner@123                   # CHANGE after first login
GEMINI_API_KEY=<optional, for Ask-AI>
GEMINI_MODEL=gemini-3.1-flash-lite
ALLOWED_ORIGINS=*
PUBLIC_APP_URL=<dashboard url, for invite links>
SMTP_HOST/SMTP_PORT/SMTP_USER/SMTP_PASS/SMTP_FROM   # optional, for email invites/digests
```
Frontend build needs `NEXT_PUBLIC_API_URL` (the browser-reachable backend URL).

---

## 4. Run locally

**Backend** (Windows, from `app/backend`):
```bash
pip install -r requirements.txt
python -m uvicorn main:app --host 127.0.0.1 --port 8000
```
Gotcha: only ONE uvicorn should own port 8000. Before restarting, kill all:
`Get-Process -Name python | Stop-Process -Force` (stale processes serve old code).
First request is slow (~30–50s: aggregates ~286k activity rows, then caches 1h).

**Frontend** (from `app/frontend`):
```bash
npm install
npm run dev      # http://localhost:3000
# production check: npm run build
```

**Docker (both):** `docker compose up --build` (see `DEPLOY.md`). Deploy is on
**Coolify** off the GitHub `main` branch — see `DEPLOY.md`.

---

## 5. Database state (Supabase) — IMPORTANT for a fresh DB

The code is in git, but two pieces of state live in the **database** and are NOT
recreated by checking out the code. If you point at the SAME Supabase, they're
already there. If you point at a FRESH database, recreate them:

1. **`employee_mapping.clickup_user_id`** — the stable Hubstaff↔ClickUp identity
   link (121 employees mapped). Rebuild with:
   ```bash
   cd backend && python link_clickup.py --write
   ```
   (co-occurrence of tasks linked in both systems + unambiguous name match).

2. **`client_budgets` table** — per-client monthly budget hours (115 clients).
   Recreate by calling, as owner: `POST /api/budgets/init` (seeds from
   `backend/client_budgets.csv`), or add rows via the UI → owner menu → "Client
   budgets". Without it, `client_budgets()` falls back to the CSV.

`employee_mapping` itself is seeded via `POST /api/mapping/init` (from
`employee_mapping.csv`). Keka attendance is uploaded per-month via the UI (owner
menu → "Keka attendance") or `POST /api/keka/upload`.

---

## 6. Key data tables

**In use:** `hubstaff_activities` (tracked time), `hubstaff_tasks`
(assignee_ids + remote_id→ClickUp), `clickup_tasks` (space/folder/status/
assignees), `keka_attendance` (effective/OT/short/late per day),
`employee_mapping` (HR identity + clickup_user_id), `client_budgets`,
`hubstaff_projects`, `hubstaff_members`, `app_users`/`sessions` (auth).

**Available but NOT yet wired** (the roadmap — see §9): `xero_invoices` (7,633),
`stripe_charges` (3,884), `zoho_invoices` (886), `xero_customers` (1,294) →
real revenue/profitability; `missive_records` (265) → client comms.
Empty/future: `quality_metrics`, `response_quality_scores`, `meeting_records`,
`client_records`, `feedback_log`, `sop_proposals`, `knowledge_sources`.

---

## 7. Metric definitions (how the numbers are computed)

- **Utilization** = tracked hours ÷ REAL office hours (Keka effective; falls back
  to working-days × 8h when no attendance). Capped at 100%.
- **Activity** = overall (keyboard+mouse) hours ÷ tracked × 100.
- **Productivity** = billable share = billable ÷ tracked × 100.
- **Billable vs non-billable** = from the `NB …` marker on the linked task.
- **Task Delivery** (on-time/late/overdue) = from `hubstaff_tasks` due_at vs
  completed_at, as-of period end.
- **Assigned tasks** (per employee) = HUBSTAFF first (hubstaff_tasks.assignee_ids,
  live = active/completed), ClickUp fallback via clickup_user_id when none; when a
  date range is set, only tasks DUE in the period.
- **Client budget** = `client_budgets` monthly hours × (period days ÷ 30); actual
  = tracked hours on that client. Budget Burn-up = cumulative actual vs linear
  budget pace.
- **Workforce / Short hours** = Keka, present days only (effective_min > 0);
  week-offs/absences excluded. **Late** = days > 30 min late (30-min shift buffer).
- **Per-activity team/dept** = the ClickUp space the work was done in (the 7 OPS
  teams keep per-activity; non-OPS spaces roll to the worker's HR home team).
- **Team filter** = per-activity (everyone who worked ON that team shows). The
  **employee dropdown** stays HR-home-members only. **By Team / By Department**
  regroup by the contributor's HOME team/dept when a team/dept is filtered, so
  cross-team helpers surface. Clicking a By Team bar opens the team **scorecard
  modal**, scoped to the active filter.

(See also `CALCULATIONS.md` and `DATA_DOCUMENTATION.md`.)

---

## 8. Auth

Single-owner bootstrapped from `OWNER_EMAIL`/`OWNER_PASSWORD`; bcrypt + JWT.
Invite-based: owner invites users (owner menu → "Users & access"). Roles:
owner / admin / developer / user. **Change the owner password after first login.**

---

## 9. Roadmap (discussed, not yet built)

Top opportunities (data already in DB):
1. **Revenue & Profitability** — real revenue per client (xero/stripe/zoho),
   effective hourly rate, profit margin, realization rate, AR aging,
   revenue/employee. Biggest gap for a services firm.
2. **Client health / churn-risk** score; revenue concentration.
3. **Weekly email digest + proactive alerts** (SMTP already configured).
Others: quality/SLA (estimate accuracy, rework, cycle time), burnout/attrition
risk, capacity forecast, PDF scorecards, saved views, goals/targets, deeper AI
assistant.

---

## 10. Change log up to this snapshot (recent → older)

- `80b8446` Team click opens scorecard modal, scoped to active filter
- `aba1aa7` By Team drill respects active employee filter
- `9e54efd` Hide 0h bars; cross-team bar drills to within-filter contribution
- `5bb975d` By Team/Dept regroup by contributor home team when team filtered
- `3eb0a59` Late = >30-min buffer; per-employee tasks scoped to due-in-period
- `b153564` Client budgets editable in DB + UI; unmapped staff under Unassigned
- `a20b41e` Team/department filter = per-activity (cross-team contributors show)
- `c1f16a7` Short hours = present days only (no week-offs/absences)
- `585c188`/`0d76aeb` Performance-trend tooltip: follows point, solid white
- `a449f9c` Workforce tile captions; trend hover fix
- `7c9ac59` Tasks Hubstaff-first, ClickUp fallback
- `5e9fbfe` Stable ClickUp↔Hubstaff identity map (employee_mapping.clickup_user_id)
- `f4d4003` Assigned tasks keyed on Hubstaff id, not ClickUp name
- (earlier) Keka-based utilization, Performance Trend, Workforce, Budget Burn-up,
  per-activity attribution, auth, employee mapping admin.
