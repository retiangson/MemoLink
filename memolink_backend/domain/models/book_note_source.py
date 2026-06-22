from sqlalchemy import Column, Integer, Text, DateTime, ForeignKey, UniqueConstraint, func
from memolink_backend.core.db import Base


class BookNoteSource(Base):
    """Tracks the on-demand 'Save as Note Source' processing job for a (user, book) pair.
    Actual searchable content lives as ordinary Note rows (see BookNoteChunk), so the
    existing notes/embeddings vector search pipeline is reused instead of duplicated.
    """
    __tablename__ = "book_note_sources"
    __table_args__ = (UniqueConstraint("user_id", "book_id", name="uq_book_note_sources_user_book"),)

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    book_id = Column(Integer, ForeignKey("books.id", ondelete="CASCADE"), nullable=False, index=True)
    status = Column(Text, nullable=False, default="pending", server_default="pending")  # pending|processing|ready|failed
    error_message = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class BookNoteChunk(Base):
    """Links a generated Note (one per page-chunk) back to its book/page for citation display."""
    __tablename__ = "book_note_chunks"

    id = Column(Integer, primary_key=True, index=True)
    book_note_source_id = Column(Integer, ForeignKey("book_note_sources.id", ondelete="CASCADE"), nullable=False, index=True)
    note_id = Column(Integer, ForeignKey("notes.id", ondelete="CASCADE"), nullable=False, index=True)
    book_id = Column(Integer, ForeignKey("books.id", ondelete="CASCADE"), nullable=False, index=True)
    page_number = Column(Integer, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
