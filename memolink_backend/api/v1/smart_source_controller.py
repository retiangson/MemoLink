from typing import Optional
from pathlib import Path

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, Response, UploadFile
from urllib.parse import quote
from pydantic import BaseModel

from memolink_backend.business.services.smart_source_service import SmartSourceError
from memolink_backend.contracts.smart_source_dtos import (
    AnnotationCreateDTO,
    AnnotationResponseDTO,
    AnnotationUpdateDTO,
    RecordingMetadataCreateDTO,
    RecordingMetadataResponseDTO,
    SourceFileCreateDTO,
    SourceFileResponseDTO,
    SourceWorkspaceResponseDTO,
    TimelineEventCreateDTO,
    TimelineEventResponseDTO,
)
from memolink_backend.core.security import get_current_user
from memolink_backend.di.request_container import RequestContainer, get_request_container


router = APIRouter(tags=["smart-source-workspace"])
MAX_SOURCE_UPLOAD_BYTES = 50 * 1024 * 1024
ALLOWED_SOURCE_EXTENSIONS = {
    ".pdf", ".docx", ".pptx", ".txt", ".md", ".csv",
    ".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".tiff",
    ".mp3", ".m4a", ".m4b", ".aac", ".wav", ".ogg", ".webm", ".mp4",
    ".epub", ".mobi",
}


class CacheStatusDTO(BaseModel):
    cache_status: str


def _handle(call):
    try:
        return call()
    except SmartSourceError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc


@router.get("/notes/{note_id}/source-workspace", response_model=SourceWorkspaceResponseDTO)
def get_source_workspace(
    note_id: int,
    user_id: int = Depends(get_current_user),
    c: RequestContainer = Depends(get_request_container),
):
    return _handle(lambda: c.smart_sources().get_workspace(user_id, note_id))


@router.post("/source-files/upload-to-onedrive", response_model=SourceFileResponseDTO)
async def upload_source_file(
    note_id: int = Form(...),
    workspace_id: Optional[int] = Form(None),
    file: UploadFile = File(...),
    user_id: int = Depends(get_current_user),
    c: RequestContainer = Depends(get_request_container),
):
    _handle(lambda: c.smart_sources().get_workspace(user_id, note_id))
    original_name = (file.filename or "").strip()
    extension = Path(original_name).suffix.lower()
    if extension not in ALLOWED_SOURCE_EXTENSIONS:
        raise HTTPException(status_code=415, detail="This source file type is not supported")
    content = await file.read(MAX_SOURCE_UPLOAD_BYTES + 1)
    if len(content) > MAX_SOURCE_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="Source files are limited to 50 MB for direct upload")
    if not content:
        raise HTTPException(status_code=400, detail="The uploaded source file is empty")
    try:
        uploaded = await c.onedrive().upload_source_bytes(
            file_name=original_name,
            content=content,
            mime_type=file.content_type,
        )
    except Exception as exc:
        status_code = getattr(exc, "status_code", 502)
        detail = getattr(exc, "detail", "Could not upload the source to OneDrive")
        raise HTTPException(status_code=status_code, detail=detail) from exc
    dto = SourceFileCreateDTO(
        note_id=note_id,
        workspace_id=workspace_id,
        source_type="upload",
        original_filename=original_name,
        mime_type=uploaded.get("mime_type") or file.content_type,
        file_size=uploaded.get("size") or len(content),
        onedrive_drive_id=uploaded["drive_id"],
        onedrive_item_id=uploaded["item_id"],
        onedrive_web_url=uploaded.get("web_url"),
        onedrive_etag=uploaded.get("etag"),
        extraction_status="pending",
    )
    try:
        return _handle(lambda: c.smart_sources().link_source(user_id, dto))
    except HTTPException:
        # The upload name is unique and was created by this request, so it is safe
        # to remove if metadata linking fails. Do not leave untracked originals.
        try:
            await c.onedrive().delete_file(
                drive_id=uploaded["drive_id"],
                item_id=uploaded["item_id"],
            )
        except Exception:
            pass
        raise


