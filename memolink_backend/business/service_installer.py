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
        from memolink_backend.business.services.action_agent import ActionAgentRunner
        from memolink_backend.business.services.github_connector import GitHubConnectorService
        from memolink_backend.business.services.jira_connector import JiraConnectorService
        from memolink_backend.domain.repositories.graph_repository import GraphRepository
        connector_repo = self._domain.get_connector_account_repository()
        return ChatService(
            conv_repo=self._domain.get_conversation_repository(),
            note_repo=self._domain.get_note_repository(),
            reminder_repo=self._domain.get_reminder_repository(),
            embedding_service=self._domain.get_embedding_service(),
            db=self._domain.get_db(),
            log_service=self.get_system_log_service(),
            user_api_key_repo=self._domain.get_user_api_key_repository(),
            graph_repo=GraphRepository(self._domain.get_db()),
            email_record_repo=self._domain.get_email_record_repository(),
            email_service=self.get_email_service(),
            eval_service=self.get_evaluation_service(),
            core_memory_service=self.get_core_memory_service(),
            action_agent=ActionAgentRunner(
                conv_repo=self._domain.get_conversation_repository(),
                note_repo=self._domain.get_note_repository(),
                reminder_repo=self._domain.get_reminder_repository(),
                embedding_service=self._domain.get_embedding_service(),
                github_service=GitHubConnectorService(connector_repo),
                jira_service=JiraConnectorService(connector_repo),
            ),
        )

    def get_note_service(self) -> INoteService:
        from memolink_backend.business.services.note_service import NoteService
        return NoteService(
            note_repo=self._domain.get_note_repository(),
            embedding_service=self._domain.get_embedding_service(),
            db=self._domain.get_db(),
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
            reminder_repo=self._domain.get_reminder_repository(),
            note_repo=self._domain.get_note_repository(),
            embedding_service=self._domain.get_embedding_service(),
        )

    def get_teams_service(self):
        from memolink_backend.business.services.teams_service import TeamsService
        return TeamsService(
            account_repo=self._domain.get_teams_account_repository(),
            log_service=self.get_system_log_service(),
        )

    def get_connectors_service(self):
        from memolink_backend.business.services.connectors_service import ConnectorsService
        from memolink_backend.business.services.github_connector import GitHubConnectorService
        from memolink_backend.business.services.jira_connector import JiraConnectorService
        connector_repo = self._domain.get_connector_account_repository()
        return ConnectorsService(
            email_repo=self._domain.get_email_account_repository(),
            teams_repo=self._domain.get_teams_account_repository(),
            connector_repo=connector_repo,
            github_service=GitHubConnectorService(connector_repo),
            jira_service=JiraConnectorService(connector_repo),
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
            conv_repo=self._domain.get_conversation_repository(),
            note_repo=self._domain.get_note_repository(),
            reminder_repo=self._domain.get_reminder_repository(),
            embedding_service=self._domain.get_embedding_service(),
        )

    def get_timeline_service(self):
        from memolink_backend.business.services.timeline_service import TimelineService
        from memolink_backend.domain.repositories.timeline_repository import TimelineRepository
        return TimelineService(
            timeline_repo=TimelineRepository(self._domain.get_db()),
            note_repo=self._domain.get_note_repository(),
        )

    def get_transcription_service(self):
        from memolink_backend.business.services.transcription_service import TranscriptionService
        return TranscriptionService()

    def get_evaluation_service(self):
        from memolink_backend.business.services.evaluation_service import EvaluationService
        from memolink_backend.domain.repositories.evaluation_repository import EvaluationRepository
        return EvaluationService(repo=EvaluationRepository(self._domain.get_db()))

    def get_evaluation_report_service(self):
        from memolink_backend.business.services.evaluation_report_service import EvaluationReportService
        from memolink_backend.domain.repositories.evaluation_repository import EvaluationRepository
        return EvaluationReportService(repo=EvaluationRepository(self._domain.get_db()))

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
            reminder_repo=self._domain.get_reminder_repository(),
            embedding_service=self._domain.get_embedding_service(),
            db=self._domain.get_db(),
            log_service=self.get_system_log_service(),
            user_api_key_repo=self._domain.get_user_api_key_repository(),
        )

    def get_core_memory_service(self):
        from memolink_backend.business.services.core_memory_service import CoreMemoryService
        return CoreMemoryService(
            note_repo=self._domain.get_note_repository(),
            user_repo=self._domain.get_user_repository(),
            embedding_service=self._domain.get_embedding_service(),
        )
