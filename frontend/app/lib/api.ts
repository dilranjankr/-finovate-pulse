export const API = process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8000";

// ---- session token ---------------------------------------------------------
const TOKEN_KEY = "fin_token";
export function getToken(): string {
  try { return localStorage.getItem(TOKEN_KEY) || ""; } catch { return ""; }
}
export function setToken(t: string) { try { localStorage.setItem(TOKEN_KEY, t); } catch { /* ignore */ } }
export function clearToken() { try { localStorage.removeItem(TOKEN_KEY); } catch { /* ignore */ } }

/** fetch wrapper that attaches the Bearer token (no-op during SSR). */
function authedFetch(url: string, init: RequestInit = {}): Promise<Response> {
  const t = getToken();
  const headers: Record<string, string> = { ...(init.headers as Record<string, string> || {}) };
  if (t) headers["Authorization"] = `Bearer ${t}`;
  return fetch(url, { ...init, headers });
}

export interface FilterOptions {
  date_min: string;
  date_max: string;
  departments: string[];
  atls: string[];
  employees: string[];
  clients: string[];
  client_types: string[];
  employee_status?: Record<string, string>;
  total_members: number;
  source?: string;
}

export interface KpiVal {
  value: number | string;
  trend: number;
  spark: number[];
  unit: string;
}

export interface TeamRow {
  team: string; team_size: number; billable: number; non_billable: number;
  total: number; utilization: number; activity?: number; productivity: number; grade: string;
  revenue: number; budget: number; variance: number; status: string; members?: string[];
}
export interface EmployeeRow {
  name: string; team: string; billable: number; non_billable: number;
  utilization: number; activity: number; productivity: number; avg_day: number;
  days: number; grade: string; active_tasks: number; task_status: string; client: string;
  clients?: string[]; hr_status?: string;
  efficiency?: number | null; on_estimate?: number | null; overdue?: number; last_active?: string | null;
}

export interface Summary {
  employees: number; active_days: number; departments: number;
  teams: number; clients: number; avg_hours_per_emp: number; billable_pct: number;
  tasks_active_emp: number; total_tasks: number; active_tasks: number;
}
export interface TopEmp {
  name: string; team: string; grade: string; billable: number;
  utilization: number; activity: number; active_tasks: number; task_status: string;
}
export interface ClientRow {
  client: string; hours: number; active: boolean; category: string;
  active_tasks: number; total_tasks: number;
}

export interface CommandData {
  context: { level: string; view: string; label: string };
  summary: Summary;
  kpis: Record<string, KpiVal>;
  hours_distribution: { name: string; value: number }[];
  hours_trend: { date: string; billable: number; non_billable: number; hours: number }[];
  kpi_daily?: { date: string; utilization: number; activity: number; productivity: number; hours: number; active: number; billable: number; capacity: number }[];
  top_clients: { client: string; hours: number }[];
  task_summary: { name: string; value: number }[];
  teams: TeamRow[];
  departments?: TeamRow[];
  employees: EmployeeRow[];
  total_employees: number;
  top3: TopEmp[];
  bottom3: TopEmp[];
  clients_summary: ClientRow[];
  clients_status: { active: number; inactive: number };
  table: { level: string; view: string; columns: string[]; rows: Record<string, unknown>[] };
  live_activity: { active: number; idle: number; offline: number };
  grade_distribution: { grade: string; count: number }[];
  budget_vs_actual: { budget: number; actual: number; variance: number };
  alerts: { severity: string; title: string; count: number }[];
  insights: string[];
  client_health: { active: number; at_risk: number; inactive: number };
  project_health: { on_track: number; at_risk: number; delayed: number };
  resource: { capacity: number; availability: number };
  heatmap: { weeks: string[]; rows: { label: string; values: number[]; total: number }[] };
  period?: {
    comparable: boolean;
    current?: { from: string; to: string; days: number | null };
    previous?: { from: string; to: string; total: number; billable: number; util: number; days: number };
  };
  task_priority?: { urgent: number; high: number; normal: number; low: number };
  employee_tasks?: { name: string; urgent: number; high: number; normal: number; low: number; total: number; active: number; status: string; nb: number; billable: number }[];
  hierarchy?: { nodes: { name: string; layer?: number }[]; links: { source: number; target: number; value: number }[] };
  source?: string;
}

