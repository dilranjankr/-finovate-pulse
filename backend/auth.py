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

SESSION_HOURS = int(os.environ.get("SESSION_HOURS", "12"))
INVITE_HOURS = int(os.environ.get("INVITE_HOURS", "48"))
ROLES = ("owner", "manager", "lead", "employee")


def _secret() -> str:
    # A stable per-deploy fallback so dev works out of the box; override in prod.
    return os.environ.get("JWT_SECRET") or "finovate-insight-dev-secret-change-me"


def owner_email() -> str:
    return (os.environ.get("OWNER_EMAIL") or "admin@finovate.com").strip().lower()


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
    base = (os.environ.get("PUBLIC_APP_URL") or "").rstrip("/")
    return f"{base}/invite?token={token}" if base else f"/invite?token={token}"


# ---- invitation email ------------------------------------------------------
def smtp_configured() -> bool:
    return bool(os.environ.get("SMTP_HOST") and os.environ.get("SMTP_FROM"))


def _invite_html(name: str, owner: str, link: str) -> str:
    greeting = f"Hi {name}," if name else "Hi,"
    return f"""\
<!doctype html><html><body style="margin:0;background:#f4f6f8;padding:32px 0;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
    <table role="presentation" width="520" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e6e9ee;">
      <tr><td style="padding:26px 32px 18px;border-bottom:1px solid #eef1f4;">
        <span style="font-size:18px;font-weight:800;letter-spacing:.04em;color:#0f2742;">FINOVATE</span>
        <span style="font-size:13px;color:#7a8699;font-weight:600;"> &nbsp;Insight</span>
      </td></tr>
      <tr><td style="padding:28px 32px 8px;color:#1d2735;font-size:14px;line-height:1.6;">
        <p style="margin:0 0 14px;">{greeting}</p>
        <p style="margin:0 0 14px;">{owner} has created an account for you on <strong>Finovate Insight</strong>, our operations dashboard.</p>
        <p style="margin:0 0 22px;">To get started, set your password and sign in:</p>
        <p style="margin:0 0 24px;">
          <a href="{link}" style="display:inline-block;background:#0f2742;color:#ffffff;text-decoration:none;font-weight:700;font-size:14px;padding:12px 26px;border-radius:8px;">Set your password &rarr;</a>
        </p>
        <p style="margin:0 0 6px;color:#6b7686;font-size:12.5px;">This link is valid for {INVITE_HOURS} hours and can be used once. If it expires, ask {owner} to send a new invite.</p>
        <p style="margin:0;color:#6b7686;font-size:12.5px;">Didn't expect this email? You can safely ignore it.</p>
      </td></tr>
      <tr><td style="padding:18px 32px 26px;border-top:1px solid #eef1f4;color:#9aa4b2;font-size:11.5px;">
        Finovate Insight &middot; Confidential — for internal use only.
      </td></tr>
    </table>
  </td></tr></table>
</body></html>"""


def send_invite_email(to_email: str, name: str, owner: str, link: str) -> tuple[bool, str]:
    """Returns (sent, detail). Falls back to copy-link when SMTP isn't configured."""
    if not smtp_configured():
        return False, "smtp-not-configured"
    import smtplib
    from email.mime.multipart import MIMEMultipart
    from email.mime.text import MIMEText
    msg = MIMEMultipart("alternative")
    msg["Subject"] = "You've been invited to Finovate Insight"
    msg["From"] = os.environ["SMTP_FROM"]
    msg["To"] = to_email
    text = (f"Hi {name},\n\n{owner} has created an account for you on Finovate Insight.\n"
            f"Set your password and sign in: {link}\n\n"
            f"This link is valid for {INVITE_HOURS} hours and can be used once.\n"
            f"Didn't expect this? You can ignore this email.\n\n— Finovate Insight")
    msg.attach(MIMEText(text, "plain"))
    msg.attach(MIMEText(_invite_html(name, owner, link), "html"))
    try:
        host = os.environ["SMTP_HOST"]; port = int(os.environ.get("SMTP_PORT", "587"))
        with smtplib.SMTP(host, port, timeout=15) as s:
            s.starttls()
            if os.environ.get("SMTP_USER"):
                s.login(os.environ["SMTP_USER"], os.environ.get("SMTP_PASS", ""))
            s.sendmail(os.environ["SMTP_FROM"], [to_email], msg.as_string())
        return True, "sent"
    except Exception as e:  # noqa
        return False, str(e)[:200]
