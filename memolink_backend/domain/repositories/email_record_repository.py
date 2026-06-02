from typing import Optional
from sqlalchemy.orm import Session
from memolink_backend.domain.models.email_record import EmailRecord


class EmailRecordRepository:
    def __init__(self, db: Session):
        self.db = db

    def exists(self, user_id: int, gmail_message_id: str) -> bool:
        return self.db.query(EmailRecord).filter(
            EmailRecord.user_id == user_id,
            EmailRecord.gmail_message_id == gmail_message_id,
        ).first() is not None

    def create(self, **kwargs) -> EmailRecord:
        row = EmailRecord(**kwargs)
        self.db.add(row)
        self.db.commit()
        self.db.refresh(row)
        return row

    def list_by_user(self, user_id: int, limit: int = 50) -> list[EmailRecord]:
        return (
            self.db.query(EmailRecord)
            .filter(EmailRecord.user_id == user_id)
            .order_by(EmailRecord.importance_score.desc(), EmailRecord.email_date.desc())
            .limit(limit)
            .all()
        )

    def get_by_id(self, user_id: int, record_id: int) -> Optional[EmailRecord]:
        return self.db.query(EmailRecord).filter(
            EmailRecord.id == record_id,
            EmailRecord.user_id == user_id,
        ).first()

    def delete_by_id(self, user_id: int, record_id: int) -> bool:
        deleted = self.db.query(EmailRecord).filter(
            EmailRecord.id == record_id,
            EmailRecord.user_id == user_id,
        ).delete()
        self.db.commit()
        return deleted > 0

    def list_unappended(self, user_id: int) -> list[EmailRecord]:
        """Return important emails not yet appended to the Email Digest note."""
        return (
            self.db.query(EmailRecord)
            .filter(
                EmailRecord.user_id == user_id,
                EmailRecord.note_appended == False,
                EmailRecord.importance_score >= 3.5,
            )
            .order_by(EmailRecord.email_date.asc())
            .all()
        )

    def mark_appended(self, record_ids: list[int]) -> None:
        if not record_ids:
            return
        self.db.query(EmailRecord).filter(EmailRecord.id.in_(record_ids)).update(
            {"note_appended": True}, synchronize_session=False
        )
        self.db.commit()

    def delete_all_by_user(self, user_id: int) -> int:
        count = self.db.query(EmailRecord).filter(EmailRecord.user_id == user_id).delete()
        self.db.commit()
        return count