export interface RawData {
  rows: Record<string, unknown>[];
  total: number;
  shown: number;
}
export interface UnassignedData {
  rows: { uid: string; name: string; hours: number; days: number; reason: string; suggestion: string }[];
  count: number;
  total_hours: number;
  total_members: number;
}
export async function getUnassigned(): Promise<UnassignedData> {
  const r = await authedFetch(`${API}/api/unassigned`, { cache: "no-store" });
  if (!r.ok) throw new Error("unassigned failed");
  return r.json();
}
export async function assignUnassigned(body: { uid: string; name: string; department?: string; team?: string }): Promise<{ ok: boolean; detail?: string; reason?: string }> {
  const r = await authedFetch(`${API}/api/unassigned/assign`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  return r.json();
}

export async function getRaw(f: Filters): Promise<RawData> {
  const qs = new URLSearchParams();
  Object.entries(f).forEach(([k, v]) => { if (v) qs.set(k, v); });
  const r = await authedFetch(`${API}/api/raw?${qs.toString()}`, { cache: "no-store" });
  if (!r.ok) throw new Error("raw failed");
  return r.json();
}

export interface HoursDetailRow { employee: string; project: string; task: string; billable: number; non_billable: number; total: number; }
export interface HoursDetailData { rows: HoursDetailRow[]; count: number; }
export interface CompareTrendData { dates: string[]; series: { name: string; values: number[] }[]; }
export async function getCompareTrend(kind: string, names: string[], f: Filters): Promise<CompareTrendData> {
  const qs = new URLSearchParams({ kind, names: names.join(",") });
  if (f.date_from) qs.set("date_from", f.date_from);
  if (f.date_to) qs.set("date_to", f.date_to);
  const r = await authedFetch(`${API}/api/compare_trend?${qs.toString()}`, { cache: "no-store" });
  if (!r.ok) throw new Error("compare_trend failed");
  return r.json();
}
export async function getHoursDetail(f: Filters): Promise<HoursDetailData> {
  const qs = new URLSearchParams();
  Object.entries(f).forEach(([k, v]) => { if (v) qs.set(k, v); });
  const r = await authedFetch(`${API}/api/hours_detail?${qs.toString()}`, { cache: "no-store" });
  if (!r.ok) throw new Error("hours_detail failed");
  return r.json();
}

export interface EmployeeDetail {
  found: boolean;
  profile?: {
    name: string; team: string; department: string; client: string; role: string;
    status: string; task_status: string; active_tasks: number; total_tasks: number;
    grade: string; billable: number; non_billable: number; total: number;
    utilization: number; activity: number; productivity: number; days: number; avg_day: number;
  };
  daily?: { date: string; hours: number; billable: number; non_billable: number; activity: number; productivity: number }[];
  tasks?: Record<string, unknown>[];
}
export async function getEmployee(name: string, f: Filters): Promise<EmployeeDetail> {
  const qs = new URLSearchParams({ name });
  if (f.date_from) qs.set("date_from", f.date_from);
  if (f.date_to) qs.set("date_to", f.date_to);
  const r = await authedFetch(`${API}/api/employee?${qs.toString()}`, { cache: "no-store" });
  if (!r.ok) throw new Error("employee failed");
  return r.json();
}

export type Filters = {
  date_from?: string;
  date_to?: string;
  department?: string;
  atl?: string;
  employee?: string;
  client?: string;
  client_type?: string;
  billable?: string;
  status?: string;
};

export async function getFilters(scope?: { department?: string; atl?: string; date_from?: string; date_to?: string; client?: string; employee?: string }): Promise<FilterOptions> {
  const qs = new URLSearchParams();
  if (scope?.department) qs.set("department", scope.department);
  if (scope?.atl) qs.set("atl", scope.atl);
  if (scope?.date_from) qs.set("date_from", scope.date_from);
  if (scope?.date_to) qs.set("date_to", scope.date_to);
  if (scope?.client) qs.set("client", scope.client);
  if (scope?.employee) qs.set("employee", scope.employee);
  const r = await authedFetch(`${API}/api/filters?${qs.toString()}`, { cache: "no-store" });
  if (!r.ok) throw new Error("filters failed");
  return r.json();
}

export interface AskResult {
  ok: boolean;
  reason?: string;
  text?: string;
  insight?: string;
  sql?: string;
  kind?: "bar" | "donut" | "none";
  bars?: { label: string; value: number; color?: string }[];
  donut?: { data: { name: string; value: number }[]; colors: string[]; center?: { value: string; label: string } };
}
export async function askAI(question: string, f: Filters): Promise<AskResult> {
  const r = await authedFetch(`${API}/api/ask`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ question, filters: f }),
  });
  if (!r.ok) throw new Error("ask failed");
  return r.json();
}

