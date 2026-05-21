from memolink_backend.core.security import hash_password
from memolink_backend.domain.models.conversation import Conversation
from memolink_backend.domain.models.note import Note
from memolink_backend.domain.models.reminder import Reminder
from memolink_backend.domain.models.user_model import User
from tests.helpers.api_client import api_client


def test_workspace_api_create_list_active_update_delete(db_session, fake):
    user = User(email=fake.unique.email(), password=hash_password("Password123"))
    db_session.add(user)
    db_session.commit()
    db_session.refresh(user)

    with api_client(db_session, user_id=user.id) as client:
        first = client.post(
            "/api/workspaces",
            json={"name": "Academic", "type": "Academic", "description": fake.sentence()},
        )
        assert first.status_code == 200
        first_id = first.json()["id"]
        assert first.json()["is_default"] is True

        second = client.post(
            "/api/workspaces",
            json={"name": "Project", "type": "Project"},
        )
        assert second.status_code == 200
        second_id = second.json()["id"]

        listed = client.post("/api/workspaces/list")
        assert listed.status_code == 200
        assert {ws["id"] for ws in listed.json()} == {first_id, second_id}

        updated = client.post(
            "/api/workspaces/update",
            json={"workspace_id": second_id, "name": "Renamed", "type": "Other"},
        )
        assert updated.status_code == 200
        assert updated.json()["name"] == "Renamed"

        active = client.post("/api/workspaces/set-active", json={"workspace_id": second_id})
        assert active.status_code == 200
        assert active.json()["id"] == second_id

        deleted = client.post("/api/workspaces/delete", json={"workspace_id": first_id})
        assert deleted.status_code == 200
        assert deleted.json() == {"ok": True}


def test_workspace_api_rejects_duplicate_and_invalid_type(db_session, fake):
    user = User(email=fake.unique.email(), password=hash_password("Password123"))
    db_session.add(user)
    db_session.commit()
    db_session.refresh(user)

    with api_client(db_session, user_id=user.id) as client:
        assert client.post("/api/workspaces", json={"name": "Personal", "type": "Personal"}).status_code == 200
        duplicate = client.post("/api/workspaces", json={"name": "Personal", "type": "Personal"})
        invalid = client.post("/api/workspaces", json={"name": "Bad", "type": "Unknown"})

    assert duplicate.status_code == 400
    assert invalid.status_code == 422


def test_workspace_api_delete_removes_notes_chats_and_reminders(db_session, fake):
    user = User(email=fake.unique.email(), password=hash_password("Password123"))
    db_session.add(user)
    db_session.commit()
    db_session.refresh(user)

    with api_client(db_session, user_id=user.id) as client:
        keep = client.post("/api/workspaces", json={"name": "Keep", "type": "Other"}).json()
        delete = client.post("/api/workspaces", json={"name": "Delete", "type": "Project"}).json()

    note = Note(user_id=user.id, workspace_id=delete["id"], title="Delete me", content="Content")
    conversation = Conversation(user_id=user.id, workspace_id=delete["id"], title="Chat")
    reminder = Reminder(user_id=user.id, workspace_id=delete["id"], text="Reminder", done=False)
    keep_note = Note(user_id=user.id, workspace_id=keep["id"], title="Keep me", content="Content")
    db_session.add_all([note, conversation, reminder, keep_note])
    db_session.commit()

    with api_client(db_session, user_id=user.id) as client:
        response = client.post("/api/workspaces/delete", json={"workspace_id": delete["id"]})

    assert response.status_code == 200
    assert db_session.query(Note).filter(Note.workspace_id == delete["id"]).count() == 0
    assert db_session.query(Conversation).filter(Conversation.workspace_id == delete["id"]).count() == 0
    assert db_session.query(Reminder).filter(Reminder.workspace_id == delete["id"]).count() == 0
    assert db_session.query(Note).filter(Note.workspace_id == keep["id"]).count() == 1
