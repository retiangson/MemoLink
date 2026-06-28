import asyncio
from types import SimpleNamespace

import pytest

from memolink_backend.business.services.book_upload_service import BookUploadError, BookUploadService


class FakeOneDrive:
    def __init__(self):
        self.uploads = []
        self.deletes = []

    async def upload_book_bytes(self, **values):
        self.uploads.append(values)
        return {
            "drive_id": "drive",
            "item_id": "item",
            "web_url": "https://example.invalid/book",
            "etag": "etag",
            "size": len(values["content"]),
            "mime_type": values["mime_type"],
            "last_modified": "2026-06-28T10:00:00Z",
        }

    async def delete_file(self, **values):
        self.deletes.append(values)


class FakeBooks:
    def __init__(self, fail=False):
        self.fail = fail
        self.values = None

    def upsert_from_sync(self, **values):
        if self.fail:
            raise RuntimeError("database unavailable")
        self.values = values
        return SimpleNamespace(
            id=1,
            title=values["default_title"],
            author=None,
            description=None,
            category=None,
            tags=None,
            file_name=values["file_name"],
            file_extension=values["file_extension"],
            mime_type=values["mime_type"],
            file_size=values["file_size"],
            cover_image_url=None,
            onedrive_web_url=values["onedrive_web_url"],
            last_modified=values["last_modified"],
            source="onedrive",
            source_location=None,
            is_published=True,
            sync_status="synced",
            sync_error=None,
            created_at=None,
            updated_at=None,
        )


def test_book_upload_preserves_original_before_creating_published_metadata():
    books = FakeBooks()
    onedrive = FakeOneDrive()
    result = asyncio.run(BookUploadService(books, onedrive).upload(
        admin_user_id=9,
        file_name="Course Notes.pdf",
        content=b"pdf bytes",
        mime_type="application/pdf",
    ))

    assert result.is_published is True
    assert books.values["onedrive_item_id"] == "item"
    assert len(onedrive.uploads) == 1


def test_book_upload_rejects_unsupported_file_before_onedrive():
    onedrive = FakeOneDrive()
    with pytest.raises(BookUploadError, match="not supported"):
        asyncio.run(BookUploadService(FakeBooks(), onedrive).upload(
            admin_user_id=9,
            file_name="payload.exe",
            content=b"binary",
            mime_type="application/octet-stream",
        ))
    assert onedrive.uploads == []


def test_book_upload_cleans_up_onedrive_when_metadata_creation_fails():
    onedrive = FakeOneDrive()
    with pytest.raises(RuntimeError, match="database unavailable"):
        asyncio.run(BookUploadService(FakeBooks(fail=True), onedrive).upload(
            admin_user_id=9,
            file_name="book.epub",
            content=b"epub bytes",
            mime_type="application/epub+zip",
        ))
    assert onedrive.deletes == [{"drive_id": "drive", "item_id": "item"}]
