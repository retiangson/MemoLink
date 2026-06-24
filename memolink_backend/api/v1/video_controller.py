import json
import logging
import os
import re
import tempfile
import urllib.request
from fastapi import APIRouter, HTTPException, Depends, UploadFile, File
from pydantic import BaseModel
from openai import OpenAI
from sqlalchemy.orm import Session

from memolink_backend.core.db import get_db
from memolink_backend.core.security import get_current_user
from memolink_backend.core.config import settings
from memolink_backend.domain.repositories.system_log_repository import SystemLogRepository

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/video", tags=["video"])

_YT_PATTERNS = [
    r"youtu\.be/([^?&#/]+)",
    r"[?&]v=([^?&#]+)",
    r"youtube\.com/embed/([^?&#/]+)",
    r"youtube\.com/shorts/([^?&#/]+)",
    r"youtube\.com/live/([^?&#/]+)",
]

MAX_UPLOAD_BYTES = 200 * 1024 * 1024  # 200 MB
WHISPER_LIMIT = 25 * 1024 * 1024     # 25 MB - Whisper API hard limit
ACCEPTED_EXT = {".mp3", ".mp4", ".m4a", ".wav", ".webm", ".mpeg", ".mpga", ".mov"}


class VideoImportRequest(BaseModel):
    url: str


def _is_youtube(url: str) -> bool:
    return bool(re.search(r"(youtube\.com|youtu\.be)", url, re.I))


def _extract_video_id(url: str) -> str:
    for p in _YT_PATTERNS:
        m = re.search(p, url)
        if m:
            return m.group(1)
    raise ValueError("Cannot extract YouTube video ID from URL")


def _to_html(text: str, words_per_para: int = 80) -> str:
    words = text.split()
    chunks = [" ".join(words[i : i + words_per_para]) for i in range(0, len(words), words_per_para)]
    return "".join(f"<p>{c}</p>" for c in chunks if c.strip())


def _seg_text(s) -> str:
    """Extract text from a transcript segment - handles both dict and object formats."""
    if isinstance(s, dict):
        return s.get("text") or ""
    return getattr(s, "text", None) or ""


def _yt_title(url: str, fallback: str) -> str:
    """Fetch YouTube title via oEmbed - no API key required."""
    try:
        oembed = f"https://www.youtube.com/oembed?url={url}&format=json"
        with urllib.request.urlopen(oembed, timeout=5) as r:
            data = json.loads(r.read())
            return data.get("title") or fallback
    except Exception as exc:
        logger.debug("YouTube oEmbed title fetch failed for %s: %s", url, exc)
        return fallback


def _import_youtube(url: str) -> dict:
    video_id = _extract_video_id(url)
    fallback_title = f"YouTube - {video_id}"

    try:
        from youtube_transcript_api import YouTubeTranscriptApi

        # v0.6.x+ requires instantiation - static/class methods no longer exist
        ytt = YouTubeTranscriptApi()
        raw = None

        # 1. fetch() with English preference (v0.6.x primary API)
        try:
            raw = list(ytt.fetch(video_id, languages=["en", "en-US", "en-GB"]))
            logger.info("Caption path: fetch (en) for %s", video_id)
        except Exception as e1:
            logger.debug("fetch (en) failed: %s", e1)

        # 2. fetch() any language
        if raw is None:
            try:
                raw = list(ytt.fetch(video_id))
                logger.info("Caption path: fetch (any) for %s", video_id)
            except Exception as e2:
                logger.debug("fetch (any) failed: %s", e2)

        # 3. list_transcripts with translation fallback
        if raw is None:
            tl = ytt.list_transcripts(video_id)
            t = None
            for finder in (
                lambda x: x.find_manually_created_transcript(["en", "en-US", "en-GB"]),
                lambda x: x.find_generated_transcript(["en", "en-US", "en-GB"]),
                lambda x: next(iter(x)),
            ):
                try:
                    t = finder(tl)
                    break
                except Exception:
                    continue

            if t is None:
                raise RuntimeError("No transcripts found")

            if not t.language_code.startswith("en"):
                t = t.translate("en")

            raw = list(t.fetch())
            logger.info("Caption path: list_transcripts for %s", video_id)

        text = " ".join(_seg_text(s).replace("\n", " ") for s in raw if _seg_text(s).strip())
        if not text.strip():
            raise RuntimeError("Transcript was empty")

        title = _yt_title(url, fallback_title)
        return {"title": title, "content": _to_html(text), "method": "captions"}

    except Exception as exc:
        logger.warning("Caption fetch failed for %s: %s", video_id, exc)
        raise HTTPException(
            status_code=422,
            detail=f"Could not fetch captions: {exc}",
        )


