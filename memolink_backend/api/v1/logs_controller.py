from typing import Optional
from fastapi import APIRouter, Depends, Query
from memolink_backend.core.security import get_current_admin
from memolink_backend.di.request_container import RequestContainer, get_request_container

router = APIRouter(prefix="/admin/logs", tags=["admin"])


@router.get("")
def get_logs(
    level: Optional[str] = Query(None, description="INFO | WARNING | ERROR"),
    source: Optional[str] = Query(None),
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
    _: int = Depends(get_current_admin),
    c: RequestContainer = Depends(get_request_container),
):
    result = c.logs().list(level=level, source=source, page=page, page_size=page_size)
    return {
        "items": [
            {
                "id": e.id,
                "created_at": e.created_at.isoformat() if e.created_at else None,
                "level": e.level,
                "source": e.source,
                "message": e.message,
                "details": e.details,
                "user_id": e.user_id,
            }
            for e in result["items"]
        ],
        "total": result["total"],
        "page": result["page"],
        "page_size": result["page_size"],
        "pages": result["pages"],
    }


@router.delete("/clear")
def clear_logs(
    _: int = Depends(get_current_admin),
    c: RequestContainer = Depends(get_request_container),
):
    deleted = c.logs().clear()
    return {"deleted": deleted}
