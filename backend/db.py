"""
Supabase / Postgres connection layer.
Set DATABASE_URL in backend/.env (Supabase: Project Settings -> Database -> Connection string -> URI).
Example: postgresql://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:6543/postgres
The code rewrites the scheme to use psycopg3.
"""
import os
from functools import lru_cache

import pandas as pd
from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(__file__), ".env"))

_RAW = os.environ.get("DATABASE_URL", "").strip()
# Optional write connection (postgres/admin role) for the employee-mapping table.
# Put DATABASE_URL_WRITE=postgresql://postgres.<ref>:<password>@...:6543/postgres in .env.
_RAW_WRITE = os.environ.get("DATABASE_URL_WRITE", "").strip()


def _fix(url: str) -> str:
    if not url:
        return ""
    if url.startswith("postgres://"):
        url = "postgresql://" + url[len("postgres://"):]
    if url.startswith("postgresql://"):
        url = "postgresql+psycopg://" + url[len("postgresql://"):]
    return url


def database_url() -> str:
    return _fix(_RAW)


def database_url_write() -> str:
    return _fix(_RAW_WRITE)


def has_db() -> bool:
    return bool(_RAW)


def has_write() -> bool:
    return bool(_RAW_WRITE)


# TCP keepalives keep pooled connections alive so they aren't silently dropped by
# the Supabase pooler / network — that avoids the slow "reconnect on next query"
# stalls. pool_pre_ping still guards against any dead connection; pool_recycle is
# kept under the pooler's idle timeout so we proactively refresh.
# prepare_threshold=None disables psycopg3 server-side prepared statements — REQUIRED
# for Supabase's transaction-mode pooler (port 6543) and harmless on session mode.
# Transaction mode multiplexes connections, so the session-mode "max 15 clients"
# limit (and its exhaustion stalls) no longer applies.
_CONNECT_ARGS = {"prepare_threshold": None, "keepalives": 1, "keepalives_idle": 30,
                 "keepalives_interval": 10, "keepalives_count": 5}


@lru_cache(maxsize=1)
def _engine():
    from sqlalchemy import create_engine
    return create_engine(database_url(), pool_pre_ping=True, pool_recycle=240,
                         pool_size=3, max_overflow=2, pool_timeout=20,
                         connect_args=_CONNECT_ARGS)


@lru_cache(maxsize=1)
def _engine_write():
    from sqlalchemy import create_engine
    return create_engine(database_url_write(), pool_pre_ping=True, pool_recycle=240,
                         pool_size=1, max_overflow=2, pool_timeout=20,
                         connect_args=_CONNECT_ARGS)


def q(sql: str, params: dict | None = None) -> pd.DataFrame:
    """Run a query and return a DataFrame."""
    from sqlalchemy import text
    with _engine().connect() as con:
        return pd.read_sql(text(sql), con, params=params or {})


def q_readonly(sql: str, timeout_ms: int = 8000) -> pd.DataFrame:
    """Run an UNTRUSTED SELECT in a READ ONLY transaction with a statement
    timeout. Used by the AI assistant. SET LOCAL keeps the timeout scoped to the
    transaction so the pooled connection is never left mutated; READ ONLY makes
    any write fail at the database level even if validation is bypassed."""
    from sqlalchemy import text
    with _engine().connect() as con:
        trans = con.begin()
        try:
            con.execute(text("SET TRANSACTION READ ONLY"))
            con.execute(text(f"SET LOCAL statement_timeout = {int(timeout_ms)}"))
            df = pd.read_sql(text(sql), con)
            return df
        finally:
            trans.rollback()


def execute(sql: str, params: dict | None = None):
    """Run a write statement (INSERT/UPDATE/DDL) on the write connection."""
    if not has_write():
        raise RuntimeError("No write connection. Set DATABASE_URL_WRITE in backend/.env")
    from sqlalchemy import text
    with _engine_write().begin() as con:
        con.execute(text(sql), params or {})


def q_write(sql: str, params: dict | None = None) -> pd.DataFrame:
    """SELECT via the write connection (used to read a freshly-written table)."""
    from sqlalchemy import text
    eng = _engine_write() if has_write() else _engine()
    with eng.connect() as con:
        return pd.read_sql(text(sql), con, params=params or {})


def ping() -> dict:
    try:
        df = q("select 1 as ok")
        return {"connected": True, "result": int(df.iloc[0]["ok"])}
    except Exception as e:  # noqa
        return {"connected": False, "error": str(e)[:300]}
