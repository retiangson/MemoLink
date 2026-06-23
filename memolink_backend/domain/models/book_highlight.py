from sqlalchemy import Column, Integer, String, Text, DateTime, ForeignKey, func
from memolink_backend.core.db import Base


class BookHighlight(Base):
    __tablename__ = "book_highlights"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    book_id = Column(Integer, ForeignKey("books.id", ondelete="CASCADE"), nullable=False, index=True)
    note_id = Column(Integer, ForeignKey("notes.id", ondelete="CASCADE"), nullable=False)
    format = Column(String(10), nullable=False)
    page_number = Column(Integer, nullable=False)
    start_offset = Column(Integer, nullable=False)
    end_offset = Column(Integer, nullable=False)
    snippet = Column(Text, nullable=False)
    color = Column(String(20), nullable=False, server_default="yellow")
    created_at = Column(DateTime(timezone=True), server_default=func.now())
