from typing import Protocol, Optional
from memolink_backend.domain.models.system_log import SystemLog


class ISystemLogRepository(Protocol):
    def create(
        self,
        level: str,
        source: str,
        message: str,
        details: Optional[dict] = None,
        user_id: Optional[int] = None,
    ) -> SystemLog: ...

    def list(
        self,
        level: Optional[str] = None,
        source: Optional[str] = None,
        limit: int = 100,
        offset: int = 0,
    ) -> list[SystemLog]: ...

    def count(
        self,
        level: Optional[str] = None,
        source: Optional[str] = None,
    ) -> int: ...

    def clear(self) -> int: ...