// Default visible window: last 90 days up to the latest data date (not the full
// multi-year history, which is unreadable and collides weekly-heatmap keys).
export function defaultRange(opts: FilterOptions): { date_from: string; date_to: string } {
  const to = opts.date_max;
  const d = new Date(to + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() - 89);
  const calc = d.toISOString().slice(0, 10);
  return { date_from: calc < opts.date_min ? opts.date_min : calc, date_to: to };
}

export interface BreakdownData {
  task_h: number; task_billable_h: number; task_non_billable_h: number;
  project_h: number; project_billable_h: number; project_non_billable_h: number;
}
export async function getBreakdown(f: Filters): Promise<BreakdownData> {
  const qs = new URLSearchParams();
  Object.entries(f).forEach(([k, v]) => { if (v) qs.set(k, v); });
  const r = await authedFetch(`${API}/api/breakdown?${qs.toString()}`, { cache: "no-store" });
  if (!r.ok) throw new Error("breakdown failed");
  return r.json();
}

export interface BdRow { name: string; total: number; billable: number; non_billable: number; project?: string; }
export interface BreakdownListData { by_task: BdRow[]; by_project: BdRow[]; }
export async function getBreakdownList(f: Filters): Promise<BreakdownListData> {
  const qs = new URLSearchParams();
  Object.entries(f).forEach(([k, v]) => { if (v) qs.set(k, v); });
  const r = await authedFetch(`${API}/api/breakdown_list?${qs.toString()}`, { cache: "no-store" });
  if (!r.ok) throw new Error("breakdown_list failed");
  return r.json();
}

export interface TeamHistoryRow { team: string; department?: string; effective_from: string; reason?: string | null; }
export interface MappingRow {
  hubstaff_name: string; hubstaff_user_id?: string; hr_employee_no?: string; hr_full_name?: string;
  status?: string; department?: string; team?: string; job_title?: string; reporting_to?: string;
  exit_date?: string; confidence?: string; total_hours?: number; last_worked?: string; reviewed?: boolean;
  notes?: string; history?: TeamHistoryRow[];
}
export interface MappingData { exists: boolean; write: boolean; count: number; rows: MappingRow[]; teams?: string[]; departments?: string[]; }
export async function getMapping(): Promise<MappingData> {
  const r = await authedFetch(`${API}/api/mapping`, { cache: "no-store" });
  if (!r.ok) throw new Error("mapping failed");
  return r.json();
}
export async function transferTeam(body: { hubstaff_name: string; new_team: string; new_department?: string; effective_from: string; reason?: string }): Promise<{ ok: boolean; detail?: string; reason?: string }> {
  const r = await authedFetch(`${API}/api/mapping/transfer`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  return r.json();
}
export async function saveMapping(row: Partial<MappingRow> & { hubstaff_name: string }): Promise<{ ok: boolean; detail?: string; reason?: string }> {
  const r = await authedFetch(`${API}/api/mapping/save`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(row),
  });
  return r.json();
}
export async function initMapping(): Promise<{ ok: boolean; rows?: number; detail?: string; reason?: string }> {
  const r = await authedFetch(`${API}/api/mapping/init`, { method: "POST" });
  return r.json();
}

export interface ClientBudgetRow { client: string; team: string; type: string; monthly_budget: number; }
export interface ClientBudgetsData { exists: boolean; write: boolean; count: number; rows: ClientBudgetRow[]; }
export async function getBudgets(): Promise<ClientBudgetsData> {
  const r = await authedFetch(`${API}/api/budgets`, { cache: "no-store" });
  if (!r.ok) throw new Error("budgets failed");
  return r.json();
}
export async function saveBudget(row: ClientBudgetRow): Promise<{ ok: boolean; detail?: string; reason?: string }> {
  const r = await authedFetch(`${API}/api/budgets/save`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(row),
  });
  return r.json();
}
export async function deleteBudget(client: string): Promise<{ ok: boolean; reason?: string }> {
  const r = await authedFetch(`${API}/api/budgets/delete`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ client }),
  });
  return r.json();
}
export async function initBudgets(): Promise<{ ok: boolean; rows?: number; detail?: string; reason?: string }> {
  const r = await authedFetch(`${API}/api/budgets/init`, { method: "POST" });
  return r.json();
}

