from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from memolink_backend.core.security import get_current_user
from memolink_backend.di.request_container import RequestContainer, get_request_container
from memolink_backend.contracts.slash_command_dtos import SlashCommandRequestDTO, EquationSolveRequestDTO
from memolink_backend.contracts.note_dtos import NoteResponseDTO

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


@router.post("/solve-equation", response_model=NoteResponseDTO)
def solve_equation(
    dto: EquationSolveRequestDTO,
    user_id: int = Depends(get_current_user),
    c: RequestContainer = Depends(get_request_container),
):
    try:
        return c.commands().solve_equation(user_id, dto.note_id, dto.model)
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
