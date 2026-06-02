"""
Study Mode DTOs
===============
Request and response contracts for the AI Study Mode endpoints.
"""

from typing import List, Optional, Dict
from pydantic import BaseModel


# ── Flashcards ────────────────────────────────────────────────────────────────

class FlashcardsRequest(BaseModel):
    workspace_id: int
    note_id: Optional[int] = None   # None = all notes in workspace
    count: int = 10


class FlashcardItem(BaseModel):
    question: str
    answer: str


class FlashcardsResponse(BaseModel):
    cards: List[FlashcardItem]
    note_title: Optional[str] = None
    source_count: int = 0


# ── Exam Review ───────────────────────────────────────────────────────────────

class ExamReviewRequest(BaseModel):
    workspace_id: int
    note_ids: List[int] = []        # empty = all notes in workspace


class DefinitionItem(BaseModel):
    term: str
    definition: str


class ExamReviewResponse(BaseModel):
    key_concepts: List[str]
    definitions: List[DefinitionItem]
    important_facts: List[str]
    likely_questions: List[str]
    focus_topics: List[str]
    overview: str


# ── Study Plan ────────────────────────────────────────────────────────────────

class StudyPlanRequest(BaseModel):
    workspace_id: int
    days: int = 7
    goal: str = ""


class StudyPlanDay(BaseModel):
    day: int
    label: str          # e.g. "Day 1"
    focus: str
    topics: List[str]
    tasks: List[str]
    note_titles: List[str]


class StudyPlanResponse(BaseModel):
    overall_goal: str
    plan: List[StudyPlanDay]


# ── Weak Topics ───────────────────────────────────────────────────────────────

class WeakTopicsRequest(BaseModel):
    workspace_id: int


class WeakTopic(BaseModel):
    topic: str
    frequency: int
    simple_explanation: str
    study_tip: str


class WeakTopicsResponse(BaseModel):
    topics: List[WeakTopic]
    message: Optional[str] = None   # e.g. "Not enough conversation history yet"


# ── Quiz ─────────────────────────────────────────────────────────────────────

class QuizRequest(BaseModel):
    workspace_id: int
    note_id: Optional[int] = None   # None = all notes
    count: int = 10


class QuizQuestion(BaseModel):
    id: int
    type: str           # "single" | "multi"
    question: str
    options: List[str]
    correct: List[int]
    explanation: str


class QuizResponse(BaseModel):
    title: str
    questions: List[QuizQuestion]


# ── Summary Levels ────────────────────────────────────────────────────────────

class SummaryRequest(BaseModel):
    workspace_id: int
    note_id: int
    level: str = "medium"           # short | medium | detailed


class SummaryResponse(BaseModel):
    note_title: str
    level: str
    summary: str
    bullet_points: Optional[List[str]] = None
