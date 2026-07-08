import logging
import mimetypes
import json
import os
from typing import Optional

from fastapi import APIRouter, BackgroundTasks, Depends, File, HTTPException, Query, Request, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session
from sqlalchemy import text

from memolink_backend.core.security import get_current_user_info, UserInfo, level_meets
from memolink_backend.core.db import get_db
from memolink_backend.di.request_container import RequestContainer, get_request_container
from memolink_backend.business.services.book_service import BookAccessError
from memolink_backend.business.services.onedrive_service import OneDriveServiceError, SUPPORTED_EXTENSIONS
from memolink_backend.business.services.archive_org_service import ArchiveOrgServiceError
from memolink_backend.business.services.book_cache_service import BookCacheServiceError
from memolink_backend.business.services.book_note_source_service import run_book_note_source_job
from memolink_backend.business.services.book_highlight_service import BookHighlightError
from memolink_backend.business.services.book_upload_service import BookUploadError, MAX_BOOK_UPLOAD_BYTES
from memolink_backend.utils.file_extractor import extract_pptx_slides
from memolink_backend.contracts.book_dtos import (
    BookResponseDTO,
    BookPageResponseDTO,
    UserBookResponseDTO,
    BookProgressUpdateDTO,
    BookmarkCreateDTO,
    BookmarkResponseDTO,
    BookNoteSourceResponseDTO,
    BookSlidesResponseDTO,
    BookHighlightCreateDTO,
    BookHighlightResponseDTO,
    BookReadUrlResponseDTO,
)

router = APIRouter(prefix="/books", tags=["books"])
logger = logging.getLogger(__name__)


def _dispatch_book_note_source_job(background_tasks: BackgroundTasks, user_id: int, book_id: int) -> None:
    function_name = os.getenv("AWS_LAMBDA_FUNCTION_NAME")
    if not function_name:
        background_tasks.add_task(run_book_note_source_job, user_id, book_id)
        return
    import boto3
    response = boto3.client("lambda").invoke(
        FunctionName=function_name,
        InvocationType="Event",
        Payload=json.dumps({"memolink_job": "book_note_source", "user_id": user_id, "book_id": book_id}).encode("utf-8"),
    )
    if response.get("StatusCode") != 202:
        raise RuntimeError("AWS Lambda did not accept the extraction job")


class BookReaderErrorDTO(BaseModel):
    book_id: int
    format: str = Field(default="unknown", max_length=30)
    stage: str = Field(default="unknown", max_length=80)
    message: str = Field(default="", max_length=1000)
    technical_detail: Optional[str] = Field(default=None, max_length=3000)
    user_agent: Optional[str] = Field(default=None, max_length=500)
    url: Optional[str] = Field(default=None, max_length=1000)
    online: Optional[bool] = None
    connection: Optional[dict] = None

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
    ".mp4": "video/mp4",
    ".webm": "video/webm",
    ".mov": "video/quicktime",
    ".m4v": "video/x-m4v",
}


def _short_id(value: Optional[str]) -> Optional[str]:
    if not value:
        return None
    return value if len(value) <= 12 else f"...{value[-12:]}"


