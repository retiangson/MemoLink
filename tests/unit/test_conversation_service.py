from memolink_backend.business.services.conversation_service import ConversationService
from tests.fakes.conversation_repository import FakeConversationRepository


def test_conversation_service_creates_lists_renames_and_deletes(fake):
    repo = FakeConversationRepository()
    service = ConversationService(conv_repo=repo, embedding_service=None)
    user_id = fake.random_int(min=1)

    created = service.create(user_id, title="First chat", workspace_id=7)
    listed = service.list_for_user(user_id, workspace_id=7)
    renamed = service.rename(created["id"], "Renamed chat")

    assert listed[0]["id"] == created["id"]
    assert renamed == {"id": created["id"], "title": "Renamed chat"}
    assert service.delete(created["id"]) is True
    assert service.list_for_user(user_id) == []
    assert service.list_trash(user_id)[0]["id"] == created["id"]
    assert service.restore_conversation(created["id"]) is True


def test_conversation_service_returns_messages_in_chronological_order():
    repo = FakeConversationRepository()
    service = ConversationService(conv_repo=repo, embedding_service=None)
    conv = repo.create_conversation(1, "Chat")
    first = repo.add_message(conv.id, "user", "hello")
    second = repo.add_message(conv.id, "assistant", "hi")

    messages = service.get_messages_paginated(conv.id, limit=10, before_id=None)

    assert [m["id"] for m in messages] == [first.id, second.id]


def test_delete_message_delegates_to_repository():
    repo = FakeConversationRepository()
    service = ConversationService(conv_repo=repo, embedding_service=None)
    conv = repo.create_conversation(1, "Chat")
    msg = repo.add_message(conv.id, "user", "delete me")

    assert service.delete_message(msg.id) is True
    assert service.delete_message(msg.id) is False
