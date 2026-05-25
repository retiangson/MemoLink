from types import SimpleNamespace

import memolink_backend.business.services.chat_service as chat_module
from memolink_backend.core.security import hash_password
from memolink_backend.domain.models.user_model import User
from tests.helpers.api_client import api_client


class FakeOpenAIChat:
    def create(self, **kwargs):
        message = SimpleNamespace(content="API chat answer")
        return SimpleNamespace(choices=[SimpleNamespace(message=message)])


def test_chat_api_returns_answer_with_mocked_openai(db_session, fake, monkeypatch):
    user = User(email=fake.unique.email(), password=hash_password("Password123"))
    db_session.add(user)
    db_session.commit()
    db_session.refresh(user)
    monkeypatch.setattr(
        chat_module,
        "_get_client",
        lambda model: SimpleNamespace(chat=SimpleNamespace(completions=FakeOpenAIChat())),
    )

    with api_client(db_session, user_id=user.id) as client:
        response = client.post("/api/chat", json={"prompt": "Hello"})

    assert response.status_code == 200
    assert response.json()["answer"] == "API chat answer"


def test_chat_api_empty_prompt_does_not_call_openai(db_session, fake):
    user = User(email=fake.unique.email(), password=hash_password("Password123"))
    db_session.add(user)
    db_session.commit()
    db_session.refresh(user)

    with api_client(db_session, user_id=user.id) as client:
        response = client.post("/api/chat", json={"prompt": "   "})

    assert response.status_code == 200
    assert response.json()["answer"] == "I didn't receive any message."
