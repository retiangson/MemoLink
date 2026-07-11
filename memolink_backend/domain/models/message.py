from sqlalchemy import Column, Integer, String, Text, ForeignKey, DateTime, JSON, func
from sqlalchemy.orm import relationship
from memolink_backend.core.db import Base


class Message(Base):
    __tablename__ = "messages"

    id = Column(Integer, primary_key=True)
    conversation_id = Column(Integer, ForeignKey("conversations.id", ondelete="CASCADE"))
    role = Column(String(20))
    content = Column(Text)
    model             = Column(String(100), nullable=True)
    confidence        = Column(String(20),  nullable=True)   # HIGH | MEDIUM | LOW | UNSUPPORTED
    confidence_reason = Column(Text,        nullable=True)   # one-sentence explanation from LLM
    source_note_ids   = Column(JSON,        nullable=True)   # [{note_id, title, snippet}, ...] used for this reply
    created_at        = Column(DateTime(timezone=True), server_default=func.now())

    conversation = relationship("Conversation", back_populates="messages")
