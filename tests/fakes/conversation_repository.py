from datetime import datetime, timezone
from types import SimpleNamespace


class FakeConversationRepository:
    def __init__(self):
        self.conversations = {}
        self.messages = {}

    def create_conversation(self, user_id, title=None, workspace_id=None):
        conv = SimpleNamespace(
            id=len(self.conversations) + 1,
            user_id=user_id,
            title=title,
            workspace_id=workspace_id,
            created_at=datetime.now(timezone.utc),
            deleted_at=None,
        )
        self.conversations[conv.id] = conv
        return conv

    def add_message(self, conv_id, role, content):
        msg = SimpleNamespace(
            id=len(self.messages) + 1,
            conversation_id=conv_id,
            role=role,
            content=content,
            created_at=datetime.now(timezone.utc),
        )
        self.messages[msg.id] = msg
        return msg

    def get_for_user(self, user_id, workspace_id=None):
        convs = [
            c for c in self.conversations.values()
            if c.user_id == user_id and c.deleted_at is None
        ]
        if workspace_id is not None:
            convs = [c for c in convs if c.workspace_id == workspace_id]
        return sorted(convs, key=lambda c: c.id, reverse=True)

    def get_trash_for_user(self, user_id):
        return [c for c in self.conversations.values() if c.user_id == user_id and c.deleted_at is not None]

    def get_messages_paginated(self, conv_id, limit, before_id):
        messages = [m for m in self.messages.values() if m.conversation_id == conv_id]
        if before_id is not None:
            messages = [m for m in messages if m.id < before_id]
        return sorted(messages, key=lambda m: m.id, reverse=True)[:limit]

    def rename(self, conv_id, title):
        conv = self.conversations.get(conv_id)
        if conv:
            conv.title = title
        return conv

    def delete(self, conv_id):
        conv = self.conversations.get(conv_id)
        if not conv:
            return False
        conv.deleted_at = datetime.now(timezone.utc)
        return True

    def restore_conversation(self, conv_id):
        conv = self.conversations.get(conv_id)
        if not conv:
            return False
        conv.deleted_at = None
        return True

    def permanent_delete_conversation(self, conv_id):
        return self.conversations.pop(conv_id, None) is not None

    def delete_message(self, message_id):
        return self.messages.pop(message_id, None) is not None