export interface BudgetClient {
  client: string; type: string; team: string;
  budget: number; actual: number; variance: number | null; over: boolean; pct: number | null;
  tasks_total: number; tasks_open: number; tasks_done: number;
  billable_pct: number; health: string; health_score: number;
}
export interface BudgetData {
  clients: BudgetClient[]; total_budget: number; total_actual: number;
  on_budget: number; over: number; count: number; budgeted?: number;
}
export interface ClientListRow {
  client: string; type: string; hours: number; billable_pct: number;
  people: number; tasks_done: number; tasks_open: number;
}
export interface ClientsListData { clients: ClientListRow[]; count: number; total_hours: number; }
export async function getClientsList(f: Filters): Promise<ClientsListData> {
  const qs = new URLSearchParams();
  Object.entries(f).forEach(([k, v]) => { if (v) qs.set(k, v); });
  const r = await authedFetch(`${API}/api/clients?${qs.toString()}`, { cache: "no-store" });
  if (!r.ok) throw new Error("clients failed");
  return r.json();
}

export async function getBudget(f: Filters): Promise<BudgetData> {
  const qs = new URLSearchParams();
  Object.entries(f).forEach(([k, v]) => { if (v) qs.set(k, v); });
  const r = await authedFetch(`${API}/api/budget?${qs.toString()}`, { cache: "no-store" });
  if (!r.ok) throw new Error("budget failed");
  return r.json();
}

export interface ClientProfile {
  found: boolean;
  profile?: {
    client: string; team: string; department: string; type: string;
    total: number; billable: number; non_billable: number; billable_pct: number;
    budget: number | null; variance: number | null; over: boolean | null;
    people: number; days: number; last_worked: string;
  };
  people?: { name: string; hours: number; billable: number; days: number }[];
  daily?: { date: string; billable: number; non_billable: number }[];
}
export async function getClient(name: string, f: Filters): Promise<ClientProfile> {
  const qs = new URLSearchParams({ name });
  if (f.date_from) qs.set("date_from", f.date_from);
  if (f.date_to) qs.set("date_to", f.date_to);
  const r = await authedFetch(`${API}/api/client?${qs.toString()}`, { cache: "no-store" });
  if (!r.ok) throw new Error("client failed");
  return r.json();
}

// ===== Context focus (client / team / employee, optionally employee+client) =====
export interface FocusTask { task: string; client: string | null; done: boolean; status: string | null; due: string | null; priority: string | null; est: number; budget: number; actual: number; variance: number | null; variance_pct: number | null; worker: string; project_only?: boolean; }
export interface FocusClientRow { client: string; hours: number; billable: number; non_billable: number; budget: number | null; billable_pct: number; tasks: number; tasks_done: number; tasks_open: number; efficiency: number | null; used_pct: number | null; }
export interface FocusMemberRow { name: string; hours: number; billable: number; non_billable: number; billable_pct: number; activity_pct: number; efficiency: number | null; tasks: number; tasks_done?: number; tasks_open?: number; utilization?: number | null; on_estimate?: number | null; top_task?: string | null; top_status?: string | null; top_done?: boolean | null; }
export interface FocusData {
  found: boolean; kind?: "client" | "team" | "employee"; name?: string; client?: string | null;
  summary?: {
    total: number; billable: number; non_billable: number; billable_pct: number; activity_pct: number;
    utilization: number | null; grade: string | null; on_estimate_pct: number | null;
    tasks: number; tasks_done: number; est_total: number; budget_total: number; actual_total: number;
    clients: number; members: number; budget: number | null; used_pct: number | null; over: boolean | null;
    forecast?: number | null; forecast_pct?: number | null; last_worked?: string | null;
    health: number | null; health_grade: string | null; team: string; department: string;
  };
  insight?: { best: string | null; watch: string | null };
  transfer?: {
    events: { from: string; to: string; on: string }[];
    segments: { team: string; hours: number; billable_pct: number; from: string; to: string }[];
    current?: string | null; previous?: string | null;
  } | null;
  sentiment?: { comms: number; positive: number; neutral: number; concerned: number; complaints: number; followups: number; last: string | null; all_time?: boolean; client_keys?: string[] } | null;
  rows?: { tasks: FocusTask[]; clients: FocusClientRow[]; members: FocusMemberRow[]; pairs?: { name: string; client: string; hours: number; billable_pct: number }[]; burnup?: { date: string; cum: number }[] };
}
export async function getFocus(kind: string, name: string, f: Filters, client?: string): Promise<FocusData> {
  const qs = new URLSearchParams({ kind, name });
  if (client) qs.set("client", client);
  if (f.date_from) qs.set("date_from", f.date_from);
  if (f.date_to) qs.set("date_to", f.date_to);
  const r = await authedFetch(`${API}/api/focus?${qs.toString()}`, { cache: "no-store" });
  if (!r.ok) throw new Error("focus failed");
  return r.json();
}

