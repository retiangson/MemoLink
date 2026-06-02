from sqlalchemy import Column, Integer, String, Text, Boolean, DateTime, ForeignKey, func
from memolink_backend.core.db import Base


class Reminder(Base):
    __tablename__ = "reminders"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    workspace_id = Column(Integer, ForeignKey("workspaces.id", ondelete="SET NULL"), nullable=True, index=True)
    text = Column(Text, nullable=False)           # short title
    description = Column(Text, nullable=True)     # optional longer detail
    type = Column(String(20), default="manual")   # "ai" | "manual"
    done = Column(Boolean, default=False)
    due_date = Column(String(50), nullable=True)  # ISO date string, e.g. "2026-05-19"
    due_time = Column(String(10), nullable=True)  # 24-h time string, e.g. "11:00"
    email_record_id = Column(Integer, ForeignKey("email_records.id", ondelete="SET NULL"), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
