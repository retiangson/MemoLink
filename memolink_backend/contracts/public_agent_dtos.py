from typing import Optional, List
from datetime import datetime
from pydantic import BaseModel, ConfigDict, field_validator

MAX_PUBLIC_MESSAGE_LENGTH = 2000

# Avatars are stored as base64 data URLs directly in the DB (no object storage in this
# codebase). Cap the encoded length so a visitor-facing widget never has to download an
# unreasonably large blob just to render a small avatar image.
MAX_AVATAR_DATA_URL_LENGTH = 700_000  # ~500KB of binary image data, base64-encoded


def _validate_avatar_url(value: Optional[str]) -> Optional[str]:
    if value is None:
        return None
    stripped = value.strip()
    if not stripped:
        return None
    if not stripped.startswith("data:image/"):
        raise ValueError("avatar_url must be an image data URL")
    if len(stripped) > MAX_AVATAR_DATA_URL_LENGTH:
        raise ValueError("avatar image is too large")
    return stripped


class PublicAgentCreateDTO(BaseModel):
    name: str
    workspace_id: int
    description: Optional[str] = None
    system_prompt: Optional[str] = None
    public_enabled: bool = False
    allowed_domains: Optional[str] = None
    avatar_url: Optional[str] = None

    @field_validator("avatar_url")
    @classmethod
    def _check_avatar(cls, value: Optional[str]) -> Optional[str]:
        return _validate_avatar_url(value)


class PublicAgentUpdateDTO(BaseModel):
    agent_id: int
    name: Optional[str] = None
    description: Optional[str] = None
    system_prompt: Optional[str] = None
    public_enabled: Optional[bool] = None
    allowed_domains: Optional[str] = None
    workspace_id: Optional[int] = None
    avatar_url: Optional[str] = None
    clear_avatar: bool = False

    @field_validator("avatar_url")
    @classmethod
    def _check_avatar(cls, value: Optional[str]) -> Optional[str]:
        return _validate_avatar_url(value)


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
    avatar_url: Optional[str] = None
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
