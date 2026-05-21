from typing import List, Optional
from pydantic import BaseModel


class ChatRequestDTO(BaseModel):
    user_id: Optional[int] = None
    conversation_id: Optional[int] = None
    prompt: str
    top_k: int = 5
    workspace_id: Optional[int] = None
    cross_workspace: bool = False


class ChatAnswerSource(BaseModel):
    note_id: int
    title: Optional[str]
    snippet: str


class ChatAttachmentDTO(BaseModel):
    filename: str
    content_type: Optional[str] = None
    size: Optional[int] = None


class ChatResponseDTO(BaseModel):
    answer: str
    sources: List[ChatAnswerSource] = []
    attachments: List[ChatAttachmentDTO] = []
    message_id: Optional[int] = None
