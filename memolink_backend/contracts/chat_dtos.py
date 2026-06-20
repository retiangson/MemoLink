from typing import List, Optional
from pydantic import BaseModel


class ChatRequestDTO(BaseModel):
    user_id: Optional[int] = None
    conversation_id: Optional[int] = None
    prompt: str
    top_k: int = 5
    workspace_id: Optional[int] = None
    cross_workspace: bool = False
    model: Optional[str] = None
    web_search: bool = False
    search_query_override: Optional[str] = None
    smart_mode: bool = True
    core_memory_unlock_token: Optional[str] = None
    spotify_device_id: Optional[str] = None


class ChatAnswerSource(BaseModel):
    note_id: int
    title: Optional[str]
    snippet: str


class ChatAttachmentDTO(BaseModel):
    filename: str
    content_type: Optional[str] = None
    size: Optional[int] = None


class ChatEmailAttachmentDTO(BaseModel):
    filename: str
    attachment_id: str
    size: int
    mime_type: str
    content_id: Optional[str] = None
    is_inline: bool = False


class ChatEmailResultDTO(BaseModel):
    """Mirrors the frontend's BrowseEmailResult shape so a chat-found email can be
    opened directly in a tab (useEmailTabs.openEmailTab) with no extra fetch."""
    id: Optional[int] = None
    gmail_message_id: Optional[str] = None
    gmail_thread_id: Optional[str] = None
    subject: str
    sender_name: Optional[str] = None
    sender_email: str
    snippet: Optional[str] = None
    body_text: Optional[str] = None
    body_html: Optional[str] = None
    attachments: List[ChatEmailAttachmentDTO] = []
    importance_score: float = 3.0
    is_read: bool = True
    email_date: Optional[str] = None
    email_account_id: Optional[int] = None
    email_address: Optional[str] = None
    is_pinned: bool = False


class ChatResponseDTO(BaseModel):
    answer: str
    sources: List[ChatAnswerSource] = []
    attachments: List[ChatAttachmentDTO] = []
    email_results: List[ChatEmailResultDTO] = []
    message_id: Optional[int] = None
    routing_reason: Optional[str] = None  # set when AutoPilot routed to a different model
