"use client";

import { useState, useRef, useEffect } from "react";
import {
  ChevronDown, Search, Filter, CalendarDays,
  Building2, Network, Users, Briefcase, Receipt, RotateCcw, Clock, X,
  Gauge, Activity, Zap, Award, Tag,
} from "lucide-react";
import {
  getFilters, getCommand, getBreakdown, defaultRange,
  type FilterOptions, type CommandData, type Filters, type EmployeeRow, type BreakdownData,
} from "../lib/api";

const n0 = (v: number) => Math.round(v).toLocaleString("en-US");
const n1 = (v: number) => v.toLocaleString("en-US", { maximumFractionDigits: 1 });

export default function CommandCenter({
  initialOpts, initialData,
}: { initialOpts: FilterOptions | null; initialData: CommandData | null }) {
  const [opts, setOpts] = useState<FilterOptions | null>(initialOpts);
  const [draft, setDraft] = useState<Filters>(initialOpts ? defaultRange(initialOpts) : {});
  const [data, setData] = useState<CommandData | null>(initialData);
  const [loading, setLoading] = useState(false);
  const [showFilters, setShowFilters] = useState(true);
  const [detail, setDetail] = useState<null | { label: string; color: string; calc: string; get: (e: EmployeeRow) => number; fmt: (v: number) => string }>(null);
  const [bd, setBd] = useState<BreakdownData | null>(null);

  useEffect(() => {
    if (initialOpts) getBreakdown(defaultRange(initialOpts)).then(setBd).catch(() => setBd(null));
  }, [initialOpts]);

  async function apply(f: Filters) {
    setLoading(true);
    getBreakdown(f).then(setBd).catch(() => setBd(null));
    try { setData(await getCommand(f)); } finally { setLoading(false); }
  }
  async function refetchOpts(scope: { department?: string; atl?: string }) {
    try { setOpts(await getFilters(scope)); } catch { /* keep */ }
  }
  function setField(key: keyof Filters, v: string) { const next = { ...draft, [key]: v || undefined }; setDraft(next); apply(next); }
  function setDept(v: string) { const next = { ...draft, department: v || undefined, atl: undefined, employee: undefined }; setDraft(next); refetchOpts({ department: v || undefined }); apply(next); }
  function setAtl(v: string) { const next = { ...draft, atl: v || undefined, employee: undefined }; setDraft(next); refetchOpts({ department: draft.department, atl: v || undefined }); apply(next); }
  function clearFilters() { const base: Filters = opts ? defaultRange(opts) : {}; setDraft(base); refetchOpts({}); apply(base); }

  if (!data) return <div className="page"><div className="loading"><span className="spin" /> Loading…</div></div>;

  const live = data.source === "supabase";
  const sm = data.summary;
  const k = data.kpis;

  const total = Number(k.total_hours?.value || 0);
  const billable = Number(k.billable_hours?.value || 0);
  const nonbill = Number(k.non_billable_hours?.value || 0);
  const util = Number(k.utilization?.value || 0);
  const prod = Number(k.productivity?.value || 0);
  const act = Number(k.activity?.value || 0);
  const gradeStr = String(k.avg_grade?.value ?? "—");
  const cmp = data.period?.comparable;
  const pv = data.period?.previous;

  const openMetric = (label: string, color: string, calc: string, get: (e: EmployeeRow) => number, fmt: (v: number) => string) =>
    () => setDetail({ label, color, calc, get, fmt });

  // image-style KPI card: tinted top + solid icon badge, white body w/ value + delta
  const KPICOL: Record<string, { tint: string; badge: string }> = {
    green: { tint: "#e7f6ec", badge: "#16a34a" },
    teal: { tint: "#e2f5f1", badge: "#0d9488" },
    purple: { tint: "#f1e9fb", badge: "#8b5cf6" },
    blue: { tint: "#e8f1fd", badge: "#2f6fbf" },
    amber: { tint: "#fdf2e1", badge: "#e8930c" },
    rose: { tint: "#fdeaea", badge: "#ef4444" },
  };
  const kpiCard = (key: string, label: string, value: string, colorKey: string, Icon: React.ComponentType<{ size?: number }>, deltaKey?: string, onClick?: () => void) => {
    const c = KPICOL[colorKey];
    const t = deltaKey ? (data.kpis[deltaKey]?.trend ?? 0) : null;
    const dColor = t !== null && t > 0 ? "#0f9043" : t !== null && t < 0 ? "#d23f43" : "var(--muted)";
    return (
      <div className={`kc2${onClick ? " kclk" : ""}`} key={key} onClick={onClick}>
        <div className="kc2-head">
          <span className="kc2-ic" style={{ background: c.tint, color: c.badge }}><Icon size={16} /></span>
          <span className="kc2-lbl">{label}</span>
        </div>
        <div className="kc2-val num">{value}</div>
        {cmp && t !== null
          ? <div className="kc2-delta" style={{ color: dColor }}><Clock size={12} /><b>{t > 0 ? "+" : ""}{t}%</b><span>vs last {pv?.days}d</span></div>
          : <div className="kc2-delta dash"><span>—</span></div>}
      </div>
    );
  };


  return (
    <div className="page">
      {/* HEADER */}
      <div className="topbar">
        <div className="tb-l">
          <img src="/finovate-logo.png" alt="Finovate" className="brandlogo" />
          <div className="title">
            <h2><span className="pulse">Insight</span> · Operations Intelligence</h2>
            <div className="s">
              <b>{sm.employees}</b> employees · <b>{sm.departments}</b> depts · <b>{sm.teams}</b> teams · <b>{sm.clients}</b> clients · <b>{sm.active_days}</b> days
            </div>
          </div>
        </div>
        <div className="tb-r">
          <div className={`chip${live ? "" : " demo"}`}><span className="d" />{loading ? "Syncing…" : live ? "Live" : "Demo"}</div>
          <div className={`filtbtn${showFilters ? " on" : ""}`} title="Toggle filters" onClick={() => setShowFilters((s) => !s)}><Filter /></div>
        </div>
      </div>

      {/* FILTERS */}
      {showFilters && (() => {
        const activeCount = [draft.department, draft.atl, draft.employee, draft.client, draft.client_type, draft.billable].filter(Boolean).length;
        return (
          <div className="filterbar">
            <span className="fb-lead">FILTERS</span>
            <label className="fdate">
              <CalendarDays size={13} />
              <input type="date" value={draft.date_from || ""} onChange={(e) => setField("date_from", e.target.value)} aria-label="From" />
              <span className="dsep">–</span>
              <input type="date" value={draft.date_to || ""} onChange={(e) => setField("date_to", e.target.value)} aria-label="To" />
            </label>
            <MultiSelect Icon={Building2} label="Department" value={draft.department} opts={opts?.departments} on={setDept} allLabel="All Departments" />
            <MultiSelect Icon={Network} label="Team" value={draft.atl} opts={opts?.atls} on={setAtl} allLabel="All Teams" />
            <MultiSelect Icon={Users} label="Employee" value={draft.employee} opts={opts?.employees} on={(v) => setField("employee", v)} allLabel="All Employees" />
            <MultiSelect Icon={Briefcase} label="Client" value={draft.client} opts={opts?.clients} on={(v) => setField("client", v)} allLabel="All Clients" />
            <MultiSelect Icon={Receipt} label="Type" value={draft.client_type} opts={opts?.client_types} on={(v) => setField("client_type", v)} allLabel="All Types" />
            {/* Billable / Non-Billable — default All */}
            <div className="bseg" role="group" aria-label="Billable">
              {([["", "All"], ["Billable", "Billable"], ["Non-Billable", "Non-Bill"]] as const).map(([v, lbl]) => (
                <button key={v || "all"} type="button" className={(draft.billable || "") === v ? "on" : ""} onClick={() => setField("billable", v)}>{lbl}</button>
              ))}
            </div>
            {activeCount > 0 && (
              <button className="fclear" onClick={clearFilters} title="Clear all filters">
                <RotateCcw size={13} />Clear all<span className="fcnt">{activeCount}</span>
              </button>
            )}
          </div>
        );
      })()}

      {/* KPI — one row: Total Hours donut card + metric cards */}
      <div className="kpi-row">
        <div className="thd-card kclk" onClick={openMetric("Total Hours", "#16a34a", "Total tracked time from Hubstaff = Billable + Non-Billable. Per employee = sum of their daily tracked hours.", (e) => e.billable + e.non_billable, (v) => n0(v) + "h")}>
          <div className="thd-head"><h3>Total Hours</h3></div>
          <div className="thd-body">
            <div className="thd-chart">
              <RingChart segs={[{ label: "Billable", value: billable, color: "#16a34a" }, { label: "Non-Billable", value: nonbill, color: "#8b5cf6" }]} />
              <div className="thd-center"><b className="num">{n0(total)}</b><span>hrs</span></div>
            </div>
            <div className="thd-leg">
              <div className="thd-lg"><span className="d" style={{ background: "#16a34a" }} /><span className="l">Billable</span><b className="num">{n0(billable)}h</b></div>
              <div className="thd-lg"><span className="d" style={{ background: "#8b5cf6" }} /><span className="l">Non-Billable</span><b className="num">{n0(nonbill)}h</b></div>
            </div>
          </div>
        </div>
        {kpiCard("k-util", "Utilization", n1(util) + "%", "purple", Gauge, "utilization",
          openMetric("Utilization", "#8b5cf6", "Tracked hours ÷ capacity (active days × 8h) × 100, capped at 100%.", (e) => e.utilization, (v) => n1(v) + "%"))}
        {kpiCard("k-act", "Activity", n1(act) + "%", "blue", Activity, "activity",
          openMetric("Activity", "#2f6fbf", "Active time (keyboard + mouse) ÷ tracked time × 100.", (e) => e.activity, (v) => n1(v) + "%"))}
        {kpiCard("k-prod", "Productivity", n1(prod) + "%", "amber", Zap, "productivity",
          openMetric("Productivity", "#e8930c", "Time-weighted activity score (0–100). Equals Activity in this project (no separate Hubstaff score).", (e) => e.productivity, (v) => n1(v) + "%"))}
        {kpiCard("k-grade", "Avg Grade", gradeStr, "rose", Award)}
      </div>

      <div className="kpi-cmp">
        {cmp && pv
          ? <>▲▼ compares current <b>{pv.days} days</b> ({draft.date_from} → {draft.date_to}) vs previous <b>{pv.days} days</b> ({pv.from} → {pv.to})</>
          : <>Pick a date range to compare against the previous equal-length period</>}
      </div>

      {/* TRACKED TIME — Task vs Project, with billable/non-billable inside each */}
      {bd && (bd.task_h > 0 || bd.project_h > 0) && (() => {
        const totH = bd.task_h + bd.project_h;
        const taskPct = totH ? Math.round((bd.task_h / totH) * 100) : 0;
        const wlCard = (label: string, badge: string, tint: string, Icon: React.ComponentType<{ size?: number }>, hours: number, bil: number, nb: number) => (
          <div className="wl-card">
            <span className="wl-badge" style={{ background: tint, color: badge }}><Icon size={20} /></span>
            <div className="wl-info">
              <div className="wl-lbl">{label}</div>
              <div className="wl-val num">{n0(hours)}<span>h</span></div>
              <div className="wl-sub">
                <span><i className="d bil" />Billable <b className="num">{n0(bil)}h</b></span>
                <span><i className="d nbil" />Non-Billable <b className="num">{n0(nb)}h</b></span>
              </div>
            </div>
          </div>
        );
        return (
          <div className="panel wl-panel">
            <div className="ph"><h3>Tracked Time — Task vs Project <span className="hl">where time was logged · billable split inside each</span></h3></div>
            <div className="wl-grid">
              <div className="wl-cards">
                {wlCard("On a Task", "#e8930c", "#fdf2e1", Tag, bd.task_h, bd.task_billable_h, bd.task_non_billable_h)}
                {wlCard("Project Only (no task)", "#2f6fbf", "#e8f1fd", Briefcase, bd.project_h, bd.project_billable_h, bd.project_non_billable_h)}
              </div>
              <div className="wl-chart">
                <div className="wl-ring" style={{ background: `conic-gradient(#e8930c 0 ${taskPct}%, #cdd4e0 ${taskPct}% 100%)` }}>
                  <div className="wl-hole"><b className="num">{taskPct}%</b><span>on tasks</span></div>
                </div>
                <div className="wl-leg">
                  <span><i style={{ background: "#e8930c" }} />Task {n0(bd.task_h)}h</span>
                  <span><i style={{ background: "#cdd4e0" }} />Project {n0(bd.project_h)}h</span>
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      <div className="foot">Synced from Hubstaff · ClickUp — {live ? "Supabase (Live)" : "CSV (Demo)"} · capacity 8h/day · Non-billable = tasks/projects marked “NB”</div>

      {/* KPI DETAIL — per-employee breakdown of the clicked metric */}
      {detail && (() => {
        const rows = data.employees
          .map((e) => ({ name: e.name, team: e.team, grade: e.grade, v: detail.get(e) }))
          .filter((r) => r.v > 0)
          .sort((a, b) => b.v - a.v);
        const max = Math.max(1, ...rows.map((r) => r.v));
        return (
          <div className="modal-bg" onClick={() => setDetail(null)}>
            <div className="modal" onClick={(e) => e.stopPropagation()}>
              <div className="modal-h">
                <div>
                  <h3><span className="kdot" style={{ background: detail.color }} />{detail.label} · by employee</h3>
                  <div className="sub">{rows.length} people · {data.context.label} · sorted high → low</div>
                </div>
                <div className="modal-x" onClick={() => setDetail(null)}><X size={16} /></div>
              </div>
              <div className="modal-b">
                <div className="calc-note">
                  <b>How it&apos;s calculated</b>
                  <span>{detail.calc}</span>
                </div>
                <table>
                  <thead><tr><th className="l">#</th><th className="l">Employee</th><th className="l">Team</th><th>Grade</th><th className="l">{detail.label}</th></tr></thead>
                  <tbody>
                    {rows.map((r, i) => (
                      <tr key={r.name}>
                        <td className="l" style={{ color: "var(--faint)", fontWeight: 700 }}>{i + 1}</td>
                        <td className="l tname">{r.name}</td>
                        <td className="l" style={{ color: "var(--muted)" }}>{r.team}</td>
                        <td><span className={`grade ${r.grade.startsWith("A") ? "gA" : r.grade === "B+" ? "gB" : r.grade === "B" ? "gBb" : r.grade.startsWith("C") ? "gC" : "gD"}`}>{r.grade}</span></td>
                        <td className="l"><span className="kbar"><span className="kbar-t"><span style={{ width: `${(r.v / max) * 100}%`, background: detail.color }} /></span><b>{detail.fmt(r.v)}</b></span></td>
                      </tr>
                    ))}
                    {rows.length === 0 && <tr><td colSpan={5} style={{ textAlign: "center", padding: 24, color: "var(--muted)" }}>No data in scope</td></tr>}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}

function RingChart({ segs }: { segs: { label: string; value: number; color: string }[] }) {
  const total = segs.reduce((s, x) => s + x.value, 0) || 1;
  const R = 70, SW = 30, C = 2 * Math.PI * R;
  let acc = 0;
  const arcs = segs.map((s, i) => {
    const frac = s.value / total; const dash = frac * C;
    const arc = (
      <circle key={i} cx="100" cy="100" r={R} fill="none" stroke={s.color} strokeWidth={SW}
        strokeDasharray={`${dash} ${C - dash}`} strokeDashoffset={-acc * C} />
    );
    acc += frac; return arc;
  });
  let a2 = 0;
  const labels = segs.map((s, i) => {
    const frac = s.value / total; const mid = a2 + frac / 2; a2 += frac;
    const th = mid * 2 * Math.PI;
    const x = 100 + R * Math.sin(th), y = 100 - R * Math.cos(th);
    return Math.round(frac * 100) >= 6
      ? <text key={i} x={x} y={y} className="rc-pct" textAnchor="middle" dominantBaseline="central">{Math.round(frac * 100)}%</text>
      : null;
  });
  return (
    <svg viewBox="0 0 200 200" className="ringchart">
      <g transform="rotate(-90 100 100)">{arcs}</g>
      {labels}
    </svg>
  );
}

function MultiSelect({ Icon, label, value, opts, on, allLabel }: {
  Icon: React.ComponentType<{ size?: number }>; label: string; value?: string;
  opts?: string[]; on: (v: string) => void; allLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  const selected = (value || "").split(",").map((s) => s.trim()).filter(Boolean);
  const active = selected.length > 0;
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) { setOpen(false); setQ(""); } };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [open]);
  const toggle = (o: string) => {
    const set = new Set(selected);
    if (set.has(o)) set.delete(o); else set.add(o);
    on([...set].join(","));
  };
  const list = (opts || []).filter((o) => o.toLowerCase().includes(q.toLowerCase()));
  const display = !active ? label : selected.length === 1 ? selected[0] : `${label} · ${selected.length}`;
  return (
    <div className={`fpill ms${active ? " on" : ""}`} ref={ref}>
      <button type="button" className="ms-btn" onClick={() => setOpen((o) => !o)} title={active ? `${label}: ${selected.join(", ")}` : label}>
        <Icon size={14} />
        <span className="fpl">{display}</span>
        <ChevronDown size={13} />
      </button>
      {open && (
        <div className="ms-menu">
          {(opts || []).length > 8 && (
            <div className="ms-search"><Search size={13} /><input autoFocus placeholder={`Search ${label.toLowerCase()}…`} value={q} onChange={(e) => setQ(e.target.value)} /></div>
          )}
          <div className="ms-opts">
            <div className={`ms-opt all${active ? "" : " on"}`} onClick={() => { on(""); }}>{allLabel || `All ${label}`}</div>
            {list.map((o) => (
              <label className="ms-opt" key={o}>
                <input type="checkbox" checked={selected.includes(o)} onChange={() => toggle(o)} />
                <span className="ms-lbl">{o}</span>
              </label>
            ))}
            {list.length === 0 && <div className="ms-empty">No matches</div>}
          </div>
          {active && <div className="ms-foot"><span>{selected.length} selected</span><button onClick={() => on("")}>Clear</button></div>}
        </div>
      )}
    </div>
  );
}
