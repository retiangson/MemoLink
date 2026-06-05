import json
import re
from datetime import date, timedelta
from typing import Optional
from fastapi import APIRouter, Depends
from pydantic import BaseModel
from openai import OpenAI
from sqlalchemy.orm import Session
from memolink_backend.core.security import get_current_user
from memolink_backend.core.config import settings
from memolink_backend.core.db import get_db
from memolink_backend.domain.models.reminder import Reminder

_HTML_TAG = re.compile(r"<[^>]+>")


def _normalize_date(val: str) -> Optional[str]:
    """Normalize various date formats to YYYY-MM-DD. Returns None if unparseable."""
    val = val.strip()
    if re.match(r"^\d{4}-\d{2}-\d{2}$", val):
        return val
    # DD-MM-YYYY or DD/MM/YYYY
    m = re.match(r"^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$", val)
    if m:
        day, month, year = m.groups()
        return f"{year}-{month.zfill(2)}-{day.zfill(2)}"
    return None


def _normalize_time(val: str) -> Optional[str]:
    """Normalize various time formats to 24-hour HH:MM. Returns None if unparseable."""
    val = val.strip()
    # Already HH:MM
    if re.match(r"^\d{2}:\d{2}$", val):
        return val
    # HH:MM:SS → strip seconds
    m = re.match(r"^(\d{2}):(\d{2}):\d{2}$", val)
    if m:
        return f"{m.group(1)}:{m.group(2)}"
    # 11:00 PM / 11:00 AM
    m = re.match(r"^(\d{1,2}):(\d{2})\s*(AM|PM)$", val, re.IGNORECASE)
    if m:
        h, mn, ampm = int(m.group(1)), m.group(2), m.group(3).upper()
        if ampm == "PM" and h != 12:
            h += 12
        elif ampm == "AM" and h == 12:
            h = 0
        return f"{h:02d}:{mn}"
    # 11PM / 11AM
    m = re.match(r"^(\d{1,2})\s*(AM|PM)$", val, re.IGNORECASE)
    if m:
        h, ampm = int(m.group(1)), m.group(2).upper()
        if ampm == "PM" and h != 12:
            h += 12
        elif ampm == "AM" and h == 12:
            h = 0
        return f"{h:02d}:00"
    # H:MM without AM/PM - treat as 24-hour
    m = re.match(r"^(\d{1,2}):(\d{2})$", val)
    if m:
        return f"{int(m.group(1)):02d}:{m.group(2)}"
    return None

router = APIRouter(prefix="/suggest", tags=["suggest"])

class SuggestRequest(BaseModel):
    title: str = ""
    content: str
    workspace_id: Optional[int] = None


def _normalise(text: str) -> str:
    return re.sub(r"\s+", " ", text.lower()).strip()


def _word_overlap(a: str, b: str) -> float:
    wa = set(re.findall(r"\w+", a))
    wb = set(re.findall(r"\w+", b))
    if not wa or not wb:
        return 0.0
    return len(wa & wb) / min(len(wa), len(wb))


@router.post("")
async def suggest(
    req: SuggestRequest,
    user_id: int = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    clean_content = _HTML_TAG.sub(" ", req.content)
    clean_content = re.sub(r"\s+", " ", clean_content).strip()
    if not clean_content:
        return {"suggestions": []}

    q = db.query(Reminder).filter(Reminder.user_id == user_id, Reminder.done == False)
    if req.workspace_id is not None:
        q = q.filter(Reminder.workspace_id == req.workspace_id)
    existing = q.all()
    existing_norms = [_normalise(r.text) for r in existing]

    today_str = date.today().isoformat()
    tomorrow_str = (date.today() + timedelta(days=1)).isoformat()

    client = OpenAI(api_key=settings.openai_api_key)
    response = client.chat.completions.create(
        model=settings.openai_chat_model,
        messages=[
            {
                "role": "system",
                "content": (
                    f"Today's date is {today_str}. Tomorrow is {tomorrow_str}.\n"
                    "You are a helpful productivity assistant. "
                    "Extract actionable reminders and tasks from the note. "
                    "Include: meetings, appointments, deadlines, and concrete tasks with a named subject (e.g. 'Update RA document', 'Fix DB issue'). "
                    "SKIP only truly generic filler like 'review your notes' or 'consider improving' - anything with a specific subject or action is worth keeping. "
                    f"Resolve relative dates ('today' = {today_str}, 'tomorrow' = {tomorrow_str}). "
                    "IMPORTANT: Always convert dates to YYYY-MM-DD format (e.g. DD-MM-YYYY '15-05-2026' → '2026-05-15'). "
                    "IMPORTANT: Always convert times to 24-hour HH:MM format (e.g. '11PM' → '23:00', '2:30 PM' → '14:30', '9 AM' → '09:00'). "
                    "For each suggestion, produce a short 'text' title (under 60 chars) and a 'description' with 1-2 sentences of context or detail from the note explaining why this task matters or what it involves. "
                    "Return JSON: {{\"suggestions\": [{{\"text\": \"...\", \"description\": \"...\", \"due_date\": \"YYYY-MM-DD or null\", \"due_time\": \"24-hour HH:MM or null\"}}]}}"
                ),
            },
            {
                "role": "user",
                "content": f"Title: {req.title or 'Untitled'}\n\nContent:\n{clean_content[:2000]}",
            },
        ],
        max_tokens=600,
        temperature=0.4,
        response_format={"type": "json_object"},
    )
    try:
        data = json.loads(response.choices[0].message.content)
        raw = data.get("suggestions", [])
        if not isinstance(raw, list):
            raw = []
    except Exception:
        raw = []

    saved = []
    for item in raw[:5]:
        if not isinstance(item, dict):
            continue
        text = str(item.get("text", "")).strip()
        description = str(item.get("description", "")).strip() or None
        raw_date = item.get("due_date")
        raw_time = item.get("due_time")
        due_date = _normalize_date(str(raw_date)) if isinstance(raw_date, str) and raw_date.strip() else None
        due_time = _normalize_time(str(raw_time)) if isinstance(raw_time, str) and raw_time.strip() else None
        if not text:
            continue

        # Skip only when an existing reminder is 80%+ word-overlap (exact duplicate)
        norm = _normalise(text)
        if any(_word_overlap(norm, ex) >= 0.8 for ex in existing_norms):
            continue

        reminder = Reminder(user_id=user_id, workspace_id=req.workspace_id, text=text, description=description, type="ai", done=False, due_date=due_date, due_time=due_time)
        db.add(reminder)
        db.flush()
        saved.append({"id": reminder.id, "text": text, "description": description, "due_date": due_date, "due_time": due_time})
        existing_norms.append(norm)

    if saved:
        db.commit()

    return {"suggestions": saved}
