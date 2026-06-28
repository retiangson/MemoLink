from datetime import datetime
from pathlib import Path
from typing import Optional

from memolink_backend.business.services.onedrive_service import OneDriveService, SUPPORTED_EXTENSIONS
from memolink_backend.contracts.book_dtos import BookResponseDTO
from memolink_backend.domain.repositories.book_repository import BookRepository


class BookUploadError(Exception):
    def __init__(self, status_code: int, detail: str):
        self.status_code = status_code
        self.detail = detail
        super().__init__(detail)


class BookUploadService:
    """Stores a new book original in OneDrive before creating its database metadata."""

    def __init__(self, books: BookRepository, onedrive: OneDriveService):
        self._books = books
        self._onedrive = onedrive

    @staticmethod
    def validate_file(file_name: str, size: int) -> str:
        extension = Path(file_name).suffix.lower()
        if extension not in SUPPORTED_EXTENSIONS:
            raise BookUploadError(415, "This book format is not supported")
        if size <= 0:
            raise BookUploadError(400, "The uploaded book is empty")
        return extension

    async def upload(
        self,
        *,
        admin_user_id: int,
        file_name: str,
        content: bytes,
        mime_type: Optional[str],
    ) -> BookResponseDTO:
        extension = self.validate_file(file_name, len(content))
        uploaded = await self._onedrive.upload_book_bytes(
            file_name=file_name,
            content=content,
            mime_type=mime_type,
        )
        try:
            last_modified = None
            if uploaded.get("last_modified"):
                last_modified = datetime.fromisoformat(uploaded["last_modified"].replace("Z", "+00:00"))
            row = self._books.upsert_from_sync(
                onedrive_drive_id=uploaded["drive_id"],
                onedrive_item_id=uploaded["item_id"],
                file_name=file_name,
                file_extension=extension,
                mime_type=uploaded.get("mime_type") or mime_type,
                file_size=uploaded.get("size") or len(content),
                onedrive_web_url=uploaded.get("web_url"),
                last_modified=last_modified,
                created_by_admin_id=admin_user_id,
                default_title=Path(file_name).stem,
                source="onedrive",
            )
            return BookResponseDTO.model_validate(row)
        except Exception:
            try:
                await self._onedrive.delete_file(
                    drive_id=uploaded["drive_id"],
                    item_id=uploaded["item_id"],
                )
            except Exception:
                pass
            raise
