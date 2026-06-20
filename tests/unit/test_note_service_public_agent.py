import pytest

from memolink_backend.business.services.note_service import NoteService
from memolink_backend.contracts.note_dtos import NoteCreateDTO
from tests.fakes.note_repository import FakeNoteRepository


def test_set_public_agent_enabled_toggles_on_regular_note(fake):
    repo = FakeNoteRepository()
    service = NoteService(note_repo=repo)
    user_id = fake.random_int(min=1)
    note = service.create_note(NoteCreateDTO(user_id=user_id, content=fake.paragraph()))

    updated = service.set_public_agent_enabled(note.id, user_id, True)

    assert updated is not None
    assert updated.public_agent_enabled is True


def test_set_public_agent_enabled_rejects_core_memory():
    repo = FakeNoteRepository()
    service = NoteService(note_repo=repo)
    core_note = repo.create_core_memory(
        user_id=1, title="Secret", content="masked", memory_type="general",
        sensitivity_level="high", encrypted_content="enc", masked_content="masked",
        searchable_content="search", memory_source="manual", memory_confidence=None,
        memory_created_by="user", workspace_id=None,
    )

    with pytest.raises(ValueError):
        service.set_public_agent_enabled(core_note.id, 1, True)


def test_set_public_agent_enabled_disabling_a_core_memory_is_allowed():
    # Disabling (False) never exposes anything, so it must not be blocked even
    # though the note is a core memory — only the *enable* path is dangerous.
    repo = FakeNoteRepository()
    service = NoteService(note_repo=repo)
    core_note = repo.create_core_memory(
        user_id=1, title="Secret", content="masked", memory_type="general",
        sensitivity_level="high", encrypted_content="enc", masked_content="masked",
        searchable_content="search", memory_source="manual", memory_confidence=None,
        memory_created_by="user", workspace_id=None,
    )

    updated = service.set_public_agent_enabled(core_note.id, 1, False)
    assert updated is not None
    assert updated.public_agent_enabled is False


def test_set_public_agent_enabled_rejects_non_owner(fake):
    repo = FakeNoteRepository()
    service = NoteService(note_repo=repo)
    owner_id = fake.random_int(min=1)
    other_id = owner_id + 1
    note = service.create_note(NoteCreateDTO(user_id=owner_id, content=fake.paragraph()))

    assert service.set_public_agent_enabled(note.id, other_id, True) is None
