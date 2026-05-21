from typing import Optional
from pydantic import BaseModel


class UserID(BaseModel):
    user_id: Optional[int] = None


class CreateConvDTO(BaseModel):
    user_id: Optional[int] = None
    workspace_id: Optional[int] = None


class ListConvDTO(BaseModel):
    workspace_id: Optional[int] = None


class ConvID(BaseModel):
    conversation_id: int


class RenameDTO(BaseModel):
    conversation_id: int
    title: str


class DeleteDTO(BaseModel):
    conversation_id: int


class DeleteMessageDTO(BaseModel):
    message_id: int


class AddToNoteDTO(BaseModel):
    user_id: Optional[int] = None
    content: str
    title: Optional[str] = None
