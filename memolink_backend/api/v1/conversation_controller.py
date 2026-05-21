from fastapi import APIRouter, Depends
from memolink_backend.di.request_container import RequestContainer, get_request_container
from memolink_backend.core.security import get_current_user
from memolink_backend.contracts.conversation_dtos import (
    CreateConvDTO, ListConvDTO, ConvID, RenameDTO, DeleteDTO, DeleteMessageDTO, AddToNoteDTO,
)

router = APIRouter(prefix="/conversation", tags=["conversation"])


@router.post("/list")
def list_conversations(
    dto: ListConvDTO = ListConvDTO(),
    current_user_id: int = Depends(get_current_user),
    c: RequestContainer = Depends(get_request_container),
):
    return c.conversations().list_for_user(current_user_id, dto.workspace_id)


@router.post("/create")
def create_conversation(
    dto: CreateConvDTO = CreateConvDTO(),
    current_user_id: int = Depends(get_current_user),
    c: RequestContainer = Depends(get_request_container),
):
    return c.conversations().create(current_user_id, workspace_id=dto.workspace_id)


@router.post("/messages")
def get_messages(
    dto: ConvID,
    limit: int = 10,
    before_id: int | None = None,
    _: int = Depends(get_current_user),
    c: RequestContainer = Depends(get_request_container),
):
    return c.conversations().get_messages_paginated(dto.conversation_id, limit, before_id)


@router.post("/rename")
def rename_conversation(
    dto: RenameDTO,
    _: int = Depends(get_current_user),
    c: RequestContainer = Depends(get_request_container),
):
    return c.conversations().rename(dto.conversation_id, dto.title)


@router.post("/delete")
def delete_conversation(
    dto: DeleteDTO,
    _: int = Depends(get_current_user),
    c: RequestContainer = Depends(get_request_container),
):
    return c.conversations().delete(dto.conversation_id)


@router.post("/trash")
def list_trash(
    current_user_id: int = Depends(get_current_user),
    c: RequestContainer = Depends(get_request_container),
):
    return c.conversations().list_trash(current_user_id)


@router.post("/restore")
def restore_conversation(
    dto: DeleteDTO,
    _: int = Depends(get_current_user),
    c: RequestContainer = Depends(get_request_container),
):
    return {"ok": c.conversations().restore_conversation(dto.conversation_id)}


@router.post("/permanent-delete")
def permanent_delete_conversation(
    dto: DeleteDTO,
    _: int = Depends(get_current_user),
    c: RequestContainer = Depends(get_request_container),
):
    return {"ok": c.conversations().permanent_delete_conversation(dto.conversation_id)}


@router.post("/delete-message")
def delete_message(
    dto: DeleteMessageDTO,
    _: int = Depends(get_current_user),
    c: RequestContainer = Depends(get_request_container),
):
    return c.conversations().delete_message(dto.message_id)


@router.post("/add-to-note")
def add_to_note(
    dto: AddToNoteDTO,
    current_user_id: int = Depends(get_current_user),
    c: RequestContainer = Depends(get_request_container),
):
    return c.conversations().add_message_to_note(current_user_id, dto.content, dto.title)
