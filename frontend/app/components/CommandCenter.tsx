"use client";

import { useState, useRef, useEffect } from "react";
import {
  ChevronDown, Search, CalendarDays,
  Building2, Network, Users, Briefcase, Receipt, RotateCcw, Clock, X,
  Gauge, Activity, Zap, Award, Tag, Sparkles, Send, BarChart3, ShieldCheck, ShieldAlert,
  Crown, Wrench, Code2, User as UserIcon, LogOut, Download, Settings, Lock,
  Check, ArrowRight, BookOpen, UploadCloud, FileSpreadsheet, Pencil, Bot,
} from "lucide-react";
import {
  getFilters, getCommand, getEmployee, getRaw, getUnassigned, getHoursDetail, getCompareTrend, askAI, currentMonth, getTaskDelivery, getBudget, getClient, getTeam, getClientsList,
  login, fetchMe, logout as apiLogout, listUsers, createUser, resendInvite, setUserStatus, changePassword, getToken,
  getEmailSettings, saveEmailSettings, testEmail, type EmailSettings,
  getKekaStatus, uploadKeka, type KekaMonth, getWorkforce, type WorkforceData,
  getBudgets, saveBudget, deleteBudget, type ClientBudgetRow,
  getTaskDeliveryList, type TaskDeliveryItem,
  type FilterOptions, type CommandData, type Filters, type EmployeeRow, type TeamRow, type EmployeeDetail, type RawData, type UnassignedData, type HoursDetailData, type CompareTrendData,
  type AppUser, type AppRole, type AdminUser,
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
const HR_BADGE: Record<string, [string, string]> = { ACTIVE: ["Active", "ok"], RELIEVED: ["Left", "left"], EXTERNAL: ["External", "ext"], UNKNOWN: ["Unverified", "unk"] };
function hrBadge(s?: string) {
  const m = HR_BADGE[s || ""];
  return m ? <span className={`hrb ${m[1]}`}>{m[0]}</span> : null;
}
type AiMsg = {
  role: "user" | "ai"; text: string; insight?: string; kind?: "bar" | "donut" | "none";
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

function LoginScreen({ onLogin }: { onLogin: (u: AppUser) => void }) {
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const FEATS = ["Real-time utilization & productivity", "Team, client & billing intelligence", "Secure role-based access"];
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy || !email.trim() || !pw) return;
    setBusy(true); setErr("");
    try { const { user } = await login(email.trim(), pw); onLogin(user); }
    catch (ex) { setErr((ex as Error).message || "Sign in failed"); setBusy(false); }
  }
  return (
    <div className="role-screen">
      <div className="role-shell">
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
        <main className="role-pick">
          <div className="role-pick-head">
            <span className="role-eyebrow">Sign in</span>
            <h1>Welcome back</h1>
            <p>Enter your credentials to access your dashboard.</p>
          </div>
          <form className="login-form" onSubmit={submit}>
            <label className="login-lbl">Email</label>
            <div className="login-field"><UserIcon size={15} /><input type="email" autoFocus autoComplete="username" placeholder="you@finovate.com" value={email} onChange={(e) => setEmail(e.target.value)} /></div>
            <label className="login-lbl">Password</label>
            <div className="login-field"><Lock size={15} /><input type="password" autoComplete="current-password" placeholder="••••••••" value={pw} onChange={(e) => setPw(e.target.value)} /></div>
            {err && <div className="login-err"><ShieldAlert size={13} />{err}</div>}
            <button type="submit" className="role-go" disabled={busy || !email.trim() || !pw}>
              {busy ? <><span className="spin sm" /> Signing in…</> : <>Sign in <ArrowRight size={16} /></>}
            </button>
          </form>
          <div className="role-note"><Lock size={11} /> Access is invite-only. Contact your administrator for an account.</div>
        </main>
      </div>
    </div>
  );
}

