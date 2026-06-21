from __future__ import annotations

from typing import Optional

from sqlalchemy import or_
from sqlalchemy.orm import Session

from memolink_backend.domain.models.reminder import Reminder


class ReminderRepository:
    def __init__(self, db: Session):
        self.db = db

    def create_reminder(
        self,
        user_id: int,
        text: str,
        workspace_id: Optional[int] = None,
        description: Optional[str] = None,
        reminder_type: str = "manual",
        due_date: Optional[str] = None,
        due_time: Optional[str] = None,
        email_record_id: Optional[int] = None,
    ) -> Reminder:
        reminder = Reminder(
            user_id=user_id,
            workspace_id=workspace_id,
            text=text,
            description=description,
            type=reminder_type,
            due_date=due_date,
            due_time=due_time,
            email_record_id=email_record_id,
        )
        self.db.add(reminder)
        self.db.commit()
        self.db.refresh(reminder)
        return reminder

    def list_all(self, user_id: int, workspace_id: Optional[int] = None) -> list[Reminder]:
        q = self.db.query(Reminder).filter(Reminder.user_id == user_id)
        if workspace_id is not None:
            q = q.filter(or_(Reminder.workspace_id == workspace_id, Reminder.workspace_id == None))  # noqa: E711
        return q.order_by(Reminder.created_at.desc()).all()

    def get_by_id(self, user_id: int, reminder_id: int) -> Optional[Reminder]:
        return self.db.query(Reminder).filter(Reminder.id == reminder_id, Reminder.user_id == user_id).first()

    def get_by_google_event_id(self, user_id: int, google_event_id: str) -> Optional[Reminder]:
        return self.db.query(Reminder).filter(
            Reminder.user_id == user_id, Reminder.google_event_id == google_event_id
        ).first()

    def create_event(self, user_id: int, **fields) -> Reminder:
        reminder = Reminder(user_id=user_id, **fields)
        self.db.add(reminder)
        self.db.commit()
        self.db.refresh(reminder)
        return reminder

    def update_fields(self, reminder: Reminder, **fields) -> Reminder:
        for key, value in fields.items():
            setattr(reminder, key, value)
        self.db.commit()
        self.db.refresh(reminder)
        return reminder

    def delete(self, reminder: Reminder) -> None:
        self.db.delete(reminder)
        self.db.commit()
