from memolink_backend.core.security import hash_password
from memolink_backend.domain.models.user_model import User
from memolink_backend.domain.repositories.note_repository import NoteRepository
from memolink_backend.domain.repositories.user_repository import UserRepository


def test_user_repository_creates_and_finds_user_in_memory(db_session, fake):
    repo = UserRepository(db_session)
    email = fake.unique.email()

    created = repo.create(email, hash_password("Password123"))

    assert created.id is not None
    assert repo.get_by_email(email).id == created.id
    assert repo.get_by_id(created.id).email == email


def test_note_repository_soft_delete_restore_and_permanent_delete(db_session, fake):
    user = User(email=fake.unique.email(), password=hash_password("Password123"))
    db_session.add(user)
    db_session.commit()
    db_session.refresh(user)
    repo = NoteRepository(db_session)
    note = repo.create_note(user.id, fake.sentence(), fake.paragraph(), "manual")
    db_session.commit()
    db_session.refresh(note)

    assert repo.get_for_user(user.id) == [note]

    assert repo.delete_note(note.id) is True
    assert repo.get_for_user(user.id) == []
    assert repo.get_trash_for_user(user.id)[0].id == note.id

    assert repo.restore_note(note.id) is True
    assert repo.get_for_user(user.id)[0].id == note.id

    assert repo.permanent_delete_note(note.id) is True
    assert repo.get_by_id(note.id) is None
