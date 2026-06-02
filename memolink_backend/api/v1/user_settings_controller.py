from typing import Optional
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from memolink_backend.core.security import get_current_user
from memolink_backend.di.request_container import RequestContainer, get_request_container

router = APIRouter(prefix="/settings", tags=["user-settings"])


class AddProviderBody(BaseModel):
    name: str
    key: str
    model: str
    base_url: Optional[str] = None


class UpdateProviderBody(BaseModel):
    name: Optional[str] = None
    key: Optional[str] = None
    model: Optional[str] = None
    base_url: Optional[str] = None


@router.get("/api-keys")
def list_providers(
    user_id: int = Depends(get_current_user),
    c: RequestContainer = Depends(get_request_container),
):
    providers = c.domain.get_user_api_key_repository().get_all_metadata(user_id)
    return {"providers": providers}


@router.post("/api-keys", status_code=201)
def add_provider(
    body: AddProviderBody,
    user_id: int = Depends(get_current_user),
    c: RequestContainer = Depends(get_request_container),
):
    name = body.name.strip()
    key = body.key.strip()
    model = body.model.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Provider name cannot be empty")
    if not key:
        raise HTTPException(status_code=400, detail="API key cannot be empty")
    if not model:
        raise HTTPException(status_code=400, detail="Model ID cannot be empty")
    repo = c.domain.get_user_api_key_repository()
    if repo.name_exists(user_id, name):
        raise HTTPException(status_code=409, detail=f'A provider named "{name}" already exists')
    repo.create(user_id, name, key, body.base_url.strip() if body.base_url else None, model)
    return {"ok": True}


@router.put("/api-keys/{provider_id}")
def update_provider(
    provider_id: int,
    body: UpdateProviderBody,
    user_id: int = Depends(get_current_user),
    c: RequestContainer = Depends(get_request_container),
):
    repo = c.domain.get_user_api_key_repository()
    name = body.name.strip() if body.name else None
    if name and repo.name_exists(user_id, name, exclude_id=provider_id):
        raise HTTPException(status_code=409, detail=f'A provider named "{name}" already exists')
    updated = repo.update_by_id(
        user_id=user_id,
        record_id=provider_id,
        name=name,
        plain_key=body.key.strip() if body.key else None,
        base_url=body.base_url.strip() if body.base_url else None,
        clear_base_url=(body.base_url == ""),
        model=body.model.strip() if body.model else None,
    )
    if not updated:
        raise HTTPException(status_code=404, detail="Provider not found")
    return {"ok": True}


@router.delete("/api-keys/{provider_id}")
def delete_provider(
    provider_id: int,
    user_id: int = Depends(get_current_user),
    c: RequestContainer = Depends(get_request_container),
):
    deleted = c.domain.get_user_api_key_repository().delete_by_id(user_id, provider_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Provider not found")
    return {"ok": True}
