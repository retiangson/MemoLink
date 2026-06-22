from sqlalchemy import Column, Integer, Float, String, DateTime, ForeignKey, UniqueConstraint, func
from memolink_backend.core.db import Base


class UserBook(Base):
    __tablename__ = "user_books"
    __table_args__ = (UniqueConstraint("user_id", "book_id", name="uq_user_books_user_book"),)

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    book_id = Column(Integer, ForeignKey("books.id", ondelete="CASCADE"), nullable=False, index=True)
    status = Column(String(20), nullable=False, default="borrowed", server_default="borrowed")  # borrowed|reading|completed|removed
    current_page = Column(Integer, nullable=False, default=0, server_default="0")
    total_pages = Column(Integer, nullable=True)
    progress_percent = Column(Float, nullable=False, default=0.0, server_default="0")
    borrowed_at = Column(DateTime(timezone=True), server_default=func.now())
    last_read_at = Column(DateTime(timezone=True), nullable=True)
    completed_at = Column(DateTime(timezone=True), nullable=True)
