"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  BarChart, Bar, PieChart, Pie, Cell, Legend, LabelList,
  RadialBarChart, RadialBar, PolarAngleAxis,
  ScatterChart, Scatter, ZAxis,
  Sankey, Layer, Rectangle,
  ComposedChart, Line,
  RadarChart, Radar, PolarGrid, PolarRadiusAxis,
} from "recharts";

type BubblePt = { x: number; y: number; z: number; name: string; color: string };

const AX = { fontSize: 11, fill: "#8b95a9", fontWeight: 500 };
const GRID = "#eceff5";
const box = {
  background: "rgba(255,255,255,.97)", border: "1px solid #e6e9f1", borderRadius: 11,
  boxShadow: "0 12px 36px rgba(22,32,64,.16)", fontSize: 12, padding: "10px 13px",
  backdropFilter: "blur(6px)",
};
// Harmonized, brand-led categorical palette (consistent tone — not rainbow).
const PALETTE = ["#27408b", "#1f8a5b", "#3f72b0", "#c79231", "#6a5aa0", "#2a9088", "#c0607f", "#5878c4"];

function Sized({ height, defaultWidth, children }: {
  height: number; defaultWidth: number; children: (w: number, h: number) => ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(defaultWidth);
  useEffect(() => {
    const m = () => { if (ref.current?.clientWidth) setW(ref.current.clientWidth); };
    m(); const t = setTimeout(m, 60);
    window.addEventListener("resize", m);
    return () => { clearTimeout(t); window.removeEventListener("resize", m); };
  }, []);
  return <div ref={ref} style={{ width: "100%", height }}>{children(w, height)}</div>;
}

export function Sparkline({ data, color = "#4338ca" }: { data: number[]; color?: string }) {
  const d = data.map((v, i) => ({ i, v }));
  const id = "sp" + color.replace("#", "");
  return (
    <Sized height={36} defaultWidth={180}>
      {(w, h) => (
        <AreaChart width={w} height={h} data={d} margin={{ top: 3, right: 0, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.28} />
              <stop offset="100%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
          <Area isAnimationActive={false} type="monotone" dataKey="v" stroke={color} strokeWidth={1.8} fill={`url(#${id})`} dot={false} />
        </AreaChart>
      )}
    </Sized>
  );
}

export function RadialGauge({ value, color, height = 92 }: { value: number; color: string; height?: number }) {
  const v = Math.max(0, Math.min(100, value));
  return (
    <Sized height={height} defaultWidth={height}>
      {(w, h) => {
        const s = Math.min(w, h);
        return (
          <div style={{ position: "relative", width: w, height: h, display: "flex", justifyContent: "center" }}>
            <RadialBarChart width={s} height={h} cx="50%" cy="50%" innerRadius="74%" outerRadius="100%"
              barSize={7} data={[{ value: v }]} startAngle={90} endAngle={-270}>
              <PolarAngleAxis type="number" domain={[0, 100]} angleAxisId={0} tick={false} />
              <RadialBar background={{ fill: "#eef0f3" }} dataKey="value" cornerRadius={7} fill={color} angleAxisId={0} isAnimationActive={false} />
            </RadialBarChart>
            <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", pointerEvents: "none" }}>
              <span style={{ fontSize: 16, fontWeight: 780, color: "#111726", letterSpacing: "-.5px" }}>{Math.round(v)}<span style={{ fontSize: 10, color: "#8a93a3" }}>%</span></span>
            </div>
          </div>
        );
      }}
    </Sized>
  );
}

// Easiest activity view: vertical column chart — tracked hours by department.
export function DeptColumns({ rows, height = 300 }: {
  rows: { label: string; values: number[]; total: number }[]; height?: number;
}) {
  const data = [...rows].sort((a, b) => b.total - a.total).map((r) => ({ name: r.label, hours: Math.round(r.total) }));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const lbl = (v: any) => { const n = Number(v ?? 0); return n >= 1000 ? (n / 1000).toFixed(1) + "k" : String(n); };
  const gid = (i: number) => "dcol" + i;
  return (
    <Sized height={height} defaultWidth={760}>
      {(w, h) => (
        <BarChart width={w} height={h} data={data} barCategoryGap="26%" margin={{ top: 26, right: 10, left: -8, bottom: 4 }}>
          <defs>
            {data.map((_, i) => (
              <linearGradient key={i} id={gid(i)} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={PALETTE[i % PALETTE.length]} stopOpacity={1} />
                <stop offset="100%" stopColor={PALETTE[i % PALETTE.length]} stopOpacity={0.82} />
              </linearGradient>
            ))}
          </defs>
          <CartesianGrid stroke={GRID} vertical={false} />
          <XAxis dataKey="name" tick={{ fontSize: 11, fill: "#5b6577", fontWeight: 600 }} tickLine={false}
            axisLine={{ stroke: "#e2e6ee" }} tickMargin={10} interval={0} angle={-14} textAnchor="end" height={58} />
          <YAxis tick={AX} tickLine={false} axisLine={false} width={46} tickFormatter={lbl} />
          <Tooltip cursor={{ fill: "rgba(39,64,139,.06)", radius: 6 }} contentStyle={box} itemStyle={{ color: "#1f2733", fontWeight: 600 }}
            labelStyle={{ fontWeight: 700, color: "#14161b", marginBottom: 3 }}
            formatter={(v) => [`${Number(v).toLocaleString()} h`, "Tracked"]} />
          <Bar isAnimationActive={false} dataKey="hours" radius={[7, 7, 0, 0]} maxBarSize={56}
            label={{ position: "top", fontSize: 11, fill: "#3a4252", fontWeight: 700, formatter: lbl }}>
            {data.map((_, i) => <Cell key={i} fill={`url(#${gid(i)})`} />)}
          </Bar>
        </BarChart>
      )}
    </Sized>
  );
}

// Context-aware breakdown — vertical stacked columns (billable + non-billable),
// value labels, click-to-drill. Power-BI style and works at every drill level.
export function BreakdownColumns({ rows, height = 300, onPick }: {
  rows: { label: string; billable: number; nonbill: number; total: number; util: number }[];
  height?: number; onPick?: (label: string) => void;
}) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const lbl = (v: any) => { const n = Number(v ?? 0); return n >= 1000 ? (n / 1000).toFixed(1) + "k" : String(Math.round(n)); };
  return (
    <Sized height={height} defaultWidth={760}>
      {(w, h) => (
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        <BarChart width={w} height={h} data={rows} barCategoryGap="28%" margin={{ top: 26, right: 8, left: -6, bottom: 4 }}
          onClick={(e: any) => { if (onPick && e && e.activeLabel) onPick(String(e.activeLabel)); }}>
          <defs>
            <linearGradient id="bdg-b" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#0f9043" stopOpacity={1} /><stop offset="100%" stopColor="#0f9043" stopOpacity={0.78} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="#eef1f6" vertical={false} strokeDasharray="2 4" />
          <XAxis dataKey="label" tick={{ fontSize: 11, fill: "#565d6b", fontWeight: 600 }} tickLine={false}
            axisLine={{ stroke: "#e6e9f0" }} interval={0} angle={-18} textAnchor="end" height={70} />
          <YAxis tick={AX} tickLine={false} axisLine={false} width={46} tickFormatter={lbl} />
          <Tooltip cursor={{ fill: "rgba(32,48,112,.05)" }} contentStyle={box}
            formatter={(v, _n, p) => {
              const r = (p?.payload || {}) as { billable?: number; nonbill?: number };
              return [`${Number(v).toLocaleString()} h  ·  ${Math.round(r.billable || 0)}h billable / ${Math.round(r.nonbill || 0)}h non-bill`, "Tracked"];
            }} />
          <Bar isAnimationActive={false} dataKey="total" radius={[5, 5, 0, 0]} maxBarSize={56} cursor="pointer">
            {rows.map((r, i) => <Cell key={i} fill={r.nonbill > r.billable ? "#c2c9d6" : "url(#bdg-b)"} />)}
            <LabelList dataKey="total" position="top" formatter={lbl} fill="#3a4252" fontSize={11.5} fontWeight={750} />
          </Bar>
        </BarChart>
      )}
    </Sized>
  );
}

// Org hierarchy flow — Sankey: Department -> Team -> Client (hours = flow width).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function SankeyNode({ x, y, width, height, index, payload }: any) {
  const c = payload.layer === 0 ? "#203070" : payload.layer === 1 ? "#2f6fbf" : "#0f9043";
  const right = payload.layer === 2;
  const nm = String(payload.name);
  const label = nm.length > 24 ? nm.slice(0, 22) + "…" : nm;
  return (
    <Layer key={`n${index}`}>
      <Rectangle x={x} y={y} width={width} height={Math.max(height, 2)} fill={c} fillOpacity={0.92} radius={2} />
      <text x={right ? x - 8 : x + width + 8} y={y + height / 2} textAnchor={right ? "end" : "start"}
        dominantBaseline="middle" fontSize={10.5} fontWeight={600} fill="#2a3142"
        stroke="#fff" strokeWidth={3} paintOrder="stroke">{label}</text>
    </Layer>
  );
}
export function SankeyFlow({ data, height = 470 }: {
  data: { nodes: { name: string; layer?: number }[]; links: { source: number; target: number; value: number }[] }; height?: number;
}) {
  if (!data.nodes.length || !data.links.length) return <div className="empty-s">Not enough data for the org flow</div>;
  return (
    <Sized height={height} defaultWidth={900}>
      {(w, h) => (
        <Sankey width={w} height={h} data={data} nodePadding={16} nodeWidth={12} iterations={64}
          margin={{ top: 12, right: 140, bottom: 12, left: 14 }}
          link={{ stroke: "#aab3d0", strokeOpacity: 0.32 }} node={<SankeyNode />}>
          {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
          <Tooltip contentStyle={box} formatter={(v: any) => [`${Number(v).toLocaleString()} h`, "Tracked"]} />
        </Sankey>
      )}
    </Sized>
  );
}

// Radar — compare teams across Utilization / Activity / Productivity / Billable %.
export function RadarCompare({ teams, height = 330 }: {
  teams: { name: string; util: number; activity: number; productivity: number; billable: number }[]; height?: number;
}) {
  if (teams.length < 2) return <div className="empty-s">Need at least 2 teams in scope to compare</div>;
  const t = teams.slice(0, 5);
  const axes: [string, "util" | "activity" | "productivity" | "billable"][] = [
    ["Utilization", "util"], ["Activity", "activity"], ["Productivity", "productivity"], ["Billable %", "billable"]];
  const data = axes.map(([m, k]) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const o: any = { metric: m };
    t.forEach((tm) => { o[tm.name] = Math.round(tm[k]); });
    return o;
  });
  const COL = ["#203070", "#0f9043", "#d9882a", "#7b3fc0", "#2f6fbf"];
  return (
    <Sized height={height} defaultWidth={520}>
      {(w, h) => (
        <RadarChart width={w} height={h} data={data} margin={{ top: 10, right: 38, bottom: 6, left: 38 }} outerRadius="70%">
          <PolarGrid stroke="#e6e9f0" />
          <PolarAngleAxis dataKey="metric" tick={{ fontSize: 11, fill: "#565d6b", fontWeight: 600 }} />
          <PolarRadiusAxis domain={[0, 100]} tick={{ fontSize: 9, fill: "#aab2c0" }} axisLine={false} tickCount={5} />
          {t.map((tm, i) => <Radar key={tm.name} name={tm.name} dataKey={tm.name} stroke={COL[i % COL.length]} fill={COL[i % COL.length]} fillOpacity={0.1} strokeWidth={2} isAnimationActive={false} />)}
          <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 10.5, paddingTop: 8 }} />
          <Tooltip contentStyle={box} />
        </RadarChart>
      )}
    </Sized>
  );
}

