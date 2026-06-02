from sqlalchemy import Column, Integer, String, Text, DateTime, ForeignKey, UniqueConstraint, func
from memolink_backend.core.db import Base


class UserApiKey(Base):
    __tablename__ = "user_api_keys"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    provider = Column(String(100), nullable=False)   # user-defined name, e.g. "Groq", "My Ollama"
    encrypted_key = Column(Text, nullable=False)
    base_url = Column(Text, nullable=True)           # OpenAI-compatible endpoint, null = provider default
    model = Column(String(100), nullable=True)       # model ID to use with this provider
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    __table_args__ = (UniqueConstraint("user_id", "provider", name="uq_user_api_key_provider"),)
