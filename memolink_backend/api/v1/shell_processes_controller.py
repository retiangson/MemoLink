"""
Shell Processes Controller

Endpoints for listing and terminating background shell processes
that were launched by the ActionAgent's run_shell tool.

GET    /api/shell/processes           – list running background processes for the current user
DELETE /api/shell/processes/{proc_id} – kill a background process
"""

from fastapi import APIRouter, Depends, HTTPException
from memolink_backend.core.security import get_current_user
from memolink_backend.utils.shell_executor import PROCESS_REGISTRY

router = APIRouter(prefix="/shell", tags=["shell"])


@router.get("/processes")
def list_processes(current_user_id: int = Depends(get_current_user)):
    return {"processes": PROCESS_REGISTRY.list_for_user(current_user_id)}


@router.delete("/processes/{proc_id}")
def kill_process(proc_id: str, current_user_id: int = Depends(get_current_user)):
    killed = PROCESS_REGISTRY.kill(proc_id, user_id=current_user_id)
    if not killed:
        raise HTTPException(status_code=404, detail="Process not found or already stopped")
    return {"ok": True, "proc_id": proc_id}
