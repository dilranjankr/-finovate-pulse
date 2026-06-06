"use client";

import { useState, useMemo, useRef, useEffect } from "react";
import {
  ArrowUp, ArrowDown, CheckCircle2, ChevronRight, ChevronDown, Search, X, Download, Filter,
  AlertTriangle, Activity, ListTodo, FileWarning, Coffee, Clock, Receipt,
  Database, RefreshCw, Users, Building2, Network, Briefcase, CalendarDays,
  ListChecks, CheckSquare, Gauge, Sparkles, Send, RotateCcw,
} from "lucide-react";
import {
  getFilters, getCommand, getRaw, getEmployee, askAI,
  type FilterOptions, type CommandData, type Filters, type KpiVal, type RawData, type EmployeeDetail,
} from "../lib/api";
import { Sparkline, TrendLines, Donut, GradeBars, RadialGauge, Bubble, BarList, TeamGauges, DeptColumns } from "./Charts";

const n0 = (v: number) => Math.round(v).toLocaleString("en-US");
const n1 = (v: number) => v.toLocaleString("en-US", { maximumFractionDigits: 1 });
const TASKCOL = ["#0f9043", "#2f6fbf", "#bd8616", "#d23f43"];
const HEALTHCOL = ["#0f9043", "#bd8616", "#d23f43"];

const PRIMARY = [
  { key: "total_hours", label: "Total Hours", color: "#203070", type: "spark", Icon: Clock, ibg: "#e9ecf7", ifg: "#203070" },
  { key: "billable_hours", label: "Billable Hours", color: "#0f9043", type: "spark", Icon: Receipt, ibg: "#e3f3e9", ifg: "#0f9043" },
  { key: "utilization", label: "Utilization", color: "#203070", type: "gauge" },
  { key: "activity", label: "Activity", color: "#2f6fbf", type: "gauge" },
  { key: "productivity", label: "Productivity", color: "#0f9043", type: "gauge" },
  { key: "avg_grade", label: "Avg Grade", color: "#203070", type: "grade" },
] as const;
const COL_LABEL: Record<string, string> = {
  name: "Name", employee: "Employee", task: "Task", team_size: "Size", billable: "Billable",
  non_billable: "Non-Bill", utilization: "Utilization", activity: "Activity", productivity: "Prod.",
  grade: "Grade", budget: "Budget", variance: "Variance", status: "Status", client: "Client",
  estimated: "Est. Hrs", tracked: "Tracked", due: "Due", days: "Days", total: "Total",
  avg_day: "Avg/Day", tasks: "Active Tasks", task_status: "Task",
  date: "Date", team: "Team", client_type: "Type", tracked_h: "Tracked Hrs", overall_h: "Active Hrs",
};

function fmtKpi(v: number | string, unit: string): string {
  if (typeof v === "string") return v;
  if (unit === "$") return "$" + n0(v);
  if (unit === "%") return n1(v) + "%";
  if (unit === "h") return n0(v) + "h";
  return n1(v);
}
function gradeCls(g: string) {
  if (g.startsWith("A")) return "gA";
  if (g === "B+") return "gB";
  if (g === "B") return "gBb";
  if (g.startsWith("C")) return "gC";
  return "gD";
}
const utilColor = (u: number) => (u >= 75 ? "#0f9043" : u >= 60 ? "#bd8616" : "#d23f43");
function avatarColor(s: string) {
  const c = ["#203070", "#0f9043", "#2f6fbf", "#d9882a", "#7b3fc0", "#0d9488"];
  let h = 0; for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) % 9973;
  return c[h % c.length];
}
const initials = (s: string) => s.split(" ").filter(Boolean).slice(0, 2).map((x) => x[0]).join("").toUpperCase();

