from sqlalchemy import Column, Integer, ForeignKey
from sqlalchemy.orm import relationship
from memolink_backend.core.db import Base
from memolink_backend.domain.models.vector_type import VectorType


class Embedding(Base):
    __tablename__ = "embeddings"

    id = Column(Integer, primary_key=True, index=True)
    note_id = Column(Integer, ForeignKey("notes.id", ondelete="CASCADE"), unique=True)
    vector = Column(VectorType(1536))

    note = relationship("Note", back_populates="embedding")
