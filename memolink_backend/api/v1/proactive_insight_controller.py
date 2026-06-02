from typing import Optional
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from memolink_backend.core.security import get_current_user
from memolink_backend.core.db import get_db
from memolink_backend.di.request_container import get_request_container, RequestContainer

router = APIRouter(prefix="/insights", tags=["insights"])


@router.post("/analyze")
def analyze(
    workspace_id: Optional[int] = None,
    user_id: int = Depends(get_current_user),
    db: Session = Depends(get_db),
    container: RequestContainer = Depends(get_request_container),
):
    """Trigger a fresh proactive analysis. Clears old results, returns new insights."""
    if not workspace_id:
        raise HTTPException(status_code=400, detail="workspace_id is required")
    return container.insights().analyze(user_id, workspace_id, db)


@router.get("")
def get_insights(
    workspace_id: Optional[int] = None,
    user_id: int = Depends(get_current_user),
    container: RequestContainer = Depends(get_request_container),
):
    """Return stored (non-dismissed) insights for the workspace. No API cost."""
    if not workspace_id:
        return []
    return container.insights().get_insights(user_id, workspace_id)


@router.delete("/{insight_id}")
def dismiss_insight(
    insight_id: int,
    user_id: int = Depends(get_current_user),
    container: RequestContainer = Depends(get_request_container),
):
    """Mark an insight as dismissed so it no longer appears."""
    ok = container.insights().dismiss(user_id, insight_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Insight not found")
    return {"ok": True}
