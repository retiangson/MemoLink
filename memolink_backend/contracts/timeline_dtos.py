"""
Timeline DTOs — request/response contracts for the Meeting/Lecture Timeline feature.
"""

from typing import List, Optional
from pydantic import BaseModel


class TimelineChapter(BaseModel):
    timestamp: str          # "00:03:12"
    seconds: int
    title: str
    summary: str
    key_phrase: str         # exact text fragment — used by frontend to scroll to position


class TimelineActionItem(BaseModel):
    timestamp: str
    seconds: int
    text: str
    assignee: Optional[str] = None
    key_phrase: str


class TimelineImportantMoment(BaseModel):
    timestamp: str
    seconds: int
    text: str
    type: str               # decision | warning | key_point | deadline | question
    key_phrase: str


class TimelineResponse(BaseModel):
    note_id: int
    summary: str
    chapters: List[TimelineChapter]
    action_items: List[TimelineActionItem]
    important_moments: List[TimelineImportantMoment]
    estimated_duration_seconds: Optional[int] = None
    word_count: Optional[int] = None
    exists: bool = False    # True when returning cached; False when freshly generated
