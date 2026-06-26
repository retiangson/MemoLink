"""Syncs a single archive.org item into the MemoLink books library.

One HTTP call to archive.org/metadata/{identifier} returns ALL files —
no cursor, no pagination — so the sync completes in a single round trip.

Files are written in batches of BATCH_SIZE.  Each batch runs in its own
Session (opened and closed around the batch) so the DB connection is
returned to the pool between batches and the pool is not starved while
a long sync is in progress.  Within each batch, per-row savepoints
ensure a single bad row (e.g. a value that is too long) is skipped with
a warning without poisoning the rest of the session.
"""
from __future__ import annotations

import logging
from typing import Callable

from memolink_backend.domain.repositories.book_repository import BookRepository
from memolink_backend.business.services.archive_org_service import ArchiveOrgService
from memolink_backend.business.services.book_sync_service import _filename_to_title, _parse_iso

logger = logging.getLogger(__name__)

BATCH_SIZE = 100


class ArchiveSyncService:
    def __init__(self, session_factory: Callable, archive_service: ArchiveOrgService):
        self._session_factory = session_factory
        self._archive = archive_service

    async def sync(self, identifier: str, admin_user_id: int) -> dict:
        files, source_location = await self._archive.list_item_files(identifier)
        created, updated, skipped = self._apply_files(files, source_location, admin_user_id)
        return {
            "scanned": len(files),
            "created": created,
            "updated": updated,
            "skipped": skipped,
            "source_location": source_location,
        }

    def _apply_files(
        self, files: list[dict], source_location: str, admin_user_id: int
    ) -> tuple[int, int, int]:
        if not files:
            return 0, 0, 0

        created = updated = skipped = 0

        for batch_start in range(0, len(files), BATCH_SIZE):
            batch = files[batch_start : batch_start + BATCH_SIZE]
            batch_created, batch_updated, batch_skipped = self._apply_batch(
                batch, source_location, admin_user_id
            )
            created += batch_created
            updated += batch_updated
            skipped += batch_skipped

        return created, updated, skipped

    def _apply_batch(
        self, batch: list[dict], source_location: str, admin_user_id: int
    ) -> tuple[int, int, int]:
        """Process one batch inside its own Session.

        Opening and closing the Session around each batch returns the
        underlying DB connection to the pool so other requests are not
        starved during a long sync.
        """
        created = updated = skipped = 0

        with self._session_factory() as session:
            repo = BookRepository(session)
            existing_by_item_id = repo.get_by_onedrive_item_ids(
                [f["item_id"] for f in batch]
            )

            for f in batch:
                existing = existing_by_item_id.get(f["item_id"])
                sp = session.begin_nested()
                try:
                    repo.upsert_from_sync(
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
                        source="archive_org",
                        source_location=source_location,
                        existing=existing,
                        commit=False,
                    )
                    sp.commit()
                    if existing:
                        updated += 1
                    else:
                        created += 1
                except Exception as exc:
                    sp.rollback()
                    skipped += 1
                    logger.warning("archive-sync skipped %s: %s", f.get("item_id"), exc)

            if created + updated > 0:
                session.commit()
            # session.close() is called by the context manager here,
            # returning the connection to the pool before the next batch.

        return created, updated, skipped
