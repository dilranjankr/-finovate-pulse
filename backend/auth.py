"""
Authentication & invite layer for Finovate Insight.

- Single OWNER (bootstrapped from env, default admin@finovate.com / owner@123).
- Owner invites managers / team-leads / employees by email; the invitee sets
  their own password via a one-time, time-limited link.
- Passwords are bcrypt-hashed; sessions are signed JWTs.
- Email is sent via SMTP when configured; otherwise the owner gets a copy-link.

Env vars:
  JWT_SECRET        signing secret for session tokens (set a long random value in prod)
  OWNER_EMAIL       bootstrap owner email   (default admin@finovate.com)
  OWNER_PASSWORD    bootstrap owner password(default owner@123 — change after first login)
  PUBLIC_APP_URL    public frontend URL, used to build invite links in emails
  SMTP_HOST/PORT/USER/PASS/FROM   optional — enables sending invite emails
"""
import os
import secrets
from datetime import datetime, timedelta, timezone

import bcrypt
import jwt

import db

SESSION_HOURS = int(os.environ.get("SESSION_HOURS", "12"))
INVITE_HOURS = int(os.environ.get("INVITE_HOURS", "48"))
ROLES = ("owner", "manager", "lead", "employee")


def _secret() -> str:
    # A stable per-deploy fallback so dev works out of the box; override in prod.
    return os.environ.get("JWT_SECRET") or "finovate-insight-dev-secret-change-me"


def owner_email() -> str:
    return (os.environ.get("OWNER_EMAIL") or "admin@finovate.com").strip().lower()


# ---- settings (in-app overrides of env) ------------------------------------
# Values saved in the app_settings table take priority over environment
# variables, so the owner can change email config from the UI without a
# redeploy. Blank in-app value → fall back to the Coolify env var.
def _db_settings() -> dict:
    try:
        r = db.q_write("SELECT key, value FROM app_settings")
        return {row["key"]: (row["value"] or "") for _, row in r.iterrows()}
    except Exception:
        return {}


def _resolve(s: dict, key: str, env: str) -> str:
    return (s.get(key) or "").strip() or os.environ.get(env, "").strip()


def owner_password() -> str:
    return os.environ.get("OWNER_PASSWORD") or "owner@123"


