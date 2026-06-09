from __future__ import annotations

import asyncio
import base64
from email import message_from_bytes
from types import SimpleNamespace

from memolink_backend.business.services.email_service import EmailService
from tests.fakes.reminder_repository import FakeReminderRepository


class FakeGmailConnector:
    def __init__(self):
        self.sent_messages = []
        self.attachment_requests = []
        self.message_ids = []
        self.messages = {}

    async def send_message(self, user_id: int, *, raw_message: str, thread_id: str | None = None) -> dict:
        self.sent_messages.append(
            {"user_id": user_id, "raw_message": raw_message, "thread_id": thread_id}
        )
        return {"id": "gmail-sent-123"}

    async def download_attachment(self, user_id: int, *, gmail_message_id: str, attachment_id: str) -> bytes:
        self.attachment_requests.append(
            {"user_id": user_id, "gmail_message_id": gmail_message_id, "attachment_id": attachment_id}
        )
        return b"attachment-bytes"

    def list_messages_sync(self, user_id: int, *, query: str, max_results: int) -> list[str]:
        return self.message_ids[:max_results]

    def get_message_sync(self, user_id: int, gmail_message_id: str, *, format: str = "full") -> dict | None:
        return self.messages.get(gmail_message_id)


class FakeEmailRecordRepository:
    def __init__(self, record):
        self.record = record
        self.saved_records = []
        self.saved_embeddings = []

    def get_by_id(self, user_id: int, record_id: int):
        if self.record and self.record.user_id == user_id and self.record.id == record_id:
            return self.record
        return None

    def exists(self, user_id: int, gmail_message_id: str):
        return any(
            saved.user_id == user_id and saved.gmail_message_id == gmail_message_id
            for saved in self.saved_records
        )

    def create(self, **kwargs):
        record = SimpleNamespace(id=len(self.saved_records) + 1, **kwargs)
        self.saved_records.append(record)
        return record

    def save_embedding(self, record_id: int, vector):
        self.saved_embeddings.append((record_id, vector))


class FakeNoteDb:
    def __init__(self):
        self.committed = False
        self.refreshed = []

    def commit(self):
        self.committed = True

    def refresh(self, note):
        self.refreshed.append(note.id)


class FakeNoteRepository:
    def __init__(self):
        self.db = FakeNoteDb()
        self.notes = {}
        self.saved_embeddings = []

    def create_note(self, user_id, title, content, source, workspace_id=None):
        note = SimpleNamespace(
            id=len(self.notes) + 1,
            user_id=user_id,
            title=title,
            content=content,
            source=source,
            workspace_id=workspace_id,
        )
        self.notes[note.id] = note
        return note

    def save_embedding(self, note_id, vector):
        self.saved_embeddings.append((note_id, vector))


class FakeEmbeddingService:
    def embed_text(self, text: str):
        return [0.1, 0.2, 0.3]


def test_email_service_send_draft_uses_connector_and_preserves_reply_headers():
    gmail = FakeGmailConnector()
    service = EmailService(
        account_repo=None,
        record_repo=FakeEmailRecordRepository(None),
        gmail_connector=gmail,
    )

    result = asyncio.run(
        service.send_draft(
            7,
            to="person@example.com",
            subject="Project update",
            body="<p>Hello there</p>",
            thread_id="thread-42",
            message_id="msg-abc",
        )
    )

    assert result["id"] == "gmail-sent-123"
    sent = gmail.sent_messages[0]
    assert sent["user_id"] == 7
    assert sent["thread_id"] == "thread-42"
    msg = message_from_bytes(base64.urlsafe_b64decode(sent["raw_message"] + "=="))
    assert msg["To"] == "person@example.com"
    assert msg["Subject"] == "Project update"
    assert msg["In-Reply-To"] == "msg-abc"
    assert msg["References"] == "msg-abc"


def test_email_service_create_reminder_from_email_uses_reminder_repo():
    record = SimpleNamespace(id=12, user_id=1, subject="Assignment due", snippet="Tomorrow")
    reminder_repo = FakeReminderRepository()
    service = EmailService(
        account_repo=None,
        record_repo=FakeEmailRecordRepository(record),
        reminder_repo=reminder_repo,
    )
    service.extract_reminder = lambda user_id, record_id: {
        "text": "Submit assignment",
        "description": "Due tomorrow",
        "due_date": "2026-06-10",
        "due_time": "17:00",
    }

    result = service.create_reminder_from_email(1, 12)

    assert result == {
        "reminder_id": 1,
        "text": "Submit assignment",
        "due_date": "2026-06-10",
        "due_time": "17:00",
    }
    reminder = reminder_repo.reminders[1]
    assert reminder.email_record_id == 12


def test_email_service_create_note_from_email_creates_and_embeds_note():
    record = SimpleNamespace(
        id=3,
        user_id=1,
        subject="Meeting notes",
        sender_name="Alice",
        sender_email="alice@example.com",
        email_date=None,
        body_text="Please review the integration plan.",
        snippet="Please review",
    )
    note_repo = FakeNoteRepository()
    service = EmailService(
        account_repo=None,
        record_repo=FakeEmailRecordRepository(record),
        note_repo=note_repo,
        embedding_service=FakeEmbeddingService(),
    )

    result = service.create_note_from_email(1, 3)

    assert result == {"note_id": 1, "title": "Meeting notes"}
    note = note_repo.notes[1]
    assert "Please review the integration plan." in note.content
    assert note_repo.db.committed is True
    assert note_repo.saved_embeddings[0][0] == 1


def test_email_service_live_search_sync_uses_connector_and_persists_results():
    gmail = FakeGmailConnector()
    gmail.message_ids = ["msg-1"]
    gmail.messages["msg-1"] = {
        "snippet": "Review the launch checklist",
        "threadId": "thread-99",
        "labelIds": [],
        "payload": {
            "headers": [
                {"name": "Subject", "value": "Launch checklist"},
                {"name": "From", "value": "Alex <alex@example.com>"},
                {"name": "Date", "value": "Tue, 09 Jun 2026 09:00:00 +1200"},
            ],
            "mimeType": "text/plain",
            "body": {
                "data": base64.urlsafe_b64encode(b"Review the launch checklist before 5 PM").decode()
            },
        },
    }
    record_repo = FakeEmailRecordRepository(None)
    service = EmailService(
        account_repo=None,
        record_repo=record_repo,
        gmail_connector=gmail,
        embedding_service=FakeEmbeddingService(),
    )

    result = service.live_search_sync(3, "launch checklist", top_k=1)

    assert result[0]["subject"] == "Launch checklist"
    assert result[0]["sender"] == "Alex <alex@example.com>"
    assert "Review the launch checklist" in result[0]["body"]
    assert record_repo.saved_records[0].gmail_thread_id == "thread-99"
    assert record_repo.saved_embeddings[0][0] == 1
