"""
Sample organisation model (deterministic) used until Keka + ClickUp are connected.
Maps each Hubstaff user_id -> department, team/ATL, client, client type, pay rate.
Everything here is reproducible (crc32 of the user_id) so the dashboard is stable.
Replace by real Keka/ClickUp data later — the API shape stays the same.
"""
from zlib import crc32

DEPARTMENTS = ["Operations", "Accounting", "Audit & Assurance", "Tax", "Technology", "HR"]
INTERNAL_DEPTS = {"Technology", "HR"}  # non-billable cost centres

TEAMS = ["Alpha", "Bravo"]

CLIENTS = [
    "Acme Corp", "Brightline Inc", "Northwind Traders", "Vertex Labs",
    "Globex", "Summit Capital", "Pinewood Group", "Cobalt Health",
]
CLIENT_TYPE = {
    "Acme Corp": "Monthly", "Brightline Inc": "Fixed", "Northwind Traders": "Hourly",
    "Vertex Labs": "Monthly", "Globex": "Fixed", "Summit Capital": "Hourly",
    "Pinewood Group": "Monthly", "Cobalt Health": "Fixed",
}
DEFAULT_RATE = {  # USD / hr fallback when Hubstaff pay_rate is blank
    "Operations": 35, "Accounting": 45, "Audit & Assurance": 55,
    "Tax": 50, "Technology": 40, "HR": 30,
}


def _h(uid: str, salt: str = "") -> int:
    return crc32((salt + str(uid)).encode())


def assign(uid: str):
    dept = DEPARTMENTS[_h(uid) % len(DEPARTMENTS)]
    team = TEAMS[_h(uid, "t") % len(TEAMS)]
    atl = f"{dept} · {team}"
    client = CLIENTS[_h(uid, "c") % len(CLIENTS)]
    ctype = CLIENT_TYPE[client]
    billable = dept not in INTERNAL_DEPTS
    task_completion = 55 + (_h(uid, "tc") % 41)  # 55..95 %
    # deterministic live status weighted toward active
    s = _h(uid, "s") % 100
    status = "Active" if s < 55 else ("Idle" if s < 80 else "Offline")
    return {
        "department": dept, "team": team, "atl": atl,
        "client": client, "client_type": ctype,
        "billable": billable, "task_completion": task_completion,
        "status": status,
    }


def default_rate(dept: str) -> float:
    return DEFAULT_RATE.get(dept, 40)
