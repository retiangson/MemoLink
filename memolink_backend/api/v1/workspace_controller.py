from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from memolink_backend.core.db import get_db
from memolink_backend.core.security import get_current_user
from memolink_backend.domain.repositories.workspace_repository import WorkspaceRepository
from memolink_backend.contracts.workspace_dtos import (
    WorkspaceCreateDTO, WorkspaceGetDTO, WorkspaceUpdateDTO,
    WorkspaceDeleteDTO, WorkspaceSetActiveDTO, VALID_TYPES,
)

router = APIRouter(prefix="/workspaces", tags=["workspaces"])


def _serialize(ws, alert_count: int = 0) -> dict:
    return {
        "id": ws.id,
        "user_id": ws.user_id,
        "name": ws.name,
        "type": ws.type,
        "description": ws.description,
        "is_default": ws.is_default,
        "last_accessed_at": ws.last_accessed_at.isoformat() if ws.last_accessed_at else None,
        "created_at": ws.created_at.isoformat() if ws.created_at else None,
        "alert_count": alert_count,
    }


@router.post("")
def create_workspace(
    dto: WorkspaceCreateDTO,
    user_id: int = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if dto.type not in VALID_TYPES:
        raise HTTPException(status_code=422, detail=f"type must be one of: {', '.join(sorted(VALID_TYPES))}")
    repo = WorkspaceRepository(db)
    if repo.name_exists_for_user(user_id, dto.name.strip()):
        raise HTTPException(status_code=400, detail="A workspace with this name already exists")
    is_default = repo.count_active_for_user(user_id) == 0
    ws = repo.create(user_id, dto.name.strip(), dto.type, dto.description, is_default)
    if is_default:
        repo.set_last_accessed(ws.id)
        db.refresh(ws)
    return _serialize(ws, repo.get_alert_count(ws.id))


@router.post("/list")
def list_workspaces(
    user_id: int = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    repo = WorkspaceRepository(db)
    workspaces = repo.get_for_user(user_id)
    return [_serialize(ws, repo.get_alert_count(ws.id)) for ws in workspaces]


@router.post("/get")
def get_workspace(
    dto: WorkspaceGetDTO,
    user_id: int = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    repo = WorkspaceRepository(db)
    ws = repo.get_by_id(dto.workspace_id)
    if not ws:
        raise HTTPException(status_code=404, detail="Workspace not found")
    if ws.user_id != user_id:
        raise HTTPException(status_code=403, detail="Access denied")
    return _serialize(ws, repo.get_alert_count(ws.id))


@router.post("/update")
def update_workspace(
    dto: WorkspaceUpdateDTO,
    user_id: int = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    repo = WorkspaceRepository(db)
    ws = repo.get_by_id(dto.workspace_id)
    if not ws:
        raise HTTPException(status_code=404, detail="Workspace not found")
    if ws.user_id != user_id:
        raise HTTPException(status_code=403, detail="Access denied")
    if dto.type and dto.type not in VALID_TYPES:
        raise HTTPException(status_code=422, detail=f"type must be one of: {', '.join(sorted(VALID_TYPES))}")
    if dto.name and repo.name_exists_for_user(user_id, dto.name.strip(), exclude_id=dto.workspace_id):
        raise HTTPException(status_code=400, detail="A workspace with this name already exists")
    updated = repo.update(dto.workspace_id, dto.name.strip() if dto.name else None, dto.type, dto.description)
    return _serialize(updated, repo.get_alert_count(updated.id))


@router.post("/delete")
def delete_workspace(
    dto: WorkspaceDeleteDTO,
    user_id: int = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    repo = WorkspaceRepository(db)
    ws = repo.get_by_id(dto.workspace_id)
    if not ws:
        raise HTTPException(status_code=404, detail="Workspace not found")
    if ws.user_id != user_id:
        raise HTTPException(status_code=403, detail="Access denied")
    if repo.count_active_for_user(user_id) <= 1:
        raise HTTPException(status_code=409, detail="Cannot delete your only workspace")
    repo.soft_delete(dto.workspace_id)
    return {"ok": True}


@router.post("/set-active")
def set_active_workspace(
    dto: WorkspaceSetActiveDTO,
    user_id: int = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    repo = WorkspaceRepository(db)
    ws = repo.get_by_id(dto.workspace_id)
    if not ws:
        raise HTTPException(status_code=404, detail="Workspace not found")
    if ws.user_id != user_id:
        raise HTTPException(status_code=403, detail="Access denied")
    updated = repo.set_last_accessed(dto.workspace_id)
    return _serialize(updated, repo.get_alert_count(updated.id))


@router.post("/active")
def get_active_workspace(
    user_id: int = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    repo = WorkspaceRepository(db)
    ws = repo.get_active_for_user(user_id)
    if not ws:
        raise HTTPException(status_code=404, detail="No workspace found — redirect to onboarding")
    return _serialize(ws, repo.get_alert_count(ws.id))
