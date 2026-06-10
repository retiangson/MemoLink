from sqlalchemy import Column, Integer, String, Text, DateTime, Boolean, Float, func, ForeignKey
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

    # Core Memory columns — extend the notes table rather than a separate system
    is_core_memory = Column(Boolean, default=False, nullable=True, index=True)
    is_encrypted = Column(Boolean, default=False, nullable=True)
    memory_type = Column(String(50), nullable=True)          # person, contact, project, card, credential, preference, general
    sensitivity_level = Column(String(20), nullable=True)    # low, medium, high
    encrypted_content = Column(Text, nullable=True)          # Fernet-encrypted plaintext (never sent to LLM)
    masked_content = Column(Text, nullable=True)             # Display-safe mask e.g. "Card ending ****1234"
    searchable_content = Column(Text, nullable=True)         # Safe plaintext metadata for embeddings
    memory_source = Column(String(30), nullable=True)        # ai_detected | manual
    memory_confidence = Column(Float, nullable=True)
    memory_last_used_at = Column(DateTime(timezone=True), nullable=True)
    memory_locked = Column(Boolean, default=True, nullable=True)
    memory_created_by = Column(String(100), nullable=True)   # model name or "user"
    memory_updated_at = Column(DateTime(timezone=True), nullable=True)

    embedding = relationship(
        "Embedding",
        back_populates="note",
        uselist=False,
        cascade="all, delete",
    )
    user = relationship("User")
