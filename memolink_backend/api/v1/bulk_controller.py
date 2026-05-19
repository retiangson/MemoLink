from fastapi import APIRouter, UploadFile, File, Depends
from typing import List
from memolink_backend.di.request_container import RequestContainer, get_request_container
from memolink_backend.core.security import get_current_user
from memolink_backend.contracts.note_dtos import NoteCreateDTO
from memolink_backend.utils.file_extractor import extract_text_local

router = APIRouter(prefix="/notes", tags=["notes"])


def _text_to_html(text: str) -> str:
    """Wrap plain-text lines in <p> tags so content is valid HTML for the rich editor."""
    lines = text.splitlines()
    parts = [f"<p>{line}</p>" if line.strip() else "<p></p>" for line in lines]
    return "".join(parts) or f"<p>{text}</p>"


@router.post("/bulk")
async def bulk_upload(
    files: List[UploadFile] = File(...),
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
            text = extract_text_local(content_bytes, filename).replace("\x00", "")
            if not text.strip():
                failed.append({"filename": filename, "reason": "No text could be extracted (scanned or image-only file?)"})
                continue

            # Convert plain text to HTML paragraphs; leave HTML content as-is
            html_content = text if text.strip().startswith("<") else _text_to_html(text)

            dto = NoteCreateDTO(user_id=current_user_id, title=filename, content=html_content, source=filename)
            note = c.notes().create_note(dto)
            created.append(note)
        except Exception as exc:
            failed.append({"filename": filename, "reason": str(exc)})
            try:
                db.rollback()
            except Exception:
                pass

    return {"notes": created, "failed": failed}
