from typing import Optional
from fastapi import APIRouter, Depends
from pydantic import BaseModel
from memolink_backend.di.request_container import RequestContainer, get_request_container
from memolink_backend.core.security import get_current_user
from fastapi import HTTPException
from memolink_backend.contracts.note_dtos import (
    NoteCreateDTO, NoteGetDTO, NoteListDTO, NoteUpdateDTO,
    NoteDeleteDTO, NoteSearchDTO, NoteResponseDTO, NotePublicAgentToggleDTO,
)


class NoteListRequest(BaseModel):
    workspace_id: Optional[int] = None

router = APIRouter(prefix="/notes", tags=["notes"])


@router.post("", response_model=NoteResponseDTO)
def create_note(
    dto: NoteCreateDTO,
    current_user_id: int = Depends(get_current_user),
    c: RequestContainer = Depends(get_request_container),
):
    note = c.notes().create_note(dto.model_copy(update={"user_id": current_user_id}))
    c.evaluation().mark_task(current_user_id, "create_note", "Create or upload a note", "note",
                             "note", getattr(note, "id", None))
    return note


@router.post("/get", response_model=NoteResponseDTO | None)
def get_note(
    dto: NoteGetDTO,
    _: int = Depends(get_current_user),
    c: RequestContainer = Depends(get_request_container),
):
    return c.notes().get_note(dto.note_id)


@router.post("/list")
def list_notes(
    req: NoteListRequest = NoteListRequest(),
    current_user_id: int = Depends(get_current_user),
    c: RequestContainer = Depends(get_request_container),
):
    return c.notes().list_notes(current_user_id, req.workspace_id)


@router.post("/update", response_model=NoteResponseDTO | None)
def update_note(
    dto: NoteUpdateDTO,
    _: int = Depends(get_current_user),
    c: RequestContainer = Depends(get_request_container),
):
    return c.notes().update_note(dto)


@router.post("/delete")
def delete_note(
    dto: NoteDeleteDTO,
    _: int = Depends(get_current_user),
    c: RequestContainer = Depends(get_request_container),
):
    return c.notes().delete_note(dto.note_id)


@router.post("/trash")
def list_trash(
    current_user_id: int = Depends(get_current_user),
    c: RequestContainer = Depends(get_request_container),
):
    return c.notes().list_trash(current_user_id)


@router.post("/restore")
def restore_note(
    dto: NoteDeleteDTO,
    _: int = Depends(get_current_user),
    c: RequestContainer = Depends(get_request_container),
):
    return {"ok": c.notes().restore_note(dto.note_id)}


@router.post("/permanent-delete")
def permanent_delete_note(
    dto: NoteDeleteDTO,
    _: int = Depends(get_current_user),
    c: RequestContainer = Depends(get_request_container),
):
    return {"ok": c.notes().permanent_delete_note(dto.note_id)}


@router.post("/search")
def search_notes(
    dto: NoteSearchDTO,
    _: int = Depends(get_current_user),
    c: RequestContainer = Depends(get_request_container),
):
    return c.notes().search_notes(dto.vector, dto.top_k)


@router.post("/public-agent", response_model=NoteResponseDTO | None)
def set_note_public_agent_enabled(
    dto: NotePublicAgentToggleDTO,
    current_user_id: int = Depends(get_current_user),
    c: RequestContainer = Depends(get_request_container),
):
    try:
        updated = c.notes().set_public_agent_enabled(dto.note_id, current_user_id, dto.enabled)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    if not updated:
        raise HTTPException(status_code=404, detail="Note not found")
    return updated
