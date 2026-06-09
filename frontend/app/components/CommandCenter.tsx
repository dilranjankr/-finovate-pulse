"use client";

import { useState, useRef, useEffect } from "react";
import {
  ChevronDown, Search, CalendarDays,
  Building2, Network, Users, Briefcase, Receipt, RotateCcw, Clock, X,
  Gauge, Activity, Zap, Award, Tag, Sparkles, Send, BarChart3, ShieldCheck, ShieldAlert,
  Crown, Wrench, Code2, User as UserIcon, LogOut, Download, Settings, Lock,
  Check, ArrowRight, BookOpen,
} from "lucide-react";
import {
  getFilters, getCommand, getBreakdown, getBreakdownList, getEmployee, getRaw, getUnassigned, askAI, defaultRange,
  type FilterOptions, type CommandData, type Filters, type EmployeeRow, type BreakdownData, type BreakdownListData, type EmployeeDetail, type RawData, type UnassignedData,
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
function sevClass(s: string) {
  const v = (s || "").toLowerCase();
  if (["danger", "high", "critical", "error"].includes(v)) return "danger";
  if (["warn", "warning", "medium"].includes(v)) return "warn";
  if (["info", "low"].includes(v)) return "info";
  return "muted";
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

// ---- roles & capabilities (demo role-switcher) ----
type Role = "owner" | "admin" | "developer" | "user";
type Caps = { company: boolean; filters: boolean; export: boolean; raw: boolean; settings: boolean; self: boolean };
const ROLE_CAPS: Record<Role, Caps> = {
  owner: { company: true, filters: true, export: true, raw: true, settings: true, self: false },
  admin: { company: true, filters: true, export: true, raw: false, settings: false, self: false },
  developer: { company: true, filters: true, export: true, raw: true, settings: false, self: false },
  user: { company: false, filters: false, export: false, raw: false, settings: false, self: true },
};
const ROLE_DEF: { id: Role; label: string; tag: string; desc: string; Icon: React.ComponentType<{ size?: number }>; color: string }[] = [
  { id: "owner", label: "Owner", tag: "Full control", desc: "Everything — all data, filters, exports, raw data and settings.", Icon: Crown, color: "#b8860b" },
  { id: "admin", label: "Admin", tag: "Operations", desc: "All company data, filters, comparisons and CSV export. No system settings.", Icon: ShieldCheck, color: "#2f6fbf" },
  { id: "developer", label: "Developer", tag: "Technical", desc: "Full read-only dashboard plus raw-data / API access for debugging.", Icon: Code2, color: "#0d9488" },
  { id: "user", label: "User", tag: "Self only", desc: "Only your own dashboard — your hours, tasks and clients.", Icon: UserIcon, color: "#7b3fc0" },
];

function RoleScreen({ opts, onPick }: { opts: FilterOptions | null; onPick: (r: Role, name?: string) => void }) {
  const [sel, setSel] = useState<Role | null>(null);
  const [name, setName] = useState("");
  const [q, setQ] = useState("");
  const people = (opts?.employees || []).filter((e) => e.toLowerCase().includes(q.toLowerCase()));
  const canGo = sel && (sel !== "user" || name);
  const FEATS = ["Real-time utilization & productivity", "Team, client & billing intelligence", "Secure role-based access"];
  return (
    <div className="role-screen">
      <div className="role-shell">
        {/* brand panel */}
        <aside className="role-brand">
          <div className="role-brand-mark"><span className="rb-dot" />Insight</div>
          <div className="role-brand-mid">
            <h2>Operations<br />Intelligence</h2>
            <p>Live workforce, client and billing analytics — unified from Hubstaff &amp; ClickUp in one command center.</p>
            <ul className="role-feats">
              {FEATS.map((f) => <li key={f}><span className="rf-ic"><Check size={12} /></span>{f}</li>)}
            </ul>
          </div>
          <div className="role-brand-foot">FINOVATE · Operations Command Center</div>
        </aside>
        {/* role chooser */}
        <main className="role-pick">
          <div className="role-pick-head">
            <span className="role-eyebrow">Sign in</span>
            <h1>Select your access</h1>
            <p>Your dashboard adapts to the role you choose.</p>
          </div>
          <div className="role-opts">
            {ROLE_DEF.map((r) => (
              <button key={r.id} type="button" className={`role-opt${sel === r.id ? " on" : ""}`} onClick={() => { setSel(r.id); setName(""); }} style={{ ["--rc" as string]: r.color }}>
                <span className="role-opt-ic" style={{ background: r.color }}><r.Icon size={17} /></span>
                <span className="role-opt-txt"><b>{r.label} <em>{r.tag}</em></b><i>{r.desc}</i></span>
                <span className="role-opt-rad" />
              </button>
            ))}
          </div>
          {sel === "user" && (
            <div className="role-user">
              <label>Who are you?</label>
              <div className="role-search"><Search size={14} /><input autoFocus placeholder="Search your name…" value={q} onChange={(e) => setQ(e.target.value)} /></div>
              <div className="role-names">
                {people.slice(0, 60).map((p) => (
                  <button key={p} type="button" className={`role-name${name === p ? " on" : ""}`} onClick={() => setName(p)}>{p}</button>
                ))}
                {people.length === 0 && <span className="role-empty">No matching name</span>}
              </div>
            </div>
          )}
          <button type="button" className="role-go" disabled={!canGo} onClick={() => sel && onPick(sel, sel === "user" ? name : undefined)}>
            {sel === "user" && !name ? "Select your name" : "Continue"}<ArrowRight size={16} />
          </button>
          <div className="role-note"><Lock size={11} /> Demo access — no password required.</div>
        </main>
      </div>
    </div>
  );
}

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

  // ---- role-based access (demo role-switcher; choice persisted in localStorage) ----
  const [role, setRole] = useState<Role | null>(null);
  const [selfName, setSelfName] = useState<string>("");
  const [roleReady, setRoleReady] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [acctOpen, setAcctOpen] = useState(false);
  const acctRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!acctOpen) return;
    const h = (e: MouseEvent) => { if (acctRef.current && !acctRef.current.contains(e.target as Node)) setAcctOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [acctOpen]);
  const [rawModal, setRawModal] = useState(false);
  const [rawData, setRawData] = useState<RawData | null>(null);
  const [unaModal, setUnaModal] = useState(false);
  const [unaData, setUnaData] = useState<UnassignedData | null>(null);
  useEffect(() => {
    try {
      const r = localStorage.getItem("fin_role") as Role | null;
      const n = localStorage.getItem("fin_self") || "";
      if (r && ROLE_CAPS[r]) { setRole(r); setSelfName(n); }
    } catch { /* ignore */ }
    setRoleReady(true);
  }, []);
  const caps = ROLE_CAPS[role || "user"];

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
  // date range helpers (used by quick presets in the period bar)
  function setRange(from: string, to: string) { const next = { ...draft, date_from: from, date_to: to }; setDraft(next); apply(next); }
  function presetDays(n: number | null) {
    if (!opts) return;
    if (n === null) { setRange(opts.date_min, opts.date_max); return; }
    const d = new Date(opts.date_max + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() - (n - 1));
    const from = d.toISOString().slice(0, 10);
    setRange(from < opts.date_min ? opts.date_min : from, opts.date_max);
  }
  const PRESETS: [string, number | null][] = [["7D", 7], ["30D", 30], ["90D", 90], ["1Y", 365], ["All", null]];
  const activePreset = (() => {
    if (!opts || !draft.date_to || draft.date_to !== opts.date_max) return draft.date_from || draft.date_to ? "" : "";
    if (draft.date_from === opts.date_min) return "All";
    for (const [lbl, n] of PRESETS) {
      if (n === null) continue;
      const d = new Date(opts.date_max + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() - (n - 1));
      const f = d.toISOString().slice(0, 10);
      if ((f < opts.date_min ? opts.date_min : f) === draft.date_from) return lbl;
    }
    return "";
  })();
  async function refetchOpts(scope: { department?: string; atl?: string }) {
    try { setOpts(await getFilters(scope)); } catch { /* keep */ }
  }
  function setField(key: keyof Filters, v: string) { const next = { ...draft, [key]: v || undefined }; setDraft(next); apply(next); }
  function setDept(v: string) { const next = { ...draft, department: v || undefined, atl: undefined, employee: undefined }; setDraft(next); refetchOpts({ department: v || undefined }); apply(next); }
  function setAtl(v: string) { const next = { ...draft, atl: v || undefined, employee: undefined }; setDraft(next); refetchOpts({ department: draft.department, atl: v || undefined }); apply(next); }
  function clearFilters() { const base: Filters = opts ? defaultRange(opts) : {}; setDraft(base); refetchOpts({}); apply(base); }
  // breadcrumb drill-up: jump to a parent scope, clearing deeper filters
  function goCompany() { const n = { ...draft, department: undefined, atl: undefined, employee: undefined }; setDraft(n); refetchOpts({}); apply(n); }
  function goDept() { const n = { ...draft, atl: undefined, employee: undefined }; setDraft(n); refetchOpts({ department: draft.department }); apply(n); }
  function goTeam() { const n = { ...draft, employee: undefined }; setDraft(n); apply(n); }
  function pickRole(r: Role, name?: string) {
    setRole(r);
    try { localStorage.setItem("fin_role", r); } catch { /* ignore */ }
    if (r === "user" && name) {
      setSelfName(name);
      try { localStorage.setItem("fin_self", name); } catch { /* ignore */ }
      const base: Filters = opts ? defaultRange(opts) : {};
      const next = { ...base, employee: name };
      setDraft(next); apply(next);
    } else {
      setSelfName("");
      try { localStorage.removeItem("fin_self"); } catch { /* ignore */ }
    }
  }
  function switchRole() {
    setRole(null); setSelfName(""); setShowSettings(false);
    try { localStorage.removeItem("fin_role"); localStorage.removeItem("fin_self"); } catch { /* ignore */ }
    const base: Filters = opts ? defaultRange(opts) : {};
    setDraft(base); apply(base);
  }
  function openRaw() { setRawModal(true); setRawData(null); getRaw(draft).then(setRawData).catch(() => setRawData({ rows: [], total: 0, shown: 0 })); }
  function openUnassigned() { setUnaModal(true); setUnaData(null); getUnassigned().then(setUnaData).catch(() => setUnaData({ rows: [], count: 0, total_hours: 0, total_members: 0 })); }
  function exportUnassignedCsv() {
    const rows = unaData?.rows || [];
    const head = ["Employee", "Tracked_h", "Active_days", "Reason", "Suggestion"];
    const esc = (v: string | number) => { const s = String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    const lines = [head.join(",")];
    rows.forEach((r) => lines.push([r.name, Math.round(r.hours), r.days, r.reason, r.suggestion].map(esc).join(",")));
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = "finovate_unassigned.csv"; a.click(); URL.revokeObjectURL(url);
  }
  // export the in-scope employees table to CSV (client-side, no backend)
  function exportCsv() {
    const rows = [...data!.employees].sort((a, b) => b.billable - a.billable);
    const head = ["Employee", "Team", "Billable_h", "NonBillable_h", "Total_h", "Utilization_%", "Productivity_%", "Activity_%", "Grade", "Clients"];
    const esc = (v: string | number) => { const s = String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    const lines = [head.join(",")];
    rows.forEach((e) => lines.push([e.name, e.team, Math.round(e.billable), Math.round(e.non_billable), Math.round(e.billable + e.non_billable), Math.round(e.utilization), Math.round(e.productivity), Math.round(e.activity), e.grade, (e.clients || []).join("; ")].map(esc).join(",")));
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `finovate_${data!.context.label.replace(/[^a-z0-9]+/gi, "_").toLowerCase()}.csv`;
    a.click(); URL.revokeObjectURL(url);
  }

  if (!roleReady || !data) return <div className="page"><div className="loading"><span className="spin" /> Loading…</div></div>;
  if (!role) return <RoleScreen opts={opts} onPick={pickRole} />;

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
    const spark = (deltaKey ? data.kpis[deltaKey]?.spark : null) || [];
    return (
      <div className={`kc2${onClick ? " kclk" : ""}`} key={key} onClick={onClick}>
        <div className="kc2-head">
          <span className="kc2-ic" style={{ background: c.tint, color: c.badge }}><Icon size={16} /></span>
          <span className="kc2-lbl">{label}</span>
        </div>
        <div className="kc2-val num">{value}</div>
        {spark.length > 1 && <div className="kc2-spark"><Sparkline data={spark} color={c.badge} id={key} /></div>}
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
  const ch = data.client_health;
  const chTotal = ch.active + ch.at_risk + ch.inactive;
  const chData = [{ name: "Active", value: ch.active }, { name: "At Risk", value: ch.at_risk }, { name: "Inactive", value: ch.inactive }];
  const empClients = [...data.employees].filter((e) => e.billable > 0).sort((a, b) => b.billable - a.billable);

  // ---- context level: company › department › team › employee (+ client scope) ----
  const lvl = data.context.level; // "company" | "department" | "atl" | "employee"
  const isEmp = lvl === "employee";
  const isTeam = lvl === "atl";
  const isDept = lvl === "department";
  const peopleN = data.employees.length;
  const multiPeople = peopleN > 1;                 // comparisons need ≥2 people
  const showComparison = !isEmp && !isTeam;        // dept/team bars only above team level
  const showPeople = multiPeople;                  // performers / bubble / people table

  // task status + priority (contextual)
  const tp = data.task_priority || { urgent: 0, high: 0, normal: 0, low: 0 };
  const tpTotal = tp.urgent + tp.high + tp.normal + tp.low;
  const taskStatus = (data.task_summary || []).filter((s) => s.value > 0);
  const taskStatusTotal = taskStatus.reduce((s, x) => s + x.value, 0);
  const alerts = data.alerts || [];
  const insights = (data.insights || []).slice(0, 4);
  const empTasks = (data.table?.level === "employee" ? data.table.rows : []) as Array<Record<string, unknown>>;

  // budget vs actual (capacity utilised) — for the gauge
  const bva = data.budget_vs_actual || { budget: 0, actual: 0, variance: 0 };
  const bvaPct = bva.budget > 0 ? Math.round((bva.actual / bva.budget) * 100) : 0;
  const bvaDelta = data.kpis.actual_hours?.trend ?? null;

  // clickable insight → jump to the team/department/client it names (frontend match)
  function insightTarget(text: string): { kind: "team" | "dept" | "client"; value: string } | null {
    const team = (data?.teams || []).find((t) => t.team && t.team !== "Unassigned" && text.includes(t.team));
    if (team) return { kind: "team", value: team.team };
    const dept = (data?.departments || []).find((d) => d.team && d.team !== "Unassigned" && text.includes(d.team));
    if (dept) return { kind: "dept", value: dept.team };
    const cl = (data?.clients_summary || []).find((c) => c.client && c.client !== "Unassigned" && text.includes(c.client));
    if (cl) return { kind: "client", value: cl.client };
    return null;
  }
  function applyInsight(tg: { kind: "team" | "dept" | "client"; value: string }) {
    if (tg.kind === "team") setAtl(tg.value);
    else if (tg.kind === "dept") setDept(tg.value);
    else setField("client", tg.value);
  }
  function askAboutAlert(title: string) { setChatOpen(true); ask(`${title}: which ones, and what should I look at?`); }


  // department/team level: a simple ranked leaderboard (teams or members)
  const rankInfo = (() => {
    const rows = (data.table?.rows || []) as Array<Record<string, unknown>>;
    if (lvl === "department") {
      return {
        title: "Team Leaderboard", sub: "teams ranked by billable hours", isPeople: false,
        items: rows.map((r) => ({ name: String(r.name ?? "—"), billable: Number(r.billable ?? 0), util: Number(r.utilization ?? 0), grade: String(r.grade ?? "—"), meta: `${Number(r.team_size ?? 0)} people` })),
      };
    }
    if (lvl === "atl") {
      return {
        title: "Member Leaderboard", sub: "team members ranked by billable hours", isPeople: true,
        items: rows.map((r) => ({ name: String(r.employee ?? "—"), billable: Number(r.billable ?? 0), util: Number(r.utilization ?? 0), grade: String(r.grade ?? "—"), meta: `${Number(r.tasks ?? 0)} tasks` })),
      };
    }
    return null;
  })();
  const rankItems = rankInfo ? [...rankInfo.items].sort((a, b) => b.billable - a.billable) : [];
  const rankMax = Math.max(1, ...rankItems.map((r) => r.billable));

  // ---- multi-select comparison: 2+ employees / teams / departments side by side ----
  const selOf = (v?: string) => (v || "").split(",").map((s) => s.trim()).filter(Boolean);
  const selEmp = selOf(draft.employee), selTeam = selOf(draft.atl), selDept = selOf(draft.department);
  type CmpEnt = { name: string; total: number; billable: number; non_billable: number; utilization: number; productivity: number; activity: number; grade: string };
  const compare: { kind: "employee" | "team" | "department"; noun: string; ents: CmpEnt[] } | null = (() => {
    const pick = (names: string[], rows: { name: string; total: number; billable: number; non_billable: number; utilization: number; productivity: number; activity: number; grade: string }[]) =>
      names.map((nm) => rows.find((r) => r.name === nm)).filter(Boolean) as CmpEnt[];
    if (selEmp.length >= 2) {
      const rows = data.employees.map((e) => ({ name: e.name, total: e.billable + e.non_billable, billable: e.billable, non_billable: e.non_billable, utilization: e.utilization, productivity: e.productivity, activity: e.activity, grade: e.grade }));
      const ents = pick(selEmp, rows);
      if (ents.length >= 2) return { kind: "employee", noun: "Employees", ents };
    }
    if (selTeam.length >= 2) {
      const rows = (data.teams || []).map((t) => ({ name: t.team, total: t.total, billable: t.billable, non_billable: t.non_billable, utilization: t.utilization, productivity: t.productivity, activity: t.activity ?? 0, grade: t.grade }));
      const ents = pick(selTeam, rows);
      if (ents.length >= 2) return { kind: "team", noun: "Teams", ents };
    }
    if (selDept.length >= 2) {
      const rows = (data.departments || []).map((t) => ({ name: t.team, total: t.total, billable: t.billable, non_billable: t.non_billable, utilization: t.utilization, productivity: t.productivity, activity: t.activity ?? 0, grade: t.grade }));
      const ents = pick(selDept, rows);
      if (ents.length >= 2) return { kind: "department", noun: "Departments", ents };
    }
    return null;
  })();
  const CMP_COLORS = ["#2f6fbf", "#0f9043", "#e8930c", "#8b5cf6"];
  // metric rows for the comparison table (higher is better → highlight max)
  const cmpMetrics: { key: keyof CmpEnt; label: string; fmt: (v: number) => string; better: "high" }[] = [
    { key: "total", label: "Total Hours", fmt: (v) => n0(v) + "h", better: "high" },
    { key: "billable", label: "Billable Hours", fmt: (v) => n0(v) + "h", better: "high" },
    { key: "non_billable", label: "Non-Billable", fmt: (v) => n0(v) + "h", better: "high" },
    { key: "utilization", label: "Utilization", fmt: (v) => n1(v) + "%", better: "high" },
    { key: "productivity", label: "Productivity", fmt: (v) => n1(v) + "%", better: "high" },
    { key: "activity", label: "Activity", fmt: (v) => n1(v) + "%", better: "high" },
  ];

  // breadcrumb crumbs from the active drill path (multi-select → "N {noun}")
  const crumbLbl = (raw: string, noun: string) => { const a = raw.split(",").map((s) => s.trim()).filter(Boolean); return a.length > 1 ? `${a.length} ${noun}` : a[0]; };
  const crumbs: { label: string; sub: string; on?: () => void; active: boolean }[] = [
    { label: "Company", sub: "All", on: draft.department || draft.atl || draft.employee ? goCompany : undefined, active: !draft.department && !draft.atl && !draft.employee },
  ];
  if (draft.department) crumbs.push({ label: crumbLbl(draft.department, "Departments"), sub: "Department", on: draft.atl || draft.employee ? goDept : undefined, active: !!draft.department && !draft.atl && !draft.employee });
  if (draft.atl) crumbs.push({ label: crumbLbl(draft.atl, "Teams"), sub: "Team", on: draft.employee ? goTeam : undefined, active: !!draft.atl && !draft.employee });
  if (draft.employee) crumbs.push({ label: crumbLbl(draft.employee, "Employees"), sub: "Employee", active: true });

  // active filters (beyond the default date window) — drives the funnel badge
  // and whether the slim scope strip needs to show at all
  const activeCount = [draft.department, draft.atl, draft.employee, draft.client, draft.client_type, draft.billable].filter(Boolean).length;
  const anyScope = activeCount > 0;

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
              {!caps.self && <button type="button" className="unassigned-link" onClick={openUnassigned} title="Employees not mapped to a department/team/client"><ShieldAlert size={12} />Unassigned</button>}
            </div>
          </div>
        </div>
        <div className="tb-r">
          <div className={`chip${live ? "" : " demo"}`}><span className="d" />{loading ? "Syncing…" : live ? "Live" : "Demo"}</div>
          <span className="tb-sep" />
          {(() => {
            const rd = ROLE_DEF.find((r) => r.id === role)!;
            const name = selfName || rd.label;
            const email = (caps.self ? name.toLowerCase().split(" ")[0].replace(/[^a-z0-9]/g, "") : role) + "@finovate.app";
            return (
              <div className="acct" ref={acctRef}>
                <button className={`acct-btn${acctOpen ? " on" : ""}`} onClick={() => setAcctOpen((o) => !o)} title="Account">
                  <span className="acct-av" style={{ background: rd.color }}>{caps.self ? initials(name) : <rd.Icon size={14} />}</span>
                  <span className="acct-nm">{name}</span>
                  <ChevronDown size={14} />
                </button>
                {acctOpen && (
                  <div className="acct-menu" role="menu">
                    <div className="acct-head">
                      <div className="acct-h-nm">{name}</div>
                      <div className="acct-h-em">{email}</div>
                      <span className="acct-badge" style={{ color: rd.color, background: rd.color + "1a" }}>{rd.label.toUpperCase()}</span>
                    </div>
                    <div className="acct-items">
                      <button className="acct-item" onClick={() => { setAcctOpen(false); if (caps.self) openEmployee(name); else setShowSettings(true); }}><UserIcon size={16} />Your profile</button>
                      {caps.settings && <button className="acct-item" onClick={() => { setAcctOpen(false); setShowSettings(true); }}><Settings size={16} />Settings</button>}
                      {caps.export && <button className="acct-item" onClick={() => { setAcctOpen(false); exportCsv(); }}><Download size={16} />Export to CSV</button>}
                      {caps.raw && <button className="acct-item" onClick={() => { setAcctOpen(false); openRaw(); }}><Code2 size={16} />Raw data</button>}
                      {caps.settings && <button className="acct-item" onClick={() => { setAcctOpen(false); switchRole(); }}><Users size={16} />Users &amp; roles</button>}
                      <button className="acct-item" onClick={() => { setAcctOpen(false); setChatOpen(true); }}><Sparkles size={16} />AI assistant</button>
                      <button className="acct-item" onClick={() => { setAcctOpen(false); window.open("https://github.com/dilranjankr/-finovate-pulse#readme", "_blank"); }}><BookOpen size={16} />Documentation</button>
                    </div>
                    <div className="acct-foot">
                      <button className="acct-item danger" onClick={() => { setAcctOpen(false); switchRole(); }}><LogOut size={16} />Sign out</button>
                    </div>
                  </div>
                )}
              </div>
            );
          })()}
        </div>
      </div>

      {/* FILTERS */}
      {caps.filters && showFilters && (() => {
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
            <div className="fpreset" role="group" aria-label="Quick range">
              {PRESETS.map(([lbl, n]) => (
                <button key={lbl} type="button" className={activePreset === lbl ? "on" : ""} onClick={() => presetDays(n)}>{lbl}</button>
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

      {/* PERIOD BAR — employees (self view) can still filter by date */}
      {caps.self && (
        <div className="filterbar period">
          <span className="fb-lead">PERIOD</span>
          <label className="fdate">
            <CalendarDays size={13} />
            <input type="date" value={draft.date_from || ""} onChange={(e) => setField("date_from", e.target.value)} aria-label="From" />
            <span className="dsep">–</span>
            <input type="date" value={draft.date_to || ""} onChange={(e) => setField("date_to", e.target.value)} aria-label="To" />
          </label>
          <div className="fpreset" role="group" aria-label="Quick range">
            {PRESETS.map(([lbl, n]) => (
              <button key={lbl} type="button" className={activePreset === lbl ? "on" : ""} onClick={() => presetDays(n)}>{lbl}</button>
            ))}
          </div>
        </div>
      )}

      {/* SCOPE BREADCRUMB — only when drilled/filtered (or self view); hidden at the clean default */}
      {(anyScope || caps.self) && (
      <div className="scopebar">
        <div className="crumbs">
          {caps.self ? (
            <span className="crumb-wrap"><button type="button" className="crumb on" disabled><span className="crumb-sub">Your dashboard</span><span className="crumb-lbl">{selfName}</span></button></span>
          ) : crumbs.map((c, i) => (
            <span className="crumb-wrap" key={c.label + i}>
              {i > 0 && <span className="crumb-sep">›</span>}
              <button type="button" className={`crumb${c.active ? " on" : ""}`} disabled={!c.on} onClick={c.on}>
                <span className="crumb-sub">{c.sub}</span>
                <span className="crumb-lbl">{c.label}</span>
              </button>
            </span>
          ))}
          {!caps.self && draft.client && <span className="crumb-tag"><Briefcase size={12} />{draft.client}</span>}
          {!caps.self && draft.billable && <span className="crumb-tag bil">{draft.billable}</span>}
        </div>
        <div className="scope-meta">
          {!caps.self && <span><b>{peopleN}</b> {peopleN === 1 ? "person" : "people"}</span>}
          <span><b>{n0(total)}</b>h tracked</span>
          {loading && <span className="scope-sync"><span className="spin sm" /> updating…</span>}
        </div>
      </div>
      )}

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

      {/* MULTI-SELECT COMPARISON — 2+ employees / teams / departments side by side */}
      {compare && (() => {
        const maxTotal = Math.max(1, ...compare.ents.map((e) => e.total));
        const bestIdx = (key: keyof CmpEnt) => {
          let bi = 0, bv = -Infinity;
          compare.ents.forEach((e, i) => { const v = Number(e[key]); if (v > bv) { bv = v; bi = i; } });
          return bi;
        };
        return (
          <>
            <div className="sec"><h4>Comparison <span className="sec-tag">{compare.ents.length} {compare.noun.toLowerCase()}</span></h4></div>
            <div className="panel cmp-panel" style={{ marginBottom: 14 }}>
              <div className="ph"><h3>Side-by-side <span className="hl">selected {compare.noun.toLowerCase()} · best value highlighted</span></h3></div>
              {/* entity header cards */}
              <div className="cmp-cards" style={{ gridTemplateColumns: `repeat(${compare.ents.length}, 1fr)` }}>
                {compare.ents.map((e, i) => {
                  const col = CMP_COLORS[i % CMP_COLORS.length];
                  const bilPct = e.total ? (e.billable / e.total) * 100 : 0;
                  return (
                    <div className="cmp-card" key={e.name + i} style={{ borderTopColor: col }}>
                      <div className="cmp-card-h">
                        {compare.kind === "employee"
                          ? <span className="avatar sm" style={{ background: col }}>{initials(e.name)}</span>
                          : <span className="rank-ic" style={{ background: col, width: 26, height: 26 }}><Network size={13} /></span>}
                        <span className="cmp-nm" title={e.name}>{e.name}</span>
                        <span className={`grade ${gradeCls(e.grade)}`}>{e.grade}</span>
                      </div>
                      <div className="cmp-tot num">{n0(e.total)}<span>h</span></div>
                      <div className="cmp-bar"><span style={{ width: `${(e.total / maxTotal) * 100}%`, background: col }} /></div>
                      <div className="cmp-split"><i className="bil" style={{ width: `${bilPct}%` }} /><i className="nbil" style={{ width: `${100 - bilPct}%` }} /></div>
                      <div className="cmp-split-l"><span>Billable {n0(e.billable)}h</span><span>NB {n0(e.non_billable)}h</span></div>
                    </div>
                  );
                })}
              </div>
              {/* grouped bar chart — key % metrics side by side */}
              <div className="cmp-chart">
                <div className="cmp-legend">
                  {compare.ents.map((e, i) => (
                    <span className="cmp-lg" key={e.name + i}><i style={{ background: CMP_COLORS[i % CMP_COLORS.length] }} />{compare.kind === "employee" ? e.name.split(" ")[0] : e.name}</span>
                  ))}
                </div>
                <div className="cmp-groups">
                  {([["Utilization", "utilization"], ["Productivity", "productivity"], ["Activity", "activity"]] as const).map(([label, key]) => (
                    <div className="cmp-group" key={key}>
                      <div className="cmp-gbars">
                        {compare.ents.map((e, i) => {
                          const v = Number(e[key as keyof CmpEnt]);
                          return (
                            <div className="cmp-gbar" key={e.name + i} title={`${e.name} · ${label}: ${n1(v)}%`}>
                              <span className="cmp-gval">{Math.round(v)}%</span>
                              <span className="cmp-gfill" style={{ height: `${Math.min(Math.max(v, 0), 100)}%`, background: CMP_COLORS[i % CMP_COLORS.length] }} />
                            </div>
                          );
                        })}
                      </div>
                      <div className="cmp-glabel">{label}</div>
                    </div>
                  ))}
                </div>
              </div>
              {/* metric comparison table */}
              <div className="cmp-table-wrap">
                <table className="cmp-table">
                  <thead>
                    <tr><th className="l">Metric</th>{compare.ents.map((e, i) => <th key={e.name + i}><span className="cmp-dot" style={{ background: CMP_COLORS[i % CMP_COLORS.length] }} />{compare.kind === "employee" ? e.name.split(" ")[0] : e.name}</th>)}</tr>
                  </thead>
                  <tbody>
                    {cmpMetrics.map((mt) => {
                      const bi = bestIdx(mt.key);
                      return (
                        <tr key={mt.key}>
                          <td className="l cmp-mlbl">{mt.label}</td>
                          {compare.ents.map((e, i) => (
                            <td key={e.name + i} className={`num${i === bi && compare.ents.length > 1 ? " cmp-best" : ""}`}>
                              {mt.fmt(Number(e[mt.key]))}
                              {i === bi && compare.ents.length > 1 && <span className="cmp-win">▲</span>}
                            </td>
                          ))}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        );
      })()}

      {/* INSIGHTS & ALERTS — auto-generated, contextual to the current scope */}
      {(insights.length > 0 || alerts.length > 0) && (
        <div className="ia-row">
          {insights.length > 0 && (
            <div className="panel ia-panel">
              <div className="ph"><h3><Sparkles size={15} style={{ color: "#7b3fc0", verticalAlign: "-2px", marginRight: 6 }} />Key Insights <span className="hl">for {data.context.label}</span></h3></div>
              <div className="ins-list">
                {insights.map((t, i) => {
                  const tg = insightTarget(t);
                  return (
                    <div className={`ins-item${tg ? " clk" : ""}`} key={i} onClick={tg ? () => applyInsight(tg) : undefined} title={tg ? `View ${tg.value}` : undefined}>
                      <span className="ins-n">{i + 1}</span>
                      <span className="ins-t">{t}</span>
                      {tg && <ArrowRight size={14} className="ins-go" />}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
          {alerts.length > 0 && (
            <div className="panel ia-panel">
              <div className="ph"><h3><ShieldAlert size={15} style={{ color: "#e8930c", verticalAlign: "-2px", marginRight: 6 }} />Alerts <span className="hl">needs attention</span></h3></div>
              <div className="alert-list">
                {alerts.map((a, i) => {
                  const sev = sevClass(a.severity);
                  return (
                    <div className={`alert-item ${sev} clk`} key={i} onClick={() => askAboutAlert(a.title)} title="Ask AI about this">
                      <span className="alert-bar" />
                      <span className="alert-t">{a.title}</span>
                      {a.count > 0 && <span className="alert-c">{n0(a.count)}</span>}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}


      {/* BUDGET vs ACTUAL — capacity utilised gauge */}
      {bva.budget > 0 && (
        <>
          <div className="sec"><h4>Budget vs Actual</h4></div>
          <div className="panel" style={{ marginBottom: 14 }}>
            <div className="ph"><h3>Capacity utilised <span className="hl">tracked hours vs budgeted capacity (8h/day)</span></h3></div>
            <div className="bva-body">
              <div className="bva-gauge">
                <GaugeChart value={bvaPct} color={bvaPct > 100 ? "#d23f43" : bvaPct >= 70 ? "#16a34a" : "#e8930c"} />
                <div className="bva-read">
                  <b className="num">{bvaPct}%</b>
                  {cmp && bvaDelta !== null && <span className="bva-delta" style={{ color: bvaDelta >= 0 ? "#0f9043" : "#d23f43" }}>{bvaDelta > 0 ? "+" : ""}{bvaDelta}%</span>}
                  <span className="bva-cap">of budget · last {pv?.days || 90}d</span>
                </div>
              </div>
              <div className="bva-stats">
                <div className="bva-stat"><span className="l">Budgeted capacity</span><b className="num">{n0(bva.budget)}h</b></div>
                <div className="bva-stat"><span className="l">Actual tracked</span><b className="num">{n0(bva.actual)}h</b></div>
                <div className="bva-stat"><span className="l">Variance</span><b className="num" style={{ color: bva.variance < 0 ? "#d23f43" : "#0f9043" }}>{bva.variance > 0 ? "+" : ""}{n0(bva.variance)}h</b></div>
                <div className="bva-note">{bvaPct >= 100 ? "Over capacity — team is fully loaded." : bvaPct >= 70 ? "Healthy utilisation of available capacity." : "Spare capacity available."}</div>
              </div>
            </div>
          </div>
        </>
      )}

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
        const billStats = (() => {
          const m: Record<string, { h: number; n: number }> = { Fixed: { h: 0, n: 0 }, Hourly: { h: 0, n: 0 }, Project: { h: 0, n: 0 } };
          data.clients_summary.forEach((c) => { const k = c.category === "Fixed" ? "Fixed" : c.category === "Hourly" ? "Hourly" : "Project"; m[k].h += c.hours; m[k].n += 1; });
          return ([
            { name: "Fixed", value: Math.round(m.Fixed.h), count: m.Fixed.n, color: "#6366f1", c2: "#818cf8" },
            { name: "Hourly", value: Math.round(m.Hourly.h), count: m.Hourly.n, color: "#0ea5a4", c2: "#2dd4bf" },
            { name: "Project", value: Math.round(m.Project.h), count: m.Project.n, color: "#f59e0b", c2: "#fbbf24" },
          ]).filter((x) => x.count > 0);
        })();
        const billMax = Math.max(...billStats.map((c) => c.value), 1);
        return (
          <div className="tt-row">
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
            <div className="panel pipe-panel">
              <div className="ph"><h3><Receipt size={15} style={{ color: "#2f6fbf", verticalAlign: "-2px", marginRight: 6 }} />Billing Type <span className="hl">hours &amp; clients by category</span></h3></div>
              <div className="pipe-chart">
                {billStats.map((c) => (
                  <div className="pipe-item" key={c.name} title={`${c.name}: ${n0(c.value)}h · ${c.count} clients`}>
                    <div className="pipe-val num" style={{ color: c.color }}>{n0(c.value)}<span>h</span></div>
                    <div className="pipe-track">
                      <div className="pipe-bar" style={{ height: `${Math.max((c.value / billMax) * 100, 6)}%`, background: `linear-gradient(180deg, ${c.c2}, ${c.color})` }} />
                    </div>
                    <div className="pipe-lbl">{c.name}</div>
                    <div className="pipe-cnt"><i style={{ background: c.color }} />{c.count} clients</div>
                  </div>
                ))}
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

      {/* TASKS — status + priority (contextual) */}
      {(taskStatusTotal > 0 || tpTotal > 0) && (
        <>
          <div className="sec"><h4>Tasks</h4></div>
          <div className="row2">
            {taskStatusTotal > 0 && (
              <div className="panel">
                <div className="ph"><h3>Task Status <span className="hl">{n0(taskStatusTotal)} active tasks in scope</span></h3></div>
                <div className="bl-list">
                  {taskStatus.sort((a, b) => b.value - a.value).map((s) => {
                    const pct = taskStatusTotal ? (s.value / taskStatusTotal) * 100 : 0;
                    const col = /done|complete|closed/i.test(s.name) ? "#0f9043" : /progress|active|review/i.test(s.name) ? "#2f6fbf" : /block|overdue|hold/i.test(s.name) ? "#d23f43" : "#8b8f9a";
                    return (
                      <div className="bl-row" key={s.name}>
                        <span className="bl-lbl" title={s.name}>{s.name}</span>
                        <span className="bl-track"><span className="bl-fill" style={{ width: `${Math.max(pct, 2)}%`, background: col }} /></span>
                        <b className="bl-val num">{n0(s.value)}</b>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
            {tpTotal > 0 && (
              <div className="panel">
                <div className="ph"><h3>Priority Mix <span className="hl">open tasks by urgency</span></h3></div>
                <div className="prio-grid">
                  {([["Urgent", tp.urgent, "#d23f43"], ["High", tp.high, "#e8930c"], ["Normal", tp.normal, "#2f6fbf"], ["Low", tp.low, "#8b8f9a"]] as const).map(([lbl, v, col]) => (
                    <div className="prio-card" key={lbl} style={{ borderColor: col + "33" }}>
                      <span className="prio-bar" style={{ background: col }} />
                      <div className="prio-v num">{n0(v)}</div>
                      <div className="prio-l">{lbl}</div>
                      <div className="prio-p">{tpTotal ? Math.round((v / tpTotal) * 100) : 0}%</div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </>
      )}

      {/* LEADERBOARD — department → teams, team → members (context-specific) */}
      {rankInfo && rankItems.length > 0 && (
        <>
          <div className="sec"><h4>{rankInfo.title}</h4></div>
          <div className="panel" style={{ marginBottom: 14 }}>
            <div className="ph"><h3>{rankInfo.title} <span className="hl">{rankInfo.sub}</span></h3></div>
            <div className="rank-list">
              {rankItems.map((r, i) => (
                <div className={`rank-row${rankInfo.isPeople ? " kclk" : ""}`} key={r.name + i} onClick={rankInfo.isPeople ? () => openEmployee(r.name) : undefined}>
                  <span className={`rank-pos${i < 3 ? " top" : ""}`}>{i + 1}</span>
                  {rankInfo.isPeople
                    ? <span className="avatar sm" style={{ background: avatarColor(r.name) }}>{initials(r.name)}</span>
                    : <span className="rank-ic" style={{ background: avatarColor(r.name) }}><Network size={13} /></span>}
                  <span className="rank-id"><b title={r.name}>{r.name}</b><i>{r.meta}</i></span>
                  <span className="rank-bar"><span className="rank-fill" style={{ width: `${(r.billable / rankMax) * 100}%` }} /></span>
                  <span className="rank-h num">{n0(r.billable)}h</span>
                  <span className="rank-u num">{n0(r.util)}%</span>
                  <span className={`grade ${gradeCls(r.grade)}`}>{r.grade}</span>
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      {/* CLIENTS */}
      <div className="sec"><h4>Clients</h4></div>
      <div className="row2">
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
      </div>

      {/* PERFORMANCE — only when there are ≥2 people to compare */}
      {showPeople && (<>
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
      </>)}

      {/* COMPARISON — department-wise / team-wise (storage-style bars + status cards) */}
      {showComparison && (() => {
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
                      {rows.map((r, i) => {
                        const hp = Math.max(3, (r.total / niceTop) * 100);
                        const isLow = r.team === lowKey && rows.length > 1;
                        const palette = ["#2f6fbf", "#0d9488", "#7b3fc0", "#e8930c", "#16a34a", "#d9568c", "#5b8def", "#0ea5a4", "#b8860b", "#5c6bc0"];
                        const col = isLow ? "#e2574c" : palette[i % palette.length];
                        return (
                          <div className="modbar-track" key={r.team}>
                            <div className="modbar-fill" style={{ height: `${hp}%`, background: `linear-gradient(180deg, ${col}, ${col}cc)` }}>
                              <span className="modbar-val">{n0(r.total)}h</span>
                              <div className="modbar-tip">
                                <div className="mt-nm">{r.team}{isLow ? " · lowest" : ""}</div>
                                <div className="mt-row"><span><i className="mt-dot" style={{ background: col }} />Hours</span><b>{n0(r.total)}h</b></div>
                                <div className="mt-row"><span>Utilization</span><b>{n0(r.utilization)}%</b></div>
                                <div className="mt-row"><span>Activity</span><b>{n0(r.activity ?? 0)}%</b></div>
                                <div className="mt-row"><span>Productivity</span><b>{n0(r.productivity)}%</b></div>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                  <div className="modbar-xrow">{rows.map((r) => <span className="modbar-x" key={r.team} title={r.team}>{r.team}</span>)}</div>
                </div>
              </div>
            </div>
          </>
        );
      })()}

      {/* EMPLOYEE → CLIENTS — only when there are multiple people to map */}
      {showPeople && (<>
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
      </>)}

      {/* EMPLOYEE FOCUS — single person: their tasks list */}
      {isEmp && empTasks.length > 0 && (<>
        <div className="sec"><h4>Tasks · {data.context.label}</h4></div>
        <div className="panel" style={{ marginBottom: 14 }}>
          <div className="ph"><h3>Assigned tasks <span className="hl">{empTasks.length} tasks · estimated vs tracked</span></h3></div>
          <div className="scrollwrap" style={{ maxHeight: 460 }}>
            <table className="ec-table">
              <thead><tr><th className="l">Task</th><th className="l">Client</th><th>Est.</th><th>Tracked</th><th className="l">Status</th><th>Due</th></tr></thead>
              <tbody>
                {empTasks.map((r, i) => {
                  const st = String(r.status ?? "—");
                  const stc = /done|complete|closed/i.test(st) ? "gA" : /progress|active|review/i.test(st) ? "gB" : /block|overdue|hold/i.test(st) ? "gD" : "gBb";
                  return (
                    <tr key={String(r.task ?? i) + i}>
                      <td className="l tname" title={String(r.task ?? "")}>{String(r.task ?? "—")}</td>
                      <td className="l">{String(r.client ?? "—")}</td>
                      <td className="num">{r.estimated != null ? n1(Number(r.estimated)) + "h" : "—"}</td>
                      <td className="num">{r.tracked != null ? n1(Number(r.tracked)) + "h" : "—"}</td>
                      <td className="l"><span className={`grade ${stc}`}>{st}</span></td>
                      <td className="num" style={{ fontSize: 11.5, color: "var(--muted)" }}>{String(r.due ?? "—")}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </>)}

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

      {/* SETTINGS (Owner) */}
      {showSettings && (
        <div className="modal-bg" onClick={() => setShowSettings(false)}>
          <div className="modal sm-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-h"><div><h3>Settings</h3><div className="sub">data source &amp; role access</div></div><div className="modal-x" onClick={() => setShowSettings(false)}><X size={16} /></div></div>
            <div className="modal-b">
              <div className="set-grid">
                <div className="set-row"><span>Data source</span><b>{live ? "Supabase (Live)" : "CSV (Demo)"}</b></div>
                <div className="set-row"><span>Employees</span><b>{sm.employees}</b></div>
                <div className="set-row"><span>Departments · Teams</span><b>{sm.departments} · {sm.teams}</b></div>
                <div className="set-row"><span>Clients</span><b>{sm.clients}</b></div>
                <div className="set-row"><span>Active days of data</span><b>{n0(sm.active_days)}</b></div>
              </div>
              <h4 className="set-h">Role access</h4>
              <div className="set-roles">
                {ROLE_DEF.map((r) => (
                  <div className="set-role" key={r.id}>
                    <span className="role-chip-ic" style={{ background: r.color }}><r.Icon size={13} /></span>
                    <div><b>{r.label}</b><i>{r.desc}</i></div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* RAW DATA (Owner / Developer) */}
      {rawModal && (
        <div className="modal-bg" onClick={() => setRawModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-h"><div><h3>Raw data <Code2 size={14} style={{ verticalAlign: -2 }} /></h3><div className="sub">{rawData ? `${rawData.shown} of ${n0(rawData.total)} rows · ${data.context.label}` : "loading…"}</div></div><div className="modal-x" onClick={() => setRawModal(false)}><X size={16} /></div></div>
            <div className="modal-b">
              {!rawData ? <div className="loading" style={{ height: 160 }}><span className="spin" /> Loading…</div> : rawData.rows.length === 0 ? <div className="empty-s">No rows in scope</div> : (
                <div className="scrollwrap" style={{ maxHeight: 460 }}>
                  <table className="raw-table">
                    <thead><tr>{Object.keys(rawData.rows[0]).map((c) => <th key={c} className="l">{c}</th>)}</tr></thead>
                    <tbody>
                      {rawData.rows.map((row, i) => (
                        <tr key={i}>{Object.keys(rawData.rows[0]).map((c) => <td key={c} className="l">{String(row[c] ?? "")}</td>)}</tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* UNASSIGNED EMPLOYEES — who & why, exportable */}
      {unaModal && (
        <div className="modal-bg" onClick={() => setUnaModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-h">
              <div>
                <h3><ShieldAlert size={15} style={{ verticalAlign: -2, color: "#e8930c" }} /> Unassigned Employees</h3>
                <div className="sub">{unaData ? `${unaData.count} of ${unaData.total_members} have tracked time but no department/team/client mapping · ${n0(unaData.total_hours)}h` : "loading…"}</div>
              </div>
              <div className="modal-h-r">
                {unaData && unaData.rows.length > 0 && <button className="tb-act" onClick={exportUnassignedCsv}><Download size={14} /><span>CSV</span></button>}
                <div className="modal-x" onClick={() => setUnaModal(false)}><X size={16} /></div>
              </div>
            </div>
            <div className="modal-b">
              {!unaData ? <div className="loading" style={{ height: 160 }}><span className="spin" /> Loading…</div>
                : unaData.rows.length === 0 ? <div className="empty-s">Everyone is mapped — no unassigned employees 🎉</div> : (
                  <div className="scrollwrap" style={{ maxHeight: 480 }}>
                    <table className="ec-table">
                      <thead><tr><th className="l">Employee</th><th>Tracked</th><th>Days</th><th className="l">Reason</th><th className="l">Suggestion</th></tr></thead>
                      <tbody>
                        {unaData.rows.map((r, i) => (
                          <tr key={r.name + i}>
                            <td className="l"><span className="emp-c"><span className="avatar sm" style={{ background: avatarColor(r.name) }}>{initials(r.name)}</span><span className="tname">{r.name}</span></span></td>
                            <td className="num">{n0(r.hours)}h</td>
                            <td className="num">{r.days}</td>
                            <td className="l"><span className="una-reason">{r.reason}</span></td>
                            <td className="l" style={{ color: "var(--muted)" }}>{r.suggestion}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
            </div>
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

function Sparkline({ data, color, id }: { data: number[]; color: string; id: string }) {
  if (!data || data.length < 2) return null;
  const w = 96, h = 28, pad = 2;
  const min = Math.min(...data), max = Math.max(...data), range = max - min || 1;
  const pts = data.map((v, i) => {
    const x = pad + (i / (data.length - 1)) * (w - pad * 2);
    const y = pad + (1 - (v - min) / range) * (h - pad * 2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const line = "M" + pts.join(" L");
  const area = `${line} L${(w - pad).toFixed(1)},${h - pad} L${pad},${h - pad} Z`;
  const gid = `spk-${id}`;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="spark" preserveAspectRatio="none">
      <defs><linearGradient id={gid} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={color} stopOpacity="0.22" /><stop offset="100%" stopColor={color} stopOpacity="0" /></linearGradient></defs>
      <path d={area} fill={`url(#${gid})`} />
      <path d={line} fill="none" stroke={color} strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

function GaugeChart({ value, color = "#e23b3b" }: { value: number; color?: string }) {
  const v = Math.max(0, Math.min(100, value));
  const cx = 130, cy = 122, rIn = 80, rOut = 102, needleR = 70;
  const startDeg = 135, sweep = 270, N = 40;
  const polar = (deg: number, r: number) => { const a = (deg * Math.PI) / 180; return [cx + r * Math.cos(a), cy + r * Math.sin(a)]; };
  const ticks = Array.from({ length: N }, (_, i) => {
    const f = i / (N - 1), deg = startDeg + f * sweep;
    const [x1, y1] = polar(deg, rIn), [x2, y2] = polar(deg, rOut);
    return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke={f * 100 <= v ? color : "#e6e9f0"} strokeWidth="5" strokeLinecap="round" />;
  });
  const [nx, ny] = polar(startDeg + (v / 100) * sweep, needleR);
  const labels = [0, 20, 40, 60, 80, 100].map((s) => {
    const [x, y] = polar(startDeg + (s / 100) * sweep, rIn - 15);
    return <text key={s} x={x} y={y} className="gauge-sc" textAnchor="middle" dominantBaseline="central">{s}</text>;
  });
  return (
    <svg viewBox="0 0 260 200" className="gauge">
      {ticks}{labels}
      <line x1={cx} y1={cy} x2={nx} y2={ny} stroke="#1f2b4d" strokeWidth="3" strokeLinecap="round" />
      <circle cx={cx} cy={cy} r="6.5" fill="#1f2b4d" />
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
