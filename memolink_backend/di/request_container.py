from fastapi import Depends
from sqlalchemy.orm import Session

from memolink_backend.core.db import get_db
from memolink_backend.domain.domain_installer import DomainInstaller
from memolink_backend.business.service_installer import ServiceInstaller


class RequestContainer:
    def __init__(self, db: Session):
        self.domain = DomainInstaller(db)
        self.services = ServiceInstaller(self.domain)

    def notes(self):
        return self.services.get_note_service()

    def chat(self):
        return self.services.get_chat_service()

    def conversations(self):
        return self.services.get_conversation_service()

    def auth(self):
        return self.services.get_auth_service()

    def research(self):
        return self.services.get_research_service()

    def logs(self):
        return self.services.get_system_log_service()

    def commands(self):
        return self.services.get_slash_command_service()

    def email(self):
        return self.services.get_email_service()

    def teams(self):
        return self.services.get_teams_service()

    def insights(self):
        return self.services.get_proactive_insight_service()

    def memograph(self):
        return self.services.get_memograph_service()

    def study(self):
        return self.services.get_study_service()

    def workflow(self):
        return self.services.get_workflow_service()

    def timeline(self):
        return self.services.get_timeline_service()

    def survey(self):
        return self.services.get_survey_service()

    def evaluation(self):
        return self.services.get_evaluation_service()

    def evaluation_report(self):
        return self.services.get_evaluation_report_service()


def get_request_container(db: Session = Depends(get_db)) -> RequestContainer:
    return RequestContainer(db)
