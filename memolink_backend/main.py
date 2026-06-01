import logging
import os
import sys
import traceback
from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

_logger = logging.getLogger(__name__)


def _try_write_system_log(level: str, source: str, message: str, details: dict) -> None:
    """Write to system_logs without ever raising — used inside exception handlers."""
    try:
        from memolink_backend.core.db import get_db
        from memolink_backend.domain.repositories.system_log_repository import SystemLogRepository
        db = next(get_db())
        SystemLogRepository(db).create(level, source, message, details)
    except Exception:
        pass

BACKEND_ROOT = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.dirname(BACKEND_ROOT)
if PROJECT_ROOT not in sys.path:
    sys.path.insert(0, PROJECT_ROOT)

from sqlalchemy import text
from memolink_backend.core.db import Base, engine
from memolink_backend.core.config import settings
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
    logs_controller,
    s3_upload_controller,
)

# Register all models so SQLAlchemy sees them
import memolink_backend.domain.models.user_model      # noqa: F401
import memolink_backend.domain.models.note             # noqa: F401
import memolink_backend.domain.models.embedding        # noqa: F401
import memolink_backend.domain.models.conversation     # noqa: F401
import memolink_backend.domain.models.message          # noqa: F401
import memolink_backend.domain.models.reminder         # noqa: F401
import memolink_backend.domain.models.workspace        # noqa: F401
import memolink_backend.domain.models.system_log       # noqa: F401
import memolink_backend.domain.models.translation_cache # noqa: F401

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
        # Translation cache table
        _conn.execute(text("""
            CREATE TABLE IF NOT EXISTS translation_cache (
                id SERIAL PRIMARY KEY,
                text_hash VARCHAR(64) UNIQUE NOT NULL,
                source_text TEXT NOT NULL,
                target_language VARCHAR(100) NOT NULL,
                translation TEXT NOT NULL,
                accuracy INTEGER,
                model VARCHAR(100) NOT NULL,
                hit_count INTEGER NOT NULL DEFAULT 0,
                created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
                updated_at TIMESTAMPTZ DEFAULT now() NOT NULL
            )
        """))
        _conn.execute(text("CREATE INDEX IF NOT EXISTS ix_translation_cache_text_hash ON translation_cache(text_hash)"))
        # System logs table
        _conn.execute(text("""
            CREATE TABLE IF NOT EXISTS system_logs (
                id SERIAL PRIMARY KEY,
                created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
                level VARCHAR(10) NOT NULL,
                source VARCHAR(100) NOT NULL,
                message TEXT NOT NULL,
                details JSONB,
                user_id INTEGER
            )
        """))
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


# ── Global exception handlers (equivalent to C# error-handling middleware) ────
#
# FastAPI dispatches exceptions in this priority order:
#   1. HTTPException          → http_exception_handler
#   2. RequestValidationError → validation_exception_handler
#   3. Everything else        → unhandled_exception_handler
#
# All three are registered so no exception class escapes logging.

@app.exception_handler(StarletteHTTPException)
async def http_exception_handler(request: Request, exc: StarletteHTTPException):
    """Handles all explicit raise HTTPException(...) calls throughout the app.
    5xx errors are logged as ERROR; 4xx as WARNING (only unusual ones — skip
    routine 401/404 to avoid log noise)."""
    path = request.url.path
    method = request.method
    detail = exc.detail or ""

    if exc.status_code >= 500:
        _logger.error("HTTP %s on %s %s: %s", exc.status_code, method, path, detail)
        _try_write_system_log(
            "ERROR", "http.error",
            f"HTTP {exc.status_code} {method} {path}: {detail}",
            {"status_code": exc.status_code, "path": path, "method": method, "detail": str(detail)},
        )
    elif exc.status_code not in (401, 404):
        # Log unexpected 4xx (e.g. 403 Forbidden, 413 Too Large, 422 Unprocessable)
        # but skip 401 (wrong password) and 404 (normal not-found) to reduce noise
        _logger.warning("HTTP %s on %s %s: %s", exc.status_code, method, path, detail)
        _try_write_system_log(
            "WARNING", "http.error",
            f"HTTP {exc.status_code} {method} {path}: {detail}",
            {"status_code": exc.status_code, "path": path, "method": method, "detail": str(detail)},
        )

    return JSONResponse(status_code=exc.status_code, content={"detail": detail})


@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request: Request, exc: RequestValidationError):
    """Handles Pydantic validation failures (missing fields, wrong types) — FastAPI
    returns 422 for these automatically. Logged as WARNING so bad client requests
    are visible without polluting the ERROR channel."""
    path = request.url.path
    errors = exc.errors()
    _logger.warning("Validation error on %s %s: %s", request.method, path, errors)
    _try_write_system_log(
        "WARNING", "http.validation",
        f"422 Unprocessable Entity {request.method} {path}",
        {"path": path, "method": request.method, "errors": errors[:10]},
    )
    return JSONResponse(
        status_code=422,
        content={"detail": errors},
    )


@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception):
    """Catch-all for any exception not handled above — a true safety net.
    Logged as ERROR with a truncated traceback so it appears in system_logs
    and server output."""
    tb = traceback.format_exc()
    path = request.url.path
    _logger.error("Unhandled %s on %s %s: %s", type(exc).__name__, request.method, path, exc)
    _logger.error(tb)
    _try_write_system_log(
        "ERROR", "app.unhandled",
        f"Unhandled {type(exc).__name__} on {request.method} {path}: {exc}",
        {"exception": type(exc).__name__, "path": path, "method": request.method, "traceback": tb[-2000:]},
    )
    return JSONResponse(
        status_code=500,
        content={"detail": f"Internal server error: {type(exc).__name__}: {exc}"},
    )


@app.get("/health", tags=["system"])
@app.get("/api/health", tags=["system"])
def health():
    return {"status": "ok", "service": "MemoLink API", "version": "2.1.0"}


# Build allowed origins list — always wildcard, plus the explicit frontend
# URL from env so the correct origin appears in CORS responses when Lambda
# or a CDN strips the wildcard header from error responses.
_cors_origins: list[str] = ["*"]
if settings.frontend_url and settings.frontend_url not in _cors_origins:
    _cors_origins.append(settings.frontend_url)

app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins,
    # allow_credentials must be False when allow_origins includes "*".
    # MemoLink uses Bearer token auth (Authorization header), not cookies,
    # so credentials mode is not needed.
    allow_credentials=False,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    # Explicitly list headers so the preflight Access-Control-Allow-Headers
    # response is concrete — required for requests with an Authorization header.
    allow_headers=["Authorization", "Content-Type", "Accept", "Origin",
                   "X-Requested-With", "X-Real-IP", "X-Forwarded-For"],
    expose_headers=["Content-Length", "Content-Range"],
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
app.include_router(logs_controller.router, prefix="/api")
app.include_router(s3_upload_controller.router, prefix="/api")

# AWS Lambda handler — only active when running inside Lambda
if os.getenv("AWS_LAMBDA_FUNCTION_NAME"):
    from mangum import Mangum
    handler = Mangum(app, lifespan="off")
