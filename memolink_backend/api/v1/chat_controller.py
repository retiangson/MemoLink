from fastapi import APIRouter, UploadFile, File, Form, Depends
from fastapi.responses import StreamingResponse
from typing import List, Optional
from pydantic import BaseModel
from memolink_backend.di.request_container import RequestContainer, get_request_container
from memolink_backend.core.security import get_current_user
from memolink_backend.contracts.chat_dtos import ChatRequestDTO, ChatResponseDTO


class AgentRequestDTO(BaseModel):
    conversation_id: int
    prompt: str
    workspace_id: Optional[int] = None
    model: Optional[str] = None

router = APIRouter(prefix="/chat", tags=["chat"])


@router.post("", response_model=ChatResponseDTO)
def ask_chat(
    dto: ChatRequestDTO,
    current_user_id: int = Depends(get_current_user),
    c: RequestContainer = Depends(get_request_container),
):
    return c.chat().ask(dto.model_copy(update={"user_id": current_user_id}))


@router.post("/stream")
def stream_chat(
    dto: ChatRequestDTO,
    current_user_id: int = Depends(get_current_user),
    c: RequestContainer = Depends(get_request_container),
):
    gen = c.chat().ask_stream(dto.model_copy(update={"user_id": current_user_id}))
    return StreamingResponse(
        gen,
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.post("/agent/stream")
def stream_agent_chat(
    dto: AgentRequestDTO,
    current_user_id: int = Depends(get_current_user),
    c: RequestContainer = Depends(get_request_container),
):
    gen = c.agent().ask_stream(
        conversation_id=dto.conversation_id,
        prompt=dto.prompt,
        user_id=current_user_id,
        workspace_id=dto.workspace_id,
        model=dto.model,
    )
    return StreamingResponse(
        gen,
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.post("/upload", response_model=ChatResponseDTO)
async def upload_chat(
    conversation_id: int = Form(...),
    prompt: str = Form(""),
    files: List[UploadFile] = File(...),
    current_user_id: int = Depends(get_current_user),
    c: RequestContainer = Depends(get_request_container),
):
    return await c.chat().handle_file_upload(conversation_id, prompt, files, user_id=current_user_id)
