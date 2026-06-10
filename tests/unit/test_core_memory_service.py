"""Unit tests for CoreMemoryService using FakeNoteRepository."""
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest

from memolink_backend.business.services.core_memory_detector import CoreMemoryDetector
from memolink_backend.business.services.core_memory_service import CoreMemoryService
from memolink_backend.contracts.core_memory_dtos import CoreMemoryCreateDTO, CoreMemoryUpdateDTO
from tests.fakes.note_repository import FakeNoteRepository


def _make_service(user=None):
    note_repo = FakeNoteRepository()
    user_repo = MagicMock()
    user_repo.get_by_id.return_value = user
    embedding = MagicMock()
    embedding.embed_text.return_value = [0.1] * 10
    svc = CoreMemoryService(note_repo=note_repo, user_repo=user_repo, embedding_service=embedding)
    return svc, note_repo, user_repo


def test_create_and_list_memory():
    svc, repo, _ = _make_service()
    dto = CoreMemoryCreateDTO(
        title="My email address",
        memory_type="contact",
        sensitivity_level="low",
        masked_display="user@example.com",
        searchable_metadata="email contact user example",
        workspace_id=None,
    )
    created = svc.create_memory(user_id=1, dto=dto)
    assert created.title == "My email address"
    assert created.memory_type == "contact"

    memories = svc.list_memories(user_id=1, workspace_id=None)
    assert len(memories) == 1
    assert memories[0].id == created.id


def test_create_encrypts_plaintext():
    svc, repo, _ = _make_service()
    dto = CoreMemoryCreateDTO(
        title="API Key",
        memory_type="credential",
        sensitivity_level="high",
        plaintext_value="sk-super-secret-key",
        masked_display="API key (encrypted)",
        searchable_metadata="api key credential",
    )
    svc.create_memory(user_id=1, dto=dto)
    note = list(repo.notes.values())[0]
    assert note.encrypted_content is not None
    assert note.encrypted_content != "sk-super-secret-key"
    assert note.masked_content == "API key (encrypted)"
    assert "sk-super-secret-key" not in (note.searchable_content or "")


def test_create_sanitizes_searchable_metadata_against_plaintext_digits():
    svc, repo, _ = _make_service()
    dto = CoreMemoryCreateDTO(
        title="BDO card number",
        memory_type="card",
        sensitivity_level="high",
        plaintext_value="1234 5678 9012 3456",
        masked_display="**** **** **** 3456",
        searchable_metadata="BDO card number ending in 3456 1234 5678 9012 3456",
    )

    created = svc.create_memory(user_id=1, dto=dto)

    assert "1234 5678 9012 3456" not in (created.searchable_content or "")
    assert "3456" in (created.searchable_content or "")


def test_update_memory():
    svc, repo, _ = _make_service()
    dto = CoreMemoryCreateDTO(title="Project name", memory_type="project", sensitivity_level="low")
    created = svc.create_memory(user_id=1, dto=dto)

    updated = svc.update_memory(user_id=1, memory_id=created.id, dto=CoreMemoryUpdateDTO(title="Updated project"))
    assert updated.title == "Updated project"


def test_delete_memory():
    svc, repo, _ = _make_service()
    dto = CoreMemoryCreateDTO(title="Old memory", memory_type="general", sensitivity_level="low")
    created = svc.create_memory(user_id=1, dto=dto)

    svc.delete_memory(user_id=1, memory_id=created.id)
    assert svc.list_memories(user_id=1, workspace_id=None) == []


def test_reveal_memory_requires_valid_unlock_token():
    svc, repo, _ = _make_service()
    dto = CoreMemoryCreateDTO(
        title="Secret",
        memory_type="credential",
        sensitivity_level="high",
        plaintext_value="my-secret-value",
        masked_display="Secret (encrypted)",
    )
    created = svc.create_memory(user_id=1, dto=dto)

    with pytest.raises(Exception):
        svc.reveal_memory(user_id=1, memory_id=created.id, unlock_token="invalid-token")


def test_unlock_issues_jwt_with_correct_password():
    import bcrypt
    hashed = bcrypt.hashpw(b"correct-password", bcrypt.gensalt()).decode()
    fake_user = SimpleNamespace(id=1, email="u@test.com", password=hashed)
    svc, repo, user_repo = _make_service(user=fake_user)

    response = svc.unlock(user_id=1, password="correct-password")
    assert response.unlock_token
    assert response.expires_at is not None


def test_unlock_rejects_wrong_password():
    import bcrypt
    from fastapi import HTTPException
    hashed = bcrypt.hashpw(b"correct-password", bcrypt.gensalt()).decode()
    fake_user = SimpleNamespace(id=1, email="u@test.com", password=hashed)
    svc, repo, user_repo = _make_service(user=fake_user)

    with pytest.raises(HTTPException) as exc_info:
        svc.unlock(user_id=1, password="wrong-password")
    assert exc_info.value.status_code == 401


