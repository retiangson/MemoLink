"""
Evaluation analytics — service + report tests.

Covers the spec's testing checklist: session start/end, task complete,
AI metrics, ratings, CSV export, summary calculation, disabled-flag gating,
analytics-failure isolation, and the privacy rule (no raw content stored).
"""
import pytest
from sqlalchemy import text

from memolink_backend.domain.repositories.evaluation_repository import EvaluationRepository
from memolink_backend.domain.models.evaluation import EvaluationAiMetric
from memolink_backend.business.services.evaluation_service import EvaluationService
from memolink_backend.business.services.evaluation_report_service import EvaluationReportService
from memolink_backend.contracts.evaluation_dtos import (
    SessionStartRequest, SessionEndRequest, TaskStartRequest, TaskCompleteRequest,
    EventRequest, RatingRequest,
)


def _set_flag(db, key, value):
    db.execute(text(
        "CREATE TABLE IF NOT EXISTS feature_flags (key VARCHAR PRIMARY KEY, value TEXT)"
    ))
    db.execute(text("DELETE FROM feature_flags WHERE key = :k"), {"k": key})
    db.execute(text("INSERT INTO feature_flags (key, value) VALUES (:k, :v)"), {"k": key, "v": value})
    db.commit()


@pytest.fixture
def svc(db_session):
    _set_flag(db_session, "evaluation_analytics_enabled", "true")
    return EvaluationService(EvaluationRepository(db_session))


@pytest.fixture
def report(db_session):
    return EvaluationReportService(EvaluationRepository(db_session))


def test_session_start_and_end(svc):
    res = svc.start_session(1, SessionStartRequest(consent_confirmed=True, role="Student"))
    assert res.participant_code == "P001"
    end = svc.end_session(1, SessionEndRequest(session_id=res.session_id, completed=True))
    assert end.ok


def test_session_requires_consent(svc):
    with pytest.raises(ValueError):
        svc.start_session(1, SessionStartRequest(consent_confirmed=False))


def test_participant_codes_increment(svc):
    a = svc.start_session(1, SessionStartRequest(consent_confirmed=True))
    b = svc.start_session(2, SessionStartRequest(consent_confirmed=True))
    assert (a.participant_code, b.participant_code) == ("P001", "P002")


def test_task_start_and_complete(svc):
    s = svc.start_session(1, SessionStartRequest(consent_confirmed=True))
    t = svc.start_task(1, TaskStartRequest(session_id=s.session_id, task_key="create_note", task_name="Create a note"))
    done = svc.complete_task(1, TaskCompleteRequest(task_id=t.task_id, success=True, time_taken_ms=4200))
    assert done.ok


def test_record_ai_metrics_auto_creates_session(db_session, svc):
    # Admin-controlled, always-on: no pre-started session needed. A background
    # session is created automatically and the metric is recorded.
    from memolink_backend.domain.models.evaluation import EvaluationSession
    svc.record_ai_metrics(99, "rag_chat", {"total_response_time_ms": 100})
    assert db_session.query(EvaluationAiMetric).count() == 1
    assert db_session.query(EvaluationSession).filter(EvaluationSession.user_id == 99).count() == 1


def test_record_ai_metrics_disabled_flag_skips(db_session):
    _set_flag(db_session, "evaluation_analytics_enabled", "false")
    svc = EvaluationService(EvaluationRepository(db_session))
    svc.record_ai_metrics(99, "rag_chat", {"total_response_time_ms": 100})
    assert db_session.query(EvaluationAiMetric).count() == 0


def test_record_ai_metrics_with_active_session(db_session, svc):
    svc.start_session(1, SessionStartRequest(consent_confirmed=True))
    svc.record_ai_metrics(1, "rag_chat", {
        "total_response_time_ms": 1200, "first_token_latency_ms": 300,
        "actual_model_used": "gpt-4o-mini", "confidence_level": "HIGH",
        "message_id": 55, "retrieved_note_count": 3,
    })
    rows = db_session.query(EvaluationAiMetric).all()
    assert len(rows) == 1
    assert rows[0].provider == "openai" and rows[0].confidence_level == "HIGH"


def test_rating_recorded(db_session, svc):
    s = svc.start_session(1, SessionStartRequest(consent_confirmed=True))
    r = svc.record_rating(1, RatingRequest(session_id=s.session_id, rating_type="answer_relevance",
                                           rating_value=5, message_id=55))
    assert r.ok


def test_disabled_flag_prevents_collection(db_session):
    _set_flag(db_session, "evaluation_analytics_enabled", "false")
    svc = EvaluationService(EvaluationRepository(db_session))
    assert svc.analytics_enabled() is False
    # start_session blocked
    with pytest.raises(ValueError):
        svc.start_session(1, SessionStartRequest(consent_confirmed=True))
    # event not recorded
    res = svc.record_event(1, EventRequest(feature_name="rag_chat", operation_name="llm", event_type="x", status="ok"))
    assert res.ok is False


