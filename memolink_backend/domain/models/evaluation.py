"""
Evaluation Analytics models
===========================
Quantitative research telemetry for capstone evaluation - kept entirely separate
from `system_logs` (operational) and `feedback` (bug reports).

Privacy: these tables store IDs, counts, timings, ratings, and short metadata
ONLY. Never full prompts, full answers, note content, files, or secrets.

`JSON` (not `JSONB`) and `Float` (not `NUMERIC`) are used so the models also work
under SQLite in tests; the Postgres DDL in main.py creates the live tables.
"""
from sqlalchemy import (
    Column, Integer, BigInteger, Text, String, Boolean, Float, ForeignKey, TIMESTAMP, JSON,
)
from sqlalchemy.sql import func
from memolink_backend.core.db import Base


class EvaluationSession(Base):
    __tablename__ = "evaluation_sessions"

    id                      = Column(Integer, primary_key=True, index=True)
    participant_code        = Column(String(50), nullable=False, index=True)
    user_id                 = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    workspace_id            = Column(Integer, nullable=True)
    consent_confirmed       = Column(Boolean, nullable=False, default=False)
    role                    = Column(String(100), nullable=True)
    ai_tool_usage_frequency = Column(String(50), nullable=True)
    device_type             = Column(String(50), nullable=True)
    browser                 = Column(String(100), nullable=True)
    operating_system        = Column(String(100), nullable=True)
    started_at              = Column(TIMESTAMP(timezone=True), server_default=func.now(), nullable=False)
    ended_at                = Column(TIMESTAMP(timezone=True), nullable=True)
    total_time_seconds      = Column(Integer, nullable=True)   # consumed foreground-usage seconds
    budget_seconds          = Column(Integer, nullable=True)   # per-user override; null → default
    completed               = Column(Boolean, nullable=False, default=False)
    notes                   = Column(Text, nullable=True)


class EvaluationTask(Base):
    __tablename__ = "evaluation_tasks"

    id                  = Column(Integer, primary_key=True, index=True)
    session_id          = Column(Integer, ForeignKey("evaluation_sessions.id", ondelete="CASCADE"), nullable=False, index=True)
    user_id             = Column(Integer, nullable=True)
    workspace_id        = Column(Integer, nullable=True)
    task_key            = Column(String(100), nullable=False)
    task_name           = Column(String(255), nullable=False)
    feature_name        = Column(String(100), nullable=True)
    started_at          = Column(TIMESTAMP(timezone=True), server_default=func.now(), nullable=False)
    completed_at        = Column(TIMESTAMP(timezone=True), nullable=True)
    time_taken_ms       = Column(Integer, nullable=True)
    completed           = Column(Boolean, nullable=False, default=False)
    success             = Column(Boolean, nullable=True)
    error_count         = Column(Integer, nullable=False, default=0)
    retry_count         = Column(Integer, nullable=False, default=0)
    click_count         = Column(Integer, nullable=True)
    created_object_type = Column(String(100), nullable=True)
    created_object_id   = Column(Integer, nullable=True)
    notes               = Column(Text, nullable=True)


class EvaluationEvent(Base):
    __tablename__ = "evaluation_events"

    id                 = Column(Integer, primary_key=True, index=True)
    session_id         = Column(Integer, ForeignKey("evaluation_sessions.id", ondelete="SET NULL"), nullable=True, index=True)
    task_id            = Column(Integer, nullable=True)
    user_id            = Column(Integer, nullable=True)
    workspace_id       = Column(Integer, nullable=True)
    conversation_id    = Column(Integer, nullable=True)
    message_id         = Column(Integer, nullable=True)
    note_id            = Column(Integer, nullable=True)
    feature_name       = Column(String(100), nullable=False, index=True)
    operation_name     = Column(String(100), nullable=False)
    event_type         = Column(String(100), nullable=False)
    status             = Column(String(30), nullable=False)
    started_at         = Column(TIMESTAMP(timezone=True), nullable=True)
    ended_at           = Column(TIMESTAMP(timezone=True), nullable=True)
    duration_ms        = Column(Integer, nullable=True)
    error_type         = Column(String(100), nullable=True)
    error_code         = Column(String(100), nullable=True)
    error_message_safe = Column(Text, nullable=True)
    event_metadata     = Column("metadata", JSON, nullable=True)
    created_at         = Column(TIMESTAMP(timezone=True), server_default=func.now(), index=True)


