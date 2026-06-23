from typing import Optional

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session
from sqlalchemy import text

from memolink_backend.core.security import get_current_user_info, UserInfo, level_meets
from memolink_backend.core.db import get_db
from memolink_backend.di.request_container import RequestContainer, get_request_container
from memolink_backend.business.services.book_service import BookAccessError
from memolink_backend.business.services.onedrive_service import OneDriveServiceError
from memolink_backend.business.services.book_note_source_service import run_book_note_source_job
from memolink_backend.business.services.book_highlight_service import BookHighlightError
from memolink_backend.utils.file_extractor import extract_pptx_slides
from memolink_backend.contracts.book_dtos import (
    BookResponseDTO,
    UserBookResponseDTO,
    BookProgressUpdateDTO,
    BookmarkCreateDTO,
    BookmarkResponseDTO,
    BookNoteSourceResponseDTO,
    BookSlidesResponseDTO,
    BookHighlightCreateDTO,
    BookHighlightResponseDTO,
)

router = APIRouter(prefix="/books", tags=["books"])

_EXTENSION_MIME_FALLBACK = {
    ".pdf": "application/pdf",
    ".epub": "application/epub+zip",
    ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    ".mp3": "audio/mpeg",
    ".m4a": "audio/mp4",
    ".m4b": "audio/mp4",
    ".aac": "audio/aac",
    ".wav": "audio/wav",
    ".ogg": "audio/ogg",
    ".txt": "text/plain",
    ".srt": "application/x-subrip",
    ".vtt": "text/vtt",
    ".cbz": "application/vnd.comicbook+zip",
    ".cbr": "application/vnd.comicbook-rar",
    ".mobi": "application/x-mobipocket-ebook",
}


def require_books_access(
    user: UserInfo = Depends(get_current_user_info),
    db: Session = Depends(get_db),
) -> int:
    """Gates the Books Library behind the books_library_enabled flag and
    books_library_min_level access tier, mirroring research_controller.py."""
    if not user.is_admin:
        row = db.execute(text("SELECT value FROM feature_flags WHERE key = 'books_library_enabled'")).fetchone()
        if row and row[0] == "false":
            raise HTTPException(status_code=403, detail="Books Library is disabled")
        row = db.execute(text("SELECT value FROM feature_flags WHERE key = 'books_library_min_level'")).fetchone()
        min_level = row[0] if row else "regular"
        if not level_meets(user.access_level, min_level):
            raise HTTPException(status_code=403, detail="Books Library requires a higher access level")
    return user.id


@router.get("", response_model=list[BookResponseDTO])
def list_books(
    search: Optional[str] = Query(None),
    category: Optional[str] = Query(None),
    tag: Optional[str] = Query(None),
    user_id: int = Depends(require_books_access),
    c: RequestContainer = Depends(get_request_container),
):
    return c.books().list_published(search, category, tag)


@router.get("/my", response_model=list[UserBookResponseDTO])
def list_my_books(
    user_id: int = Depends(require_books_access),
    c: RequestContainer = Depends(get_request_container),
):
    return c.books().list_my_books(user_id)


@router.get("/{book_id}", response_model=BookResponseDTO)
def get_book(
    book_id: int,
    user_id: int = Depends(require_books_access),
    c: RequestContainer = Depends(get_request_container),
):
    try:
        return c.books().get_published_book(book_id)
    except BookAccessError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail)


@router.post("/{book_id}/borrow", response_model=UserBookResponseDTO)
def borrow_book(
    book_id: int,
    user_id: int = Depends(require_books_access),
    c: RequestContainer = Depends(get_request_container),
):
    try:
        return c.books().borrow(user_id, book_id)
    except BookAccessError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail)


@router.delete("/{book_id}/my")
def remove_from_my_books(
    book_id: int,
    user_id: int = Depends(require_books_access),
    c: RequestContainer = Depends(get_request_container),
):
    removed = c.books().remove_from_my_books(user_id, book_id)
    return {"removed": removed}


@router.post("/{book_id}/progress", response_model=UserBookResponseDTO)
def update_progress(
    book_id: int,
    body: BookProgressUpdateDTO,
    user_id: int = Depends(require_books_access),
    c: RequestContainer = Depends(get_request_container),
):
    try:
        return c.books().update_progress(user_id, book_id, body.current_page, body.total_pages)
    except BookAccessError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail)


@router.post("/{book_id}/bookmark", response_model=BookmarkResponseDTO)
def add_bookmark(
    book_id: int,
    body: BookmarkCreateDTO,
    user_id: int = Depends(require_books_access),
    c: RequestContainer = Depends(get_request_container),
):
    try:
        return c.books().add_bookmark(user_id, book_id, body)
    except BookAccessError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail)


