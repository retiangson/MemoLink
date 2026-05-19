from fastapi import APIRouter, Depends
from memolink_backend.di.request_container import RequestContainer, get_request_container
from memolink_backend.core.security import get_current_user
from memolink_backend.contracts.note_dtos import (
    NoteCreateDTO, NoteGetDTO, NoteListDTO, NoteUpdateDTO,
    NoteDeleteDTO, NoteSearchDTO, NoteResponseDTO,
)

router = APIRouter(prefix="/notes", tags=["notes"])


@router.post("", response_model=NoteResponseDTO)
def create_note(
    dto: NoteCreateDTO,
    current_user_id: int = Depends(get_current_user),
    c: RequestContainer = Depends(get_request_container),
):
    return c.notes().create_note(dto.model_copy(update={"user_id": current_user_id}))


@router.post("/get", response_model=NoteResponseDTO | None)
def get_note(
    dto: NoteGetDTO,
    _: int = Depends(get_current_user),
    c: RequestContainer = Depends(get_request_container),
):
    return c.notes().get_note(dto.note_id)


@router.post("/list")
def list_notes(
    current_user_id: int = Depends(get_current_user),
    c: RequestContainer = Depends(get_request_container),
):
    return c.notes().list_notes(current_user_id)


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
