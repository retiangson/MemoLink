from memolink_backend.core.security import hash_password
from memolink_backend.domain.models.conversation import Conversation
from memolink_backend.domain.models.embedding import Embedding
from memolink_backend.domain.models.message import Message
from memolink_backend.domain.models.note import Note
from memolink_backend.domain.models.reminder import Reminder
from memolink_backend.domain.models.user_model import User
from memolink_backend.domain.repositories.workspace_repository import WorkspaceRepository


def test_workspace_repository_crud_active_and_alert_count(db_session, fake):
    user = User(email=fake.unique.email(), password=hash_password("Password123"))
    db_session.add(user)
    db_session.commit()
    db_session.refresh(user)
    repo = WorkspaceRepository(db_session)

    first = repo.create(user.id, "Academic", "Academic", fake.sentence(), True)
    second = repo.create(user.id, "Project", "Project", None, False)
    reminder = Reminder(user_id=user.id, workspace_id=first.id, text="Submit report", done=False)
    db_session.add(reminder)
    db_session.commit()

    assert repo.count_active_for_user(user.id) == 2
    assert repo.name_exists_for_user(user.id, "Academic") is True
    assert repo.get_alert_count(first.id) == 1

    active = repo.set_last_accessed(second.id)
    assert repo.get_active_for_user(user.id).id == active.id

    updated = repo.update(second.id, "Renamed", "Other", "Updated")
    assert updated.name == "Renamed"

    assert repo.soft_delete(first.id) is True
    assert [ws.id for ws in repo.get_for_user(user.id)] == [second.id]


def test_workspace_repository_delete_removes_workspace_content(db_session, fake):
    user = User(email=fake.unique.email(), password=hash_password("Password123"))
    db_session.add(user)
    db_session.commit()
    db_session.refresh(user)
    repo = WorkspaceRepository(db_session)
    workspace = repo.create(user.id, "Project", "Project", None, True)
    note = Note(user_id=user.id, workspace_id=workspace.id, title="Note", content="Content")
    conversation = Conversation(user_id=user.id, workspace_id=workspace.id, title="Chat")
    reminder = Reminder(user_id=user.id, workspace_id=workspace.id, text="Reminder", done=False)
    db_session.add_all([note, conversation, reminder])
    db_session.commit()
    db_session.refresh(note)
    db_session.refresh(conversation)
    db_session.add_all([
        Embedding(note_id=note.id, vector=[0.1, 0.2, 0.3]),
        Message(conversation_id=conversation.id, role="user", content="Hello"),
    ])
    db_session.commit()

    assert repo.soft_delete(workspace.id) is True

    assert db_session.query(Note).filter(Note.workspace_id == workspace.id).count() == 0
    assert db_session.query(Embedding).count() == 0
    assert db_session.query(Conversation).filter(Conversation.workspace_id == workspace.id).count() == 0
    assert db_session.query(Message).count() == 0
    assert db_session.query(Reminder).filter(Reminder.workspace_id == workspace.id).count() == 0
