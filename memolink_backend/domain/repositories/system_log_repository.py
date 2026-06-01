from typing import Optional
from sqlalchemy.orm import Session
from memolink_backend.domain.models.system_log import SystemLog


class SystemLogRepository:
    def __init__(self, db: Session):
        self._db = db

    def create(
        self,
        level: str,
        source: str,
        message: str,
        details: Optional[dict] = None,
        user_id: Optional[int] = None,
    ) -> SystemLog:
        entry = SystemLog(
            level=level,
            source=source,
            message=message,
            details=details,
            user_id=user_id,
        )
        self._db.add(entry)
        self._db.commit()
        self._db.refresh(entry)
        return entry

    def list(
        self,
        level: Optional[str] = None,
        source: Optional[str] = None,
        limit: int = 100,
        offset: int = 0,
    ) -> list[SystemLog]:
        q = self._db.query(SystemLog)
        if level:
            q = q.filter(SystemLog.level == level.upper())
        if source:
            q = q.filter(SystemLog.source.ilike(f"%{source}%"))
        return q.order_by(SystemLog.created_at.desc()).offset(offset).limit(limit).all()

    def count(
        self,
        level: Optional[str] = None,
        source: Optional[str] = None,
    ) -> int:
        q = self._db.query(SystemLog)
        if level:
            q = q.filter(SystemLog.level == level.upper())
        if source:
            q = q.filter(SystemLog.source.ilike(f"%{source}%"))
        return q.count()

    def clear(self) -> int:
        deleted = self._db.query(SystemLog).delete()
        self._db.commit()
        return deleted