// Combo: Hours (bars, left axis) + Utilization % (line, right axis) per group.
// One clean, understandable chart — volume and efficiency together. Click to drill.
export function ComboColumns({ rows, height = 340, onPick }: {
  rows: { label: string; hours: number; util: number }[];
  height?: number; onPick?: (l: string) => void;
}) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const hl = (v: any) => { const n = Number(v ?? 0); return n >= 1000 ? (n / 1000).toFixed(1) + "k" : String(Math.round(n)); };
  return (
    <Sized height={height} defaultWidth={760}>
      {(w, h) => (
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        <ComposedChart width={w} height={h} data={rows} barCategoryGap="30%" margin={{ top: 28, right: 4, left: -6, bottom: 4 }}
          onClick={(e: any) => { if (onPick && e && e.activeLabel) onPick(String(e.activeLabel)); }}>
          <defs>
            <linearGradient id="cc-h" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#27408b" stopOpacity={1} /><stop offset="100%" stopColor="#27408b" stopOpacity={0.62} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="#eef1f6" vertical={false} strokeDasharray="2 4" />
          <XAxis dataKey="label" tick={{ fontSize: 10.5, fill: "#565d6b", fontWeight: 600 }} tickLine={false}
            axisLine={{ stroke: "#e6e9f0" }} interval={0} angle={-18} textAnchor="end" height={68} />
          <YAxis yAxisId="h" tick={AX} tickLine={false} axisLine={false} width={42} tickFormatter={hl} />
          <YAxis yAxisId="u" orientation="right" domain={[0, 100]} tick={AX} tickLine={false} axisLine={false} width={36} tickFormatter={(v) => v + "%"} />
          <Tooltip cursor={{ fill: "rgba(32,48,112,.05)" }} contentStyle={box}
            formatter={(v, n) => (n === "util" ? [`${Math.round(Number(v))}%`, "Utilization"] : [`${Number(v).toLocaleString()} h`, "Tracked Hours"])} />
          <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11.5, color: "#565d6b", paddingTop: 8 }}
            formatter={(val) => (val === "util" ? "Utilization %" : "Tracked Hours")} />
          <Bar yAxisId="h" isAnimationActive={false} dataKey="hours" fill="url(#cc-h)" radius={[5, 5, 0, 0]} maxBarSize={52} cursor="pointer">
            <LabelList dataKey="hours" position="top" formatter={hl} fill="#3a4252" fontSize={10.5} fontWeight={700} />
          </Bar>
          <Line yAxisId="u" isAnimationActive={false} type="monotone" dataKey="util" stroke="#e08a1e" strokeWidth={2.6}
            dot={{ r: 3.5, fill: "#e08a1e", strokeWidth: 0 }} activeDot={{ r: 5 }} />
        </ComposedChart>
      )}
    </Sized>
  );
}