def _book_audit_details(book, *, user: UserInfo) -> dict:
    return {
        "user_id": user.id,
        "is_admin": user.is_admin,
        "book_id": book.id,
        "title": book.title,
        "file_name": book.file_name,
        "file_extension": book.file_extension,
        "mime_type": book.mime_type,
        "file_size": book.file_size,
        "is_published": book.is_published,
        "sync_status": book.sync_status,
        "sync_error": book.sync_error,
        "onedrive_drive_id": _short_id(book.onedrive_drive_id),
        "onedrive_item_id": _short_id(book.onedrive_item_id),
        "last_modified": book.last_modified.isoformat() if book.last_modified else None,
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


@router.get("", response_model=BookPageResponseDTO)
def list_books(
    search: Optional[str] = Query(None),
    category: Optional[str] = Query(None),
    tag: Optional[str] = Query(None),
    format: Optional[str] = Query(None),
    page: int = Query(1, ge=1),
    page_size: int = Query(12, ge=1, le=100),
    user_id: int = Depends(require_books_access),
    c: RequestContainer = Depends(get_request_container),
):
    return c.books().list_published(search, category, tag, format, page, page_size)


@router.get("/my", response_model=list[UserBookResponseDTO])
def list_my_books(
    user_id: int = Depends(require_books_access),
    c: RequestContainer = Depends(get_request_container),
):
    return c.books().list_my_books(user_id)


@router.get("/upload/supported-extensions", response_model=list[str])
def list_upload_supported_extensions(
    user_id: int = Depends(require_books_access),
):
    """Single source of truth for which file extensions BookUploadService.validate_file
    accepts, so the frontend's upload file-picker filter can't drift from it."""
    return sorted(SUPPORTED_EXTENSIONS)


@router.post("/upload", response_model=UserBookResponseDTO)
async def upload_own_book(
    file: UploadFile = File(...),
    user_id: int = Depends(require_books_access),
    c: RequestContainer = Depends(get_request_container),
):
    """Lets a user upload a book they own. Stored in the same shared OneDrive as
    admin uploads, but created unpublished (private) — it only ever appears in the
    uploader's own My Books, never in the public library for other users."""
    file_name = (file.filename or "").strip()
    content = await file.read(MAX_BOOK_UPLOAD_BYTES + 1)
    if len(content) > MAX_BOOK_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="Book uploads are limited to 100 MB")
    try:
        book = await c.book_upload().upload(
            uploaded_by_user_id=user_id,
            file_name=file_name,
            content=content,
            mime_type=file.content_type,
            is_published=False,
        )
    except BookUploadError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc
    except OneDriveServiceError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc
    return c.books().claim_own_upload(user_id, book.id)


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


@router.post("/reader-error")
def log_reader_error(
    body: BookReaderErrorDTO,
    info: UserInfo = Depends(get_current_user_info),
    _access: int = Depends(require_books_access),
    c: RequestContainer = Depends(get_request_container),
):
    book = None
    try:
        book = c.books().get_book_for_reading(info.id, body.book_id, is_admin=info.is_admin)
    except BookAccessError:
        try:
            book = c.books().get_published_book(body.book_id)
        except BookAccessError:
            book = None

    details = {
        "user_id": info.id,
        "is_admin": info.is_admin,
        "book_id": body.book_id,
        "format": body.format,
        "stage": body.stage,
        "message": body.message,
        "technical_detail": body.technical_detail,
        "user_agent": body.user_agent,
        "url": body.url,
        "online": body.online,
        "connection": body.connection,
    }
    if book:
        details.update(_book_audit_details(book, user=info))

    c.logs().error(
        "books.reader.client",
        f"Book reader failed on client for book #{body.book_id}: {body.message or body.stage}",
        details,
        info.id,
    )
    return {"ok": True}


@router.get("/{book_id}/local-stream")
async def local_stream_book(
    book_id: int,
    tok: str,
    uid: int,
    h: str,
    mt: str = "application/octet-stream",
    c: RequestContainer = Depends(get_request_container),
):
    """Local-dev-only streaming endpoint. Replaces S3 presigned URLs when
    S3_UPLOAD_BUCKET is not configured. Protected by a short-lived HMAC token
    so no Authorization header is needed (mirrors the presigned-URL pattern)."""
    svc = c.book_cache()
    if not svc.verify_local_token(uid, book_id, h, tok):
        raise HTTPException(status_code=403, detail="Invalid or expired token.")

    local_path = svc.local_file(book_id, h)
    if local_path is None:
        raise HTTPException(
            status_code=404,
            detail="Local book cache not found. Re-open the book to re-download it.",
        )

    # Guess mime from extension as fallback in case mt param is missing/wrong
    guessed = mimetypes.guess_type(local_path.name)[0]
    media_type = mt or guessed or "application/octet-stream"

    return FileResponse(
        path=str(local_path),
        media_type=media_type,
        filename=local_path.name,
    )


