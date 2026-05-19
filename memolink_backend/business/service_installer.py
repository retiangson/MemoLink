from __future__ import annotations
from memolink_backend.domain.domain_installer import DomainInstaller
from memolink_backend.business.interfaces.i_auth_service import IAuthService
from memolink_backend.business.interfaces.i_chat_service import IChatService
from memolink_backend.business.interfaces.i_note_service import INoteService
from memolink_backend.business.interfaces.i_conversation_service import IConversationService


class ServiceInstaller:
    def __init__(self, domain: DomainInstaller):
        self._domain = domain

    def get_auth_service(self) -> IAuthService:
        from memolink_backend.business.services.auth_service import AuthService
        return AuthService(user_repo=self._domain.get_user_repository(), db=self._domain.get_db())

    def get_chat_service(self) -> IChatService:
        from memolink_backend.business.services.chat_service import ChatService
        return ChatService(
            conv_repo=self._domain.get_conversation_repository(),
            note_repo=self._domain.get_note_repository(),
            embedding_service=self._domain.get_embedding_service(),
            db=self._domain.get_db(),
        )

    def get_note_service(self) -> INoteService:
        from memolink_backend.business.services.note_service import NoteService
        return NoteService(
            note_repo=self._domain.get_note_repository(),
            embedding_service=self._domain.get_embedding_service(),
            db=self._domain.get_db(),
        )

    def get_conversation_service(self) -> IConversationService:
        from memolink_backend.business.services.conversation_service import ConversationService
        return ConversationService(
            conv_repo=self._domain.get_conversation_repository(),
            note_repo=self._domain.get_note_repository(),
            embedding_service=self._domain.get_embedding_service(),
            db=self._domain.get_db(),
        )
