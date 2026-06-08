# Finovate Insight — Calculation Reference

Every metric shown on the dashboard, and exactly how it is computed.
All formulas are taken directly from `backend/main.py`.

> **Data sources**
> - **Hubstaff activities** (per user, per day): `tracked`, `overall`, `billable`, `productivity` — all in *seconds* except productivity (0–100 score).
> - **Hubstaff members**: `name`, `pay_rate`, `role`.
> - **Hubstaff projects / clients**: names, `budget_type`.
> - **ClickUp tasks**: `status`, `priority`, `assignees`, `space_name`, `folder_name`, task name.
>
> **Constants:** `SEC = 3600` (seconds → hours). Daily capacity = **8 hours / person-day**.

---

## 1. Hours

| Metric | Formula |
|---|---|
| **Tracked hours** | `tracked_h = tracked_seconds / 3600` |
| **Active hours** (overall) | `overall_h = overall_seconds / 3600` |
| **Billable hours** | `billable_h = tracked_h` if the row is *billable*, else `0` |
| **Non-billable hours** | `non_billable_h = tracked_h` if *not billable*, else `0` |
| **Total hours** | `Σ billable_h + Σ non_billable_h` (= total tracked) |
| **Billable %** | `billable / total × 100` |
| **Avg hours / employee** | `total / number_of_people` |

**What makes a row "billable":** time in an internal/overhead department is non-billable. A row is billable when its
**department ∉ {HR, Admin, Marketing, Archived Projects}**. (Hubstaff marks all time billable and the ClickUp billable flag is empty, so we classify by department — the meaningful business definition.)

> Note: at the **task** level, a task is treated as **Non-Billable** when its name contains the standalone token **"NB"** (regex `(?<![a-z])nb(?![a-z])`). This drives the Billable/NB columns in *Tasks by Employee*, separate from the hours classification above.

---

## 2. Person-days & Capacity

| Term | Meaning |
|---|---|
| **empdays** (`ud`) | Count of distinct **(employee, date)** pairs = total person-days worked in the selection |
| **Capacity / Budget** | `empdays × 8` hours — the theoretical maximum if everyone worked a full 8h day |
| **People** | Count of distinct employees in the selection |

---

## 3. Core performance metrics

| Metric | Formula | Meaning |
|---|---|---|
| **Utilization** | `total_tracked / (empdays × 8) × 100`, capped at 100% | How much of available capacity was actually tracked |
| **Activity** | `overall_h / total_tracked × 100` | Of the tracked time, how much had real keyboard/mouse activity |
| **Productivity** | `Σ (productivity_score × tracked) / Σ tracked` | **Time-weighted** average of Hubstaff's 0–100 productivity score (busy days count more) |
| **Revenue** | `billable_h × pay_rate` | `pay_rate` defaults to **$40** when missing |

---

## 4. Grade

The grade is a 0–100 score mapped to a letter. **Two different weightings** are used:

**Per-employee grade** (people table, Avg Grade, Top/Bottom 3):
```
grade_score = 0.4 × Utilization  +  0.3 × Productivity  +  0.3 × Task-completion%
```
- `Task-completion%` = % of that employee's ClickUp tasks that are completed (falls back to 70 if unknown).
- **Avg Grade** = letter of the *mean* of all employees' `grade_score`.

**Per-team / per-department grade** (breakdown bars, team rows):
```
grade_score = 0.5 × Utilization  +  0.5 × Productivity
```
(no task component, because completion is tracked per person.)

**Letter mapping** (same for both):

| Score | ≥ 90 | ≥ 80 | ≥ 75 | ≥ 65 | ≥ 50 | < 50 |
|---|---|---|---|---|---|---|
| Grade | A+ | A | B+ | B | C | D |

---

## 5. Budget vs Actual (bullet chart)

| Field | Formula |
|---|---|
| **Budget** (capacity) | `empdays × 8` |
| **Actual** | `total tracked` |
| **Variance** | `actual − budget` |
| **% of capacity** | `actual / budget × 100` |

**Status band:** `≥ 100%` → *Over capacity* · `≥ 85%` → *On track* · else → *Under-utilized*.

---

## 6. Period-over-period (the ▲ / ▼ deltas)

- The **previous period** = a window of the **same number of days**, immediately *before* the selected range.
  (If you pick 21 Feb–9 Apr = 48 days, previous = the 48 days ending 20 Feb.)
- For every KPI and every breakdown row:
  ```
  delta% = (current − previous) / previous × 100
  ```
- If the previous window has no data, no comparison is shown (—).

---

## 7. Tasks

**Task Status** (donut) — aggregated from the employees in scope, bucketed from the ClickUp `status` text:

| Bucket | Matched when status contains |
|---|---|
| Completed | complete / done / closed / finished / published |
| Review | review |
| Overdue | overdue |
| In Progress | anything else (open) |

- **Active tasks** = tasks whose status is **not** in the closed set `{closed, complete(d), finished, published, cancelled, done, archived}`.

**Task Priority** (donut / "grade of work") — taken straight from the ClickUp `priority` field: **Urgent / High / Normal / Low**.

**Tasks by Employee** — per-person counts of each priority, plus:
- **Billable** = tasks whose name has **no** "NB" token.
- **NB** = tasks whose name contains the "NB" token.
- Sorted by weighted load: `urgent×3 + high×2 + normal×1`.

---

## 8. Clients

| Field | How it's derived |
|---|---|
| **Client** | The ClickUp **folder** the employee has most tasks in |
| **Client Type** | Folder-name marker is the source of truth: **`(F)` → Fixed**, **`(H)` → Hourly**; else keyword (hourly/monthly/fixed/retainer); else *Project* |
| **Client hours** | `Σ tracked_h` grouped by client |
| **Client active** | Has at least one non-closed task |

**Client Health** (per client):
- **Inactive** — `active_tasks == 0`
- **At-risk** — hours below the **25th percentile** of all clients' hours
- **Active** — everything else

---

## 9. Other panels

| Panel | Calculation |
|---|---|
| **Grade Distribution** | Count of employees in each grade letter (A+ … D) |
| **Project Health** (per team's utilization) | on-track ≥ 75% · at-risk ≥ 60% · delayed < 60% |
| **Activity Heatmap** | `Σ tracked_h` grouped by **department × ISO week**; darker = more hours |
| **Performance Matrix** (bubble) | x = Utilization, y = Productivity, bubble size = Billable hours |
| **Team Comparison** (radar) | Per team: avg Utilization, avg Activity, avg Productivity, and Billable % = `billable / (billable+non_billable) × 100` |
| **Live status** (member) | Last activity within **1 day → Active**, within **4 days → Idle**, older → **Offline** |

---

## 10. Department & Team naming

- **Department** = the ClickUp **space** name *prefix* (before `" - "`), cleaned of suffixes like "Department"/"Pipeline"/"Clients".
- **Team** = the full ClickUp **space** name (as-is), e.g. `Operations - Syndicate`.
- An employee can appear under **multiple** teams/departments/clients (membership = every space/folder they have tasks in), which is why selecting any one of them surfaces everyone who works in it.

---

### Why some hours are "Unassigned"
Department / Team / Client all come from **ClickUp tasks**, matched to Hubstaff people by **name**. If a person's Hubstaff name doesn't match any ClickUp assignee, their tracked time can't be mapped — so it shows as **Unassigned** (see the *Unassigned* diagnostic tab for the per-person reason and suggested fix).
