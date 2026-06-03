import json
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
    """Write to system_logs without ever raising - used inside exception handlers."""
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
    user_settings_controller,
    slash_command_controller,
    email_controller,
    memograph_controller,
    proactive_insight_controller,
    study_controller,
    timeline_controller,
    workflow_controller,
    survey_controller,
    evaluation_controller,
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
import memolink_backend.domain.models.user_api_key      # noqa: F401
import memolink_backend.domain.models.email_account     # noqa: F401
import memolink_backend.domain.models.email_record      # noqa: F401
import memolink_backend.domain.models.graph_node        # noqa: F401
import memolink_backend.domain.models.graph_edge        # noqa: F401
import memolink_backend.domain.models.proactive_insight # noqa: F401
import memolink_backend.domain.models.note_timeline      # noqa: F401
import memolink_backend.domain.models.survey              # noqa: F401
import memolink_backend.domain.models.evaluation          # noqa: F401

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
        _conn.execute(text("ALTER TABLE messages ADD COLUMN IF NOT EXISTS confidence VARCHAR(20)"))
        _conn.execute(text("ALTER TABLE messages ADD COLUMN IF NOT EXISTS confidence_reason TEXT"))
        _conn.execute(text("INSERT INTO feature_flags (key, value) VALUES ('confidence_enabled', 'true') ON CONFLICT (key) DO NOTHING"))
        _conn.execute(text("INSERT INTO feature_flags (key, value) VALUES ('autopilot_enabled', 'true') ON CONFLICT (key) DO NOTHING"))
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
            ("tts_enabled", "true"), ("slash_commands_enabled", "true"),
            ("custom_api_keys_enabled", "true"), ("video_import_enabled", "true"),
            ("email_enabled", "true"),
            ("default_model", "gpt-4o-mini"), ("default_language", "English"),
            ("web_search_min_level", "regular"), ("agent_mode_min_level", "regular"),
            ("model_selection_min_level", "regular"), ("image_generation_min_level", "regular"),
            ("translation_min_level", "regular"), ("file_upload_min_level", "regular"),
            ("research_mode_min_level", "regular"), ("model_attribution_min_level", "regular"),
            ("tts_min_level", "regular"), ("slash_commands_min_level", "regular"),
            ("custom_api_keys_min_level", "regular"), ("video_import_min_level", "regular"),
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
        # User API keys table
        _conn.execute(text("""
            CREATE TABLE IF NOT EXISTS user_api_keys (
                id SERIAL PRIMARY KEY,
                user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                provider VARCHAR(100) NOT NULL,
                encrypted_key TEXT NOT NULL,
                base_url TEXT,
                model VARCHAR(100),
                created_at TIMESTAMPTZ DEFAULT now(),
                updated_at TIMESTAMPTZ DEFAULT now(),
                UNIQUE(user_id, provider)
            )
        """))
        _conn.execute(text("ALTER TABLE user_api_keys ADD COLUMN IF NOT EXISTS base_url TEXT"))
        _conn.execute(text("ALTER TABLE user_api_keys ADD COLUMN IF NOT EXISTS model VARCHAR(100)"))
        # Email records table
        _conn.execute(text("""
            CREATE TABLE IF NOT EXISTS email_records (
                id SERIAL PRIMARY KEY,
                user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                gmail_message_id VARCHAR(255) NOT NULL,
                subject TEXT NOT NULL DEFAULT '(no subject)',
                sender_name VARCHAR(255),
                sender_email VARCHAR(255) NOT NULL,
                snippet TEXT,
                body_text TEXT,
                importance_score FLOAT NOT NULL DEFAULT 3.0,
                is_read BOOLEAN NOT NULL DEFAULT FALSE,
                email_date TIMESTAMPTZ,
                synced_at TIMESTAMPTZ DEFAULT now()
            )
        """))
        _conn.execute(text("CREATE INDEX IF NOT EXISTS ix_email_records_user_id ON email_records(user_id)"))
        _conn.execute(text("CREATE INDEX IF NOT EXISTS ix_email_records_gmail_message_id ON email_records(gmail_message_id)"))
        _conn.execute(text("ALTER TABLE email_records ADD COLUMN IF NOT EXISTS note_appended BOOLEAN NOT NULL DEFAULT FALSE"))
        _conn.execute(text("ALTER TABLE email_records ADD COLUMN IF NOT EXISTS gmail_thread_id VARCHAR(255)"))
        _conn.execute(text("ALTER TABLE reminders ADD COLUMN IF NOT EXISTS email_record_id INTEGER REFERENCES email_records(id) ON DELETE SET NULL"))
        # Email accounts table
        _conn.execute(text("""
            CREATE TABLE IF NOT EXISTS email_accounts (
                id SERIAL PRIMARY KEY,
                user_id INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
                provider VARCHAR(50) NOT NULL DEFAULT 'google',
                email_address VARCHAR(255) NOT NULL,
                encrypted_access_token TEXT NOT NULL,
                encrypted_refresh_token TEXT NOT NULL,
                token_expiry TIMESTAMPTZ,
                connected_at TIMESTAMPTZ DEFAULT now(),
                updated_at TIMESTAMPTZ DEFAULT now()
            )
        """))
        # Slash command undo snapshot columns
        _conn.execute(text("ALTER TABLE notes ADD COLUMN IF NOT EXISTS undo_title TEXT"))
        _conn.execute(text("ALTER TABLE notes ADD COLUMN IF NOT EXISTS undo_content TEXT"))
        _conn.execute(text("ALTER TABLE notes ADD COLUMN IF NOT EXISTS undo_command VARCHAR(50)"))
        _conn.execute(text("ALTER TABLE notes ADD COLUMN IF NOT EXISTS undo_instruction TEXT"))
        _conn.execute(text("ALTER TABLE notes ADD COLUMN IF NOT EXISTS undo_created_at TIMESTAMPTZ"))
        _conn.execute(text("ALTER TABLE notes ADD COLUMN IF NOT EXISTS undo_available BOOLEAN DEFAULT FALSE"))
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
        # MemoGraph tables
        _conn.execute(text("""
            CREATE TABLE IF NOT EXISTS graph_nodes (
                id SERIAL PRIMARY KEY,
                user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                workspace_id INTEGER REFERENCES workspaces(id) ON DELETE CASCADE,
                node_type VARCHAR(50) NOT NULL,
                label VARCHAR(500) NOT NULL,
                source_id INTEGER,
                created_at TIMESTAMPTZ DEFAULT now(),
                UNIQUE (user_id, workspace_id, node_type, label)
            )
        """))
        _conn.execute(text("""
            CREATE TABLE IF NOT EXISTS graph_edges (
                id SERIAL PRIMARY KEY,
                user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                source_node_id INTEGER NOT NULL REFERENCES graph_nodes(id) ON DELETE CASCADE,
                target_node_id INTEGER NOT NULL REFERENCES graph_nodes(id) ON DELETE CASCADE,
                relationship VARCHAR(100) NOT NULL,
                created_at TIMESTAMPTZ DEFAULT now(),
                UNIQUE (source_node_id, target_node_id, relationship)
            )
        """))
        _conn.execute(text("INSERT INTO feature_flags (key, value) VALUES ('memograph_enabled', 'true') ON CONFLICT (key) DO NOTHING"))
        # Proactive Insights table
        _conn.execute(text("""
            CREATE TABLE IF NOT EXISTS proactive_insights (
                id SERIAL PRIMARY KEY,
                user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                workspace_id INTEGER REFERENCES workspaces(id) ON DELETE CASCADE,
                insight_type VARCHAR(50) NOT NULL,
                title VARCHAR(500) NOT NULL,
                description TEXT,
                note_id INTEGER REFERENCES notes(id) ON DELETE CASCADE,
                severity VARCHAR(20) NOT NULL DEFAULT 'info',
                is_dismissed BOOLEAN NOT NULL DEFAULT FALSE,
                created_at TIMESTAMPTZ DEFAULT now()
            )
        """))
        _conn.execute(text("CREATE INDEX IF NOT EXISTS ix_proactive_insights_workspace ON proactive_insights(user_id, workspace_id)"))
        _conn.execute(text("INSERT INTO feature_flags (key, value) VALUES ('proactive_insights_enabled', 'true') ON CONFLICT (key) DO NOTHING"))
        _conn.execute(text("INSERT INTO feature_flags (key, value) VALUES ('study_mode_enabled', 'true') ON CONFLICT (key) DO NOTHING"))
        _conn.execute(text("""
            CREATE TABLE IF NOT EXISTS note_timelines (
                id SERIAL PRIMARY KEY,
                note_id INTEGER NOT NULL UNIQUE REFERENCES notes(id) ON DELETE CASCADE,
                user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                summary TEXT,
                chapters JSONB NOT NULL DEFAULT '[]',
                action_items JSONB NOT NULL DEFAULT '[]',
                important_moments JSONB NOT NULL DEFAULT '[]',
                estimated_duration_seconds INTEGER,
                word_count INTEGER,
                generated_at TIMESTAMPTZ DEFAULT now()
            )
        """))
        _conn.execute(text("INSERT INTO feature_flags (key, value) VALUES ('timeline_enabled', 'true') ON CONFLICT (key) DO NOTHING"))
        _conn.execute(text("INSERT INTO feature_flags (key, value) VALUES ('workflow_enabled', 'true') ON CONFLICT (key) DO NOTHING"))
        # ── Evaluation Survey tables (research data - kept separate from feedback) ──
        _conn.execute(text("""
            CREATE TABLE IF NOT EXISTS survey_questions (
                id SERIAL PRIMARY KEY,
                section VARCHAR(120) NOT NULL DEFAULT 'General',
                question_key VARCHAR(120) NOT NULL UNIQUE,
                question_text TEXT NOT NULL,
                answer_type VARCHAR(20) NOT NULL DEFAULT 'likert',
                options JSONB NOT NULL DEFAULT '[]',
                order_index INTEGER NOT NULL DEFAULT 0,
                required BOOLEAN NOT NULL DEFAULT FALSE,
                active BOOLEAN NOT NULL DEFAULT TRUE,
                created_at TIMESTAMPTZ DEFAULT now(),
                updated_at TIMESTAMPTZ DEFAULT now()
            )
        """))
        _conn.execute(text("""
            CREATE TABLE IF NOT EXISTS survey_responses (
                id SERIAL PRIMARY KEY,
                user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
                workspace_id INTEGER,
                participant_code VARCHAR(50),
                role VARCHAR(120),
                ai_tool_usage_frequency VARCHAR(120),
                consent_confirmed BOOLEAN NOT NULL DEFAULT FALSE,
                created_at TIMESTAMPTZ DEFAULT now(),
                submitted_at TIMESTAMPTZ DEFAULT now()
            )
        """))
        _conn.execute(text("""
            CREATE TABLE IF NOT EXISTS survey_answers (
                id SERIAL PRIMARY KEY,
                survey_response_id INTEGER NOT NULL REFERENCES survey_responses(id) ON DELETE CASCADE,
                question_key VARCHAR(120) NOT NULL,
                question_text TEXT,
                answer_type VARCHAR(20),
                answer_value TEXT,
                created_at TIMESTAMPTZ DEFAULT now()
            )
        """))
        _conn.execute(text("CREATE INDEX IF NOT EXISTS ix_survey_answers_response ON survey_answers(survey_response_id)"))
        _conn.execute(text("INSERT INTO feature_flags (key, value) VALUES ('evaluation_survey_enabled', 'true') ON CONFLICT (key) DO NOTHING"))
        # Seed the default evaluation survey questions if none exist yet
        _existing_q = _conn.execute(text("SELECT COUNT(*) FROM survey_questions")).scalar()
        if not _existing_q:
            from memolink_backend.domain.survey_seed import DEFAULT_SURVEY_QUESTIONS
            for _i, _q in enumerate(DEFAULT_SURVEY_QUESTIONS):
                _conn.execute(
                    text("""
                        INSERT INTO survey_questions
                            (section, question_key, question_text, answer_type, options, order_index, required, active)
                        VALUES
                            (:section, :key, :qtext, :atype, CAST(:options AS JSONB), :ord, :req, TRUE)
                        ON CONFLICT (question_key) DO NOTHING
                    """),
                    {
                        "section": _q["section"],
                        "key": _q["question_key"],
                        "qtext": _q["question_text"],
                        "atype": _q["answer_type"],
                        "options": json.dumps(_q.get("options", [])),
                        "ord": _i,
                        "req": _q.get("required", False),
                    },
                )
        # ── Evaluation Analytics tables (quantitative research telemetry) ──────────
        _conn.execute(text("""
            CREATE TABLE IF NOT EXISTS evaluation_sessions (
                id SERIAL PRIMARY KEY,
                participant_code VARCHAR(50) NOT NULL,
                user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
                workspace_id INTEGER,
                consent_confirmed BOOLEAN NOT NULL DEFAULT FALSE,
                role VARCHAR(100),
                ai_tool_usage_frequency VARCHAR(50),
                device_type VARCHAR(50),
                browser VARCHAR(100),
                operating_system VARCHAR(100),
                started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
                ended_at TIMESTAMPTZ,
                total_time_seconds INTEGER,
                completed BOOLEAN NOT NULL DEFAULT FALSE,
                notes TEXT
            )
        """))
        _conn.execute(text("CREATE INDEX IF NOT EXISTS ix_eval_sessions_participant ON evaluation_sessions(participant_code)"))
        _conn.execute(text("ALTER TABLE evaluation_sessions ADD COLUMN IF NOT EXISTS budget_seconds INTEGER"))
        _conn.execute(text("""
            CREATE TABLE IF NOT EXISTS evaluation_tasks (
                id SERIAL PRIMARY KEY,
                session_id INTEGER NOT NULL REFERENCES evaluation_sessions(id) ON DELETE CASCADE,
                user_id INTEGER, workspace_id INTEGER,
                task_key VARCHAR(100) NOT NULL,
                task_name VARCHAR(255) NOT NULL,
                feature_name VARCHAR(100),
                started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
                completed_at TIMESTAMPTZ,
                time_taken_ms INTEGER,
                completed BOOLEAN NOT NULL DEFAULT FALSE,
                success BOOLEAN,
                error_count INTEGER NOT NULL DEFAULT 0,
                retry_count INTEGER NOT NULL DEFAULT 0,
                click_count INTEGER,
                created_object_type VARCHAR(100),
                created_object_id INTEGER,
                notes TEXT
            )
        """))
        _conn.execute(text("CREATE INDEX IF NOT EXISTS ix_eval_tasks_session ON evaluation_tasks(session_id)"))
        _conn.execute(text("""
            CREATE TABLE IF NOT EXISTS evaluation_events (
                id SERIAL PRIMARY KEY,
                session_id INTEGER REFERENCES evaluation_sessions(id) ON DELETE SET NULL,
                task_id INTEGER, user_id INTEGER, workspace_id INTEGER,
                conversation_id INTEGER, message_id INTEGER, note_id INTEGER,
                feature_name VARCHAR(100) NOT NULL,
                operation_name VARCHAR(100) NOT NULL,
                event_type VARCHAR(100) NOT NULL,
                status VARCHAR(30) NOT NULL,
                started_at TIMESTAMPTZ, ended_at TIMESTAMPTZ,
                duration_ms INTEGER,
                error_type VARCHAR(100), error_code VARCHAR(100), error_message_safe TEXT,
                metadata JSONB,
                created_at TIMESTAMPTZ DEFAULT now()
            )
        """))
        _conn.execute(text("CREATE INDEX IF NOT EXISTS ix_eval_events_session ON evaluation_events(session_id)"))
        _conn.execute(text("CREATE INDEX IF NOT EXISTS ix_eval_events_feature ON evaluation_events(feature_name)"))
        _conn.execute(text("CREATE INDEX IF NOT EXISTS ix_eval_events_created ON evaluation_events(created_at)"))
        _conn.execute(text("""
            CREATE TABLE IF NOT EXISTS evaluation_ai_metrics (
                id SERIAL PRIMARY KEY,
                session_id INTEGER REFERENCES evaluation_sessions(id) ON DELETE SET NULL,
                task_id INTEGER, user_id INTEGER, workspace_id INTEGER,
                conversation_id INTEGER, message_id INTEGER,
                feature_name VARCHAR(100) NOT NULL,
                prompt_length_chars INTEGER, prompt_length_words INTEGER,
                answer_length_chars INTEGER, answer_length_words INTEGER,
                selected_model VARCHAR(100), actual_model_used VARCHAR(100), provider VARCHAR(100),
                autopilot_used BOOLEAN NOT NULL DEFAULT FALSE, autopilot_reason VARCHAR(255),
                fallback_used BOOLEAN NOT NULL DEFAULT FALSE, fallback_attempt_count INTEGER NOT NULL DEFAULT 0,
                failed_models JSONB,
                web_search_enabled BOOLEAN NOT NULL DEFAULT FALSE,
                graph_rag_enabled BOOLEAN NOT NULL DEFAULT FALSE,
                top_k_requested INTEGER, retrieved_note_count INTEGER, citation_count INTEGER,
                source_note_ids JSONB,
                retrieval_min_score FLOAT, retrieval_max_score FLOAT, retrieval_avg_score FLOAT,
                confidence_level VARCHAR(30), confidence_reason TEXT, confidence_method VARCHAR(50),
                input_tokens INTEGER, output_tokens INTEGER, total_tokens INTEGER,
                estimated_cost_usd NUMERIC(12,6),
                first_token_latency_ms INTEGER, total_response_time_ms INTEGER, stream_duration_ms INTEGER,
                embedding_time_ms INTEGER, retrieval_time_ms INTEGER, llm_time_ms INTEGER,
                created_at TIMESTAMPTZ DEFAULT now()
            )
        """))
        _conn.execute(text("CREATE INDEX IF NOT EXISTS ix_eval_ai_message ON evaluation_ai_metrics(message_id)"))
        _conn.execute(text("CREATE INDEX IF NOT EXISTS ix_eval_ai_confidence ON evaluation_ai_metrics(confidence_level)"))
        _conn.execute(text("CREATE INDEX IF NOT EXISTS ix_eval_ai_created ON evaluation_ai_metrics(created_at)"))
        _conn.execute(text("""
            CREATE TABLE IF NOT EXISTS evaluation_user_ratings (
                id SERIAL PRIMARY KEY,
                session_id INTEGER REFERENCES evaluation_sessions(id) ON DELETE CASCADE,
                task_id INTEGER, event_id INTEGER, ai_metric_id INTEGER, message_id INTEGER,
                rating_type VARCHAR(100) NOT NULL,
                rating_value INTEGER NOT NULL,
                rating_scale_min INTEGER NOT NULL DEFAULT 1,
                rating_scale_max INTEGER NOT NULL DEFAULT 5,
                choice_value VARCHAR(100), comment TEXT,
                created_at TIMESTAMPTZ DEFAULT now()
            )
        """))
        _conn.execute(text("CREATE INDEX IF NOT EXISTS ix_eval_ratings_type ON evaluation_user_ratings(rating_type)"))
        _conn.execute(text("""
            CREATE TABLE IF NOT EXISTS evaluation_translation_metrics (
                id SERIAL PRIMARY KEY, session_id INTEGER, task_id INTEGER, user_id INTEGER, workspace_id INTEGER,
                message_id INTEGER, source_language VARCHAR(100), target_language VARCHAR(100) NOT NULL,
                model_used VARCHAR(100), accuracy_score INTEGER, refinement_rounds INTEGER NOT NULL DEFAULT 0,
                cached BOOLEAN NOT NULL DEFAULT FALSE, force_retranslate BOOLEAN NOT NULL DEFAULT FALSE,
                fallback_used BOOLEAN NOT NULL DEFAULT FALSE, translation_time_ms INTEGER,
                source_text_length_chars INTEGER, translated_text_length_chars INTEGER,
                user_quality_rating INTEGER, created_at TIMESTAMPTZ DEFAULT now()
            )
        """))
        _conn.execute(text("""
            CREATE TABLE IF NOT EXISTS evaluation_transcription_metrics (
                id SERIAL PRIMARY KEY, session_id INTEGER, task_id INTEGER, user_id INTEGER, workspace_id INTEGER,
                note_id INTEGER, file_type VARCHAR(50), file_size_bytes BIGINT, file_size_mb FLOAT,
                duration_seconds INTEGER, transcription_service_used VARCHAR(100),
                fallback_used BOOLEAN NOT NULL DEFAULT FALSE, transcription_success BOOLEAN NOT NULL DEFAULT FALSE,
                transcription_time_ms INTEGER, transcript_word_count INTEGER, note_created BOOLEAN NOT NULL DEFAULT FALSE,
                error_type VARCHAR(100), user_transcript_accuracy_rating INTEGER, user_note_quality_rating INTEGER,
                created_at TIMESTAMPTZ DEFAULT now()
            )
        """))
        _conn.execute(text("""
            CREATE TABLE IF NOT EXISTS evaluation_reminder_metrics (
                id SERIAL PRIMARY KEY, session_id INTEGER, task_id INTEGER, user_id INTEGER, workspace_id INTEGER,
                source_note_id INTEGER, reminder_id INTEGER, proactive_insight_id INTEGER, detection_type VARCHAR(100),
                generated_count INTEGER NOT NULL DEFAULT 0, accepted_count INTEGER NOT NULL DEFAULT 0,
                dismissed_count INTEGER NOT NULL DEFAULT 0, completed_count INTEGER NOT NULL DEFAULT 0,
                false_positive_marked BOOLEAN NOT NULL DEFAULT FALSE, missed_action_reported BOOLEAN NOT NULL DEFAULT FALSE,
                usefulness_rating INTEGER, created_at TIMESTAMPTZ DEFAULT now()
            )
        """))
        _conn.execute(text("""
            CREATE TABLE IF NOT EXISTS evaluation_quiz_metrics (
                id SERIAL PRIMARY KEY, session_id INTEGER, task_id INTEGER, user_id INTEGER, workspace_id INTEGER,
                note_id INTEGER, source_type VARCHAR(50), question_count INTEGER, single_choice_count INTEGER,
                multi_choice_count INTEGER, correct_count INTEGER, incorrect_count INTEGER, score_percent FLOAT,
                time_taken_ms INTEGER, attempt_number INTEGER NOT NULL DEFAULT 1,
                saved_results_to_notes BOOLEAN NOT NULL DEFAULT FALSE, difficulty_rating INTEGER, usefulness_rating INTEGER,
                created_at TIMESTAMPTZ DEFAULT now()
            )
        """))
        _conn.execute(text("""
            CREATE TABLE IF NOT EXISTS evaluation_timeline_metrics (
                id SERIAL PRIMARY KEY, session_id INTEGER, task_id INTEGER, user_id INTEGER, workspace_id INTEGER,
                note_id INTEGER, transcript_word_count INTEGER, generation_time_ms INTEGER, chapter_count INTEGER,
                action_item_count INTEGER, important_moment_count INTEGER, jump_clicked_count INTEGER NOT NULL DEFAULT 0,
                jump_success_count INTEGER NOT NULL DEFAULT 0, usefulness_rating INTEGER, created_at TIMESTAMPTZ DEFAULT now()
            )
        """))
        _conn.execute(text("""
            CREATE TABLE IF NOT EXISTS evaluation_feature_usage (
                id SERIAL PRIMARY KEY, session_id INTEGER, user_id INTEGER, workspace_id INTEGER,
                feature_name VARCHAR(100) NOT NULL, action_name VARCHAR(100) NOT NULL, count INTEGER NOT NULL DEFAULT 1,
                first_used_at TIMESTAMPTZ DEFAULT now(), last_used_at TIMESTAMPTZ DEFAULT now()
            )
        """))
        for _fk in ("evaluation_analytics_enabled", "evaluation_admin_export_enabled"):
            _conn.execute(text("INSERT INTO feature_flags (key, value) VALUES (:k, 'true') ON CONFLICT (key) DO NOTHING"), {"k": _fk})
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
    description="Context-aware AI knowledge companion - RAG-powered note retrieval and chat.",
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
    5xx errors are logged as ERROR; 4xx as WARNING (only unusual ones - skip
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
    """Handles Pydantic validation failures (missing fields, wrong types) - FastAPI
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
    """Catch-all for any exception not handled above - a true safety net.
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
    import os
    return {
        "status": "ok",
        "service": "MemoLink API",
        "version": "2.1.2",
        # Temporary debug - shows whether S3 env vars are visible to the app
        "s3_bucket_set": bool(settings.s3_upload_bucket),
        "s3_bucket_len": len(settings.s3_upload_bucket),
        "s3_env_raw": bool(os.environ.get("S3_UPLOAD_BUCKET")),
    }


# Build allowed origins list - always wildcard, plus the explicit frontend
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
    # response is concrete - required for requests with an Authorization header.
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
app.include_router(user_settings_controller.router, prefix="/api")
app.include_router(slash_command_controller.router, prefix="/api")
app.include_router(email_controller.router, prefix="/api")
app.include_router(memograph_controller.router, prefix="/api")
app.include_router(proactive_insight_controller.router, prefix="/api")
app.include_router(study_controller.router, prefix="/api")
app.include_router(timeline_controller.router, prefix="/api")
app.include_router(workflow_controller.router, prefix="/api")
app.include_router(survey_controller.router, prefix="/api")
app.include_router(evaluation_controller.router, prefix="/api")

# AWS Lambda handler - only active when running inside Lambda
if os.getenv("AWS_LAMBDA_FUNCTION_NAME"):
    from mangum import Mangum
    handler = Mangum(app, lifespan="off")
