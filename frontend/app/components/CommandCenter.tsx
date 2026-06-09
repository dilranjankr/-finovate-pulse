"use client";

import { useState, useRef, useEffect } from "react";
import {
  ChevronDown, Search, Filter, CalendarDays,
  Building2, Network, Users, Briefcase, Receipt, RotateCcw, Clock, X,
  Gauge, Activity, Zap, Award, Tag, Sparkles, Send, BarChart3, ShieldCheck, ShieldAlert,
} from "lucide-react";
import {
  getFilters, getCommand, getBreakdown, getBreakdownList, getEmployee, askAI, defaultRange,
  type FilterOptions, type CommandData, type Filters, type EmployeeRow, type BreakdownData, type BreakdownListData, type EmployeeDetail,
} from "../lib/api";
import { TrendLines, HoursTrend, Donut, Bubble, BarList } from "./Charts";

const n0 = (v: number) => Math.round(v).toLocaleString("en-US");
const n1 = (v: number) => v.toLocaleString("en-US", { maximumFractionDigits: 1 });
function gradeCls(g: string) {
  if (g.startsWith("A")) return "gA";
  if (g === "B+") return "gB";
  if (g === "B") return "gBb";
  if (g.startsWith("C")) return "gC";
  return "gD";
}
function avatarColor(s: string) {
  const c = ["#203070", "#0f9043", "#2f6fbf", "#d9882a", "#7b3fc0", "#0d9488"];
  let h = 0; for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) % 9973;
  return c[h % c.length];
}
const initials = (s: string) => s.split(" ").filter(Boolean).slice(0, 2).map((x) => x[0]).join("").toUpperCase();
const AI_SUGGESTIONS = ["Top performers", "Lowest utilization team", "Billable mix", "At-risk clients", "Busiest department"];
type AiMsg = {
  role: "user" | "ai"; text: string; kind?: "bar" | "donut" | "none";
  bars?: { label: string; value: number; color?: string }[];
  donut?: { data: { name: string; value: number }[]; colors: string[]; center?: { value: string; label: string } };
};

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
  const [bdList, setBdList] = useState<BreakdownListData | null>(null);
  const [bdModal, setBdModal] = useState<null | { kind: "task" | "project"; mode: "all" | "billable" | "nonbillable" }>(null);
  const [cmpDim, setCmpDim] = useState<"department" | "team">("department");
  const [clientTab, setClientTab] = useState<"top" | "bottom">("top");
  const [perfTab, setPerfTab] = useState<"top" | "bottom">("top");
  const [emp, setEmp] = useState<{ name: string; data: EmployeeDetail | null } | null>(null);
  const [chatOpen, setChatOpen] = useState(false);
  const [aiQ, setAiQ] = useState("");
  const [aiBusy, setAiBusy] = useState(false);
  const [messages, setMessages] = useState<AiMsg[]>([]);
  const chatRef = useRef<HTMLDivElement>(null);
  useEffect(() => { if (chatRef.current) chatRef.current.scrollTop = chatRef.current.scrollHeight; }, [messages, aiBusy, chatOpen]);

  async function openEmployee(name: string) {
    setEmp({ name, data: null });
    try { setEmp({ name, data: await getEmployee(name, draft) }); } catch { setEmp({ name, data: { found: false } }); }
  }
  async function ask(q: string) {
    const question = q.trim();
    if (!question || aiBusy) return;
    setAiQ(""); setMessages((m) => [...m, { role: "user", text: question }]); setAiBusy(true);
    try {
      const r = await askAI(question, draft);
      setMessages((m) => [...m, { role: "ai", text: r.ok && r.text ? r.text : "Sorry, I couldn't answer that. Try rephrasing — e.g. 'top performers', 'lowest utilization team', 'billable mix', 'at-risk clients'.", kind: r.kind, bars: r.bars, donut: r.donut }]);
    } catch {
      setMessages((m) => [...m, { role: "ai", text: "AI is unavailable right now. Please try again." }]);
    } finally { setAiBusy(false); }
  }

  useEffect(() => {
    if (initialOpts) getBreakdown(defaultRange(initialOpts)).then(setBd).catch(() => setBd(null));
  }, [initialOpts]);

  // resilient client-side load if SSR couldn't reach the backend (cold start)
  useEffect(() => {
    if (initialData) return;
    let cancelled = false;
    (async () => {
      try {
        let o = initialOpts;
        if (!o) { o = await getFilters(); if (cancelled) return; setOpts(o); setDraft(defaultRange(o)); }
        const r = defaultRange(o);
        const [cmd, b] = await Promise.all([getCommand(r), getBreakdown(r).catch(() => null)]);
        if (cancelled) return;
        setData(cmd); setBd(b);
      } catch { /* retry on next interaction */ }
    })();
    return () => { cancelled = true; };
  }, [initialData, initialOpts]);

  function openBdList(kind: "task" | "project", mode: "all" | "billable" | "nonbillable") {
    setBdModal({ kind, mode });
    setBdList(null);
    getBreakdownList(draft).then(setBdList).catch(() => setBdList({ by_task: [], by_project: [] }));
  }

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

  // derived data for the visual sections
  const bubble = data.employees.map((e) => ({
    x: e.utilization, y: e.productivity, z: Math.max(e.billable, 1), name: e.name,
    color: e.grade.startsWith("A") ? "#0f9043" : e.grade.startsWith("B") ? "#2f6fbf" : e.grade.startsWith("C") ? "#bd8616" : "#d23f43",
  }));
  const clientsAll = [...data.clients_summary].filter((c) => c.hours > 0).sort((a, b) => b.hours - a.hours);
  const clColor = (cat: string) => (cat === "Fixed" ? "#2f6fbf" : cat === "Hourly" ? "#0f9043" : "#9aa3b2");
  const topClients = clientsAll.slice(0, 5);
  const botClients = clientsAll.length > 5 ? clientsAll.slice(-5).reverse() : [];
  const billType = (() => {
    const m = { Fixed: 0, Hourly: 0, Project: 0 } as Record<string, number>;
    data.clients_summary.forEach((c) => { const k = c.category === "Fixed" ? "Fixed" : c.category === "Hourly" ? "Hourly" : "Project"; m[k] += c.hours; });
    return [{ name: "Fixed", value: Math.round(m.Fixed) }, { name: "Hourly", value: Math.round(m.Hourly) }, { name: "Project", value: Math.round(m.Project) }].filter((x) => x.value > 0);
  })();
  const billTypeTotal = billType.reduce((s, x) => s + x.value, 0);
  const ch = data.client_health;
  const chTotal = ch.active + ch.at_risk + ch.inactive;
  const chData = [{ name: "Active", value: ch.active }, { name: "At Risk", value: ch.at_risk }, { name: "Inactive", value: ch.inactive }];
  const empClients = [...data.employees].filter((e) => e.billable > 0).sort((a, b) => b.billable - a.billable);

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
          openMetric("Productivity", "#e8930c", "Billable hours ÷ total tracked hours × 100 — what share of tracked time was billable (NB tasks/projects count as non-billable).", (e) => e.productivity, (v) => n1(v) + "%"))}
        {kpiCard("k-grade", "Avg Grade", gradeStr, "rose", Award)}
      </div>


      {/* TRACKED TIME — Task vs Project, with billable/non-billable inside each */}
      {bd && (bd.task_h > 0 || bd.project_h > 0) && (() => {
        const totH = bd.task_h + bd.project_h;
        const taskPct = totH ? Math.round((bd.task_h / totH) * 100) : 0;
        const wlCard = (label: string, badge: string, tint: string, Icon: React.ComponentType<{ size?: number }>, hours: number, bil: number, nb: number, kind: "task" | "project") => (
          <div className="wl-card kclk" onClick={() => openBdList(kind, "all")}>
            <span className="wl-badge" style={{ background: tint, color: badge }}><Icon size={20} /></span>
            <div className="wl-info">
              <div className="wl-lbl">{label}</div>
              <div className="wl-val num">{n0(hours)}<span>h</span></div>
              <div className="wl-sub">
                <span className="wl-clk" onClick={(e) => { e.stopPropagation(); openBdList(kind, "billable"); }}><i className="d bil" />Billable <b className="num">{n0(bil)}h</b></span>
                <span className="wl-clk" onClick={(e) => { e.stopPropagation(); openBdList(kind, "nonbillable"); }}><i className="d nbil" />Non-Billable <b className="num">{n0(nb)}h</b></span>
              </div>
            </div>
          </div>
        );
        return (
          <div className="panel wl-panel">
            <div className="ph"><h3>Tracked Time — Task vs Project <span className="hl">where time was logged · billable split inside each</span></h3></div>
            <div className="wl-grid">
              <div className="wl-cards">
                {wlCard("On a Task", "#e8930c", "#fdf2e1", Tag, bd.task_h, bd.task_billable_h, bd.task_non_billable_h, "task")}
                {wlCard("Project Only (no task)", "#2f6fbf", "#e8f1fd", Briefcase, bd.project_h, bd.project_billable_h, bd.project_non_billable_h, "project")}
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

      {/* HOURS TREND */}
      {data.hours_trend.length > 1 && (
        <>
          <div className="sec"><h4>Hours Trend</h4></div>
          <div className="panel" style={{ marginBottom: 14 }}>
            <div className="ph"><h3>Billable vs Non-Billable over time <span className="hl">tracked hours per day</span></h3></div>
            <HoursTrend data={data.hours_trend.map((d) => ({ date: d.date, billable: d.billable, non_billable: d.non_billable }))} height={300} />
          </div>
        </>
      )}

      {/* CLIENTS */}
      <div className="sec"><h4>Clients</h4></div>
      <div className="row3">
        <div className="panel">
          <div className="ph">
            <h3>Clients <span className="hl">by hours · {clientsAll.length}</span></h3>
            <div className="seg-pill">
              <button type="button" className={clientTab === "top" ? "on" : ""} onClick={() => setClientTab("top")}>▲ Top 5</button>
              <button type="button" className={clientTab === "bottom" ? "on" : ""} onClick={() => setClientTab("bottom")}>▼ Bottom 5</button>
            </div>
          </div>
          {clientsAll.length ? (
            <div className="tb-card">
              {(clientTab === "top" ? topClients : botClients).map((c, i) => (
                <div className="tb-row" key={c.client + i}>
                  <span className="tb-rank">{i + 1}</span>
                  <span className="dot" style={{ background: clColor(c.category) }} />
                  <span className="tb-nm" title={c.client}>{c.client}</span>
                  <b className="num">{n0(c.hours)}h</b>
                </div>
              ))}
              {clientTab === "bottom" && botClients.length === 0 && <div className="empty-s">Not enough clients</div>}
            </div>
          ) : <div className="empty-s">No client data in scope</div>}
        </div>
        <div className="panel">
          <div className="ph"><h3>Client Health <span className="hl">active · at-risk · inactive</span></h3></div>
          {chTotal > 0 ? (
            <div className="donut-wrap">
              <div style={{ width: 150 }}><Donut data={chData} colors={["#0f9043", "#bd8616", "#d23f43"]} height={180} center={{ value: String(chTotal), label: "Clients" }} /></div>
              <div className="legend">
                {chData.map((s, i) => (
                  <div className="li" key={s.name}><span className="dot" style={{ background: ["#0f9043", "#bd8616", "#d23f43"][i] }} /><span className="nm">{s.name}</span><span className="vl">{s.value}</span><span className="pc">{chTotal ? Math.round((s.value / chTotal) * 100) : 0}%</span></div>
                ))}
              </div>
            </div>
          ) : <div className="empty-s">No client data in scope</div>}
        </div>
        <div className="panel">
          <div className="ph"><h3>Billing Type <span className="hl">hours · Fixed vs Hourly</span></h3></div>
          {billTypeTotal > 0 ? (
            <div className="donut-wrap">
              <div style={{ width: 150 }}><Donut data={billType} colors={["#2f6fbf", "#0f9043", "#9aa3b2"]} height={180} center={{ value: n0(billTypeTotal) + "h", label: "Total" }} /></div>
              <div className="legend">
                {billType.map((s, i) => (
                  <div className="li" key={s.name}><span className="dot" style={{ background: ["#2f6fbf", "#0f9043", "#9aa3b2"][i] }} /><span className="nm">{s.name}</span><span className="vl">{n0(s.value)}h</span><span className="pc">{billTypeTotal ? Math.round((s.value / billTypeTotal) * 100) : 0}%</span></div>
                ))}
              </div>
            </div>
          ) : <div className="empty-s">No billing data in scope</div>}
        </div>
      </div>

      {/* PERFORMANCE */}
      <div className="sec"><h4>Performance</h4></div>
      <div className="row2">
        <div className="panel">
          <div className="ph"><h3>Performance Matrix <span className="hl">utilization × productivity · bubble = billable hrs</span></h3></div>
          {bubble.length > 1 ? <Bubble points={bubble} height={300} /> : <div className="empty-s">Select a broader scope to compare people</div>}
        </div>
        <div className="panel">
          <div className="ph">
            <h3>Performers <span className="hl">by grade</span></h3>
            <div className="seg-pill">
              <button type="button" className={perfTab === "top" ? "on" : ""} onClick={() => setPerfTab("top")}>▲ Top 3</button>
              <button type="button" className={perfTab === "bottom" ? "on" : ""} onClick={() => setPerfTab("bottom")}>▼ Bottom 3</button>
            </div>
          </div>
          <div className="tb-card">
            {(perfTab === "top" ? data.top3 : data.bottom3).map((e, i) => (
              <div className="tb-row perf kclk" key={e.name + i} onClick={() => openEmployee(e.name)}>
                <span className="tb-rank">{i + 1}</span>
                <span className="avatar sm" style={{ background: avatarColor(e.name) }}>{initials(e.name)}</span>
                <span className="tb-nm"><b>{e.name}</b><i>{e.team}</i></span>
                <span className="num pf-u">{n0(e.utilization)}%</span>
                <span className={`grade ${gradeCls(e.grade)}`}>{e.grade}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* COMPARISON — department-wise / team-wise (storage-style bars + status cards) */}
      {(() => {
        const rows = cmpDim === "department" ? (data.departments || []) : data.teams;
        if (!rows.length) return null;
        const maxH = Math.max(1, ...rows.map((r) => r.total));
        const niceTop = Math.ceil((maxH * 1.08) / 1000) * 1000 || 1000;
        const fk = (v: number) => (v >= 1000 ? (v / 1000).toFixed(v >= 10000 ? 0 : 1).replace(/\.0$/, "") + "k" : String(Math.round(v)));
        const lowKey = rows.reduce((a, b) => (b.utilization < a.utilization ? b : a)).team;
        return (
          <>
            <div className="sec"><h4>Comparison</h4></div>
            <div className="panel" style={{ marginBottom: 14 }}>
              <div className="ph">
                <h3><BarChart3 size={16} style={{ color: "#ed7d31", verticalAlign: "-3px", marginRight: 7 }} />Hours by {cmpDim === "department" ? "Department" : "Team"}</h3>
                <div className="seg-pill" role="group">
                  {([["department", "Department"], ["team", "Team"]] as const).map(([v, lbl]) => (
                    <button key={v} type="button" className={cmpDim === v ? "on" : ""} onClick={() => setCmpDim(v)}>{lbl}</button>
                  ))}
                </div>
              </div>
              <div className="modbar">
                <div className="modbar-y">{[1, 0.75, 0.5, 0.25, 0].map((f) => <span key={f}>{fk(niceTop * f)}</span>)}</div>
                <div className="modbar-main">
                  <div className="modbar-plot">
                    {[0, 0.25, 0.5, 0.75, 1].map((f) => <div className="modbar-grid" key={f} style={{ bottom: `${f * 100}%` }} />)}
                    <div className="modbar-bars">
                      {rows.map((r) => {
                        const hp = Math.max(3, (r.total / niceTop) * 100);
                        return (
                          <div className="modbar-track" key={r.team} title={`${r.team}: ${n0(r.total)}h · ${n0(r.utilization)}% util`}>
                            <div className={`modbar-fill${r.team === lowKey ? " hi" : ""}`} style={{ height: `${hp}%` }}>
                              <span className="modbar-val">{n0(r.total)}h</span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                  <div className="modbar-xrow">{rows.map((r) => <span className="modbar-x" key={r.team} title={r.team}>{r.team}</span>)}</div>
                </div>
              </div>
              <div className="modcards">
                {rows.map((r) => {
                  const good = r.utilization >= 60;
                  return (
                    <div className="modcard" key={r.team}>
                      <div className="modcard-l">
                        <div className="nm">{r.team}</div>
                        <div className={`mt${good ? "" : " bad"}`}>Utilization: {n0(r.utilization)}%</div>
                      </div>
                      {good
                        ? <ShieldCheck size={26} style={{ color: "#16a34a", flexShrink: 0 }} />
                        : <ShieldAlert size={26} style={{ color: "#d23f43", flexShrink: 0 }} />}
                    </div>
                  );
                })}
              </div>
            </div>
          </>
        );
      })()}

      {/* EMPLOYEE → CLIENTS */}
      <div className="sec"><h4>Employees &amp; Clients</h4></div>
      <div className="panel" style={{ marginBottom: 14 }}>
        <div className="ph"><h3>Which employee works on which clients <span className="hl">all clients each person handles · billable hours</span></h3></div>
        <div className="scrollwrap" style={{ maxHeight: 460 }}>
          <table className="ec-table">
            <thead><tr><th className="l">Employee</th><th>Grade</th><th>Billable</th><th className="l">Clients</th></tr></thead>
            <tbody>
              {empClients.map((e, i) => {
                const cls = e.clients || [];
                return (
                  <tr key={e.name + i} className="click" onClick={() => openEmployee(e.name)}>
                    <td className="l"><span className="emp-c"><span className="avatar" style={{ background: avatarColor(e.name) }}>{initials(e.name)}</span><span><span className="tname">{e.name}</span><span className="ec-team">{e.team}</span></span></span></td>
                    <td><span className={`grade ${gradeCls(e.grade)}`}>{e.grade}</span></td>
                    <td className="num">{n0(e.billable)}h</td>
                    <td className="l">
                      <div className="chips">
                        {cls.slice(0, 8).map((c) => <span className="chip" key={c} title={c}>{c}</span>)}
                        {cls.length > 8 && <span className="chip more">+{cls.length - 8}</span>}
                        {cls.length === 0 && <span style={{ color: "var(--faint)" }}>—</span>}
                      </div>
                    </td>
                  </tr>
                );
              })}
              {empClients.length === 0 && <tr><td colSpan={4} style={{ textAlign: "center", padding: 24, color: "var(--muted)" }}>No data in scope</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      <div className="foot">Synced from Hubstaff · ClickUp — {live ? "Supabase (Live)" : "CSV (Demo)"} · capacity 8h/day · Non-billable = tasks/projects marked “NB”</div>

      {/* TASK / PROJECT drill-down list */}
      {bdModal && (() => {
        const { kind, mode } = bdModal;
        const src = (kind === "task" ? bdList?.by_task : bdList?.by_project) || [];
        const pick = (r: { total: number; billable: number; non_billable: number }) =>
          mode === "nonbillable" ? r.non_billable : mode === "billable" ? r.billable : r.total;
        const rows = src.filter((r) => pick(r) > 0).sort((a, b) => pick(b) - pick(a));
        const max = Math.max(1, ...rows.map(pick));
        const kLbl = kind === "task" ? "Task" : "Project";
        const color = mode === "nonbillable" ? "#9aa3b2" : "#0f9043";
        const title = mode === "billable" ? `Billable ${kLbl}s` : mode === "nonbillable" ? `Non-Billable ${kLbl}s` : `Time by ${kLbl}`;
        return (
          <div className="modal-bg" onClick={() => setBdModal(null)}>
            <div className="modal" onClick={(e) => e.stopPropagation()}>
              <div className="modal-h">
                <div>
                  <h3>{title}</h3>
                  <div className="sub">{bdList ? `${rows.length} ${kLbl.toLowerCase()}s${kind === "project" ? " (no task)" : ""}` : "loading…"} · {data.context.label}</div>
                </div>
                <div className="modal-x" onClick={() => setBdModal(null)}><X size={16} /></div>
              </div>
              <div className="modal-b">
                {!bdList ? <div className="loading" style={{ height: 160 }}><span className="spin" /> Loading…</div> : (
                  <table>
                    <thead><tr><th className="l">#</th><th className="l">{kLbl}</th><th className="l">{mode === "all" ? "Billable / Non-Billable" : "Share"}</th><th>{mode === "all" ? "Total" : "Hours"}</th></tr></thead>
                    <tbody>
                      {rows.map((r, i) => {
                        const v = pick(r);
                        const bilW = r.total ? (r.billable / r.total) * 100 : 0;
                        return (
                          <tr key={r.name + i}>
                            <td className="l" style={{ color: "var(--faint)", fontWeight: 700 }}>{i + 1}</td>
                            <td className="l tname">{r.name}</td>
                            <td className="l">
                              {mode === "all"
                                ? <span className="brkbar"><span className="brkbar-t"><span className="bil" style={{ width: `${bilW}%` }} /><span className="nbil" style={{ width: `${100 - bilW}%` }} /></span></span>
                                : <span className="brkbar"><span className="brkbar-t"><span style={{ width: `${(v / max) * 100}%`, background: color, height: "100%" }} /></span></span>}
                            </td>
                            <td className="num" style={{ fontWeight: 750 }}>{n0(v)}h</td>
                          </tr>
                        );
                      })}
                      {rows.length === 0 && <tr><td colSpan={4} style={{ textAlign: "center", padding: 24, color: "var(--muted)" }}>No data in scope</td></tr>}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          </div>
        );
      })()}

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
                      <tr key={r.name + i}>
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

      {/* EMPLOYEE DETAIL DRAWER */}
      {emp && (
        <div className="drawer-bg" onClick={() => setEmp(null)}>
          <div className="drawer" onClick={(e) => e.stopPropagation()}>
            {!emp.data ? <div className="loading" style={{ height: "100%" }}><span className="spin" /> Loading…</div> :
              !emp.data.found ? <div className="loading" style={{ height: "100%" }}>Not found</div> : (() => {
                const p = emp.data.profile!;
                const daily = emp.data.daily || [];
                const tasks = emp.data.tasks || [];
                return (
                  <>
                    <div className="drawer-h">
                      <div className="emp-hero">
                        <span className="avatar lg" style={{ background: avatarColor(p.name) }}>{initials(p.name)}</span>
                        <div><div className="nm">{p.name}</div><div className="tm">{p.team} · {p.department}{p.role ? ` · ${p.role}` : ""}</div></div>
                      </div>
                      <div className="modal-x" onClick={() => setEmp(null)}><X size={16} /></div>
                    </div>
                    <div className="drawer-b">
                      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
                        <span className={`grade ${gradeCls(p.grade)}`} style={{ fontSize: 13, padding: "4px 11px" }}>{p.grade}</span>
                        <span className={`stt ${p.task_status}`}><span className="d" />{p.task_status} · {p.active_tasks} active tasks</span>
                      </div>
                      <div className="mini-kpis">
                        <div className="mini-k"><div className="l">Billable</div><div className="v num">{n0(p.billable)}h</div></div>
                        <div className="mini-k"><div className="l">Non-Bill</div><div className="v num">{n0(p.non_billable)}h</div></div>
                        <div className="mini-k"><div className="l">Utilization</div><div className="v num">{n0(p.utilization)}%</div></div>
                        <div className="mini-k"><div className="l">Activity</div><div className="v num">{n0(p.activity)}%</div></div>
                        <div className="mini-k"><div className="l">Productivity</div><div className="v num">{n0(p.productivity)}%</div></div>
                        <div className="mini-k"><div className="l">Active Days</div><div className="v num">{p.days}</div></div>
                      </div>
                      <div className="drawer-sec">Daily Hours Trend</div>
                      <TrendLines data={daily.map((d) => ({ date: d.date, billable: d.billable, non_billable: d.non_billable }))} height={200} />
                      <div className="drawer-sec">Assigned Tasks ({tasks.length})</div>
                      <div className="scrollwrap" style={{ maxHeight: 280 }}>
                        <table>
                          <thead><tr><th className="l">Task</th><th className="l">Client</th><th className="l">Status</th><th>Tracked</th></tr></thead>
                          <tbody>
                            {tasks.slice(0, 50).map((t, i) => (
                              <tr key={i}><td className="l tname">{String(t.task)}</td><td className="l" style={{ color: "var(--muted)" }}>{String(t.client || "—")}</td><td className="l" style={{ color: "var(--muted)" }}>{String(t.status || "—")}</td><td className="num">{n1(Number(t.tracked || 0))}h</td></tr>
                            ))}
                            {tasks.length === 0 && <tr><td colSpan={4} style={{ textAlign: "center", padding: 16, color: "var(--muted)" }}>No tasks</td></tr>}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </>
                );
              })()}
          </div>
        </div>
      )}

      {/* FLOATING AI CHAT */}
      <button className={`ai-fab${chatOpen ? " open" : ""}`} onClick={() => setChatOpen((o) => !o)} title="Ask Insight AI" aria-label="Ask AI">
        {chatOpen ? <X size={20} /> : <Sparkles size={20} />}
      </button>
      {chatOpen && (
        <div className="ai-chat">
          <div className="ai-chat-h">
            <div className="ai-chat-title"><span className="ai-chat-ic"><Sparkles size={16} /></span><div><b>Insight AI</b><span>powered by Gemini · live data</span></div></div>
            <button className="ai-chat-x" onClick={() => setChatOpen(false)}><X size={16} /></button>
          </div>
          <div className="ai-chat-body" ref={chatRef}>
            {messages.length === 0 && (
              <div className="ai-welcome">
                <span className="ai-welcome-ic"><Sparkles size={22} /></span>
                <p>Hi! Main aapka operations assistant hoon — teams, clients, hours, performance pe koi bhi sawaal poochho. Chart ke saath jawab dunga.</p>
                <div className="chipsai">{AI_SUGGESTIONS.map((s) => <span key={s} className="aichip" onClick={() => ask(s)}>{s}</span>)}</div>
              </div>
            )}
            {messages.map((m, i) => (m.role === "user" ? (
              <div className="msg user" key={i}>{m.text}</div>
            ) : (
              <div className="msg ai" key={i}>
                <span className="msg-ic"><Sparkles size={13} /></span>
                <div className="msg-body">
                  <div className="msg-text">{m.text}</div>
                  {m.kind === "bar" && m.bars && m.bars.length > 0 && <div className="msg-chart"><BarList items={m.bars} /></div>}
                  {m.kind === "donut" && m.donut && (
                    <div className="donut-wrap msg-chart" style={{ marginTop: 8 }}>
                      <div style={{ width: 110 }}><Donut data={m.donut.data} colors={m.donut.colors} height={130} center={m.donut.center} /></div>
                      <div className="legend">{m.donut.data.map((d, j) => <div className="li" key={d.name + j}><span className="dot" style={{ background: m.donut!.colors[j % m.donut!.colors.length] }} /><span className="nm">{d.name}</span><span className="vl">{n0(d.value)}</span></div>)}</div>
                    </div>
                  )}
                </div>
              </div>
            )))}
            {aiBusy && <div className="msg ai"><span className="msg-ic"><Sparkles size={13} /></span><div className="msg-body"><div className="typing"><span /><span /><span /></div></div></div>}
          </div>
          <div className="ai-chat-input">
            <input placeholder="Ask anything…" value={aiQ} disabled={aiBusy} onChange={(e) => setAiQ(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") ask(aiQ); }} />
            <button onClick={() => ask(aiQ)} disabled={aiBusy || !aiQ.trim()}>{aiBusy ? <span className="spin sm" /> : <Send size={15} />}</button>
          </div>
        </div>
      )}
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