@router.get("/source-files/{source_file_id}", response_model=SourceFileResponseDTO)
def get_source_file(
    source_file_id: int,
    user_id: int = Depends(get_current_user),
    c: RequestContainer = Depends(get_request_container),
):
    return _handle(lambda: c.smart_sources().get_source(user_id, source_file_id))


@router.get("/source-files/{source_file_id}/content")
async def download_source_file(
    source_file_id: int,
    user_id: int = Depends(get_current_user),
    c: RequestContainer = Depends(get_request_container),
):
    source = _handle(lambda: c.smart_sources().get_source(user_id, source_file_id))
    try:
        content = await c.onedrive().download_file_bytes(
            drive_id=source.onedrive_drive_id,
            item_id=source.onedrive_item_id,
        )
    except Exception as exc:
        status_code = getattr(exc, "status_code", 502)
        detail = getattr(exc, "detail", "Could not download the source file")
        raise HTTPException(status_code=status_code, detail=detail) from exc
    return Response(
        content=content,
        media_type=source.mime_type or "application/octet-stream",
        headers={"Content-Disposition": f"inline; filename*=UTF-8''{quote(source.original_filename)}"},
    )


@router.put("/source-files/{source_file_id}/cache-status", response_model=SourceFileResponseDTO)
def update_source_cache_status(
    source_file_id: int,
    dto: CacheStatusDTO,
    user_id: int = Depends(get_current_user),
    c: RequestContainer = Depends(get_request_container),
):
    return _handle(lambda: c.smart_sources().update_cache_status(user_id, source_file_id, dto.cache_status))


@router.post("/source-files/{source_file_id}/extract", response_model=SourceFileResponseDTO)
async def extract_source_file(
    source_file_id: int,
    user_id: int = Depends(get_current_user),
    c: RequestContainer = Depends(get_request_container),
):
    try:
        return await c.smart_sources().extract_source(user_id, source_file_id)
    except SmartSourceError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc


@router.get("/annotations", response_model=list[AnnotationResponseDTO])
def list_annotations(
    note_id: int = Query(..., ge=1),
    source_file_id: Optional[int] = Query(None, ge=1),
    user_id: int = Depends(get_current_user),
    c: RequestContainer = Depends(get_request_container),
):
    return _handle(lambda: c.smart_sources().list_annotations(user_id, note_id, source_file_id))


@router.post("/annotations", response_model=AnnotationResponseDTO)
def create_annotation(
    dto: AnnotationCreateDTO,
    user_id: int = Depends(get_current_user),
    c: RequestContainer = Depends(get_request_container),
):
    return _handle(lambda: c.smart_sources().create_annotation(user_id, dto))


@router.put("/annotations/{annotation_id}", response_model=AnnotationResponseDTO)
def update_annotation(
    annotation_id: int,
    dto: AnnotationUpdateDTO,
    user_id: int = Depends(get_current_user),
    c: RequestContainer = Depends(get_request_container),
):
    return _handle(lambda: c.smart_sources().update_annotation(user_id, annotation_id, dto))


@router.delete("/annotations/{annotation_id}")
def delete_annotation(
    annotation_id: int,
    user_id: int = Depends(get_current_user),
    c: RequestContainer = Depends(get_request_container),
):
    _handle(lambda: c.smart_sources().delete_annotation(user_id, annotation_id))
    return {"deleted": True}


@router.post("/notes/{note_id}/timeline", response_model=TimelineEventResponseDTO)
def add_timeline_event(
    note_id: int,
    dto: TimelineEventCreateDTO,
    user_id: int = Depends(get_current_user),
    c: RequestContainer = Depends(get_request_container),
):
    return _handle(lambda: c.smart_sources().add_timeline_event(user_id, note_id, dto))


@router.post("/notes/{note_id}/recordings", response_model=RecordingMetadataResponseDTO)
def add_recording_metadata(
    note_id: int,
    dto: RecordingMetadataCreateDTO,
    user_id: int = Depends(get_current_user),
    c: RequestContainer = Depends(get_request_container),
):
    return _handle(lambda: c.smart_sources().add_recording(user_id, note_id, dto))
