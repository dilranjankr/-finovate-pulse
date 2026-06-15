"""Build a hubstaff_user_id -> clickup_user_id identity map and (optionally) write
it to employee_mapping.clickup_user_id.

Strategy (most reliable first):
  1. Co-occurrence: tasks linked in BOTH systems (clickup_tasks.task_id =
     hubstaff_tasks.remote_id). On tasks with exactly one assignee on each side,
     the ClickUp id and Hubstaff id are the same person. Aggregate; require >=2
     supporting tasks. This is unambiguous and language-independent.
  2. Unique-name: for employees still unmapped, match the full name (compacted)
     OR email local-part against ClickUp usernames/emails. Accept ONLY when it
     resolves to exactly one ClickUp user (skip first-name collisions).

Run:  python link_clickup.py          # dry-run, prints coverage + samples
      python link_clickup.py --write  # also ALTER TABLE + UPDATE employee_mapping
"""
import json
import re
import sys
from collections import defaultdict, Counter

import db


def compact(x):
    return re.sub(r"[^a-z0-9]", "", str(x).lower())


def build_map():
    # --- 1) co-occurrence ---
    rows = db.q("""
        SELECT ct.assignees ck, ht.assignee_ids hb
        FROM hubstaff_tasks ht
        JOIN clickup_tasks ct ON ct.task_id = ht.remote_id
        WHERE coalesce(ct.is_deleted,false)=false
          AND ct.assignees ~ '^\\s*\\['
          AND jsonb_typeof(ht.assignee_ids)='array'
    """)
    pair = defaultdict(Counter)
    for _, r in rows.iterrows():
        try:
            cks = [a.get("id") for a in json.loads(r["ck"]) if a.get("id") is not None]
            hb = r["hb"]
            hbs = [int(x) for x in (hb if isinstance(hb, list) else json.loads(hb))]
        except Exception:
            continue
        if len(cks) == 1 and len(hbs) == 1:
            pair[hbs[0]][cks[0]] += 1
    cooc = {hb: c.most_common(1)[0][0] for hb, c in pair.items()
            if c.most_common(1)[0][1] >= 2}

    # --- clickup user directory (id -> username/email) ---
    cu = {}
    for s in db.q("SELECT DISTINCT assignees a FROM clickup_tasks WHERE assignees ~ '^\\s*\\['")["a"]:
        try:
            for a in json.loads(s):
                if a.get("id") is not None:
                    cu[a["id"]] = (a.get("username", "") or "", a.get("email", "") or "")
        except Exception:
            pass
    ck_by = defaultdict(set)
    for cid, (un, em) in cu.items():
        if un:
            ck_by[compact(un)].add(cid)
        if em:
            ck_by[compact(em.split("@")[0])].add(cid)

    # --- 2) unique-name fallback ---
    em = db.q("SELECT hubstaff_user_id::text uid, hr_full_name nm FROM employee_mapping "
              "WHERE coalesce(hr_full_name,'')<>'' AND hubstaff_user_id ~ '^[0-9]+$'")
    out = {}  # hub_uid(str) -> (clickup_id, source)
    for _, r in em.iterrows():
        hub = int(r["uid"])
        if hub in cooc:
            out[str(hub)] = (cooc[hub], "cooccurrence")
            continue
        cand = ck_by.get(compact(r["nm"]), set())
        if len(cand) == 1:
            out[str(hub)] = (next(iter(cand)), "unique-name")
    return out, cu


def main():
    write = "--write" in sys.argv
    m, cu = build_map()
    by_src = Counter(v[1] for v in m.values())
    total_emp = int(db.q("SELECT COUNT(*) c FROM employee_mapping WHERE hubstaff_user_id ~ '^[0-9]+$'")["c"][0])
    print(f"employees: {total_emp} | mapped: {len(m)} "
          f"(cooccurrence={by_src['cooccurrence']}, unique-name={by_src['unique-name']}) "
          f"| unmapped: {total_emp - len(m)}")

    test = db.q("SELECT hubstaff_user_id::text uid, hr_full_name nm FROM employee_mapping "
                "WHERE hr_full_name ILIKE ANY(ARRAY['%aashima%','%durgesh gupta%','%rahul gupta%','%pooja pihwaal%','%vipin kumar%'])")
    print("\nvalidation:")
    for _, r in test.iterrows():
        v = m.get(str(r["uid"]))
        cid = v[0] if v else None
        cnt = 0
        if cid is not None:
            cnt = int(db.q("SELECT COUNT(*) c FROM clickup_tasks WHERE coalesce(is_deleted,false)=false "
                           "AND coalesce(archived,false)=false AND assignees::text LIKE :p",
                           {"p": f'%"id":{cid},%'})["c"][0])
        un = cu.get(cid, ("", ""))[0] if cid else ""
        print(f"  {r['nm']:18} hub={r['uid']:9} -> clickup={cid} ({un}) [{v[1] if v else 'UNMAPPED'}]  clickup_tasks={cnt}")

    if not write:
        print("\n(dry-run — pass --write to persist to employee_mapping.clickup_user_id)")
        return

    eng = db._engine_write() if db.has_write() else db._engine()
    with eng.begin() as cx:
        from sqlalchemy import text
        cx.execute(text("ALTER TABLE employee_mapping ADD COLUMN IF NOT EXISTS clickup_user_id text"))
        cx.execute(text("ALTER TABLE employee_mapping ADD COLUMN IF NOT EXISTS clickup_link_source text"))
        n = 0
        for hub, (cid, src) in m.items():
            cx.execute(text("UPDATE employee_mapping SET clickup_user_id=:c, clickup_link_source=:s "
                            "WHERE hubstaff_user_id=:u"),
                       {"c": str(cid), "s": src, "u": hub})
            n += 1
    print(f"\nwrote clickup_user_id for {n} employees.")


if __name__ == "__main__":
    main()
