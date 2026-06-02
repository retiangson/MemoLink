import logging
from typing import Dict
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session
from sqlalchemy import text
from memolink_backend.core.security import get_current_admin
from memolink_backend.core.db import get_db

router = APIRouter(prefix="/admin", tags=["admin"])
logger = logging.getLogger(__name__)

DEFAULT_FLAGS: Dict[str, str] = {
    "web_search_enabled": "true",
    "agent_mode_enabled": "true",
    "model_selection_enabled": "true",
    "image_generation_enabled": "true",
    "translation_enabled": "true",
    "file_upload_enabled": "true",
    "research_mode_enabled": "true",
    "model_attribution_enabled": "true",
    "tts_enabled": "true",
    "slash_commands_enabled": "true",
    "custom_api_keys_enabled": "true",
    "video_import_enabled": "true",
    "email_enabled": "true",
    "memograph_enabled": "true",
    "proactive_insights_enabled": "true",
    "confidence_enabled": "true",
    "autopilot_enabled": "true",
    "default_model": "gpt-4o-mini",
    "default_language": "English",
    # Minimum access level required per feature
    "web_search_min_level": "regular",
    "agent_mode_min_level": "regular",
    "model_selection_min_level": "regular",
    "image_generation_min_level": "regular",
    "translation_min_level": "regular",
    "file_upload_min_level": "regular",
    "research_mode_min_level": "regular",
    "model_attribution_min_level": "regular",
    "tts_min_level": "regular",
    "slash_commands_min_level": "regular",
    "custom_api_keys_min_level": "regular",
    "video_import_min_level": "regular",
}

VALID_LEVELS = {"regular", "plus", "pro"}


# ── Feedback ──────────────────────────────────────────────────────────────────

@router.get("/feedback")
def list_feedback(
    type: str = "all",
    status: str = "all",
    admin_id: int = Depends(get_current_admin),
    db: Session = Depends(get_db),
):
    q = "SELECT id, user_id, user_email, type, title, message, status, created_at FROM feedback WHERE 1=1"
    params: dict = {}
    if type != "all":
        q += " AND type = :type"
        params["type"] = type
    if status != "all":
        q += " AND status = :status"
        params["status"] = status
    q += " ORDER BY created_at DESC"
    rows = db.execute(text(q), params).fetchall()
    return {"items": [
        {"id": r[0], "user_id": r[1], "user_email": r[2], "type": r[3],
         "title": r[4], "message": r[5], "status": r[6], "created_at": str(r[7])}
        for r in rows
    ]}


class FeedbackStatusUpdate(BaseModel):
    status: str  # "open" | "read" | "resolved"


@router.patch("/feedback/{feedback_id}")
def update_feedback_status(
    feedback_id: int,
    body: FeedbackStatusUpdate,
    admin_id: int = Depends(get_current_admin),
    db: Session = Depends(get_db),
):
    if body.status not in ("open", "read", "resolved"):
        raise HTTPException(status_code=400, detail="Invalid status")
    db.execute(text("UPDATE feedback SET status = :s WHERE id = :id"), {"s": body.status, "id": feedback_id})
    db.commit()
    return {"ok": True}


# ── Users ─────────────────────────────────────────────────────────────────────

@router.get("/users")
def list_users(admin_id: int = Depends(get_current_admin), db: Session = Depends(get_db)):
    rows = db.execute(text("SELECT id, email, is_admin, access_level FROM users ORDER BY id")).fetchall()
    return {"users": [
        {"id": r[0], "email": r[1], "is_admin": bool(r[2]), "access_level": r[3] or "regular"}
        for r in rows
    ]}


class RoleUpdate(BaseModel):
    is_admin: bool


@router.patch("/users/{user_id}/role")
def update_user_role(
    user_id: int,
    body: RoleUpdate,
    admin_id: int = Depends(get_current_admin),
    db: Session = Depends(get_db),
):
    if user_id == admin_id and not body.is_admin:
        raise HTTPException(status_code=400, detail="Cannot remove your own admin role")
    db.execute(text("UPDATE users SET is_admin = :v WHERE id = :id"), {"v": body.is_admin, "id": user_id})
    db.commit()
    return {"ok": True}


class LevelUpdate(BaseModel):
    level: str


@router.patch("/users/{user_id}/level")
def update_user_level(
    user_id: int,
    body: LevelUpdate,
    admin_id: int = Depends(get_current_admin),
    db: Session = Depends(get_db),
):
    if body.level not in VALID_LEVELS:
        raise HTTPException(status_code=400, detail=f"Invalid level. Must be one of: {', '.join(VALID_LEVELS)}")
    db.execute(text("UPDATE users SET access_level = :v WHERE id = :id"), {"v": body.level, "id": user_id})
    db.commit()
    return {"ok": True}


# ── Feature Flags ─────────────────────────────────────────────────────────────

def _get_flags(db: Session) -> Dict[str, str]:
    rows = db.execute(text("SELECT key, value FROM feature_flags")).fetchall()
    flags = dict(DEFAULT_FLAGS)
    for key, value in rows:
        flags[key] = value
    return flags


@router.get("/features")
def get_features(admin_id: int = Depends(get_current_admin), db: Session = Depends(get_db)):
    return {"flags": _get_flags(db)}


class FlagsUpdate(BaseModel):
    flags: Dict[str, str]


@router.put("/features")
def update_features(body: FlagsUpdate, admin_id: int = Depends(get_current_admin), db: Session = Depends(get_db)):
    for key, value in body.flags.items():
        db.execute(
            text("INSERT INTO feature_flags (key, value, updated_at) VALUES (:k, :v, now()) ON CONFLICT (key) DO UPDATE SET value = :v, updated_at = now()"),
            {"k": key, "v": value},
        )
    db.commit()
    return {"ok": True, "flags": _get_flags(db)}
