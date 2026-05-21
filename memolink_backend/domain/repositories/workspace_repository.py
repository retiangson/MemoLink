from typing import List, Optional
from datetime import datetime, timezone
from sqlalchemy.orm import Session
from sqlalchemy import func
from memolink_backend.domain.models.workspace import Workspace
from memolink_backend.domain.models.reminder import Reminder


class WorkspaceRepository:
    def __init__(self, db: Session):
        self.db = db

    def create(self, user_id: int, name: str, type: str, description: Optional[str], is_default: bool) -> Workspace:
        ws = Workspace(
            user_id=user_id,
            name=name,
            type=type,
            description=description,
            is_default=is_default,
        )
        self.db.add(ws)
        self.db.commit()
        self.db.refresh(ws)
        return ws

    def get_by_id(self, workspace_id: int) -> Optional[Workspace]:
        return self.db.query(Workspace).filter(
            Workspace.id == workspace_id, Workspace.deleted_at == None
        ).first()

    def get_for_user(self, user_id: int) -> List[Workspace]:
        return (
            self.db.query(Workspace)
            .filter(Workspace.user_id == user_id, Workspace.deleted_at == None)
            .order_by(Workspace.last_accessed_at.desc().nullslast(), Workspace.created_at.desc())
            .all()
        )

    def get_active_for_user(self, user_id: int) -> Optional[Workspace]:
        ws = (
            self.db.query(Workspace)
            .filter(Workspace.user_id == user_id, Workspace.deleted_at == None, Workspace.last_accessed_at != None)
            .order_by(Workspace.last_accessed_at.desc())
            .first()
        )
        if ws:
            return ws
        return (
            self.db.query(Workspace)
            .filter(Workspace.user_id == user_id, Workspace.deleted_at == None)
            .order_by(Workspace.is_default.desc(), Workspace.created_at.asc())
            .first()
        )

    def update(self, workspace_id: int, name: Optional[str], type: Optional[str], description: Optional[str]) -> Optional[Workspace]:
        ws = self.get_by_id(workspace_id)
        if not ws:
            return None
        if name is not None:
            ws.name = name
        if type is not None:
            ws.type = type
        if description is not None:
            ws.description = description or None
        ws.updated_at = datetime.now(timezone.utc)
        self.db.commit()
        self.db.refresh(ws)
        return ws

    def soft_delete(self, workspace_id: int) -> bool:
        ws = self.get_by_id(workspace_id)
        if not ws:
            return False
        ws.deleted_at = datetime.now(timezone.utc)
        self.db.commit()
        return True

    def set_last_accessed(self, workspace_id: int) -> Optional[Workspace]:
        ws = self.get_by_id(workspace_id)
        if not ws:
            return None
        ws.last_accessed_at = datetime.now(timezone.utc)
        self.db.commit()
        self.db.refresh(ws)
        return ws

    def count_active_for_user(self, user_id: int) -> int:
        return self.db.query(func.count(Workspace.id)).filter(
            Workspace.user_id == user_id, Workspace.deleted_at == None
        ).scalar() or 0

    def name_exists_for_user(self, user_id: int, name: str, exclude_id: Optional[int] = None) -> bool:
        q = self.db.query(Workspace).filter(
            Workspace.user_id == user_id,
            Workspace.name == name,
            Workspace.deleted_at == None,
        )
        if exclude_id:
            q = q.filter(Workspace.id != exclude_id)
        return q.first() is not None

    def get_alert_count(self, workspace_id: int) -> int:
        return self.db.query(func.count(Reminder.id)).filter(
            Reminder.workspace_id == workspace_id,
            Reminder.done == False,
        ).scalar() or 0
