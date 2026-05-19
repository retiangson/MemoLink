from typing import Protocol, List
from fastapi import UploadFile
from memolink_backend.contracts.chat_dtos import ChatRequestDTO, ChatResponseDTO


class IChatService(Protocol):
    def ask(self, dto: ChatRequestDTO) -> ChatResponseDTO: ...
    async def handle_file_upload(self, conversation_id: int, prompt: str, files: List[UploadFile]) -> ChatResponseDTO: ...
