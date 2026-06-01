import uuid
import boto3
from botocore.exceptions import ClientError
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from memolink_backend.di.request_container import RequestContainer, get_request_container
from memolink_backend.core.security import get_current_user
from memolink_backend.core.config import settings
from memolink_backend.contracts.note_dtos import NoteCreateDTO
from memolink_backend.utils.file_extractor import extract_formatted_html

router = APIRouter(prefix="/upload", tags=["upload"])

_200_MB = 200 * 1024 * 1024


# ── boto3 client helper ────────────────────────────────────────────────────────
# A new client is created on each call — Lambda may rotate credentials, so
# caching is intentionally avoided.

def _s3():
    kwargs = {"region_name": settings.aws_region}
    if settings.aws_access_key_id and settings.aws_secret_access_key:
        kwargs["aws_access_key_id"] = settings.aws_access_key_id
        kwargs["aws_secret_access_key"] = settings.aws_secret_access_key
    return boto3.client("s3", **kwargs)


# ── Request / Response schemas ─────────────────────────────────────────────────

class PresignRequest(BaseModel):
    filename: str
    content_type: str
    size_bytes: int


class PresignResponse(BaseModel):
    url: str
    key: str
    expires_in: int


class ProcessRequest(BaseModel):
    keys: List[str]
    workspace_id: Optional[int] = None


# ── POST /api/upload/presign ───────────────────────────────────────────────────

@router.post("/presign", response_model=PresignResponse)
def presign_upload(
    body: PresignRequest,
    current_user_id: int = Depends(get_current_user),
    c: RequestContainer = Depends(get_request_container),
):
    """Generate a pre-signed S3 PUT URL so the client can upload directly to S3,
    bypassing Lambda's 6 MB payload limit (supports files up to 200 MB)."""

    if body.size_bytes > _200_MB:
        raise HTTPException(
            status_code=422,
            detail=f"File size {round(body.size_bytes / 1024 / 1024, 1)} MB exceeds the 200 MB limit.",
        )

    if not settings.s3_upload_bucket:
        raise HTTPException(
            status_code=503,
            detail="S3 upload bucket is not configured on this server.",
        )

    key = f"uploads/{current_user_id}/{uuid.uuid4().hex}/{body.filename}"

    try:
        url = _s3().generate_presigned_url(
            "put_object",
            Params={
                "Bucket": settings.s3_upload_bucket,
                "Key": key,
                "ContentType": body.content_type,
            },
            ExpiresIn=3600,
        )
    except ClientError as exc:
        try:
            c.logs().error(
                "s3.presign",
                f"Failed to generate pre-signed URL for '{body.filename}': {exc}",
                {"filename": body.filename, "error": str(exc)},
                current_user_id,
            )
        except Exception:
            pass
        raise HTTPException(status_code=500, detail=f"Could not generate upload URL: {exc}")

    size_mb = round(body.size_bytes / 1024 / 1024, 2)
    try:
        c.logs().info(
            "s3.presign",
            f"Presigned S3 URL generated for '{body.filename}' ({size_mb} MB)",
            {"filename": body.filename, "size_mb": size_mb, "key": key},
            current_user_id,
        )
    except Exception:
        pass

    return PresignResponse(url=url, key=key, expires_in=3600)


# ── POST /api/upload/process ───────────────────────────────────────────────────

_WHISPER_LIMIT_BYTES = 25 * 1024 * 1024
_AUDIO_VIDEO_EXTS = {".mp3", ".mp4", ".m4a", ".wav", ".webm", ".ogg", ".flac", ".mpeg", ".mpga", ".mov", ".avi"}


@router.post("/process")
def process_from_s3(
    body: ProcessRequest,
    current_user_id: int = Depends(get_current_user),
    c: RequestContainer = Depends(get_request_container),
):
    """Download files from S3, extract text, create notes, then delete the
    temporary S3 objects.  Each key is processed independently so one failure
    does not block the others."""

    created = []
    failed: list[dict] = []
    db = c.domain.get_db()
    s3 = _s3()

    for key in body.keys:
        filename = key.split("/")[-1]
        content_bytes: bytes | None = None

        try:
            # 1. Download from S3
            try:
                obj = s3.get_object(Bucket=settings.s3_upload_bucket, Key=key)
                content_bytes = obj["Body"].read()
            except ClientError as exc:
                raise RuntimeError(f"S3 download failed: {exc}") from exc

            size_mb = round(len(content_bytes) / 1024 / 1024, 1)
            ext = "." + (filename.rsplit(".", 1)[-1].lower() if "." in filename else "")

            # 2. Audio/video size warnings (mirror bulk_controller logic)
            if ext in _AUDIO_VIDEO_EXTS and len(content_bytes) > _WHISPER_LIMIT_BYTES:
                if settings.deepgram_api_key:
                    try:
                        c.logs().info(
                            "s3.process",
                            f"File '{filename}' exceeds 25 MB — falling back to Deepgram Nova-2",
                            {"filename": filename, "size_mb": size_mb, "fallback": "deepgram"},
                            current_user_id,
                        )
                    except Exception:
                        pass
                else:
                    try:
                        c.logs().warning(
                            "s3.process",
                            f"File '{filename}' exceeds 25 MB Whisper limit — no Deepgram key, transcription will be skipped",
                            {"filename": filename, "size_mb": size_mb},
                            current_user_id,
                        )
                    except Exception:
                        pass

            # 3. Extract text
            html_content = extract_formatted_html(content_bytes, filename).replace("\x00", "")

            # 4. Transcription-skipped warning
            if "[Transcription skipped]" in html_content:
                try:
                    c.logs().warning(
                        "s3.process",
                        f"Transcription skipped for '{filename}' — file exceeds Whisper 25 MB limit",
                        {"filename": filename, "size_mb": size_mb},
                        current_user_id,
                    )
                except Exception:
                    pass

            # 5. Nothing extracted
            if not html_content.strip() or html_content.strip() == "<p></p>":
                reason = "No text could be extracted (scanned or image-only file?)"
                failed.append({"filename": filename, "reason": reason})
                try:
                    c.logs().warning(
                        "s3.process",
                        f"No text extracted from '{filename}'",
                        {"filename": filename, "size_mb": size_mb},
                        current_user_id,
                    )
                except Exception:
                    pass
                continue

            # 6. Create note
            dto = NoteCreateDTO(
                user_id=current_user_id,
                title=filename,
                content=html_content,
                source=filename,
                workspace_id=body.workspace_id,
            )
            note = c.notes().create_note(dto)
            created.append(note)

            try:
                c.logs().info(
                    "s3.process",
                    f"Note created from '{filename}'",
                    {"filename": filename, "size_mb": size_mb},
                    current_user_id,
                )
            except Exception:
                pass

        except Exception as exc:
            failed.append({"filename": filename, "reason": str(exc)})
            try:
                c.logs().error(
                    "s3.process",
                    f"Failed to process '{filename}': {exc}",
                    {"filename": filename, "error": str(exc)},
                    current_user_id,
                )
            except Exception:
                pass
            try:
                db.rollback()
            except Exception:
                pass

        finally:
            # Always delete the S3 object — whether processing succeeded or failed
            try:
                s3.delete_object(Bucket=settings.s3_upload_bucket, Key=key)
            except Exception as del_exc:
                try:
                    c.logs().warning(
                        "s3.process",
                        f"Failed to delete S3 object '{key}': {del_exc}",
                        {"key": key, "error": str(del_exc)},
                        current_user_id,
                    )
                except Exception:
                    pass

    return {"notes": created, "failed": failed}
