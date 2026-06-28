from datetime import datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace

from memolink_backend.api.v1 import books_controller
from memolink_backend.business.services.book_note_source_service import (
    BookNoteSourceService,
    _extract_pages_mobi,
)


class FakeUserBooks:
    def __init__(self, status=None):
        self.status = status
        self.set_calls = []

    def get_note_source(self, user_id, book_id):
        return self.status

    def get_or_create_note_source(self, user_id, book_id):
        if self.status is None:
            self.status = SimpleNamespace(
                id=1,
                user_id=user_id,
                book_id=book_id,
                status="pending",
                error_message=None,
                created_at=datetime.now(timezone.utc),
                updated_at=datetime.now(timezone.utc),
            )
        return self.status

    def set_note_source_status(self, source_id, status, error_message=None):
        self.set_calls.append((source_id, status, error_message))
        self.status.status = status
        self.status.error_message = error_message
        self.status.updated_at = datetime.now(timezone.utc)

    def list_note_ids_for_source(self, source_id):
        return []


class FakeNotes:
    def get_by_id(self, note_id):
        return None


def build_service(user_books):
    return BookNoteSourceService(
        book_repo=None,
        user_book_repo=user_books,
        note_repo=FakeNotes(),
        embedding_service=None,
        onedrive_service=None,
        book_cache_service=None,
        smart_source_repo=None,
    )


def processing_status(updated_at):
    return SimpleNamespace(
        id=4,
        user_id=7,
        book_id=9,
        status="processing",
        error_message=None,
        created_at=updated_at,
        updated_at=updated_at,
    )


def test_recent_processing_job_is_not_started_twice():
    repo = FakeUserBooks(processing_status(datetime.now(timezone.utc)))

    status = build_service(repo).start(7, 9)

    assert status.status == "processing"
    assert repo.set_calls == []


def test_stale_processing_job_is_reset_to_pending_for_retry():
    repo = FakeUserBooks(processing_status(datetime.now(timezone.utc) - timedelta(minutes=10)))

    status = build_service(repo).start(7, 9)

    assert status.status == "pending"
    assert repo.set_calls[-1][1] == "pending"


def test_lambda_dispatch_uses_async_invocation(monkeypatch):
    calls = []
    fake_lambda = SimpleNamespace(invoke=lambda **kwargs: calls.append(kwargs) or {"StatusCode": 202})
    monkeypatch.setenv("AWS_LAMBDA_FUNCTION_NAME", "memolink-api")
    monkeypatch.setattr(books_controller.boto3 if hasattr(books_controller, "boto3") else __import__("boto3"), "client", lambda name: fake_lambda)

    books_controller._dispatch_book_note_source_job(SimpleNamespace(add_task=lambda *args: None), 7, 9)

    assert calls[0]["FunctionName"] == "memolink-api"
    assert calls[0]["InvocationType"] == "Event"
    assert b'"memolink_job": "book_note_source"' in calls[0]["Payload"]


def test_mobi_extraction_converts_parser_html_to_text(monkeypatch):
    def fake_run(command, **kwargs):
        Path(command[3]).write_text("<h1>Chapter</h1><p>Hello MOBI</p>", encoding="utf-8")
        return SimpleNamespace(returncode=0, stderr="")

    monkeypatch.setattr("memolink_backend.business.services.book_note_source_service.subprocess.run", fake_run)

    pages = _extract_pages_mobi(b"mobi bytes")

    assert "Chapter" in pages[0]
    assert "Hello MOBI" in pages[0]
