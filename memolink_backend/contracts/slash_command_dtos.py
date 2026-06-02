from typing import Optional
from pydantic import BaseModel

class SlashCommandRequestDTO(BaseModel):
    command: str                         # full text, e.g. "/Improve All"
    user_id: Optional[int] = None
    conversation_id: Optional[int] = None
    workspace_id: Optional[int] = None
    model: Optional[str] = None
