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
)

# Register all models so SQLAlchemy sees them
import memolink_backend.domain.models.user_model      # noqa: F401
import memolink_backend.domain.models.note             # noqa: F401
import memolink_backend.domain.models.embedding        # noqa: F401
import memolink_backend.domain.models.conversation     # noqa: F401
import memolink_backend.domain.models.message          # noqa: F401
import memolink_backend.domain.models.reminder         # noqa: F401
import memolink_backend.domain.models.workspace        # noqa: F401

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
