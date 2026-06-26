from sqlalchemy import Column, Integer, BigInteger, String, Text, DateTime, Boolean, ForeignKey, func
from memolink_backend.core.db import Base


class Book(Base):
    __tablename__ = "books"

    id = Column(Integer, primary_key=True, index=True)
    title = Column(String(500), nullable=False)
    author = Column(String(255), nullable=True)
    description = Column(Text, nullable=True)
    category = Column(String(100), nullable=True)
    tags = Column(String(500), nullable=True)  # comma-separated

    file_name = Column(String(500), nullable=False)
    file_extension = Column(String(20), nullable=True)
    mime_type = Column(String(150), nullable=True)
    file_size = Column(BigInteger, nullable=True)
    cover_image_url = Column(String(1000), nullable=True)

    # "onedrive" for OneDrive-sourced files, "archive_org" for Internet Archive, etc.
    # SQL: ALTER TABLE books ADD COLUMN IF NOT EXISTS source VARCHAR(30) NOT NULL DEFAULT 'onedrive';
    # SQL: ALTER TABLE books ADD COLUMN IF NOT EXISTS source_location VARCHAR(1000);
    source = Column(String(30), nullable=False, default="onedrive", server_default="onedrive")
    source_location = Column(String(1000), nullable=True)

    onedrive_drive_id = Column(String(255), nullable=True)
    onedrive_item_id = Column(String(500), nullable=False, unique=True, index=True)
    onedrive_web_url = Column(String(1000), nullable=True)
    onedrive_share_link = Column(String(1000), nullable=True)
    last_modified = Column(DateTime(timezone=True), nullable=True)

    is_published = Column(Boolean, nullable=False, default=False, server_default="false")
    sync_status = Column(String(30), nullable=False, default="synced", server_default="synced")
    sync_error = Column(Text, nullable=True)

    created_by_admin_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
