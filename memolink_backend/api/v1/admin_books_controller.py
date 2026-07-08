import hashlib
import hmac
import json
import time
from typing import Optional
from urllib.parse import parse_qsl, urlencode, urlparse, urlunparse

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from fastapi.responses import RedirectResponse

import logging

from memolink_backend.core.config import settings
from memolink_backend.core.security import get_current_admin
from memolink_backend.di.request_container import RequestContainer, get_request_container
from memolink_backend.business.services.onedrive_service import OneDriveServiceError
from memolink_backend.contracts.book_dtos import (
    BookResponseDTO,
    BookUpdateDTO,
    OneDriveSyncResultDTO,
    OneDriveSyncPageRequestDTO,
    OneDriveSyncPageResultDTO,
    BookIdsDTO,
    BulkPublishResultDTO,
    ArchiveOrgSyncRequestDTO,
    ArchiveOrgSyncResultDTO,
)
from memolink_backend.business.services.archive_org_service import ArchiveOrgServiceError
from memolink_backend.business.services.book_upload_service import BookUploadError, MAX_BOOK_UPLOAD_BYTES

router = APIRouter(prefix="/admin/books", tags=["admin-books"])
logger = logging.getLogger(__name__)


def _frontend_redirect_url(params: dict[str, str]) -> str:
    parsed = urlparse(settings.frontend_url)
    query = dict(parse_qsl(parsed.query, keep_blank_values=True))
    query.update(params)
    return urlunparse(parsed._replace(query=urlencode(query)))


def _sign_state(admin_id: int) -> str:
    import base64
    payload = json.dumps({"uid": admin_id, "ts": int(time.time())})
    sig = hmac.new(settings.jwt_secret_key.encode(), payload.encode(), hashlib.sha256).hexdigest()
    return base64.urlsafe_b64encode(f"{payload}|{sig}".encode()).decode()


def _verify_state(state: str) -> int:
    import base64
    try:
        decoded = base64.urlsafe_b64decode(state.encode()).decode()
        payload_str, sig = decoded.rsplit("|", 1)
        expected = hmac.new(settings.jwt_secret_key.encode(), payload_str.encode(), hashlib.sha256).hexdigest()
        if not hmac.compare_digest(sig, expected):
            raise ValueError("invalid signature")
        data = json.loads(payload_str)
        if int(time.time()) - data["ts"] > 600:
            raise ValueError("state expired")
        return int(data["uid"])
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid or expired OAuth state")


@router.get("")
def list_books(
    search: Optional[str] = Query(None),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    admin_id: int = Depends(get_current_admin),
    c: RequestContainer = Depends(get_request_container),
):
    return c.books().list_all_for_admin(search, page, page_size)


@router.post("/upload", response_model=BookResponseDTO)
async def upload_book(
    file: UploadFile = File(...),
    admin_id: int = Depends(get_current_admin),
    c: RequestContainer = Depends(get_request_container),
):
    file_name = (file.filename or "").strip()
    content = await file.read(MAX_BOOK_UPLOAD_BYTES + 1)
    if len(content) > MAX_BOOK_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="Book uploads are limited to 100 MB")
    try:
        return await c.book_upload().upload(
            uploaded_by_user_id=admin_id,
            file_name=file_name,
            content=content,
            mime_type=file.content_type,
        )
    except BookUploadError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc
    except OneDriveServiceError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc


# ── OneDrive connection ──────────────────────────────────────────────────────

@router.get("/onedrive/status")
def onedrive_status(
    admin_id: int = Depends(get_current_admin),
    c: RequestContainer = Depends(get_request_container),
):
    return c.onedrive().get_status(admin_id)


@router.get("/onedrive/auth-url")
def onedrive_auth_url(
    admin_id: int = Depends(get_current_admin),
    c: RequestContainer = Depends(get_request_container),
):
    try:
        url = c.onedrive().get_auth_url(_sign_state(admin_id))
    except OneDriveServiceError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail)
    return {"url": url}


@router.get("/onedrive/callback")
async def onedrive_callback(
    code: str = Query(...),
    state: str = Query(...),
    c: RequestContainer = Depends(get_request_container),
):
    admin_id = _verify_state(state)
    try:
        await c.onedrive().handle_callback(admin_id, code)
    except OneDriveServiceError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail)
    return RedirectResponse(url=_frontend_redirect_url({"admin": "books", "onedrive_connected": "1"}))


@router.delete("/onedrive/disconnect")
def onedrive_disconnect(
    admin_id: int = Depends(get_current_admin),
    c: RequestContainer = Depends(get_request_container),
):
    c.onedrive().disconnect(admin_id)
    return {"ok": True}


# ── Sync ─────────────────────────────────────────────────────────────────────

