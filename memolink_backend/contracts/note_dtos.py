from typing import Optional, List
from pydantic import BaseModel, ConfigDict


class NoteCreateDTO(BaseModel):
    user_id: Optional[int] = None
    title: Optional[str] = None
    content: str
    source: Optional[str] = None
    workspace_id: Optional[int] = None


class NoteResponseDTO(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    user_id: int
    title: Optional[str]
    content: str
    source: Optional[str]
    workspace_id: Optional[int] = None
    public_agent_enabled: bool = False


class NoteGetDTO(BaseModel):
    note_id: int


class NoteListDTO(BaseModel):
    user_id: Optional[int] = None
    workspace_id: Optional[int] = None


class NoteUpdateDTO(BaseModel):
    note_id: int
    title: Optional[str] = None
    content: Optional[str] = None


class NoteDeleteDTO(BaseModel):
    note_id: int


class NoteSearchDTO(BaseModel):
    vector: List[float]
    top_k: int = 5


class NotePublicAgentToggleDTO(BaseModel):
    note_id: int
    enabled: bool
