from fastapi import APIRouter, UploadFile, File, Form, Depends
from memolink_backend.core.security import get_current_user
from memolink_backend.di.request_container import RequestContainer, get_request_container
from memolink_backend.utils.file_extractor import transcribe_audio

router = APIRouter(prefix="/transcribe", tags=["transcribe"])


@router.post("")
async def transcribe(
    file: UploadFile = File(...),
    language: str = Form(default=""),
    user_id: int = Depends(get_current_user),
    c: RequestContainer = Depends(get_request_container),
):
    audio_bytes = await file.read()
    filename = file.filename or "recording.webm"
    ext = filename.lower().rsplit(".", 1)[-1]
    size_mb = round(len(audio_bytes) / 1024 / 1024, 1)

    from memolink_backend.core.config import settings
    _WHISPER_LIMIT_MB = 25

    if size_mb > _WHISPER_LIMIT_MB:
        if settings.deepgram_api_key:
            c.logs().info("transcribe", f"File '{filename}' exceeds 25 MB — falling back to Deepgram Nova-2", {"filename": filename, "size_mb": size_mb, "fallback": "deepgram"}, user_id)
        else:
            c.logs().warning("transcribe", f"File '{filename}' exceeds 25 MB Whisper limit — no Deepgram key configured, transcription will be skipped", {"filename": filename, "size_mb": size_mb}, user_id)

    text = transcribe_audio(audio_bytes, filename, ext, language=language or None)

    if text.startswith("[Transcription skipped]"):
        c.logs().warning("transcribe", f"Transcription skipped for '{filename}'", {"filename": filename, "size_mb": size_mb, "reason": text}, user_id)
    elif text.startswith("[Transcription error]"):
        c.logs().error("transcribe", f"Transcription failed for '{filename}'", {"filename": filename, "size_mb": size_mb, "error": text}, user_id)
    else:
        service = "deepgram" if size_mb > _WHISPER_LIMIT_MB else "whisper"
        c.logs().info("transcribe", f"Transcription complete via {service} for '{filename}'", {"filename": filename, "size_mb": size_mb, "service": service}, user_id)

    return {"text": text}
