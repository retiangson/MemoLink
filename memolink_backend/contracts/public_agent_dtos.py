from typing import Optional, List
from datetime import datetime
from pydantic import BaseModel, ConfigDict, field_validator

MAX_PUBLIC_MESSAGE_LENGTH = 2000


class PublicAgentCreateDTO(BaseModel):
    name: str
    workspace_id: int
    description: Optional[str] = None
    system_prompt: Optional[str] = None
    public_enabled: bool = False
    allowed_domains: Optional[str] = None


class PublicAgentUpdateDTO(BaseModel):
    agent_id: int
    name: Optional[str] = None
    description: Optional[str] = None
    system_prompt: Optional[str] = None
    public_enabled: Optional[bool] = None
    allowed_domains: Optional[str] = None
    workspace_id: Optional[int] = None


class PublicAgentGetDTO(BaseModel):
    agent_id: int


class PublicAgentDeleteDTO(BaseModel):
    agent_id: int


class PublicAgentRegenerateTokenDTO(BaseModel):
    agent_id: int


class PublicAgentResponseDTO(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    token: str
    workspace_id: int
    description: Optional[str] = None
    system_prompt: Optional[str] = None
    public_enabled: bool
    allowed_domains: Optional[str] = None
    created_by: int
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None


class PublicAgentChatSource(BaseModel):
    note_id: int
    title: Optional[str] = None


class PublicAgentChatRequestDTO(BaseModel):
    message: str

    @field_validator("message")
    @classmethod
    def _validate_message(cls, value: str) -> str:
        stripped = value.strip()
        if not stripped:
            raise ValueError("message must not be empty")
        if len(stripped) > MAX_PUBLIC_MESSAGE_LENGTH:
            raise ValueError(f"message must be {MAX_PUBLIC_MESSAGE_LENGTH} characters or fewer")
        return stripped


class PublicAgentChatResponseDTO(BaseModel):
    answer: str
    sources: List[PublicAgentChatSource] = []
