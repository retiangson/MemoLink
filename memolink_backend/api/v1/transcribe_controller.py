from fastapi import APIRouter, UploadFile, File, Form, Depends
from pydantic import BaseModel
from memolink_backend.core.security import get_current_user
from memolink_backend.di.request_container import RequestContainer, get_request_container

router = APIRouter(prefix="/transcribe", tags=["transcribe"])


class LectureFinalizeBody(BaseModel):
    transcript_text: str
    language: str = ""


@router.post("")
async def transcribe(
    file: UploadFile = File(...),
    language: str = Form(default=""),
    mode: str = Form(default="default"),
    backend: str = Form(default="auto"),
    prompt_context: str = Form(default=""),
    user_id: int = Depends(get_current_user),
    c: RequestContainer = Depends(get_request_container),
):
    audio_bytes = await file.read()
    filename = file.filename or "recording.webm"
    ext = filename.lower().rsplit(".", 1)[-1]
    size_mb = round(len(audio_bytes) / 1024 / 1024, 1)

    from memolink_backend.core.config import settings
    _DEEPGRAM_THRESHOLD_MB = 5

    if size_mb >= _DEEPGRAM_THRESHOLD_MB:
        if settings.deepgram_api_key:
            c.logs().info("transcribe", f"File '{filename}' is ≥ 5 MB - routing to Deepgram Nova-2", {"filename": filename, "size_mb": size_mb, "service": "deepgram"}, user_id)
        else:
            c.logs().warning("transcribe", f"File '{filename}' is ≥ 5 MB but no Deepgram key - will attempt Whisper fallback", {"filename": filename, "size_mb": size_mb}, user_id)

    result = c.transcription().transcribe_upload(
        file_bytes=audio_bytes,
        filename=filename,
        language=language or None,
        backend=backend,
        mode=mode,
        prompt_context=prompt_context or None,
    )
    text = result["text"]

    if text.startswith("[Transcription skipped]"):
        c.logs().warning("transcribe", f"Transcription skipped for '{filename}'", {"filename": filename, "size_mb": size_mb, "reason": text}, user_id)
    elif text.startswith("[Transcription error]"):
        c.logs().error("transcribe", f"Transcription failed for '{filename}'", {"filename": filename, "size_mb": size_mb, "error": text}, user_id)
    else:
        service = result["service_used"]
        c.logs().info("transcribe", f"Transcription complete via {service} for '{filename}'", {"filename": filename, "size_mb": size_mb, "service": service, "mode": mode, "backend_requested": backend, "fallback_used": bool(result.get("fallback_used"))}, user_id)

    return result


@router.post("/lecture/finalize")
def finalize_lecture_transcript(
    body: LectureFinalizeBody,
    user_id: int = Depends(get_current_user),
    c: RequestContainer = Depends(get_request_container),
):
    result = c.transcription().finalize_lecture(body.transcript_text, language=body.language or None)
    c.logs().info(
        "transcribe.lecture.finalize",
        "Lecture transcript finalized",
        {
            "word_count": len((body.transcript_text or "").split()),
            "action_items": len(result.get("action_items") or []),
            "topics": len(result.get("key_topics") or []),
        },
        user_id,
    )
    return result
