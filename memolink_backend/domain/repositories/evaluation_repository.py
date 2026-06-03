"""
Evaluation analytics repository — all SQLAlchemy access for the evaluation_* tables.
"""
from typing import Optional, List
from sqlalchemy.orm import Session
from sqlalchemy import func

from memolink_backend.domain.models.evaluation import (
    EvaluationSession, EvaluationTask, EvaluationEvent, EvaluationAiMetric,
    EvaluationUserRating, EvaluationFeatureUsage,
    EvaluationTranslationMetric, EvaluationTranscriptionMetric,
    EvaluationReminderMetric, EvaluationQuizMetric, EvaluationTimelineMetric,
)


class EvaluationRepository:
    def __init__(self, db: Session):
        self._db = db

    @property
    def db(self) -> Session:
        return self._db

    # ── Sessions ─────────────────────────────────────────────────────────────
    def create_session(self, **kw) -> EvaluationSession:
        s = EvaluationSession(**kw)
        self._db.add(s); self._db.commit(); self._db.refresh(s)
        return s

    def get_session(self, session_id: int) -> Optional[EvaluationSession]:
        return self._db.query(EvaluationSession).filter(EvaluationSession.id == session_id).first()

    def count_sessions_for_user(self, user_id: int) -> int:
        return (
            self._db.query(func.count(EvaluationSession.id))
            .filter(EvaluationSession.user_id == user_id)
            .scalar() or 0
        )

    def reset_active_time(self, user_id: Optional[int] = None) -> int:
        """Reset consumed active-time budget (and reopen) for one user or all.
        Returns the number of sessions affected. Collected metrics are untouched."""
        q = self._db.query(EvaluationSession)
        if user_id is not None:
            q = q.filter(EvaluationSession.user_id == user_id)
        n = 0
        for s in q.all():
            s.total_time_seconds = 0
            s.ended_at = None
            n += 1
        self._db.commit()
        return n

    _USER_MODELS = [
        EvaluationTask, EvaluationEvent, EvaluationAiMetric, EvaluationFeatureUsage,
        EvaluationTranslationMetric, EvaluationTranscriptionMetric,
        EvaluationReminderMetric, EvaluationQuizMetric, EvaluationTimelineMetric,
    ]

    def delete_user_data(self, user_id: Optional[int] = None) -> int:
        """Permanently delete all evaluation data for one participant (or everyone).
        Removes sessions, metrics, tasks, events, ratings, and feature usage.
        Returns the number of sessions removed."""
        if user_id is None:
            self._db.query(EvaluationUserRating).delete(synchronize_session=False)
            for m in self._USER_MODELS:
                self._db.query(m).delete(synchronize_session=False)
            n = self._db.query(EvaluationSession).delete(synchronize_session=False)
            self._db.commit()
            return n

        session_ids = [sid for (sid,) in
                       self._db.query(EvaluationSession.id).filter(EvaluationSession.user_id == user_id).all()]
        if session_ids:
            self._db.query(EvaluationUserRating).filter(
                EvaluationUserRating.session_id.in_(session_ids)
            ).delete(synchronize_session=False)
        for m in self._USER_MODELS:
            self._db.query(m).filter(m.user_id == user_id).delete(synchronize_session=False)
        self._db.query(EvaluationSession).filter(EvaluationSession.user_id == user_id).delete(synchronize_session=False)
        self._db.commit()
        return len(session_ids)

    def active_session_for_user(self, user_id: int) -> Optional[EvaluationSession]:
        return (
            self._db.query(EvaluationSession)
            .filter(EvaluationSession.user_id == user_id, EvaluationSession.ended_at.is_(None))
            .order_by(EvaluationSession.started_at.desc())
            .first()
        )

    def commit(self) -> None:
        self._db.commit()

    def next_participant_number(self) -> int:
        best = 0
        for (code,) in self._db.query(EvaluationSession.participant_code).all():
            if code and code.upper().startswith("P") and code[1:].isdigit():
                best = max(best, int(code[1:]))
        return best

    def list_sessions(self) -> List[EvaluationSession]:
        return self._db.query(EvaluationSession).order_by(EvaluationSession.started_at.desc()).all()

    def count_participants(self) -> int:
        return self._db.query(func.count(func.distinct(EvaluationSession.participant_code))).scalar() or 0

    # ── Tasks ────────────────────────────────────────────────────────────────
    def create_task(self, **kw) -> EvaluationTask:
        t = EvaluationTask(**kw)
        self._db.add(t); self._db.commit(); self._db.refresh(t)
        return t

    def get_task(self, task_id: int) -> Optional[EvaluationTask]:
        return self._db.query(EvaluationTask).filter(EvaluationTask.id == task_id).first()

    def get_task_by_session_key(self, session_id: int, task_key: str) -> Optional[EvaluationTask]:
        return (
            self._db.query(EvaluationTask)
            .filter(EvaluationTask.session_id == session_id, EvaluationTask.task_key == task_key)
            .first()
        )

    def list_tasks(self) -> List[EvaluationTask]:
        return self._db.query(EvaluationTask).all()

    # ── Events / metrics / ratings ───────────────────────────────────────────
    def create_event(self, **kw) -> EvaluationEvent:
        e = EvaluationEvent(**kw)
        self._db.add(e); self._db.commit(); self._db.refresh(e)
        return e

    def create_ai_metric(self, **kw) -> EvaluationAiMetric:
        m = EvaluationAiMetric(**kw)
        self._db.add(m); self._db.commit(); self._db.refresh(m)
        return m

    def create_rating(self, **kw) -> EvaluationUserRating:
        r = EvaluationUserRating(**kw)
        self._db.add(r); self._db.commit(); self._db.refresh(r)
        return r

    def upsert_rating(self, session_id: int, message_id: Optional[int], rating_type: str, **kw) -> EvaluationUserRating:
        """One rating per (session, message, type) — re-rating updates in place."""
        existing = None
        if message_id is not None:
            existing = (
                self._db.query(EvaluationUserRating)
                .filter(
                    EvaluationUserRating.session_id == session_id,
                    EvaluationUserRating.message_id == message_id,
                    EvaluationUserRating.rating_type == rating_type,
                ).first()
            )
        if existing:
            for k, v in kw.items():
                setattr(existing, k, v)
            self._db.commit(); self._db.refresh(existing)
            return existing
        return self.create_rating(session_id=session_id, message_id=message_id, rating_type=rating_type, **kw)

    def ratings_for_user(self, user_id: int) -> List[EvaluationUserRating]:
        return (
            self._db.query(EvaluationUserRating)
            .join(EvaluationSession, EvaluationUserRating.session_id == EvaluationSession.id)
            .filter(EvaluationSession.user_id == user_id)
            .all()
        )

    def upsert_feature_usage(self, session_id, user_id, workspace_id, feature_name, action_name) -> None:
        row = (
            self._db.query(EvaluationFeatureUsage)
            .filter(
                EvaluationFeatureUsage.session_id == session_id,
                EvaluationFeatureUsage.feature_name == feature_name,
                EvaluationFeatureUsage.action_name == action_name,
            ).first()
        )
        if row:
            row.count += 1
            row.last_used_at = func.now()
        else:
            row = EvaluationFeatureUsage(
                session_id=session_id, user_id=user_id, workspace_id=workspace_id,
                feature_name=feature_name, action_name=action_name, count=1,
            )
            self._db.add(row)
        self._db.commit()

    # Generic metric creates (Phase 2 wiring)
    def create_translation_metric(self, **kw): m = EvaluationTranslationMetric(**kw); self._db.add(m); self._db.commit(); return m
    def create_transcription_metric(self, **kw): m = EvaluationTranscriptionMetric(**kw); self._db.add(m); self._db.commit(); return m
    def create_reminder_metric(self, **kw): m = EvaluationReminderMetric(**kw); self._db.add(m); self._db.commit(); return m
    def create_quiz_metric(self, **kw): m = EvaluationQuizMetric(**kw); self._db.add(m); self._db.commit(); return m
    def create_timeline_metric(self, **kw): m = EvaluationTimelineMetric(**kw); self._db.add(m); self._db.commit(); return m

    # ── Report queries ───────────────────────────────────────────────────────
    def list_ratings(self) -> List[EvaluationUserRating]:
        return self._db.query(EvaluationUserRating).all()

    def list_ai_metrics(self) -> List[EvaluationAiMetric]:
        return self._db.query(EvaluationAiMetric).all()

    def list_feature_usage(self) -> List[EvaluationFeatureUsage]:
        return self._db.query(EvaluationFeatureUsage).all()

    def avg_rating(self, rating_type: str) -> Optional[float]:
        v = (
            self._db.query(func.avg(EvaluationUserRating.rating_value))
            .filter(EvaluationUserRating.rating_type == rating_type)
            .scalar()
        )
        return round(float(v), 2) if v is not None else None
