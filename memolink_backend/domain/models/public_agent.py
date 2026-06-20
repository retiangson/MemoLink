from sqlalchemy import Column, Integer, String, Text, Boolean, DateTime, ForeignKey, func
from memolink_backend.core.db import Base


class PublicAgent(Base):
    __tablename__ = "public_agents"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(120), nullable=False)
    # Hard-to-guess public identifier embedded in chat URLs/widget embeds. Never sequential.
    token = Column(String(64), unique=True, nullable=False, index=True)
    workspace_id = Column(Integer, ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False, index=True)
    description = Column(Text, nullable=True)
    system_prompt = Column(Text, nullable=True)
    # Master kill switch. Defaults closed — an agent row existing is not enough to serve traffic.
    public_enabled = Column(Boolean, default=False, nullable=False)
    # Comma-separated origins allowed to embed the widget, e.g. "https://ronald.dev,https://blog.ronald.dev".
    # Empty/NULL means "no restriction" (any origin) — left as an explicit opt-in restriction, not a default.
    allowed_domains = Column(Text, nullable=True)
    # Optional visitor-facing avatar. Stored as a data URL (base64), not a path/bucket key —
    # there is no static-file-serving route or object-storage service in this codebase, and
    # avatars are small, so embedding the image directly avoids standing up new infrastructure.
    avatar_url = Column(Text, nullable=True)
    created_by = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
