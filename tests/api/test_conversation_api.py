from memolink_backend.core.security import hash_password
from memolink_backend.domain.models.user_model import User
from tests.helpers.api_client import api_client


def test_conversation_api_lifecycle(db_session, fake):
    user = User(email=fake.unique.email(), password=hash_password("Password123"))
    db_session.add(user)
    db_session.commit()
    db_session.refresh(user)

    with api_client(db_session, user_id=user.id) as client:
        created = client.post("/api/conversation/create", json={})
        assert created.status_code == 200
        conv_id = created.json()["id"]

        listed = client.post("/api/conversation/list", json={})
        assert listed.status_code == 200
        assert listed.json()[0]["id"] == conv_id

        renamed = client.post(
            "/api/conversation/rename",
            json={"conversation_id": conv_id, "title": "Renamed"},
        )
        assert renamed.status_code == 200
        assert renamed.json()["title"] == "Renamed"

        deleted = client.post("/api/conversation/delete", json={"conversation_id": conv_id})
        assert deleted.status_code == 200
        assert deleted.json() is True

        trash = client.post("/api/conversation/trash")
        assert trash.status_code == 200
        assert trash.json()[0]["id"] == conv_id

        restored = client.post("/api/conversation/restore", json={"conversation_id": conv_id})
        assert restored.status_code == 200
        assert restored.json() == {"ok": True}