// Single-metric vertical columns — one clean number per group, value labels,
// click-to-drill. Reused for Hours, Utilization, Activity, etc.
export function MetricColumns({ rows, height = 280, onPick, unit = "", name = "Value", fmt, colorOf }: {
  rows: { label: string; value: number; trend?: number | null }[];
  height?: number; onPick?: (l: string) => void; unit?: string; name?: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  fmt?: (v: any) => string; colorOf?: (v: number) => string;
}) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const f = fmt || ((v: any) => { const n = Number(v ?? 0); return n >= 1000 ? (n / 1000).toFixed(1) + "k" : String(Math.round(n)); });
  const color = colorOf || (() => "url(#mc-navy)");
  return (
    <Sized height={height} defaultWidth={560}>
      {(w, h) => (
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        <BarChart width={w} height={h} data={rows} barCategoryGap="26%" margin={{ top: 30, right: 8, left: -8, bottom: 4 }}
          onClick={(e: any) => { if (onPick && e && e.activeLabel) onPick(String(e.activeLabel)); }}>
          <defs>
            <linearGradient id="mc-navy" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#27408b" stopOpacity={1} /><stop offset="100%" stopColor="#27408b" stopOpacity={0.72} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="#eef1f6" vertical={false} strokeDasharray="2 4" />
          <XAxis dataKey="label" tick={{ fontSize: 10.5, fill: "#565d6b", fontWeight: 600 }} tickLine={false}
            axisLine={{ stroke: "#e6e9f0" }} interval={0} angle={-18} textAnchor="end" height={64} />
          <YAxis tick={AX} tickLine={false} axisLine={false} width={42} tickFormatter={f} />
          <Tooltip cursor={{ fill: "rgba(32,48,112,.05)" }} contentStyle={box} formatter={(v) => [f(v) + unit, name]} />
          <Bar isAnimationActive={false} dataKey="value" radius={[5, 5, 0, 0]} maxBarSize={48} cursor="pointer">
            {rows.map((r, i) => <Cell key={i} fill={color(r.value)} />)}
            <LabelList dataKey="value" position="top" content={(p: { x?: string | number; y?: string | number; width?: string | number; index?: number }) => {
              const cx = Number(p.x ?? 0) + Number(p.width ?? 0) / 2, y = Number(p.y ?? 0), r = rows[p.index ?? 0];
              if (!r) return null;
              const tr = r.trend;
              return (
                <g>
                  {tr != null && <text x={cx} y={y - 20} textAnchor="middle" fontSize={9.5} fontWeight={800} fill={tr >= 0 ? "#0f9043" : "#d23f43"}>{tr >= 0 ? "▲" : "▼"}{Math.abs(Math.round(tr))}%</text>}
                  <text x={cx} y={y - 7} textAnchor="middle" fontSize={11} fontWeight={700} fill="#3a4252">{f(r.value) + unit}</text>
                </g>
              );
            }} />
          </Bar>
        </BarChart>
      )}
    </Sized>
  );
}

