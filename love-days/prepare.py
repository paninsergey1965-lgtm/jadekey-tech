import base64
import json
import os
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import urlencode
from urllib.request import Request, urlopen

root = Path(__file__).resolve().parent
calendar = json.loads((root / "calendar.json").read_text())
messages = json.loads((root / "messages.json").read_text())
tomorrow = datetime.now(timezone(timedelta(hours=3))).date() + timedelta(days=1)
# Repair a missing current card first, then keep tomorrow available for preview.
for day in (tomorrow - timedelta(days=1), tomorrow):
    if any(row["date"] == day.isoformat() for row in calendar):
        continue
    offset = (day - date(2026, 11, 26)).days
    if offset < 0:
        continue
    token_url = os.environ["ACTIONS_ID_TOKEN_REQUEST_URL"]
    query = urlencode({"audience": "jadekey-love-calendar"})
    req = Request(token_url + ("&" if "?" in token_url else "?") + query,
                  headers={"Authorization": "Bearer " + os.environ["ACTIONS_ID_TOKEN_REQUEST_TOKEN"]})
    with urlopen(req, timeout=20) as response:
        token = json.load(response)["value"]
    payload = {"text": messages[offset] if offset < len(messages) else "",
               "recent": [r["text"] for r in calendar[-20:]],
               "reference": base64.b64encode((root / "reference.jpg").read_bytes()).decode()}
    req = Request("https://jadekey-love-single-test-production.up.railway.app/generate",
                  data=json.dumps(payload).encode(), headers={"Authorization": "Bearer " + token,
                  "Content-Type": "application/json"})
    with urlopen(req, timeout=230) as response:
        result = json.load(response)
    image = base64.b64decode(result["image"], validate=True)
    if not image.startswith(b"\xff\xd8") or not image.endswith(b"\xff\xd9"):
        raise ValueError("Incomplete card image")
    (root / "cards" / (day.isoformat() + ".jpg")).write_bytes(image)
    calendar.append({"date": day.isoformat(), "text": result["text"]})
    calendar.sort(key=lambda r: r["date"])
    (root / "calendar.json").write_text(json.dumps(calendar, ensure_ascii=False, indent=2) + "\n")
    break
