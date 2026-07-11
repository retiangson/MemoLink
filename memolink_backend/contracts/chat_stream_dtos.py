from __future__ import annotations

import json
from typing import List, Literal, Optional

from pydantic import BaseModel

from memolink_backend.contracts.chat_dtos import ChatEmailResultDTO, ChatAnswerSource


class ChatStreamEvent(BaseModel):
    type: str


class MessageDeltaEvent(ChatStreamEvent):
    type: Literal["message.delta"] = "message.delta"
    text: str


class MessageReplaceEvent(ChatStreamEvent):
    type: Literal["message.replace"] = "message.replace"
    content: str


class MessageCompleteEvent(ChatStreamEvent):
    type: Literal["message.complete"] = "message.complete"
    message_id: Optional[int] = None
    model: Optional[str] = None
    confidence: Optional[str] = None
    confidence_reason: Optional[str] = None
    routing_reason: Optional[str] = None
    suggest_web_search: bool = False
    search_query_suggestion: Optional[str] = None
    email_results: List[ChatEmailResultDTO] = []
    sources: List[ChatAnswerSource] = []


class NoteCloseEvent(ChatStreamEvent):
    type: Literal["note.close"] = "note.close"
    note_id: int


class NoteImprovingEvent(ChatStreamEvent):
    type: Literal["note.improving"] = "note.improving"
    title: str


class ImageGeneratingEvent(ChatStreamEvent):
    type: Literal["image.generating"] = "image.generating"


class ToolStartEvent(ChatStreamEvent):
    type: Literal["tool.start"] = "tool.start"
    label: str
    tool_call: Optional[str] = None


class ToolCompleteEvent(ChatStreamEvent):
    type: Literal["tool.complete"] = "tool.complete"
    ok: bool
    result: Optional[str] = None


def sse_event(event: ChatStreamEvent) -> str:
    return f"data: {json.dumps(event.model_dump(exclude_none=True))}\n\n"
