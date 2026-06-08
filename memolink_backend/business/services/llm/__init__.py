"""Reusable LLM helpers for MemoLink services.

This package keeps prompt logic, request analysis, quality checks, and
provider client helpers in smaller modules so chat- and writing-related
features can share them without depending on one large service file.
"""

from .academic import (
    build_dynamic_academic_queries,
    build_dynamic_academic_title,
    extract_course_codes,
    extract_topic_terms,
    parse_word_targets,
)
from .analysis import analyse_request
from .client_factory import canonical_model, get_client
from .context_engine import PreparedContext, build_context_engine
from .messages import build_optimized_task_message, build_primary_system_prompt, get_mode_prompt, get_mode_settings
from .prompts import (
    ANALYSER_PROMPT,
    MODE_PROMPTS,
    MODE_SETTINGS,
    MODES,
    QUALITY_CHECK_MODES,
    QUALITY_PROMPT,
)
from .quality import quality_check

__all__ = [
    "ANALYSER_PROMPT",
    "MODE_PROMPTS",
    "MODE_SETTINGS",
    "MODES",
    "QUALITY_CHECK_MODES",
    "QUALITY_PROMPT",
    "analyse_request",
    "build_context_engine",
    "build_dynamic_academic_queries",
    "build_dynamic_academic_title",
    "build_optimized_task_message",
    "build_primary_system_prompt",
    "canonical_model",
    "extract_course_codes",
    "extract_topic_terms",
    "get_client",
    "get_mode_prompt",
    "get_mode_settings",
    "parse_word_targets",
    "PreparedContext",
    "quality_check",
]