class EvaluationAiMetric(Base):
    __tablename__ = "evaluation_ai_metrics"

    id                     = Column(Integer, primary_key=True, index=True)
    session_id             = Column(Integer, ForeignKey("evaluation_sessions.id", ondelete="SET NULL"), nullable=True)
    task_id                = Column(Integer, nullable=True)
    user_id                = Column(Integer, nullable=True)
    workspace_id           = Column(Integer, nullable=True)
    conversation_id        = Column(Integer, nullable=True)
    message_id             = Column(Integer, nullable=True, index=True)
    feature_name           = Column(String(100), nullable=False)
    prompt_length_chars    = Column(Integer, nullable=True)
    prompt_length_words    = Column(Integer, nullable=True)
    answer_length_chars    = Column(Integer, nullable=True)
    answer_length_words    = Column(Integer, nullable=True)
    selected_model         = Column(String(100), nullable=True)
    actual_model_used      = Column(String(100), nullable=True)
    provider               = Column(String(100), nullable=True)
    autopilot_used         = Column(Boolean, nullable=False, default=False)
    autopilot_reason       = Column(String(255), nullable=True)
    fallback_used          = Column(Boolean, nullable=False, default=False)
    fallback_attempt_count = Column(Integer, nullable=False, default=0)
    failed_models          = Column(JSON, nullable=True)
    web_search_enabled     = Column(Boolean, nullable=False, default=False)
    graph_rag_enabled      = Column(Boolean, nullable=False, default=False)
    top_k_requested        = Column(Integer, nullable=True)
    retrieved_note_count   = Column(Integer, nullable=True)
    citation_count         = Column(Integer, nullable=True)
    source_note_ids        = Column(JSON, nullable=True)
    retrieval_min_score    = Column(Float, nullable=True)
    retrieval_max_score    = Column(Float, nullable=True)
    retrieval_avg_score    = Column(Float, nullable=True)
    confidence_level       = Column(String(30), nullable=True, index=True)
    confidence_reason      = Column(Text, nullable=True)
    confidence_method      = Column(String(50), nullable=True)
    input_tokens           = Column(Integer, nullable=True)
    output_tokens          = Column(Integer, nullable=True)
    total_tokens           = Column(Integer, nullable=True)
    estimated_cost_usd     = Column(Float, nullable=True)
    first_token_latency_ms = Column(Integer, nullable=True)
    total_response_time_ms = Column(Integer, nullable=True)
    stream_duration_ms     = Column(Integer, nullable=True)
    embedding_time_ms      = Column(Integer, nullable=True)
    retrieval_time_ms      = Column(Integer, nullable=True)
    llm_time_ms            = Column(Integer, nullable=True)
    created_at             = Column(TIMESTAMP(timezone=True), server_default=func.now(), index=True)


class EvaluationUserRating(Base):
    __tablename__ = "evaluation_user_ratings"

    id               = Column(Integer, primary_key=True, index=True)
    session_id       = Column(Integer, ForeignKey("evaluation_sessions.id", ondelete="CASCADE"), nullable=True)
    task_id          = Column(Integer, nullable=True)
    event_id         = Column(Integer, nullable=True)
    ai_metric_id     = Column(Integer, nullable=True)
    message_id       = Column(Integer, nullable=True)
    rating_type      = Column(String(100), nullable=False, index=True)
    rating_value     = Column(Integer, nullable=False)
    rating_scale_min = Column(Integer, nullable=False, default=1)
    rating_scale_max = Column(Integer, nullable=False, default=5)
    choice_value     = Column(String(100), nullable=True)
    comment          = Column(Text, nullable=True)
    created_at       = Column(TIMESTAMP(timezone=True), server_default=func.now(), index=True)


class EvaluationTranslationMetric(Base):
    __tablename__ = "evaluation_translation_metrics"

    id                          = Column(Integer, primary_key=True, index=True)
    session_id                  = Column(Integer, nullable=True)
    task_id                     = Column(Integer, nullable=True)
    user_id                     = Column(Integer, nullable=True)
    workspace_id                = Column(Integer, nullable=True)
    message_id                  = Column(Integer, nullable=True)
    source_language             = Column(String(100), nullable=True)
    target_language             = Column(String(100), nullable=False)
    model_used                  = Column(String(100), nullable=True)
    accuracy_score              = Column(Integer, nullable=True)
    refinement_rounds           = Column(Integer, nullable=False, default=0)
    cached                      = Column(Boolean, nullable=False, default=False)
    force_retranslate           = Column(Boolean, nullable=False, default=False)
    fallback_used               = Column(Boolean, nullable=False, default=False)
    translation_time_ms         = Column(Integer, nullable=True)
    source_text_length_chars    = Column(Integer, nullable=True)
    translated_text_length_chars = Column(Integer, nullable=True)
    user_quality_rating         = Column(Integer, nullable=True)
    created_at                  = Column(TIMESTAMP(timezone=True), server_default=func.now())


