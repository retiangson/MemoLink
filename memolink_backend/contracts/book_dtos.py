from datetime import datetime
from typing import Optional, List
from pydantic import BaseModel, ConfigDict


class BookResponseDTO(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    title: str
    author: Optional[str] = None
    description: Optional[str] = None
    category: Optional[str] = None
    tags: Optional[str] = None
    file_name: str
    file_extension: Optional[str] = None
    mime_type: Optional[str] = None
    file_size: Optional[int] = None
    cover_image_url: Optional[str] = None
    onedrive_web_url: Optional[str] = None
    last_modified: Optional[datetime] = None
    source: str = "onedrive"
    source_location: Optional[str] = None
    is_published: bool
    sync_status: str
    sync_error: Optional[str] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None


class BookPageResponseDTO(BaseModel):
    items: List[BookResponseDTO]
    total: int
    available_total: int
    page: int
    page_size: int
    pages: int


class BookUpdateDTO(BaseModel):
    title: Optional[str] = None
    author: Optional[str] = None
    description: Optional[str] = None
    category: Optional[str] = None
    tags: Optional[str] = None
    cover_image_url: Optional[str] = None


class UserBookResponseDTO(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    user_id: int
    book_id: int
    status: str
    current_page: int
    total_pages: Optional[int] = None
    progress_percent: float
    borrowed_at: Optional[datetime] = None
    last_read_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None
    book: Optional[BookResponseDTO] = None


class BookProgressUpdateDTO(BaseModel):
    current_page: int
    total_pages: Optional[int] = None


class BookmarkCreateDTO(BaseModel):
    page_number: int
    note: Optional[str] = None


class BookmarkResponseDTO(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    user_id: int
    book_id: int
    page_number: int
    note: Optional[str] = None
    created_at: Optional[datetime] = None


class BookHighlightCreateDTO(BaseModel):
    format: str
    page_number: int
    start_offset: int
    end_offset: int
    snippet: str
    color: str = "yellow"


class BookHighlightResponseDTO(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    user_id: int
    book_id: int
    note_id: int
    format: str
    page_number: int
    start_offset: int
    end_offset: int
    snippet: str
    color: str = "yellow"
    created_at: Optional[datetime] = None


class BookNoteSourceResponseDTO(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    user_id: int
    book_id: int
    status: str
    error_message: Optional[str] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None


class OneDriveSyncResultDTO(BaseModel):
    scanned: int
    created: int
    updated: int


class OneDriveSyncPageRequestDTO(BaseModel):
    cursor: Optional[str] = None


class OneDriveSyncPageResultDTO(BaseModel):
    cursor: Optional[str] = None
    done: bool
    scanned: int
    created: int
    updated: int


class BookSlidesResponseDTO(BaseModel):
    slides: List[str]


class BookReadUrlResponseDTO(BaseModel):
    url: str
    expires_in: int
    file_name: str
    mime_type: str
    file_size: Optional[int] = None


class BookIdsDTO(BaseModel):
    book_ids: List[int]


class BulkPublishResultDTO(BaseModel):
    updated: int


class ArchiveOrgSyncRequestDTO(BaseModel):
    identifier: str  # e.g. "manga-2022-digital" or full URL (controller strips to identifier)


class ArchiveOrgSyncResultDTO(BaseModel):
    scanned: int
    created: int
    updated: int
    skipped: int
    source_location: str
