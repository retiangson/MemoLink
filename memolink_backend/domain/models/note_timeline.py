from sqlalchemy import Column, Integer, Text, ForeignKey, TIMESTAMP, JSON
from sqlalchemy.sql import func
from memolink_backend.core.db import Base


class NoteTimeline(Base):
    __tablename__ = "note_timelines"

    id                          = Column(Integer, primary_key=True, index=True)
    note_id                     = Column(Integer, ForeignKey("notes.id", ondelete="CASCADE"), nullable=False, unique=True, index=True)
    user_id                     = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    summary                     = Column(Text, nullable=True)
    chapters                    = Column(JSON, nullable=False, default=list)
    action_items                = Column(JSON, nullable=False, default=list)
    important_moments           = Column(JSON, nullable=False, default=list)
    estimated_duration_seconds  = Column(Integer, nullable=True)
    word_count                  = Column(Integer, nullable=True)
    generated_at                = Column(TIMESTAMP(timezone=True), server_default=func.now())
