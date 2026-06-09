from __future__ import annotations
from sqlalchemy.orm import Session

from memolink_backend.domain.interfaces.i_user_repository import IUserRepository
from memolink_backend.domain.interfaces.i_note_repository import INoteRepository
from memolink_backend.domain.interfaces.i_conversation_repository import IConversationRepository
from memolink_backend.domain.interfaces.i_system_log_repository import ISystemLogRepository
from memolink_backend.domain.repositories.user_repository import UserRepository
from memolink_backend.domain.repositories.note_repository import NoteRepository
from memolink_backend.domain.repositories.conversation_repository import ConversationRepository
from memolink_backend.domain.repositories.system_log_repository import SystemLogRepository
from memolink_backend.domain.repositories.translation_cache_repository import TranslationCacheRepository
from memolink_backend.domain.repositories.user_api_key_repository import UserApiKeyRepository
from memolink_backend.domain.repositories.connector_account_repository import ConnectorAccountRepository
from memolink_backend.domain.repositories.email_account_repository import EmailAccountRepository
from memolink_backend.domain.repositories.email_record_repository import EmailRecordRepository
from memolink_backend.domain.repositories.reminder_repository import ReminderRepository
from memolink_backend.domain.repositories.teams_account_repository import TeamsAccountRepository
from memolink_backend.business.services.embedding_service import EmbeddingService


class DomainInstaller:
    def __init__(self, db: Session):
        self._db = db

    def get_db(self) -> Session:
        return self._db

    def get_embedding_service(self) -> EmbeddingService:
        return EmbeddingService()

    def get_user_repository(self) -> IUserRepository:
        return UserRepository(self._db)

    def get_note_repository(self) -> INoteRepository:
        return NoteRepository(self._db)

    def get_conversation_repository(self) -> IConversationRepository:
        return ConversationRepository(self._db)

    def get_system_log_repository(self) -> ISystemLogRepository:
        return SystemLogRepository(self._db)

    def get_translation_cache_repository(self) -> TranslationCacheRepository:
        return TranslationCacheRepository(self._db)

    def get_user_api_key_repository(self) -> UserApiKeyRepository:
        return UserApiKeyRepository(self._db)

    def get_connector_account_repository(self) -> ConnectorAccountRepository:
        return ConnectorAccountRepository(self._db)

    def get_email_account_repository(self) -> EmailAccountRepository:
        return EmailAccountRepository(self._db)

    def get_email_record_repository(self) -> EmailRecordRepository:
        return EmailRecordRepository(self._db)

    def get_teams_account_repository(self) -> TeamsAccountRepository:
        return TeamsAccountRepository(self._db)

    def get_reminder_repository(self) -> ReminderRepository:
        return ReminderRepository(self._db)

    def get_proactive_insight_repository(self):
        from memolink_backend.domain.repositories.proactive_insight_repository import ProactiveInsightRepository
        return ProactiveInsightRepository(self._db)
