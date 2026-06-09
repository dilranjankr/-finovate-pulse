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
  clients?: string[];
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

export async function getFilters(scope?: { department?: string; atl?: string }): Promise<FilterOptions> {
  const qs = new URLSearchParams();
  if (scope?.department) qs.set("department", scope.department);
  if (scope?.atl) qs.set("atl", scope.atl);
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

export async function getCommand(f: Filters): Promise<CommandData> {
  const qs = new URLSearchParams();
  Object.entries(f).forEach(([k, v]) => {
    if (v) qs.set(k, v);
  });
  const r = await fetch(`${API}/api/command?${qs.toString()}`, { cache: "no-store" });
  if (!r.ok) throw new Error("command failed");
  return r.json();
}
