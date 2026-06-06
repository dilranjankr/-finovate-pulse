# Deploy — Finovate Pulse

Two services:
- **backend** — FastAPI (port 8000), reads Supabase + Gemini
- **frontend** — Next.js (port 3000), calls the backend

Secrets are **never** committed — they live in `.env` (gitignored) locally and in
Coolify's Environment Variables tab in production.

---

## A. Push to GitHub

```bash
# from the app/ folder (this is the repo root)
cd app
git init
git add .
git commit -m "Finovate Pulse — operations command center"

# create an EMPTY repo on github.com first (no README), then:
git branch -M main
git remote add origin https://github.com/<you>/<repo>.git
git push -u origin main
```

Before pushing, confirm no secret is staged:
```bash
git status --short        # .env files must NOT appear
git check-ignore backend/.env   # should print the path (= ignored)
```

---

## B. Deploy on Coolify (local)

1. **New Resource → Docker Compose** (or "Application" → Build Pack: Docker Compose).
2. **Source**: connect the GitHub repo (or paste the repo URL). Branch: `main`.
3. **Base directory / Compose path**: `docker-compose.yaml` is at the repo root (`app/`),
   so set base directory to `/` and compose file to `docker-compose.yaml`.
4. **Environment Variables** (Coolify → the resource → *Environment Variables*):
   ```
   DATABASE_URL=postgresql://finovate_viewer.<ref>:<pass>@<host>:5432/postgres
   GEMINI_API_KEY=<your key>
   GEMINI_MODEL=gemini-3.1-flash-lite
   ALLOWED_ORIGINS=*
   NEXT_PUBLIC_API_URL=<public backend url>
   ```
   - `NEXT_PUBLIC_API_URL` must be reachable from the **browser** and is needed at
     **build time** — mark it as a *Build Variable* in Coolify so it's baked into the
     frontend bundle. Locally this is usually `http://<server-ip>:8000`.
5. **Domains**: give the `frontend` service your domain (e.g. `pulse.localhost` or an IP),
   and the `backend` service its own domain/port (must match `NEXT_PUBLIC_API_URL`).
6. **Deploy**. First backend request is slow (~30–50s: it aggregates ~286k rows once,
   then caches for 1 hour).

### Quick local test without Coolify
```bash
cd app
cp .env.example .env     # fill in real values
docker compose up --build
# frontend → http://localhost:3000   backend → http://localhost:8000
```

---

## Notes
- Backend uses a **read-only** Supabase role — the main DB password is untouched.
- Without `GEMINI_API_KEY`, the Ask-AI panel falls back to the built-in rule engine.
- The frontend build needs `output: "standalone"` (already set in `next.config.ts`).
