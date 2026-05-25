from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from typing import Optional
from sqlalchemy.orm import Session
from sqlalchemy import text

from memolink_backend.core.security import get_current_user_info, UserInfo, level_meets
from memolink_backend.core.db import get_db
from memolink_backend.di.request_container import RequestContainer, get_request_container

router = APIRouter(prefix="/research", tags=["research"])


class ResearchRequest(BaseModel):
    conversation_id: int
    prompt: str
    workspace_id: Optional[int] = None
    model: Optional[str] = None


@router.post("/stream")
def research_stream(
    dto: ResearchRequest,
    user: UserInfo = Depends(get_current_user_info),
    db: Session = Depends(get_db),
    c: RequestContainer = Depends(get_request_container),
):
    if not user.is_admin:
        row = db.execute(text("SELECT value FROM feature_flags WHERE key = 'research_mode_enabled'")).fetchone()
        if row and row[0] == "false":
            raise HTTPException(status_code=403, detail="Research Mode is disabled")
        row = db.execute(text("SELECT value FROM feature_flags WHERE key = 'research_mode_min_level'")).fetchone()
        min_level = row[0] if row else "regular"
        if not level_meets(user.access_level, min_level):
            raise HTTPException(status_code=403, detail="Research Mode requires a higher access level")

    return StreamingResponse(
        c.research().research_stream(
            user_id=user.id,
            conversation_id=dto.conversation_id,
            prompt=dto.prompt,
            workspace_id=dto.workspace_id,
            model=dto.model,
        ),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
