from typing import Optional
from sqlalchemy.orm import Session
from sqlalchemy import text
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

    def save_embedding(self, email_record_id: int, vector: list[float]) -> None:
        vector_str = "[" + ",".join(str(v) for v in vector) + "]"
        self.db.execute(text("""
            INSERT INTO email_embeddings (email_record_id, vector)
            VALUES (:email_record_id, CAST(:vector AS vector))
            ON CONFLICT (email_record_id)
            DO UPDATE SET vector = EXCLUDED.vector
        """), {"email_record_id": email_record_id, "vector": vector_str})
        self.db.commit()

    def search_by_vector(self, query_vector: list[float], user_id: int, top_k: int = 3) -> list[EmailRecord]:
        embedding_str = "[" + ",".join(str(x) for x in query_vector) + "]"
        rows = self.db.execute(text("""
            SELECT r.id
            FROM email_embeddings e
            JOIN email_records r ON r.id = e.email_record_id
            WHERE r.user_id = :user_id
            ORDER BY e.vector <-> vector(:embedding)
            LIMIT :top_k
        """), {"embedding": embedding_str, "top_k": top_k, "user_id": user_id}).fetchall()
        record_ids = [r[0] for r in rows]
        if not record_ids:
            return []
        records = self.db.query(EmailRecord).filter(EmailRecord.id.in_(record_ids)).all()
        record_map = {r.id: r for r in records}
        return [record_map[rid] for rid in record_ids if rid in record_map]
