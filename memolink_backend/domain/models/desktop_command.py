from sqlalchemy import Column, Integer, String, Text, DateTime, ForeignKey, func, JSON
from sqlalchemy.dialects.postgresql import JSONB
from memolink_backend.core.db import Base


class DesktopCommand(Base):
    __tablename__ = "desktop_commands"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    command_type = Column(String(50), nullable=False)   # mkdir, exec, write-file, list-dir, etc.
    payload = Column(JSON().with_variant(JSONB, "postgresql"), nullable=False)  # command-specific args
    status = Column(String(20), nullable=False, default="pending")  # pending | running | done | failed | expired
    result = Column(Text, nullable=True)                # JSON string with { ok, output, error }
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    executed_at = Column(DateTime(timezone=True), nullable=True)
    expires_at = Column(DateTime(timezone=True), nullable=True)
