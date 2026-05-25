from fastapi import APIRouter, UploadFile, File, Form, Depends
from typing import List, Optional
from memolink_backend.di.request_container import RequestContainer, get_request_container
from memolink_backend.core.security import get_current_user
from memolink_backend.contracts.note_dtos import NoteCreateDTO
from memolink_backend.utils.file_extractor import extract_formatted_html

router = APIRouter(prefix="/notes", tags=["notes"])


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
            html_content = extract_formatted_html(content_bytes, filename).replace("\x00", "")
            if not html_content.strip() or html_content.strip() == "<p></p>":
                failed.append({"filename": filename, "reason": "No text could be extracted (scanned or image-only file?)"})
                continue

            dto = NoteCreateDTO(user_id=current_user_id, title=filename, content=html_content, source=filename, workspace_id=workspace_id)
            note = c.notes().create_note(dto)
            created.append(note)
        except Exception as exc:
            failed.append({"filename": filename, "reason": str(exc)})
            try:
                db.rollback()
            except Exception:
                pass

    return {"notes": created, "failed": failed}