export interface DataHealth { sources: { source: string; last: string | null; rows: number }[] }
export async function getDataHealth(): Promise<DataHealth> {
  const r = await authedFetch(`${API}/api/data_health`, { cache: "no-store" });
  if (!r.ok) throw new Error("data_health failed");
  return r.json();
}

export interface ClientMessage { date: string; from_who: string; subject: string; summary: string; sentiment: string; complaining: string; following_up: string; url: string; }
export async function getClientMessages(opts: { client?: string; labels?: string[]; sentiment?: string; bucket?: string; date_from?: string; date_to?: string }): Promise<{ client: string; rows: ClientMessage[] }> {
  const qs = new URLSearchParams();
  if (opts.client) qs.set("client", opts.client);
  if (opts.labels?.length) qs.set("labels", opts.labels.join(","));
  if (opts.sentiment) qs.set("sentiment", opts.sentiment);
  if (opts.bucket) qs.set("bucket", opts.bucket);
  if (opts.date_from) qs.set("date_from", opts.date_from);
  if (opts.date_to) qs.set("date_to", opts.date_to);
  const r = await authedFetch(`${API}/api/client_messages?${qs.toString()}`, { cache: "no-store" });
  if (!r.ok) throw new Error("messages failed");
  return r.json();
}

export interface TeamProfile {
  found: boolean;
  profile?: {
    team: string; department: string; people: number;
    total: number; billable: number; non_billable: number; billable_pct: number;
    utilization: number; activity: number; productivity: number; grade: string;
    clients: number; days: number;
  };
  members?: { name: string; hours: number; billable: number; days: number; activity: number }[];
  clients?: { client: string; hours: number; billable: number }[];
  daily?: { date: string; billable: number; non_billable: number }[];
}
export async function getTeam(name: string, f: Filters): Promise<TeamProfile> {
  const qs = new URLSearchParams({ name });
  (["date_from", "date_to", "employee", "atl", "department", "client", "client_type", "billable", "status"] as const)
    .forEach((k) => { if (f[k]) qs.set(k, f[k] as string); });
  const r = await authedFetch(`${API}/api/team?${qs.toString()}`, { cache: "no-store" });
  if (!r.ok) throw new Error("team failed");
  return r.json();
}

export interface TaskDelivery { due: number; on_time: number; late: number; open: number; on_time_pct: number; }
export interface TaskDeliveryItem { task: string; client: string; due: string; completed: string; status: string; assignees?: string; tracked_h?: number; }
export async function getTaskDeliveryList(bucket: "on_time" | "late" | "open" | "all", f: Filters): Promise<{ bucket: string; rows: TaskDeliveryItem[]; count: number }> {
  const qs = new URLSearchParams({ bucket });
  Object.entries(f).forEach(([k, v]) => { if (v) qs.set(k, v as string); });
  const r = await authedFetch(`${API}/api/task_delivery_list?${qs.toString()}`, { cache: "no-store" });
  if (!r.ok) throw new Error("task list failed");
  return r.json();
}
export async function getTaskDelivery(f: Filters): Promise<TaskDelivery> {
  const qs = new URLSearchParams();
  Object.entries(f).forEach(([k, v]) => { if (v) qs.set(k, v); });
  const r = await authedFetch(`${API}/api/task_delivery?${qs.toString()}`, { cache: "no-store" });
  if (!r.ok) throw new Error("task_delivery failed");
  return r.json();
}

// Current calendar month within the available data window (default dashboard period).
export function currentMonth(opts: FilterOptions): { date_from: string; date_to: string } {
  const max = opts.date_max;                         // latest data date
  const from = max.slice(0, 8) + "01";               // 1st of that month
  return { date_from: from < opts.date_min ? opts.date_min : from, date_to: max };
}