class EvaluationTranscriptionMetric(Base):
    __tablename__ = "evaluation_transcription_metrics"

    id                            = Column(Integer, primary_key=True, index=True)
    session_id                    = Column(Integer, nullable=True)
    task_id                       = Column(Integer, nullable=True)
    user_id                       = Column(Integer, nullable=True)
    workspace_id                  = Column(Integer, nullable=True)
    note_id                       = Column(Integer, nullable=True)
    file_type                     = Column(String(50), nullable=True)
    file_size_bytes               = Column(BigInteger, nullable=True)
    file_size_mb                  = Column(Float, nullable=True)
    duration_seconds              = Column(Integer, nullable=True)
    transcription_service_used    = Column(String(100), nullable=True)
    fallback_used                 = Column(Boolean, nullable=False, default=False)
    transcription_success         = Column(Boolean, nullable=False, default=False)
    transcription_time_ms         = Column(Integer, nullable=True)
    transcript_word_count         = Column(Integer, nullable=True)
    note_created                  = Column(Boolean, nullable=False, default=False)
    error_type                    = Column(String(100), nullable=True)
    user_transcript_accuracy_rating = Column(Integer, nullable=True)
    user_note_quality_rating      = Column(Integer, nullable=True)
    created_at                    = Column(TIMESTAMP(timezone=True), server_default=func.now())


class EvaluationReminderMetric(Base):
    __tablename__ = "evaluation_reminder_metrics"

    id                    = Column(Integer, primary_key=True, index=True)
    session_id            = Column(Integer, nullable=True)
    task_id               = Column(Integer, nullable=True)
    user_id               = Column(Integer, nullable=True)
    workspace_id          = Column(Integer, nullable=True)
    source_note_id        = Column(Integer, nullable=True)
    reminder_id           = Column(Integer, nullable=True)
    proactive_insight_id  = Column(Integer, nullable=True)
    detection_type        = Column(String(100), nullable=True)
    generated_count       = Column(Integer, nullable=False, default=0)
    accepted_count        = Column(Integer, nullable=False, default=0)
    dismissed_count       = Column(Integer, nullable=False, default=0)
    completed_count       = Column(Integer, nullable=False, default=0)
    false_positive_marked = Column(Boolean, nullable=False, default=False)
    missed_action_reported = Column(Boolean, nullable=False, default=False)
    usefulness_rating     = Column(Integer, nullable=True)
    created_at            = Column(TIMESTAMP(timezone=True), server_default=func.now())


class EvaluationQuizMetric(Base):
    __tablename__ = "evaluation_quiz_metrics"

    id                    = Column(Integer, primary_key=True, index=True)
    session_id            = Column(Integer, nullable=True)
    task_id               = Column(Integer, nullable=True)
    user_id               = Column(Integer, nullable=True)
    workspace_id          = Column(Integer, nullable=True)
    note_id               = Column(Integer, nullable=True)
    source_type           = Column(String(50), nullable=True)
    question_count        = Column(Integer, nullable=True)
    single_choice_count   = Column(Integer, nullable=True)
    multi_choice_count    = Column(Integer, nullable=True)
    correct_count         = Column(Integer, nullable=True)
    incorrect_count       = Column(Integer, nullable=True)
    score_percent         = Column(Float, nullable=True)
    time_taken_ms         = Column(Integer, nullable=True)
    attempt_number        = Column(Integer, nullable=False, default=1)
    saved_results_to_notes = Column(Boolean, nullable=False, default=False)
    difficulty_rating     = Column(Integer, nullable=True)
    usefulness_rating     = Column(Integer, nullable=True)
    created_at            = Column(TIMESTAMP(timezone=True), server_default=func.now())


class EvaluationTimelineMetric(Base):
    __tablename__ = "evaluation_timeline_metrics"

    id                     = Column(Integer, primary_key=True, index=True)
    session_id             = Column(Integer, nullable=True)
    task_id                = Column(Integer, nullable=True)
    user_id                = Column(Integer, nullable=True)
    workspace_id           = Column(Integer, nullable=True)
    note_id                = Column(Integer, nullable=True)
    transcript_word_count  = Column(Integer, nullable=True)
    generation_time_ms     = Column(Integer, nullable=True)
    chapter_count          = Column(Integer, nullable=True)
    action_item_count      = Column(Integer, nullable=True)
    important_moment_count = Column(Integer, nullable=True)
    jump_clicked_count     = Column(Integer, nullable=False, default=0)
    jump_success_count     = Column(Integer, nullable=False, default=0)
    usefulness_rating      = Column(Integer, nullable=True)
    created_at             = Column(TIMESTAMP(timezone=True), server_default=func.now())


class EvaluationFeatureUsage(Base):
    __tablename__ = "evaluation_feature_usage"

    id            = Column(Integer, primary_key=True, index=True)
    session_id    = Column(Integer, nullable=True)
    user_id       = Column(Integer, nullable=True)
    workspace_id  = Column(Integer, nullable=True)
    feature_name  = Column(String(100), nullable=False)
    action_name   = Column(String(100), nullable=False)
    count         = Column(Integer, nullable=False, default=1)
    first_used_at = Column(TIMESTAMP(timezone=True), server_default=func.now())
    last_used_at  = Column(TIMESTAMP(timezone=True), server_default=func.now())