// Dead-simple activity view: tracked hours per department as horizontal bars.
// Easiest to read — name, proportional bar, total hours, and % of company total.
export function DeptBars({ rows }: {
  rows: { label: string; values: number[]; total: number }[];
}) {
  const sorted = [...rows].sort((a, b) => b.total - a.total);
  const total = sorted.reduce((s, r) => s + r.total, 0) || 1;
  const max = Math.max(1, ...sorted.map((r) => r.total));
  return (
    <div className="dbars">
      {sorted.map((r) => (
        <div className="dbar" key={r.label}>
          <span className="dnm" title={r.label}>{r.label}</span>
          <span className="dtrack"><span className="dfill" style={{ width: `${(r.total / max) * 100}%` }} /></span>
          <span className="dval">{Math.round(r.total).toLocaleString()}h</span>
          <span className="dpct">{Math.round((r.total / total) * 100)}%</span>
        </div>
      ))}
    </div>
  );
}

// Activity trend — one sparkline row per department, with total + week-over-week delta.
// A cleaner alternative to the dense department×week number matrix.
export function ActivityTrend({ weeks, rows }: {
  weeks: string[]; rows: { label: string; values: number[]; total: number }[];
}) {
  const sorted = [...rows].sort((a, b) => b.total - a.total);
  const maxTotal = Math.max(1, ...sorted.map((r) => r.total));
  return (
    <div className="atrend">
      {sorted.map((r) => {
        const vals = r.values.length ? r.values : [0];
        const peak = Math.max(...vals);
        const peakIdx = vals.indexOf(peak);
        const last = vals[vals.length - 1] || 0;
        const prev = vals.length > 1 ? vals[vals.length - 2] || 0 : 0;
        const delta = prev > 0 ? ((last - prev) / prev) * 100 : (last > 0 ? 100 : 0);
        const up = delta >= 0;
        return (
          <div className="atr" key={r.label}>
            <div className="atlbl">
              <span className="anm" title={r.label}>{r.label}</span>
              <span className="asub">peak {weeks[peakIdx] ?? ""} · {Math.round(peak)}h</span>
            </div>
            <div className="aspk"><Sparkline data={vals} color="#2f6fbf" /></div>
            <div className="abar"><span style={{ width: `${(r.total / maxTotal) * 100}%` }} /></div>
            <div className="atot">
              <b>{Math.round(r.total)}h</b>
              <span className={up ? "adelta up" : "adelta dn"}>{up ? "▲" : "▼"} {Math.abs(Math.round(delta))}%</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// Stacked area (stream) — weekly tracked hours, stacked by department.
// Shows total activity momentum AND composition over time in one chart.
export function StackedActivity({ weeks, rows, height = 300 }: {
  weeks: string[]; rows: { label: string; values: number[]; total: number }[]; height?: number;
}) {
  const PAL = ["#203070", "#0f9043", "#2f6fbf", "#d9882a", "#37a85f", "#7b3fc0", "#0d9488", "#bd8616"];
  const depts = [...rows].sort((a, b) => b.total - a.total);
  const data: Record<string, number | string>[] = weeks.map((w, i) => {
    const o: Record<string, number | string> = { week: w };
    depts.forEach((d) => { o[d.label] = Math.round(d.values[i] || 0); });
    return o;
  });
  const gid = (i: number) => "sa" + i;
  return (
    <Sized height={height} defaultWidth={760}>
      {(w, h) => (
        <AreaChart width={w} height={h} data={data} margin={{ top: 10, right: 8, left: -16, bottom: 0 }}>
          <defs>
            {depts.map((d, i) => (
              <linearGradient key={i} id={gid(i)} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={PAL[i % PAL.length]} stopOpacity={0.85} />
                <stop offset="100%" stopColor={PAL[i % PAL.length]} stopOpacity={0.45} />
              </linearGradient>
            ))}
          </defs>
          <CartesianGrid stroke={GRID} vertical={false} />
          <XAxis dataKey="week" tick={AX} tickLine={false} axisLine={{ stroke: "#e2e6ee" }} interval="preserveStartEnd" minTickGap={18} tickMargin={8} />
          <YAxis tick={AX} tickLine={false} axisLine={false} width={44} />
          <Tooltip contentStyle={box} itemStyle={{ fontSize: 11.5, padding: "1px 0" }} labelStyle={{ fontWeight: 700, marginBottom: 4 }}
            formatter={(v, name) => [`${v}h`, name]} />
          <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11, color: "#565d6b", paddingTop: 6 }} />
          {depts.map((d, i) => (
            <Area key={d.label} isAnimationActive={false} type="monotone" dataKey={d.label} stackId="1"
              stroke={PAL[i % PAL.length]} strokeWidth={1.4} fill={`url(#${gid(i)})`} dot={false} />
          ))}
        </AreaChart>
      )}
    </Sized>
  );
}

// Concentric multi-ring gauge — compares utilization across top teams.
export function TeamGauges({ data, height = 220 }: {
  data: { name: string; value: number }[]; height?: number;
}) {
  const rows = data.slice(0, 6).map((d, i) => ({ name: d.name, value: Math.max(0, Math.min(100, d.value)), fill: PALETTE[i % PALETTE.length] }));
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, flex: 1 }}>
      <div style={{ flex: "0 0 50%", maxWidth: "50%" }}>
        <Sized height={height} defaultWidth={200}>
          {(w, h) => (
            <RadialBarChart width={w} height={h} cx="50%" cy="50%" innerRadius="30%" outerRadius="100%"
              barSize={9} data={rows} startAngle={90} endAngle={-270}>
              <PolarAngleAxis type="number" domain={[0, 100]} angleAxisId={0} tick={false} />
              <RadialBar background={{ fill: "#eef0f3" }} dataKey="value" cornerRadius={6} angleAxisId={0} isAnimationActive={false}>
                {rows.map((r, i) => <Cell key={i} fill={r.fill} />)}
              </RadialBar>
              <Tooltip cursor={false} contentStyle={box} formatter={(v, _n, p) => [`${Math.round(Number(v))}%`, (p?.payload as { name?: string })?.name ?? ""]} />
            </RadialBarChart>
          )}
        </Sized>
      </div>
      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 7 }}>
        {rows.map((r) => (
          <div key={r.name} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12 }}>
            <span style={{ width: 9, height: 9, borderRadius: 3, background: r.fill, flexShrink: 0 }} />
            <span style={{ flex: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", color: "var(--ink-2)" }}>{r.name}</span>
            <span style={{ fontWeight: 750, fontVariantNumeric: "tabular-nums" }}>{Math.round(r.value)}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function TrendLines({ data, height = 300 }: { data: { date: string; billable: number | null; non_billable: number | null; forecast?: number }[]; height?: number }) {
  const hasForecast = data.some((d) => d.forecast != null);
  const fmt = (s: string) => { const p = s.split("-"); return `${p[2]}/${p[1]}`; };
  return (
    <Sized height={height} defaultWidth={520}>
      {(w, h) => (
        <AreaChart width={w} height={h} data={data} margin={{ top: 12, right: 14, left: -10, bottom: 0 }}>
          <defs>
            <linearGradient id="gB" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#0f9043" stopOpacity={0.30} />
              <stop offset="95%" stopColor="#0f9043" stopOpacity={0.02} />
            </linearGradient>
            <linearGradient id="gN" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#d9882a" stopOpacity={0.22} />
              <stop offset="95%" stopColor="#d9882a" stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke={GRID} vertical={false} />
          <XAxis dataKey="date" tickFormatter={fmt} tick={AX} tickLine={false} axisLine={false} minTickGap={34} tickMargin={8} />
          <YAxis tick={AX} tickLine={false} axisLine={false} width={38} />
          <Tooltip contentStyle={box} labelFormatter={(l) => `Date ${l}`}
            formatter={(v, n) => [`${Math.round(Number(v))} h`, n === "billable" ? "Billable" : "Non-Billable"]} />
          <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11.5, color: "#565d6b", paddingTop: 4 }}
            formatter={(val) => (val === "billable" ? "Billable" : val === "forecast" ? "Forecast (next 7d)" : "Non-Billable")} />
          <Area isAnimationActive={false} type="monotone" dataKey="non_billable" stroke="#d9882a" strokeWidth={2} strokeLinecap="round" fill="url(#gN)" dot={false} connectNulls={false} />
          <Area isAnimationActive={false} type="monotone" dataKey="billable" stroke="#0f9043" strokeWidth={2.6} strokeLinecap="round" fill="url(#gB)" dot={false} connectNulls={false} activeDot={{ r: 4, strokeWidth: 0 }} />
          {hasForecast && <Area isAnimationActive={false} type="monotone" dataKey="forecast" stroke="#203070" strokeWidth={2} strokeDasharray="5 4" fill="none" dot={false} connectNulls />}
        </AreaChart>
      )}
    </Sized>
  );
}

export function Donut({ data, colors, center, height = 200 }: {
  data: { name: string; value: number }[];
  colors: string[];
  center?: { value: string; label: string };
  height?: number;
}) {
  const gid = "dg" + (colors.join("") + (data[0]?.name || "")).replace(/[^a-z0-9]/gi, "");
  return (
    <Sized height={height} defaultWidth={200}>
      {(w, h) => (
        <div style={{ position: "relative", width: w, height: h }}>
          <PieChart width={w} height={h}>
            <defs>
              {colors.map((c, i) => (
                <linearGradient key={i} id={`${gid}-${i}`} x1="0" y1="0" x2="0.5" y2="1">
                  <stop offset="0%" stopColor={c} stopOpacity={1} />
                  <stop offset="100%" stopColor={c} stopOpacity={0.62} />
                </linearGradient>
              ))}
            </defs>
            <Pie isAnimationActive={false} data={data} dataKey="value" nameKey="name" cx="50%" cy="50%"
              innerRadius="71%" outerRadius="100%" paddingAngle={3} cornerRadius={7} stroke="#fff" strokeWidth={2.5}
              startAngle={90} endAngle={-270}>
              {data.map((_, i) => <Cell key={i} fill={`url(#${gid}-${i % colors.length})`} />)}
            </Pie>
            <Tooltip contentStyle={box} formatter={(v, n) => [Number(v).toLocaleString(), n]} />
          </PieChart>
          {center && (
            <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column",
              alignItems: "center", justifyContent: "center", pointerEvents: "none" }}>
              <div style={{ fontSize: 21, fontWeight: 760, color: "#14161b", letterSpacing: "-.6px" }}>{center.value}</div>
              <div style={{ fontSize: 10.5, color: "#8b919e", marginTop: 2, fontWeight: 500 }}>{center.label}</div>
            </div>
          )}
        </div>
      )}
    </Sized>
  );
}