def test_analytics_failure_does_not_raise(svc):
    # bad payload (unknown column) must be swallowed, never raised
    svc.start_session(1, SessionStartRequest(consent_confirmed=True))
    svc.record_ai_metrics(1, "rag_chat", {"nonexistent_column": 123})  # should not raise


def test_summary_calculation(db_session, svc, report):
    s = svc.start_session(1, SessionStartRequest(consent_confirmed=True))
    t = svc.start_task(1, TaskStartRequest(session_id=s.session_id, task_key="ask_rag_question", task_name="Ask"))
    svc.complete_task(1, TaskCompleteRequest(task_id=t.task_id, success=True, time_taken_ms=5000))
    svc.record_ai_metrics(1, "rag_chat", {
        "total_response_time_ms": 1000, "first_token_latency_ms": 200,
        "confidence_level": "HIGH", "message_id": 10, "actual_model_used": "gpt-4o-mini",
    })
    svc.record_rating(1, RatingRequest(rating_type="answer_relevance", rating_value=4, message_id=10))
    svc.record_rating(1, RatingRequest(rating_type="answer_trust", rating_value=5, message_id=10))
    svc.end_session(1, SessionEndRequest(session_id=s.session_id, completed=True))

    summ = report.get_summary()
    assert summ.total_participants == 1
    assert summ.completed_sessions == 1
    # coverage = 1 core task (ask_rag_question) of 5 expected → 0.2
    assert summ.task_completion_rate == 0.2
    assert summ.avg_response_time_ms == 1000
    assert summ.avg_relevance_rating == 4.0
    assert summ.avg_trust_rating == 5.0
    # confidence alignment ties HIGH → trust 5
    high = next(c for c in summ.confidence_alignment if c.confidence_level == "HIGH")
    assert high.count == 1 and high.avg_trust == 5.0


def test_mark_task_auto_completes_and_is_idempotent(db_session, svc, report):
    from memolink_backend.domain.models.evaluation import EvaluationTask, EvaluationSession
    # no pre-started session; mark_task auto-creates one and records a completed task
    svc.mark_task(7, "create_note", "Create a note", "note")
    svc.mark_task(7, "ask_rag_question", "Ask", "rag_chat")
    svc.mark_task(7, "create_note", "Create a note", "note")  # duplicate → ignored
    tasks = db_session.query(EvaluationTask).all()
    assert len(tasks) == 2 and all(t.completed for t in tasks)
    s = db_session.query(EvaluationSession).filter(EvaluationSession.user_id == 7).first()
    assert s.completed
    # coverage = 2 of 5 core tasks → 0.4
    assert report.get_summary().task_completion_rate == 0.4


def test_active_time_budget_accumulates_and_caps(db_session, svc):
    from memolink_backend.business.services.evaluation_service import DEFAULT_BUDGET_SECONDS
    b1 = svc.add_active_time(8, 300)      # 5 min
    assert b1.consumed_seconds == 300 and not b1.exhausted and b1.recording
    b2 = svc.add_active_time(8, 300)      # +5 min (logged out then back in → continues)
    assert b2.consumed_seconds == 600
    b3 = svc.add_active_time(8, 99999)    # overshoot → clamps at the 30-min default
    assert b3.consumed_seconds == DEFAULT_BUDGET_SECONDS == 1800
    assert b3.exhausted and not b3.recording and b3.remaining_seconds == 0


def test_recording_stops_when_budget_exhausted(db_session, svc):
    from memolink_backend.domain.models.evaluation import EvaluationAiMetric
    svc.add_active_time(9, 30 * 60)       # consume full budget
    svc.record_ai_metrics(9, "rag_chat", {"total_response_time_ms": 100})
    svc.mark_task(9, "create_note", "Create a note", "note")
    assert db_session.query(EvaluationAiMetric).count() == 0


def test_admin_reset_budget_resumes(db_session, svc):
    svc.add_active_time(10, 30 * 60)
    assert svc.get_budget(10).exhausted
    svc.reset_budget(10)                     # time-only reset keeps data
    b = svc.get_budget(10)
    assert b.consumed_seconds == 0 and not b.exhausted and b.recording


def test_reset_with_wipe_deletes_user_data(db_session, svc):
    from memolink_backend.domain.models.evaluation import (
        EvaluationAiMetric, EvaluationUserRating, EvaluationTask, EvaluationSession,
    )
    svc.add_active_time(14, 120)
    svc.record_ai_metrics(14, "rag_chat", {"total_response_time_ms": 500, "message_id": 1})
    svc.record_rating(14, RatingRequest(rating_type="answer_relevance", rating_value=5, message_id=1))
    svc.mark_task(14, "create_note", "Create a note", "note")
    assert db_session.query(EvaluationAiMetric).filter(EvaluationAiMetric.user_id == 14).count() == 1

    svc.reset_budget(14, wipe=True)          # delete everything for this user
    assert db_session.query(EvaluationAiMetric).filter(EvaluationAiMetric.user_id == 14).count() == 0
    assert db_session.query(EvaluationTask).filter(EvaluationTask.user_id == 14).count() == 0
    assert db_session.query(EvaluationUserRating).count() == 0
    assert db_session.query(EvaluationSession).filter(EvaluationSession.user_id == 14).count() == 0
    # other users untouched
    svc.record_ai_metrics(99, "rag_chat", {"total_response_time_ms": 100})
    svc.reset_budget(14, wipe=True)
    assert db_session.query(EvaluationAiMetric).filter(EvaluationAiMetric.user_id == 99).count() == 1


