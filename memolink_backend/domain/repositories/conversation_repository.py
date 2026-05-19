from typing import List, Optional
from sqlalchemy.orm import Session, joinedload
from sqlalchemy import func
from memolink_backend.domain.models.conversation import Conversation
from memolink_backend.domain.models.message import Message


class ConversationRepository:
    def __init__(self, db: Session):
        self.db = db

    def create_conversation(self, user_id: int, title: str | None = None) -> Conversation:
        conv = Conversation(user_id=user_id, title=title)
        self.db.add(conv)
        self.db.commit()
        self.db.refresh(conv)
        return conv

    def add_message(self, conv_id: int, role: str, content: str) -> Message:
        msg = Message(conversation_id=conv_id, role=role, content=content)
        self.db.add(msg)
        self.db.commit()
        self.db.refresh(msg)
        return msg

    def get_by_id(self, conv_id: int) -> Optional[Conversation]:
        return self.db.query(Conversation).filter(Conversation.id == conv_id).first()

    def get_for_user(self, user_id: int) -> List[Conversation]:
        return (
            self.db.query(Conversation)
            .options(joinedload(Conversation.messages))
            .filter(Conversation.user_id == user_id, Conversation.deleted_at == None)
            .order_by(Conversation.id.desc())
            .all()
        )

    def get_trash_for_user(self, user_id: int) -> List[Conversation]:
        return (
            self.db.query(Conversation)
            .filter(Conversation.user_id == user_id, Conversation.deleted_at != None)
            .order_by(Conversation.deleted_at.desc())
            .all()
        )

    def get_messages_paginated(self, conv_id: int, limit: int, before_id: int | None) -> List[Message]:
        query = self.db.query(Message).filter(Message.conversation_id == conv_id)
        if before_id:
            query = query.filter(Message.id < before_id)
        return query.order_by(Message.id.desc()).limit(limit).all()

    def rename(self, conv_id: int, title: str) -> Optional[Conversation]:
        conv = self.get_by_id(conv_id)
        if conv:
            conv.title = title
            self.db.commit()
            self.db.refresh(conv)
        return conv

    def delete(self, conv_id: int) -> bool:
        conv = self.get_by_id(conv_id)
        if conv:
            conv.deleted_at = func.now()
            self.db.commit()
            return True
        return False

    def restore_conversation(self, conv_id: int) -> bool:
        conv = self.get_by_id(conv_id)
        if not conv:
            return False
        conv.deleted_at = None
        self.db.commit()
        return True

    def permanent_delete_conversation(self, conv_id: int) -> bool:
        conv = self.get_by_id(conv_id)
        if not conv:
            return False
        self.db.delete(conv)
        self.db.commit()
        return True

    def delete_message(self, message_id: int) -> bool:
        msg = self.db.query(Message).filter(Message.id == message_id).first()
        if not msg:
            return False
        self.db.delete(msg)
        self.db.commit()
        return True
