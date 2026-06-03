"""
Evaluation Survey DTOs
======================
"""
from typing import List, Optional, Dict, Any
from pydantic import BaseModel


# ── Questions (shared) ───────────────────────────────────────────────────────

class SurveyQuestionDTO(BaseModel):
    id: int
    section: str
    question_key: str
    question_text: str
    answer_type: str          # likert | single | multi | short | long
    options: List[str]
    order_index: int
    required: bool
    active: bool


class SurveySectionDTO(BaseModel):
    section: str
    questions: List[SurveyQuestionDTO]


class ActiveSurveyDTO(BaseModel):
    title: str
    intro: str
    consent_text: str
    sections: List[SurveySectionDTO]


# ── Submission (user) ────────────────────────────────────────────────────────

class SurveyAnswerInput(BaseModel):
    question_key: str
    answer_value: Any          # str | list[str] | int


class SurveySubmitRequest(BaseModel):
    consent_confirmed: bool
    workspace_id: Optional[int] = None
    answers: List[SurveyAnswerInput]


class SurveySubmitResponse(BaseModel):
    ok: bool
    response_id: int
    participant_code: str


class MySurveyResponseDTO(BaseModel):
    exists: bool
    participant_code: Optional[str] = None
    answers: Dict[str, Any] = {}


# ── Admin: question management ───────────────────────────────────────────────

class QuestionUpsertRequest(BaseModel):
    section: str = "General"
    question_key: Optional[str] = None     # auto-slugged from text if omitted
    question_text: str
    answer_type: str = "likert"
    options: List[str] = []
    order_index: Optional[int] = None
    required: bool = False
    active: bool = True


# ── Admin: reporting ─────────────────────────────────────────────────────────

class QuestionReportDTO(BaseModel):
    question_key: str
    question_text: str
    section: str
    answer_type: str
    response_count: int
    # likert/single/multi → option label → count ; average for likert
    distribution: Dict[str, int]
    average: Optional[float] = None
    # short/long → list of free-text answers
    text_answers: List[str] = []


class SurveyReportDTO(BaseModel):
    total_responses: int
    questions: List[QuestionReportDTO]


class SurveyResponseRowDTO(BaseModel):
    id: int
    participant_code: Optional[str]
    role: Optional[str]
    ai_tool_usage_frequency: Optional[str]
    consent_confirmed: bool
    submitted_at: Optional[str]
    answers: Dict[str, Any]


class SurveyResponsesDTO(BaseModel):
    total: int
    responses: List[SurveyResponseRowDTO]
