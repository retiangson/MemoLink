from fastapi.testclient import TestClient

from memolink_backend.api.v1.auth_controller import get_request_container
from memolink_backend.api.v1.notes_controller import get_current_user
from memolink_backend.main import app
from tests.helpers.api_container import ApiRequestContainer


def test_auth_register_login_and_notes_flow_uses_in_memory_db(db_session, fake):
    def override_container():
        return ApiRequestContainer(db_session)

    app.dependency_overrides[get_request_container] = override_container
    client = TestClient(app)
    email = fake.unique.email()
    password = "Password123"

    try:
        register_response = client.post(
            "/api/auth/register",
            json={"email": email, "password": password},
        )
        assert register_response.status_code == 200
        token = register_response.json()["access_token"]

        login_response = client.post(
            "/api/auth/login",
            json={"email": email, "password": password},
        )
        assert login_response.status_code == 200
        assert login_response.json()["email"] == email

        note_response = client.post(
            "/api/notes",
            headers={"Authorization": f"Bearer {token}"},
            json={"title": fake.sentence(nb_words=3), "content": fake.paragraph()},
        )
        assert note_response.status_code == 200
        note_id = note_response.json()["id"]

        list_response = client.post(
            "/api/notes/list",
            headers={"Authorization": f"Bearer {token}"},
            json={},
        )
        assert list_response.status_code == 200
        assert [note["id"] for note in list_response.json()] == [note_id]
    finally:
        app.dependency_overrides.clear()


def test_notes_endpoint_requires_auth(db_session):
    def override_container():
        return ApiRequestContainer(db_session)

    app.dependency_overrides[get_request_container] = override_container
    client = TestClient(app)

    try:
        response = client.post("/api/notes/list", json={})
        assert response.status_code == 401
    finally:
        app.dependency_overrides.clear()


def test_notes_endpoint_can_be_overridden_without_touching_real_db(db_session, fake):
    def override_container():
        return ApiRequestContainer(db_session)

    app.dependency_overrides[get_request_container] = override_container
    app.dependency_overrides[get_current_user] = lambda: 123
    client = TestClient(app)

    try:
        response = client.post(
            "/api/notes",
            json={"title": fake.sentence(nb_words=3), "content": fake.paragraph()},
        )
        assert response.status_code == 200
        assert response.json()["user_id"] == 123
    finally:
        app.dependency_overrides.clear()
