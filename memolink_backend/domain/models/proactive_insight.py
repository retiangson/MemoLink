from sqlalchemy import Column, Integer, String, Text, Boolean, DateTime, ForeignKey, func
from memolink_backend.core.db import Base


class ProactiveInsight(Base):
    """
    Stores AI-generated proactive alerts surfaced from note content analysis.

    insight_type values:
        missing_reminder  - note mentions a deadline/date but no reminder exists for it
        incomplete_actions - note contains TODOs or action items that are untracked
        unreviewed_upload  - recently uploaded file/recording with no follow-up activity
        urgency_signal     - note uses urgent/time-critical language

    severity values: info | warning | urgent
    """
    __tablename__ = "proactive_insights"

    id           = Column(Integer, primary_key=True, index=True)
    user_id      = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    workspace_id = Column(Integer, ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=True, index=True)
    insight_type = Column(String(50), nullable=False)
    title        = Column(String(500), nullable=False)
    description  = Column(Text, nullable=True)
    note_id      = Column(Integer, ForeignKey("notes.id", ondelete="CASCADE"), nullable=True)
    severity     = Column(String(20), nullable=False, default="info")
    is_dismissed = Column(Boolean, nullable=False, default=False)
    created_at   = Column(DateTime(timezone=True), server_default=func.now())
