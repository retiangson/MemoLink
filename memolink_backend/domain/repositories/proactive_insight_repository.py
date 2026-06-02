from typing import Optional
from sqlalchemy.orm import Session
from memolink_backend.domain.models.proactive_insight import ProactiveInsight


class ProactiveInsightRepository:
    def __init__(self, db: Session):
        self.db = db

    def create(
        self,
        user_id: int,
        workspace_id: Optional[int],
        insight_type: str,
        title: str,
        description: Optional[str],
        note_id: Optional[int],
        severity: str = "info",
    ) -> ProactiveInsight:
        insight = ProactiveInsight(
            user_id=user_id,
            workspace_id=workspace_id,
            insight_type=insight_type,
            title=title,
            description=description,
            note_id=note_id,
            severity=severity,
        )
        self.db.add(insight)
        self.db.flush()
        return insight

    def list_active(self, user_id: int, workspace_id: Optional[int]) -> list[ProactiveInsight]:
        """Return all non-dismissed insights for a workspace, newest first."""
        return (
            self.db.query(ProactiveInsight)
            .filter_by(user_id=user_id, workspace_id=workspace_id, is_dismissed=False)
            .order_by(ProactiveInsight.created_at.desc())
            .all()
        )

    def dismiss(self, insight_id: int, user_id: int) -> bool:
        insight = (
            self.db.query(ProactiveInsight)
            .filter_by(id=insight_id, user_id=user_id)
            .first()
        )
        if not insight:
            return False
        insight.is_dismissed = True
        self.db.commit()
        return True

    def clear_for_workspace(self, user_id: int, workspace_id: Optional[int]) -> None:
        """Delete all (including dismissed) insights before a fresh scan."""
        self.db.query(ProactiveInsight).filter_by(
            user_id=user_id, workspace_id=workspace_id
        ).delete(synchronize_session=False)
        self.db.commit()
