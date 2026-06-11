"use client";

import { useEffect, useState } from "react";
import { getInviteInfo, acceptInvite } from "../lib/api";

export const dynamic = "force-dynamic";

export default function InvitePage() {
  const [token, setToken] = useState("");
  const [info, setInfo] = useState<{ email: string; full_name?: string } | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error" | "done">("loading");
  const [err, setErr] = useState("");
  const [pw, setPw] = useState("");
  const [conf, setConf] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get("token") || "";
    setToken(t);
    if (!t) { setState("error"); setErr("No invite token in the link."); return; }
    getInviteInfo(t)
      .then((d) => { setInfo(d); setState("ready"); })
      .catch((e) => { setState("error"); setErr((e as Error).message); });
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    if (pw.length < 6) { setErr("Password must be at least 6 characters"); return; }
    if (pw !== conf) { setErr("Passwords do not match"); return; }
    setBusy(true); setErr("");
    try {
      await acceptInvite(token, pw);
      setState("done");
      setTimeout(() => { window.location.href = "/"; }, 1200);
    } catch (ex) { setErr((ex as Error).message); setBusy(false); }
  }

  return (
    <div className="role-screen">
      <div className="role-shell">
        <aside className="role-brand">
          <div className="role-brand-mark"><span className="rb-dot" />Insight</div>
          <div className="role-brand-mid">
            <h2>Welcome to<br />Finovate Insight</h2>
            <p>Set your password to activate your account and access your operations dashboard.</p>
          </div>
          <div className="role-brand-foot">FINOVATE · Operations Command Center</div>
        </aside>
        <main className="role-pick">
          {state === "loading" && <div className="loading" style={{ height: 200 }}><span className="spin" /> Checking your invite…</div>}
          {state === "error" && (
            <div className="role-pick-head">
              <span className="role-eyebrow" style={{ color: "#ef4444" }}>Invite problem</span>
              <h1>Link not valid</h1>
              <p>{err || "This invite link is invalid, used, or expired. Ask your administrator for a new one."}</p>
              <a className="role-go" href="/" style={{ textDecoration: "none", marginTop: 18 }}>Go to sign in</a>
            </div>
          )}
          {state === "done" && (
            <div className="role-pick-head">
              <span className="role-eyebrow" style={{ color: "#16a34a" }}>All set</span>
              <h1>Password created</h1>
              <p>Signing you in…</p>
            </div>
          )}
          {state === "ready" && info && (
            <>
              <div className="role-pick-head">
                <span className="role-eyebrow">Activate account</span>
                <h1>Set your password</h1>
                <p>For <strong>{info.email}</strong>{info.full_name ? ` · ${info.full_name}` : ""}</p>
              </div>
              <form className="login-form" onSubmit={submit}>
                <label className="login-lbl">New password</label>
                <div className="login-field"><input type="password" autoFocus placeholder="At least 6 characters" value={pw} onChange={(e) => setPw(e.target.value)} /></div>
                <label className="login-lbl">Confirm password</label>
                <div className="login-field"><input type="password" placeholder="Re-enter password" value={conf} onChange={(e) => setConf(e.target.value)} /></div>
                {err && <div className="login-err">{err}</div>}
                <button type="submit" className="role-go" disabled={busy || !pw}>{busy ? "Activating…" : "Set password & sign in"}</button>
              </form>
            </>
          )}
        </main>
      </div>
    </div>
  );
}