function BubbleTip({ active, payload }: { active?: boolean; payload?: { payload: BubblePt }[] }) {
  if (!active || !payload || !payload.length) return null;
  const p = payload[0].payload;
  return (
    <div style={{ ...box }}>
      <div style={{ fontWeight: 700, marginBottom: 3 }}>{p.name}</div>
      <div style={{ color: "#565d6b" }}>Utilization: <b>{Math.round(p.x)}%</b></div>
      <div style={{ color: "#565d6b" }}>Productivity: <b>{Math.round(p.y)}%</b></div>
      <div style={{ color: "#565d6b" }}>Billable: <b>{Math.round(p.z)}h</b></div>
    </div>
  );
}

export function Bubble({ points, height = 290 }: { points: BubblePt[]; height?: number }) {
  return (
    <Sized height={height} defaultWidth={520}>
      {(w, h) => (
        <ScatterChart width={w} height={h} margin={{ top: 12, right: 18, left: -4, bottom: 16 }}>
          <CartesianGrid stroke={GRID} strokeDasharray="2 4" />
          <XAxis type="number" dataKey="x" name="Utilization" unit="%" domain={[0, 100]} tick={AX} tickLine={false} axisLine={false} />
          <YAxis type="number" dataKey="y" name="Productivity" unit="%" domain={[0, 100]} tick={AX} tickLine={false} axisLine={false} width={34} />
          <ZAxis type="number" dataKey="z" range={[50, 430]} name="Billable" />
          <Tooltip cursor={{ strokeDasharray: "3 3" }} content={<BubbleTip />} />
          <Scatter data={points} isAnimationActive={false}>
            {points.map((p, i) => <Cell key={i} fill={p.color} fillOpacity={0.7} stroke={p.color} />)}
          </Scatter>
        </ScatterChart>
      )}
    </Sized>
  );
}

