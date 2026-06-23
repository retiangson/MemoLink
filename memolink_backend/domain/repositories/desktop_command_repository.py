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

    def set_progress_for_user(self, command_id: int, user_id: int, result: str) -> bool:
        """Updates only the result text of a still-running command, leaving status
        untouched, so long-running commands can report interim progress."""
        updated = (
            self._db.query(DesktopCommand)
            .filter(DesktopCommand.id == command_id, DesktopCommand.user_id == user_id, DesktopCommand.status == "running")
            .update({"result": result})
        )
        self._db.commit()
        return updated > 0

    def list_pending(self, user_id: int) -> list[DesktopCommand]:
        return (
            self._db.query(DesktopCommand)
            .filter(
                DesktopCommand.user_id == user_id,
                DesktopCommand.status == "pending",
                DesktopCommand.command_type != "__heartbeat__",
            )
            .order_by(DesktopCommand.created_at)
            .all()
        )

    def touch_heartbeat(self, user_id: int) -> None:
        """Upsert a heartbeat record — delete old one and insert fresh so created_at is current."""
        self._db.query(DesktopCommand).filter(
            DesktopCommand.user_id == user_id,
            DesktopCommand.command_type == "__heartbeat__",
        ).delete()
        self._db.add(DesktopCommand(user_id=user_id, command_type="__heartbeat__", payload={}, status="done"))
        self._db.commit()

    def has_recent_heartbeat(self, user_id: int, within_seconds: int = 90) -> bool:
        from datetime import datetime, timezone, timedelta
        cutoff = datetime.now(timezone.utc) - timedelta(seconds=within_seconds)
        return bool(
            self._db.query(DesktopCommand)
            .filter(
                DesktopCommand.user_id == user_id,
                DesktopCommand.command_type == "__heartbeat__",
                DesktopCommand.created_at >= cutoff,
            )
            .first()
        )
