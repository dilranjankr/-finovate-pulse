"use client";

import { useState, useRef, useEffect } from "react";
import {
  ArrowUp, ArrowDown, ChevronDown, Search, Filter, CalendarDays,
  Building2, Network, Users, Briefcase, Receipt, RotateCcw, Clock,
} from "lucide-react";
import {
  getFilters, getCommand, defaultRange,
  type FilterOptions, type CommandData, type Filters,
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
    return <span className={`kchip ${up ? "up" : dn ? "down" : "flat"}`}>{up ? <ArrowUp size={10} /> : dn ? <ArrowDown size={10} /> : null}{Math.abs(t)}%</span>;
  };

  // a circular progress ring (SVG, rounded cap) with the value in the centre
  const thr = (v: number, hi: number, mid: number) => (v >= hi ? "#0f9043" : v >= mid ? "#bd8616" : "#d23f43");
  const ringCard = (label: string, key: string, pct: number, display: string, sub: string, color: string, deltaKey?: string) => {
    const fill = Math.max(0, Math.min(100, pct));
    const R = 31, C = 2 * Math.PI * R, off = C * (1 - fill / 100);
    return (
      <div className="kring" key={key}>
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
        <div className="kring-foot"><span className="kring-lbl">{label}</span>{deltaKey ? deltaChip(deltaKey) : null}</div>
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
        <div className="kcard kcard-feat">
          <div className="kcard-top">
            <span className="kcard-ic" style={{ background: "#2030701a", color: "#203070" }}><Clock size={15} /></span>
            <span className="kcard-lbl">Total Hours</span>
            {deltaChip("total_hours")}
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

        {ringCard("Utilization", "ring-util", util, n1(util) + "%", "", thr(util, 75, 60), "utilization")}
        {ringCard("Activity", "ring-act", act, n1(act) + "%", "", thr(act, 70, 50), "activity")}
        {ringCard("Productivity", "ring-prod", prod, n1(prod) + "%", "", thr(prod, 70, 50), "productivity")}
        {ringCard("Billable", "ring-bill", billPct, billPct + "%", "", "#0f9043", "billable_hours")}
        {ringCard("Avg Grade", "ring-grade", GR_PCT[gradeStr] ?? 0, gradeStr, "", grColor)}
      </div>

      {cmp && pv && (
        <div className="kpi-cmp">vs previous {pv.days}-day period · {pv.from} → {pv.to}</div>
      )}

      <div className="foot">Synced from Hubstaff · ClickUp — {live ? "Supabase (Live)" : "CSV (Demo)"} · capacity 8h/day · Non-billable = tasks/projects marked “NB”</div>
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