export function BarList({ items, color = "#203070", unit = "", money = false }: {
  items: { label: string; value: number; color?: string }[]; color?: string; unit?: string; money?: boolean;
}) {
  const max = Math.max(1, ...items.map((i) => i.value));
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
      {items.map((it) => (
        <div key={it.label} style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 12 }}>
          <span style={{ width: 132, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", color: "var(--ink-2)" }}>{it.label}</span>
          <span style={{ flex: 1, height: 9, borderRadius: 5, background: "var(--line-2)", overflow: "hidden" }}>
            <span style={{ display: "block", height: "100%", width: `${(it.value / max) * 100}%`, background: it.color || color, borderRadius: 5 }} />
          </span>
          <span style={{ width: 72, textAlign: "right", fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>
            {money ? "$" : ""}{Math.round(it.value).toLocaleString()}{unit}
          </span>
        </div>
      ))}
    </div>
  );
}

export function GradeBars({ data, height = 230 }: { data: { grade: string; count: number }[]; height?: number }) {
  // Semantic grade colours (green = good → red = poor), tuned to a consistent tone.
  const COL: Record<string, string> = { "A+": "#1f8a5b", A: "#41a06a", "B+": "#8a9b2e", B: "#c79231", C: "#d98324", D: "#cf4b52" };
  const gi = (g: string) => "gb" + g.replace(/[^a-z0-9]/gi, "");
  return (
    <Sized height={height} defaultWidth={360}>
      {(w, h) => (
        <BarChart width={w} height={h} data={data} barCategoryGap="22%" margin={{ top: 24, right: 6, left: -24, bottom: 0 }}>
          <defs>
            {Object.entries(COL).map(([g, c]) => (
              <linearGradient key={g} id={gi(g)} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={c} stopOpacity={1} />
                <stop offset="100%" stopColor={c} stopOpacity={0.8} />
              </linearGradient>
            ))}
          </defs>
          <CartesianGrid stroke={GRID} vertical={false} />
          <XAxis dataKey="grade" tick={{ fontSize: 11.5, fill: "#5b6577", fontWeight: 700 }} tickLine={false} axisLine={{ stroke: "#e2e6ee" }} tickMargin={8} />
          <YAxis hide />
          <Tooltip cursor={{ fill: "rgba(39,64,139,.06)", radius: 6 }} contentStyle={box}
            labelStyle={{ fontWeight: 700, color: "#14161b", marginBottom: 3 }}
            formatter={(v) => [`${v}`, "Employees"]} />
          <Bar isAnimationActive={false} dataKey="count" radius={[7, 7, 0, 0]} maxBarSize={40}
            label={{ position: "top", fontSize: 11, fill: "#3a4252", fontWeight: 700 }}>
            {data.map((e, i) => <Cell key={i} fill={`url(#${gi(e.grade)})`} />)}
          </Bar>
        </BarChart>
      )}
    </Sized>
  );
}

// Proportional treemap — hours by client, biggest box first. Pure CSS flex squarify.
export function Treemap({ items, height = 300 }: {
  items: { label: string; value: number }[]; height?: number;
}) {
  const data = items.filter((d) => d.value > 0).sort((a, b) => b.value - a.value).slice(0, 14);
  const total = data.reduce((s, d) => s + d.value, 0) || 1;
  const PAL = ["#203070", "#27407f", "#2f6fbf", "#0f9043", "#37a85f", "#3a7bd0", "#1d2f63", "#458bd6", "#13864a", "#5a6f9e", "#2c508f", "#6aa2dd", "#0d7a40", "#4a5d8a"];
  // Greedy row-pack: keep adding boxes to a row until it has ~ a third of remaining area.
  const rows: { items: typeof data; weight: number }[] = [];
  let cur: typeof data = []; let curW = 0; let remain = total;
  const targetRows = Math.max(2, Math.round(Math.sqrt(data.length)));
  const rowTarget = total / targetRows;
  data.forEach((d) => {
    cur.push(d); curW += d.value;
    if (curW >= rowTarget && rows.length < targetRows - 1) {
      rows.push({ items: cur, weight: curW }); remain -= curW; cur = []; curW = 0;
    }
  });
  if (cur.length) rows.push({ items: cur, weight: curW });
  const totalW = rows.reduce((s, r) => s + r.weight, 0) || 1;
  let ci = 0;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4, height, width: "100%" }}>
      {rows.map((r, ri) => (
        <div key={ri} style={{ display: "flex", gap: 4, flex: r.weight, minHeight: 0 }}>
          {r.items.map((d) => {
            const c = PAL[ci++ % PAL.length];
            const pct = ((d.value / total) * 100);
            const big = pct > 7;
            return (
              <div key={d.label} title={`${d.label} · ${Math.round(d.value)}h`}
                style={{
                  flex: d.value, minWidth: 0, background: c, borderRadius: 8, color: "#fff",
                  padding: big ? "9px 11px" : "5px 7px", display: "flex", flexDirection: "column",
                  justifyContent: "space-between", overflow: "hidden",
                }}>
                <span style={{ fontSize: big ? 12 : 10.5, fontWeight: 700, lineHeight: 1.2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", opacity: 0.96 }}>{d.label}</span>
                {big && (
                  <span style={{ fontSize: 16, fontWeight: 800, fontVariantNumeric: "tabular-nums" }}>
                    {Math.round(d.value)}<span style={{ fontSize: 10.5, fontWeight: 600, opacity: 0.8 }}>h · {pct.toFixed(0)}%</span>
                  </span>
                )}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}
