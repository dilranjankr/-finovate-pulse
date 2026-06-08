"use client";

type Row = { label: string; values: number[]; total: number };

export default function MatrixHeatmap({ weeks, rows, base = "32,48,112" }: { weeks: string[]; rows: Row[]; base?: string }) {
  if (!rows || rows.length === 0) return <div style={{ color: "var(--muted)", fontSize: 12, padding: 12 }}>No data</div>;
  let max = 0;
  rows.forEach((r) => r.values.forEach((v) => { if (v > max) max = v; }));
  const shade = (v: number) => (v <= 0 ? "#f1f3f8" : `rgba(${base}, ${(0.14 + 0.86 * (v / max)).toFixed(2)})`);
  const tcol = (v: number) => (max && v / max > 0.5 ? "#fff" : "var(--ink-2)");

  return (
    <div style={{ overflowX: "auto", paddingTop: 2 }}>
      <table className="heat">
        <thead>
          <tr>
            <th className="l">Department</th>
            {weeks.map((w, i) => <th key={i}>{w}</th>)}
            <th>Total</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.label}>
              <td className="l tname">{r.label}</td>
              {r.values.map((v, i) => (
                <td key={i}>
                  <span className="hc" style={{ background: shade(v), color: tcol(v) }}>{v > 0 ? Math.round(v) : ""}</span>
                </td>
              ))}
              <td className="num" style={{ fontWeight: 750 }}>{Math.round(r.total)}h</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