@router.get("/{book_id}/bookmarks", response_model=list[BookmarkResponseDTO])
def list_bookmarks(
    book_id: int,
    user_id: int = Depends(require_books_access),
    c: RequestContainer = Depends(get_request_container),
):
    return c.books().list_bookmarks(user_id, book_id)


@router.post("/{book_id}/highlights", response_model=BookHighlightResponseDTO)
def add_highlight(
    book_id: int,
    body: BookHighlightCreateDTO,
    user_id: int = Depends(require_books_access),
    c: RequestContainer = Depends(get_request_container),
):
    try:
        c.books().get_book_for_reading(user_id, book_id, is_admin=False)
    except BookAccessError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail)

    try:
        return c.book_highlights().add_highlight(user_id, book_id, body)
    except BookHighlightError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail)


@router.get("/highlights/{highlight_id}", response_model=BookHighlightResponseDTO)
def get_highlight(
    highlight_id: int,
    user_id: int = Depends(require_books_access),
    c: RequestContainer = Depends(get_request_container),
):
    try:
        return c.book_highlights().get_highlight(user_id, highlight_id)
    except BookHighlightError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail)


@router.get("/{book_id}/highlights", response_model=list[BookHighlightResponseDTO])
def list_highlights(
    book_id: int,
    user_id: int = Depends(require_books_access),
    c: RequestContainer = Depends(get_request_container),
):
    return c.book_highlights().list_highlights(user_id, book_id)


@router.get("/{book_id}/read")
async def read_book(
    book_id: int,
    info: UserInfo = Depends(get_current_user_info),
    _access: int = Depends(require_books_access),
    c: RequestContainer = Depends(get_request_container),
):
    """Streams the PDF bytes through the backend so the OneDrive access token
    is never exposed to the frontend."""
    try:
        book = c.books().get_book_for_reading(info.id, book_id, is_admin=info.is_admin)
    except BookAccessError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail)

    try:
        content = await c.onedrive().download_file_bytes(
            drive_id=book.onedrive_drive_id, item_id=book.onedrive_item_id
        )
    except OneDriveServiceError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail)

    fallback_mime = _EXTENSION_MIME_FALLBACK.get((book.file_extension or "").lower(), "application/octet-stream")
    return StreamingResponse(
        iter([content]),
        media_type=book.mime_type or fallback_mime,
        headers={"Content-Disposition": f'inline; filename="{book.file_name or "book"}"'},
    )


@router.get("/{book_id}/slides", response_model=BookSlidesResponseDTO)
async def read_book_slides(
    book_id: int,
    info: UserInfo = Depends(get_current_user_info),
    _access: int = Depends(require_books_access),
    c: RequestContainer = Depends(get_request_container),
):
    """Extracts PPTX slide content (title, bullet text, embedded images) server-side via
    python-pptx, since there's no LibreOffice-free way to render the OOXML format visually."""
    try:
        book = c.books().get_book_for_reading(info.id, book_id, is_admin=info.is_admin)
    except BookAccessError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail)

    if (book.file_extension or "").lower() != ".pptx":
        raise HTTPException(status_code=400, detail="Slide extraction is only available for .pptx books")

    try:
        content = await c.onedrive().download_file_bytes(
            drive_id=book.onedrive_drive_id, item_id=book.onedrive_item_id
        )
    except OneDriveServiceError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail)

    try:
        slides = extract_pptx_slides(content)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to parse PPTX: {exc}")

    return BookSlidesResponseDTO(slides=slides)


@router.post("/{book_id}/save-as-note-source", response_model=BookNoteSourceResponseDTO)
def save_as_note_source(
    book_id: int,
    background_tasks: BackgroundTasks,
    user_id: int = Depends(require_books_access),
    c: RequestContainer = Depends(get_request_container),
):
    try:
        c.books().get_book_for_reading(user_id, book_id, is_admin=False)
    except BookAccessError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail)

    already_running = c.book_note_source().get_status(user_id, book_id)
    status = c.book_note_source().start(user_id, book_id)
    if not already_running or already_running.status != "processing":
        background_tasks.add_task(run_book_note_source_job, user_id, book_id)
    return status


@router.get("/{book_id}/note-source-status", response_model=Optional[BookNoteSourceResponseDTO])
def note_source_status(
    book_id: int,
    user_id: int = Depends(require_books_access),
    c: RequestContainer = Depends(get_request_container),
):
    return c.book_note_source().get_status(user_id, book_id)
