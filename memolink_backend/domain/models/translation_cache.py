from datetime import datetime, timezone
from sqlalchemy import Column, Integer, String, Text, DateTime
from memolink_backend.core.db import Base


class TranslationCache(Base):
    __tablename__ = "translation_cache"

    id = Column(Integer, primary_key=True, index=True)
    text_hash = Column(String(64), unique=True, nullable=False, index=True)
    source_text = Column(Text, nullable=False)
    target_language = Column(String(100), nullable=False)
    translation = Column(Text, nullable=False)
    accuracy = Column(Integer, nullable=True)
    model = Column(String(100), nullable=False)
    hit_count = Column(Integer, nullable=False, default=0)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False)
    updated_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc), nullable=False)