# ---- passwords -------------------------------------------------------------
def hash_password(pw: str) -> str:
    return bcrypt.hashpw(pw.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(pw: str, hashed: str) -> bool:
    if not hashed:
        return False
    try:
        return bcrypt.checkpw(pw.encode("utf-8"), hashed.encode("utf-8"))
    except Exception:
        return False


# ---- session tokens (JWT) --------------------------------------------------
def make_session(user: dict) -> str:
    now = datetime.now(timezone.utc)
    payload = {
        "sub": user["email"], "uid": user.get("id"), "role": user.get("role"),
        "name": user.get("full_name") or user.get("email"),
        "scope_team": user.get("scope_team"), "linked_user_id": user.get("linked_user_id"),
        "iat": now, "exp": now + timedelta(hours=SESSION_HOURS),
    }
    return jwt.encode(payload, _secret(), algorithm="HS256")


def decode_session(token: str) -> dict | None:
    try:
        return jwt.decode(token, _secret(), algorithms=["HS256"])
    except Exception:
        return None


# ---- invite tokens ---------------------------------------------------------
def new_invite_token() -> str:
    return secrets.token_urlsafe(32)


def invite_expiry() -> datetime:
    return datetime.now(timezone.utc) + timedelta(hours=INVITE_HOURS)


def build_invite_link(token: str) -> str:
    base = _resolve(_db_settings(), "public_app_url", "PUBLIC_APP_URL").rstrip("/")
    return f"{base}/invite?token={token}" if base else f"/invite?token={token}"


# ---- invitation email ------------------------------------------------------
def smtp_settings() -> dict:
    """Resolved SMTP config (in-app DB settings override Coolify env)."""
    s = _db_settings()
    return {
        "host": _resolve(s, "smtp_host", "SMTP_HOST"),
        "port": _resolve(s, "smtp_port", "SMTP_PORT") or "587",
        "user": _resolve(s, "smtp_user", "SMTP_USER"),
        "password": _resolve(s, "smtp_pass", "SMTP_PASS"),
        "from": _resolve(s, "smtp_from", "SMTP_FROM"),
        "public_app_url": _resolve(s, "public_app_url", "PUBLIC_APP_URL"),
    }


def smtp_configured() -> bool:
    # Require a password too — Gmail (and most providers) reject unauthenticated
    # SMTP, so without it we stay in copy-link mode rather than silently failing.
    c = smtp_settings()
    return bool(c["host"] and c["from"] and c["password"])


def _invite_html(name: str, owner: str, link: str) -> str:
    greeting = f"Hi {name}," if name else "Hi,"
    return f"""\
<!doctype html><html><body style="margin:0;background:#eef1f5;padding:40px 0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;-webkit-font-smoothing:antialiased;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
    <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="width:560px;max-width:92%;background:#ffffff;border:1px solid #dfe3ea;border-radius:4px;">
      <tr><td style="height:3px;background:#0f2742;font-size:0;line-height:0;">&nbsp;</td></tr>
      <tr><td style="padding:30px 40px 0;">
        <div style="font-size:10px;font-weight:700;letter-spacing:.16em;text-transform:uppercase;color:#9aa4b2;">Finovate</div>
        <div style="font-size:21px;font-weight:700;letter-spacing:-.01em;color:#0f2742;margin-top:2px;">Insight</div>
      </td></tr>
      <tr><td style="padding:26px 40px 0;color:#1d2735;font-size:15px;line-height:1.65;">
        <p style="margin:0 0 16px;">{greeting}</p>
        <p style="margin:0 0 16px;">{owner} has set up an account for you on <strong style="font-weight:600;">Finovate Insight</strong> — the team&rsquo;s operations dashboard.</p>
        <p style="margin:0 0 26px;">Set your password to activate your account and sign in.</p>
      </td></tr>
      <tr><td style="padding:0 40px 26px;">
        <table role="presentation" cellpadding="0" cellspacing="0"><tr><td style="background:#0f2742;border-radius:4px;">
          <a href="{link}" style="display:inline-block;color:#ffffff;text-decoration:none;font-weight:600;font-size:14px;padding:13px 30px;">Set your password</a>
        </td></tr></table>
      </td></tr>
      <tr><td style="padding:0 40px 28px;">
        <p style="margin:0 0 8px;color:#6b7686;font-size:12.5px;line-height:1.6;">Or paste this link into your browser:</p>
        <p style="margin:0;font-size:12px;color:#3a6ea5;word-break:break-all;line-height:1.5;">{link}</p>
      </td></tr>
      <tr><td style="padding:0 40px 30px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td style="border-top:1px solid #eef1f4;padding-top:18px;color:#8a94a4;font-size:12px;line-height:1.6;">
          This link is valid for {INVITE_HOURS} hours and can be used once. If it expires, ask {owner} for a new invite. If you weren&rsquo;t expecting this email, you can safely ignore it.
        </td></tr></table>
      </td></tr>
      <tr><td style="padding:16px 40px;background:#f7f8fa;border-top:1px solid #eef1f4;color:#9aa4b2;font-size:11px;border-radius:0 0 4px 4px;">
        Finovate Insight &middot; Confidential — for internal use only
      </td></tr>
    </table>
  </td></tr></table>
</body></html>"""


def send_invite_email(to_email: str, name: str, owner: str, link: str) -> tuple[bool, str]:
    """Returns (sent, detail). Falls back to copy-link when SMTP isn't configured."""
    c = smtp_settings()
    if not (c["host"] and c["from"] and c["password"]):
        return False, "smtp-not-configured"
    import smtplib
    from email.mime.multipart import MIMEMultipart
    from email.mime.text import MIMEText
    msg = MIMEMultipart("alternative")
    msg["Subject"] = "You've been invited to Finovate Insight"
    msg["From"] = c["from"]
    msg["To"] = to_email
    text = (f"Hi {name},\n\n{owner} has created an account for you on Finovate Insight.\n"
            f"Set your password and sign in: {link}\n\n"
            f"This link is valid for {INVITE_HOURS} hours and can be used once.\n"
            f"Didn't expect this? You can ignore this email.\n\n— Finovate Insight")
    msg.attach(MIMEText(text, "plain"))
    msg.attach(MIMEText(_invite_html(name, owner, link), "html"))
    try:
        with smtplib.SMTP(c["host"], int(c["port"] or 587), timeout=15) as s:
            s.starttls()
            if c["user"]:
                s.login(c["user"], c["password"])
            s.sendmail(c["from"], [to_email], msg.as_string())
        return True, "sent"
    except Exception as e:  # noqa
        return False, str(e)[:200]