type AiRes = {
  text: string;
  kind: "bar" | "donut" | "none";
  bars?: { label: string; value: number; color?: string }[];
  donut?: { data: { name: string; value: number }[]; colors: string[]; center?: { value: string; label: string } };
  unit?: string;
};
const AI_SUGGESTIONS = ["Top performers", "Lowest utilization team", "Billable mix", "Overdue tasks", "Client health", "Busiest department"];

export default function CommandCenter({
  initialOpts, initialData,
}: { initialOpts: FilterOptions | null; initialData: CommandData | null }) {
  const [opts, setOpts] = useState<FilterOptions | null>(initialOpts);
  const [draft, setDraft] = useState<Filters>(
    initialOpts ? { date_from: initialOpts.date_min, date_to: initialOpts.date_max } : {}
  );
  const [data, setData] = useState<CommandData | null>(initialData);
  const [loading, setLoading] = useState(false);
  const [showFilters, setShowFilters] = useState(true);
  const [modal, setModal] = useState<null | "employees" | "clients" | "raw">(null);
  const [search, setSearch] = useState("");
  const [raw, setRaw] = useState<RawData | null>(null);
  const [emp, setEmp] = useState<{ name: string; data: EmployeeDetail | null } | null>(null);
  const [aiQ, setAiQ] = useState("");
  const [aiBusy, setAiBusy] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [messages, setMessages] = useState<(AiRes & { role: "user" | "ai" })[]>([]);
  const chatBodyRef = useRef<HTMLDivElement>(null);
  const [perfTab, setPerfTab] = useState<"top" | "bottom">("top");

  useEffect(() => {
    if (chatBodyRef.current) chatBodyRef.current.scrollTop = chatBodyRef.current.scrollHeight;
  }, [messages, aiBusy, chatOpen]);

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
  function clearFilters() { const base: Filters = opts ? { date_from: opts.date_min, date_to: opts.date_max } : {}; setDraft(base); refetchOpts({}); apply(base); }
  function drill(row: Record<string, unknown>) {
    const lvl = data?.context.level;
    if (lvl === "company") setDept(String(row.name));
    else if (lvl === "department") setAtl(String(row.name));
    else if (lvl === "atl") openEmployee(String(row.employee));
  }
  function exportCSV(name: string, cols: string[], rows: Record<string, unknown>[], labels: Record<string, string>) {
    const esc = (x: unknown) => `"${String(x ?? "").replace(/"/g, '""')}"`;
    const head = cols.map((c) => labels[c] || c).join(",");
    const body = rows.map((r) => cols.map((c) => esc(r[c])).join(",")).join("\n");
    const blob = new Blob([head + "\n" + body], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob);
    a.download = `${name}_${draft.date_from}_${draft.date_to}.csv`; a.click();
  }
  async function openRaw() { setModal("raw"); setRaw(null); try { setRaw(await getRaw(draft)); } catch { setRaw({ rows: [], total: 0, shown: 0 }); } }
  async function openEmployee(name: string) {
    setEmp({ name, data: null });
    try { setEmp({ name, data: await getEmployee(name, draft) }); } catch { setEmp({ name, data: { found: false } }); }
  }

  const peopleRows = useMemo(() => {
    if (!data) return [];
    const q = search.trim().toLowerCase();
    return q ? data.employees.filter((e) => e.name.toLowerCase().includes(q) || e.team.toLowerCase().includes(q)) : data.employees;
  }, [data, search]);

  if (!data) return <div className="page"><div className="loading"><span className="spin" /> Loading…</div></div>;

  const live = data.source === "supabase";
  const dist = data.hours_distribution;
  const distTotal = dist.reduce((s, x) => s + x.value, 0);
  const taskTotal = data.task_summary.reduce((s, x) => s + x.value, 0);
  const bva = data.budget_vs_actual;
  const bvaMax = Math.max(bva.budget, bva.actual, 1);
  const tbl = data.table;
  const alertIcons = [AlertTriangle, Activity, ListTodo, Coffee, FileWarning];
  const alertColors = ["#d23f43", "#df8327", "#bd8616", "#2f6fbf", "#8a93a3"];
  const sm = data.summary;
  const ch = data.client_health, ph = data.project_health, res = data.resource;
  const chTotal = ch.active + ch.at_risk + ch.inactive;
  const phTotal = ph.on_track + ph.at_risk + ph.delayed;

  const bubble = data.employees.map((e) => ({
    x: e.utilization, y: e.productivity, z: Math.max(e.billable, 1), name: e.name,
    color: e.grade.startsWith("A") ? "#0f9043" : e.grade.startsWith("B") ? "#2f6fbf" : e.grade.startsWith("C") ? "#bd8616" : "#d23f43",
  }));

  // Hours trend + 7-day forecast (avg of last 7 billable days, projected forward)
  const trendData = (() => {
    const base = data.hours_trend.map((d) => ({ date: d.date, billable: d.billable as number | null, non_billable: d.non_billable as number | null, forecast: undefined as number | undefined }));
    if (base.length < 3) return base;
    const last7 = data.hours_trend.slice(-7);
    const avg = last7.reduce((s, d) => s + d.billable, 0) / (last7.length || 1);
    base[base.length - 1].forecast = base[base.length - 1].billable ?? avg;
    const lastDate = new Date(data.hours_trend[data.hours_trend.length - 1].date);
    for (let i = 1; i <= 7; i++) {
      const nd = new Date(lastDate); nd.setDate(nd.getDate() + i);
      base.push({ date: nd.toISOString().slice(0, 10), billable: null, non_billable: null, forecast: Math.round(avg * 10) / 10 });
    }
    return base;
  })();

  // Team utilization → multi-ring gauge (top 6 by total hours)
  const teamGauge = [...data.teams]
    .sort((a, b) => b.total - a.total)
    .slice(0, 6)
    .map((t) => ({ name: t.team, value: t.utilization }));

  function runAI(q: string): AiRes {
    if (!data) return { text: "", kind: "none" };
    const s = q.toLowerCase();
    const emps = data.employees, teams = data.teams, clients = data.clients_summary;
    if (/client/.test(s) && /(active|inactive|health|risk)/.test(s)) {
      const c = data.client_health;
      return { text: `${c.active} active, ${c.at_risk} at-risk, ${c.inactive} inactive clients.`, kind: "bar", bars: [{ label: "Active", value: c.active, color: "#0f9043" }, { label: "At Risk", value: c.at_risk, color: "#bd8616" }, { label: "Inactive", value: c.inactive, color: "#d23f43" }] };
    }
    if (/(top|best).*(client)|client.*(top|best|hour)/.test(s)) {
      const t = [...clients].sort((a, b) => b.hours - a.hours).slice(0, 7);
      return { text: `Top client by hours: ${t[0]?.client} (${n0(t[0]?.hours || 0)}h).`, kind: "bar", bars: t.map((c) => ({ label: c.client, value: c.hours })), unit: "h" };
    }
    if (/(top|best|highest).*(perform|employee|people|billable)/.test(s)) {
      const t = [...emps].sort((a, b) => b.billable - a.billable).slice(0, 8);
      return { text: `Top performer: ${t[0]?.name} — ${n0(t[0]?.billable || 0)}h billable, grade ${t[0]?.grade}.`, kind: "bar", bars: t.map((e) => ({ label: e.name, value: e.billable, color: "#0f9043" })), unit: "h" };
    }
    if (/(bottom|worst|lowest)/.test(s) && /(perform|employee|people|util)/.test(s)) {
      const t = [...emps].sort((a, b) => a.utilization - b.utilization).slice(0, 8);
      return { text: `Lowest utilization: ${t[0]?.name} (${n0(t[0]?.utilization || 0)}%).`, kind: "bar", bars: t.map((e) => ({ label: e.name, value: e.utilization, color: "#d23f43" })), unit: "%" };
    }
    if (/util/.test(s) && /(team|department|dept)/.test(s)) {
      const t = [...teams].sort((a, b) => b.utilization - a.utilization);
      return { text: `Highest: ${t[0]?.team} (${n0(t[0]?.utilization || 0)}%) · Lowest: ${t[t.length - 1]?.team} (${n0(t[t.length - 1]?.utilization || 0)}%).`, kind: "bar", bars: t.slice(0, 10).map((x) => ({ label: x.team, value: x.utilization })), unit: "%" };
    }
    if (/billable|non.?billable|\bmix\b/.test(s)) {
      const d = data.hours_distribution, tot = d.reduce((a, b) => a + b.value, 0);
      return { text: `${tot ? Math.round(d[0].value / tot * 100) : 0}% billable (${n0(d[0].value)}h) · ${tot ? Math.round(d[1].value / tot * 100) : 0}% non-billable (${n0(d[1].value)}h).`, kind: "donut", donut: { data: d, colors: ["#0f9043", "#cdd4e0"], center: { value: n0(tot) + "h", label: "Total" } } };
    }
    if (/idle|inactive|offline|not.?active/.test(s)) {
      const la = data.live_activity;
      return { text: `${la.active} active · ${la.idle} idle · ${la.offline} offline employees.`, kind: "bar", bars: [{ label: "Active", value: la.active, color: "#0f9043" }, { label: "Idle", value: la.idle, color: "#bd8616" }, { label: "Offline", value: la.offline, color: "#8a93a3" }] };
    }
    if (/grade/.test(s)) {
      const g = data.grade_distribution, top = [...g].sort((a, b) => b.count - a.count)[0];
      return { text: `Most common grade: ${top?.grade} (${top?.count} employees).`, kind: "bar", bars: g.map((x) => ({ label: x.grade, value: x.count })) };
    }
    if (/task|overdue|completed|progress|review/.test(s)) {
      const t = data.task_summary, tot = t.reduce((a, b) => a + b.value, 0);
      return { text: `${n0(tot)} tasks — ${n0(t.find((x) => x.name === "Completed")?.value || 0)} completed, ${n0(t.find((x) => x.name === "Overdue")?.value || 0)} overdue.`, kind: "donut", donut: { data: t, colors: TASKCOL, center: { value: n0(tot), label: "Tasks" } } };
    }
    if (/department|dept|busiest|compare|hours.*team|team.*hours/.test(s)) {
      const rows = data.context.level === "company"
        ? data.table.rows.map((r) => ({ label: String(r.name), value: Number(r.billable) + Number(r.non_billable || 0) }))
        : teams.map((t) => ({ label: t.team, value: t.total }));
      const sorted = [...rows].sort((a, b) => b.value - a.value);
      return { text: `Busiest: ${sorted[0]?.label} (${n0(sorted[0]?.value || 0)}h).`, kind: "bar", bars: sorted.slice(0, 10), unit: "h" };
    }
    const k = data.kpis;
    return { text: `Overview: ${n0(Number(k.total_hours.value))}h tracked · ${n0(Number(k.billable_hours.value))}h billable · ${k.utilization.value}% utilization · grade ${k.avg_grade.value}. Try: "top performers", "lowest utilization team", "billable mix", "overdue tasks", "client health".`, kind: "none" };
  }
  async function ask(q: string) {
    const question = q.trim();
    if (!question || aiBusy) return;
    setAiQ("");
    setMessages((m) => [...m, { role: "user", text: question, kind: "none" }]);
    setAiBusy(true);
    const push = (res: AiRes) => setMessages((m) => [...m, { ...res, role: "ai" }]);
    try {
      const r = await askAI(question, draft);
      if (r.ok && r.text) push({ text: r.text, kind: r.kind || "none", bars: r.bars, donut: r.donut });
      else push(runAI(question)); // no Gemini key / error → local engine
    } catch {
      push(runAI(question));
    } finally {
      setAiBusy(false);
    }
  }

  function cell(col: string, r: Record<string, unknown>) {
    const v = r[col];
    if (col === "employee") return <span className="tname clk" onClick={(ev) => { ev.stopPropagation(); openEmployee(String(v)); }}>{String(v)}</span>;
    if (col === "name" || col === "task") return <span className="tname">{String(v)}</span>;
    if (col === "grade") return <span className={`grade ${gradeCls(String(v))}`}>{String(v)}</span>;
    if (col === "status" || col === "task_status" || col === "billable") {
      if (col === "billable") return <span style={{ color: v === "Billable" ? "var(--green)" : "var(--muted)", fontWeight: 600 }}>{String(v)}</span>;
      return <span className={`stt ${v}`}><span className="d" />{String(v)}</span>;
    }
    if (col === "client" || col === "due" || col === "date" || col === "team" || col === "client_type" || col === "department") return <span style={{ color: "var(--muted)" }}>{String(v)}</span>;
    if (col === "utilization") { const u = Number(v); return <span className="util"><span className="bar"><span className="fill" style={{ width: `${u}%`, background: utilColor(u) }} /></span><span className="pc">{n0(u)}%</span></span>; }
    if (col === "activity" || col === "productivity") return <span className="num">{n0(Number(v))}%</span>;
    if (col === "tasks" || col === "days" || col === "team_size") return <span className="num">{String(v)}</span>;
    if (["avg_day", "estimated", "tracked", "tracked_h", "overall_h"].includes(col)) return <span className="num">{n1(Number(v))}h</span>;
    if (["non_billable", "budget", "total"].includes(col)) return <span className="num">{n0(Number(v))}h</span>;
    return <span className="num">{String(v)}</span>;
  }

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

      {/* FILTERS — clean toolbar */}
      {showFilters && (() => {
        const activeCount = [draft.department, draft.atl, draft.employee, draft.client, draft.client_type].filter(Boolean).length;
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
            {activeCount > 0 && (
              <button className="fclear" onClick={clearFilters} title="Clear all filters">
                <RotateCcw size={13} />Clear all<span className="fcnt">{activeCount}</span>
              </button>
            )}
          </div>
        );
      })()}

      {/* PERFORMANCE TABLE */}
      <div className="sec"><h4>Performance · {data.context.view}</h4></div>
      <div className="panel hero">
        <div className="ph">
          <div className="stt" style={{ color: "var(--muted)", fontWeight: 600 }}>
            <span style={{ cursor: "pointer", color: draft.department ? "var(--navy)" : "inherit" }} onClick={clearFilters}>Company</span>
            {draft.department && <><ChevronRight size={13} /><b>{draft.department}</b></>}
            {draft.atl && <><ChevronRight size={13} /><b>{draft.atl}</b></>}
            {draft.employee && <><ChevronRight size={13} /><b>{draft.employee}</b></>}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <button className="exportbtn" onClick={() => exportCSV(`performance_${data.context.level}`, tbl.columns, tbl.rows, COL_LABEL)}><Download />Export CSV</button>
            <span className="hl" style={{ color: "var(--muted)", fontSize: 11 }}>{tbl.rows.length} rows{data.context.level !== "employee" && " · click to drill"}</span>
          </div>
        </div>
        <table>
          <thead><tr>{tbl.columns.map((c, i) => <th key={c} className={i === 0 ? "l" : ""}>{COL_LABEL[c] || c}</th>)}</tr></thead>
          <tbody>
            {tbl.rows.map((r, ri) => (
              <tr key={ri} className={data.context.level !== "employee" ? "click" : ""} onClick={() => data.context.level !== "employee" && drill(r)}>
                {tbl.columns.map((c, i) => <td key={c} className={i === 0 ? "l" : ""}>{cell(c, r)}</td>)}
              </tr>
            ))}
            {tbl.rows.length === 0 && <tr><td colSpan={tbl.columns.length} style={{ textAlign: "center", padding: 24, color: "var(--muted)" }}>No data</td></tr>}
          </tbody>
        </table>
      </div>

      {/* ACTION BAR */}
      <div className="actionbar">
        <button className="actbtn" onClick={() => setModal("employees")}><Users />All Employees</button>
        <button className="actbtn" onClick={() => setModal("clients")}><Briefcase />All Clients</button>
        <button className="actbtn" onClick={openRaw}><Database />Raw Data</button>
        <button className="actbtn" onClick={() => exportCSV(`performance_${data.context.level}`, tbl.columns, tbl.rows, COL_LABEL)}><Download />Export Report</button>
        <button className="actbtn primary" onClick={() => apply(draft)}><RefreshCw />Data Sync</button>
      </div>

      <div className="foot">Synced from Hubstaff · ClickUp — {live ? "Supabase (Live)" : "CSV (Demo)"} · {opts?.total_members} members · Non-billable = internal depts (HR/Admin/Marketing)</div>

      {/* FLOATING AI CHAT */}
      <button className={`ai-fab${chatOpen ? " open" : ""}`} onClick={() => setChatOpen((o) => !o)} title="Ask Insight AI" aria-label="Ask AI">
        {chatOpen ? <X size={20} /> : <Sparkles size={20} />}
      </button>
      {chatOpen && (
        <div className="ai-chat">
          <div className="ai-chat-h">
            <div className="ai-chat-title">
              <span className="ai-chat-ic"><Sparkles size={16} /></span>
              <div><b>Insight AI</b><span>powered by Gemini · live data</span></div>
            </div>
            <button className="ai-chat-x" onClick={() => setChatOpen(false)}><X size={16} /></button>
          </div>
          <div className="ai-chat-body" ref={chatBodyRef}>
            {messages.length === 0 && (
              <div className="ai-welcome">
                <span className="ai-welcome-ic"><Sparkles size={22} /></span>
                <p>Hi! Main aapka operations assistant hoon — team performance, clients, hours, ya koi bhi sawaal poochho. Charts ke saath jawab dunga.</p>
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
                  {m.kind === "bar" && m.bars && m.bars.length > 0 && <div className="msg-chart"><BarList items={m.bars} unit={m.unit || ""} /></div>}
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

      {/* MODALS */}
      {modal && (
        <div className="modal-bg" onClick={() => setModal(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-h">
              <div>
                <h3>{modal === "employees" ? "All Employees" : modal === "clients" ? "All Clients" : "Raw Activity Data"}</h3>
                <div className="sub">{modal === "employees" ? `${data.employees.length} employees` : modal === "clients" ? `${data.clients_summary.length} clients` : raw ? `${n0(raw.shown)} of ${n0(raw.total)} rows` : "loading…"} · {data.context.label}</div>
              </div>
              <div style={{ display: "flex", gap: 10 }}>
                {modal === "employees" && <button className="exportbtn" onClick={() => exportCSV("people", ["name", "team", "days", "billable", "non_billable", "utilization", "activity", "productivity", "grade", "active_tasks", "task_status"], data.employees as unknown as Record<string, unknown>[], COL_LABEL)}><Download />Export</button>}
                {modal === "clients" && <button className="exportbtn" onClick={() => exportCSV("clients", ["client", "category", "active_tasks", "total_tasks", "hours", "active"], data.clients_summary as unknown as Record<string, unknown>[], { client: "Client", category: "Category", active_tasks: "Active Tasks", total_tasks: "Total Tasks", hours: "Hours", active: "Active" })}><Download />Export</button>}
                {modal === "raw" && raw && <button className="exportbtn" onClick={() => exportCSV("raw_data", ["employee", "date", "department", "team", "client", "client_type", "billable", "tracked_h", "overall_h", "productivity"], raw.rows, COL_LABEL)}><Download />Export</button>}
                <div className="modal-x" onClick={() => setModal(null)}><X size={16} /></div>
              </div>
            </div>
            <div className="modal-b">
              {modal === "employees" && (
                <>
                  <div className="searchbox" style={{ margin: "6px 0 10px", maxWidth: 280 }}><Search /><input placeholder="Search name or team…" value={search} onChange={(e) => setSearch(e.target.value)} /></div>
                  <table>
                    <thead><tr><th className="l">Employee</th><th className="l">Team</th><th>Days</th><th>Billable</th><th>Util</th><th>Activity</th><th>Prod</th><th>Grade</th><th>Tasks</th><th>Task</th></tr></thead>
                    <tbody>{peopleRows.map((e) => (
                      <tr key={e.name}>
                        <td className="l"><span className="emp-c"><span className="avatar" style={{ background: avatarColor(e.name) }}>{initials(e.name)}</span><span className="tname clk" onClick={() => { setModal(null); openEmployee(e.name); }}>{e.name}</span></span></td>
                        <td className="l" style={{ color: "var(--muted)" }}>{e.team}</td><td className="num">{e.days}</td><td className="num">{n0(e.billable)}h</td>
                        <td><span className="util"><span className="bar"><span className="fill" style={{ width: `${e.utilization}%`, background: utilColor(e.utilization) }} /></span><span className="pc">{n0(e.utilization)}%</span></span></td>
                        <td className="num">{n0(e.activity)}%</td><td className="num">{n0(e.productivity)}%</td><td><span className={`grade ${gradeCls(e.grade)}`}>{e.grade}</span></td>
                        <td className="num">{e.active_tasks}</td><td><span className={`stt ${e.task_status}`}><span className="d" />{e.task_status}</span></td>
                      </tr>))}</tbody>
                  </table>
                </>
              )}
              {modal === "clients" && (
                <table>
                  <thead><tr><th className="l">Client</th><th className="l">Category</th><th>Active Tasks</th><th>Total Tasks</th><th>Hours</th><th>Status</th></tr></thead>
                  <tbody>{data.clients_summary.map((c) => (
                    <tr key={c.client}><td className="l tname">{c.client}</td><td className="l"><span className={`cat ${c.category}`}>{c.category}</span></td>
                      <td className="num">{c.active_tasks}</td><td className="num">{c.total_tasks}</td><td className="num">{n0(c.hours)}h</td>
                      <td><span className="stt" style={{ color: c.active ? "var(--green)" : "var(--muted)" }}><span className={`cdot ${c.active ? "on" : "off"}`} />{c.active ? "Active" : "Inactive"}</span></td></tr>))}</tbody>
                </table>
              )}
              {modal === "raw" && (
                !raw ? <div className="loading" style={{ height: 200 }}><span className="spin" /> Loading raw data…</div> : (
                  <table>
                    <thead><tr><th className="l">Employee</th><th className="l">Date</th><th className="l">Department</th><th className="l">Team</th><th className="l">Client</th><th className="l">Type</th><th className="l">Billable</th><th>Tracked</th><th>Active</th><th>Prod</th></tr></thead>
                    <tbody>{raw.rows.map((r, i) => (
                      <tr key={i}>{["employee", "date", "department", "team", "client", "client_type", "billable"].map((c) => <td key={c} className="l">{cell(c, r)}</td>)}
                        <td className="num">{n1(Number(r.tracked_h))}h</td><td className="num">{n1(Number(r.overall_h))}h</td><td className="num">{n0(Number(r.productivity))}%</td></tr>))}
                      {raw.rows.length === 0 && <tr><td colSpan={10} style={{ textAlign: "center", padding: 20, color: "var(--muted)" }}>No data</td></tr>}
                    </tbody>
                  </table>
                )
              )}
            </div>
          </div>
        </div>
      )}

      {/* EMPLOYEE DETAIL DRAWER */}
      {emp && (
        <div className="drawer-bg" onClick={() => setEmp(null)}>
          <div className="drawer" onClick={(e) => e.stopPropagation()}>
            {!emp.data ? <div className="loading" style={{ height: "100%" }}><span className="spin" /> Loading…</div> :
              !emp.data.found ? <div className="loading" style={{ height: "100%" }}>Not found</div> : (() => {
                const p = emp.data.profile!;
                const daily = emp.data.daily || [];
                return (
                  <>
                    <div className="drawer-h">
                      <div className="emp-hero">
                        <span className="avatar" style={{ background: avatarColor(p.name) }}>{initials(p.name)}</span>
                        <div><div className="nm">{p.name}</div><div className="tm">{p.team} · {p.department}{p.role ? ` · ${p.role}` : ""}</div></div>
                      </div>
                      <div className="modal-x" onClick={() => setEmp(null)}><X size={16} /></div>
                    </div>
                    <div className="drawer-b">
                      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
                        <span className={`grade ${gradeCls(p.grade)}`} style={{ fontSize: 13, padding: "4px 11px" }}>{p.grade}</span>
                        <span className={`stt ${p.task_status}`}><span className="d" />{p.task_status} · {p.active_tasks} active tasks</span>
                      </div>
                      <div className="mini-kpis">
                        <div className="mini-k"><div className="l">Billable</div><div className="v num">{n0(p.billable)}h</div></div>
                        <div className="mini-k"><div className="l">Utilization</div><div className="v num">{n0(p.utilization)}%</div></div>
                        <div className="mini-k"><div className="l">Activity</div><div className="v num">{n0(p.activity)}%</div></div>
                        <div className="mini-k"><div className="l">Productivity</div><div className="v num">{n0(p.productivity)}%</div></div>
                        <div className="mini-k"><div className="l">Active Days</div><div className="v num">{p.days}</div></div>
                        <div className="mini-k"><div className="l">Avg / Day</div><div className="v num">{n1(p.avg_day)}h</div></div>
                      </div>
                      <div className="drawer-sec">Daily Hours Trend</div>
                      <TrendLines data={daily.map((d) => ({ date: d.date, billable: d.billable, non_billable: d.non_billable }))} />
                      <div className="drawer-sec">Assigned Tasks ({(emp.data.tasks || []).length})</div>
                      <table>
                        <thead><tr><th className="l">Task</th><th className="l">Status</th><th>Est</th><th>Tracked</th></tr></thead>
                        <tbody>{(emp.data.tasks || []).slice(0, 40).map((t, i) => (
                          <tr key={i}><td className="l tname">{String(t.task)}</td><td className="l" style={{ color: "var(--muted)" }}>{String(t.status || "—")}</td>
                            <td className="num">{n1(Number(t.estimated || 0))}h</td><td className="num">{n1(Number(t.tracked || 0))}h</td></tr>
                        ))}
                          {(emp.data.tasks || []).length === 0 && <tr><td colSpan={4} style={{ textAlign: "center", padding: 16, color: "var(--muted)" }}>No tasks</td></tr>}
                        </tbody>
                      </table>
                    </div>
                  </>
                );
              })()}
          </div>
        </div>
      )}
    </div>
  );
}

function Glance({ Icon, v, l, t }: { Icon: React.ComponentType<{ size?: number }>; v: React.ReactNode; l?: React.ReactNode; t: string }) {
  return (
    <div className="gi">
      <span className="gic"><Icon size={15} /></span>
      <div><div className="gv num">{v}</div><div className="gl">{t}{l ? <> · {l}</> : null}</div></div>
    </div>
  );
}
function Sel({ label, value, opts, on }: { label: string; value?: string; opts?: string[]; on: (v: string) => void }) {
  return (
    <div className="fld">
      <label>{label}</label>
      <select value={value || ""} onChange={(e) => on(e.target.value)}>
        <option value="">All</option>
        {(opts || []).map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
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
