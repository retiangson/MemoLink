import secrets
from typing import List, Optional
from sqlalchemy.orm import Session

from memolink_backend.domain.models.public_agent import PublicAgent


def generate_public_token() -> str:
    """Hard-to-guess, non-sequential public identifier (~43 url-safe chars)."""
    return secrets.token_urlsafe(32)


class PublicAgentRepository:
    def __init__(self, db: Session):
        self.db = db

    def create(
        self,
        name: str,
        workspace_id: int,
        created_by: int,
        description: Optional[str],
        system_prompt: Optional[str],
        public_enabled: bool,
        allowed_domains: Optional[str],
    ) -> PublicAgent:
        agent = PublicAgent(
            name=name,
            token=generate_public_token(),
            workspace_id=workspace_id,
            description=description,
            system_prompt=system_prompt,
            public_enabled=public_enabled,
            allowed_domains=allowed_domains,
            created_by=created_by,
        )
        self.db.add(agent)
        self.db.commit()
        self.db.refresh(agent)
        return agent

    def get_by_id(self, agent_id: int) -> Optional[PublicAgent]:
        return self.db.query(PublicAgent).filter(PublicAgent.id == agent_id).first()

    def get_by_token(self, token: str) -> Optional[PublicAgent]:
        if not token:
            return None
        return self.db.query(PublicAgent).filter(PublicAgent.token == token).first()

    def get_for_owner(self, created_by: int) -> List[PublicAgent]:
        return (
            self.db.query(PublicAgent)
            .filter(PublicAgent.created_by == created_by)
            .order_by(PublicAgent.created_at.desc())
            .all()
        )

    def update(
        self,
        agent_id: int,
        name: Optional[str],
        description: Optional[str],
        system_prompt: Optional[str],
        public_enabled: Optional[bool],
        allowed_domains: Optional[str],
        workspace_id: Optional[int],
    ) -> Optional[PublicAgent]:
        agent = self.get_by_id(agent_id)
        if not agent:
            return None
        if name is not None:
            agent.name = name
        if description is not None:
            agent.description = description
        if system_prompt is not None:
            agent.system_prompt = system_prompt
        if public_enabled is not None:
            agent.public_enabled = public_enabled
        if allowed_domains is not None:
            agent.allowed_domains = allowed_domains
        if workspace_id is not None:
            agent.workspace_id = workspace_id
        self.db.commit()
        self.db.refresh(agent)
        return agent

    def set_enabled(self, agent_id: int, enabled: bool) -> Optional[PublicAgent]:
        agent = self.get_by_id(agent_id)
        if not agent:
            return None
        agent.public_enabled = enabled
        self.db.commit()
        self.db.refresh(agent)
        return agent

    def regenerate_token(self, agent_id: int) -> Optional[PublicAgent]:
        agent = self.get_by_id(agent_id)
        if not agent:
            return None
        agent.token = generate_public_token()
        self.db.commit()
        self.db.refresh(agent)
        return agent

    def delete(self, agent_id: int) -> bool:
        agent = self.get_by_id(agent_id)
        if not agent:
            return False
        self.db.delete(agent)
        self.db.commit()
        return True
