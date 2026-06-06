"""
Gemini-powered assistant for Finovate Pulse.
Cheap + good: defaults to gemini-2.0-flash. Override with GEMINI_MODEL.
Reads GEMINI_API_KEY from environment (loaded via db.py -> dotenv).
Returns the SAME shape the frontend renders: {text, kind, bars, donut}.
Falls back gracefully (returns {"ok": False}) when no key / network error,
so the frontend can use its local rule-based engine.
"""
import json
import os
import urllib.request
import urllib.error

DEFAULT_MODEL = "gemini-3.1-flash-lite"
PALETTE = ["#203070", "#0f9043", "#2f6fbf", "#d9882a", "#37a85f", "#bd8616", "#7b3fc0", "#0d9488"]
DONUT = ["#203070", "#0f9043", "#2f6fbf", "#d9882a", "#37a85f", "#bd8616"]

SCHEMA = {
    "type": "OBJECT",
    "properties": {
        "text": {"type": "STRING"},
        "chart_type": {"type": "STRING", "enum": ["bar", "donut", "none"]},
        "chart_data": {
            "type": "ARRAY",
            "items": {
                "type": "OBJECT",
                "properties": {"label": {"type": "STRING"}, "value": {"type": "NUMBER"}},
                "required": ["label", "value"],
                "propertyOrdering": ["label", "value"],
            },
        },
    },
    "required": ["text", "chart_type"],
    "propertyOrdering": ["text", "chart_type", "chart_data"],
}

SYSTEM = (
    "You are 'Pulse AI', the assistant inside Finovate's Operations Command Center. "
    "You can chat naturally about anything, but your specialty is the live operations data given to you "
    "as JSON CONTEXT (employees, teams, clients, hours, utilization, activity, productivity, grades, tasks, health). "
    "Rules:\n"
    "- For questions about the business/data, answer ONLY from the CONTEXT. Never invent numbers. "
    "If the context lacks something, say so briefly.\n"
    "- 'text' MUST be at most 2 short sentences. Be concise. Use real names/numbers from context. "
    "Never write long explanations or repeat yourself.\n"
    "- ALWAYS include a chart whenever the answer involves comparing two or more items, a ranking "
    "(top/bottom/highest/lowest/best/worst), a breakdown, a mix, or any distribution. Default to showing a chart; "
    "only skip it for pure greetings or single-number facts. Use 'bar' for rankings/comparisons and 'donut' for "
    "parts-of-a-whole / mix. Provide 3-10 chart_data points sorted most-relevant first, with values taken straight "
    "from the context. The chart must visualize the SAME items your text discusses.\n"
    "- For greetings, small talk or non-data questions, answer in text and set chart_type to 'none'.\n"
    "- Currency is not tracked; do not discuss revenue or money."
)


def _to_frontend(obj: dict) -> dict:
    text = (obj.get("text") or "").strip() or "Here's what I found."
    ctype = obj.get("chart_type") or "none"
    rows = obj.get("chart_data") or []
    rows = [r for r in rows if isinstance(r, dict) and r.get("label") is not None][:10]
    if ctype == "bar" and rows:
        bars = [{"label": str(r["label"]), "value": float(r.get("value") or 0),
                 "color": PALETTE[i % len(PALETTE)]} for i, r in enumerate(rows)]
        return {"ok": True, "text": text, "kind": "bar", "bars": bars}
    if ctype == "donut" and rows:
        data = [{"name": str(r["label"]), "value": float(r.get("value") or 0)} for r in rows]
        total = sum(d["value"] for d in data)
        tot_s = (f"{round(total):,}") if total else "0"
        return {"ok": True, "text": text, "kind": "donut",
                "donut": {"data": data, "colors": DONUT,
                          "center": {"value": tot_s, "label": "Total"}}}
    return {"ok": True, "text": text, "kind": "none"}


def answer(question: str, context: dict) -> dict:
    key = os.environ.get("GEMINI_API_KEY", "").strip()
    if not key:
        return {"ok": False, "reason": "no_key"}
    model = os.environ.get("GEMINI_MODEL", "").strip() or DEFAULT_MODEL
    url = (f"https://generativelanguage.googleapis.com/v1beta/models/"
           f"{model}:generateContent?key={key}")
    prompt = (
        f"CONTEXT (live operations data as JSON):\n{json.dumps(context, ensure_ascii=False)}\n\n"
        f"USER QUESTION:\n{question}"
    )
    body = {
        "systemInstruction": {"parts": [{"text": SYSTEM}]},
        "contents": [{"role": "user", "parts": [{"text": prompt}]}],
        "generationConfig": {
            "temperature": 0.3,
            "maxOutputTokens": 2048,
            "responseMimeType": "application/json",
            "responseSchema": SCHEMA,
            # Disable "thinking" tokens: cheaper, faster, and avoids the model
            # spending the output budget on reasoning and truncating the JSON.
            "thinkingConfig": {"thinkingBudget": 0},
        },
    }
    req = urllib.request.Request(
        url, data=json.dumps(body).encode("utf-8"),
        headers={"Content-Type": "application/json"}, method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=25) as resp:
            payload = json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        detail = e.read().decode("utf-8", "ignore")[:300]
        return {"ok": False, "reason": f"http_{e.code}", "detail": detail}
    except Exception as e:  # noqa: BLE001
        return {"ok": False, "reason": "network", "detail": str(e)[:200]}
    try:
        cand = payload["candidates"][0]
        parts = cand.get("content", {}).get("parts", [])
        raw = "".join(p.get("text", "") for p in parts if isinstance(p, dict) and p.get("text"))
    except Exception:  # noqa: BLE001
        return {"ok": False, "reason": "parse"}
    obj = _parse_json(raw)
    if obj is None:
        return {"ok": False, "reason": "parse"}
    return _to_frontend(obj)


def _parse_json(raw: str):
    """Tolerant JSON parse: strips markdown fences and repairs truncated output."""
    s = (raw or "").strip()
    if s.startswith("```"):
        s = s.split("```", 2)[1] if s.count("```") >= 2 else s.strip("`")
        if s.lstrip().lower().startswith("json"):
            s = s.lstrip()[4:]
    s = s.strip()
    try:
        return json.loads(s)
    except Exception:  # noqa: BLE001
        pass
    # Truncated? keep only the first balanced {...} object.
    start = s.find("{")
    if start == -1:
        return None
    depth, instr, esc = 0, False, False
    for i in range(start, len(s)):
        ch = s[i]
        if instr:
            if esc:
                esc = False
            elif ch == "\\":
                esc = True
            elif ch == '"':
                instr = False
            continue
        if ch == '"':
            instr = True
        elif ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                try:
                    return json.loads(s[start:i + 1])
                except Exception:  # noqa: BLE001
                    return None
    return None
