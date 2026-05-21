import json
import logging
import os
import re
import tempfile
import urllib.request
from fastapi import APIRouter, HTTPException, Depends, UploadFile, File
from pydantic import BaseModel
from openai import OpenAI

from memolink_backend.core.security import get_current_user
from memolink_backend.core.config import settings

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/video", tags=["video"])

_YT_PATTERNS = [
    r"youtu\.be/([^?&#/]+)",
    r"[?&]v=([^?&#]+)",
    r"youtube\.com/embed/([^?&#/]+)",
    r"youtube\.com/shorts/([^?&#/]+)",
    r"youtube\.com/live/([^?&#/]+)",
]

MAX_UPLOAD_BYTES = 25 * 1024 * 1024  # 25 MB — Whisper API limit
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
    """Extract text from a transcript segment — handles both dict and object formats."""
    if isinstance(s, dict):
        return s.get("text") or ""
    return getattr(s, "text", None) or ""


def _yt_title(url: str, fallback: str) -> str:
    """Fetch YouTube title via oEmbed — no API key required."""
    try:
        oembed = f"https://www.youtube.com/oembed?url={url}&format=json"
        with urllib.request.urlopen(oembed, timeout=5) as r:
            data = json.loads(r.read())
            return data.get("title") or fallback
    except Exception:
        return fallback


def _import_youtube(url: str) -> dict:
    video_id = _extract_video_id(url)
    fallback_title = f"YouTube — {video_id}"

    try:
        from youtube_transcript_api import YouTubeTranscriptApi

        # v0.6.x+ requires instantiation — static/class methods no longer exist
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
    _: int = Depends(get_current_user),
):
    ext = os.path.splitext(file.filename or "")[1].lower()
    if ext not in ACCEPTED_EXT:
        raise HTTPException(
            status_code=422,
            detail=f"Unsupported file type '{ext}'. Accepted formats: {', '.join(sorted(ACCEPTED_EXT))}",
        )

    data = await file.read()
    size_mb = len(data) / 1024 / 1024
    if len(data) > MAX_UPLOAD_BYTES:
        raise HTTPException(
            status_code=422,
            detail=f"File is too large ({size_mb:.1f} MB). Maximum is 25 MB.",
        )

    openai_client = OpenAI(api_key=settings.openai_api_key)

    suffix = ext if ext else ".mp4"
    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
        tmp.write(data)
        tmp_path = tmp.name

    try:
        with open(tmp_path, "rb") as f:
            result = openai_client.audio.transcriptions.create(
                model="whisper-1",
                file=f,
                response_format="text",
            )
        text = result if isinstance(result, str) else getattr(result, "text", str(result))
        title = os.path.splitext(file.filename or "Recording")[0]
        return {"title": title, "content": _to_html(text), "method": "whisper"}
    finally:
        os.unlink(tmp_path)
