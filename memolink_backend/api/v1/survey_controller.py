"""
Evaluation Survey Controller
============================
User endpoints:
  GET  /api/survey               → active survey (sections + questions + consent)
  POST /api/survey/submit        → submit a completed survey

Admin endpoints (require admin JWT):
  GET    /api/survey/admin/questions          → list all questions
  POST   /api/survey/admin/questions          → create a question
  PUT    /api/survey/admin/questions/{id}     → update a question
  DELETE /api/survey/admin/questions/{id}     → delete a question
  POST   /api/survey/admin/questions/reset     → re-seed missing defaults
  GET    /api/survey/admin/responses          → all responses (with answers)
  GET    /api/survey/admin/report             → aggregated report for graphs
  GET    /api/survey/admin/export             → CSV download
"""
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import PlainTextResponse

from memolink_backend.core.security import get_current_user, get_current_admin
from memolink_backend.di.request_container import get_request_container, RequestContainer
from memolink_backend.contracts.survey_dtos import (
    ActiveSurveyDTO, SurveySubmitRequest, SurveySubmitResponse, MySurveyResponseDTO,
    SurveyQuestionDTO, QuestionUpsertRequest,
    SurveyReportDTO, SurveyResponsesDTO,
)

router = APIRouter(prefix="/survey", tags=["survey"])


# ── User ─────────────────────────────────────────────────────────────────────

@router.get("", response_model=ActiveSurveyDTO)
def get_survey(
    user_id: int = Depends(get_current_user),
    container: RequestContainer = Depends(get_request_container),
):
    return container.survey().get_active_survey()


@router.get("/me", response_model=MySurveyResponseDTO)
def get_my_survey_response(
    user_id: int = Depends(get_current_user),
    container: RequestContainer = Depends(get_request_container),
):
    """Return the current user's existing response (one per account) for editing."""
    return container.survey().get_my_response(user_id)


@router.post("/submit", response_model=SurveySubmitResponse)
def submit_survey(
    body: SurveySubmitRequest,
    user_id: int = Depends(get_current_user),
    container: RequestContainer = Depends(get_request_container),
):
    try:
        result = container.survey().submit(user_id=user_id, req=body)
        container.evaluation().mark_task(user_id, "complete_survey", "Complete the qualitative survey", "survey")
        return result
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


# ── Admin: question management ───────────────────────────────────────────────

@router.get("/admin/questions", response_model=list[SurveyQuestionDTO])
def list_questions(
    admin_id: int = Depends(get_current_admin),
    container: RequestContainer = Depends(get_request_container),
):
    return container.survey().list_questions()


@router.post("/admin/questions", response_model=SurveyQuestionDTO)
def create_question(
    body: QuestionUpsertRequest,
    admin_id: int = Depends(get_current_admin),
    container: RequestContainer = Depends(get_request_container),
):
    try:
        return container.survey().create_question(body)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.put("/admin/questions/{question_id}", response_model=SurveyQuestionDTO)
def update_question(
    question_id: int,
    body: QuestionUpsertRequest,
    admin_id: int = Depends(get_current_admin),
    container: RequestContainer = Depends(get_request_container),
):
    try:
        return container.survey().update_question(question_id, body)
    except ValueError as e:
        raise HTTPException(status_code=404 if "not found" in str(e).lower() else 400, detail=str(e))


@router.delete("/admin/questions/{question_id}")
def delete_question(
    question_id: int,
    admin_id: int = Depends(get_current_admin),
    container: RequestContainer = Depends(get_request_container),
):
    try:
        container.survey().delete_question(question_id)
        return {"ok": True}
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


@router.post("/admin/questions/reset")
def reset_questions(
    admin_id: int = Depends(get_current_admin),
    container: RequestContainer = Depends(get_request_container),
):
    added = container.survey().reset_default_questions()
    return {"ok": True, "added": added}


# ── Admin: reporting ─────────────────────────────────────────────────────────

@router.get("/admin/report", response_model=SurveyReportDTO)
def get_report(
    admin_id: int = Depends(get_current_admin),
    container: RequestContainer = Depends(get_request_container),
):
    return container.survey().get_report()


@router.get("/admin/responses", response_model=SurveyResponsesDTO)
def get_responses(
    admin_id: int = Depends(get_current_admin),
    container: RequestContainer = Depends(get_request_container),
):
    return container.survey().get_responses()


@router.get("/admin/export")
def export_csv(
    admin_id: int = Depends(get_current_admin),
    container: RequestContainer = Depends(get_request_container),
):
    csv_text = container.survey().export_csv()
    return PlainTextResponse(
        content=csv_text,
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=memolink_survey_results.csv"},
    )
