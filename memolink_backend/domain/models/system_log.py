from datetime import datetime, timezone
from sqlalchemy import Column, Integer, String, DateTime, JSON
from memolink_backend.core.db import Base


class SystemLog(Base):
    __tablename__ = "system_logs"

    id = Column(Integer, primary_key=True, index=True)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False)
    level = Column(String(10), nullable=False)   # INFO | WARNING | ERROR
    source = Column(String(100), nullable=False)  # e.g. "video.upload", "auth.login"
    message = Column(String, nullable=False)
    details = Column(JSON, nullable=True)
    user_id = Column(Integer, nullable=True)
