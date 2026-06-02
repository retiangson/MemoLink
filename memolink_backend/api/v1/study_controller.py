"""
Study Mode Controller
=====================

REST endpoints for the AI Study Mode feature.

POST /api/study/flashcards      Generate flashcard Q&A pairs from notes
POST /api/study/exam-review     Comprehensive exam review from notes
POST /api/study/plan            Day-by-day study plan for the workspace
POST /api/study/weak-topics     Detect recurring topics from chat history
POST /api/study/summary         Summarize a note at short|medium|detailed level

All endpoints require a valid JWT (Bearer token).
"""

from fastapi import APIRouter, Depends
from memolink_backend.core.security import get_current_user
from memolink_backend.di.request_container import get_request_container, RequestContainer
from memolink_backend.contracts.study_dtos import (
    FlashcardsRequest, FlashcardsResponse,
    ExamReviewRequest, ExamReviewResponse,
    StudyPlanRequest, StudyPlanResponse,
    WeakTopicsRequest, WeakTopicsResponse,
    SummaryRequest, SummaryResponse,
)

router = APIRouter(prefix="/study", tags=["study"])


@router.post("/flashcards", response_model=FlashcardsResponse)
def generate_flashcards(
    body: FlashcardsRequest,
    user_id: int = Depends(get_current_user),
    container: RequestContainer = Depends(get_request_container),
):
    return container.study().generate_flashcards(
        user_id=user_id,
        workspace_id=body.workspace_id,
        note_id=body.note_id,
        count=min(body.count, 40),
    )


@router.post("/exam-review", response_model=ExamReviewResponse)
def generate_exam_review(
    body: ExamReviewRequest,
    user_id: int = Depends(get_current_user),
    container: RequestContainer = Depends(get_request_container),
):
    return container.study().generate_exam_review(
        user_id=user_id,
        workspace_id=body.workspace_id,
        note_ids=body.note_ids,
    )


@router.post("/plan", response_model=StudyPlanResponse)
def generate_study_plan(
    body: StudyPlanRequest,
    user_id: int = Depends(get_current_user),
    container: RequestContainer = Depends(get_request_container),
):
    return container.study().generate_study_plan(
        user_id=user_id,
        workspace_id=body.workspace_id,
        days=min(body.days, 30),
        goal=body.goal,
    )


@router.post("/weak-topics", response_model=WeakTopicsResponse)
def detect_weak_topics(
    body: WeakTopicsRequest,
    user_id: int = Depends(get_current_user),
    container: RequestContainer = Depends(get_request_container),
):
    return container.study().detect_weak_topics(
        user_id=user_id,
        workspace_id=body.workspace_id,
    )


@router.post("/summary", response_model=SummaryResponse)
def summarize_note(
    body: SummaryRequest,
    user_id: int = Depends(get_current_user),
    container: RequestContainer = Depends(get_request_container),
):
    return container.study().summarize_at_level(
        user_id=user_id,
        workspace_id=body.workspace_id,
        note_id=body.note_id,
        level=body.level if body.level in ("short", "medium", "detailed") else "medium",
    )
