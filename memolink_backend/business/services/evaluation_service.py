"""
EvaluationService - records quantitative analytics.

Design rules (from the spec):
- If evaluation_analytics_enabled is false, record nothing.
- Recording must never break the main user action - every record_* method is
  wrapped in try/except and only logs a safe warning.
- Only IDs, counts, timings, ratings, and short metadata are stored - never full
  prompts, answers, note content, files, or secrets.
"""
import logging
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import text

from memolink_backend.domain.repositories.evaluation_repository import EvaluationRepository
from memolink_backend.contracts.evaluation_dtos import (
    SessionStartRequest, SessionStartResponse, SessionEndRequest,
    TaskStartRequest, TaskStartResponse, TaskCompleteRequest,
    EventRequest, RatingRequest, OkResponse, BudgetStatus, MyRatingsDTO,
)

logger = logging.getLogger(__name__)


# Default foreground-usage collection window per user (minutes → seconds).
# Once consumed, stat-gathering ends for that user until an admin resets it.
# Admins can override the budget per participant (evaluation_sessions.budget_seconds).
DEFAULT_BUDGET_SECONDS = 30 * 60


def _provider_for(model: Optional[str]) -> Optional[str]:
    if not model:
        return None
    m = model.lower()
    if m.startswith(("gpt-", "o1-", "o3-", "o4-")):
        return "openai"
    if m.startswith("gemini"):
        return "google"
    if m.startswith("deepseek"):
        return "deepseek"
    return "custom"


