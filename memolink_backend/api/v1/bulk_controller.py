import logging
from fastapi import APIRouter, UploadFile, File, Form, Depends
from typing import List, Optional
from memolink_backend.di.request_container import RequestContainer, get_request_container
from memolink_backend.core.security import get_current_user
from memolink_backend.core.config import settings
from memolink_backend.utils.file_extractor import extract_formatted_html

_WHISPER_LIMIT_BYTES = 25 * 1024 * 1024
_AUDIO_VIDEO_EXTS = {".mp3", ".mp4", ".m4a", ".wav", ".webm", ".ogg", ".flac", ".mpeg", ".mpga", ".mov", ".avi"}

router = APIRouter(prefix="/notes", tags=["notes"])
logger = logging.getLogger(__name__)


@router.post("/bulk")
async def bulk_upload(
    files: List[UploadFile] = File(...),
    workspace_id: Optional[int] = Form(None),
    current_user_id: int = Depends(get_current_user),
    c: RequestContainer = Depends(get_request_container),
):
    created = []
    failed: list[dict] = []
    db = c.domain.get_db()

    for file in files:
        filename = file.filename or "upload"
        try:
            content_bytes = await file.read()
            size_mb = round(len(content_bytes) / 1024 / 1024, 1)
            ext = "." + (filename.rsplit(".", 1)[-1].lower() if "." in filename else "")

            if ext in _AUDIO_VIDEO_EXTS and len(content_bytes) > _WHISPER_LIMIT_BYTES:
                if settings.deepgram_api_key:
                    c.logs().info("bulk.upload", f"File '{filename}' exceeds 25 MB - falling back to Deepgram Nova-2", {"filename": filename, "size_mb": size_mb, "fallback": "deepgram"}, current_user_id)
                else:
                    c.logs().warning("bulk.upload", f"File '{filename}' exceeds 25 MB Whisper limit - no Deepgram key, transcription will be skipped", {"filename": filename, "size_mb": size_mb}, current_user_id)

            html_content = extract_formatted_html(content_bytes, filename).replace("\x00", "")

            if "[Transcription skipped]" in html_content:
                c.logs().warning("bulk.upload", f"Transcription skipped for '{filename}' - file exceeds Whisper 25 MB limit", {"filename": filename, "size_mb": size_mb}, current_user_id)

            if not html_content.strip() or html_content.strip() == "<p></p>":
                c.logs().warning("bulk.upload", f"No text extracted from '{filename}'", {"filename": filename, "size_mb": size_mb}, current_user_id)
                html_content = "<p></p>"
                extraction_status = "unavailable"
            else:
                extraction_status = "ready"

            note = await c.smart_sources().create_imported_note(
                user_id=current_user_id,
                workspace_id=workspace_id,
                file_name=filename,
                mime_type=file.content_type,
                content=content_bytes,
                extracted_html=html_content,
                extraction_status=extraction_status,
            )
            created.append(note)
            c.logs().info("bulk.upload", f"Note created from '{filename}'", {"filename": filename, "size_mb": size_mb}, current_user_id)
        except Exception as exc:
            failed.append({"filename": filename, "reason": str(exc)})
            logger.error("Failed to process bulk upload '%s' for user_id=%s: %s", filename, current_user_id, exc)
            try:
                c.logs().error("bulk.upload", f"Failed to process '{filename}': {exc}", {"filename": filename, "error": str(exc)}, current_user_id)
            except Exception as log_exc:
                logger.warning("Failed to write system log for bulk upload failure of '%s': %s", filename, log_exc)
            try:
                db.rollback()
            except Exception as rollback_exc:
                logger.warning("Failed to rollback db session after bulk upload failure of '%s': %s", filename, rollback_exc)

    return {"notes": created, "failed": failed}
