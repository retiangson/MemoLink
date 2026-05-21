from pydantic import BaseModel
from typing import Optional
from datetime import datetime

VALID_TYPES = {"Academic", "Professional", "Personal", "Project", "Other"}


class WorkspaceCreateDTO(BaseModel):
    name: str
    type: str = "Other"
    description: Optional[str] = None


class WorkspaceGetDTO(BaseModel):
    workspace_id: int


class WorkspaceUpdateDTO(BaseModel):
    workspace_id: int
    name: Optional[str] = None
    type: Optional[str] = None
    description: Optional[str] = None


class WorkspaceDeleteDTO(BaseModel):
    workspace_id: int


class WorkspaceSetActiveDTO(BaseModel):
    workspace_id: int


class WorkspaceResponseDTO(BaseModel):
    id: int
    user_id: int
    name: str
    type: str
    description: Optional[str]
    is_default: bool
    last_accessed_at: Optional[datetime]
    created_at: Optional[datetime]
    alert_count: int = 0

    model_config = {"from_attributes": True}
