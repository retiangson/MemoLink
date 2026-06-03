from typing import Dict
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from sqlalchemy import text
from memolink_backend.core.security import get_current_user_info, UserInfo, level_meets
from memolink_backend.core.db import get_db

router = APIRouter(prefix="/features", tags=["features"])

DEFAULT_FLAGS: Dict[str, str] = {
    "web_search_enabled": "true",
    "agent_mode_enabled": "true",
    "model_selection_enabled": "true",
    "image_generation_enabled": "true",
    "translation_enabled": "true",
    "file_upload_enabled": "true",
    "research_mode_enabled": "true",
    "tts_enabled": "true",
    "slash_commands_enabled": "true",
    "custom_api_keys_enabled": "true",
    "video_import_enabled": "true",
    "evaluation_survey_enabled": "true",
    "evaluation_analytics_enabled": "true",
    "evaluation_admin_export_enabled": "true",
    "default_model": "gpt-4o-mini",
    "default_language": "English",
    "web_search_min_level": "regular",
    "agent_mode_min_level": "regular",
    "model_selection_min_level": "regular",
    "image_generation_min_level": "regular",
    "translation_min_level": "regular",
    "file_upload_min_level": "regular",
    "research_mode_min_level": "regular",
    "tts_min_level": "regular",
    "slash_commands_min_level": "regular",
    "custom_api_keys_min_level": "regular",
    "video_import_min_level": "regular",
}

_LEVEL_GATED = [
    "web_search", "agent_mode", "model_selection",
    "image_generation", "translation", "file_upload", "research_mode",
    "tts", "slash_commands", "custom_api_keys", "video_import",
]


@router.get("")
def get_features(user: UserInfo = Depends(get_current_user_info), db: Session = Depends(get_db)):
    rows = db.execute(text("SELECT key, value FROM feature_flags")).fetchall()
    flags = dict(DEFAULT_FLAGS)
    for key, value in rows:
        flags[key] = value

    # Admins always get every feature regardless of level
    if not user.is_admin:
        for feat in _LEVEL_GATED:
            min_level = flags.get(f"{feat}_min_level", "regular")
            if not level_meets(user.access_level, min_level):
                flags[f"{feat}_enabled"] = "false"

    return {"flags": flags}
