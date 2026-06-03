"""
Evaluation Analytics DTOs
"""
from typing import Optional, List, Dict, Any
from pydantic import BaseModel


# ── Session ──────────────────────────────────────────────────────────────────

class SessionStartRequest(BaseModel):
    consent_confirmed: bool
    participant_code: Optional[str] = None     # auto-generated (P###) if omitted
    role: Optional[str] = None
    ai_tool_usage_frequency: Optional[str] = None
    device_type: Optional[str] = None
    browser: Optional[str] = None
    operating_system: Optional[str] = None
    workspace_id: Optional[int] = None


class SessionStartResponse(BaseModel):
    session_id: int
    participant_code: str


class SessionEndRequest(BaseModel):
    session_id: int
    completed: bool = True


# ── Tasks ────────────────────────────────────────────────────────────────────

class TaskStartRequest(BaseModel):
    session_id: int
    task_key: str
    task_name: str
    feature_name: Optional[str] = None
    workspace_id: Optional[int] = None


class TaskStartResponse(BaseModel):
    task_id: int


class TaskCompleteRequest(BaseModel):
    task_id: int
    success: Optional[bool] = True
    time_taken_ms: Optional[int] = None
    error_count: Optional[int] = None
    retry_count: Optional[int] = None
    click_count: Optional[int] = None
    created_object_type: Optional[str] = None
    created_object_id: Optional[int] = None
    notes: Optional[str] = None


# ── Events ───────────────────────────────────────────────────────────────────

class EventRequest(BaseModel):
    session_id: Optional[int] = None
    task_id: Optional[int] = None
    conversation_id: Optional[int] = None
    message_id: Optional[int] = None
    note_id: Optional[int] = None
    feature_name: str
    operation_name: str
    event_type: str
    status: str
    duration_ms: Optional[int] = None
    error_type: Optional[str] = None
    error_code: Optional[str] = None
    error_message_safe: Optional[str] = None
    metadata: Optional[Dict[str, Any]] = None
    workspace_id: Optional[int] = None


# ── Ratings ──────────────────────────────────────────────────────────────────

class RatingRequest(BaseModel):
    session_id: Optional[int] = None           # resolved from active session if omitted
    task_id: Optional[int] = None
    event_id: Optional[int] = None
    ai_metric_id: Optional[int] = None
    message_id: Optional[int] = None
    rating_type: str
    rating_value: int
    rating_scale_min: int = 1
    rating_scale_max: int = 5
    choice_value: Optional[str] = None
    comment: Optional[str] = None


class OkResponse(BaseModel):
    ok: bool = True
    id: Optional[int] = None


class MyRatingsDTO(BaseModel):
    # message_id (str) → { rating_type → value(int) | choice(str) }
    ratings: Dict[str, Dict[str, Any]] = {}


class HeartbeatRequest(BaseModel):
    delta_seconds: int = 0          # active seconds since the last heartbeat


class BudgetStatus(BaseModel):
    consumed_seconds: int
    budget_seconds: int
    remaining_seconds: int
    exhausted: bool                 # True once the 25-minute budget is used up
    recording: bool                 # whether stats are still being gathered


class ResetBudgetRequest(BaseModel):
    user_id: Optional[int] = None   # reset one participant; omit to reset everyone
    wipe: bool = False              # also delete all their collected evaluation data


class SetBudgetRequest(BaseModel):
    user_id: int
    budget_minutes: Optional[int] = None   # None → revert to default window


class ParticipantBudgetRow(BaseModel):
    user_id: int
    email: Optional[str] = None
    participant_code: Optional[str] = None
    consumed_seconds: int
    budget_seconds: int
    remaining_seconds: int
    exhausted: bool


class ParticipantBudgetList(BaseModel):
    default_budget_minutes: int
    participants: List[ParticipantBudgetRow]


# ── Reporting ────────────────────────────────────────────────────────────────

class ConfidenceAlignmentRow(BaseModel):
    confidence_level: str
    count: int
    avg_trust: Optional[float] = None
    avg_relevance: Optional[float] = None


class EvaluationSummaryDTO(BaseModel):
    total_participants: int
    total_sessions: int
    completed_sessions: int
    avg_session_time_seconds: Optional[float]
    task_completion_rate: Optional[float]          # 0..1
    total_tasks: int
    completed_tasks: int
    avg_response_time_ms: Optional[float]
    avg_first_token_latency_ms: Optional[float]
    avg_relevance_rating: Optional[float]
    avg_citation_rating: Optional[float]
    avg_trust_rating: Optional[float]
    fallback_rate: Optional[float]                 # 0..1 over AI events
    ai_metric_count: int
    confidence_alignment: List[ConfidenceAlignmentRow]
    ratings_by_type: Dict[str, float]
    supported_by_notes: Dict[str, int]          # yes / partially / no / not_sure counts
    response_time_by_feature: Dict[str, float]
    feature_usage: Dict[str, int]


class GeneratedReportDTO(BaseModel):
    markdown: str
    summary: EvaluationSummaryDTO
