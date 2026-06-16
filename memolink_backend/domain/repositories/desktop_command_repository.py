from typing import Optional
from sqlalchemy.orm import Session
from sqlalchemy import text
from memolink_backend.domain.models.desktop_command import DesktopCommand


class DesktopCommandRepository:
    def __init__(self, db: Session):
        self._db = db

    def create(self, user_id: int, command_type: str, payload: dict) -> DesktopCommand:
        cmd = DesktopCommand(
            user_id=user_id,
            command_type=command_type,
            payload=payload,
            status="pending",
        )
        self._db.add(cmd)
        self._db.commit()
        self._db.refresh(cmd)
        return cmd

    def get(self, command_id: int) -> Optional[DesktopCommand]:
        return self._db.query(DesktopCommand).filter(DesktopCommand.id == command_id).first()

    def get_for_user(self, command_id: int, user_id: int) -> Optional[DesktopCommand]:
        return (
            self._db.query(DesktopCommand)
            .filter(DesktopCommand.id == command_id, DesktopCommand.user_id == user_id)
            .first()
        )

    def set_running(self, command_id: int) -> None:
        self._db.query(DesktopCommand).filter(DesktopCommand.id == command_id).update(
            {"status": "running", "executed_at": text("NOW()")}
        )
        self._db.commit()

    def set_result(self, command_id: int, ok: bool, result: str) -> None:
        status = "done" if ok else "failed"
        self._db.query(DesktopCommand).filter(DesktopCommand.id == command_id).update(
            {"status": status, "result": result}
        )
        self._db.commit()

    def set_result_for_user(self, command_id: int, user_id: int, ok: bool, result: str) -> bool:
        status = "done" if ok else "failed"
        updated = (
            self._db.query(DesktopCommand)
            .filter(DesktopCommand.id == command_id, DesktopCommand.user_id == user_id)
            .update({"status": status, "result": result})
        )
        self._db.commit()
        return updated > 0

    def list_pending(self, user_id: int) -> list[DesktopCommand]:
        return (
            self._db.query(DesktopCommand)
            .filter(DesktopCommand.user_id == user_id, DesktopCommand.status == "pending")
            .order_by(DesktopCommand.created_at)
            .all()
        )
