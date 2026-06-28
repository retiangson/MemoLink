from memolink_backend.business.services.note_service import NoteService
from memolink_backend.contracts.note_dtos import NoteCreateDTO, NoteUpdateDTO
from tests.fakes.note_repository import FakeNoteRepository


def test_create_and_list_notes_with_fake_content(fake):
    repo = FakeNoteRepository()
    service = NoteService(note_repo=repo)
    user_id = fake.random_int(min=1)

    created = service.create_note(
        NoteCreateDTO(
            user_id=user_id,
            title=fake.sentence(nb_words=4),
            content=fake.paragraph(),
            source="manual",
        )
    )

    notes = service.list_notes(user_id)
    assert notes[0].id == created.id
    assert notes[0].content == created.content


def test_update_note_returns_updated_response(fake):
    repo = FakeNoteRepository()
    service = NoteService(note_repo=repo)
    created = service.create_note(
        NoteCreateDTO(user_id=1, title=fake.sentence(), content=fake.paragraph())
    )
    new_content = fake.paragraph(nb_sentences=3)

    updated = service.update_note(NoteUpdateDTO(note_id=created.id, content=new_content))

    assert updated is not None
    assert updated.content == new_content


def test_autosave_updates_only_owned_active_note():
    repo = FakeNoteRepository()
    service = NoteService(note_repo=repo)
    owned = service.create_note(NoteCreateDTO(user_id=7, title="Old", content="Draft"))
    other = service.create_note(NoteCreateDTO(user_id=8, title="Other", content="Private"))

    updated = service.autosave_note(7, owned.id, "New", "Saved")

    assert updated is not None
    assert updated.title == "New"
    assert updated.content == "Saved"
    assert service.autosave_note(7, other.id, "Stolen", "Changed") is None
    assert repo.get_by_id(other.id).content == "Private"


def test_autosave_rejects_deleted_note():
    repo = FakeNoteRepository()
    service = NoteService(note_repo=repo)
    note = service.create_note(NoteCreateDTO(user_id=7, title="Old", content="Draft"))
    repo.delete_note(note.id)

    assert service.autosave_note(7, note.id, "New", "Saved") is None
