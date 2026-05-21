from memolink_backend.core.security import hash_password
from memolink_backend.domain.models.user_model import User
from memolink_backend.domain.repositories.conversation_repository import ConversationRepository


def test_conversation_repository_handles_messages_and_trash(db_session, fake):
    user = User(email=fake.unique.email(), password=hash_password("Password123"))
    db_session.add(user)
    db_session.commit()
    db_session.refresh(user)
    repo = ConversationRepository(db_session)
    conv = repo.create_conversation(user.id, fake.sentence(nb_words=3))
    first = repo.add_message(conv.id, "user", "hello")
    second = repo.add_message(conv.id, "assistant", "hi")

    messages = repo.get_messages_paginated(conv.id, limit=10, before_id=None)
    assert [m.id for m in messages] == [second.id, first.id]

    renamed = repo.rename(conv.id, "New title")
    assert renamed.title == "New title"

    assert repo.delete(conv.id) is True
    assert repo.get_for_user(user.id) == []
    assert repo.get_trash_for_user(user.id)[0].id == conv.id

    assert repo.restore_conversation(conv.id) is True
    assert repo.delete_message(first.id) is True
    assert repo.permanent_delete_conversation(conv.id) is True
    assert repo.get_by_id(conv.id) is None
