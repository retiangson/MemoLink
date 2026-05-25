import os
import sys
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

BACKEND_ROOT = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.dirname(BACKEND_ROOT)
if PROJECT_ROOT not in sys.path:
    sys.path.insert(0, PROJECT_ROOT)

from sqlalchemy import text
from memolink_backend.core.db import Base, engine
from memolink_backend.api.v1 import (
    auth_controller,
    notes_controller,
    bulk_controller,
    chat_controller,
    conversation_controller,
    transcribe_controller,
    translate_controller,
    suggest_controller,
    reminder_controller,
    video_controller,
    workspace_controller,
    feedback_controller,
    admin_controller,
    features_controller,
    research_controller,
)

# Register all models so SQLAlchemy sees them
import memolink_backend.domain.models.user_model      # noqa: F401
import memolink_backend.domain.models.note             # noqa: F401
import memolink_backend.domain.models.embedding        # noqa: F401
import memolink_backend.domain.models.conversation     # noqa: F401
import memolink_backend.domain.models.message          # noqa: F401
import memolink_backend.domain.models.reminder         # noqa: F401
import memolink_backend.domain.models.workspace        # noqa: F401

if os.getenv("MEMOLINK_SKIP_DB_BOOTSTRAP") != "1":
    with engine.connect() as _conn:
        _conn.execute(text("CREATE EXTENSION IF NOT EXISTS vector"))
        # Add columns that may not exist yet on already-created tables
        _conn.execute(text("ALTER TABLE notes ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ"))
        _conn.execute(text("ALTER TABLE conversations ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ"))
        _conn.execute(text("ALTER TABLE reminders ADD COLUMN IF NOT EXISTS due_date VARCHAR(50)"))
        _conn.execute(text("ALTER TABLE reminders ADD COLUMN IF NOT EXISTS due_time VARCHAR(10)"))
        _conn.execute(text("ALTER TABLE reminders ADD COLUMN IF NOT EXISTS description TEXT"))
        # Knowledge Workspace migrations
        _conn.execute(text("""
            CREATE TABLE IF NOT EXISTS workspaces (
                id SERIAL PRIMARY KEY,
                user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                name VARCHAR(100) NOT NULL,
                type VARCHAR(30) NOT NULL DEFAULT 'Other',
                description TEXT,
                is_default BOOLEAN NOT NULL DEFAULT FALSE,
                last_accessed_at TIMESTAMPTZ,
                created_at TIMESTAMPTZ DEFAULT now(),
                updated_at TIMESTAMPTZ DEFAULT now(),
                deleted_at TIMESTAMPTZ
            )
        """))
        _conn.execute(text("ALTER TABLE notes ADD COLUMN IF NOT EXISTS workspace_id INTEGER REFERENCES workspaces(id) ON DELETE SET NULL"))
        _conn.execute(text("ALTER TABLE conversations ADD COLUMN IF NOT EXISTS workspace_id INTEGER REFERENCES workspaces(id) ON DELETE SET NULL"))
        _conn.execute(text("ALTER TABLE reminders ADD COLUMN IF NOT EXISTS workspace_id INTEGER REFERENCES workspaces(id) ON DELETE SET NULL"))
        # Admin system migrations
        _conn.execute(text("ALTER TABLE users ADD COLUMN IF NOT EXISTS is_admin BOOLEAN NOT NULL DEFAULT FALSE"))
        _conn.execute(text("ALTER TABLE users ADD COLUMN IF NOT EXISTS access_level VARCHAR NOT NULL DEFAULT 'regular'"))
        _conn.execute(text("ALTER TABLE messages ADD COLUMN IF NOT EXISTS model VARCHAR(100)"))
        _conn.execute(text("ALTER TABLE feedback ADD COLUMN IF NOT EXISTS title VARCHAR(200)"))
        _conn.execute(text("""
            CREATE TABLE IF NOT EXISTS feedback (
                id SERIAL PRIMARY KEY,
                user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
                user_email VARCHAR(255),
                type VARCHAR(20) NOT NULL,
                message TEXT NOT NULL,
                status VARCHAR(20) NOT NULL DEFAULT 'open',
                created_at TIMESTAMPTZ DEFAULT now()
            )
        """))
        _conn.execute(text("""
            CREATE TABLE IF NOT EXISTS feature_flags (
                key VARCHAR(100) PRIMARY KEY,
                value TEXT NOT NULL,
                updated_at TIMESTAMPTZ DEFAULT now()
            )
        """))
        # Seed default flags (skip if already exist)
        for _k, _v in [
            ("web_search_enabled", "true"), ("agent_mode_enabled", "true"),
            ("model_selection_enabled", "true"), ("image_generation_enabled", "true"),
            ("translation_enabled", "true"), ("file_upload_enabled", "true"),
            ("research_mode_enabled", "true"),
            ("model_attribution_enabled", "true"),
            ("default_model", "gpt-4o-mini"), ("default_language", "English"),
            ("web_search_min_level", "regular"), ("agent_mode_min_level", "regular"),
            ("model_selection_min_level", "regular"), ("image_generation_min_level", "regular"),
            ("translation_min_level", "regular"), ("file_upload_min_level", "regular"),
            ("research_mode_min_level", "regular"), ("model_attribution_min_level", "regular"),
        ]:
            _conn.execute(text("INSERT INTO feature_flags (key, value) VALUES (:k, :v) ON CONFLICT (key) DO NOTHING"), {"k": _k, "v": _v})
        # Auto-promote first user as admin if none exists
        _conn.execute(text("""
            UPDATE users SET is_admin = TRUE
            WHERE id = (SELECT MIN(id) FROM users)
            AND NOT EXISTS (SELECT 1 FROM users WHERE is_admin = TRUE)
        """))
        _conn.commit()

    Base.metadata.create_all(bind=engine)

app = FastAPI(
    title="MemoLink API",
    version="1.0.0",
    description="Context-aware AI knowledge companion — RAG-powered note retrieval and chat.",
    docs_url="/api/docs",
    openapi_url="/api/openapi.json",
    redoc_url="/api/redoc",
)


@app.get("/health", tags=["system"])
def health():
    return {"status": "ok", "service": "MemoLink API"}


app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth_controller.router, prefix="/api")
app.include_router(notes_controller.router, prefix="/api")
app.include_router(bulk_controller.router, prefix="/api")
app.include_router(chat_controller.router, prefix="/api")
app.include_router(conversation_controller.router, prefix="/api")
app.include_router(transcribe_controller.router, prefix="/api")
app.include_router(translate_controller.router, prefix="/api")
app.include_router(suggest_controller.router, prefix="/api")
app.include_router(reminder_controller.router, prefix="/api")
app.include_router(video_controller.router, prefix="/api")
app.include_router(workspace_controller.router, prefix="/api")
app.include_router(feedback_controller.router, prefix="/api")
app.include_router(admin_controller.router, prefix="/api")
app.include_router(features_controller.router, prefix="/api")
app.include_router(research_controller.router, prefix="/api")

# AWS Lambda handler (Mangum bridges ASGI → Lambda event format)
from mangum import Mangum  # noqa: E402
handler = Mangum(app, lifespan="off")
