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


def get_request_container(db: Session = Depends(get_db)) -> RequestContainer:
    return RequestContainer(db)
