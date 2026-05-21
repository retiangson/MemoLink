from collections.abc import Iterator
from contextlib import contextmanager

from fastapi.testclient import TestClient

from memolink_backend.api.v1.auth_controller import get_request_container
from memolink_backend.core.db import get_db
from memolink_backend.core.security import get_current_user
from memolink_backend.main import app
from tests.helpers.api_container import ApiRequestContainer


@contextmanager
def api_client(db_session, user_id: int | None = None) -> Iterator[TestClient]:
    def override_container():
        return ApiRequestContainer(db_session)

    def override_db():
        yield db_session

    app.dependency_overrides[get_request_container] = override_container
    app.dependency_overrides[get_db] = override_db
    if user_id is not None:
        app.dependency_overrides[get_current_user] = lambda: user_id

    try:
        yield TestClient(app)
    finally:
        app.dependency_overrides.clear()