def test_per_user_budget_override(db_session, svc):
    # set a 10-minute window for user 11; recording stops after 10 min
    svc.set_user_budget(11, 10)
    b = svc.add_active_time(11, 9 * 60)
    assert b.budget_seconds == 600 and not b.exhausted
    b2 = svc.add_active_time(11, 2 * 60)   # crosses 10 min
    assert b2.consumed_seconds == 600 and b2.exhausted
    # revert to default
    svc.set_user_budget(11, None)
    assert svc.get_budget(11).budget_seconds == 1800


def test_list_participants(db_session, svc, report):
    svc.add_active_time(12, 120)
    svc.set_user_budget(13, 5)
    lst = report.list_participants()
    assert lst.default_budget_minutes == 30
    ids = {p.user_id: p for p in lst.participants}
    assert ids[12].consumed_seconds == 120 and ids[12].budget_seconds == 1800
    assert ids[13].budget_seconds == 300


def test_mark_task_disabled_flag_skips(db_session):
    _set_flag(db_session, "evaluation_analytics_enabled", "false")
    from memolink_backend.domain.models.evaluation import EvaluationTask
    svc = EvaluationService(EvaluationRepository(db_session))
    svc.mark_task(7, "create_note", "Create a note", "note")
    assert db_session.query(EvaluationTask).count() == 0


def test_supported_by_notes_tallied_not_averaged(db_session, svc, report):
    svc.start_session(1, SessionStartRequest(consent_confirmed=True))
    # choice question stores rating_value=0 + choice_value; must not pollute averages
    svc.record_rating(1, RatingRequest(rating_type="answer_supported_by_notes", rating_value=0, choice_value="yes", message_id=1))
    svc.record_rating(1, RatingRequest(rating_type="answer_supported_by_notes", rating_value=0, choice_value="yes", message_id=2))
    svc.record_rating(1, RatingRequest(rating_type="answer_supported_by_notes", rating_value=0, choice_value="no", message_id=3))
    svc.record_rating(1, RatingRequest(rating_type="answer_relevance", rating_value=4, message_id=1))
    summ = report.get_summary()
    assert summ.supported_by_notes == {"yes": 2, "no": 1}
    assert "answer_supported_by_notes" not in summ.ratings_by_type   # excluded from numeric avg
    assert summ.ratings_by_type.get("answer_relevance") == 4.0


def test_my_ratings_retrieved_and_upserted(db_session, svc):
    from memolink_backend.domain.models.evaluation import EvaluationUserRating
    svc.start_session(1, SessionStartRequest(consent_confirmed=True))
    svc.record_rating(1, RatingRequest(rating_type="answer_relevance", rating_value=3, message_id=42))
    svc.record_rating(1, RatingRequest(rating_type="answer_relevance", rating_value=5, message_id=42))  # re-rate
    svc.record_rating(1, RatingRequest(rating_type="answer_supported_by_notes", rating_value=0, choice_value="yes", message_id=42))
    # re-rating updates in place (no duplicate rows)
    assert db_session.query(EvaluationUserRating).filter(
        EvaluationUserRating.message_id == 42, EvaluationUserRating.rating_type == "answer_relevance"
    ).count() == 1
    mine = svc.get_my_ratings(1).ratings
    assert mine["42"]["answer_relevance"] == 5
    assert mine["42"]["answer_supported_by_notes"] == "yes"


def test_markdown_report_generates(db_session, svc, report):
    svc.start_session(1, SessionStartRequest(consent_confirmed=True))
    md = report.generate_report().markdown
    assert "Quantitative Evaluation Results" in md and "Limitations" in md


def test_csv_zip_export(db_session, svc, report):
    import io, zipfile
    svc.start_session(1, SessionStartRequest(consent_confirmed=True))
    data = report.export_csv_zip()
    zf = zipfile.ZipFile(io.BytesIO(data))
    names = zf.namelist()
    assert "evaluation_sessions.csv" in names and "evaluation_ai_metrics.csv" in names


def test_no_raw_content_columns_in_analytics():
    """Privacy rule: analytics tables must not store full prompts/answers/note text."""
    forbidden = {"prompt", "prompt_text", "answer", "answer_text", "content",
                 "note_content", "full_prompt", "full_answer", "raw_text"}
    cols = {c.name for c in EvaluationAiMetric.__table__.columns}
    assert not (cols & forbidden)
