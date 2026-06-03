import logging
from typing import Optional
from memolink_backend.domain.interfaces.i_system_log_repository import ISystemLogRepository
from memolink_backend.domain.models.system_log import SystemLog

_logger = logging.getLogger(__name__)


class SystemLogService:
    def __init__(self, repo: ISystemLogRepository):
        self._repo = repo

    def _safe_create(self, level: str, source: str, message: str, details: Optional[dict], user_id: Optional[int]) -> Optional[SystemLog]:
        """Write a log entry. Never raises - a logging failure must not crash the calling request."""
        try:
            return self._repo.create(level, source, message, details, user_id)
        except Exception as exc:
            _logger.warning("SystemLogService: failed to write %s log [%s] %s - %s", level, source, message, exc)
            return None

    def info(self, source: str, message: str, details: Optional[dict] = None, user_id: Optional[int] = None) -> Optional[SystemLog]:
        return self._safe_create("INFO", source, message, details, user_id)

    def warning(self, source: str, message: str, details: Optional[dict] = None, user_id: Optional[int] = None) -> Optional[SystemLog]:
        return self._safe_create("WARNING", source, message, details, user_id)

    def error(self, source: str, message: str, details: Optional[dict] = None, user_id: Optional[int] = None) -> Optional[SystemLog]:
        return self._safe_create("ERROR", source, message, details, user_id)

    def list(
        self,
        level: Optional[str] = None,
        source: Optional[str] = None,
        page: int = 1,
        page_size: int = 50,
    ) -> dict:
        offset = (page - 1) * page_size
        entries = self._repo.list(level=level, source=source, limit=page_size, offset=offset)
        total = self._repo.count(level=level, source=source)
        return {
            "items": entries,
            "total": total,
            "page": page,
            "page_size": page_size,
            "pages": max(1, (total + page_size - 1) // page_size),
        }

    def clear(self) -> int:
        return self._repo.clear()
