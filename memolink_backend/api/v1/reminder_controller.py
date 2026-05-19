from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session
from typing import Optional
from memolink_backend.core.security import get_current_user
from memolink_backend.core.db import get_db
from memolink_backend.domain.models.reminder import Reminder

router = APIRouter(prefix="/reminders", tags=["reminders"])


def _serialize(r: Reminder) -> dict:
    return {
        "id": r.id, "text": r.text, "type": r.type,
        "done": r.done, "due_date": r.due_date, "due_time": r.due_time,
    }


class CreateReminderRequest(BaseModel):
    text: str
    due_date: Optional[str] = None
    due_time: Optional[str] = None


class UpdateReminderRequest(BaseModel):
    done: bool


@router.get("")
def list_reminders(user_id: int = Depends(get_current_user), db: Session = Depends(get_db)):
    reminders = (
        db.query(Reminder)
        .filter(Reminder.user_id == user_id)
        .order_by(Reminder.created_at.desc())
        .all()
    )
    return [_serialize(r) for r in reminders]


@router.post("")
def create_reminder(
    req: CreateReminderRequest,
    user_id: int = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    reminder = Reminder(
        user_id=user_id,
        text=req.text,
        type="manual",
        done=False,
        due_date=req.due_date or None,
        due_time=req.due_time or None,
    )
    db.add(reminder)
    db.commit()
    db.refresh(reminder)
    return _serialize(reminder)


@router.patch("/{reminder_id}")
def update_reminder(
    reminder_id: int,
    req: UpdateReminderRequest,
    user_id: int = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    reminder = db.query(Reminder).filter(Reminder.id == reminder_id, Reminder.user_id == user_id).first()
    if not reminder:
        raise HTTPException(status_code=404, detail="Reminder not found")
    reminder.done = req.done
    db.commit()
    return {"id": reminder.id, "done": reminder.done}


@router.delete("/{reminder_id}")
def delete_reminder(
    reminder_id: int,
    user_id: int = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    reminder = db.query(Reminder).filter(Reminder.id == reminder_id, Reminder.user_id == user_id).first()
    if not reminder:
        raise HTTPException(status_code=404, detail="Reminder not found")
    db.delete(reminder)
    db.commit()
    return {"ok": True}