@router.post("/sync", response_model=OneDriveSyncResultDTO)
async def sync_books(
    admin_id: int = Depends(get_current_admin),
    c: RequestContainer = Depends(get_request_container),
):
    if not settings.onedrive_sync_enabled:
        raise HTTPException(status_code=503, detail="OneDrive sync is disabled (ONEDRIVE_SYNC_ENABLED=false)")
    try:
        result = await c.book_sync().sync(admin_id)
    except OneDriveServiceError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail)
    return result


@router.post("/sync/page", response_model=OneDriveSyncPageResultDTO)
async def sync_books_page(
    body: OneDriveSyncPageRequestDTO,
    admin_id: int = Depends(get_current_admin),
    c: RequestContainer = Depends(get_request_container),
):
    """One resumable step of a sync — lists and upserts a single OneDrive folder page.
    Intended to be called in a loop by a long-running local client (e.g. the desktop
    app), which can drive a sync of any size without any single request needing to
    walk the whole OneDrive folder tree."""
    if not settings.onedrive_sync_enabled:
        raise HTTPException(status_code=503, detail="OneDrive sync is disabled (ONEDRIVE_SYNC_ENABLED=false)")
    try:
        result = await c.book_sync().sync_page(admin_id, body.cursor)
    except OneDriveServiceError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail)
    return result


# ── Archive.org sync ─────────────────────────────────────────────────────────

def _extract_archive_identifier(raw: str) -> str:
    """Accept a bare identifier or any archive.org URL and return just the identifier."""
    raw = raw.strip().rstrip("/")
    for prefix in (
        "https://archive.org/details/",
        "https://archive.org/download/",
        "http://archive.org/details/",
        "http://archive.org/download/",
    ):
        if raw.startswith(prefix):
            return raw[len(prefix):].split("/")[0]
    return raw.split("/")[-1] if "/" in raw else raw


@router.post("/archive-sync", response_model=ArchiveOrgSyncResultDTO)
async def sync_from_archive(
    body: ArchiveOrgSyncRequestDTO,
    admin_id: int = Depends(get_current_admin),
    c: RequestContainer = Depends(get_request_container),
):
    """Sync all freely downloadable files from a single archive.org item.

    Accepts a bare identifier (e.g. ``manga-2022-digital``) or any
    archive.org URL pointing to the item.  Restricted / CDL-only items
    are rejected with HTTP 403.
    """
    identifier = _extract_archive_identifier(body.identifier)
    if not identifier:
        raise HTTPException(status_code=400, detail="identifier is required.")
    try:
        result = await c.archive_sync().sync(identifier, admin_id)
    except ArchiveOrgServiceError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail)
    return result


# ── Metadata / publishing ────────────────────────────────────────────────────

@router.patch("/{book_id}", response_model=BookResponseDTO)
def update_book(
    book_id: int,
    body: BookUpdateDTO,
    admin_id: int = Depends(get_current_admin),
    c: RequestContainer = Depends(get_request_container),
):
    try:
        return c.books().update_metadata(book_id, body)
    except Exception as exc:
        logger.warning("Failed to update metadata for book %s: %s", book_id, exc)
        raise HTTPException(status_code=404, detail=str(exc))


@router.post("/{book_id}/publish", response_model=BookResponseDTO)
def publish_book(
    book_id: int,
    admin_id: int = Depends(get_current_admin),
    c: RequestContainer = Depends(get_request_container),
):
    try:
        return c.books().set_published(book_id, True)
    except Exception as exc:
        logger.warning("Failed to publish book %s: %s", book_id, exc)
        raise HTTPException(status_code=404, detail=str(exc))


@router.post("/{book_id}/unpublish", response_model=BookResponseDTO)
def unpublish_book(
    book_id: int,
    admin_id: int = Depends(get_current_admin),
    c: RequestContainer = Depends(get_request_container),
):
    try:
        return c.books().set_published(book_id, False)
    except Exception as exc:
        logger.warning("Failed to unpublish book %s: %s", book_id, exc)
        raise HTTPException(status_code=404, detail=str(exc))


@router.post("/publish-all", response_model=BulkPublishResultDTO)
def publish_all_books(
    admin_id: int = Depends(get_current_admin),
    c: RequestContainer = Depends(get_request_container),
):
    return {"updated": c.books().publish_all()}


@router.post("/unpublish-all", response_model=BulkPublishResultDTO)
def unpublish_all_books(
    admin_id: int = Depends(get_current_admin),
    c: RequestContainer = Depends(get_request_container),
):
    return {"updated": c.books().unpublish_all()}


@router.post("/publish-selected", response_model=BulkPublishResultDTO)
def publish_selected_books(
    body: BookIdsDTO,
    admin_id: int = Depends(get_current_admin),
    c: RequestContainer = Depends(get_request_container),
):
    return {"updated": c.books().publish_many(body.book_ids)}


@router.post("/unpublish-selected", response_model=BulkPublishResultDTO)
def unpublish_selected_books(
    body: BookIdsDTO,
    admin_id: int = Depends(get_current_admin),
    c: RequestContainer = Depends(get_request_container),
):
    return {"updated": c.books().unpublish_many(body.book_ids)}
