import io
import zipfile
from html.parser import HTMLParser

AUDIO_VIDEO_EXTS = {"mp3", "mp4", "mpeg", "mpga", "m4a", "mp4a", "wav", "webm", "ogg", "flac", "avi"}

_WHISPER_MIME: dict[str, str] = {
    "mp3": "audio/mpeg",
    "mp4": "video/mp4",
    "mpeg": "audio/mpeg",
    "mpga": "audio/mpeg",
    "m4a": "audio/mp4",
    "mp4a": "audio/mp4",
    "wav": "audio/wav",
    "webm": "audio/webm",
    "ogg": "audio/ogg",
    "flac": "audio/flac",
    "avi": "video/x-msvideo",
}

_WHISPER_LIMIT = 25 * 1024 * 1024  # 25 MB


class _HTMLTextExtractor(HTMLParser):
    def __init__(self):
        super().__init__()
        self._parts: list[str] = []
        self._skip = False

    def handle_starttag(self, tag, attrs):
        if tag.lower() in ("script", "style"):
            self._skip = True

    def handle_endtag(self, tag):
        if tag.lower() in ("script", "style"):
            self._skip = False

    def handle_data(self, data):
        if not self._skip:
            text = data.strip()
            if text:
                self._parts.append(text)


def extract_text_local(file_bytes: bytes, filename: str) -> str:
    ext = filename.lower().rsplit(".", 1)[-1]

    if ext == "txt":
        return file_bytes.decode("utf-8", errors="ignore")

    if ext in ("html", "htm"):
        try:
            parser = _HTMLTextExtractor()
            parser.feed(file_bytes.decode("utf-8", errors="ignore"))
            return "\n".join(parser._parts)
        except Exception as e:
            return f"[HTML extraction error] {e}"

    if ext == "pdf":
        try:
            import pdfplumber
            parts = []
            with pdfplumber.open(io.BytesIO(file_bytes)) as pdf:
                for page in pdf.pages:
                    parts.append(page.extract_text() or "")
            return "\n".join(parts)
        except Exception as e:
            return f"[PDF extraction error] {e}"

    if ext == "docx":
        try:
            import docx
            doc = docx.Document(io.BytesIO(file_bytes))
            return "\n".join(p.text for p in doc.paragraphs)
        except Exception as e:
            return f"[DOCX extraction error] {e}"

    if ext == "pptx":
        try:
            from pptx import Presentation
            prs = Presentation(io.BytesIO(file_bytes))
            parts = []
            for slide in prs.slides:
                for shape in slide.shapes:
                    if hasattr(shape, "text"):
                        parts.append(shape.text)
            return "\n".join(parts)
        except Exception as e:
            return f"[PPTX extraction error] {e}"

    if ext == "ppt":
        return (
            "Old .ppt format is not supported directly. "
            "Please open in PowerPoint, save as .pptx, and re-upload."
        )

    if ext == "zip":
        try:
            with zipfile.ZipFile(io.BytesIO(file_bytes)) as z:
                return "\n".join(
                    z.read(name).decode("utf-8", errors="ignore")
                    for name in z.namelist()
                    if name.lower().endswith(".txt")
                )
        except Exception as e:
            return f"[ZIP extraction error] {e}"

    if ext in AUDIO_VIDEO_EXTS:
        result = transcribe_audio(file_bytes, filename, ext)
        if result and not result.startswith("["):
            return f"[Audio transcription: {filename}]\n\n{result}"
        return result

    return ""


def transcribe_audio(file_bytes: bytes, filename: str, ext: str, language: str | None = None) -> str:
    try:
        if len(file_bytes) > _WHISPER_LIMIT:
            return f"[Transcription skipped] File exceeds the 25 MB Whisper limit."

        from openai import OpenAI
        from memolink_backend.core.config import settings

        client = OpenAI(api_key=settings.openai_api_key)
        mime = _WHISPER_MIME.get(ext, "audio/mpeg")

        kwargs: dict = dict(model="whisper-1", file=(filename, file_bytes, mime))
        if language:
            kwargs["language"] = language

        transcript = client.audio.transcriptions.create(**kwargs)
        return transcript.text
    except Exception as e:
        return f"[Transcription error] {e}"
