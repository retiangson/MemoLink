"""
Evaluation Analytics Controller
==============================
User endpoints (auth required):
  POST /api/evaluation/session/start
  POST /api/evaluation/session/end
  POST /api/evaluation/task/start
  POST /api/evaluation/task/complete
  POST /api/evaluation/event
  POST /api/evaluation/rating

Admin endpoints (admin required):
  GET  /api/evaluation/admin/summary
  GET  /api/evaluation/admin/report
  GET  /api/evaluation/admin/export/csv     (ZIP of CSVs)
  GET  /api/evaluation/admin/export/json
"""
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response, JSONResponse
from sqlalchemy import text
from sqlalchemy.orm import Session

from memolink_backend.core.security import get_current_user, get_current_admin
from memolink_backend.core.db import get_db
from memolink_backend.di.request_container import get_request_container, RequestContainer
from memolink_backend.contracts.evaluation_dtos import (
    SessionStartRequest, SessionStartResponse, SessionEndRequest,
    TaskStartRequest, TaskStartResponse, TaskCompleteRequest,
    EventRequest, RatingRequest, OkResponse,
    EvaluationSummaryDTO, GeneratedReportDTO,
    HeartbeatRequest, BudgetStatus, ResetBudgetRequest,
    SetBudgetRequest, ParticipantBudgetList, MyRatingsDTO,
)

router = APIRouter(prefix="/evaluation", tags=["evaluation"])


# ── User ─────────────────────────────────────────────────────────────────────

@router.post("/session/start", response_model=SessionStartResponse)
def start_session(body: SessionStartRequest, user_id: int = Depends(get_current_user),
                  container: RequestContainer = Depends(get_request_container)):
    try:
        return container.evaluation().start_session(user_id, body)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/session/end", response_model=OkResponse)
def end_session(body: SessionEndRequest, user_id: int = Depends(get_current_user),
                container: RequestContainer = Depends(get_request_container)):
    try:
        return container.evaluation().end_session(user_id, body)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


@router.post("/task/start", response_model=TaskStartResponse)
def start_task(body: TaskStartRequest, user_id: int = Depends(get_current_user),
               container: RequestContainer = Depends(get_request_container)):
    return container.evaluation().start_task(user_id, body)


@router.post("/task/complete", response_model=OkResponse)
def complete_task(body: TaskCompleteRequest, user_id: int = Depends(get_current_user),
                  container: RequestContainer = Depends(get_request_container)):
    try:
        return container.evaluation().complete_task(user_id, body)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


@router.post("/event", response_model=OkResponse)
def record_event(body: EventRequest, user_id: int = Depends(get_current_user),
                 container: RequestContainer = Depends(get_request_container)):
    return container.evaluation().record_event(user_id, body)


@router.post("/rating", response_model=OkResponse)
def record_rating(body: RatingRequest, user_id: int = Depends(get_current_user),
                  container: RequestContainer = Depends(get_request_container)):
    return container.evaluation().record_rating(user_id, body)


@router.post("/citation-viewed", response_model=OkResponse)
def citation_viewed(user_id: int = Depends(get_current_user),
                    container: RequestContainer = Depends(get_request_container)):
    """Called only when the user actually expands the Sources panel on a chat
    reply - marks the check_citation evaluation task as completed."""
    container.evaluation().mark_citation_viewed(user_id)
    return OkResponse()


@router.get("/my-ratings", response_model=MyRatingsDTO)
def my_ratings(user_id: int = Depends(get_current_user),
               container: RequestContainer = Depends(get_request_container)):
    """The user's saved answer ratings, keyed by message id (for restoring after reload)."""
    return container.evaluation().get_my_ratings(user_id)


@router.post("/heartbeat", response_model=BudgetStatus)
def heartbeat(body: HeartbeatRequest, user_id: int = Depends(get_current_user),
              container: RequestContainer = Depends(get_request_container)):
    """Frontend active-time heartbeat - adds elapsed active seconds to the user's
    lifetime 25-minute budget and returns how much is left."""
    return container.evaluation().add_active_time(user_id, body.delta_seconds)


@router.get("/budget", response_model=BudgetStatus)
def get_budget(user_id: int = Depends(get_current_user),
               container: RequestContainer = Depends(get_request_container)):
    return container.evaluation().get_budget(user_id)


# ── Admin ────────────────────────────────────────────────────────────────────

def _export_enabled(db: Session) -> bool:
    row = db.execute(text("SELECT value FROM feature_flags WHERE key = 'evaluation_admin_export_enabled'")).fetchone()
    return (row is None) or (row[0] != "false")


@router.get("/admin/summary", response_model=EvaluationSummaryDTO)
def admin_summary(admin_id: int = Depends(get_current_admin),
                  container: RequestContainer = Depends(get_request_container)):
    return container.evaluation_report().get_summary()


@router.get("/admin/report", response_model=GeneratedReportDTO)
def admin_report(admin_id: int = Depends(get_current_admin),
                 container: RequestContainer = Depends(get_request_container)):
    return container.evaluation_report().generate_report()


@router.post("/admin/reset", response_model=OkResponse)
def admin_reset_budget(body: ResetBudgetRequest, admin_id: int = Depends(get_current_admin),
                       container: RequestContainer = Depends(get_request_container)):
    """Reset the collection-window budget for one participant (user_id) or
    everyone (omit user_id) so stat-gathering resumes. When wipe=True, also
    permanently delete that participant's collected evaluation data."""
    return container.evaluation().reset_budget(body.user_id, body.wipe)


@router.get("/admin/participants", response_model=ParticipantBudgetList)
def admin_participants(admin_id: int = Depends(get_current_admin),
                       container: RequestContainer = Depends(get_request_container)):
    """Per-user consumption + budget for management in the Users tab."""
    return container.evaluation_report().list_participants()


@router.post("/admin/budget", response_model=BudgetStatus)
def admin_set_budget(body: SetBudgetRequest, admin_id: int = Depends(get_current_admin),
                     container: RequestContainer = Depends(get_request_container)):
    """Set a participant's collection window in minutes (null → default)."""
    return container.evaluation().set_user_budget(body.user_id, body.budget_minutes)


@router.get("/admin/export/csv")
def admin_export_csv(admin_id: int = Depends(get_current_admin),
                     container: RequestContainer = Depends(get_request_container),
                     db: Session = Depends(get_db)):
    if not _export_enabled(db):
        raise HTTPException(status_code=403, detail="Export is disabled by an administrator.")
    data = container.evaluation_report().export_csv_zip()
    return Response(
        content=data,
        media_type="application/zip",
        headers={"Content-Disposition": "attachment; filename=memolink_evaluation_data.zip"},
    )


@router.get("/admin/export/json")
def admin_export_json(admin_id: int = Depends(get_current_admin),
                      container: RequestContainer = Depends(get_request_container),
                      db: Session = Depends(get_db)):
    if not _export_enabled(db):
        raise HTTPException(status_code=403, detail="Export is disabled by an administrator.")
    return JSONResponse(content=container.evaluation_report().export_json())
