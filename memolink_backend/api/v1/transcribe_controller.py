from fastapi import APIRouter, UploadFile, File, Form, Depends
from memolink_backend.core.security import get_current_user
from memolink_backend.utils.file_extractor import transcribe_audio

router = APIRouter(prefix="/transcribe", tags=["transcribe"])


@router.post("")
async def transcribe(
    file: UploadFile = File(...),
    language: str = Form(default=""),
    _: int = Depends(get_current_user),
):
    audio_bytes = await file.read()
    filename = file.filename or "recording.webm"
    ext = filename.lower().rsplit(".", 1)[-1]
    text = transcribe_audio(audio_bytes, filename, ext, language=language or None)
    return {"text": text}
