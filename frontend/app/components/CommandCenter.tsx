"use client";

import { useState, useRef, useEffect } from "react";
import {
  ArrowUp, ArrowDown, ChevronDown, Search, Filter, CalendarDays,
  Building2, Network, Users, Briefcase, Receipt, RotateCcw, Clock,
  Gauge, Activity, Zap, Award,
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

  // a single stat card: icon + value + label + delta
  const statCard = (label: string, key: string, unit: string, Icon: React.ComponentType<{ size?: number }>, tint: string) => {
    const kv = data.kpis[key]; if (!kv) return null;
    const val = typeof kv.value === "string"
      ? kv.value
      : unit === "%" ? n1(kv.value) + "%" : unit === "h" ? n0(kv.value) + "h" : n1(kv.value);
    return (
      <div className="kcard" key={key}>
        <div className="kcard-top">
          <span className="kcard-ic" style={{ background: `${tint}1a`, color: tint }}><Icon size={15} /></span>
          {deltaChip(key)}
        </div>
        <div className="kcard-big num">{val}</div>
        <div className="kcard-lbl">{label}</div>
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

      {/* KPI CARDS */}
      <div className="kcards">
        {/* Featured: Total Hours + billable/non-billable donut */}
        <div className="kcard kcard-feat">
          <div className="kcard-top">
            <span className="kcard-ic" style={{ background: "#2030701a", color: "#203070" }}><Clock size={15} /></span>
            <span className="kcard-lbl">Total Hours</span>
            {deltaChip("total_hours")}
          </div>
          <div className="kfeat-body">
            <div className="kfeat-l">
              <div className="kfeat-big num">{n0(total)}<span>h</span></div>
              <div className="kfeat-rows">
                <div className="kfr"><span className="dot bil" /><span className="l">Billable</span><b>{n0(billable)}h</b><i>{billPct}%</i></div>
                <div className="kfr"><span className="dot nbil" /><span className="l">Non-Billable</span><b>{n0(nonbill)}h</b><i>{100 - billPct}%</i></div>
              </div>
            </div>
            <div className="kdonut" style={{ background: `conic-gradient(#0f9043 0 ${billPct}%, #dbe0e8 ${billPct}% 100%)` }}>
              <div className="kdonut-hole"><b className="num">{billPct}%</b><span>billable</span></div>
            </div>
          </div>
        </div>

        {statCard("Utilization", "utilization", "%", Gauge, "#203070")}
        {statCard("Productivity", "productivity", "%", Zap, "#0f9043")}
        {statCard("Activity", "activity", "%", Activity, "#2f6fbf")}
        {statCard("Avg Grade", "avg_grade", "", Award, "#7b3fc0")}
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
