from memolink_backend.core.security import hash_password
from memolink_backend.domain.models.user_model import User
from tests.helpers.api_client import api_client


def test_reminder_api_create_list_update_delete(db_session, fake):
    user = User(email=fake.unique.email(), password=hash_password("Password123"))
    db_session.add(user)
    db_session.commit()
    db_session.refresh(user)

    with api_client(db_session, user_id=user.id) as client:
        created = client.post(
            "/api/reminders",
            json={
                "text": "Prepare slides",
                "description": fake.sentence(),
                "due_date": "2026-05-21",
                "due_time": "14:30",
            },
        )
        assert created.status_code == 200
        reminder_id = created.json()["id"]

        listed = client.get("/api/reminders")
        assert listed.status_code == 200
        assert listed.json()[0]["id"] == reminder_id

        updated = client.patch(f"/api/reminders/{reminder_id}", json={"done": True})
        assert updated.status_code == 200
        assert updated.json()["done"] is True

        deleted = client.delete(f"/api/reminders/{reminder_id}")
        assert deleted.status_code == 200
        assert deleted.json() == {"ok": True}


def test_reminder_api_returns_404_for_other_user(db_session, fake):
    owner = User(email=fake.unique.email(), password=hash_password("Password123"))
    other = User(email=fake.unique.email(), password=hash_password("Password123"))
    db_session.add_all([owner, other])
    db_session.commit()
    db_session.refresh(owner)
    db_session.refresh(other)

    with api_client(db_session, user_id=owner.id) as client:
        created = client.post("/api/reminders", json={"text": "Private task"})
        reminder_id = created.json()["id"]

    with api_client(db_session, user_id=other.id) as client:
        response = client.patch(f"/api/reminders/{reminder_id}", json={"done": True})

    assert response.status_code == 404
