"""
Desktop Commands Controller

Endpoints:
  POST   /api/desktop/commands           – queue a command (web/mobile client)
  GET    /api/desktop/commands/{id}      – poll for result (web/mobile client)
  POST   /api/desktop/commands/{id}/result – submit result (Electron app)
  GET    /api/desktop/listen             – SSE stream (Electron app connects here)
  GET    /api/desktop/status             – is the desktop app currently online?
"""

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from memolink_backend.core.security import get_current_user
from memolink_backend.di.request_container import RequestContainer, get_request_container
from memolink_backend.contracts.desktop_command_contracts import (
    DesktopCommandCreateDTO,
    DesktopCommandResultDTO,
    DesktopCommandResponseDTO,
    DesktopCommandProgressDTO,
)

router = APIRouter(prefix="/desktop", tags=["desktop"])


@router.post("/commands", response_model=DesktopCommandResponseDTO)
def create_command(
    dto: DesktopCommandCreateDTO,
    current_user_id: int = Depends(get_current_user),
    c: RequestContainer = Depends(get_request_container),
):
    return c.desktop().create_command(current_user_id, dto)


@router.get("/commands/{command_id}", response_model=DesktopCommandResponseDTO)
def get_command(
    command_id: int,
    current_user_id: int = Depends(get_current_user),
    c: RequestContainer = Depends(get_request_container),
):
    cmd = c.desktop().get_command(command_id, current_user_id)
    if cmd is None:
        raise HTTPException(status_code=404, detail="Command not found")
    return cmd


@router.post("/commands/{command_id}/result")
def submit_result(
    command_id: int,
    dto: DesktopCommandResultDTO,
    current_user_id: int = Depends(get_current_user),
    c: RequestContainer = Depends(get_request_container),
):
    updated = c.desktop().submit_result(command_id, current_user_id, dto)
    if not updated:
        raise HTTPException(status_code=404, detail="Command not found")
    return {"ok": True}


@router.post("/commands/{command_id}/progress")
def submit_progress(
    command_id: int,
    dto: DesktopCommandProgressDTO,
    current_user_id: int = Depends(get_current_user),
    c: RequestContainer = Depends(get_request_container),
):
    """Electron app calls this to report interim progress on a still-running command
    (e.g. a long OneDrive sync), without marking it done."""
    updated = c.desktop().report_progress(command_id, current_user_id, dto.message)
    if not updated:
        raise HTTPException(status_code=404, detail="Command not found or not running")
    return {"ok": True}


@router.get("/listen")
async def listen(
    current_user_id: int = Depends(get_current_user),
    c: RequestContainer = Depends(get_request_container),
):
    """Electron desktop app connects here; receives SSE-formatted commands."""
    return StreamingResponse(
        c.desktop().desktop_event_stream(current_user_id),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
            "Connection": "keep-alive",
        },
    )


@router.get("/status")
def desktop_status(
    current_user_id: int = Depends(get_current_user),
    c: RequestContainer = Depends(get_request_container),
):
    return {"online": c.desktop().is_desktop_online(current_user_id)}


@router.post("/heartbeat")
def desktop_heartbeat(
    current_user_id: int = Depends(get_current_user),
    c: RequestContainer = Depends(get_request_container),
):
    """Electron app calls this every 30s to mark itself online."""
    c.desktop().touch_heartbeat(current_user_id)
    return {"ok": True}


@router.get("/pending", response_model=list[DesktopCommandResponseDTO])
def get_pending_commands(
    current_user_id: int = Depends(get_current_user),
    c: RequestContainer = Depends(get_request_container),
):
    """Electron app polls this every 2s; commands are marked running on pickup."""
    return c.desktop().get_and_mark_running(current_user_id)
