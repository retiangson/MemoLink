from typing import Any, Optional, List
from sqlalchemy.orm import Session

from memolink_backend.domain.repositories.conversation_repository import ConversationRepository
from memolink_backend.domain.repositories.note_repository import NoteRepository
from memolink_backend.domain.interfaces.i_conversation_repository import IConversationRepository
from memolink_backend.domain.interfaces.i_note_repository import INoteRepository
from memolink_backend.business.services.embedding_service import EmbeddingService
from memolink_backend.business.interfaces.i_conversation_service import IConversationService


class ConversationService(IConversationService):
    def __init__(
        self,
        db: Optional[Session] = None,
        conv_repo: Optional[IConversationRepository] = None,
        note_repo: Optional[INoteRepository] = None,
        embedding_service: Optional[EmbeddingService] = None,
    ):
        self.db = db
        self.repo: IConversationRepository = conv_repo if conv_repo is not None else ConversationRepository(db)
        self.note_repo: Optional[INoteRepository] = note_repo if note_repo is not None else (NoteRepository(db) if db else None)
        self.embedding = embedding_service or EmbeddingService()

    def list_for_user(self, user_id: int, workspace_id: int | None = None) -> list[dict[str, Any]]:
        convs = self.repo.get_for_user(user_id, workspace_id)
        return [{"id": c.id, "title": c.title, "messages": [], "created_at": c.created_at.isoformat() if c.created_at else None} for c in convs]

    def list_trash(self, user_id: int) -> list[dict[str, Any]]:
        convs = self.repo.get_trash_for_user(user_id)
        return [{"id": c.id, "title": c.title, "deleted_at": c.deleted_at} for c in convs]

    def create(self, user_id: int, title: str | None = None, workspace_id: int | None = None) -> dict[str, Any]:
        conv = self.repo.create_conversation(user_id, title, workspace_id)
        return {"id": conv.id, "title": conv.title, "messages": [], "created_at": conv.created_at.isoformat() if conv.created_at else None}

    def get_messages_paginated(self, conv_id: int, limit: int, before_id: int | None) -> list[dict[str, Any]]:
        messages = self.repo.get_messages_paginated(conv_id, limit, before_id)
        messages.sort(key=lambda m: m.id)
        return [
            {"id": m.id, "conversation_id": m.conversation_id, "role": m.role, "content": m.content, "created_at": m.created_at}
            for m in messages
        ]

    def rename(self, conv_id: int, title: str) -> dict[str, Any] | None:
        conv = self.repo.rename(conv_id, title)
        return {"id": conv.id, "title": conv.title} if conv else None

    def delete(self, conv_id: int) -> bool:
        return self.repo.delete(conv_id)

    def restore_conversation(self, conv_id: int) -> bool:
        return self.repo.restore_conversation(conv_id)

    def permanent_delete_conversation(self, conv_id: int) -> bool:
        return self.repo.permanent_delete_conversation(conv_id)

    def delete_message(self, message_id: int) -> bool:
        return self.repo.delete_message(message_id)

    def add_message_to_note(self, user_id: int, content: str, title: str | None = None) -> dict[str, Any]:
        if not self.note_repo or not self.db:
            raise ValueError("note_repo and db are required for add_message_to_note.")
        note_title = title or "Chat Snippet"
        note = self.note_repo.create_note(user_id=user_id, title=note_title, content=content, source="chat")
        try:
            with self.db.begin_nested():
                vector = self.embedding.embed_text(content)
                self.note_repo.save_embedding(note.id, vector)
        except Exception:
            pass
        self.db.commit()
        return {"id": note.id, "title": note_title}
