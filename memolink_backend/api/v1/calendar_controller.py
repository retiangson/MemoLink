from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query
from typing import Optional

from memolink_backend.core.security import get_current_user
from memolink_backend.di.request_container import RequestContainer, get_request_container

router = APIRouter(prefix="/calendar", tags=["calendar"])


@router.get("/events")
async def list_calendar_events(
    start: str = Query(..., description="ISO date, e.g. 2026-06-01"),
    end: str = Query(..., description="ISO date, e.g. 2026-06-30"),
    workspace_id: Optional[int] = Query(default=None),
    user_id: int = Depends(get_current_user),
    c: RequestContainer = Depends(get_request_container),
):
    try:
        range_start = date.fromisoformat(start)
        range_end = date.fromisoformat(end)
    except ValueError:
        raise HTTPException(status_code=400, detail="start/end must be ISO dates (YYYY-MM-DD)")
    if range_end < range_start:
        raise HTTPException(status_code=400, detail="end must not be before start")
    events = await c.calendar().list_events_in_range(user_id, workspace_id, range_start, range_end)
    return {"events": events}


@router.get("/status")
def calendar_status(
    user_id: int = Depends(get_current_user),
    c: RequestContainer = Depends(get_request_container),
):
    return c.calendar().get_status(user_id)
