"use client";

import { useState, useRef, useEffect } from "react";
import {
  ArrowUp, ArrowDown, ChevronDown, Search, Filter, CalendarDays,
  Building2, Network, Users, Briefcase, Receipt, RotateCcw, Clock, X,
} from "lucide-react";
import {
  getFilters, getCommand, defaultRange,
  type FilterOptions, type CommandData, type Filters, type EmployeeRow,
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

  async function apply(f: Filters) {
    setLoading(true);
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
  const billPct = total ? Math.round((billable / total) * 100) : 0;
  const cmp = data.period?.comparable;
  const pv = data.period?.previous;

  const deltaChip = (key: string) => {
    const t = data.kpis[key]?.trend || 0;
    if (!cmp) return null;
    const up = t > 0, dn = t < 0;
    const pvw = data.period?.previous;
    const tip = pvw ? `${t > 0 ? "+" : ""}${t}% vs previous ${pvw.days} days (${pvw.from} → ${pvw.to})` : "vs previous period";
    return <span className={`kchip ${up ? "up" : dn ? "down" : "flat"}`} title={tip}>{up ? <ArrowUp size={10} /> : dn ? <ArrowDown size={10} /> : null}{Math.abs(t)}%</span>;
  };

  // distinct brand colour per metric so the rings are easy to tell apart
  const COL = { util: "#203070", act: "#2f6fbf", prod: "#0d9488", bill: "#0f9043" };
  const openMetric = (label: string, color: string, calc: string, get: (e: EmployeeRow) => number, fmt: (v: number) => string) =>
    () => setDetail({ label, color, calc, get, fmt });

  // a circular progress ring (SVG, rounded cap) with the value in the centre
  const ringCard = (label: string, key: string, pct: number, display: string, sub: string, color: string, deltaKey?: string, onClick?: () => void) => {
    const fill = Math.max(0, Math.min(100, pct));
    const R = 31, C = 2 * Math.PI * R, off = C * (1 - fill / 100);
    return (
      <div className={`kring${onClick ? " kclk" : ""}`} key={key} onClick={onClick}>
        <div className="kring-wrap">
          <svg width="82" height="82" viewBox="0 0 82 82">
            <circle cx="41" cy="41" r={R} fill="none" stroke="var(--line-2)" strokeWidth="7.5" />
            <circle cx="41" cy="41" r={R} fill="none" stroke={color} strokeWidth="7.5" strokeLinecap="round"
              strokeDasharray={C} strokeDashoffset={off} transform="rotate(-90 41 41)" />
          </svg>
          <div className="kring-center">
            <b className="num" style={{ color }}>{display}</b>
            {sub ? <span>{sub}</span> : null}
          </div>
        </div>
        <div className="kring-foot">
          <span className="kring-lbl">{label}</span>
          {deltaKey && cmp ? <span className="kring-trend">{deltaChip(deltaKey)}<em>vs last {pv?.days}d</em></span> : null}
        </div>
      </div>
    );
  };
  const GR_PCT: Record<string, number> = { "A+": 96, A: 86, "B+": 78, B: 68, C: 52, D: 32 };
  const gradeStr = String(k.avg_grade?.value ?? "—");
  const grColor = gradeStr.startsWith("A") ? "#0f9043" : gradeStr.startsWith("B") ? "#2f6fbf" : gradeStr.startsWith("C") ? "#bd8616" : "#d23f43";
  const util = Number(k.utilization?.value || 0);
  const prod = Number(k.productivity?.value || 0);
  const act = Number(k.activity?.value || 0);

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

      {/* KPI — Total Hours card + gauge rings */}
      <div className="kcards">
        {/* Featured: Total Hours + billable/non-billable */}
        <div className="kcard kcard-feat kclk" onClick={openMetric("Total Hours", "#203070", "Total tracked time from Hubstaff = Billable + Non-Billable hours. Per employee = sum of their daily tracked hours.", (e) => e.billable + e.non_billable, (v) => n0(v) + "h")}>
          <div className="kcard-top">
            <span className="kcard-ic" style={{ background: "#2030701a", color: "#203070" }}><Clock size={15} /></span>
            <span className="kcard-lbl">Total Hours</span>
            {cmp ? <span className="kcard-trend">{deltaChip("total_hours")}<em>vs last {pv?.days}d</em></span> : null}
          </div>
          <div className="kfeat-num"><b className="num">{n0(total)}</b><span>hrs tracked</span></div>
          <div className="kfeat-bar">
            <span className="bil" style={{ width: `${billPct}%` }} />
            <span className="nbil" style={{ width: `${100 - billPct}%` }} />
          </div>
          <div className="kfeat-split">
            <div className="kfeat-blk bil">
              <div className="top"><span className="dot" />Billable</div>
              <div className="val num">{n0(billable)}<span className="u">h</span> <i>{billPct}%</i></div>
            </div>
            <div className="kfeat-blk nbil">
              <div className="top"><span className="dot" />Non-Billable</div>
              <div className="val num">{n0(nonbill)}<span className="u">h</span> <i>{100 - billPct}%</i></div>
            </div>
          </div>
        </div>

        {ringCard("Utilization", "ring-util", util, n1(util) + "%", "", COL.util, "utilization", openMetric("Utilization", COL.util, "Tracked hours ÷ capacity (active days × 8h) × 100, capped at 100%. Per employee = their tracked ÷ (their days × 8).", (e) => e.utilization, (v) => n1(v) + "%"))}
        {ringCard("Activity", "ring-act", act, n1(act) + "%", "", COL.act, "activity", openMetric("Activity", COL.act, "Active time (keyboard + mouse) ÷ tracked time × 100. How much of logged time had real input.", (e) => e.activity, (v) => n1(v) + "%"))}
        {ringCard("Productivity", "ring-prod", prod, n1(prod) + "%", "", COL.prod, "productivity", openMetric("Productivity", COL.prod, "Time-weighted activity score (0–100). This project has no separate Hubstaff productivity score, so it currently equals Activity.", (e) => e.productivity, (v) => n1(v) + "%"))}
        {ringCard("Billable", "ring-bill", billPct, billPct + "%", "", COL.bill, "billable_hours", openMetric("Billable hours", COL.bill, "Tracked time on tasks/projects NOT marked “NB”. Work whose task or project name starts with the NB token is non-billable.", (e) => e.billable, (v) => n0(v) + "h"))}
        {ringCard("Avg Grade", "ring-grade", GR_PCT[gradeStr] ?? 0, gradeStr, "", grColor)}
      </div>

      <div className="kpi-cmp">
        {cmp && pv
          ? <>▲▼ compares current <b>{pv.days} days</b> ({draft.date_from} → {draft.date_to}) vs previous <b>{pv.days} days</b> ({pv.from} → {pv.to})</>
          : <>Pick a date range to compare against the previous equal-length period</>}
      </div>

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
