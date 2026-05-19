import json
import re
from datetime import date, timedelta
from fastapi import APIRouter, Depends
from pydantic import BaseModel
from openai import OpenAI
from sqlalchemy.orm import Session
from memolink_backend.core.security import get_current_user
from memolink_backend.core.config import settings
from memolink_backend.core.db import get_db
from memolink_backend.domain.models.reminder import Reminder

router = APIRouter(prefix="/suggest", tags=["suggest"])

class SuggestRequest(BaseModel):
    title: str = ""
    content: str


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
    if not req.content.strip():
        return {"suggestions": []}

    existing = db.query(Reminder).filter(
        Reminder.user_id == user_id, Reminder.done == False
    ).all()
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
                    "SKIP only truly generic filler like 'review your notes' or 'consider improving' — anything with a specific subject or action is worth keeping. "
                    f"Resolve relative dates ('today' = {today_str}, 'tomorrow' = {tomorrow_str}). "
                    "Parse DD-MM-YYYY and DD/MM/YYYY as YYYY-MM-DD. "
                    "Return JSON: {{\"suggestions\": [{{\"text\": \"...\", \"due_date\": \"YYYY-MM-DD or null\", \"due_time\": \"HH:MM or null\"}}]}}"
                ),
            },
            {
                "role": "user",
                "content": f"Title: {req.title or 'Untitled'}\n\nContent:\n{req.content[:2000]}",
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
        due_date = item.get("due_date") or None
        due_time = item.get("due_time") or None
        if isinstance(due_date, str) and not due_date.strip():
            due_date = None
        if isinstance(due_time, str) and not due_time.strip():
            due_time = None
        if not text:
            continue

        # Skip only when an existing reminder is 80%+ word-overlap (exact duplicate)
        norm = _normalise(text)
        if any(_word_overlap(norm, ex) >= 0.8 for ex in existing_norms):
            continue

        reminder = Reminder(user_id=user_id, text=text, type="ai", done=False, due_date=due_date, due_time=due_time)
        db.add(reminder)
        db.flush()
        saved.append({"id": reminder.id, "text": text, "due_date": due_date, "due_time": due_time})
        existing_norms.append(norm)

    if saved:
        db.commit()

    return {"suggestions": saved}
