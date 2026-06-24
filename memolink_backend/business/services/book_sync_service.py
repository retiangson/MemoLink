from __future__ import annotations

from datetime import datetime
from typing import Optional

from memolink_backend.domain.repositories.book_repository import BookRepository
from memolink_backend.business.services.onedrive_service import OneDriveService


def _filename_to_title(file_name: str) -> str:
    base = file_name.rsplit(".", 1)[0] if "." in file_name else file_name
    return base.replace("_", " ").replace("-", " ").strip() or file_name


def _parse_iso(dt: Optional[str]) -> Optional[datetime]:
    if not dt:
        return None
    try:
        return datetime.fromisoformat(dt.replace("Z", "+00:00"))
    except ValueError:
        return None


class BookSyncService:
    def __init__(self, book_repo: BookRepository, onedrive_service: OneDriveService):
        self._books = book_repo
        self._onedrive = onedrive_service

    async def sync(self, admin_user_id: int) -> dict:
        files = await self._onedrive.list_folder_files(admin_user_id=admin_user_id)
        created, updated = self._apply_files(files, admin_user_id)
        return {"scanned": len(files), "created": created, "updated": updated}

    async def sync_page(self, admin_user_id: int, cursor: Optional[str]) -> dict:
        """One step of a resumable sync: lists a single OneDrive folder page (one Graph
        call) and upserts it, returning a cursor the caller passes back in to continue.
        Lets a long-running local loop (e.g. the desktop app) drive an arbitrarily large
        sync without any single request needing to walk the whole tree."""
        files, next_cursor = await self._onedrive.list_folder_files_page(admin_user_id=admin_user_id, cursor=cursor)
        created, updated = self._apply_files(files, admin_user_id)
        return {"cursor": next_cursor, "done": next_cursor is None, "scanned": len(files), "created": created, "updated": updated}

    def _apply_files(self, files: list[dict], admin_user_id: int) -> tuple[int, int]:
        created = 0
        updated = 0
        existing_by_item_id = self._books.get_by_onedrive_item_ids([f["item_id"] for f in files])
        for f in files:
            existing = existing_by_item_id.get(f["item_id"])
            self._books.upsert_from_sync(
                onedrive_drive_id=f["drive_id"],
                onedrive_item_id=f["item_id"],
                file_name=f["name"],
                file_extension=f["extension"],
                mime_type=f["mime_type"],
                file_size=f["size"],
                onedrive_web_url=f["web_url"],
                last_modified=_parse_iso(f["last_modified"]),
                created_by_admin_id=admin_user_id,
                default_title=_filename_to_title(f["name"]),
                existing=existing,
                commit=False,
            )
            if existing:
                updated += 1
            else:
                created += 1
        if files:
            self._books.db.commit()
        return created, updated
