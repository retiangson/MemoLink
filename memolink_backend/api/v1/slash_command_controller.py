from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse
from memolink_backend.core.security import get_current_user
from memolink_backend.di.request_container import RequestContainer, get_request_container
from memolink_backend.contracts.slash_command_dtos import SlashCommandRequestDTO

router = APIRouter(prefix="/commands", tags=["commands"])


@router.post("/execute")
def execute_command(
    dto: SlashCommandRequestDTO,
    user_id: int = Depends(get_current_user),
    c: RequestContainer = Depends(get_request_container),
):
    dto.user_id = user_id
    return StreamingResponse(
        c.commands().execute_stream(dto),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
