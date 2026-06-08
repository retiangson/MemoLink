from __future__ import annotations

from typing import Optional

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
