from sqlalchemy import Column, Integer, String, Text, DateTime, Boolean, func, ForeignKey
from sqlalchemy.orm import relationship
from memolink_backend.core.db import Base


class Note(Base):
    __tablename__ = "notes"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    workspace_id = Column(Integer, ForeignKey("workspaces.id", ondelete="SET NULL"), nullable=True, index=True)
    title = Column(String(255), nullable=True)
    content = Column(Text, nullable=False)
    source = Column(String(255), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    deleted_at = Column(DateTime(timezone=True), nullable=True)

    # Undo snapshot columns (populated by slash commands that modify note content)
    undo_title = Column(Text, nullable=True)
    undo_content = Column(Text, nullable=True)
    undo_command = Column(String(50), nullable=True)
    undo_instruction = Column(Text, nullable=True)
    undo_created_at = Column(DateTime(timezone=True), nullable=True)
    undo_available = Column(Boolean, default=False, nullable=True)

    embedding = relationship(
        "Embedding",
        back_populates="note",
        uselist=False,
        cascade="all, delete",
    )
    user = relationship("User")