export async function getCommand(f: Filters): Promise<CommandData> {
  const qs = new URLSearchParams();
  Object.entries(f).forEach(([k, v]) => {
    if (v) qs.set(k, v);
  });
  const r = await authedFetch(`${API}/api/command?${qs.toString()}`, { cache: "no-store" });
  if (!r.ok) throw new Error("command failed");
  return r.json();
}

// ===== AUTH ================================================================
export type AppRole = "owner" | "manager" | "lead" | "employee";
export interface AppUser {
  id: number; email: string; role: AppRole; full_name?: string | null;
  linked_user_id?: string | null; scope_team?: string | null; status: string;
}
async function postJson(path: string, body: unknown): Promise<Response> {
  return authedFetch(`${API}${path}`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
}
async function asError(r: Response): Promise<string> {
  try { const d = await r.json(); return d.detail || d.reason || `Error ${r.status}`; }
  catch { return `Error ${r.status}`; }
}
export async function login(email: string, password: string): Promise<{ token: string; user: AppUser }> {
  const r = await postJson("/api/auth/login", { email, password });
  if (!r.ok) throw new Error(await asError(r));
  const d = await r.json(); setToken(d.token); return d;
}
export async function fetchMe(): Promise<AppUser | null> {
  if (!getToken()) return null;
  const r = await authedFetch(`${API}/api/auth/me`, { cache: "no-store" });
  if (!r.ok) { clearToken(); return null; }
  return (await r.json()).user;
}
export function logout() { clearToken(); }
export async function getInviteInfo(token: string): Promise<{ email: string; full_name?: string }> {
  const r = await authedFetch(`${API}/api/auth/invite?token=${encodeURIComponent(token)}`, { cache: "no-store" });
  if (!r.ok) throw new Error(await asError(r));
  return r.json();
}
export async function acceptInvite(token: string, password: string): Promise<{ token: string; user: AppUser }> {
  const r = await postJson("/api/auth/accept", { token, password });
  if (!r.ok) throw new Error(await asError(r));
  const d = await r.json(); setToken(d.token); return d;
}
export async function changePassword(old_password: string, new_password: string): Promise<void> {
  const r = await postJson("/api/auth/change_password", { old_password, new_password });
  if (!r.ok) throw new Error(await asError(r));
}
export interface AdminUser extends AppUser {
  has_invite: boolean; invite_link?: string | null; last_login?: string | null;
}
export async function listUsers(): Promise<{ users: AdminUser[]; smtp: boolean; owner_email: string }> {
  const r = await authedFetch(`${API}/api/users`, { cache: "no-store" });
  if (!r.ok) throw new Error(await asError(r));
  return r.json();
}
export async function createUser(body: { email: string; role: string; full_name?: string; linked_user_id?: string; scope_team?: string }):
  Promise<{ ok: boolean; invite_link: string; email_sent: boolean; email_detail: string }> {
  const r = await postJson("/api/users", body);
  if (!r.ok) throw new Error(await asError(r));
  return r.json();
}
export async function resendInvite(id: number): Promise<{ invite_link: string; email_sent: boolean }> {
  const r = await postJson(`/api/users/${id}/resend`, {});
  if (!r.ok) throw new Error(await asError(r));
  return r.json();
}
export async function setUserStatus(id: number, active: boolean): Promise<void> {
  const r = await authedFetch(`${API}/api/users/${id}/status?active=${active}`, { method: "POST" });
  if (!r.ok) throw new Error(await asError(r));
}
export async function resetUserPassword(id: number): Promise<{ invite_link: string; email_sent: boolean }> {
  const r = await postJson(`/api/users/${id}/reset`, {});
  if (!r.ok) throw new Error(await asError(r));
  return r.json();
}
export interface AuditRow { ts: string; actor_email: string; actor_role: string; action: string; target: string; detail: string; }
export async function getAuditLog(limit = 200): Promise<{ rows: AuditRow[] }> {
  const r = await authedFetch(`${API}/api/audit_log?limit=${limit}`, { cache: "no-store" });
  if (!r.ok) throw new Error(await asError(r));
  return r.json();
}
export interface AttendanceRow {
  name: string; department: string; effective_h: number; tracked_h: number; gap_h: number;
  real_util: number; overtime_h: number; short_h: number; present_days: number; off_days: number;
  late_days: number; matched: boolean;
}
export interface AttendanceData {
  month: string | null; months: string[];
  summary: { employees: number; matched: number; effective_h: number; tracked_h: number; gap_h: number; real_util: number; overtime_h: number; short_h: number };
  rows: AttendanceRow[];
}
export interface WorkforceData {
  has_keka: boolean; attendance_pct: number; present_days: number; off_days: number;
  overtime_h: number; short_h: number; late_days: number;
  cross_team_pct: number; cross_team_h: number; total_tracked_h: number;
  funnel: { office_h: number; tracked_h: number; billable_h: number };
}
export async function getWorkforce(f: Filters): Promise<WorkforceData> {
  const qs = new URLSearchParams();
  Object.entries(f).forEach(([k, v]) => { if (v) qs.set(k, v); });
  const r = await authedFetch(`${API}/api/workforce?${qs.toString()}`, { cache: "no-store" });
  if (!r.ok) throw new Error("workforce failed");
  return r.json();
}
export interface AttendanceTrendPoint { month: string; effective_h: number; tracked_h: number; gap_h: number; real_util: number; overtime_h: number; }
export async function getAttendanceTrend(): Promise<{ trend: AttendanceTrendPoint[] }> {
  const r = await authedFetch(`${API}/api/attendance/trend`, { cache: "no-store" });
  if (!r.ok) throw new Error(await asError(r));
  return r.json();
}
export async function getAttendance(month?: string): Promise<AttendanceData> {
  const qs = month ? `?month=${encodeURIComponent(month)}` : "";
  const r = await authedFetch(`${API}/api/attendance${qs}`, { cache: "no-store" });
  if (!r.ok) throw new Error(await asError(r));
  return r.json();
}
export interface KekaMonth { month: string; rows: number; employees: number; effective_hours: number; uploaded_on?: string | null; uploaded_by?: string | null; }
export async function getKekaStatus(): Promise<{ months: KekaMonth[] }> {
  const r = await authedFetch(`${API}/api/keka/status`, { cache: "no-store" });
  if (!r.ok) throw new Error(await asError(r));
  return r.json();
}
export async function uploadKeka(file: File): Promise<{ ok: boolean; rows: number; months: string[]; employees: number }> {
  const fd = new FormData(); fd.append("file", file);
  const r = await authedFetch(`${API}/api/keka/upload`, { method: "POST", body: fd });
  if (!r.ok) throw new Error(await asError(r));
  return r.json();
}
export interface HoursPolicy {
  effective_from: string; shift_min: number; threshold_min: number; short_break_min: number; long_break_min: number;
  net_min: number; shift_hours: number; threshold_hours: number; net_hours: number;
}
export interface HoursConfig { policies: HoursPolicy[]; current: HoursPolicy | null; write: boolean; }
export async function getHoursConfig(): Promise<HoursConfig> {
  const r = await authedFetch(`${API}/api/settings/hours`, { cache: "no-store" });
  if (!r.ok) throw new Error(await asError(r));
  return r.json();
}
export async function saveHoursConfig(body: { effective_from: string; shift_min: number; threshold_min: number; short_break_min: number; long_break_min: number }): Promise<{ ok: boolean; detail?: string; reason?: string; net_min?: number }> {
  const r = await authedFetch(`${API}/api/settings/hours`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  return r.json();
}
export async function deleteHoursPolicy(effective_from: string): Promise<{ ok: boolean; detail?: string; reason?: string }> {
  const r = await authedFetch(`${API}/api/settings/hours/delete`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ effective_from }),
  });
  return r.json();
}
export interface EmailSettings {
  smtp_host: string; smtp_port: string; smtp_user: string; smtp_from: string;
  public_app_url: string; password_set: boolean; ready: boolean;
  sources: Record<string, "app" | "env" | "none">;
}
export async function getEmailSettings(): Promise<EmailSettings> {
  const r = await authedFetch(`${API}/api/settings/email`, { cache: "no-store" });
  if (!r.ok) throw new Error(await asError(r));
  return r.json();
}
export async function saveEmailSettings(body: Partial<{ smtp_host: string; smtp_port: string; smtp_user: string; smtp_pass: string; smtp_from: string; public_app_url: string }>): Promise<{ ok: boolean; ready: boolean }> {
  const r = await postJson("/api/settings/email", body);
  if (!r.ok) throw new Error(await asError(r));
  return r.json();
}
export async function testEmail(to: string): Promise<void> {
  const r = await postJson("/api/settings/email/test", { to });
  if (!r.ok) throw new Error(await asError(r));
}