def test_detect_and_store_skips_blocked_types():
    svc, repo, _ = _make_service()
    with patch.object(svc._detector, "detect") as mock_detect:
        mock_detect.return_value = [
            {"title": "Some PIN", "memory_type": "pin", "sensitivity_level": "high",
             "plaintext_value": "1234", "masked_display": "PIN", "searchable_metadata": "pin"}
        ]
        saved = svc.detect_and_store(user_id=1, workspace_id=None, user_message="My PIN is 1234")
    assert saved == 0
    assert len(repo.notes) == 0


def test_detect_and_store_saves_valid_items():
    svc, repo, _ = _make_service()
    with patch.object(svc._detector, "detect") as mock_detect:
        mock_detect.return_value = [
            {"title": "User name", "memory_type": "person", "sensitivity_level": "low",
             "plaintext_value": None, "masked_display": "Alex Johnson",
             "searchable_metadata": "name alex johnson"}
        ]
        saved = svc.detect_and_store(user_id=1, workspace_id=None, user_message="Hi, I'm Alex Johnson")
    assert saved == 1
    assert len(repo.notes) == 1


def test_detect_and_store_does_not_duplicate():
    svc, repo, _ = _make_service()
    with patch.object(svc._detector, "detect") as mock_detect:
        mock_detect.return_value = [
            {"title": "User name", "memory_type": "person", "sensitivity_level": "low",
             "plaintext_value": None, "masked_display": "Alex", "searchable_metadata": "alex"}
        ]
        svc.detect_and_store(user_id=1, workspace_id=None, user_message="I'm Alex")
        svc.detect_and_store(user_id=1, workspace_id=None, user_message="I'm Alex again")
    assert len(repo.notes) == 1


def test_detect_and_store_upgrades_existing_name_memory_when_new_value_is_more_complete():
    svc, repo, _ = _make_service()
    with patch.object(svc._detector, "detect") as mock_detect:
        mock_detect.return_value = [
            {
                "title": "User name",
                "memory_type": "person",
                "sensitivity_level": "low",
                "plaintext_value": None,
                "masked_display": "Ronald",
                "searchable_metadata": "name Ronald",
            }
        ]
        svc.detect_and_store(user_id=1, workspace_id=None, user_message="My name is Ronald")

        mock_detect.return_value = [
            {
                "title": "User name",
                "memory_type": "person",
                "sensitivity_level": "low",
                "plaintext_value": None,
                "masked_display": "Ronald Ephraim Tiangson",
                "searchable_metadata": "name Ronald Ephraim Tiangson",
            }
        ]
        saved = svc.detect_and_store(
            user_id=1,
            workspace_id=None,
            user_message="My name is Ronald Ephraim Tiangson",
        )

    assert saved == 1
    assert len(repo.notes) == 1
    note = next(iter(repo.notes.values()))
    assert note.masked_content == "Ronald Ephraim Tiangson"
    assert "Ephraim" in (note.searchable_content or "")


def test_reveal_memory_works_after_valid_unlock():
    import bcrypt
    hashed = bcrypt.hashpw(b"password123", bcrypt.gensalt()).decode()
    fake_user = SimpleNamespace(id=1, email="u@test.com", password=hashed)
    svc, repo, _ = _make_service(user=fake_user)

    dto = CoreMemoryCreateDTO(
        title="My secret",
        memory_type="credential",
        sensitivity_level="high",
        plaintext_value="hello-world",
        masked_display="Secret (encrypted)",
    )
    created = svc.create_memory(user_id=1, dto=dto)
    unlock_response = svc.unlock(user_id=1, password="password123")
    revealed = svc.reveal_memory(user_id=1, memory_id=created.id, unlock_token=unlock_response.unlock_token)
    assert revealed == "hello-world"


def test_find_relevant_memory_matches_sensitive_query():
    svc, repo, _ = _make_service()
    svc.create_memory(
        user_id=1,
        dto=CoreMemoryCreateDTO(
            title="BDO card number",
            memory_type="card",
            sensitivity_level="high",
            plaintext_value="1234 5678 9012 3456",
            masked_display="**** **** **** 3456",
            searchable_metadata="BDO bank card ending in 3456",
        ),
    )

    match = svc.find_relevant_memory(1, None, "What is my BDO card number?")

    assert match is not None
    assert match.title == "BDO card number"