function ChangePwModal({ onClose }: { onClose: () => void }) {
  const [oldP, setOldP] = useState(""); const [newP, setNewP] = useState(""); const [conf, setConf] = useState("");
  const [busy, setBusy] = useState(false); const [err, setErr] = useState(""); const [done, setDone] = useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    if (newP.length < 6) { setErr("New password must be at least 6 characters"); return; }
    if (newP !== conf) { setErr("Passwords do not match"); return; }
    setBusy(true); setErr("");
    try { await changePassword(oldP, newP); setDone(true); setTimeout(onClose, 1100); }
    catch (ex) { setErr((ex as Error).message); setBusy(false); }
  }
  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal sm-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-h"><div><h3>Change password</h3><div className="sub">choose a strong, unique password</div></div><div className="modal-x" onClick={onClose}><X size={16} /></div></div>
        <div className="modal-b">
          {done ? <div className="empty-s" style={{ color: "#16a34a" }}>✓ Password updated</div> : (
            <form className="login-form" onSubmit={submit}>
              <label className="login-lbl">Current password</label>
              <div className="login-field"><Lock size={15} /><input type="password" autoFocus value={oldP} onChange={(e) => setOldP(e.target.value)} /></div>
              <label className="login-lbl">New password</label>
              <div className="login-field"><Lock size={15} /><input type="password" value={newP} onChange={(e) => setNewP(e.target.value)} /></div>
              <label className="login-lbl">Confirm new password</label>
              <div className="login-field"><Lock size={15} /><input type="password" value={conf} onChange={(e) => setConf(e.target.value)} /></div>
              {err && <div className="login-err"><ShieldAlert size={13} />{err}</div>}
              <button type="submit" className="role-go" disabled={busy || !oldP || !newP}>{busy ? <><span className="spin sm" /> Updating…</> : "Update password"}</button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}

export default function CommandCenter({
  initialOpts, initialData,
}: { initialOpts: FilterOptions | null; initialData: CommandData | null }) {
  const [opts, setOpts] = useState<FilterOptions | null>(initialOpts);
  const [draft, setDraft] = useState<Filters>(initialOpts ? currentMonth(initialOpts) : {});
  const [data, setData] = useState<CommandData | null>(initialData);
  const [loading, setLoading] = useState(false);
  const [showFilters, setShowFilters] = useState(true);
  const [detail, setDetail] = useState<null | { label: string; color: string; calc: string; get: (e: EmployeeRow) => number; fmt: (v: number) => string; dayKey?: "utilization" | "activity" | "productivity" }>(null);
  const [cmpDim, setCmpDim] = useState<"department" | "team">("department");
  const [clientTab, setClientTab] = useState<"top" | "bottom">("top");
  const [perfTab, setPerfTab] = useState<"top" | "bottom">("top");
  const [emp, setEmp] = useState<{ name: string; data: EmployeeDetail | null } | null>(null);
  const [clientProf, setClientProf] = useState<{ name: string; data: import("../lib/api").ClientProfile | null } | null>(null);
  const [teamProf, setTeamProf] = useState<{ name: string; data: import("../lib/api").TeamProfile | null } | null>(null);
  const [tdList, setTdList] = useState<{ bucket: string; label: string; color: string; rows: TaskDeliveryItem[] | null } | null>(null);
  async function openTaskList(bucket: "on_time" | "late" | "open", label: string, color: string) {
    setTdList({ bucket, label, color, rows: null });
    try { setTdList({ bucket, label, color, rows: (await getTaskDeliveryList(bucket, draft)).rows }); }
    catch { setTdList({ bucket, label, color, rows: [] }); }
  }
  // All tasks for one client in scope (opened from the Budget modal's Tasks cell).
  async function openClientTasks(client: string) {
    setBudgetModal(false);
    const label = client; const color = "#2f6fbf";
    setTdList({ bucket: "all", label, color, rows: null });
    try { setTdList({ bucket: "all", label, color, rows: (await getTaskDeliveryList("all", { ...draft, client })).rows }); }
    catch { setTdList({ bucket: "all", label, color, rows: [] }); }
  }
  async function openClient(name: string) {
    setClientProf({ name, data: null });
    try { setClientProf({ name, data: await getClient(name, draft) }); } catch { setClientProf({ name, data: { found: false } }); }
  }
  async function openTeam(name: string) {
    setTeamProf({ name, data: null });
    try { setTeamProf({ name, data: await getTeam(name, draft) }); } catch { setTeamProf({ name, data: { found: false } }); }
  }
  const [chatOpen, setChatOpen] = useState(false);
  const [aiQ, setAiQ] = useState("");
  const [aiBusy, setAiBusy] = useState(false);
  const [messages, setMessages] = useState<AiMsg[]>([]);
  const chatRef = useRef<HTMLDivElement>(null);
  useEffect(() => { if (chatRef.current) chatRef.current.scrollTop = chatRef.current.scrollHeight; }, [messages, aiBusy, chatOpen]);

  // ---- authenticated session (real login; role/scope come from the server) ----
  const [authUser, setAuthUser] = useState<AppUser | null>(null);
  const [role, setRole] = useState<Role | null>(null);
  const [selfName, setSelfName] = useState<string>("");
  const [roleReady, setRoleReady] = useState(false);
  const [usersModal, setUsersModal] = useState(false);
  const [pwModal, setPwModal] = useState(false);
  const [kekaModal, setKekaModal] = useState(false);
  const [kekaStatus, setKekaStatus] = useState<KekaMonth[] | null>(null);
  const [kekaBusy, setKekaBusy] = useState(false);
  const [kekaMsg, setKekaMsg] = useState<{ ok?: string; err?: string } | null>(null);
  const [kekaSearch, setKekaSearch] = useState("");
  const [kekaDrag, setKekaDrag] = useState(false);
  const [hoursCfg, setHoursCfg] = useState<import("../lib/api").HoursConfig | null>(null);
  const [hoursBusy, setHoursBusy] = useState(false);
  const [newPol, setNewPol] = useState<{ from: string; shift: number; thr: number; sbrk: number; lbrk: number }>({ from: "", shift: 9, thr: 6, sbrk: 30, lbrk: 60 });
  async function addPolicy() {
    if (!newPol.from) { alert("Pick an effective-from date"); return; }
    setHoursBusy(true);
    const api = await import("../lib/api");
    const r = await api.saveHoursConfig({
      effective_from: newPol.from, shift_min: Math.round(newPol.shift * 60), threshold_min: Math.round(newPol.thr * 60),
      short_break_min: Math.round(newPol.sbrk), long_break_min: Math.round(newPol.lbrk),
    });
    setHoursBusy(false);
    if (r.ok) { setNewPol({ from: "", shift: 9, thr: 6, sbrk: 30, lbrk: 60 }); try { setHoursCfg(await api.getHoursConfig()); } catch { /* keep */ } }
    else alert("Save failed: " + (r.detail || r.reason));
  }
  async function delPolicy(eff: string) {
    setHoursBusy(true);
    const api = await import("../lib/api");
    const r = await api.deleteHoursPolicy(eff);
    setHoursBusy(false);
    if (r.ok) { try { setHoursCfg(await api.getHoursConfig()); } catch { /* keep */ } }
    else alert("Delete failed: " + (r.detail || r.reason));
  }
  function fmtMonth(m: string) {
    const mm = /^(\d{4})-(\d{2})$/.exec(m || "");
    if (!mm) return m;
    const names = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
    return `${names[+mm[2] - 1] || mm[2]} ${mm[1]}`;
  }
  async function openKeka() {
    setKekaModal(true); setKekaMsg(null); setKekaSearch(""); setKekaStatus(null); setHoursCfg(null);
    const api = await import("../lib/api");
    try { setKekaStatus((await getKekaStatus()).months); } catch { setKekaStatus([]); }
    try { setHoursCfg(await api.getHoursConfig()); } catch { /* optional */ }
  }
  async function doKekaUpload(file: File) {
    setKekaBusy(true); setKekaMsg(null);
    try {
      const r = await uploadKeka(file);
      setKekaMsg({ ok: `Uploaded ${r.rows} rows · ${r.employees} employees · ${r.months.join(", ")}` });
      setKekaStatus((await getKekaStatus()).months);

    } catch (e) { setKekaMsg({ err: (e as Error).message }); }
    finally { setKekaBusy(false); }
  }
  // ---- Client budgets (editable table) ----
  const [budgetAdminModal, setBudgetAdminModal] = useState(false);
  const [budgetRows, setBudgetRows] = useState<ClientBudgetRow[] | null>(null);
  const [budgetQuery, setBudgetQuery] = useState("");
  const [budgetMsg, setBudgetMsg] = useState<{ ok?: string; err?: string } | null>(null);
  const [newBudget, setNewBudget] = useState<ClientBudgetRow>({ client: "", team: "", type: "Hourly", monthly_budget: 0 });
  async function openBudgets() { setBudgetAdminModal(true); setBudgetMsg(null); setBudgetRows(null); try { setBudgetRows((await getBudgets()).rows); } catch { setBudgetRows([]); } }
  async function persistBudget(row: ClientBudgetRow) {
    setBudgetMsg(null);
    const r = await saveBudget({ ...row, monthly_budget: Number(row.monthly_budget) || 0 });
    if (r.ok) { setBudgetMsg({ ok: `Saved ${row.client}` }); setBudget(await getBudget(draft)); }
    else setBudgetMsg({ err: r.detail || r.reason || "save failed" });
    return r.ok;
  }
  async function addBudget() {
    if (!newBudget.client.trim()) { setBudgetMsg({ err: "Client name required" }); return; }
    if (await persistBudget(newBudget)) {
      setBudgetRows((rows) => [...(rows || []).filter((x) => x.client !== newBudget.client), newBudget].sort((a, b) => a.client.localeCompare(b.client)));
      setNewBudget({ client: "", team: "", type: "Hourly", monthly_budget: 0 });
    }
  }
  async function removeBudget(client: string) {
    const r = await deleteBudget(client);
    if (r.ok) { setBudgetRows((rows) => (rows || []).filter((x) => x.client !== client)); setBudgetMsg({ ok: `Removed ${client}` }); setBudget(await getBudget(draft)); }
    else setBudgetMsg({ err: r.reason || "delete failed" });
  }
  const [usersData, setUsersData] = useState<{ users: AdminUser[]; smtp: boolean; owner_email: string } | null>(null);
  const [uForm, setUForm] = useState({ email: "", role: "employee", full_name: "", scope_team: "" });
  const [uBusy, setUBusy] = useState(false);
  const [uMsg, setUMsg] = useState<{ link?: string; sent?: boolean; err?: string } | null>(null);
  async function loadUsers() {
    setUsersData(null);
    try { setUsersData(await listUsers()); } catch { setUsersData({ users: [], smtp: false, owner_email: "" }); }
  }
  useEffect(() => { if (usersModal) loadUsers(); }, [usersModal]);
  async function submitCreateUser() {
    if (uBusy || !uForm.email.trim()) return;
    setUBusy(true); setUMsg(null);
    try {
      const r = await createUser({
        email: uForm.email.trim(), role: uForm.role,
        full_name: uForm.full_name.trim() || undefined,
        scope_team: uForm.role === "lead" ? (uForm.scope_team || undefined) : undefined,
      });
      setUMsg({ link: r.invite_link, sent: r.email_sent });
      setUForm({ email: "", role: "employee", full_name: "", scope_team: "" });
      loadUsers();
    } catch (e) { setUMsg({ err: (e as Error).message }); }
    finally { setUBusy(false); }
  }
  async function doResend(id: number) {
    try { const r = await resendInvite(id); setUMsg({ link: r.invite_link, sent: r.email_sent }); loadUsers(); }
    catch (e) { setUMsg({ err: (e as Error).message }); }
  }
  async function toggleUser(id: number, active: boolean) {
    try { await setUserStatus(id, active); loadUsers(); } catch (e) { alert((e as Error).message); }
  }
  // ---- email (SMTP) settings, editable in-app (overrides Coolify env) ----
  const [usersTab, setUsersTab] = useState<"users" | "email">("users");
  const [emailCfg, setEmailCfg] = useState<EmailSettings | null>(null);
  const [emailForm, setEmailForm] = useState({ smtp_host: "", smtp_port: "587", smtp_user: "", smtp_pass: "", smtp_from: "", public_app_url: "" });
  const [emailBusy, setEmailBusy] = useState("");
  const [emailMsg, setEmailMsg] = useState<{ ok?: string; err?: string } | null>(null);
  const [testTo, setTestTo] = useState("");
  async function loadEmailCfg() {
    setEmailCfg(null);
    try {
      const c = await getEmailSettings();
      setEmailCfg(c);
      setEmailForm({ smtp_host: c.smtp_host || "", smtp_port: c.smtp_port || "587", smtp_user: c.smtp_user || "", smtp_pass: "", smtp_from: c.smtp_from || "", public_app_url: c.public_app_url || "" });
      setTestTo((t) => t || c.smtp_from || "");
    } catch { /* owner-only */ }
  }
  useEffect(() => { if (usersModal && usersTab === "email") loadEmailCfg(); }, [usersModal, usersTab]);
  async function saveEmailCfg() {
    setEmailBusy("save"); setEmailMsg(null);
    try { await saveEmailSettings(emailForm); setEmailMsg({ ok: "Settings saved." }); loadEmailCfg(); }
    catch (e) { setEmailMsg({ err: (e as Error).message }); }
    finally { setEmailBusy(""); }
  }
  async function sendTestEmail() {
    if (!testTo.trim()) return;
    setEmailBusy("test"); setEmailMsg(null);
    try { await testEmail(testTo.trim()); setEmailMsg({ ok: `Test email sent to ${testTo.trim()} — check the inbox.` }); }
    catch (e) { setEmailMsg({ err: (e as Error).message }); }
    finally { setEmailBusy(""); }
  }
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
  const [hoursModal, setHoursModal] = useState(false);
  const [hoursData, setHoursData] = useState<HoursDetailData | null>(null);
  const [hoursSearch, setHoursSearch] = useState("");
  const [gradeModal, setGradeModal] = useState(false);
  const [cmpTrend, setCmpTrend] = useState<CompareTrendData | null>(null);
  const [taskDel, setTaskDel] = useState<import("../lib/api").TaskDelivery | null>(null);
  const [budget, setBudget] = useState<import("../lib/api").BudgetData | null>(null);
  const [workforce, setWorkforce] = useState<WorkforceData | null>(null);
  const [budgetModal, setBudgetModal] = useState(false);
  const [clientsModal, setClientsModal] = useState(false);
  const [clientsData, setClientsData] = useState<import("../lib/api").ClientsListData | null>(null);
  async function openClients() {
    setClientsModal(true); setClientsData(null);
    try { setClientsData(await getClientsList(draft)); } catch { setClientsData({ clients: [], count: 0, total_hours: 0 }); }
  }
  const [budgetSort, setBudgetSort] = useState<"over" | "actual">("over");
  const [mapModal, setMapModal] = useState(false);
  const [mapData, setMapData] = useState<import("../lib/api").MappingData | null>(null);
  const [mapSearch, setMapSearch] = useState("");
  const [mapBusy, setMapBusy] = useState("");
  async function openMapping() {
    setMapModal(true); setMapData(null);
    try { setMapData(await (await import("../lib/api")).getMapping()); } catch { setMapData({ exists: false, write: false, count: 0, rows: [] }); }
  }
  async function mapInit() {
    setMapBusy("init"); const api = await import("../lib/api");
    const r = await api.initMapping(); setMapBusy("");
    if (r.ok) { setMapData(await api.getMapping()); } else { alert("Init failed: " + (r.detail || r.reason)); }
  }
  // Right-side "Update Employee Mapping" drawer (edit + dated team transfer in one place)
  type MapEditState = { row: import("../lib/api").MappingRow; hr_full_name: string; hr_employee_no: string; status: string; department: string; team: string; xferDate: string; reason: string; notes: string; histOpen: boolean };
  const [mapEdit, setMapEdit] = useState<MapEditState | null>(null);
  const [mapFDept, setMapFDept] = useState("");
  const [mapFTeam, setMapFTeam] = useState("");
  const [mapFStatus, setMapFStatus] = useState("");
  function exportMapping() {
    const rows = mapData?.rows || [];
    const head = ["Hubstaff Name", "HR Name", "Employee ID", "Status", "Department", "Team", "Hours"];
    const keys: (keyof import("../lib/api").MappingRow)[] = ["hubstaff_name", "hr_full_name", "hr_employee_no", "status", "department", "team", "total_hours"];
    const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const csv = [head.join(","), ...rows.map((r) => keys.map((k) => esc(r[k])).join(","))].join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    a.download = "employee_mapping.csv"; a.click();
  }
  const [budgetFType, setBudgetFType] = useState("");
  const XFER_REASONS = ["Team Restructuring", "Promotion", "Performance", "Client Requirement", "Resource Reallocation", "Role Change", "Other"];
  function fmtDate(s?: string | null) {
    if (!s) return "—";
    const d = new Date(s + "T00:00:00");
    return isNaN(+d) ? s : d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
  }
  function lastTransferDate(r: import("../lib/api").MappingRow) {
    const h = r.history || [];
    return h.length ? fmtDate(h[h.length - 1].effective_from) : "—";
  }
  function initials(name: string) {
    const p = (name || "").trim().split(/\s+/).filter(Boolean);
    return ((p[0]?.[0] || "") + (p.length > 1 ? p[p.length - 1][0] : "")).toUpperCase() || "?";
  }
  function openMapEdit(r: import("../lib/api").MappingRow, histOpen = false) {
    setMapEdit({ row: r, hr_full_name: r.hr_full_name || "", hr_employee_no: r.hr_employee_no || "", status: r.status || "ACTIVE", department: r.department || "", team: r.team || "", xferDate: "", reason: "", notes: r.notes || "", histOpen });
  }
  async function saveMapEdit() {
    if (!mapEdit) return;
    const e = mapEdit, orig = e.row, api = await import("../lib/api");
    const teamChanged = (e.team || "") !== (orig.team || "");
    const deptChanged = (e.department || "") !== (orig.department || "");
    const canTransfer = !!orig.hubstaff_user_id;
    setMapBusy(orig.hubstaff_name);
    if ((teamChanged || deptChanged) && canTransfer) {
      if (!e.xferDate) { setMapBusy(""); alert("Team/Department badla hai — Date of Transfer zaroori hai (history record ke liye)."); return; }
      const r = await api.transferTeam({ hubstaff_name: orig.hubstaff_name, new_team: e.team, new_department: e.department || undefined, effective_from: e.xferDate, reason: e.reason || undefined });
      if (!r.ok) { setMapBusy(""); alert("Transfer failed: " + (r.detail || r.reason)); return; }
    }
    const patch: Partial<import("../lib/api").MappingRow> = {};
    if ((e.hr_full_name || "") !== (orig.hr_full_name || "")) patch.hr_full_name = e.hr_full_name;
    if ((e.hr_employee_no || "") !== (orig.hr_employee_no || "")) patch.hr_employee_no = e.hr_employee_no;
    if ((e.status || "") !== (orig.status || "")) patch.status = e.status;
    if ((e.notes || "") !== (orig.notes || "")) patch.notes = e.notes;
    if ((teamChanged || deptChanged) && !canTransfer) { patch.team = e.team; patch.department = e.department; }
    if (Object.keys(patch).length) {
      const r = await api.saveMapping({ hubstaff_name: orig.hubstaff_name, ...patch });
      if (!r.ok) { setMapBusy(""); alert("Save failed: " + (r.detail || r.reason)); return; }
    }
    setMapBusy(""); setMapEdit(null); setMapData(await api.getMapping());
  }
  useEffect(() => {
    const sp = (v?: string) => (v || "").split(",").map((s) => s.trim()).filter(Boolean);
    const emp = sp(draft.employee), team = sp(draft.atl), dept = sp(draft.department);
    let kind = "", names: string[] = [];
    if (emp.length >= 2) { kind = "employee"; names = emp; }
    else if (team.length >= 2) { kind = "team"; names = team; }
    else if (dept.length >= 2) { kind = "department"; names = dept; }
    if (!kind) { setCmpTrend(null); return; }
    let cancelled = false;
    getCompareTrend(kind, names, draft).then((d) => { if (!cancelled) setCmpTrend(d); }).catch(() => { if (!cancelled) setCmpTrend(null); });
    return () => { cancelled = true; };
  }, [draft.employee, draft.atl, draft.department, draft.date_from, draft.date_to]);
  function mapRole(r: AppRole): Role {
    return r === "owner" ? "owner" : r === "employee" ? "user" : "admin";
  }
  // scope a base filter set to the signed-in user (employee → self, lead → team)
  function scopedBase(u: AppUser, o: FilterOptions | null): Filters {
    const base: Filters = o ? currentMonth(o) : {};
    if (u.role === "employee" && u.full_name) return { ...base, employee: u.full_name };
    if (u.role === "lead" && u.scope_team) return { ...base, atl: u.scope_team };
    return base;
  }
  function applyAuthUser(u: AppUser) {
    setAuthUser(u);
    setRole(mapRole(u.role));
    setSelfName(u.role === "employee" ? (u.full_name || "") : "");
  }
  async function onLogin(u: AppUser) {
    applyAuthUser(u);
    try {
      let o = opts;
      if (!o) { o = await getFilters(); setOpts(o); }
      const base = scopedBase(u, o);
      setDraft(base); apply(base);
    } catch { /* surfaced on next interaction */ }
  }
  function doLogout() {
    apiLogout();
    setAuthUser(null); setRole(null); setSelfName(""); setAcctOpen(false);
    setShowSettings(false); setUsersModal(false); setData(null);
  }
  useEffect(() => {
    (async () => {
      try {
        const u = await fetchMe();
        if (u) {
          applyAuthUser(u);
          if (!initialData) {                       // gated SSR → load scoped data now
            let o = initialOpts || (await getFilters());
            setOpts(o); const base = scopedBase(u, o);
            setDraft(base); apply(base);
          }
        }
      } catch { /* not signed in → login screen */ }
      setRoleReady(true);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
      setMessages((m) => [...m, { role: "ai", text: r.ok && r.text ? r.text : "Sorry, I couldn't answer that. Try rephrasing — e.g. 'Aashima's hours this month', 'clients over budget', 'Synergy team tracked hours', 'top performers'.", insight: r.insight, kind: r.kind, bars: r.bars, donut: r.donut }]);
    } catch {
      setMessages((m) => [...m, { role: "ai", text: "AI is unavailable right now. Please try again." }]);
    } finally { setAiBusy(false); }
  }

  useEffect(() => {
    // fetch on-time delivery for the initial period (covers SSR initialData path)
    const r0 = initialOpts ? currentMonth(initialOpts) : (draft.date_from ? draft : null);
    if (r0) getTaskDelivery(r0).then(setTaskDel).catch(() => setTaskDel(null));
    if (r0) getBudget(r0).then(setBudget).catch(() => setBudget(null));
    if (r0) getWorkforce(r0).then(setWorkforce).catch(() => setWorkforce(null));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialOpts]);

  // resilient client-side load for OPEN mode (no auth) when SSR couldn't reach
  // the backend. When a session token exists, the auth effect drives the load.
  useEffect(() => {
    if (initialData || getToken()) return;
    let cancelled = false;
    (async () => {
      try {
        let o = initialOpts;
        if (!o) { o = await getFilters(); if (cancelled) return; setOpts(o); setDraft(currentMonth(o)); }
        const r = currentMonth(o);
        getTaskDelivery(r).then((td) => { if (!cancelled) setTaskDel(td); }).catch(() => {});
        getBudget(r).then((bg) => { if (!cancelled) setBudget(bg); }).catch(() => {});
        getWorkforce(r).then((wf) => { if (!cancelled) setWorkforce(wf); }).catch(() => {});
        const cmd = await getCommand(r);
        if (cancelled) return;
        setData(cmd);
      } catch { /* retry on next interaction */ }
    })();
    return () => { cancelled = true; };
  }, [initialData, initialOpts]);

  async function apply(f: Filters) {
    setLoading(true);
    // keep the dropdowns scoped to the active period + drill scope
    refetchOpts({ department: f.department, atl: f.atl, date_from: f.date_from, date_to: f.date_to });
    getTaskDelivery(f).then(setTaskDel).catch(() => setTaskDel(null));
    getBudget(f).then(setBudget).catch(() => setBudget(null));
    getWorkforce(f).then(setWorkforce).catch(() => setWorkforce(null));
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
  async function refetchOpts(scope: { department?: string; atl?: string; date_from?: string; date_to?: string }) {
    try { setOpts(await getFilters(scope)); } catch { /* keep */ }
  }
  function setField(key: keyof Filters, v: string) { const next = { ...draft, [key]: v || undefined }; setDraft(next); apply(next); }
  function setDept(v: string) { const next = { ...draft, department: v || undefined, atl: undefined, employee: undefined }; setDraft(next); apply(next); }
  function setAtl(v: string) { const next = { ...draft, atl: v || undefined, employee: undefined }; setDraft(next); apply(next); }
  function clearFilters() { const base: Filters = opts ? currentMonth(opts) : {}; setDraft(base); apply(base); }
  // breadcrumb drill-up: jump to a parent scope, clearing deeper filters
  function goCompany() { const n = { ...draft, department: undefined, atl: undefined, employee: undefined }; setDraft(n); apply(n); }
  function goDept() { const n = { ...draft, atl: undefined, employee: undefined }; setDraft(n); apply(n); }
  function goTeam() { const n = { ...draft, employee: undefined }; setDraft(n); apply(n); }
  function openRaw() { setRawModal(true); setRawData(null); getRaw(draft).then(setRawData).catch(() => setRawData({ rows: [], total: 0, shown: 0 })); }
  function openUnassigned() { setUnaModal(true); setUnaData(null); setUnaPick({}); getUnassigned().then(setUnaData).catch(() => setUnaData({ rows: [], count: 0, total_hours: 0, total_members: 0 })); }
  const [unaPick, setUnaPick] = useState<Record<string, { dept?: string; team?: string }>>({});
  const [unaBusy, setUnaBusy] = useState("");
  async function assignUna(r: { uid: string; name: string }) {
    const sel = unaPick[r.uid] || {};
    if (!sel.dept && !sel.team) { alert("Pick a team or department first"); return; }
    setUnaBusy(r.uid);
    const api = await import("../lib/api");
    const res = await api.assignUnassigned({ uid: r.uid, name: r.name, department: sel.dept, team: sel.team });
    setUnaBusy("");
    if (res.ok) { setUnaData((d) => d ? { ...d, rows: d.rows.filter((x) => x.uid !== r.uid), count: d.count - 1 } : d); }
    else alert("Assign failed: " + (res.detail || res.reason));
  }
  function openHours(mode?: "Billable" | "Non-Billable") {
    setHoursModal(true); setHoursData(null); setHoursSearch("");
    const f: Filters = mode ? { ...draft, billable: mode } : draft;
    getHoursDetail(f).then(setHoursData).catch(() => setHoursData({ rows: [], count: 0 }));
  }
  function exportHoursCsv() {
    const q = hoursSearch.trim().toLowerCase();
    const rows = (hoursData?.rows || []).filter((r) => !q || r.employee.toLowerCase().includes(q) || r.project.toLowerCase().includes(q) || r.task.toLowerCase().includes(q));
    const head = ["Employee", "Project", "Task", "Billable_h", "NonBillable_h", "Total_h"];
    const esc = (v: string | number) => { const s = String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    const lines = [head.join(",")];
    rows.forEach((r) => lines.push([r.employee, r.project, r.task, r.billable, r.non_billable, r.total].map(esc).join(",")));
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = "finovate_hours_detail.csv"; a.click(); URL.revokeObjectURL(url);
  }
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

  if (!roleReady) return <div className="page"><div className="loading"><span className="spin" /> Loading…</div></div>;
  if (!authUser) return <LoginScreen onLogin={onLogin} />;
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
  const billablePct = total > 0 ? (billable / total) * 100 : 0;
  const activeStaff = (data.employees || []).filter((e) => e.hr_status === "ACTIVE").length;
  const onTimePct = taskDel ? taskDel.on_time_pct : 0;
  const kTone = (v: number, good: number, warn: number) => (v >= good ? "ok" : v >= warn ? "warn" : "bad");
  const gradeStr = String(k.avg_grade?.value ?? "—");
  const cmp = data.period?.comparable;
  const pv = data.period?.previous;

  const openMetric = (label: string, color: string, calc: string, get: (e: EmployeeRow) => number, fmt: (v: number) => string, dayKey?: "utilization" | "activity" | "productivity") =>
    () => setDetail({ label, color, calc, get, fmt, dayKey });

  // image-style KPI card: tinted top + solid icon badge, white body w/ value + delta
  const KPICOL: Record<string, { tint: string; badge: string }> = {
    green: { tint: "#e7f6ec", badge: "#16a34a" },
    teal: { tint: "#e2f5f1", badge: "#0d9488" },
    purple: { tint: "#f1e9fb", badge: "#8b5cf6" },
    blue: { tint: "#e8f1fd", badge: "#2f6fbf" },
    amber: { tint: "#fdf2e1", badge: "#e8930c" },
    rose: { tint: "#fdeaea", badge: "#ef4444" },
  };
  const kpiCard = (key: string, label: string, value: string, colorKey: string, Icon: React.ComponentType<{ size?: number }>, deltaKey?: string, onClick?: () => void, tone?: string, foot?: string, prog?: { val: number; target: number }) => {
    const c = KPICOL[colorKey];
    const t = deltaKey ? (data.kpis[deltaKey]?.trend ?? null) : null;
    const hasDelta = cmp && t !== null;
    const tcol = tone === "ok" ? "#16a34a" : tone === "warn" ? "#e8930c" : tone === "bad" ? "#ef4444" : c.badge;
    return (
      <div className={`kc3${onClick ? " kclk" : ""}${tone ? " t-" + tone : ""}`} key={key} onClick={onClick}>
        <div className="kc3-top">
          <div className="kc3-info">
            <span className="kc3-lbl">{label}</span>
            <div className="kc3-val num">{value}</div>
          </div>
          <span className="kc3-ic" style={{ background: c.badge }}><Icon size={16} /></span>
        </div>
        {prog && (
          <div className="kc3-prog" title={`${n1(prog.val)} of ${prog.target} target`}>
            <i style={{ width: `${Math.min(100, (prog.val / prog.target) * 100)}%`, background: tcol }} />
            <u style={{ left: "100%" }} />
          </div>
        )}
        <div className="kc3-foot">
          {hasDelta && <span className={`kc3-delta ${t! >= 0 ? "up" : "down"}`}>{t! > 0 ? "+" : ""}{t}%</span>}
          <span className="kc3-sub">{hasDelta ? `vs last ${pv?.days ?? 30}d` : (foot || "this month")}</span>
        </div>
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
            const name = authUser?.full_name || selfName || rd.label;
            const email = authUser?.email || ((caps.self ? name.toLowerCase().split(" ")[0].replace(/[^a-z0-9]/g, "") : role) + "@finovate.app");
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
                      <div className="acct-h-nm">{authUser?.full_name || name}</div>
                      <div className="acct-h-em">{authUser?.email || email}</div>
                      <span className="acct-badge" style={{ color: rd.color, background: rd.color + "1a" }}>{rd.label.toUpperCase()}</span>
                    </div>
                    <div className="acct-items">
                      <button className="acct-item" onClick={() => { setAcctOpen(false); if (caps.self) openEmployee(name); else setShowSettings(true); }}><UserIcon size={16} />Your profile</button>
                      {caps.settings && <button className="acct-item" onClick={() => { setAcctOpen(false); setShowSettings(true); }}><Settings size={16} />Settings</button>}
                      {caps.export && <button className="acct-item" onClick={() => { setAcctOpen(false); exportCsv(); }}><Download size={16} />Export to CSV</button>}
                      {caps.raw && <button className="acct-item" onClick={() => { setAcctOpen(false); openRaw(); }}><Code2 size={16} />Raw data</button>}
                      {caps.settings && <button className="acct-item" onClick={() => { setAcctOpen(false); openMapping(); }}><Users size={16} />Employee mapping</button>}
                      {authUser?.role === "owner" && <button className="acct-item" onClick={() => { setAcctOpen(false); openKeka(); }}><Clock size={16} />Keka attendance (office hours)</button>}
                      {authUser?.role === "owner" && <button className="acct-item" onClick={() => { setAcctOpen(false); openBudgets(); }}><Briefcase size={16} />Client budgets</button>}
                      {authUser?.role === "owner" && <button className="acct-item" onClick={() => { setAcctOpen(false); setUsersModal(true); }}><ShieldCheck size={16} />Users &amp; access</button>}
                      <button className="acct-item" onClick={() => { setAcctOpen(false); setPwModal(true); }}><Lock size={16} />Change password</button>
                      <button className="acct-item" onClick={() => { setAcctOpen(false); setChatOpen(true); }}><Sparkles size={16} />AI assistant</button>
                      <button className="acct-item" onClick={() => { setAcctOpen(false); window.open("https://github.com/dilranjankr/-finovate-pulse#readme", "_blank"); }}><BookOpen size={16} />Documentation</button>
                    </div>
                    <div className="acct-foot">
                      <button className="acct-item danger" onClick={() => { setAcctOpen(false); doLogout(); }}><LogOut size={16} />Sign out</button>
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
            <MultiSelect Icon={Users} label="Employee" value={draft.employee} opts={opts?.employees} on={(v) => setField("employee", v)} allLabel="All Employees" status={opts?.employee_status} />
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

      {/* KPI — 8 clean cards (label + big value + icon badge + delta) */}
      <div className="kpi-grid">
        {kpiCard("k-util", "Utilization", n1(util) + "%", "purple", Gauge, "utilization",
          openMetric("Utilization", "#8b5cf6", "Tracked hours ÷ REAL office hours (Keka attendance; 8h/day if no attendance) × 100, capped at 100%. Target 80%.", (e) => e.utilization, (v) => n1(v) + "%", "utilization"), kTone(util, 80, 60), "of office hours")}
        {kpiCard("k-bill", "Billable", n0(billable) + "h", "green", Receipt, undefined,
          openMetric("Billable", "#16a34a", "Billable hours and their share of total tracked time.", (e) => e.billable, (v) => n0(v) + "h"), undefined, n1(billablePct) + "% of total")}
        {kpiCard("k-act", "Activity", n1(act) + "%", "teal", Activity, "activity",
          openMetric("Activity", "#0d9488", "Active time (keyboard + mouse) ÷ tracked time × 100.", (e) => e.activity, (v) => n1(v) + "%", "activity"), undefined, "of tracked time")}
        {kpiCard("k-prod", "Productivity", n1(prod) + "%", "amber", Zap, "productivity",
          openMetric("Productivity", "#e8930c", "Billable hours ÷ tracked hours × 100 — the share of tracked time that is billable.", (e) => e.productivity, (v) => n1(v) + "%", "productivity"), undefined, "billable share")}
        {kpiCard("k-staff", "Active Staff", String(activeStaff), "blue", Users, undefined,
          openMetric("Active Staff", "#2f6fbf", "Employees who tracked time in this period, by total hours.", (e) => e.billable + e.non_billable, (v) => n1(v) + "h"), undefined, `of ${peopleN} tracked`)}
        {kpiCard("k-clients", "Active Clients", n0(sm.clients), "teal", Building2, undefined, openClients, undefined, "worked this period")}
        {kpiCard("k-cpe", "Clients / Employee", sm.employees ? n1(sm.clients / sm.employees) : "—", "purple", Network, undefined, undefined, undefined, "avg load ratio")}
        {budget && budget.count > 0
          ? kpiCard("k-budget", "Over Budget", `${budget.over} of ${budget.count}`, "rose", Briefcase, undefined,
              () => setBudgetModal(true),
              budget.over > budget.count * 0.5 ? "bad" : budget.over > budget.count * 0.25 ? "warn" : "ok",
              `${n0(budget.total_actual)}h used vs ${n0(budget.total_budget)}h budget`)
          : kpiCard("k-budget", "Over Budget", "—", "rose", Briefcase, undefined, undefined, undefined, "no budget match")}
      </div>

      {/* Total Hours + Task Delivery — two donuts, one row */}
      <div className="donut-row">
        <DonutCard title="Total Hours" sub="billable vs non-billable — click a slice" onClick={() => openHours()}
          onSeg={(label) => openHours(label === "Billable" ? "Billable" : "Non-Billable")}
          centerValue={n0(total)} centerLabel="hrs total" fmt={(v) => n0(v) + "h"}
          note={`${n1(billablePct)}% of tracked time is billable this period.`}
          segs={[{ label: "Billable", value: billable, color: "#16a34a" }, { label: "Non-Billable", value: nonbill, color: "#8b5cf6" }]} />
        {taskDel && taskDel.due > 0 ? (() => {
          const d = taskDel; const tot = d.due || 1;
          const overduePct = Math.round((d.open / tot) * 100);
          const latePct = Math.round((d.late / tot) * 100);
          return (
            <div className="dcard">
              <div className="dcard-h"><h3>Task Delivery</h3><span className="dcard-sub">{d.due} tasks worked this period · click to list</span></div>
              <div className="dcard-gauge"><SemiGauge center={n1(onTimePct) + "%"} sub="on-time"
                segs={[{ value: d.on_time, color: "#16a34a" }, { value: d.late, color: "#e8930c" }, { value: d.open, color: "#ef4444" }]} /></div>
              <div className="dcard-leg">
                <div className="dleg clk" onClick={() => openTaskList("on_time", "On-time", "#16a34a")}><span className="d" style={{ background: "#16a34a" }} /><span className="nm">On-time</span><b className="v num">{n0(d.on_time)}</b><span className="p">{Math.round(d.on_time / tot * 100)}%</span></div>
                <div className="dleg clk" onClick={() => openTaskList("late", "Late", "#e8930c")}><span className="d" style={{ background: "#e8930c" }} /><span className="nm">Late</span><b className="v num">{n0(d.late)}</b><span className="p">{latePct}%</span></div>
                <div className="dleg clk" onClick={() => openTaskList("open", "Overdue / open", "#ef4444")}><span className="d" style={{ background: "#ef4444" }} /><span className="nm">Overdue / open</span><b className="v num">{n0(d.open)}</b><span className="p">{overduePct}%</span></div>
              </div>
            </div>
          );
        })() : <div className="dcard"><div className="dcard-h"><h3>Task Delivery</h3></div><div className="empty-s" style={{ padding: 40 }}>No tasks worked this period</div></div>}
        {(() => {
          const kd = data.kpi_daily || [];
          const MM = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
          const fmtX = (s: string) => { const p = String(s).split("-"); return p.length === 3 ? `${p[2]}/${p[1]}` : s; };
          const tipDate = (s: string) => { const p = String(s).split("-"); return p.length === 3 ? `${MM[+p[1] - 1]} ${+p[2]}` : s; };
          return (
            <div className="dcard">
              <div className="dcard-h"><h3>Performance Trend</h3><span className="dcard-sub">daily · utilization · activity · productivity</span></div>
              {kd.length < 2 ? <div className="empty-s" style={{ padding: 40 }}>Not enough data</div> : (
                <div style={{ marginTop: "auto" }}>
                  <LineChart height={158} labels={kd.map((d) => d.date)} fmtX={fmtX} fmtY={(v) => n0(v) + "%"} tipDate={tipDate}
                    series={[
                      { name: "Utilization", color: "#7b3fc0", values: kd.map((d) => d.utilization) },
                      { name: "Activity", color: "#0d9488", values: kd.map((d) => d.activity) },
                      { name: "Productivity", color: "#e8930c", values: kd.map((d) => d.productivity) },
                    ]} />
                  <div className="lc-leg">
                    <span><i style={{ background: "#7b3fc0" }} />Utilization</span>
                    <span><i style={{ background: "#0d9488" }} />Activity</span>
                    <span><i style={{ background: "#e8930c" }} />Productivity</span>
                  </div>
                </div>
              )}
            </div>
          );
        })()}
      </div>

      {/* BY DEPARTMENT + BY TEAM — horizontal bar charts, one row */}
      {(((data.departments && data.departments.length) || data.teams.length) > 0) && (() => {
        const colors = ["#2f6fbf", "#0d9488", "#7b3fc0", "#e8930c", "#16a34a", "#d9568c", "#5b8def", "#0ea5a4"];
        const fk = (v: number) => (v >= 1000 ? (v / 1000).toFixed(v >= 10000 ? 0 : 1).replace(/\.0$/, "") + "k" : String(Math.round(v)));
        const hpanel = (title: string, rows: TeamRow[], vertical = false, onPick?: (n: string) => void) => {
          const sorted = [...rows].filter((r) => Math.round(r.total) >= 1).sort((a, b) => b.total - a.total).slice(0, 8);
          const max = Math.max(1, ...sorted.map((r) => r.total));
          return (
            <div className="panel">
              <div className="ph"><h3>{title} <span className="hl">hours · top {sorted.length}{onPick ? " · click to drill" : ""}</span></h3></div>
              {!sorted.length ? <div className="empty-s">No data in scope</div>
                : vertical ? (
                  <div className="vbar-chart">
                    {sorted.map((r, i) => (
                      <div className={`vbar-col${onPick ? " click" : ""}`} key={r.team} title={`${r.team}: ${n0(r.total)}h`} onClick={onPick ? () => onPick(r.team) : undefined}>
                        <span className="vbar-v num">{fk(r.total)}</span>
                        <div className="vbar-track"><div className="vbar-fill" style={{ height: `${Math.max(4, (r.total / max) * 100)}%`, background: colors[i % colors.length] }} /></div>
                        <span className="vbar-x">{r.team}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="hbar-list">
                    {sorted.map((r, i) => (
                      <div className={`hbar-row${onPick ? " click" : ""}`} key={r.team} onClick={onPick ? () => onPick(r.team) : undefined}>
                        <span className="hbar-lbl" title={r.team}>{r.team}</span>
                        <span className="hbar-track"><span className="hbar-fill" style={{ width: `${Math.max(2, (r.total / max) * 100)}%`, background: colors[i % colors.length] }} /></span>
                        <b className="hbar-v num">{n0(r.total)}h</b>
                      </div>
                    ))}
                  </div>
                )}
            </div>
          );
        };
        // Clicking a By Team bar opens that team's scorecard MODAL, scoped to the
        // current filter (the modal endpoint applies the active filters), so it shows
        // e.g. just the filtered employee's work in that team, or — when a team is
        // filtered — the contributors behind that bar. By Department drills by setting
        // the department filter, as before.
        const drillDept = (name: string) => { const next = { ...draft, department: name }; setDraft(next); apply(next); };
        return (
          <div className="row2" style={{ marginBottom: 14 }}>
            {hpanel("By Department", data.departments || [], true, drillDept)}
            {hpanel("By Team", data.teams || [], false, openTeam)}
          </div>
        );
      })()}


      {/* WORKFORCE + OFFICE→TRACKED→BILLABLE FUNNEL */}
      {workforce && (workforce.has_keka || workforce.total_tracked_h > 0) && (
        <div className="row2" style={{ marginBottom: 14 }}>
          <div className="panel">
            <div className="ph"><h3>Workforce <span className="hl">attendance &amp; effort, this period</span></h3></div>
            <div className="wf-tiles">
              <div className="wf-tile"><b className="num">{workforce.has_keka ? n0(workforce.attendance_pct) + "%" : "—"}</b><span>Attendance</span><i className="wf-sub">present ÷ scheduled days</i></div>
              <div className="wf-tile"><b className="num" style={{ color: "#e8930c" }}>{workforce.has_keka ? n0(workforce.overtime_h) + "h" : "—"}</b><span>Overtime</span><i className="wf-sub">worked beyond shift</i></div>
              <div className="wf-tile"><b className="num" style={{ color: "#ef4444" }}>{workforce.has_keka ? n0(workforce.short_h) + "h" : "—"}</b><span>Short hours</span><i className="wf-sub">below shift hrs · Keka</i></div>
            </div>
            {workforce.has_keka && <div className="wf-note">{n0(workforce.present_days)} present · {n0(workforce.off_days)} leave/absent days · {n0(workforce.late_days)} late arrivals</div>}
          </div>
          <div className="panel">
            <div className="ph"><h3>Office → Tracked → Billable <span className="hl">where the time goes</span></h3></div>
            {!workforce.has_keka ? <div className="empty-s" style={{ padding: 30 }}>Upload Keka attendance to see office hours.</div> : (() => {
              const fn = workforce.funnel; const max = Math.max(1, fn.office_h);
              const stages: [string, number, string][] = [["Office hours", fn.office_h, "#2f6fbf"], ["Tracked", fn.tracked_h, "#0d9488"], ["Billable", fn.billable_h, "#16a34a"]];
              return (
                <div className="funnel">
                  {stages.map(([label, val, color], i) => (
                    <div className="fn-row" key={label}>
                      <span className="fn-l">{label}</span>
                      <span className="fn-bar"><i style={{ width: `${(val / max) * 100}%`, background: color }} /></span>
                      <b className="fn-v num">{n0(val)}h</b>
                      <span className="fn-p">{i === 0 ? "100%" : `${Math.round((val / max) * 100)}%`}</span>
                    </div>
                  ))}
                </div>
              );
            })()}
          </div>
        </div>
      )}

      {/* BUDGET BURN-UP + PERFORMERS — one row, half / half */}
      <div className="row2" style={{ marginBottom: 14 }}>
        {(() => {
          const daily = data.hours_trend || [];
          const fmtX = (s: string) => { const p = String(s).split("-"); return p.length === 3 ? `${p[2]}/${p[1]}` : s; };
          const MM = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
          const tipDate = (s: string) => { const p = String(s).split("-"); return p.length === 3 ? `${MM[+p[1] - 1]} ${+p[2]}` : s; };
          const totalBud = budget?.total_budget || 0, totalAct = budget?.total_actual || 0;
          const sumDaily = daily.reduce((s, d) => s + d.hours, 0) || 1;
          const scale = totalAct / sumDaily;
          let cum = 0; const cumActual = daily.map((d) => { cum += d.hours; return cum * scale; });
          const budgetLine = daily.map((_, i) => totalBud * (i + 1) / daily.length);
          return (
            <div className="panel">
              <div className="ph"><h3>Budget Burn-up <span className="hl">budgeted clients · actual vs budget pace</span></h3></div>
              {daily.length < 2 || totalBud === 0 ? <div className="empty-s" style={{ padding: 40 }}>{totalBud === 0 ? "No budget for this scope" : "Not enough data"}</div> : (
                <>
                  <LineChart height={188} labels={daily.map((d) => d.date)} fmtX={fmtX} fmtY={(v) => n0(v) + "h"} tipDate={tipDate}
                    series={[{ name: "Actual", color: "#2f6fbf", values: cumActual }, { name: "Budget", color: "#94a3b8", values: budgetLine, dash: true }]} />
                  <div className="lc-leg"><span><i style={{ background: "#2f6fbf" }} />Actual (cumulative)</span><span><i style={{ background: "#94a3b8" }} />Budget (pace)</span></div>
                </>
              )}
            </div>
          );
        })()}
        <div className="panel">
          <div className="ph"><h3>Performers <span className="hl">top &amp; bottom by grade · utilization</span></h3></div>
          <div className="perf-split">
            {([["Top Performers", data.top3 || [], "top"], ["Needs Support", data.bottom3 || [], "bot"]] as const).map(([title, list, kind]) => (
              <div className="perf-col" key={kind}>
                <div className={`perf-col-h ${kind}`}>{title}</div>
                <div className="perf-list">
                  {list.map((e, i) => (
                    <div className="perf-row click" key={e.name + i} onClick={() => openEmployee(e.name)}>
                      <span className={`perf-rank ${kind}`}>{i + 1}</span>
                      <span className="avatar sm" style={{ background: avatarColor(e.name) }}>{initials(e.name)}</span>
                      <div className="perf-info"><b>{e.name}</b><span>{e.team}</span></div>
                      <span className={`grade ${gradeCls(e.grade)}`}>{e.grade}</span>
                      <div className="perf-metrics"><b className="num">{n0(e.utilization)}%</b><span>util · {n0(e.billable)}h bill</span></div>
                    </div>
                  ))}
                  {list.length === 0 && <div className="empty-s">No data</div>}
                </div>
              </div>
            ))}
          </div>
        </div>
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
                      <div className="cmp-kpis">
                        {([["Utilization", e.utilization], ["Activity", e.activity], ["Productivity", e.productivity]] as const).map(([lbl, val]) => (
                          <div className="cmp-kpi" key={lbl}><span className="ck-l">{lbl}</span><b className="ck-v num" style={{ color: i === bestIdx(lbl === "Utilization" ? "utilization" : lbl === "Activity" ? "activity" : "productivity") && compare.ents.length > 1 ? "#0f7a3d" : undefined }}>{n0(val)}%</b></div>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
              {/* grouped bars + radar — key metrics side by side */}
              <div className="cmp-viz">
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
                <div className="cmp-radar">
                  <div className="cmp-radar-h"><span>All metrics · radar</span><DownloadBtn name="comparison-radar" /></div>
                  <RadarChart axes={["Utilization", "Activity", "Productivity", "Billable %"]} series={compare.ents.map((e, i) => ({ name: e.name, color: CMP_COLORS[i % CMP_COLORS.length], values: [e.utilization, e.activity, e.productivity, e.total ? (e.billable / e.total) * 100 : 0] }))} />
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
              {cmpTrend && cmpTrend.dates.length > 1 && (
                <div className="cmp-trend">
                  <div className="cmp-radar-h"><span>Hours over time · trend</span><DownloadBtn name="comparison-trend" /></div>
                  <TrendOverlay dates={cmpTrend.dates} series={cmpTrend.series.map((s, i) => ({ ...s, color: CMP_COLORS[i % CMP_COLORS.length] }))} />
                </div>
              )}
            </div>
          </>
        );
      })()}

      {/* HOURS TREND + PERFORMANCE — one row */}
      {(data.hours_trend.length > 1 || showPeople) && (<>
        {showPeople ? (
          <div className="row2 hp-row">
            <div className="panel">
              <div className="ph"><h3>Hours Trend <span className="hl">billable vs non-billable per day</span></h3><DownloadBtn name="hours-trend" /></div>
              {data.hours_trend.length > 1 ? <HoursTrend data={data.hours_trend.map((d) => ({ date: d.date, billable: d.billable, non_billable: d.non_billable }))} height={250} /> : <div className="empty-s">Not enough data in range</div>}
            </div>
            <div className="panel">
              <div className="ph"><h3>Performance Matrix <span className="hl">utilization × productivity · bubble = billable hrs</span></h3><DownloadBtn name="performance-matrix" /></div>
              {bubble.length > 1 ? <Bubble points={bubble} height={250} /> : <div className="empty-s">Select a broader scope to compare people</div>}
            </div>
          </div>
        ) : (data.hours_trend.length > 1 && (
          <div className="panel" style={{ marginBottom: 14 }}>
            <div className="ph"><h3>Billable vs Non-Billable over time <span className="hl">tracked hours per day</span></h3></div>
            <HoursTrend data={data.hours_trend.map((d) => ({ date: d.date, billable: d.billable, non_billable: d.non_billable }))} height={300} />
          </div>
        ))}
      </>)}

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
                    <td className="l"><span className="emp-c"><span className="avatar" style={{ background: avatarColor(e.name) }}>{initials(e.name)}</span><span><span className="tname">{e.name} {hrBadge(e.hr_status)}</span><span className="ec-team">{e.team}</span></span></span></td>
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
                  <h3><span className="kdot" style={{ background: detail.color }} />{detail.label} breakdown</h3>
                  <div className="sub">{detail.dayKey ? "daily trend + " : ""}{rows.length} people · {data.context.label}</div>
                </div>
                <div className="modal-x" onClick={() => setDetail(null)}><X size={16} /></div>
              </div>
              <div className="modal-b">
                {detail.dayKey && (data.kpi_daily?.length ?? 0) > 1 && (() => {
                  const dk = detail.dayKey!;
                  const series = (data.kpi_daily || []).map((d) => ({
                    date: d.date, value: Number(d[dk]),
                    sub: dk === "activity" ? `${n1(d.active)}h active / ${n1(d.hours)}h`
                      : dk === "productivity" ? `${n1(d.billable)}h billable / ${n1(d.hours)}h`
                      : `${n1(d.hours)}h of ${n0(d.capacity)}h capacity`,
                  }));
                  const avg = series.reduce((s, p) => s + p.value, 0) / series.length;
                  return (
                    <div className="mtrend-wrap">
                      <div className="mtrend-h"><b><span className="kdot" style={{ background: detail.color }} />Daily {detail.label}</b><span>{series.length} days · avg {n1(avg)}%</span></div>
                      <MetricTrend points={series} color={detail.color} />
                    </div>
                  );
                })()}
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

      {/* CLIENT PROFILE — drill-down: budget vs actual, billable mix, people, trend */}
      {clientProf && (
        <div className="drawer-bg" onClick={() => setClientProf(null)}>
          <div className="drawer" onClick={(e) => e.stopPropagation()}>
            {!clientProf.data ? <div className="loading" style={{ height: "100%" }}><span className="spin" /> Loading…</div> :
              !clientProf.data.found ? <div className="loading" style={{ height: "100%" }}>No tracked time for this client in scope</div> : (() => {
                const p = clientProf.data.profile!;
                const people = clientProf.data.people || [];
                const daily = clientProf.data.daily || [];
                return (
                  <>
                    <div className="drawer-h">
                      <div className="emp-hero">
                        <span className="avatar lg" style={{ background: avatarColor(p.client) }}><Briefcase size={20} /></span>
                        <div><div className="nm">{p.client}</div><div className="tm">{p.team} · {p.department}{p.type ? ` · ${p.type}` : ""}</div></div>
                      </div>
                      <div className="modal-x" onClick={() => setClientProf(null)}><X size={16} /></div>
                    </div>
                    <div className="drawer-b">
                      {p.budget !== null && (
                        <div className={`bv-banner ${p.over ? "over" : "ok"}`}>
                          <div className="bv-banner-l">
                            <span className="bv-banner-lbl">{p.over ? "Over budget" : "Within budget"}</span>
                            <span className="bv-banner-val">{n0(p.total)}h <i>used</i> / {n0(p.budget)}h <i>budget</i></span>
                          </div>
                          <span className={`bv-banner-var ${p.over ? "bad" : "good"}`}>{(p.variance ?? 0) > 0 ? "+" : ""}{n0(p.variance ?? 0)}h</span>
                        </div>
                      )}
                      <div className="mini-kpis">
                        <div className="mini-k"><div className="l">Total</div><div className="v num">{n0(p.total)}h</div></div>
                        <div className="mini-k"><div className="l">Billable</div><div className="v num">{n0(p.billable)}h</div></div>
                        <div className="mini-k"><div className="l">Non-Bill</div><div className="v num">{n0(p.non_billable)}h</div></div>
                        <div className="mini-k"><div className="l">Billable %</div><div className="v num">{n0(p.billable_pct)}%</div></div>
                        <div className="mini-k"><div className="l">People</div><div className="v num">{p.people}</div></div>
                        <div className="mini-k"><div className="l">Active Days</div><div className="v num">{p.days}</div></div>
                      </div>
                      <div className="drawer-sec">Daily Hours Trend</div>
                      <TrendLines data={daily.map((d) => ({ date: d.date, billable: d.billable, non_billable: d.non_billable }))} height={180} />
                      <div className="drawer-sec">Who worked on this client ({people.length})</div>
                      <div className="scrollwrap" style={{ maxHeight: 280 }}>
                        <table>
                          <thead><tr><th className="l">Employee</th><th>Hours</th><th>Billable</th><th>Days</th></tr></thead>
                          <tbody>
                            {people.map((e, i) => (
                              <tr key={e.name + i} className="click" onClick={() => { setClientProf(null); openEmployee(e.name); }}>
                                <td className="l"><span className="emp-c"><span className="avatar sm" style={{ background: avatarColor(e.name) }}>{initials(e.name)}</span><span className="tname">{e.name}</span></span></td>
                                <td className="num" style={{ fontWeight: 700 }}>{n1(e.hours)}h</td>
                                <td className="num" style={{ color: "var(--muted)" }}>{n1(e.billable)}h</td>
                                <td className="num" style={{ color: "var(--muted)" }}>{e.days}</td>
                              </tr>
                            ))}
                            {people.length === 0 && <tr><td colSpan={4} style={{ textAlign: "center", padding: 16, color: "var(--muted)" }}>No data</td></tr>}
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

      {/* TEAM PROFILE — drill-down: capacity, members, top clients, trend */}
      {/* TASK DELIVERY drill — list the tasks behind a bucket */}
      {tdList && (
        <div className="modal-bg" onClick={() => setTdList(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-h">
              <div><h3><span className="kdot" style={{ background: tdList.color }} />{tdList.label} tasks</h3><div className="sub">worked this period · {tdList.rows ? tdList.rows.length : "…"} tasks</div></div>
              <div className="modal-x" onClick={() => setTdList(null)}><X size={16} /></div>
            </div>
            <div className="modal-b">
              {!tdList.rows ? <div className="loading" style={{ height: 80 }}><span className="spin" /> Loading…</div>
                : tdList.rows.length === 0 ? <div className="empty-s" style={{ padding: 24 }}>No tasks in this bucket</div> : (() => {
                  const oneClient = tdList.rows.every((r) => r.client === tdList.rows![0].client);
                  return (
                  <div className="scrollwrap" style={{ maxHeight: 460 }}>
                    <table className="hd-table">
                      <thead><tr><th className="l">Task</th>{!oneClient && <th className="l">Client</th>}<th className="l">Assignees</th><th>Tracked</th><th>Due</th><th>Completed</th><th className="l">Status</th></tr></thead>
                      <tbody>
                        {tdList.rows.map((r, i) => (
                          <tr key={i}>
                            <td className="l tname" title={r.task}>{r.task}</td>
                            {!oneClient && <td className="l">{r.client}</td>}
                            <td className="l" style={{ fontSize: 11.5, color: "var(--ink-2)", maxWidth: 220 }} title={r.assignees || ""}>{r.assignees || "—"}</td>
                            <td className="num" style={{ fontWeight: 700 }}>{r.tracked_h != null ? n1(r.tracked_h) + "h" : "—"}</td>
                            <td className="num" style={{ fontSize: 11.5, color: "var(--muted)" }}>{r.due || "—"}</td>
                            <td className="num" style={{ fontSize: 11.5, color: "var(--muted)" }}>{r.completed || "—"}</td>
                            <td className="l"><span className="grade gBb">{r.status || "—"}</span></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  ); })()}
            </div>
          </div>
        </div>
      )}

      {teamProf && (
        <div className="drawer-bg" onClick={() => setTeamProf(null)}>
          <div className="drawer" onClick={(e) => e.stopPropagation()}>
            {!teamProf.data ? <div className="loading" style={{ height: "100%" }}><span className="spin" /> Loading…</div> :
              !teamProf.data.found ? <div className="loading" style={{ height: "100%" }}>No tracked time for this team in scope</div> : (() => {
                const p = teamProf.data.profile!;
                const members2 = teamProf.data.members || [];
                const tclients = teamProf.data.clients || [];
                const daily = teamProf.data.daily || [];
                const maxC = Math.max(1, ...tclients.map((c) => c.hours));
                return (
                  <>
                    <div className="drawer-h">
                      <div className="emp-hero">
                        <span className="avatar lg" style={{ background: avatarColor(p.team) }}><Users size={20} /></span>
                        <div><div className="nm">{p.team}</div><div className="tm">{p.department} · {p.people} people · {p.clients} clients</div></div>
                      </div>
                      <div className="modal-x" onClick={() => setTeamProf(null)}><X size={16} /></div>
                    </div>
                    <div className="drawer-b">
                      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
                        <span className={`grade ${gradeCls(p.grade)}`} style={{ fontSize: 13, padding: "4px 11px" }}>{p.grade}</span>
                        <span className="stt Idle"><span className="d" />{n0(p.total)}h tracked · {n0(p.billable_pct)}% billable</span>
                      </div>
                      <div className="mini-kpis">
                        <div className="mini-k"><div className="l">People</div><div className="v num">{p.people}</div></div>
                        <div className="mini-k"><div className="l">Total</div><div className="v num">{n0(p.total)}h</div></div>
                        <div className="mini-k"><div className="l">Billable</div><div className="v num">{n0(p.billable)}h</div></div>
                        <div className="mini-k"><div className="l">Utilization</div><div className="v num">{n0(p.utilization)}%</div></div>
                        <div className="mini-k"><div className="l">Activity</div><div className="v num">{n0(p.activity)}%</div></div>
                        <div className="mini-k"><div className="l">Productivity</div><div className="v num">{n0(p.productivity)}%</div></div>
                      </div>
                      <div className="drawer-sec">Daily Hours Trend</div>
                      <TrendLines data={daily.map((d) => ({ date: d.date, billable: d.billable, non_billable: d.non_billable }))} height={180} />
                      <div className="drawer-sec">Top Clients ({tclients.length})</div>
                      <div className="scrollwrap" style={{ maxHeight: 230 }}>
                        {tclients.map((c, i) => (
                          <div key={c.client + i} className="tc-row click" onClick={() => { setTeamProf(null); openClient(c.client); }}>
                            <span className="tc-nm">{c.client}</span>
                            <span className="tc-bar"><i style={{ width: `${(c.hours / maxC) * 100}%` }} /></span>
                            <span className="tc-val num">{n0(c.hours)}h</span>
                          </div>
                        ))}
                        {tclients.length === 0 && <div className="empty-s">No clients in scope</div>}
                      </div>
                      <div className="drawer-sec">Team Members ({members2.length})</div>
                      <div className="scrollwrap" style={{ maxHeight: 280 }}>
                        <table>
                          <thead><tr><th className="l">Member</th><th>Hours</th><th>Billable</th><th>Activity</th></tr></thead>
                          <tbody>
                            {members2.map((e, i) => (
                              <tr key={e.name + i} className="click" onClick={() => { setTeamProf(null); openEmployee(e.name); }}>
                                <td className="l"><span className="emp-c"><span className="avatar sm" style={{ background: avatarColor(e.name) }}>{initials(e.name)}</span><span className="tname">{e.name}</span></span></td>
                                <td className="num" style={{ fontWeight: 700 }}>{n1(e.hours)}h</td>
                                <td className="num" style={{ color: "var(--muted)" }}>{n1(e.billable)}h</td>
                                <td className="num" style={{ color: "var(--muted)" }}>{n0(e.activity)}%</td>
                              </tr>
                            ))}
                            {members2.length === 0 && <tr><td colSpan={4} style={{ textAlign: "center", padding: 16, color: "var(--muted)" }}>No members</td></tr>}
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

      {/* USERS & ACCESS (owner) — invite, resend, enable/disable */}
      {usersModal && (
        <div className="modal-bg" onClick={() => { setUsersModal(false); setUMsg(null); }}>
          <div className="modal wide" onClick={(e) => e.stopPropagation()}>
            <div className="modal-h">
              <div>
                <h3><ShieldCheck size={15} style={{ verticalAlign: -2 }} /> Users &amp; Access</h3>
                <div className="sub">{usersData ? `${usersData.users.length} accounts · invite-only · ${usersData.smtp ? "email enabled" : "copy-link mode"}` : "loading…"}</div>
              </div>
              <div className="modal-h-r">
                <div className="seg-toggle">
                  <button className={usersTab === "users" ? "on" : ""} onClick={() => setUsersTab("users")}>Users</button>
                  <button className={usersTab === "email" ? "on" : ""} onClick={() => setUsersTab("email")}>Email settings</button>
                </div>
                <div className="modal-x" onClick={() => { setUsersModal(false); setUMsg(null); }}><X size={16} /></div>
              </div>
            </div>
            <div className="modal-b">
            {usersTab === "users" && (<>
              {/* create form */}
              <div className="usr-create">
                <div className="usr-create-row">
                  <input className="usr-in" type="email" placeholder="email@finovate.com" value={uForm.email} onChange={(e) => setUForm({ ...uForm, email: e.target.value })} />
                  <select className="usr-in" value={uForm.role} onChange={(e) => setUForm({ ...uForm, role: e.target.value })}>
                    <option value="employee">Employee — own data</option>
                    <option value="lead">Team Lead — one team</option>
                    <option value="manager">Manager — everything</option>
                  </select>
                  {uForm.role === "lead" ? (
                    <select className="usr-in" value={uForm.scope_team} onChange={(e) => setUForm({ ...uForm, scope_team: e.target.value })}>
                      <option value="">Select team…</option>
                      {(opts?.atls || []).map((t) => <option key={t} value={t}>{t}</option>)}
                    </select>
                  ) : (
                    <>
                      <input className="usr-in" list="emp-names" placeholder={uForm.role === "employee" ? "Link to employee…" : "Full name"} value={uForm.full_name} onChange={(e) => setUForm({ ...uForm, full_name: e.target.value })} />
                      <datalist id="emp-names">{(opts?.employees || []).map((n) => <option key={n} value={n} />)}</datalist>
                    </>
                  )}
                  <button className="usr-add" disabled={uBusy || !uForm.email.trim()} onClick={submitCreateUser}>{uBusy ? <span className="spin sm" /> : "Invite"}</button>
                </div>
                {uMsg?.err && <div className="login-err"><ShieldAlert size={13} />{uMsg.err}</div>}
                {uMsg?.link && (
                  <div className="usr-invite">
                    <div className="usr-invite-t">{uMsg.sent ? "✓ Invitation email sent." : "Invitation created — share this link:"}</div>
                    {!uMsg.sent && (
                      <div className="usr-link">
                        <input readOnly value={typeof window !== "undefined" ? window.location.origin + uMsg.link : uMsg.link} onFocus={(e) => e.target.select()} />
                        <button onClick={() => { try { navigator.clipboard.writeText(window.location.origin + uMsg.link); } catch { /* */ } }}>Copy</button>
                      </div>
                    )}
                  </div>
                )}
              </div>
              {/* list */}
              {!usersData ? <div className="loading" style={{ height: 120 }}><span className="spin" /> Loading…</div> : (
                <div className="scrollwrap" style={{ maxHeight: 380 }}>
                  <table className="hd-table">
                    <thead><tr><th className="l">User</th><th className="l">Role</th><th className="l">Status</th><th className="l">Last login</th><th>Actions</th></tr></thead>
                    <tbody>
                      {usersData.users.map((u) => (
                        <tr key={u.id}>
                          <td className="l"><div className="usr-cell"><b>{u.full_name || u.email}</b><i>{u.email}{u.scope_team ? ` · ${u.scope_team}` : ""}</i></div></td>
                          <td className="l"><span className={`urole ${u.role}`}>{u.role}</span></td>
                          <td className="l"><span className={`ustat ${u.status}`}>{u.status}</span></td>
                          <td className="l" style={{ color: "var(--muted)" }}>{u.last_login || "—"}</td>
                          <td className="num">
                            {u.role !== "owner" && (
                              <div className="usr-acts">
                                {u.status !== "active" && <button onClick={() => doResend(u.id)} title="Resend invite">Resend</button>}
                                {u.status === "disabled"
                                  ? <button onClick={() => toggleUser(u.id, true)} title="Enable">Enable</button>
                                  : <button className="danger" onClick={() => toggleUser(u.id, false)} title="Disable">Disable</button>}
                              </div>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>)}
            {usersTab === "email" && (
              <div className="email-cfg">
                {!emailCfg ? <div className="loading" style={{ height: 120 }}><span className="spin" /> Loading…</div> : (
                  <>
                    <div className={`email-status ${emailCfg.ready ? "ok" : "warn"}`}>
                      {emailCfg.ready
                        ? <><Check size={14} /> Email is active — invitations are sent automatically.</>
                        : <><ShieldAlert size={14} /> Email not configured — invites use a copy-link until you add an SMTP password below.</>}
                    </div>
                    <p className="email-help">Saved here, these override the server (Coolify) settings instantly — no redeploy. Leave a field blank to fall back to the server value. For Gmail, the password must be an <b>App Password</b>.</p>
                    <div className="email-grid">
                      <label>SMTP host<input value={emailForm.smtp_host} placeholder="smtp.gmail.com" onChange={(e) => setEmailForm({ ...emailForm, smtp_host: e.target.value })} /></label>
                      <label>Port<input value={emailForm.smtp_port} placeholder="587" onChange={(e) => setEmailForm({ ...emailForm, smtp_port: e.target.value })} /></label>
                      <label>Username<input value={emailForm.smtp_user} placeholder="you@gmail.com" onChange={(e) => setEmailForm({ ...emailForm, smtp_user: e.target.value })} /></label>
                      <label>From address<input value={emailForm.smtp_from} placeholder="you@gmail.com" onChange={(e) => setEmailForm({ ...emailForm, smtp_from: e.target.value })} /></label>
                      <label>App password<input type="password" value={emailForm.smtp_pass} placeholder={emailCfg.password_set ? "•••••••• (saved — leave blank to keep)" : "16-char Gmail App Password"} onChange={(e) => setEmailForm({ ...emailForm, smtp_pass: e.target.value })} /></label>
                      <label>Dashboard URL (for invite links)<input value={emailForm.public_app_url} placeholder="https://your-app-url" onChange={(e) => setEmailForm({ ...emailForm, public_app_url: e.target.value })} /></label>
                    </div>
                    {emailMsg?.err && <div className="login-err"><ShieldAlert size={13} />{emailMsg.err}</div>}
                    {emailMsg?.ok && <div className="email-ok"><Check size={13} />{emailMsg.ok}</div>}
                    <div className="email-actions">
                      <button className="usr-add" disabled={!!emailBusy} onClick={saveEmailCfg}>{emailBusy === "save" ? <span className="spin sm" /> : "Save settings"}</button>
                      <div className="email-test">
                        <input type="email" placeholder="send test to…" value={testTo} onChange={(e) => setTestTo(e.target.value)} />
                        <button disabled={!!emailBusy || !testTo.trim()} onClick={sendTestEmail}>{emailBusy === "test" ? <span className="spin sm" /> : "Send test"}</button>
                      </div>
                    </div>
                  </>
                )}
              </div>
            )}
            </div>
          </div>
        </div>
      )}

      {/* KEKA ATTENDANCE UPLOAD (owner) */}
      {kekaModal && (() => {
        const months = (kekaStatus || []).filter((m) => !kekaSearch || fmtMonth(m.month).toLowerCase().includes(kekaSearch.toLowerCase()));
        return (
        <div className="modal-bg" onClick={() => setKekaModal(false)}>
          <div className="modal keka-modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 980, width: "94vw" }}>
            <div className="modal-h">
              <div style={{ display: "flex", alignItems: "center", gap: 13 }}>
                <span className="keka-ico"><Clock size={20} /></span>
                <div><h3 style={{ margin: 0 }}>Upload Keka Attendance</h3><div className="sub">Upload the monthly Daily Performance Report (.xlsx)</div></div>
              </div>
              <div className="modal-x" onClick={() => setKekaModal(false)}><X size={16} /></div>
            </div>
            <div className="modal-b">
              <label
                className={`keka-drop${kekaBusy ? " busy" : ""}${kekaDrag ? " over" : ""}`}
                onDragOver={(e) => { e.preventDefault(); setKekaDrag(true); }}
                onDragLeave={() => setKekaDrag(false)}
                onDrop={(e) => { e.preventDefault(); setKekaDrag(false); const f = e.dataTransfer.files?.[0]; if (f && !kekaBusy) doKekaUpload(f); }}>
                <input type="file" accept=".xlsx" disabled={kekaBusy} style={{ display: "none" }}
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) doKekaUpload(f); e.currentTarget.value = ""; }} />
                {kekaBusy ? <div className="keka-drop-in"><span className="spin" /><b>Uploading &amp; parsing…</b></div>
                  : <div className="keka-drop-in">
                      <UploadCloud size={40} className="keka-cloud" />
                      <b>Drag and drop your Keka <span className="keka-ext">.xlsx</span> file here</b>
                      <span>or click to <span className="keka-browse">browse</span> from your device</span>
                      <span className="keka-hint">Daily Performance Report — re-uploading a month replaces the existing data</span>
                    </div>}
              </label>
              {kekaMsg?.err && <div className="login-err" style={{ marginTop: 12 }}><ShieldAlert size={13} />{kekaMsg.err}</div>}
              {kekaMsg?.ok && <div className="email-ok" style={{ marginTop: 12 }}><Check size={13} />{kekaMsg.ok}</div>}

              {hoursCfg && (() => {
                const curNet = hoursCfg.current ? Math.round((hoursCfg.current.net_min / 60) * 100) / 100 : 8;
                const fmt = (s?: string) => (s ? fmtDate(s) : "—");
                const addNet = Math.max(0, Math.round(newPol.shift * 60) - Math.round(newPol.lbrk));
                return (
                  <div className="wh-card">
                    <div className="wh-head">
                      <div><b>Working-hours policy</b><span>Office-hours capacity per present day. Break is tiered by hours worked, and changes apply by date.</span></div>
                      <span className="wh-net">{curNet}h<i>full-day net now</i></span>
                    </div>
                    <div className="wh-list">
                      {[...hoursCfg.policies].reverse().map((p) => (
                        <div className="wh-item" key={p.effective_from}>
                          <span className="wh-date">From {fmt(p.effective_from)}</span>
                          <span className="wh-calc">{p.shift_hours}h shift · break {p.short_break_min}m if ≤{p.threshold_hours}h, else {p.long_break_min}m</span>
                          <span className="wh-pill">{p.net_hours}h net</span>
                          {hoursCfg.write && hoursCfg.policies.length > 1 && (
                            <button className="wh-del" title="Remove this policy" disabled={hoursBusy} onClick={() => delPolicy(p.effective_from)}><X size={12} /></button>
                          )}
                        </div>
                      ))}
                    </div>
                    {hoursCfg.write && (
                      <div className="wh-add">
                        <div className="wh-add-t">Add a change</div>
                        <div className="wh-row">
                          <label className="wh-fld">Effective from
                            <input type="date" value={newPol.from} onChange={(e) => setNewPol({ ...newPol, from: e.target.value })} />
                          </label>
                          <label className="wh-fld">Shift hours
                            <input type="number" step="0.5" min={1} max={24} value={newPol.shift} onChange={(e) => setNewPol({ ...newPol, shift: Number(e.target.value) })} />
                          </label>
                          <label className="wh-fld">Break ≤ thr (min)
                            <input type="number" step="5" min={0} value={newPol.sbrk} onChange={(e) => setNewPol({ ...newPol, sbrk: Number(e.target.value) })} />
                          </label>
                          <label className="wh-fld">Threshold hrs
                            <input type="number" step="0.5" min={0} max={24} value={newPol.thr} onChange={(e) => setNewPol({ ...newPol, thr: Number(e.target.value) })} />
                          </label>
                          <label className="wh-fld">Break &gt; thr (min)
                            <input type="number" step="5" min={0} value={newPol.lbrk} onChange={(e) => setNewPol({ ...newPol, lbrk: Number(e.target.value) })} />
                          </label>
                          <div className="wh-eq">{Math.round((addNet / 60) * 100) / 100}h net</div>
                          <button className="bgt-go" disabled={hoursBusy || !newPol.from} onClick={addPolicy}>{hoursBusy ? "Saving…" : "Add"}</button>
                        </div>
                      </div>
                    )}
                    <div className="wh-hint">Per present day: worked ≤ threshold → short break, else long break, deducted from worked hours (capped at shift). e.g. 6h day → −30m = 5.5h; 9h day → −60m = 8h. Changes apply only to dates on/after their effective-from.</div>
                  </div>
                );
              })()}

              <div className="keka-loaded-h">
                <div>
                  <div className="keka-loaded-t">Loaded Months</div>
                  <div className="sub">Previously uploaded attendance files</div>
                </div>
                <div className="keka-loaded-r">
                  <div className="keka-srch"><Search size={14} /><input placeholder="Search month…" value={kekaSearch} onChange={(e) => setKekaSearch(e.target.value)} /></div>
                </div>
              </div>

              {!kekaStatus ? <div className="loading" style={{ height: 80 }}><span className="spin" /> Loading…</div>
                : months.length === 0 ? <div className="empty-s">{kekaSearch ? "No months match." : "No attendance data yet — upload a month above."}</div> : (
                  <div className="scrollwrap" style={{ maxHeight: 380 }}>
                    <table className="keka-table">
                      <thead><tr>
                        <th className="l">MONTH</th><th>EMPLOYEES</th><th>ROWS</th><th>EFFECTIVE HOURS</th>
                        <th className="l">UPLOADED ON</th><th className="l">UPLOADED BY</th>
                      </tr></thead>
                      <tbody>
                        {months.map((m) => (
                          <tr key={m.month}>
                            <td className="l"><span className="keka-mrow"><FileSpreadsheet size={17} className="keka-frow" /><b>{fmtMonth(m.month)}</b></span></td>
                            <td className="num">{m.employees}</td>
                            <td className="num" style={{ color: "var(--accent)" }}>{n0(m.rows)}</td>
                            <td className="num" style={{ fontWeight: 700 }}>{n0(m.effective_hours)}h</td>
                            <td className="l" style={{ whiteSpace: "nowrap", color: "var(--ink-2)" }}>{m.uploaded_on || "—"}</td>
                            <td className="l" style={{ color: "var(--ink-2)" }}>{m.uploaded_by || "—"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

              <div className="keka-foot">
                <button className="btn-ghost" onClick={() => setKekaModal(false)}>Close</button>
              </div>
            </div>
          </div>
        </div>
        );
      })()}

      {/* CLIENT BUDGETS — editable table */}
      {budgetAdminModal && (
        <div className="modal-bg" onClick={() => setBudgetAdminModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 900, width: "94vw" }}>
            <div className="modal-h">
              <div style={{ display: "flex", alignItems: "center", gap: 13 }}>
                <span className="adm-ico"><Briefcase size={18} /></span>
                <div><h3 style={{ margin: 0 }}>Client Budgets</h3><div className="sub">Monthly budgeted hours per client — powers Budget vs Actual</div></div>
              </div>
              <div className="modal-x" onClick={() => setBudgetAdminModal(false)}><X size={16} /></div>
            </div>
            <div className="modal-b">
              {budgetMsg?.err && <div className="login-err" style={{ marginBottom: 10 }}><ShieldAlert size={13} />{budgetMsg.err}</div>}
              {budgetMsg?.ok && <div className="email-ok" style={{ marginBottom: 10 }}><Check size={13} />{budgetMsg.ok}</div>}
              {!budgetRows ? <div className="loading" style={{ height: 120 }}><span className="spin" /> Loading…</div>
                : (() => {
                  const total = budgetRows.length;
                  const budgeted = budgetRows.filter((r) => (r.monthly_budget || 0) > 0);
                  const totalHrs = budgeted.reduce((s, r) => s + (r.monthly_budget || 0), 0);
                  const nHourly = budgetRows.filter((r) => (r.type || "").toLowerCase() === "hourly").length;
                  const rows = budgetRows.filter((r) =>
                    r.client.toLowerCase().includes(budgetQuery.toLowerCase())
                    && (!budgetFType
                      || (budgetFType === "budgeted" ? (r.monthly_budget || 0) > 0
                        : budgetFType === "unbudgeted" ? (r.monthly_budget || 0) === 0
                          : (r.type || "").toLowerCase() === budgetFType.toLowerCase())));
                  const upd = (client: string, patch: Partial<ClientBudgetRow>) =>
                    setBudgetRows((rs) => (rs || []).map((x) => x.client === client ? { ...x, ...patch } : x));
                  return (
                  <>
                    <div className="adm-stats">
                      <div className="adm-stat"><b>{total}</b><span>Total clients</span></div>
                      <div className="adm-stat"><b className="ok">{budgeted.length}</b><span>With budget</span></div>
                      <div className="adm-stat"><b className="acc">{n0(totalHrs)}h</b><span>Budgeted / month</span></div>
                      <div className="adm-stat"><b>{nHourly} <span className="adm-stat-sub">/ {total - nHourly}</span></b><span>Hourly / Fixed</span></div>
                    </div>
                    <div className="bgt-addbar">
                      <input className="usr-in" placeholder="+ New client name" value={newBudget.client} onChange={(e) => setNewBudget({ ...newBudget, client: e.target.value })} />
                      <input className="usr-in" placeholder="Team" value={newBudget.team} onChange={(e) => setNewBudget({ ...newBudget, team: e.target.value })} style={{ flex: "0 0 130px", minWidth: 0 }} />
                      <select className="usr-in" value={newBudget.type} onChange={(e) => setNewBudget({ ...newBudget, type: e.target.value })} style={{ flex: "0 0 100px", minWidth: 0 }}><option>Hourly</option><option>Fixed</option></select>
                      <input className="usr-in" type="number" placeholder="Hrs/mo" value={newBudget.monthly_budget || ""} onChange={(e) => setNewBudget({ ...newBudget, monthly_budget: Number(e.target.value) })} style={{ flex: "0 0 90px", minWidth: 0 }} />
                      <button className="bgt-go" onClick={addBudget}>Add client</button>
                    </div>
                    <div className="adm-bar">
                      <div className="adm-srch"><Search size={14} /><input placeholder="Search clients…" value={budgetQuery} onChange={(e) => setBudgetQuery(e.target.value)} /></div>
                      <select className="adm-sel" value={budgetFType} onChange={(e) => setBudgetFType(e.target.value)}>
                        <option value="">All types</option><option value="Hourly">Hourly</option><option value="Fixed">Fixed</option>
                        <option value="budgeted">Budgeted only</option><option value="unbudgeted">No budget set</option>
                      </select>
                      {(budgetQuery || budgetFType) && <button className="adm-clear" onClick={() => { setBudgetQuery(""); setBudgetFType(""); }}>Clear</button>}
                      <span className="adm-count">{rows.length} shown</span>
                    </div>
                    <div className="scrollwrap" style={{ maxHeight: 420 }}>
                      <table className="bgt-table">
                        <thead><tr><th className="l">Client</th><th className="l">Team</th><th className="l">Type</th><th>Budget / month</th><th></th></tr></thead>
                        <tbody>
                          {rows.slice(0, 200).map((r) => {
                            const has = (r.monthly_budget || 0) > 0;
                            return (
                            <tr key={r.client}>
                              <td className="l"><span className="bgt-client">{r.client}</span></td>
                              <td className="l"><input className="bgt-cell" value={r.team} placeholder="—" onChange={(e) => upd(r.client, { team: e.target.value })} onBlur={() => persistBudget(r)} /></td>
                              <td className="l"><select className={"bgt-typesel " + (r.type || "").toLowerCase()} value={r.type} onChange={(e) => { upd(r.client, { type: e.target.value }); persistBudget({ ...r, type: e.target.value }); }}><option>Hourly</option><option>Fixed</option></select></td>
                              <td className="num">
                                <span className="bgt-hrs"><input className="bgt-cell num" type="number" value={r.monthly_budget} onChange={(e) => upd(r.client, { monthly_budget: Number(e.target.value) })} onBlur={() => persistBudget(r)} /><i>h</i></span>
                                {!has && <span className="bgt-nob">not set</span>}
                              </td>
                              <td><button className="bgt-del" title="Delete client" onClick={() => removeBudget(r.client)}><X size={13} /></button></td>
                            </tr>
                            );
                          })}
                          {rows.length === 0 && <tr><td colSpan={5} className="empty-s" style={{ textAlign: "center", padding: 20 }}>No matching clients</td></tr>}
                        </tbody>
                      </table>
                    </div>
                    <div className="adm-note">A full calendar month shows the flat monthly budget; partial ranges pro-rate by days. Edits save on blur and apply immediately.</div>
                  </>
                  );
                })()}
            </div>
          </div>
        </div>
      )}

      {/* CHANGE PASSWORD */}
      {pwModal && <ChangePwModal onClose={() => setPwModal(false)} />}

      {/* FLOATING AI CHAT */}
      <button className={`ai-fab${chatOpen ? " open" : ""}`} onClick={() => setChatOpen((o) => !o)} title="Ask Pulse AI" aria-label="Ask AI">
        {chatOpen ? <X size={20} /> : <Bot size={23} />}
      </button>
      {chatOpen && (
        <div className="ai-chat">
          <div className="ai-chat-h">
            <div className="ai-chat-title"><span className="ai-chat-ic"><Bot size={17} /></span><div><b>Pulse AI</b><span>Live data · charts & insights</span></div></div>
            <button className="ai-chat-x" onClick={() => setChatOpen(false)}><X size={16} /></button>
          </div>
          <div className="ai-chat-body" ref={chatRef}>
            {messages.length === 0 && (
              <div className="ai-welcome">
                <span className="ai-welcome-ic"><Bot size={24} /></span>
                <b className="ai-welcome-t">Ask in your natural language</b>
                <p>Type any question about employees, clients, teams, budgets or attendance — answered live from your data with a chart and insight.</p>
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
                  {m.insight && <div className="msg-insight"><Sparkles size={12} /><span>{m.insight}</span></div>}
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
          <div className="modal wide" onClick={(e) => e.stopPropagation()}>
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
                      <thead><tr><th className="l">Employee</th><th>Tracked</th><th>Days</th><th className="l">Reason</th><th className="l">Assign to (department · team)</th></tr></thead>
                      <tbody>
                        {unaData.rows.map((r, i) => (
                          <tr key={r.name + i}>
                            <td className="l"><span className="emp-c"><span className="avatar sm" style={{ background: avatarColor(r.name) }}>{initials(r.name)}</span><span className="tname">{r.name}</span></span></td>
                            <td className="num">{n0(r.hours)}h</td>
                            <td className="num">{r.days}</td>
                            <td className="l"><span className="una-reason">{r.reason}</span></td>
                            <td className="l">
                              <div className="una-assign">
                                <select className="map-inp" value={unaPick[r.uid]?.dept || ""} onChange={(e) => setUnaPick((p) => ({ ...p, [r.uid]: { ...p[r.uid], dept: e.target.value } }))}>
                                  <option value="">Dept…</option>
                                  {(opts?.departments || []).filter((d) => d && d !== "Unassigned").map((d) => <option key={d} value={d}>{d}</option>)}
                                </select>
                                <select className="map-inp" value={unaPick[r.uid]?.team || ""} onChange={(e) => setUnaPick((p) => ({ ...p, [r.uid]: { ...p[r.uid], team: e.target.value } }))}>
                                  <option value="">Team…</option>
                                  {(opts?.atls || []).filter((t) => t && t !== "Unassigned").map((t) => <option key={t} value={t}>{t}</option>)}
                                </select>
                                <button className="bgt-go" disabled={unaBusy === r.uid} onClick={() => assignUna(r)}>{unaBusy === r.uid ? "…" : "Assign"}</button>
                              </div>
                              {r.suggestion && <span className="una-reason" style={{ marginLeft: 2, color: "var(--faint)" }}>ClickUp: {r.suggestion}</span>}
                            </td>
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

      {/* EMPLOYEE MAPPING — Hubstaff name <-> HR identity, editable */}
      {mapModal && (
        <div className="modal-bg" onClick={() => setMapModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 1080, width: "94vw" }}>
            <div className="modal-h">
              <div style={{ display: "flex", alignItems: "center", gap: 13 }}>
                <span className="adm-ico"><Users size={19} /></span>
                <div><h3 style={{ margin: 0 }}>Employee Mapping</h3><div className="sub">Hubstaff identity → HR record · team & transfer management</div></div>
              </div>
              <div className="modal-h-r">
                {mapData?.write && mapData?.exists && <button className="adm-export" onClick={exportMapping}><Download size={14} /> Export</button>}
                <div className="modal-x" onClick={() => setMapModal(false)}><X size={16} /></div>
              </div>
            </div>
            <div className="modal-b">
              {!mapData ? <div className="loading" style={{ height: 160 }}><span className="spin" /> Loading…</div>
                : !mapData.write && !mapData.exists ? (
                  <div className="empty-s" style={{ lineHeight: 1.7 }}>
                    <b>Editing not enabled yet.</b><br />
                    Backend ko write access do: <code>backend/.env</code> me<br />
                    <code>DATABASE_URL_WRITE=postgresql://postgres.&lt;ref&gt;:&lt;password&gt;@…:6543/postgres</code><br />
                    add karke backend restart karo, phir yahan se table bana ke edit kar sakte ho.
                  </div>
                ) : !mapData.exists ? (
                  <div className="empty-s">
                    Table abhi nahi bani. <button className="tb-act" disabled={mapBusy === "init"} onClick={mapInit} style={{ marginLeft: 8 }}>{mapBusy === "init" ? "Creating…" : "Create & seed table"}</button>
                  </div>
                ) : (() => {
                  const all = mapData.rows;
                  const nActive = all.filter((r) => (r.status || "").toUpperCase() === "ACTIVE").length;
                  const nUnmapped = all.filter((r) => !(r.hr_full_name || "").trim() || !(r.team || "").trim()).length;
                  const nMoved = all.filter((r) => (r.history?.length || 0) > 0).length;
                  const teamSet = Array.from(new Set(all.map((r) => (r.team || "").trim()).filter(Boolean))).sort();
                  const deptSet = Array.from(new Set(all.map((r) => (r.department || "").trim()).filter(Boolean))).sort();
                  const statusSet = Array.from(new Set(all.map((r) => (r.status || "").trim()).filter(Boolean))).sort();
                  const rows = all.filter((r) =>
                    (!mapSearch || (r.hubstaff_name + " " + (r.hr_full_name || "") + " " + (r.hr_employee_no || "")).toLowerCase().includes(mapSearch.toLowerCase()))
                    && (!mapFDept || r.department === mapFDept)
                    && (!mapFTeam || r.team === mapFTeam)
                    && (!mapFStatus || r.status === mapFStatus));
                  return (
                  <>
                    {!mapData.write && <div className="empty-s" style={{ padding: "6px 10px", marginBottom: 8, color: "#e8930c" }}>Read-only — editing disabled (DATABASE_URL_WRITE not set).</div>}
                    <div className="adm-stats">
                      <div className="adm-stat"><b>{all.length}</b><span>Total employees</span></div>
                      <div className="adm-stat"><b className="ok">{nActive}</b><span>Active</span></div>
                      <div className="adm-stat"><b>{teamSet.length}</b><span>Teams</span></div>
                      <div className="adm-stat"><b className="warn">{nUnmapped}</b><span>Need attention</span></div>
                      <div className="adm-stat"><b className="acc">{nMoved}</b><span>Transferred</span></div>
                    </div>
                    <div className="adm-bar">
                      <div className="adm-srch"><Search size={14} /><input placeholder="Search name or ID…" value={mapSearch} onChange={(e) => setMapSearch(e.target.value)} /></div>
                      <select className="adm-sel" value={mapFDept} onChange={(e) => setMapFDept(e.target.value)}><option value="">All departments</option>{deptSet.map((d) => <option key={d} value={d}>{d}</option>)}</select>
                      <select className="adm-sel" value={mapFTeam} onChange={(e) => setMapFTeam(e.target.value)}><option value="">All teams</option>{teamSet.map((t) => <option key={t} value={t}>{t}</option>)}</select>
                      <select className="adm-sel" value={mapFStatus} onChange={(e) => setMapFStatus(e.target.value)}><option value="">All status</option>{statusSet.map((s) => <option key={s} value={s}>{s}</option>)}</select>
                      {(mapFDept || mapFTeam || mapFStatus || mapSearch) && <button className="adm-clear" onClick={() => { setMapFDept(""); setMapFTeam(""); setMapFStatus(""); setMapSearch(""); }}>Clear</button>}
                      <span className="adm-count">{rows.length} shown</span>
                    </div>
                    <div className="scrollwrap" style={{ maxHeight: 460 }}>
                      <table className="mp-table">
                        <thead><tr>
                          <th className="l">Employee</th><th className="l">Employee ID</th>
                          <th className="l">Status</th><th className="l">Team</th>
                          <th className="l">Transfer Date</th><th></th>
                        </tr></thead>
                        <tbody>
                          {rows.slice(0, 80).map((r) => {
                            const active = (r.status || "").toUpperCase() === "ACTIVE";
                            const moves = r.history?.length || 0;
                            return (
                            <tr key={r.hubstaff_name}>
                              <td className="l">
                                <div className="mp-emp">
                                  <span className="mp-avatar">{initials(r.hubstaff_name)}</span>
                                  <div className="mp-emp-t">
                                    <b>{r.hubstaff_name}</b>
                                    <span>{r.hr_full_name || "—"}</span>
                                  </div>
                                </div>
                              </td>
                              <td className="l">{r.hr_employee_no ? <span className="emp-id">{r.hr_employee_no}</span> : <span className="mp-dash">—</span>}</td>
                              <td className="l"><span className={"mp-pill " + (active ? "on" : "off")}><span className="dot" />{r.status || "—"}</span></td>
                              <td className="l">
                                <div className="mp-team">
                                  <b>{r.team || "—"}</b>
                                  <span>{r.department || "—"}{moves > 0 && <span className="mp-moves" title="Team transfers recorded"> · {moves} move{moves > 1 ? "s" : ""}</span>}</span>
                                </div>
                              </td>
                              <td className="l mp-date">{lastTransferDate(r)}</td>
                              <td style={{ textAlign: "right" }}>
                                <button className="mp-edit" disabled={!mapData.write} onClick={() => openMapEdit(r)}><Pencil size={13} /> Edit</button>
                              </td>
                            </tr>
                            );
                          })}
                          {rows.length === 0 && <tr><td colSpan={6} className="empty-s" style={{ textAlign: "center", padding: 22 }}>No employees match the filters.</td></tr>}
                        </tbody>
                      </table>
                    </div>
                    {rows.length > 80 && <div className="adm-note">Showing first 80 of {rows.length} — narrow with search or filters.</div>}
                  </>
                  );
                })()}
            </div>
          </div>
        </div>
      )}

      {/* TEAM TRANSFER — record a dated team change (history-aware attribution) */}
      {mapEdit && (() => {
        const e = mapEdit;
        const teamMoved = (e.team || "") !== (e.row.team || "") || (e.department || "") !== (e.row.department || "");
        const hist = [...(e.row.history || [])].reverse();   // latest first
        return (
          <div className="drawer-bg" onClick={() => setMapEdit(null)}>
            <div className="drawer" onClick={(ev) => ev.stopPropagation()}>
              <div className="drawer-h">
                <h3>Update Employee Mapping</h3>
                <div className="modal-x" onClick={() => setMapEdit(null)}><X size={16} /></div>
              </div>
              <div className="drawer-b">
                <div className="drawer-sec">Employee Information</div>
                <label className="fld">Hubstaff Name<input value={e.row.hubstaff_name} disabled /></label>
                <label className="fld">HR Name<input value={e.hr_full_name} onChange={(ev) => setMapEdit({ ...e, hr_full_name: ev.target.value })} /></label>
                <label className="fld">Employee ID<input value={e.hr_employee_no} onChange={(ev) => setMapEdit({ ...e, hr_employee_no: ev.target.value })} /></label>

                <div className="drawer-sec">Mapping Details</div>
                <div className="fld-row3">
                  <label className="fld">Status
                    <select value={e.status} onChange={(ev) => setMapEdit({ ...e, status: ev.target.value })}>
                      {["ACTIVE", "RELIEVED", "EXTERNAL", "UNKNOWN"].map((s) => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </label>
                  <label className="fld">Department
                    <select value={e.department} onChange={(ev) => { const v = ev.target.value; if (v === "__new__") { const n = (prompt("New department name") || "").trim(); if (n) setMapEdit({ ...e, department: n }); } else setMapEdit({ ...e, department: v }); }}>
                      {!(mapData?.departments || []).includes(e.department) && <option value={e.department}>{e.department || "—"}</option>}
                      {(mapData?.departments || []).map((dp) => <option key={dp} value={dp}>{dp}</option>)}
                      <option value="__new__">+ Add new…</option>
                    </select>
                  </label>
                  <label className="fld">Team
                    <select value={e.team} onChange={(ev) => { const v = ev.target.value; if (v === "__new__") { const n = (prompt("New team name") || "").trim(); if (n) setMapEdit({ ...e, team: n }); } else setMapEdit({ ...e, team: v }); }}>
                      {!(mapData?.teams || []).includes(e.team) && <option value={e.team}>{e.team || "—"}</option>}
                      {(mapData?.teams || []).map((tm) => <option key={tm} value={tm}>{tm}</option>)}
                      <option value="__new__">+ Add new…</option>
                    </select>
                  </label>
                </div>
                <label className="fld">Date of Transfer{teamMoved && <span className="req"> *</span>}
                  <input type="date" value={e.xferDate} onChange={(ev) => setMapEdit({ ...e, xferDate: ev.target.value })} />
                </label>
                {teamMoved && <div className="fld-hint">Date se pehle ka kaam purani team me rahega, baad ka nayi team me.</div>}
                <label className="fld">Reason for Transfer
                  <select value={e.reason} onChange={(ev) => setMapEdit({ ...e, reason: ev.target.value })}>
                    <option value="">— select —</option>
                    {XFER_REASONS.map((rs) => <option key={rs} value={rs}>{rs}</option>)}
                  </select>
                </label>
                <label className="fld">Notes (Optional)<textarea value={e.notes} placeholder="Add notes here…" onChange={(ev) => setMapEdit({ ...e, notes: ev.target.value })} /></label>

                {hist.length > 0 && (
                  <div className="hist-box">
                    <div className="hist-h" onClick={() => setMapEdit({ ...e, histOpen: !e.histOpen })}>
                      Mapping History <span className="hist-n">{hist.length}</span>
                      <span style={{ marginLeft: "auto", color: "var(--muted)" }}>{e.histOpen ? "▲" : "▼"}</span>
                    </div>
                    {e.histOpen && hist.map((h, i) => (
                      <div className="hist-item" key={i}>
                        <span className="hist-dot" />
                        <div>
                          <div className="hist-date">{fmtDate(h.effective_from)}</div>
                          <div className="hist-sub">{(h.department || "—")} • {h.team}{h.reason ? " · " + h.reason : ""}</div>
                        </div>
                        <span className={"hist-badge " + (i === 0 ? "cur" : "past")}>{i === 0 ? "Active" : "Past"}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <div className="drawer-f">
                <button className="btn-ghost" onClick={() => setMapEdit(null)}>Cancel</button>
                <button className="btn-prim" disabled={!mapData?.write || mapBusy === e.row.hubstaff_name} onClick={saveMapEdit}>{mapBusy === e.row.hubstaff_name ? "Saving…" : "Save Changes"}</button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* TOTAL HOURS DETAIL — employee x project x task, billable / non-billable */}
      {hoursModal && (() => {
        const allRows = hoursData?.rows || [];
        const hq = hoursSearch.trim().toLowerCase();
        const rows = hq ? allRows.filter((r) => r.employee.toLowerCase().includes(hq) || r.project.toLowerCase().includes(hq) || r.task.toLowerCase().includes(hq)) : allRows;
        const tot = rows.reduce((s, r) => s + r.total, 0);
        const bil = rows.reduce((s, r) => s + r.billable, 0);
        return (
          <div className="modal-bg" onClick={() => setHoursModal(false)}>
            <div className="modal wide" onClick={(e) => e.stopPropagation()}>
              <div className="modal-h">
                <div>
                  <h3>Total Hours — full breakdown</h3>
                  <div className="sub">{hoursData ? `${rows.length}${rows.length >= 1000 ? "+" : ""} rows · ${n0(tot)}h shown (${n0(bil)}h billable) · ${data.context.label}` : "loading…"}</div>
                </div>
                <div className="modal-h-r">
                  {hoursData && rows.length > 0 && <button className="tb-act" onClick={exportHoursCsv}><Download size={14} /><span>CSV</span></button>}
                  <div className="modal-x" onClick={() => setHoursModal(false)}><X size={16} /></div>
                </div>
              </div>
              <div className="modal-b">
                {!hoursData ? <div className="loading" style={{ height: 160 }}><span className="spin" /> Loading…</div> : (
                  <>
                    <div className="hd-search"><Search size={14} /><input autoFocus placeholder="Search employee, project or task…" value={hoursSearch} onChange={(e) => setHoursSearch(e.target.value)} />{hoursSearch && <button className="hd-clr" onClick={() => setHoursSearch("")}><X size={13} /></button>}</div>
                    {rows.length === 0 ? <div className="empty-s">{hq ? `No matches for “${hoursSearch}”` : "No tracked time in scope"}</div> : (
                    <div className="scrollwrap" style={{ maxHeight: 480 }}>
                      <table className="hd-table">
                        <thead><tr><th className="l">#</th><th className="l">Employee</th><th className="l">Project</th><th className="l">Task</th><th className="l">Billable / Non-Billable</th><th>Total</th></tr></thead>
                        <tbody>
                          {rows.map((r, i) => {
                            const bilW = r.total ? (r.billable / r.total) * 100 : 0;
                            return (
                              <tr key={i}>
                                <td className="l" style={{ color: "var(--faint)", fontWeight: 700 }}>{i + 1}</td>
                                <td className="l"><span className="emp-c"><span className="avatar sm" style={{ background: avatarColor(r.employee) }}>{initials(r.employee)}</span><span className="tname">{r.employee}</span></span></td>
                                <td className="l" style={{ color: "var(--ink-2)", fontWeight: 600 }}>{r.project}</td>
                                <td className="l tname">{r.task}</td>
                                <td className="l"><span className="brkbar" title={`Billable ${n0(r.billable)}h · Non-Billable ${n0(r.non_billable)}h`}><span className="brkbar-t"><span className="bil" style={{ width: `${bilW}%` }} /><span className="nbil" style={{ width: `${100 - bilW}%` }} /></span><em>{Math.round(bilW)}%</em></span></td>
                                <td className="num" style={{ fontWeight: 750 }}>{n1(r.total)}h</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                    )}
                  </>
                )}
              </div>
            </div>
          </div>
        );
      })()}

      {/* ACTIVE CLIENTS — who was worked on this period (real clients only) */}
      {clientsModal && (
        <div className="modal-bg" onClick={() => setClientsModal(false)}>
          <div className="modal wide" onClick={(e) => e.stopPropagation()}>
            <div className="modal-h">
              <div>
                <h3><Building2 size={15} style={{ verticalAlign: -2 }} /> Active Clients</h3>
                <div className="sub">{clientsData ? `${clientsData.count} clients · ${n0(clientsData.total_hours)}h tracked · ${data.context.label}` : "loading…"}</div>
              </div>
              <div className="modal-x" onClick={() => setClientsModal(false)}><X size={16} /></div>
            </div>
            <div className="modal-b">
              {!clientsData ? <div className="loading" style={{ height: 140 }}><span className="spin" /> Loading…</div>
                : clientsData.clients.length === 0 ? <div className="empty-s">No clients in scope</div> : (() => {
                  const maxH = Math.max(1, ...clientsData.clients.map((c) => c.hours));
                  return (
                    <div className="scrollwrap" style={{ maxHeight: 460 }}>
                      <table className="hd-table">
                        <thead><tr><th className="l">#</th><th className="l">Client</th><th className="l">Type</th><th>People</th><th className="l">Tasks (done / open)</th><th className="l">Hours</th><th>Bill %</th></tr></thead>
                        <tbody>
                          {clientsData.clients.map((c, i) => {
                            const tt = c.tasks_done + c.tasks_open, dp = tt ? (c.tasks_done / tt) * 100 : 0;
                            return (
                              <tr key={c.client} className="click" onClick={() => { setClientsModal(false); openClient(c.client); }}>
                                <td className="l" style={{ color: "var(--faint)", fontWeight: 700 }}>{i + 1}</td>
                                <td className="l tname" style={{ fontWeight: 650 }}>{c.client}</td>
                                <td className="l"><span className="hrb" style={{ background: "var(--chip)", color: "var(--ink-2)" }}>{c.type}</span></td>
                                <td className="num" style={{ color: "var(--ink-2)" }}>{c.people}</td>
                                <td className="l">{tt ? <span className="tk-cell" title={`${c.tasks_done} closed · ${c.tasks_open} open`}><span className="tk-nums"><b style={{ color: "#16a34a" }}>{c.tasks_done}</b> / <b style={{ color: "#e8930c" }}>{c.tasks_open}</b></span><span className="tk-bar"><i style={{ width: `${dp}%` }} /></span></span> : <span style={{ color: "var(--faint)" }}>—</span>}</td>
                                <td className="l"><span className="cl-hbar" title={`${n1(c.hours)}h`}><i style={{ width: `${(c.hours / maxH) * 100}%` }} /><em>{n0(c.hours)}h</em></span></td>
                                <td className="num" style={{ color: "var(--ink-2)" }}>{n0(c.billable_pct)}%</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  );
                })()}
            </div>
          </div>
        </div>
      )}

      {/* BUDGET vs ACTUAL — per-client monthly budget (Resource sheet) vs tracked hours */}
      {budgetModal && budget && (() => {
        const rows = [...budget.clients].sort((a, b) =>
          budgetSort === "over" ? (b.variance ?? -1e9) - (a.variance ?? -1e9) : b.actual - a.actual);
        const usedPct = budget.total_budget > 0 ? Math.round((budget.total_actual / budget.total_budget) * 100) : 0;
        return (
          <div className="modal-bg" onClick={() => setBudgetModal(false)}>
            <div className="modal wide" onClick={(e) => e.stopPropagation()}>
              <div className="modal-h">
                <div>
                  <h3>Budget vs Actual</h3>
                  <div className="sub">{budget.count} clients · {budget.budgeted ?? 0} with a budget · {n0(budget.total_actual)}h vs {n0(budget.total_budget)}h budgeted ({usedPct}%) · {data.context.label}</div>
                </div>
                <div className="modal-h-r">
                  <div className="seg-toggle">
                    <button className={budgetSort === "over" ? "on" : ""} onClick={() => setBudgetSort("over")}>Most over</button>
                    <button className={budgetSort === "actual" ? "on" : ""} onClick={() => setBudgetSort("actual")}>By hours</button>
                  </div>
                  <div className="modal-x" onClick={() => setBudgetModal(false)}><X size={16} /></div>
                </div>
              </div>
              <div className="modal-b">
                <div className="bv-summary">
                  <div className="bv-pill bad"><b>{budget.over}</b><span>over budget</span></div>
                  <div className="bv-pill ok"><b>{budget.on_budget}</b><span>within budget</span></div>
                  <div className="bv-pill"><b>{n0(budget.total_actual)}h</b><span>used</span></div>
                  <div className="bv-pill"><b>{n0(budget.total_budget)}h</b><span>budgeted</span></div>
                </div>
                <div className="scrollwrap" style={{ maxHeight: 490 }}>
                  <table className="hd-table">
                    <thead><tr><th className="l">Client</th><th>Used</th><th>Budget</th><th>Variance</th><th className="l">Tasks (done / open)</th><th>Status</th></tr></thead>
                    <tbody>
                      {rows.map((r) => {
                        const tt = (r.tasks_done + r.tasks_open) || 0;
                        const noBudget = !(r.budget > 0);
                        const col = noBudget ? "var(--muted)" : (r.over ? "#ef4444" : "#16a34a");
                        return (
                          <tr key={r.client} className="click" onClick={() => { setBudgetModal(false); openClient(r.client); }}>
                            <td className="l"><div className="bvc-name"><span className="tname" style={{ fontWeight: 650 }}>{r.client}</span><span className="bvc-meta">{r.team} · {r.type}</span></div></td>
                            <td className="num" style={{ fontWeight: 750 }}>{n0(r.actual)}h</td>
                            <td className="num" style={{ color: "var(--ink-2)" }}>{n0(r.budget)}h</td>
                            <td className="num" style={{ fontWeight: 750, color: col }}>{noBudget ? "0h" : ((r.variance ?? 0) > 0 ? "+" : "") + n0(r.variance ?? 0) + "h"}</td>
                            <td className="l td-link" title="See this client's tasks" onClick={(e) => { e.stopPropagation(); openClientTasks(r.client); }}>{tt > 0 ? <span><b style={{ color: "#16a34a" }}>{r.tasks_done}</b> done · <b style={{ color: "#e8930c" }}>{r.tasks_open}</b> open</span> : <span style={{ color: "var(--accent)" }}>view tasks →</span>}</td>
                            <td className="num"><span className="bv-badge" style={{ color: col, background: noBudget ? "var(--chip)" : (r.over ? "#fef2f2" : "#f0fdf4") }}>{noBudget ? "No budget" : (r.over ? "Over" : "Within")}</span></td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      {/* AVG GRADE breakdown — distribution + how it's scored + per-employee */}
      {gradeModal && (() => {
        const order = ["A+", "A", "B+", "B", "C", "D"];
        const gcol: Record<string, string> = { "A+": "#0f9043", "A": "#16a34a", "B+": "#2f6fbf", "B": "#5b8def", "C": "#e8930c", "D": "#d23f43" };
        const dist = order.map((g) => ({ grade: g, count: (data.grade_distribution || []).find((x) => x.grade === g)?.count || 0 }));
        const distTot = dist.reduce((s, x) => s + x.count, 0) || 1;
        const ppl = [...data.employees].sort((a, b) => order.indexOf(a.grade) - order.indexOf(b.grade) || b.utilization - a.utilization);
        return (
          <div className="modal-bg" onClick={() => setGradeModal(false)}>
            <div className="modal wide" onClick={(e) => e.stopPropagation()}>
              <div className="modal-h">
                <div>
                  <h3><Award size={15} style={{ verticalAlign: -2, color: "#e11d63" }} /> Avg Grade — {gradeStr}</h3>
                  <div className="sub">{distTot} people · {data.context.label}</div>
                </div>
                <div className="modal-x" onClick={() => setGradeModal(false)}><X size={16} /></div>
              </div>
              <div className="modal-b">
                {/* distribution bar */}
                <div className="gx-bar">{dist.filter((d) => d.count > 0).map((d) => <span key={d.grade} className="gx-seg" style={{ flex: d.count, background: gcol[d.grade] }} title={`${d.grade}: ${d.count}`} />)}</div>
                <div className="gx-leg">{dist.map((d) => <div className="gx-li" key={d.grade}><span className="dot" style={{ background: gcol[d.grade] }} /><b>{d.grade}</b><span>{d.count}</span><i>{Math.round(d.count / distTot * 100)}%</i></div>)}</div>
                <div className="calc-note">
                  <b>How the grade is scored</b>
                  <span>Score = 0.4 × Utilization + 0.3 × Productivity + 0.3 × Task-completion. Then: ≥90 A+, ≥80 A, ≥75 B+, ≥65 B, ≥50 C, else D. The card shows the grade of the average score across everyone in scope.</span>
                </div>
                <div className="scrollwrap" style={{ maxHeight: 420 }}>
                  <table className="ec-table">
                    <thead><tr><th className="l">Employee</th><th className="l">Team</th><th>Utilization</th><th>Productivity</th><th>Activity</th><th>Grade</th></tr></thead>
                    <tbody>
                      {ppl.map((e, i) => (
                        <tr key={e.name + i} className="click" onClick={() => { setGradeModal(false); openEmployee(e.name); }}>
                          <td className="l"><span className="emp-c"><span className="avatar sm" style={{ background: avatarColor(e.name) }}>{initials(e.name)}</span><span className="tname">{e.name}</span></span></td>
                          <td className="l" style={{ color: "var(--muted)" }}>{e.team}</td>
                          <td className="num">{n0(e.utilization)}%</td>
                          <td className="num">{n0(e.productivity)}%</td>
                          <td className="num">{n0(e.activity)}%</td>
                          <td><span className={`grade ${gradeCls(e.grade)}`}>{e.grade}</span></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
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
        strokeDasharray={`${dash} ${C - dash}`} strokeDashoffset={-acc * C} className="rc-arc">
        <title>{s.label}: {Intl.NumberFormat("en-IN").format(Math.round(s.value))} ({Math.round(frac * 100)}%)</title>
      </circle>
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

// Compact multi-line SVG chart with hover tooltip (Budget burn-up & Utilization).
function LineChart({ series, labels, height = 150, fmtY, fmtX, tipDate }: {
  series: { name: string; color: string; values: (number | null)[]; dash?: boolean }[];
  labels: string[]; height?: number; fmtY?: (v: number) => string; fmtX?: (s: string) => string;
  tipDate?: (s: string) => string;
}) {
  const W = 580, padL = 42, padB = 20, padT = 8, padR = 10;
  const [hi, setHi] = useState<number | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const vals = series.flatMap((s) => s.values.filter((v): v is number => v != null));
  const maxY = Math.max(1, ...vals) * 1.08;
  const n = Math.max(1, labels.length);
  const X = (i: number) => padL + (n === 1 ? 0.5 : i / (n - 1)) * (W - padL - padR);
  const Y = (v: number) => padT + (1 - v / maxY) * (height - padT - padB);
  // smooth (Catmull-Rom) path, splitting at null gaps
  const path = (vs: (number | null)[]) => {
    const segs: [number, number][][] = []; let cur: [number, number][] = [];
    vs.forEach((v, i) => { if (v == null) { if (cur.length) segs.push(cur); cur = []; } else cur.push([X(i), Y(v)]); });
    if (cur.length) segs.push(cur);
    const T = 0.16;
    return segs.map((p) => {
      if (p.length === 1) return `M${p[0][0].toFixed(1)},${p[0][1].toFixed(1)}`;
      let d = `M${p[0][0].toFixed(1)},${p[0][1].toFixed(1)}`;
      for (let i = 0; i < p.length - 1; i++) {
        const p0 = p[i - 1] || p[i], p1 = p[i], p2 = p[i + 1], p3 = p[i + 2] || p2;
        const c1x = p1[0] + (p2[0] - p0[0]) * T, c1y = p1[1] + (p2[1] - p0[1]) * T;
        const c2x = p2[0] - (p3[0] - p1[0]) * T, c2y = p2[1] - (p3[1] - p1[1]) * T;
        d += ` C${c1x.toFixed(1)},${c1y.toFixed(1)} ${c2x.toFixed(1)},${c2y.toFixed(1)} ${p2[0].toFixed(1)},${p2[1].toFixed(1)}`;
      }
      return d;
    }).join(" ");
  };
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((t) => t * maxY);
  const step = Math.max(1, Math.ceil(n / 6));
  const onMove = (e: React.MouseEvent) => {
    const rect = ref.current?.getBoundingClientRect(); if (!rect) return;
    const px = ((e.clientX - rect.left) / rect.width) * W;          // viewBox x
    const frac = (px - padL) / (W - padL - padR);
    setHi(Math.max(0, Math.min(n - 1, Math.round(frac * (n - 1)))));
  };
  const fy = fmtY || ((v: number) => String(Math.round(v)));
  // Tooltip follows the hovered point (solid white, so lines don't bleed through).
  // Flip to the left of the point near the right edge so it never clips out.
  const leftPct = hi != null ? (X(hi) / W) * 100 : 0;
  const flip = leftPct > 58;
  return (
    <div ref={ref} className="lc-wrap" onMouseMove={onMove} onMouseLeave={() => setHi(null)}>
      <svg viewBox={`0 0 ${W} ${height}`} width="100%" preserveAspectRatio="none" style={{ display: "block", overflow: "visible" }}>
        {ticks.map((t, i) => (
          <g key={i}>
            <line x1={padL} x2={W - padR} y1={Y(t)} y2={Y(t)} stroke="var(--line-2)" strokeWidth="1"
              strokeDasharray={i === 0 ? undefined : "2 4"} vectorEffect="non-scaling-stroke" opacity={i === 0 ? 1 : 0.7} />
            <text x={padL - 6} y={Y(t) + 3} textAnchor="end" fontSize="9.5" fill="var(--muted)">{fy(t)}</text>
          </g>
        ))}
        {/* each line gets a background halo so overlaps read clearly */}
        {series.map((s) => (
          <g key={s.name}>
            <path d={path(s.values)} fill="none" stroke="var(--card)" strokeWidth="5.5"
              strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
            <path d={path(s.values)} fill="none" stroke={s.color} strokeWidth="2.4"
              strokeDasharray={s.dash ? "5 4" : undefined} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
          </g>
        ))}
        {hi != null && <line x1={X(hi)} x2={X(hi)} y1={padT} y2={height - padB} stroke="var(--muted)" strokeWidth="1" strokeDasharray="3 3" vectorEffect="non-scaling-stroke" />}
        {hi != null && series.map((s) => s.values[hi] != null && (
          <circle key={s.name} cx={X(hi)} cy={Y(s.values[hi] as number)} r="3.2" fill="var(--card)" stroke={s.color} strokeWidth="2" vectorEffect="non-scaling-stroke" />
        ))}
        {labels.map((l, i) => (i % step === 0 || i === n - 1) ? (
          <text key={i} x={X(i)} y={height - 5} textAnchor="middle" fontSize="9.5" fill="var(--muted)">{fmtX ? fmtX(l) : l}</text>
        ) : null)}
      </svg>
      {hi != null && (
        <div className="lc-tip" style={{ left: `${leftPct}%`, transform: `translateX(${flip ? "-100%" : "0"})`, marginLeft: flip ? -10 : 10 }}>
          <b>{tipDate ? tipDate(labels[hi]) : labels[hi]}</b>
          {series.map((s) => (
            <span key={s.name}><i style={{ background: s.color }} />{s.name}: <em>{s.values[hi] != null ? fy(s.values[hi] as number) : "—"}</em></span>
          ))}
        </div>
      )}
    </div>
  );
}

function DonutCard({ title, sub, segs, centerValue, centerLabel, onClick, onSeg, fmt, note }: {
  title: string; sub?: string; segs: { label: string; value: number; color: string }[];
  centerValue: string; centerLabel: string; onClick?: () => void; onSeg?: (label: string) => void;
  fmt?: (v: number) => string; note?: string;
}) {
  const total = segs.reduce((s, x) => s + x.value, 0) || 1;
  const f = fmt || ((v: number) => Intl.NumberFormat("en-IN").format(Math.round(v)));
  return (
    <div className={`dcard${onClick ? " kclk" : ""}`} onClick={onClick}>
      <div className="dcard-h"><h3>{title}</h3>{sub && <span className="dcard-sub">{sub}</span>}</div>
      <div className="dcard-chart">
        <RingChart segs={segs} />
        <div className="dcard-center"><b className="num">{centerValue}</b><span>{centerLabel}</span></div>
      </div>
      <div className="dcard-leg">
        {segs.map((s) => (
          <div className={`dleg${onSeg ? " clk" : ""}`} key={s.label}
            onClick={onSeg ? (e) => { e.stopPropagation(); onSeg(s.label); } : undefined}
            title={onSeg ? `View ${s.label.toLowerCase()} hours` : undefined}>
            <span className="d" style={{ background: s.color }} />
            <span className="nm">{s.label}</span>
            <b className="v num">{f(s.value)}</b>
            <span className="p">{Math.round((s.value / total) * 100)}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function MiniRing({ pct, color, Icon }: { pct: number; color: string; Icon: React.ComponentType<{ size?: number }> }) {
  const R = 15, C = 2 * Math.PI * R, dash = (Math.min(100, Math.max(0, pct)) / 100) * C;
  return (
    <span className="mring">
      <svg viewBox="0 0 40 40">
        <circle cx="20" cy="20" r={R} fill="none" stroke="#eef1f6" strokeWidth="4" />
        <circle cx="20" cy="20" r={R} fill="none" stroke={color} strokeWidth="4" strokeLinecap="round"
          strokeDasharray={`${dash} ${C}`} transform="rotate(-90 20 20)" />
      </svg>
      <i className="mring-ic" style={{ color }}><Icon size={14} /></i>
    </span>
  );
}

function SemiGauge({ segs, center, sub }: { segs: { value: number; color: string }[]; center: string; sub: string }) {
  const total = segs.reduce((s, x) => s + x.value, 0) || 1;
  const R = 76, cx = 100, cy = 96, sw = 22;
  const len = Math.PI * R;
  const path = `M ${cx - R} ${cy} A ${R} ${R} 0 0 1 ${cx + R} ${cy}`;
  let acc = 0;
  return (
    <svg viewBox="0 0 200 108" className="semigauge">
      <path d={path} fill="none" stroke="#eef1f6" strokeWidth={sw} strokeLinecap="round" />
      {segs.map((s, i) => {
        const dash = (s.value / total) * len;
        const el = <path key={i} d={path} fill="none" stroke={s.color} strokeWidth={sw} strokeLinecap="butt"
          strokeDasharray={`${dash} ${len}`} strokeDashoffset={-acc} />;
        acc += dash; return el;
      })}
      <text x="100" y="80" textAnchor="middle" className="sg-val">{center}</text>
      <text x="100" y="96" textAnchor="middle" className="sg-sub">{sub}</text>
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

function MetricTrend({ points, color, unit = "%" }: { points: { date: string; value: number; sub?: string }[]; color: string; unit?: string }) {
  const [hi, setHi] = useState<number | null>(null);
  if (!points.length) return null;
  const w = 720, h = 150, padL = 6, padR = 6, padT = 12, padB = 16;
  const n = points.length;
  const X = (i: number) => padL + (n <= 1 ? (w - padL - padR) / 2 : (i / (n - 1)) * (w - padL - padR));
  const Y = (v: number) => padT + (1 - Math.min(Math.max(v, 0), 100) / 100) * (h - padT - padB);
  const pts = points.map((p, i) => `${X(i).toFixed(1)},${Y(p.value).toFixed(1)}`).join(" L");
  const area = `M${pts} L${X(n - 1).toFixed(1)},${h - padB} L${X(0).toFixed(1)},${h - padB} Z`;
  const gid = `mt-${color.replace("#", "")}`;
  const seg = (w - padL - padR) / Math.max(1, n - 1);
  const fmtDate = (s: string) => { const [y, m, d] = s.split("-"); return `${d} ${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][Number(m) - 1]} ${y}`; };
  const hp = hi != null ? points[hi] : null;
  const leftPct = hi != null ? (X(hi) / w) * 100 : 0;
  const topPct = hi != null ? (Y(points[hi].value) / h) * 100 : 0;
  const flipBelow = topPct < 32;           // point near top → show tooltip below it
  const nearEdge = leftPct < 12 ? "l" : leftPct > 88 ? "r" : "";
  return (
    <div className="mtrend-box" onMouseLeave={() => setHi(null)}>
      <svg viewBox={`0 0 ${w} ${h}`} className="mtrend">
        <defs><linearGradient id={gid} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={color} stopOpacity="0.2" /><stop offset="100%" stopColor={color} stopOpacity="0" /></linearGradient></defs>
        {[0, 50, 100].map((g) => <line key={g} x1={padL} x2={w - padR} y1={Y(g)} y2={Y(g)} stroke="#eef1f6" strokeWidth="1" />)}
        <path d={area} fill={`url(#${gid})`} />
        <path d={`M${pts}`} fill="none" stroke={color} strokeWidth="2.2" strokeLinejoin="round" strokeLinecap="round" />
        {n <= 50 && points.map((p, i) => <circle key={i} cx={X(i)} cy={Y(p.value)} r="2.6" fill="#fff" stroke={color} strokeWidth="1.6" />)}
        {hi != null && (<>
          <line x1={X(hi)} x2={X(hi)} y1={padT} y2={h - padB} stroke={color} strokeWidth="1" strokeDasharray="3 3" opacity="0.55" />
          <circle cx={X(hi)} cy={Y(points[hi].value)} r="4.5" fill={color} stroke="#fff" strokeWidth="2" />
        </>)}
        {points.map((p, i) => <rect key={i} x={X(i) - seg / 2} y="0" width={Math.max(seg, 2)} height={h} fill="transparent" onMouseEnter={() => setHi(i)} />)}
      </svg>
      {hp && (
        <div className={`mtrend-tip${flipBelow ? " below" : ""} ${nearEdge}`} style={{ left: `${leftPct}%`, top: `${topPct}%` }}>
          <span className="mt-date">{fmtDate(hp.date)}</span>
          <b>{n1(hp.value)}{unit}</b>
          {hp.sub && <span className="mt-sub">{hp.sub}</span>}
        </div>
      )}
    </div>
  );
}

function RadarChart({ axes, series, size = 280 }: { axes: string[]; series: { name: string; color: string; values: number[] }[]; size?: number }) {
  const cx = size / 2, cy = size / 2, r = size / 2 - 46, n = axes.length;
  const ang = (i: number) => -Math.PI / 2 + (i * 2 * Math.PI) / n;
  const pt = (i: number, val: number) => { const a = ang(i), rr = r * Math.min(Math.max(val, 0), 100) / 100; return [cx + rr * Math.cos(a), cy + rr * Math.sin(a)]; };
  const ap = (i: number, f = 1) => { const a = ang(i); return [cx + r * f * Math.cos(a), cy + r * f * Math.sin(a)]; };
  return (
    <svg viewBox={`0 0 ${size} ${size}`} className="radar">
      {[0.25, 0.5, 0.75, 1].map((f) => <polygon key={f} points={axes.map((_, i) => ap(i, f).join(",")).join(" ")} fill="none" stroke="#e6e9f0" strokeWidth="1" />)}
      {axes.map((ax, i) => { const [x, y] = ap(i); const [lx, ly] = ap(i, 1.18); return (<g key={ax}><line x1={cx} y1={cy} x2={x} y2={y} stroke="#e6e9f0" /><text x={lx} y={ly} className="radar-lbl" textAnchor="middle" dominantBaseline="middle">{ax}</text></g>); })}
      {series.map((s) => { const pts = s.values.map((v, i) => pt(i, v).join(",")).join(" "); return (<g key={s.name}><polygon points={pts} fill={s.color} fillOpacity="0.12" stroke={s.color} strokeWidth="2" strokeLinejoin="round" />{s.values.map((v, i) => { const [px, py] = pt(i, v); return <circle key={i} cx={px} cy={py} r="3" fill="#fff" stroke={s.color} strokeWidth="1.6" />; })}</g>); })}
    </svg>
  );
}

function TrendOverlay({ dates, series, height = 230 }: { dates: string[]; series: { name: string; color: string; values: number[] }[]; height?: number }) {
  const [hi, setHi] = useState<number | null>(null);
  if (!dates.length || !series.length) return null;
  const w = 720, h = height, padL = 8, padR = 8, padT = 12, padB = 20;
  const n = dates.length;
  const maxV = Math.max(1, ...series.flatMap((s) => s.values));
  const X = (i: number) => padL + (n <= 1 ? (w - padL - padR) / 2 : (i / (n - 1)) * (w - padL - padR));
  const Y = (v: number) => padT + (1 - v / maxV) * (h - padT - padB);
  const seg = (w - padL - padR) / Math.max(1, n - 1);
  const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const fmt = (s: string) => { const [, m, d] = s.split("-"); return `${d} ${MON[Number(m) - 1]}`; };
  return (
    <div className="ovl-box" onMouseLeave={() => setHi(null)}>
      <svg viewBox={`0 0 ${w} ${h}`} className="ovl">
        {[0, 0.5, 1].map((f) => <line key={f} x1={padL} x2={w - padR} y1={padT + f * (h - padT - padB)} y2={padT + f * (h - padT - padB)} stroke="#eef1f6" strokeWidth="1" />)}
        {series.map((s) => <path key={s.name} d={`M${s.values.map((v, i) => `${X(i).toFixed(1)},${Y(v).toFixed(1)}`).join(" L")}`} fill="none" stroke={s.color} strokeWidth="2.2" strokeLinejoin="round" strokeLinecap="round" />)}
        {hi != null && <line x1={X(hi)} x2={X(hi)} y1={padT} y2={h - padB} stroke="#9aa3b2" strokeWidth="1" strokeDasharray="3 3" />}
        {hi != null && series.map((s) => <circle key={s.name} cx={X(hi)} cy={Y(s.values[hi])} r="3.6" fill={s.color} stroke="#fff" strokeWidth="1.6" />)}
        {dates.map((_, i) => <rect key={i} x={X(i) - seg / 2} y="0" width={Math.max(seg, 2)} height={h} fill="transparent" onMouseEnter={() => setHi(i)} />)}
      </svg>
      {hi != null && (
        <div className="ovl-tip" style={{ left: `${(X(hi) / w) * 100}%` }}>
          <span className="ovl-d">{fmt(dates[hi])}</span>
          {series.map((s) => <span key={s.name} className="ovl-r"><i style={{ background: s.color }} />{s.name.length > 16 ? s.name.slice(0, 16) + "…" : s.name}<b>{n1(s.values[hi])}h</b></span>)}
        </div>
      )}
    </div>
  );
}

function downloadSvgAsPng(svg: SVGElement, filename: string) {
  const rect = svg.getBoundingClientRect();
  const w = Math.round(rect.width) || 640, h = Math.round(rect.height) || 400;
  const clone = svg.cloneNode(true) as SVGElement;
  clone.setAttribute("width", String(w)); clone.setAttribute("height", String(h));
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  const data = new XMLSerializer().serializeToString(clone);
  const url = URL.createObjectURL(new Blob([data], { type: "image/svg+xml;charset=utf-8" }));
  const img = new Image();
  img.onload = () => {
    const s = 2, canvas = document.createElement("canvas");
    canvas.width = w * s; canvas.height = h * s;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, canvas.width, canvas.height); ctx.scale(s, s);
    ctx.drawImage(img, 0, 0, w, h); URL.revokeObjectURL(url);
    canvas.toBlob((blob) => { if (!blob) return; const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = filename + ".png"; a.click(); URL.revokeObjectURL(a.href); });
  };
  img.src = url;
}

function DownloadBtn({ name }: { name: string }) {
  return (
    <button type="button" className="dl-btn" title="Download chart (PNG)" onClick={(e) => {
      const wrap = e.currentTarget.closest(".cmp-radar, .cmp-trend, .panel");
      const svg = wrap ? [...wrap.querySelectorAll("svg")].find((s) => !s.classList.contains("lucide")) : null;
      if (svg) downloadSvgAsPng(svg as SVGElement, name);
    }}>
      <Download size={13} />
    </button>
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

// HR status → dot colour + tooltip. Active = green, left/relieved = red.
const STATUS_DOT: Record<string, [string, string]> = {
  ACTIVE: ["sd-on", "Active"], RELIEVED: ["sd-off", "Left"], LEFT: ["sd-off", "Left"],
  EXTERNAL: ["sd-ext", "External"], UNKNOWN: ["sd-unk", "Unknown"],
};
function MultiSelect({ Icon, label, value, opts, on, allLabel, status }: {
  Icon: React.ComponentType<{ size?: number }>; label: string; value?: string;
  opts?: string[]; on: (v: string) => void; allLabel?: string;
  status?: Record<string, string>;
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
  let list = (opts || []).filter((o) => o.toLowerCase().includes(q.toLowerCase()));
  if (status) {                                   // active first, then alphabetical
    const rank = (o: string) => (status[o] === "ACTIVE" ? 0 : status[o] === "RELIEVED" || status[o] === "LEFT" ? 2 : 1);
    list = [...list].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
  }
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
          {status && (
            <div className="ms-legend"><span><i className="ms-dot sd-on" />Active</span><span><i className="ms-dot sd-off" />Left</span><span><i className="ms-dot sd-ext" />External</span></div>
          )}
          <div className="ms-opts">
            <div className={`ms-opt all${active ? "" : " on"}`} onClick={() => { on(""); }}>{allLabel || `All ${label}`}</div>
            {list.map((o) => {
              const sd = status ? STATUS_DOT[status[o] || "UNKNOWN"] : null;
              return (
                <label className="ms-opt" key={o}>
                  <input type="checkbox" checked={selected.includes(o)} onChange={() => toggle(o)} />
                  <span className="ms-lbl">{o}</span>
                  {sd && <span className={`ms-dot ${sd[0]}`} title={sd[1]} />}
                </label>
              );
            })}
            {list.length === 0 && <div className="ms-empty">No matches</div>}
          </div>
          {active && <div className="ms-foot"><span>{selected.length} selected</span><button onClick={() => on("")}>Clear</button></div>}
        </div>
      )}
    </div>
  );
}

