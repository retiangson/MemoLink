from __future__ import annotations

from datetime import datetime
from typing import Optional

from pydantic import BaseModel, ConfigDict


class CoreMemoryUnlockRequest(BaseModel):
    password: str


class CoreMemoryUnlockResponse(BaseModel):
    unlock_token: str
    expires_at: datetime


class CoreMemoryCreateDTO(BaseModel):
    title: str
    memory_type: str = "general"
    sensitivity_level: str = "low"
    plaintext_value: Optional[str] = None
    masked_display: Optional[str] = None
    searchable_metadata: Optional[str] = None
    workspace_id: Optional[int] = None


class CoreMemoryUpdateDTO(BaseModel):
    title: Optional[str] = None
    memory_type: Optional[str] = None
    sensitivity_level: Optional[str] = None
    masked_display: Optional[str] = None
    searchable_metadata: Optional[str] = None


class CoreMemoryResponseDTO(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    title: Optional[str]
    memory_type: Optional[str]
    sensitivity_level: Optional[str]
    masked_content: Optional[str]
    searchable_content: Optional[str]
    memory_source: Optional[str]
    memory_confidence: Optional[float]
    memory_last_used_at: Optional[datetime]
    is_encrypted: Optional[bool]
    created_at: Optional[datetime]
    workspace_id: Optional[int] = None


class CoreMemoryRevealRequest(BaseModel):
    unlock_token: str