def test_find_relevant_memory_does_not_hijack_general_edit_prompt_with_email_terms():
    svc, repo, _ = _make_service()
    svc.create_memory(
        user_id=1,
        dto=CoreMemoryCreateDTO(
            title="Address",
            memory_type="contact",
            sensitivity_level="low",
            masked_display="Unit 2/18 Hetherington Road, Ranui, Auckland 0612, New Zealand",
            searchable_metadata="address ranui auckland new zealand",
        ),
    )
    svc.create_memory(
        user_id=1,
        dto=CoreMemoryCreateDTO(
            title="Email Address",
            memory_type="contact",
            sensitivity_level="low",
            masked_display="retiangson@gmail.com",
            searchable_metadata="email retiangson@gmail.com",
        ),
    )

    match = svc.find_relevant_memory(
        1,
        None,
        "can you make this better: Live Gmail search in chat, email RAG with embeddings, email attachment metadata in chat RAG",
    )

    assert match is None


def test_format_memory_answer_handles_name_subfields_naturally():
    svc, repo, _ = _make_service()
    note = repo.create_core_memory(
        user_id=1,
        title="User name",
        content="Ronald Ephraim Tiangson",
        memory_type="person",
        sensitivity_level="low",
        encrypted_content=None,
        masked_content="Ronald Ephraim Tiangson",
        searchable_content="name Ronald Ephraim Tiangson",
        memory_source="manual",
        memory_confidence=1.0,
        memory_created_by="user",
        workspace_id=None,
    )

    assert svc.format_memory_answer(query_text="what is my first name?", note=note) == "Your first name is Ronald."
    assert svc.format_memory_answer(query_text="what is my last name?", note=note) == "Your last name is Tiangson."
    assert svc.format_memory_answer(query_text="what is my middle name?", note=note) == "Your middle name is Ephraim."
    assert svc.format_memory_answer(query_text="what is my name?", note=note) == "Your name is Ronald Ephraim Tiangson."


def test_format_memory_answer_handles_related_name_and_numeric_slices():
    svc, repo, _ = _make_service()
    mother = repo.create_core_memory(
        user_id=1,
        title="Mother name",
        content="Maria Tiangson",
        memory_type="person",
        sensitivity_level="low",
        encrypted_content=None,
        masked_content="Maria Tiangson",
        searchable_content="mother name Maria Tiangson",
        memory_source="manual",
        memory_confidence=1.0,
        memory_created_by="user",
        workspace_id=None,
    )
    student_id = repo.create_core_memory(
        user_id=1,
        title="Student ID",
        content="123456789",
        memory_type="credential",
        sensitivity_level="medium",
        encrypted_content=None,
        masked_content="123456789",
        searchable_content="student id 123456789",
        memory_source="manual",
        memory_confidence=1.0,
        memory_created_by="user",
        workspace_id=None,
    )

    assert svc.format_memory_answer(query_text="what is my mother's first name?", note=mother) == "Your mother's first name is Maria."
    assert svc.format_memory_answer(query_text="what are the first 3 digits of my student id?", note=student_id) == "The first 3 digits of your student id are 123."
    assert svc.format_memory_answer(query_text="what are the last 4 digits of my student id?", note=student_id) == "The last 4 digits of your student id are 6789."


def test_infer_missing_memory_builds_favorite_follow_up_prompt():
    svc, _, _ = _make_service()

    spec = svc.infer_missing_memory("what is my favorite color?")

    assert spec is not None
    assert spec["title"] == "Favorite Color"
    assert "favorite color" in spec["prompt_question"].lower()


def test_infer_missing_memory_handles_how_about_favorite_variant():
    svc, _, _ = _make_service()

    spec = svc.infer_missing_memory("how about my favorite music?")

    assert spec is not None
    assert spec["title"] == "Favorite Music"
    assert "favorite music" in spec["prompt_question"].lower()


def test_store_prompted_memory_answer_creates_preference_memory():
    svc, repo, _ = _make_service()

    stored = svc.store_prompted_memory_answer(
        user_id=1,
        workspace_id=None,
        spec={
            "title": "Favorite Color",
            "memory_type": "preference",
            "sensitivity_level": "low",
            "confirmation_subject": "your favorite color",
            "expects": "value",
        },
        answer_text="Blue",
    )

    assert stored is not None
    note = next(iter(repo.notes.values()))
    assert note.title == "Favorite Color"
    assert note.masked_content == "Blue"


def test_detector_heuristic_splits_multiple_structured_personal_fields():
    detector = CoreMemoryDetector()

    items = detector._heuristic_structured_memories(
        "Address: Unit 2/18 Hetherington Road, Ranui, Auckland 0612, New Zealand "
        "birthdate: April 20, 1986 phone number: +64 20 471 8827 email: retiangson@gmail.com"
    )

    titles = [item["title"] for item in items]
    assert "Address" in titles
    assert "Birthdate" in titles
    assert "Phone Number" in titles
    assert "Email Address" in titles
