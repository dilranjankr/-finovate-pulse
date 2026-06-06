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


def database_url() -> str:
    if not _RAW:
        return ""
    url = _RAW
    if url.startswith("postgres://"):
        url = "postgresql://" + url[len("postgres://"):]
    if url.startswith("postgresql://"):
        url = "postgresql+psycopg://" + url[len("postgresql://"):]
    return url


def has_db() -> bool:
    return bool(_RAW)


@lru_cache(maxsize=1)
def _engine():
    from sqlalchemy import create_engine
    return create_engine(database_url(), pool_pre_ping=True, pool_recycle=300)


def q(sql: str, params: dict | None = None) -> pd.DataFrame:
    """Run a query and return a DataFrame."""
    from sqlalchemy import text
    with _engine().connect() as con:
        return pd.read_sql(text(sql), con, params=params or {})


def ping() -> dict:
    try:
        df = q("select 1 as ok")
        return {"connected": True, "result": int(df.iloc[0]["ok"])}
    except Exception as e:  # noqa
        return {"connected": False, "error": str(e)[:300]}
