import json
import datetime
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session
from typing import Optional
from openai import OpenAI
from memolink_backend.core.security import get_current_user
from memolink_backend.core.db import get_db
from memolink_backend.domain.models.reminder import Reminder
from memolink_backend.di.request_container import get_request_container, RequestContainer
from memolink_backend.core.config import settings

router = APIRouter(prefix="/reminders", tags=["reminders"])


def _serialize(r: Reminder) -> dict:
    return {
        "id": r.id, "text": r.text, "description": r.description,
        "type": r.type, "done": r.done,
        "due_date": r.due_date, "due_time": r.due_time,
        "email_record_id": getattr(r, "email_record_id", None),
        "recurrence_rule": getattr(r, "recurrence_rule", None),
        "end_time": getattr(r, "end_time", None),
        "all_day": getattr(r, "all_day", False),
        "source": "google" if getattr(r, "google_event_id", None) else "local",
    }


class CreateReminderRequest(BaseModel):
    text: str
    description: Optional[str] = None
    due_date: Optional[str] = None
    due_time: Optional[str] = None
    end_time: Optional[str] = None
    all_day: Optional[bool] = None
    recurrence_rule: Optional[str] = None
    workspace_id: Optional[int] = None


class UpdateReminderRequest(BaseModel):
    done: Optional[bool] = None
    text: Optional[str] = None
    description: Optional[str] = None
    due_date: Optional[str] = None
    due_time: Optional[str] = None
    end_time: Optional[str] = None
    all_day: Optional[bool] = None
    recurrence_rule: Optional[str] = None
    clear_recurrence: Optional[bool] = None


@router.get("")
def list_reminders(
    user_id: int = Depends(get_current_user),
    workspace_id: Optional[int] = None,
    db: Session = Depends(get_db),
):
    from sqlalchemy import or_
    q = db.query(Reminder).filter(Reminder.user_id == user_id)
    if workspace_id is not None:
        q = q.filter(or_(Reminder.workspace_id == workspace_id, Reminder.workspace_id == None))
    return [_serialize(r) for r in q.order_by(Reminder.created_at.desc()).all()]


@router.post("")
async def create_reminder(
    req: CreateReminderRequest,
    user_id: int = Depends(get_current_user),
    db: Session = Depends(get_db),
    container: RequestContainer = Depends(get_request_container),
):
    reminder = Reminder(
        user_id=user_id,
        workspace_id=req.workspace_id,
        text=req.text,
        description=req.description or None,
        type="manual",
        done=False,
        due_date=req.due_date or None,
        due_time=req.due_time or None,
        end_time=req.end_time or None,
        all_day=bool(req.all_day),
        recurrence_rule=req.recurrence_rule or None,
    )
    db.add(reminder)
    db.commit()
    db.refresh(reminder)
    container.evaluation().mark_task(user_id, "create_reminder", "Generate / create a reminder",
                                     "reminder", "reminder", reminder.id)
    await container.calendar().sync_to_google(user_id, reminder)
    return _serialize(reminder)


@router.patch("/{reminder_id}")
async def update_reminder(
    reminder_id: int,
    req: UpdateReminderRequest,
    user_id: int = Depends(get_current_user),
    db: Session = Depends(get_db),
    container: RequestContainer = Depends(get_request_container),
):
    reminder = db.query(Reminder).filter(Reminder.id == reminder_id, Reminder.user_id == user_id).first()
    if not reminder:
        raise HTTPException(status_code=404, detail="Reminder not found")
    if req.done is not None:
        reminder.done = req.done
    if req.text is not None:
        reminder.text = req.text
    if req.description is not None:
        reminder.description = req.description or None
    if req.due_date is not None:
        reminder.due_date = req.due_date or None
    if req.due_time is not None:
        reminder.due_time = req.due_time or None
    if req.end_time is not None:
        reminder.end_time = req.end_time or None
    if req.all_day is not None:
        reminder.all_day = req.all_day
    if req.clear_recurrence:
        reminder.recurrence_rule = None
    elif req.recurrence_rule is not None:
        reminder.recurrence_rule = req.recurrence_rule or None
    db.commit()
    await container.calendar().sync_to_google(user_id, reminder)
    return _serialize(reminder)


class DetectReminderRequest(BaseModel):
    message: str


@router.post("/detect")
def detect_reminder_from_message(
    req: DetectReminderRequest,
    user_id: int = Depends(get_current_user),
):
    today = datetime.date.today().isoformat()
    client = OpenAI(api_key=settings.openai_api_key)
    try:
        resp = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {
                    "role": "system",
                    "content": (
                        f"Today is {today}. You are a smart reminder assistant. "
                        "Given a chat message, decide if it describes a concrete task, event, or deadline the user needs to remember. "
                        "Ignore vague or purely informational messages. "
                        "If a reminder is warranted, rewrite the task as a short, clear, grammatically correct reminder title in title case "
                        "(e.g. 'Attend Anime Watching Meeting', 'Submit Assignment', 'Call Doctor'). "
                        "Also extract due_date (YYYY-MM-DD, resolved from relative words like 'tomorrow' using today's date) and due_time (HH:MM 24h), both nullable. "
                        'Respond ONLY with JSON: {"detected": true/false, "text": "...", "due_date": null, "due_time": null}'
                    ),
                },
                {"role": "user", "content": req.message},
            ],
            max_tokens=120,
            temperature=0,
            response_format={"type": "json_object"},
        )
        result = json.loads(resp.choices[0].message.content)
        return {
            "detected": bool(result.get("detected")),
            "text": result.get("text") or None,
            "due_date": result.get("due_date") or None,
            "due_time": result.get("due_time") or None,
        }
    except Exception:
        return {"detected": False, "text": None, "due_date": None, "due_time": None}


@router.delete("/{reminder_id}")
async def delete_reminder(
    reminder_id: int,
    user_id: int = Depends(get_current_user),
    db: Session = Depends(get_db),
    container: RequestContainer = Depends(get_request_container),
):
    reminder = db.query(Reminder).filter(Reminder.id == reminder_id, Reminder.user_id == user_id).first()
    if not reminder:
        raise HTTPException(status_code=404, detail="Reminder not found")
    await container.calendar().sync_to_google(user_id, reminder, deleted=True)
    db.delete(reminder)
    db.commit()
    return {"ok": True}