@router.get("/{book_id}/read", response_model=BookReadUrlResponseDTO)
async def read_book(
    book_id: int,
    request: Request,
    info: UserInfo = Depends(get_current_user_info),
    _access: int = Depends(require_books_access),
    c: RequestContainer = Depends(get_request_container),
):
    """Returns a short-lived signed URL for the book file.

    Production (S3_UPLOAD_BUCKET set): caches the file in S3, returns a presigned
    S3 GET URL so the client downloads directly — bypasses Lambda's 6 MB response cap.

    Local dev (S3_UPLOAD_BUCKET empty): caches the file in the OS temp directory,
    returns an HMAC-signed URL pointing to /local-stream on this server instead.
    The frontend uses the same code path in both cases.
    """
    try:
        book = c.books().get_book_for_reading(info.id, book_id, is_admin=info.is_admin)
    except BookAccessError as exc:
        c.logs().warning(
            "books.read",
            f"Book read denied for book #{book_id}: {exc.detail}",
            {
                "user_id": info.id,
                "is_admin": info.is_admin,
                "book_id": book_id,
                "status_code": exc.status_code,
                "error": exc.detail,
            },
            info.id,
        )
        raise HTTPException(status_code=exc.status_code, detail=exc.detail)

    audit_details = _book_audit_details(book, user=info)
    fallback_mime = _EXTENSION_MIME_FALLBACK.get((book.file_extension or "").lower(), "application/octet-stream")
    mime_type = book.mime_type or fallback_mime

    base_url = str(request.base_url).rstrip("/")

    try:
        result = await c.book_cache().get_read_url(
            book, mime_type=mime_type, user_id=info.id, base_url=base_url
        )
    except (OneDriveServiceError, ArchiveOrgServiceError) as exc:
        details = {
            **audit_details,
            "status_code": exc.status_code,
            "error": exc.detail,
        }
        c.logs().error(
            "books.read",
            f"File download failed for book #{book.id}: {exc.detail}",
            details,
            info.id,
        )
        raise HTTPException(
            status_code=exc.status_code,
            detail={
                "message": exc.detail,
                "book_id": book.id,
                "title": book.title,
                "file_name": book.file_name,
                "file_extension": book.file_extension,
                "file_size": book.file_size,
                "sync_status": book.sync_status,
                "sync_error": book.sync_error,
            },
        )
    except BookCacheServiceError as exc:
        details = {
            **audit_details,
            "status_code": exc.status_code,
            "error": exc.detail,
        }
        c.logs().error(
            "books.read",
            f"S3 book cache failed for book #{book.id}: {exc.detail}",
            details,
            info.id,
        )
        raise HTTPException(status_code=exc.status_code, detail=exc.detail)

    c.logs().info(
        "books.read",
        f"Book read URL generated: {book.title}" + (" (cache hit)" if result["cache_hit"] else " (downloaded from OneDrive and cached)"),
        {**audit_details, "cache_hit": result["cache_hit"]},
        info.id,
    )

    return BookReadUrlResponseDTO(
        url=result["url"],
        expires_in=result["expires_in"],
        file_name=book.file_name,
        mime_type=mime_type,
        file_size=book.file_size,
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
        logger.warning("OneDrive download failed for slide extraction on book %s: %s", book.id, exc.detail)
        raise HTTPException(status_code=exc.status_code, detail=exc.detail)

    try:
        slides = extract_pptx_slides(content)
    except Exception as exc:
        logger.warning("Failed to parse PPTX slides for book %s: %s", book.id, exc)
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

    status = c.book_note_source().start(user_id, book_id)
    if status.status == "pending":
        try:
            _dispatch_book_note_source_job(background_tasks, user_id, book_id)
        except Exception as exc:
            logger.exception("Could not dispatch book note-source job for user=%s book=%s", user_id, book_id)
            c.book_note_source().mark_failed(user_id, book_id, "Could not start extraction. Please try again.")
            raise HTTPException(status_code=503, detail="Could not start book extraction") from exc
    return status


@router.get("/{book_id}/note-source-status", response_model=Optional[BookNoteSourceResponseDTO])
def note_source_status(
    book_id: int,
    user_id: int = Depends(require_books_access),
    c: RequestContainer = Depends(get_request_container),
):
    return c.book_note_source().get_status(user_id, book_id)
