from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session
from typing import Optional
from memolink_backend.core.security import get_current_user
from memolink_backend.core.db import get_db
from memolink_backend.domain.models.reminder import Reminder
from memolink_backend.di.request_container import get_request_container, RequestContainer

router = APIRouter(prefix="/reminders", tags=["reminders"])


def _serialize(r: Reminder) -> dict:
    return {
        "id": r.id, "text": r.text, "description": r.description,
        "type": r.type, "done": r.done,
        "due_date": r.due_date, "due_time": r.due_time,
        "email_record_id": getattr(r, "email_record_id", None),
    }


class CreateReminderRequest(BaseModel):
    text: str
    description: Optional[str] = None
    due_date: Optional[str] = None
    due_time: Optional[str] = None
    workspace_id: Optional[int] = None


class UpdateReminderRequest(BaseModel):
    done: Optional[bool] = None
    text: Optional[str] = None
    description: Optional[str] = None
    due_date: Optional[str] = None
    due_time: Optional[str] = None


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
def create_reminder(
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
    )
    db.add(reminder)
    db.commit()
    db.refresh(reminder)
    container.evaluation().mark_task(user_id, "create_reminder", "Generate / create a reminder",
                                     "reminder", "reminder", reminder.id)
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
    db.commit()
    return _serialize(reminder)


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
