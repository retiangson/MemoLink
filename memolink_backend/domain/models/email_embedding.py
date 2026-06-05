from sqlalchemy import Column, Integer, ForeignKey
from memolink_backend.core.db import Base
from memolink_backend.domain.models.vector_type import VectorType


class EmailEmbedding(Base):
    __tablename__ = "email_embeddings"

    id = Column(Integer, primary_key=True, index=True)
    email_record_id = Column(Integer, ForeignKey("email_records.id", ondelete="CASCADE"), unique=True)
    vector = Column(VectorType(1536))
