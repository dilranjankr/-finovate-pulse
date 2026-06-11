# Finovate Insight — Data Documentation
**Hubstaff + ClickUp Operations Dashboard**
_Where every number comes from, and every data problem we found._

---

## 1. Data ka source (kahaan se aata hai)

Dashboard 2 systems ko jodta hai, ek Supabase (Postgres) database me:

| System | Kya deta hai | Tables |
|---|---|---|
| **Hubstaff** | Time / ghante (kisne kitna track kiya) | `hubstaff_activities`, `hubstaff_projects`, `hubstaff_clients`, `hubstaff_tasks`, `hubstaff_members` |
| **ClickUp** | Structure (Department / Team / Client / tasks) | `clickup_tasks` |

**Total tracked time:** ~350,853 hours · **Employees:** 230 · **Clients:** 333 · **Teams:** 19 · **Departments:** ~13

---

## 2. Har cheez kaise banti hai (derivation / lineage)

| Field | Source | Rule |
|---|---|---|
| **Department** | ClickUp `space_name` | `" - "` se pehle ka hissa. e.g. `Operations - Titans` → **Operations** |
| **Team** | ClickUp `space_name` | poora space naam (ya `" - "` ke baad ka hissa) |
| **Client** | ClickUp `folder_name` | folder ka naam = client |
| **Client type** | ClickUp folder naam | marker se: `(F)` = Fixed, `(H)` = Hourly, kuch nahi = Project |
| **Employee** | Hubstaff `activities.user_name` | ClickUp `assignees` se naam/email match |
| **Hours** | Hubstaff `activities.tracked` | seconds ÷ 3600 |
| **Billable / Non-billable** | task/project naam | "NB" marker = non-billable |

### Metric formulas
- **Utilization** = tracked ÷ (din × 8h), 100% pe capped
- **Activity** = overall ÷ tracked
- **Productivity** = billable ÷ total (billable share)
- **Grade** = 0.4×Utilization + 0.3×Productivity + 0.3×Task-completion

### Hubstaff ↔ ClickUp ka asli link (sabse important)
- **`hubstaff_tasks.remote_id` = `clickup_tasks.task_id`** (ClickUp integration `189908`)
- Yani Hubstaff me ClickUp ka task ID stored hai. Match hone par task **naam 99.97% same**.
- ClickUp me Hubstaff ka ID **nahi** hai — link ek-tarfa (Hubstaff → ClickUp).

---

## 3. Matching coverage (kitna time ClickUp se judta hai)

| Category | All-time | 2026 |
|---|---|---|
| 🟢 Task + ClickUp se **matched** | 53.4% | 61.6% |
| 🔵 **Project pe track** (koi task nahi) | 20.8% | 30.7% |
| 🟠 Task hai par ClickUp se **unmatched** | 25.8% | 7.8% |

**Note:** jab task pe ClickUp ID hota hai, woh ~89% match karta hai (2026). Overall isliye kam hai kyunki ~30% time bina task ke seedha project pe track hota hai.

---

## 4. Saari Problems (data se verified)

### A. ClickUp side
1. **Blank Space label** — kuch teams (jaise **Operations - Bravix**, ~23,321 h) ke tasks ClickUp me hain par `space_name` khaali → Department/Team map nahi hota.
2. **Naam mismatch / variants** — `Ledger Labs-`, `Ledger Labs, Inc.`, `marketing` (lowercase) jaise naam standard nahi.
3. **Deleted tasks** — ~51,000 h ke ClickUp tasks delete ho chuke (zyadatar 2023-24 purana data).

### B. Hubstaff side
4. **Projects me Client linked nahi** — sab projects `(no client)`; client ka naam sirf project ke naam me.
5. **Member names blank** — asli naam `activities.user_name` me, `members.name` khaali.
6. **Galat 8-char task IDs** — 520 tasks, 0 match.
7. **21% time pe koi task nahi** — seedha project pe tracking (Training, Emailing, Admin, NB).

### C. Dashboard ki apni logic
8. **Attribution double-counting (sabse bada):** abhi har employee ke **saare ghante uske ek "primary" folder/team** me daal diye jaate hain. Multi-team employee ka poora time **har** team me ginta hai → team totals **3.4× tak inflated**, department totals **2.3× inflated**.
9. **Utilization galat denominator** — "active days × 8h" use hota hai; company rule (Mon-Fri + mahine ka pehla Saturday) ke hisaab se "working days × 8h" hona chahiye.
10. **Billable/Non-billable** sirf naam me "NB" se decide — fragile.

### D. Specific findings
- **Archived Projects (65,724 h):** asli department nahi — purane/band client projects ka store-room. 168 me se **165 clients band**, sirf 3 active. Andar **"Emailing & Training" (17,931 h)** actually internal recurring kaam hai jo galti se yahan pada hai.
- **Operations - Bravix:** asli active 7th Operations team (~28k h, abhi tak active), par ClickUp me iske tasks ka Space blank → "missing" dikhta tha.

---

## 5. Fix / Action Plan

| Phase | Kaam | Owner | Asar |
|---|---|---|---|
| **1** | Attribution **task-ID link se rebuild** (har ghanta asli team/client pe) + utilization working-days pe | Dashboard (code) | Numbers turant sahi |
| **2** | ClickUp me **blank Space bharo** (Bravix se shuru), naam standardize, tasks delete mat karo | ClickUp admin | 53% → ~76% match |
| **3** | Hubstaff me **projects ko client se link**, member names bharo, 8-char ID check | Hubstaff admin | Client-data clean |
| **4** | Recurring kaam (Training/Emailing/Admin) ke liye **standing ClickUp tasks** banao | Team leads | 31% project-level ghatega |

**Target:** abhi 53% exact match → Phase 1+2 ke baad **~90%**, asli client hours, working-day utilization.

---

## 6. Proof (verified examples)

- **Match link:** 45,113 Hubstaff tasks me se 35,428 ClickUp se match, 99.97% same naam.
- **Double-counting:** sab team totals ka jod = **1,204,967 h** (OLD) vs actual **350,853 h** → 3.4× inflated.
- **Sohan Singh (multi-team):** OLD me har team me poora 6,874 h dikhता tha; NEW me asli split — Titans 4,275 h, Archived 1,344 h, Alliance 680 h... jod = 6,874 h (no double-count).
- **Utilization:** Sohan March — active-days 100% vs working-days 94% (jo 2 din miss kiye woh dikhta hai).

---

_Generated by Finovate Insight · Source: Hubstaff (time) + ClickUp (structure) · Supabase Postgres._