@router.post("/import")
def import_video(req: VideoImportRequest, _: int = Depends(get_current_user)):
    url = req.url.strip()
    if not url:
        raise HTTPException(status_code=400, detail="URL is required")

    if _is_youtube(url):
        return _import_youtube(url)

    raise HTTPException(
        status_code=422,
        detail="Only YouTube URLs are supported for caption import. For Zoom, Teams, or Google Meet recordings please upload the video file directly.",
    )


@router.post("/upload")
async def upload_video(
    file: UploadFile = File(...),
    user_id: int = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    log_repo = SystemLogRepository(db)
    ext = os.path.splitext(file.filename or "")[1].lower()
    if ext not in ACCEPTED_EXT:
        log_repo.create("WARNING", "video.upload", f"Rejected unsupported file type '{ext}'", {"filename": file.filename}, user_id)
        raise HTTPException(
            status_code=422,
            detail=f"Unsupported file type '{ext}'. Accepted formats: {', '.join(sorted(ACCEPTED_EXT))}",
        )

    data = await file.read()
    size_mb = round(len(data) / 1024 / 1024, 1)
    if len(data) > MAX_UPLOAD_BYTES:
        log_repo.create("WARNING", "video.upload", f"Rejected oversized file ({size_mb} MB) - limit is 200 MB", {"filename": file.filename, "size_mb": size_mb}, user_id)
        raise HTTPException(
            status_code=422,
            detail=f"File is too large ({size_mb} MB). Maximum is 200 MB.",
        )

    use_deepgram = len(data) > WHISPER_LIMIT
    if use_deepgram:
        if settings.deepgram_api_key:
            log_repo.create("INFO", "video.upload", f"File '{file.filename}' exceeds 25 MB - falling back to Deepgram Nova-2", {"filename": file.filename, "size_mb": size_mb, "fallback": "deepgram"}, user_id)
        else:
            log_repo.create("WARNING", "video.upload", f"File '{file.filename}' exceeds 25 MB Whisper limit - no Deepgram key configured", {"filename": file.filename, "size_mb": size_mb}, user_id)
            raise HTTPException(status_code=422, detail=f"File is {size_mb} MB. Files over 25 MB require a Deepgram API key to be configured.")
    else:
        log_repo.create("INFO", "video.upload", f"Transcribing '{file.filename}' ({size_mb} MB) via Whisper", {"filename": file.filename, "size_mb": size_mb, "service": "whisper"}, user_id)

    suffix = ext if ext else ".mp4"
    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
        tmp.write(data)
        tmp_path = tmp.name

    try:
        if use_deepgram:
            from memolink_backend.utils.file_extractor import _transcribe_deepgram
            text = _transcribe_deepgram(data, file.filename or "audio", ext.lstrip("."))
            service = "deepgram"
        else:
            openai_client = OpenAI(api_key=settings.openai_api_key)
            with open(tmp_path, "rb") as f:
                result = openai_client.audio.transcriptions.create(
                    model="whisper-1", file=f, response_format="text",
                )
            text = result if isinstance(result, str) else getattr(result, "text", str(result))
            service = "whisper"

        title = os.path.splitext(file.filename or "Recording")[0]
        log_repo.create("INFO", "video.upload", f"Transcription complete via {service} for '{file.filename}'", {"filename": file.filename, "size_mb": size_mb, "service": service}, user_id)
        return {"title": title, "content": _to_html(text), "method": service}
    except Exception as exc:
        service = "deepgram" if use_deepgram else "whisper"
        log_repo.create("ERROR", "video.upload", f"{service.capitalize()} transcription failed for '{file.filename}': {exc}", {"filename": file.filename, "size_mb": size_mb, "service": service, "error": str(exc)}, user_id)
        raise HTTPException(status_code=500, detail=f"Transcription failed: {exc}")
    finally:
        os.unlink(tmp_path)
