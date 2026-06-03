"""
Evaluation Survey models
========================
Three tables, kept separate from `feedback` (bug reports / suggestions) so
research data is never mixed with product-support data:

- survey_questions  → admin-editable, dynamic question definitions
- survey_responses  → one row per submitted survey (metadata + consent)
- survey_answers    → one row per answered question (long format, easy to export)

`options` uses JSON (not JSONB) so the models also work under SQLite in tests;
the Postgres DDL in main.py creates the live tables with JSONB.
"""

from sqlalchemy import Column, Integer, Text, String, Boolean, ForeignKey, TIMESTAMP, JSON
from sqlalchemy.sql import func
from memolink_backend.core.db import Base


class SurveyQuestion(Base):
    __tablename__ = "survey_questions"

    id            = Column(Integer, primary_key=True, index=True)
    section       = Column(String(120), nullable=False, default="General")
    question_key  = Column(String(120), nullable=False, unique=True, index=True)
    question_text = Column(Text, nullable=False)
    # likert | single | multi | yesno | short | long
    answer_type   = Column(String(20), nullable=False, default="likert")
    options       = Column(JSON, nullable=False, default=list)   # choices for single/multi/yesno
    order_index   = Column(Integer, nullable=False, default=0)
    required      = Column(Boolean, nullable=False, default=False)
    active        = Column(Boolean, nullable=False, default=True)
    created_at    = Column(TIMESTAMP(timezone=True), server_default=func.now())
    updated_at    = Column(TIMESTAMP(timezone=True), server_default=func.now())


class SurveyResponse(Base):
    __tablename__ = "survey_responses"

    id                      = Column(Integer, primary_key=True, index=True)
    user_id                 = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    workspace_id            = Column(Integer, nullable=True)
    participant_code        = Column(String(50), nullable=True)
    role                    = Column(String(120), nullable=True)
    ai_tool_usage_frequency = Column(String(120), nullable=True)
    consent_confirmed       = Column(Boolean, nullable=False, default=False)
    created_at              = Column(TIMESTAMP(timezone=True), server_default=func.now())
    submitted_at            = Column(TIMESTAMP(timezone=True), server_default=func.now())


class SurveyAnswer(Base):
    __tablename__ = "survey_answers"

    id                 = Column(Integer, primary_key=True, index=True)
    survey_response_id = Column(Integer, ForeignKey("survey_responses.id", ondelete="CASCADE"), nullable=False, index=True)
    question_key       = Column(String(120), nullable=False)
    question_text      = Column(Text, nullable=True)
    answer_type        = Column(String(20), nullable=True)
    answer_value       = Column(Text, nullable=True)   # multi-choice stored as JSON array string
    created_at         = Column(TIMESTAMP(timezone=True), server_default=func.now())
