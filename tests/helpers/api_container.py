from memolink_backend.business.services.auth_service import AuthService
from memolink_backend.business.services.chat_service import ChatService
from memolink_backend.business.services.conversation_service import ConversationService
from memolink_backend.business.services.note_service import NoteService
from memolink_backend.business.services.system_log_service import SystemLogService
from memolink_backend.business.services.embedding_service import EmbeddingService
from memolink_backend.domain.repositories.conversation_repository import ConversationRepository
from memolink_backend.domain.repositories.note_repository import NoteRepository
from memolink_backend.domain.repositories.reminder_repository import ReminderRepository
from memolink_backend.domain.repositories.system_log_repository import SystemLogRepository
from memolink_backend.domain.repositories.user_repository import UserRepository


class ApiRequestContainer:
    def __init__(self, db):
        self._db = db

    def auth(self):
        return AuthService(db=self._db, user_repo=UserRepository(self._db))

    def notes(self):
        return NoteService(
            db=self._db,
            note_repo=NoteRepository(self._db),
            embedding_service=None,
        )

    def conversations(self):
        return ConversationService(
            db=self._db,
            conv_repo=ConversationRepository(self._db),
            note_repo=NoteRepository(self._db),
            embedding_service=EmbeddingService(),
        )

    def chat(self):
        return ChatService(
            db=self._db,
            conv_repo=ConversationRepository(self._db),
            note_repo=NoteRepository(self._db),
            reminder_repo=ReminderRepository(self._db),
            embedding_service=EmbeddingService(),
        )

    def logs(self):
        return SystemLogService(repo=SystemLogRepository(self._db))

    def evaluation(self):
        from memolink_backend.business.services.evaluation_service import EvaluationService
        from memolink_backend.domain.repositories.evaluation_repository import EvaluationRepository
        return EvaluationService(repo=EvaluationRepository(self._db))

    def public_agent(self):
        from memolink_backend.business.services.public_agent_service import PublicAgentService
        from memolink_backend.domain.repositories.public_agent_repository import PublicAgentRepository
        return PublicAgentService(
            public_agent_repo=PublicAgentRepository(self._db),
            note_repo=NoteRepository(self._db),
            embedding_service=None,
        )
