export const API = process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8000";

export interface FilterOptions {
  date_min: string;
  date_max: string;
  departments: string[];
  atls: string[];
  employees: string[];
  clients: string[];
  client_types: string[];
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
  revenue: number; budget: number; variance: number; status: string;
}
export interface EmployeeRow {
  name: string; team: string; billable: number; non_billable: number;
  utilization: number; activity: number; productivity: number; avg_day: number;
  days: number; grade: string; active_tasks: number; task_status: string; client: string;
  clients?: string[]; hr_status?: string;
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
  rows: { name: string; hours: number; days: number; reason: string; suggestion: string }[];
  count: number;
  total_hours: number;
  total_members: number;
}
export async function getUnassigned(): Promise<UnassignedData> {
  const r = await fetch(`${API}/api/unassigned`, { cache: "no-store" });
  if (!r.ok) throw new Error("unassigned failed");
  return r.json();
}

export async function getRaw(f: Filters): Promise<RawData> {
  const qs = new URLSearchParams();
  Object.entries(f).forEach(([k, v]) => { if (v) qs.set(k, v); });
  const r = await fetch(`${API}/api/raw?${qs.toString()}`, { cache: "no-store" });
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
  const r = await fetch(`${API}/api/compare_trend?${qs.toString()}`, { cache: "no-store" });
  if (!r.ok) throw new Error("compare_trend failed");
  return r.json();
}
export async function getHoursDetail(f: Filters): Promise<HoursDetailData> {
  const qs = new URLSearchParams();
  Object.entries(f).forEach(([k, v]) => { if (v) qs.set(k, v); });
  const r = await fetch(`${API}/api/hours_detail?${qs.toString()}`, { cache: "no-store" });
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
  const r = await fetch(`${API}/api/employee?${qs.toString()}`, { cache: "no-store" });
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

export async function getFilters(scope?: { department?: string; atl?: string; date_from?: string; date_to?: string }): Promise<FilterOptions> {
  const qs = new URLSearchParams();
  if (scope?.department) qs.set("department", scope.department);
  if (scope?.atl) qs.set("atl", scope.atl);
  if (scope?.date_from) qs.set("date_from", scope.date_from);
  if (scope?.date_to) qs.set("date_to", scope.date_to);
  const r = await fetch(`${API}/api/filters?${qs.toString()}`, { cache: "no-store" });
  if (!r.ok) throw new Error("filters failed");
  return r.json();
}

export interface AskResult {
  ok: boolean;
  reason?: string;
  text?: string;
  kind?: "bar" | "donut" | "none";
  bars?: { label: string; value: number; color?: string }[];
  donut?: { data: { name: string; value: number }[]; colors: string[]; center?: { value: string; label: string } };
}
export async function askAI(question: string, f: Filters): Promise<AskResult> {
  const r = await fetch(`${API}/api/ask`, {
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
  const r = await fetch(`${API}/api/breakdown?${qs.toString()}`, { cache: "no-store" });
  if (!r.ok) throw new Error("breakdown failed");
  return r.json();
}

export interface BdRow { name: string; total: number; billable: number; non_billable: number; project?: string; }
export interface BreakdownListData { by_task: BdRow[]; by_project: BdRow[]; }
export async function getBreakdownList(f: Filters): Promise<BreakdownListData> {
  const qs = new URLSearchParams();
  Object.entries(f).forEach(([k, v]) => { if (v) qs.set(k, v); });
  const r = await fetch(`${API}/api/breakdown_list?${qs.toString()}`, { cache: "no-store" });
  if (!r.ok) throw new Error("breakdown_list failed");
  return r.json();
}

export interface MappingRow {
  hubstaff_name: string; hubstaff_user_id?: string; hr_employee_no?: string; hr_full_name?: string;
  status?: string; department?: string; team?: string; job_title?: string; reporting_to?: string;
  exit_date?: string; confidence?: string; total_hours?: number; last_worked?: string; reviewed?: boolean;
}
export interface MappingData { exists: boolean; write: boolean; count: number; rows: MappingRow[]; }
export async function getMapping(): Promise<MappingData> {
  const r = await fetch(`${API}/api/mapping`, { cache: "no-store" });
  if (!r.ok) throw new Error("mapping failed");
  return r.json();
}
export async function saveMapping(row: Partial<MappingRow> & { hubstaff_name: string }): Promise<{ ok: boolean; detail?: string; reason?: string }> {
  const r = await fetch(`${API}/api/mapping/save`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(row),
  });
  return r.json();
}
export async function initMapping(): Promise<{ ok: boolean; rows?: number; detail?: string; reason?: string }> {
  const r = await fetch(`${API}/api/mapping/init`, { method: "POST" });
  return r.json();
}

export interface BudgetClient {
  client: string; type: string; team: string;
  budget: number; actual: number; variance: number; over: boolean; pct: number;
}
export interface BudgetData {
  clients: BudgetClient[]; total_budget: number; total_actual: number;
  on_budget: number; over: number; count: number;
}
export async function getBudget(f: Filters): Promise<BudgetData> {
  const qs = new URLSearchParams();
  Object.entries(f).forEach(([k, v]) => { if (v) qs.set(k, v); });
  const r = await fetch(`${API}/api/budget?${qs.toString()}`, { cache: "no-store" });
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
  const r = await fetch(`${API}/api/client?${qs.toString()}`, { cache: "no-store" });
  if (!r.ok) throw new Error("client failed");
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
  if (f.date_from) qs.set("date_from", f.date_from);
  if (f.date_to) qs.set("date_to", f.date_to);
  const r = await fetch(`${API}/api/team?${qs.toString()}`, { cache: "no-store" });
  if (!r.ok) throw new Error("team failed");
  return r.json();
}

export interface TaskDelivery { due: number; on_time: number; late: number; open: number; on_time_pct: number; }
export async function getTaskDelivery(f: Filters): Promise<TaskDelivery> {
  const qs = new URLSearchParams();
  Object.entries(f).forEach(([k, v]) => { if (v) qs.set(k, v); });
  const r = await fetch(`${API}/api/task_delivery?${qs.toString()}`, { cache: "no-store" });
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
  const r = await fetch(`${API}/api/command?${qs.toString()}`, { cache: "no-store" });
  if (!r.ok) throw new Error("command failed");
  return r.json();
}
