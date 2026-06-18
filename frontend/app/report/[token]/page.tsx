"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { getPublicReport, type PublicReport } from "../../lib/api";
import { BarList } from "../../components/Charts";

export const dynamic = "force-dynamic";

const n0 = (v: number | null | undefined) => (v == null ? "—" : Math.round(v).toLocaleString());
const n1 = (v: number | null | undefined) => (v == null ? "—" : (Math.round(v * 10) / 10).toLocaleString());
const STATUS: Record<string, { label: string; bg: string; fg: string }> = {
  on_track: { label: "On track", bg: "#e3f4ea", fg: "#15795a" },
  over: { label: "Over budget", bg: "#fde7e7", fg: "#b5352f" },
  under: { label: "Under budget", bg: "#fdf2dd", fg: "#9a6a13" },
};
const MIX: [keyof NonNullable<PublicReport["status_mix"]>, string, string][] = [
  ["done", "Completed", "#15936f"], ["in_progress", "In progress", "#2b5bb0"], ["review", "In review", "#caa53d"], ["overdue", "Blocked", "#cf4b52"],
];

export default function ReportPage() {
  const params = useParams();
  const token = String((params?.token as string) || "");
  const [state, setState] = useState<"loading" | "ok" | "gone">("loading");
  const [r, setR] = useState<PublicReport | null>(null);

  useEffect(() => {
    if (!token) { setState("gone"); return; }
    let off = false;
    getPublicReport(token)
      .then((d) => { if (off) return; if (d.found) { setR(d); setState("ok"); } else { setState("gone"); } })
      .catch(() => { if (!off) setState("gone"); });
    return () => { off = true; };
  }, [token]);

  const Row = ({ k, v, sub }: { k: string; v: React.ReactNode; sub?: string }) => (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 16, padding: "11px 0", borderTop: "1px solid #f0f2f6" }}>
      <span style={{ fontSize: 13, color: "#6b7686" }}>{k}</span>
      <span style={{ fontSize: 14, fontWeight: 600, color: "#1d2735", textAlign: "right" }}>{v}{sub && <span style={{ fontWeight: 400, color: "#9aa4b2", fontSize: 12 }}> · {sub}</span>}</span>
    </div>
  );
  const H = ({ children }: { children: React.ReactNode }) => (
    <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".09em", textTransform: "uppercase", color: "#9aa4b2", margin: "26px 0 6px" }}>{children}</div>
  );
  const mixTotal = r?.status_mix ? Math.max(1, r.status_mix.done + r.status_mix.in_progress + r.status_mix.review + r.status_mix.overdue) : 1;

  return (
    <div style={{ minHeight: "100vh", background: "#eceff3", padding: "44px 16px", fontFamily: "-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif" }}>
      <div style={{ maxWidth: 680, margin: "0 auto" }}>
        {state === "loading" && <div style={{ background: "#fff", border: "1px solid #dfe3ea", borderRadius: 4, padding: 48, textAlign: "center", color: "#6b7686" }}>Loading…</div>}

        {state === "gone" && (
          <div style={{ background: "#fff", border: "1px solid #dfe3ea", borderRadius: 4, padding: 48, textAlign: "center" }}>
            <div style={{ fontSize: 16, fontWeight: 600, color: "#1d2735", marginBottom: 6 }}>Report unavailable</div>
            <div style={{ fontSize: 13, color: "#6b7686" }}>This link is invalid, expired, or has been revoked. Please ask for a new one.</div>
          </div>
        )}

        {state === "ok" && r && (
          <div style={{ background: "#fff", border: "1px solid #dcdfe7", borderRadius: 4, padding: "34px 40px 30px" }}>
            {/* letterhead */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", paddingBottom: 18, borderBottom: "2px solid #0f2742" }}>
              <div>
                <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".18em", textTransform: "uppercase", color: "#9aa4b2" }}>Finovate Insight</div>
                <div style={{ fontSize: 26, fontWeight: 700, letterSpacing: "-.02em", color: "#0f2742", marginTop: 6 }}>{r.client}</div>
                <div style={{ fontSize: 13, color: "#6b7686", marginTop: 3 }}>Activity statement · {r.period}{r.people ? ` · team of ${r.people}` : ""}</div>
              </div>
              {r.status && STATUS[r.status] && (
                <span style={{ fontSize: 11, fontWeight: 700, padding: "5px 11px", borderRadius: 3, background: STATUS[r.status].bg, color: STATUS[r.status].fg, whiteSpace: "nowrap" }}>{STATUS[r.status].label}</span>
              )}
            </div>

            {/* headline */}
            <div style={{ display: "flex", alignItems: "baseline", gap: 14, margin: "22px 0 2px" }}>
              <span style={{ fontSize: 40, fontWeight: 700, letterSpacing: "-.03em", color: "#0f2742", lineHeight: 1 }}>{n0(r.hours)}h</span>
              <span style={{ fontSize: 14, color: "#6b7686" }}>tracked this period{r.hours_delta != null ? <span style={{ color: r.hours_delta >= 0 ? "#15795a" : "#b5352f", fontWeight: 600 }}> · {r.hours_delta >= 0 ? "▲" : "▼"} {Math.abs(r.hours_delta)}% vs prior</span> : null}</span>
            </div>

            {/* summary table */}
            <H>Summary</H>
            <Row k="Hours tracked" v={`${n1(r.hours)}h`} />
            <Row k="Billable" v={`${n1(r.billable)}h`} sub={r.billable_pct != null ? `${r.billable_pct}% of tracked` : undefined} />
            <Row k="Active days" v={`${n0(r.active_days)}`} sub={r.avg_per_day != null ? `avg ${n1(r.avg_per_day)}h/day` : undefined} />
            <Row k="Tasks delivered" v={`${n0(r.tasks_done)} / ${n0(r.tasks_total)}`} sub={r.delivery_pct != null ? `${r.delivery_pct}% complete` : undefined} />
            {r.budget != null && <Row k="Budget used" v={r.used_pct != null ? `${r.used_pct}%` : "—"} sub={`of ${n0(r.budget)}h`} />}
            {r.hours_delta != null && <Row k="vs prior period" v={<span style={{ color: r.hours_delta >= 0 ? "#15795a" : "#b5352f" }}>{r.hours_delta >= 0 ? "▲" : "▼"} {Math.abs(r.hours_delta)}%</span>} />}

            {/* budget bar */}
            {r.budget != null && r.used_pct != null && (
              <div style={{ marginTop: 16 }}>
                <div style={{ height: 7, borderRadius: 4, background: "#eef0f5", overflow: "hidden" }}>
                  <div style={{ height: "100%", width: `${Math.min(100, r.used_pct)}%`, background: r.used_pct > 100 ? "#cf4b52" : r.used_pct >= 85 ? "#d9822b" : "#15936f" }} />
                </div>
              </div>
            )}

            {/* delivery */}
            {r.status_mix && r.tasks_total ? (
              <>
                <H>Delivery status</H>
                <div style={{ display: "flex", height: 11, borderRadius: 3, overflow: "hidden", background: "#eef0f5", marginBottom: 10 }}>
                  {MIX.map(([k, , c]) => { const v = r.status_mix![k]; return v > 0 ? <span key={k} style={{ width: `${(v / mixTotal) * 100}%`, background: c }} title={`${k}: ${v}`} /> : null; })}
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 16, fontSize: 12, color: "#3a4255" }}>
                  {MIX.map(([k, lbl, c]) => (
                    <span key={k} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                      <i style={{ width: 8, height: 8, borderRadius: 2, background: c, display: "inline-block" }} />{lbl}<b style={{ marginLeft: 2 }}>{r.status_mix![k]}</b>
                    </span>
                  ))}
                </div>
              </>
            ) : null}

            {/* recent work */}
            {r.top_tasks && r.top_tasks.length > 0 && (
              <>
                <H>What we worked on</H>
                {r.top_tasks.map((t, i) => (
                  <div key={i} style={{ display: "flex", alignItems: "center", gap: 12, padding: "9px 0", borderTop: i ? "1px solid #f0f2f6" : "none" }}>
                    <span style={{ flex: 1, fontSize: 13, color: "#1d2735", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.task}</span>
                    {t.status && <span style={{ fontSize: 10.5, color: "#6b7686", background: "#f0f2f6", padding: "2px 8px", borderRadius: 3, whiteSpace: "nowrap" }}>{t.status}</span>}
                    <span style={{ fontSize: 13, fontWeight: 700, color: "#0f2742", width: 50, textAlign: "right" }}>{n1(t.hours)}h</span>
                  </div>
                ))}
              </>
            )}

            {/* weekly activity */}
            {r.weekly && r.weekly.length > 1 && (
              <>
                <H>Activity by week</H>
                <BarList items={r.weekly.map((w) => ({ label: w.week, value: w.hours }))} unit="h" color="#1e3a5f" />
              </>
            )}

            <div style={{ marginTop: 28, paddingTop: 16, borderTop: "1px solid #eef1f4", color: "#9aa4b2", fontSize: 11 }}>
              Finovate Insight · confidential client statement{r.as_of ? ` · as of ${r.as_of}` : ""} · figures update as work is tracked.
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
