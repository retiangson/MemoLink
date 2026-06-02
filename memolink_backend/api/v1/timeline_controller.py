"""
Timeline Controller
===================

GET  /api/timeline/{note_id}          Return cached timeline (404 if none yet)
POST /api/timeline/generate/{note_id} Generate or regenerate a timeline (1 GPT call)

All endpoints require a valid JWT.
"""

from fastapi import APIRouter, Depends, HTTPException
from memolink_backend.core.security import get_current_user
from memolink_backend.di.request_container import get_request_container, RequestContainer
from memolink_backend.contracts.timeline_dtos import TimelineResponse

router = APIRouter(prefix="/timeline", tags=["timeline"])


@router.get("/{note_id}", response_model=TimelineResponse)
def get_timeline(
    note_id: int,
    user_id: int = Depends(get_current_user),
    container: RequestContainer = Depends(get_request_container),
):
    result = container.timeline().get(note_id)
    if not result:
        raise HTTPException(status_code=404, detail="No timeline found for this note")
    return result


@router.post("/generate/{note_id}", response_model=TimelineResponse)
def generate_timeline(
    note_id: int,
    user_id: int = Depends(get_current_user),
    container: RequestContainer = Depends(get_request_container),
):
    try:
        return container.timeline().generate(user_id=user_id, note_id=note_id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
