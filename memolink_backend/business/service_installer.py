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
        from memolink_backend.domain.repositories.graph_repository import GraphRepository
        return ChatService(
            conv_repo=self._domain.get_conversation_repository(),
            note_repo=self._domain.get_note_repository(),
            embedding_service=self._domain.get_embedding_service(),
            db=self._domain.get_db(),
            log_service=self.get_system_log_service(),
            user_api_key_repo=self._domain.get_user_api_key_repository(),
            graph_repo=GraphRepository(self._domain.get_db()),
        )

    def get_note_service(self) -> INoteService:
        from memolink_backend.business.services.note_service import NoteService
        return NoteService(
            note_repo=self._domain.get_note_repository(),
            embedding_service=self._domain.get_embedding_service(),
            db=self._domain.get_db(),
        )

    def get_agent_service(self):
        from memolink_backend.business.services.agent_service import AgentService
        return AgentService(
            db=self._domain.get_db(),
            embedding_service=self._domain.get_embedding_service(),
        )

    def get_research_service(self):
        from memolink_backend.business.services.research_service import ResearchService
        return ResearchService(
            conv_repo=self._domain.get_conversation_repository(),
            note_repo=self._domain.get_note_repository(),
            embedding_service=self._domain.get_embedding_service(),
        )

    def get_system_log_service(self):
        from memolink_backend.business.services.system_log_service import SystemLogService
        return SystemLogService(repo=self._domain.get_system_log_repository())

    def get_conversation_service(self) -> IConversationService:
        from memolink_backend.business.services.conversation_service import ConversationService
        return ConversationService(
            conv_repo=self._domain.get_conversation_repository(),
            note_repo=self._domain.get_note_repository(),
            embedding_service=self._domain.get_embedding_service(),
            db=self._domain.get_db(),
        )

    def get_email_service(self):
        from memolink_backend.business.services.email_service import EmailService
        return EmailService(
            account_repo=self._domain.get_email_account_repository(),
            record_repo=self._domain.get_email_record_repository(),
            note_repo=self._domain.get_note_repository(),
            embedding_service=self._domain.get_embedding_service(),
        )

    def get_proactive_insight_service(self):
        from memolink_backend.business.services.proactive_insight_service import ProactiveInsightService
        return ProactiveInsightService(
            insight_repo=self._domain.get_proactive_insight_repository(),
            note_repo=self._domain.get_note_repository(),
        )

    def get_memograph_service(self):
        from memolink_backend.business.services.memograph_service import MemographService
        from memolink_backend.domain.repositories.graph_repository import GraphRepository
        return MemographService(
            graph_repo=GraphRepository(self._domain.get_db()),
            note_repo=self._domain.get_note_repository(),
        )

    def get_workflow_service(self):
        from memolink_backend.business.services.workflow_service import WorkflowService
        return WorkflowService(
            db=self._domain.get_db(),
            embedding_service=self._domain.get_embedding_service(),
        )

    def get_timeline_service(self):
        from memolink_backend.business.services.timeline_service import TimelineService
        from memolink_backend.domain.repositories.timeline_repository import TimelineRepository
        return TimelineService(
            timeline_repo=TimelineRepository(self._domain.get_db()),
            note_repo=self._domain.get_note_repository(),
        )

    def get_survey_service(self):
        from memolink_backend.business.services.survey_service import SurveyService
        from memolink_backend.domain.repositories.survey_repository import SurveyRepository
        return SurveyService(repo=SurveyRepository(self._domain.get_db()))

    def get_study_service(self):
        from memolink_backend.business.services.study_service import StudyService
        return StudyService(
            note_repo=self._domain.get_note_repository(),
            conv_repo=self._domain.get_conversation_repository(),
            db=self._domain.get_db(),
        )

    def get_slash_command_service(self):
        from memolink_backend.business.services.slash_command_service import SlashCommandService
        return SlashCommandService(
            note_repo=self._domain.get_note_repository(),
            conv_repo=self._domain.get_conversation_repository(),
            embedding_service=self._domain.get_embedding_service(),
            db=self._domain.get_db(),
            log_service=self.get_system_log_service(),
            user_api_key_repo=self._domain.get_user_api_key_repository(),
        )
