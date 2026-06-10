from __future__ import annotations

from fastapi import APIRouter, Depends

from memolink_backend.contracts.core_memory_dtos import (
    CoreMemoryCreateDTO,
    CoreMemoryResponseDTO,
    CoreMemoryRevealRequest,
    CoreMemoryUnlockRequest,
    CoreMemoryUnlockResponse,
    CoreMemoryUpdateDTO,
)
from memolink_backend.core.security import get_current_user
from memolink_backend.di.request_container import RequestContainer, get_request_container

router = APIRouter(prefix="/core-memory", tags=["core-memory"])


@router.post("/unlock", response_model=CoreMemoryUnlockResponse)
def unlock_vault(
    body: CoreMemoryUnlockRequest,
    user_id: int = Depends(get_current_user),
    container: RequestContainer = Depends(get_request_container),
):
    return container.core_memory().unlock(user_id, body.password)


@router.get("", response_model=list[CoreMemoryResponseDTO])
def list_memories(
    workspace_id: int | None = None,
    user_id: int = Depends(get_current_user),
    container: RequestContainer = Depends(get_request_container),
):
    return container.core_memory().list_memories(user_id, workspace_id)


@router.post("", response_model=CoreMemoryResponseDTO, status_code=201)
def create_memory(
    body: CoreMemoryCreateDTO,
    user_id: int = Depends(get_current_user),
    container: RequestContainer = Depends(get_request_container),
):
    return container.core_memory().create_memory(user_id, body)


@router.put("/{memory_id}", response_model=CoreMemoryResponseDTO)
def update_memory(
    memory_id: int,
    body: CoreMemoryUpdateDTO,
    user_id: int = Depends(get_current_user),
    container: RequestContainer = Depends(get_request_container),
):
    return container.core_memory().update_memory(user_id, memory_id, body)


@router.delete("/{memory_id}")
def delete_memory(
    memory_id: int,
    user_id: int = Depends(get_current_user),
    container: RequestContainer = Depends(get_request_container),
):
    container.core_memory().delete_memory(user_id, memory_id)
    return {"ok": True}


@router.post("/{memory_id}/reveal")
def reveal_memory(
    memory_id: int,
    body: CoreMemoryRevealRequest,
    user_id: int = Depends(get_current_user),
    container: RequestContainer = Depends(get_request_container),
):
    plaintext = container.core_memory().reveal_memory(user_id, memory_id, body.unlock_token)
    return {"plaintext": plaintext}