class EvaluationService:
    def __init__(self, repo: EvaluationRepository):
        self._repo = repo

    # ── Flag gate ────────────────────────────────────────────────────────────
    def analytics_enabled(self) -> bool:
        try:
            row = self._repo.db.execute(
                text("SELECT value FROM feature_flags WHERE key = 'evaluation_analytics_enabled'")
            ).fetchone()
            return (row is None) or (row[0] != "false")
        except Exception as exc:
            logger.warning("[Eval] analytics_enabled flag lookup failed, defaulting to disabled: %s", exc)
            return False

    # ── Sessions ─────────────────────────────────────────────────────────────
    def start_session(self, user_id: Optional[int], req: SessionStartRequest) -> SessionStartResponse:
        if not self.analytics_enabled():
            raise ValueError("Evaluation analytics is currently disabled.")
        if not req.consent_confirmed:
            raise ValueError("Consent is required to start an evaluation session.")
        code = req.participant_code or f"P{self._repo.next_participant_number() + 1:03d}"
        s = self._repo.create_session(
            participant_code=code,
            user_id=user_id,
            workspace_id=req.workspace_id,
            consent_confirmed=True,
            role=req.role,
            ai_tool_usage_frequency=req.ai_tool_usage_frequency,
            device_type=req.device_type,
            browser=req.browser,
            operating_system=req.operating_system,
        )
        return SessionStartResponse(session_id=s.id, participant_code=code)

    def end_session(self, user_id: Optional[int], req: SessionEndRequest) -> OkResponse:
        s = self._repo.get_session(req.session_id)
        if not s:
            raise ValueError("Session not found")
        if s.user_id is not None and user_id is not None and s.user_id != user_id:
            raise ValueError("Session not found")
        now = datetime.now(timezone.utc)
        s.ended_at = now
        s.completed = req.completed
        try:
            started = s.started_at
            if started is not None:
                if started.tzinfo is None:
                    started = started.replace(tzinfo=timezone.utc)
                s.total_time_seconds = int((now - started).total_seconds())
        except Exception as exc:
            logger.warning("[Eval] failed to compute total_time_seconds for session %s: %s", s.id, exc)
        self._repo.commit()
        return OkResponse(ok=True, id=s.id)

    # ── Tasks ────────────────────────────────────────────────────────────────
    def start_task(self, user_id: Optional[int], req: TaskStartRequest) -> TaskStartResponse:
        t = self._repo.create_task(
            session_id=req.session_id, user_id=user_id, workspace_id=req.workspace_id,
            task_key=req.task_key, task_name=req.task_name, feature_name=req.feature_name,
        )
        return TaskStartResponse(task_id=t.id)

    def complete_task(self, user_id: Optional[int], req: TaskCompleteRequest) -> OkResponse:
        t = self._repo.get_task(req.task_id)
        if not t:
            raise ValueError("Task not found")
        t.completed = True
        t.success = req.success
        t.completed_at = datetime.now(timezone.utc)
        if req.time_taken_ms is not None:
            t.time_taken_ms = req.time_taken_ms
        if req.error_count is not None:
            t.error_count = req.error_count
        if req.retry_count is not None:
            t.retry_count = req.retry_count
        if req.click_count is not None:
            t.click_count = req.click_count
        t.created_object_type = req.created_object_type
        t.created_object_id = req.created_object_id
        t.notes = req.notes
        self._repo.commit()
        return OkResponse(ok=True, id=t.id)

    # ── Events & ratings ─────────────────────────────────────────────────────
    def record_event(self, user_id: Optional[int], req: EventRequest) -> OkResponse:
        if not self.analytics_enabled():
            return OkResponse(ok=False)
        try:
            e = self._repo.create_event(
                session_id=req.session_id, task_id=req.task_id, user_id=user_id,
                workspace_id=req.workspace_id, conversation_id=req.conversation_id,
                message_id=req.message_id, note_id=req.note_id,
                feature_name=req.feature_name, operation_name=req.operation_name,
                event_type=req.event_type, status=req.status, duration_ms=req.duration_ms,
                error_type=req.error_type, error_code=req.error_code,
                error_message_safe=(req.error_message_safe or "")[:500] or None,
                event_metadata=req.metadata,
            )
            return OkResponse(ok=True, id=e.id)
        except Exception as exc:
            logger.warning("[Eval] record_event failed: %s", exc)
            return OkResponse(ok=False)

    def record_rating(self, user_id: Optional[int], req: RatingRequest) -> OkResponse:
        if not self.analytics_enabled():
            return OkResponse(ok=False)
        session_id = req.session_id
        if session_id is None and user_id is not None:
            session = self._get_or_create_session(user_id)
            if self._budget_exhausted(session):
                return OkResponse(ok=False)
            session_id = session.id
        try:
            r = self._repo.upsert_rating(
                session_id=session_id, message_id=req.message_id, rating_type=req.rating_type,
                task_id=req.task_id, event_id=req.event_id, ai_metric_id=req.ai_metric_id,
                rating_value=req.rating_value,
                rating_scale_min=req.rating_scale_min, rating_scale_max=req.rating_scale_max,
                choice_value=req.choice_value, comment=(req.comment or "")[:1000] or None,
            )
            return OkResponse(ok=True, id=r.id)
        except Exception as exc:
            logger.warning("[Eval] record_rating failed: %s", exc)
            return OkResponse(ok=False)

    def get_my_ratings(self, user_id: Optional[int]) -> "MyRatingsDTO":
        """The current user's saved ratings, keyed by message id, so the chat can
        restore their selections after a reload."""
        out: dict = {}
        if user_id:
            try:
                for r in self._repo.ratings_for_user(user_id):
                    if r.message_id is None:
                        continue
                    mid = str(r.message_id)
                    d = out.setdefault(mid, {})
                    if r.rating_type == "answer_supported_by_notes":
                        d[r.rating_type] = r.choice_value
                    else:
                        d[r.rating_type] = r.rating_value
            except Exception as exc:
                logger.warning("[Eval] get_my_ratings failed: %s", exc)
        return MyRatingsDTO(ratings=out)

    def _get_or_create_session(self, user_id: int):
        """One persistent background session per user (admin-controlled, always-on
        when the flag is set). It is never auto-ended - logging out only pauses
        the frontend heartbeat - so the same row accumulates the user's lifetime
        ACTIVE time across logins. Reset only by an admin."""
        session = self._repo.active_session_for_user(user_id)
        if session:
            return session
        code = f"P{self._repo.next_participant_number() + 1:03d}"
        return self._repo.create_session(
            participant_code=code, user_id=user_id, consent_confirmed=True,
        )

    @staticmethod
    def _consumed(session) -> int:
        return int(session.total_time_seconds or 0) if session else 0

    @staticmethod
    def _budget_of(session) -> int:
        if session is not None and session.budget_seconds:
            return int(session.budget_seconds)
        return DEFAULT_BUDGET_SECONDS

    def _budget_exhausted(self, session) -> bool:
        return self._consumed(session) >= self._budget_of(session)

    def _budget_status(self, session) -> BudgetStatus:
        consumed = self._consumed(session)
        budget = self._budget_of(session)
        exhausted = consumed >= budget
        return BudgetStatus(
            consumed_seconds=consumed,
            budget_seconds=budget,
            remaining_seconds=max(0, budget - consumed),
            exhausted=exhausted,
            recording=self.analytics_enabled() and not exhausted,
        )

    def get_budget(self, user_id: Optional[int]) -> BudgetStatus:
        session = self._repo.active_session_for_user(user_id) if user_id else None
        return self._budget_status(session)

    def add_active_time(self, user_id: Optional[int], delta_seconds: int) -> BudgetStatus:
        """Frontend heartbeat: adds foreground-usage seconds to the user's
        collection window, capped at their budget. Once reached, stat-gathering
        ends for that user. Never raises."""
        try:
            if not user_id or not self.analytics_enabled():
                return self._budget_status(None)
            session = self._get_or_create_session(user_id)
            consumed = self._consumed(session)
            budget = self._budget_of(session)
            if delta_seconds and delta_seconds > 0 and consumed < budget:
                session.total_time_seconds = min(budget, consumed + int(delta_seconds))
                session.completed = True
                self._repo.commit()
            return self._budget_status(session)
        except Exception as exc:
            logger.warning("[Eval] add_active_time failed: %s", exc)
            return self._budget_status(None)

    def reset_budget(self, user_id: Optional[int], wipe: bool = False) -> OkResponse:
        """Admin: restart a participant's (or everyone's) collection window so
        stat-gathering resumes. If wipe=True, all their previously collected
        evaluation data is permanently deleted; otherwise it is kept."""
        if wipe:
            n = self._repo.delete_user_data(user_id)
        else:
            n = self._repo.reset_active_time(user_id)
        return OkResponse(ok=True, id=n)

    def set_user_budget(self, user_id: int, budget_minutes: Optional[int]) -> BudgetStatus:
        """Admin: set a participant's collection window (in minutes). Pass None
        to revert to the default. Creates the participant's session if needed."""
        session = self._get_or_create_session(user_id)
        session.budget_seconds = int(budget_minutes) * 60 if budget_minutes else None
        self._repo.commit()
        return self._budget_status(session)

    def mark_task(self, user_id: Optional[int], task_key: str, task_name: str,
                  feature_name: Optional[str] = None,
                  object_type: Optional[str] = None, object_id: Optional[int] = None) -> None:
        """Auto-record a core workflow task as completed when the real action
        happens (idempotent per session+task_key). Never raises."""
        try:
            if not user_id or not self.analytics_enabled():
                return
            session = self._get_or_create_session(user_id)
            if self._budget_exhausted(session):
                return
            session.completed = True
            existing = self._repo.get_task_by_session_key(session.id, task_key)
            if existing:
                self._repo.commit()
                return
            self._repo.create_task(
                session_id=session.id, user_id=user_id, task_key=task_key,
                task_name=task_name, feature_name=feature_name,
                completed=True, success=True,
                completed_at=datetime.now(timezone.utc),
                created_object_type=object_type, created_object_id=object_id,
            )
        except Exception as exc:
            logger.warning("[Eval] mark_task failed: %s", exc)

    # ── Instrumentation entry points (called from other services) ─────────────
    def record_ai_metrics(self, user_id: Optional[int], feature_name: str, data: dict) -> None:
        """Called from chat/RAG. Records automatically whenever analytics is
        enabled by an admin and the user still has budget left. Never raises."""
        try:
            if not user_id or not self.analytics_enabled():
                return
            session = self._get_or_create_session(user_id)
            if self._budget_exhausted(session):
                return
            session.completed = True
            data = dict(data or {})
            data.setdefault("provider", _provider_for(data.get("actual_model_used")))
            self._repo.create_ai_metric(
                session_id=session.id, user_id=user_id, feature_name=feature_name, **data,
            )
        except Exception as exc:
            logger.warning("[Eval] record_ai_metrics failed: %s", exc)

    def record_feature_usage(self, user_id: Optional[int], workspace_id: Optional[int],
                             feature_name: str, action_name: str) -> None:
        try:
            if not user_id or not self.analytics_enabled():
                return
            session = self._get_or_create_session(user_id)
            if self._budget_exhausted(session):
                return
            self._repo.upsert_feature_usage(session.id, user_id, workspace_id, feature_name, action_name)
        except Exception as exc:
            logger.warning("[Eval] record_feature_usage failed: %s", exc)
