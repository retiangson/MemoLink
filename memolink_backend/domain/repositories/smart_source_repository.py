from datetime import datetime, timezone
from typing import Any, Optional

from sqlalchemy.orm import Session

from memolink_backend.domain.models.smart_source import (
    BookNoteLink,
    FileAnnotation,
    NoteTimelineEvent,
    RecordingMetadata,
    SourceFile,
)


class SmartSourceRepository:
    def __init__(self, db: Session):
        self.db = db

    def get_source(self, source_file_id: int) -> Optional[SourceFile]:
        return self.db.query(SourceFile).filter(SourceFile.id == source_file_id, SourceFile.deleted_at.is_(None)).first()

    def list_sources(self, user_id: int, note_id: int) -> list[SourceFile]:
        return self.db.query(SourceFile).filter(
            SourceFile.user_id == user_id,
            SourceFile.note_id == note_id,
            SourceFile.deleted_at.is_(None),
        ).order_by(SourceFile.created_at.asc()).all()

    def create_source(self, user_id: int, values: dict[str, Any]) -> SourceFile:
        existing = self.db.query(SourceFile).filter(
            SourceFile.user_id == user_id,
            SourceFile.note_id == values["note_id"],
            SourceFile.onedrive_drive_id == values["onedrive_drive_id"],
            SourceFile.onedrive_item_id == values["onedrive_item_id"],
            SourceFile.deleted_at.is_(None),
        ).first()
        if existing:
            return existing
        row = SourceFile(user_id=user_id, **values)
        self.db.add(row)
        self.db.commit()
        self.db.refresh(row)
        return row

    def mark_source_cache(self, source_file_id: int, cache_status: str) -> SourceFile:
        row = self.get_source(source_file_id)
        row.cache_status = cache_status
        row.last_synced_at = datetime.now(timezone.utc)
        self.db.commit()
        self.db.refresh(row)
        return row

    def set_extraction_status(self, source_file_id: int, status: str) -> SourceFile:
        row = self.get_source(source_file_id)
        row.extraction_status = status
        row.last_synced_at = datetime.now(timezone.utc)
        self.db.commit()
        self.db.refresh(row)
        return row

    def get_annotation(self, annotation_id: int) -> Optional[FileAnnotation]:
        return self.db.query(FileAnnotation).filter(FileAnnotation.id == annotation_id, FileAnnotation.deleted_at.is_(None)).first()

    def list_annotations(self, user_id: int, note_id: int, source_file_id: Optional[int] = None) -> list[FileAnnotation]:
        query = self.db.query(FileAnnotation).filter(
            FileAnnotation.user_id == user_id,
            FileAnnotation.note_id == note_id,
            FileAnnotation.deleted_at.is_(None),
        )
        if source_file_id is not None:
            query = query.filter(FileAnnotation.source_file_id == source_file_id)
        return query.order_by(FileAnnotation.page_number.asc().nullsfirst(), FileAnnotation.created_at.asc()).all()

    def create_annotation(self, user_id: int, workspace_id: Optional[int], values: dict[str, Any]) -> FileAnnotation:
        row = FileAnnotation(user_id=user_id, workspace_id=workspace_id, **values)
        self.db.add(row)
        self.db.commit()
        self.db.refresh(row)
        return row

    def update_annotation(self, row: FileAnnotation, values: dict[str, Any]) -> FileAnnotation:
        for key, value in values.items():
            setattr(row, key, value)
        self.db.commit()
        self.db.refresh(row)
        return row

    def delete_annotation(self, row: FileAnnotation) -> None:
        row.deleted_at = datetime.now(timezone.utc)
        self.db.commit()

    def list_timeline(self, user_id: int, note_id: int) -> list[NoteTimelineEvent]:
        return self.db.query(NoteTimelineEvent).filter(
            NoteTimelineEvent.user_id == user_id,
            NoteTimelineEvent.note_id == note_id,
        ).order_by(NoteTimelineEvent.created_at.desc()).all()

    def latest_timeline_event(self, user_id: int, note_id: int, event_type: str) -> Optional[NoteTimelineEvent]:
        return self.db.query(NoteTimelineEvent).filter(
            NoteTimelineEvent.user_id == user_id,
            NoteTimelineEvent.note_id == note_id,
            NoteTimelineEvent.event_type == event_type,
        ).order_by(NoteTimelineEvent.created_at.desc()).first()

    def create_timeline_event(
        self,
        user_id: int,
        workspace_id: Optional[int],
        note_id: int,
        values: dict[str, Any],
    ) -> NoteTimelineEvent:
        row = NoteTimelineEvent(user_id=user_id, workspace_id=workspace_id, note_id=note_id, **values)
        self.db.add(row)
        self.db.commit()
        self.db.refresh(row)
        return row

    def list_recordings(self, user_id: int, note_id: int) -> list[RecordingMetadata]:
        return self.db.query(RecordingMetadata).filter(
            RecordingMetadata.user_id == user_id,
            RecordingMetadata.note_id == note_id,
        ).order_by(RecordingMetadata.created_at.desc()).all()

    def create_recording(
        self,
        user_id: int,
        workspace_id: Optional[int],
        note_id: int,
        values: dict[str, Any],
    ) -> RecordingMetadata:
        row = RecordingMetadata(user_id=user_id, workspace_id=workspace_id, note_id=note_id, **values)
        self.db.add(row)
        self.db.commit()
        self.db.refresh(row)
        return row

    def create_book_link(
        self,
        user_id: int,
        workspace_id: Optional[int],
        book_id: int,
        note_id: int,
        source_file_id: int,
    ) -> BookNoteLink:
        row = self.db.query(BookNoteLink).filter(
            BookNoteLink.user_id == user_id,
            BookNoteLink.book_id == book_id,
            BookNoteLink.note_id == note_id,
        ).first()
        if row:
            return row
        row = BookNoteLink(
            user_id=user_id,
            workspace_id=workspace_id,
            book_id=book_id,
            note_id=note_id,
            source_file_id=source_file_id,
        )
        self.db.add(row)
        self.db.commit()
        self.db.refresh(row)
        return row

    def get_book_link(self, user_id: int, note_id: int, book_id: int) -> Optional[BookNoteLink]:
        return self.db.query(BookNoteLink).filter(
            BookNoteLink.user_id == user_id,
            BookNoteLink.note_id == note_id,
            BookNoteLink.book_id == book_id,
        ).first()

    def list_book_links(self, user_id: int, note_id: int) -> list[BookNoteLink]:
        return self.db.query(BookNoteLink).filter(
            BookNoteLink.user_id == user_id,
            BookNoteLink.note_id == note_id,
        ).order_by(BookNoteLink.created_at.asc()).all()
