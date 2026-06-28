from sqlalchemy import BigInteger, Boolean, Column, DateTime, Float, ForeignKey, Integer, JSON, String, Text, UniqueConstraint, func

from memolink_backend.core.db import Base


class SourceFile(Base):
    __tablename__ = "source_files"
    __table_args__ = (
        UniqueConstraint("user_id", "note_id", "onedrive_drive_id", "onedrive_item_id", name="uq_source_file_note_item"),
    )

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    workspace_id = Column(Integer, ForeignKey("workspaces.id", ondelete="SET NULL"), nullable=True, index=True)
    note_id = Column(Integer, ForeignKey("notes.id", ondelete="CASCADE"), nullable=False, index=True)
    source_type = Column(String(40), nullable=False)
    original_filename = Column(String(500), nullable=False)
    mime_type = Column(String(200), nullable=True)
    file_size = Column(BigInteger, nullable=True)
    onedrive_drive_id = Column(String(255), nullable=False)
    onedrive_item_id = Column(String(500), nullable=False)
    onedrive_web_url = Column(Text, nullable=True)
    onedrive_etag = Column(String(500), nullable=True)
    extraction_status = Column(String(30), nullable=False, default="pending", server_default="pending")
    cache_status = Column(String(30), nullable=False, default="unknown", server_default="unknown")
    last_synced_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    deleted_at = Column(DateTime(timezone=True), nullable=True)


class BookNoteLink(Base):
    __tablename__ = "book_note_links"
    __table_args__ = (UniqueConstraint("user_id", "book_id", "note_id", name="uq_book_note_link"),)

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    workspace_id = Column(Integer, ForeignKey("workspaces.id", ondelete="SET NULL"), nullable=True, index=True)
    book_id = Column(Integer, ForeignKey("books.id", ondelete="CASCADE"), nullable=False, index=True)
    note_id = Column(Integer, ForeignKey("notes.id", ondelete="CASCADE"), nullable=False, index=True)
    source_file_id = Column(Integer, ForeignKey("source_files.id", ondelete="CASCADE"), nullable=False, index=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class FileAnnotation(Base):
    __tablename__ = "file_annotations"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    workspace_id = Column(Integer, ForeignKey("workspaces.id", ondelete="SET NULL"), nullable=True, index=True)
    note_id = Column(Integer, ForeignKey("notes.id", ondelete="CASCADE"), nullable=False, index=True)
    source_file_id = Column(Integer, ForeignKey("source_files.id", ondelete="CASCADE"), nullable=True, index=True)
    book_id = Column(Integer, ForeignKey("books.id", ondelete="SET NULL"), nullable=True, index=True)
    page_number = Column(Integer, nullable=True)
    location_anchor = Column(JSON, nullable=True)
    annotation_type = Column(String(40), nullable=False)
    strokes_json = Column(JSON, nullable=True)
    highlight_data = Column(JSON, nullable=True)
    comment_text = Column(Text, nullable=True)
    color = Column(String(40), nullable=True)
    pen_size = Column(Float, nullable=True)
    tool_type = Column(String(40), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    deleted_at = Column(DateTime(timezone=True), nullable=True)


class NoteTimelineEvent(Base):
    __tablename__ = "note_timeline_events"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    workspace_id = Column(Integer, ForeignKey("workspaces.id", ondelete="SET NULL"), nullable=True, index=True)
    note_id = Column(Integer, ForeignKey("notes.id", ondelete="CASCADE"), nullable=False, index=True)
    source_file_id = Column(Integer, ForeignKey("source_files.id", ondelete="CASCADE"), nullable=True, index=True)
    book_id = Column(Integer, ForeignKey("books.id", ondelete="SET NULL"), nullable=True, index=True)
    event_type = Column(String(50), nullable=False)
    event_summary = Column(String(500), nullable=False)
    metadata_json = Column(JSON, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class RecordingMetadata(Base):
    __tablename__ = "recording_metadata"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    workspace_id = Column(Integer, ForeignKey("workspaces.id", ondelete="SET NULL"), nullable=True, index=True)
    note_id = Column(Integer, ForeignKey("notes.id", ondelete="CASCADE"), nullable=False, index=True)
    file_name = Column(String(500), nullable=False)
    duration_seconds = Column(Float, nullable=False)
    local_only = Column(Boolean, nullable=False, default=True, server_default="true")
    transcript_status = Column(String(30), nullable=False, default="not_requested", server_default="not_requested")
    transcript_note_id = Column(Integer, ForeignKey("notes.id", ondelete="SET NULL"), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
