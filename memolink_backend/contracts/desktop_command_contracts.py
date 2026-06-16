from typing import Any, Optional
from pydantic import BaseModel


class DesktopCommandCreateDTO(BaseModel):
    command_type: str        # mkdir | exec | write-file | list-dir | read-file | delete
    payload: dict[str, Any]  # e.g. {"path": "C:\\test"} or {"command": "python script.py"}


class DesktopCommandResultDTO(BaseModel):
    ok: bool
    output: Optional[str] = None
    error: Optional[str] = None


class DesktopCommandResponseDTO(BaseModel):
    id: int
    command_type: str
    payload: dict[str, Any]
    status: str              # pending | running | done | failed
    result: Optional[str] = None

    class Config:
        from_attributes = True
