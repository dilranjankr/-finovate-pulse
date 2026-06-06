# Workforce Analytics

Professional workforce productivity dashboard.
**Backend:** FastAPI + pandas · **Frontend:** Next.js + Recharts.

```
app/
├─ backend/    FastAPI API (reads Hubstaff CSV exports, computes KPIs, server-side filtering)
│  ├─ main.py
│  └─ hierarchy_mapping.csv   (optional — fill to enable Dept/Team/ATL/TL filters)
└─ frontend/   Next.js dashboard (filters, KPI cards, charts, employee table)
```

## Run locally

**1. Backend (terminal 1):**
```bash
cd app/backend
python -m pip install fastapi uvicorn pandas
uvicorn main:app --reload --port 8000
```
API: http://127.0.0.1:8000  ·  docs: http://127.0.0.1:8000/docs

**2. Frontend (terminal 2):**
```bash
cd app/frontend
npm install
npm run dev
```
Open http://localhost:3000

> The frontend reads the API from `NEXT_PUBLIC_API_URL` (defaults to `http://127.0.0.1:8000`).

## Filters
From/To date · Company · Department · Team · ATL · TL · Role · Employee — all run server-side.

## KPIs
Total Hours · Avg Activity % · Avg Productivity · Billable Hours · Active Employees · Avg Hrs/Employee.

## Enabling Department / Team / ATL / TL
These fields are not in the Hubstaff export. Fill `backend/hierarchy_mapping.csv`
with columns: `user_id,name,department,team,atl,tl` and restart the backend.
A pre-filled template is generated at `webapp/hierarchy_mapping_template.csv`.

## Next steps
1. Hierarchy mapping → real Dept/Team/ATL/TL filters
2. Supabase — move data into a secure Postgres DB + auth (row-level security)
3. Hubstaff + ClickUp APIs — automated daily sync (no manual CSV)
4. Deploy — Vercel (frontend) + Render/Railway (backend) with a login wall
