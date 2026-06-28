import html
import logging
from datetime import datetime, timezone
from typing import Optional

from memolink_backend.contracts.smart_source_dtos import (
    AnnotationCreateDTO,
    AnnotationResponseDTO,
    AnnotationUpdateDTO,
    RecordingMetadataCreateDTO,
    RecordingMetadataResponseDTO,
    SourceFileCreateDTO,
    SourceFileResponseDTO,
    SourceWorkspaceResponseDTO,
    SourceNoteAutosaveDTO,
    TimelineEventCreateDTO,
    TimelineEventResponseDTO,
)
from memolink_backend.contracts.note_dtos import NoteResponseDTO
from memolink_backend.domain.repositories.note_repository import NoteRepository
from memolink_backend.domain.repositories.smart_source_repository import SmartSourceRepository
from memolink_backend.business.services.embedding_service import EmbeddingService
from memolink_backend.business.services.onedrive_service import OneDriveService

NOTE_SOURCE_EXTENSIONS = {
    ".txt", ".md", ".html", ".htm", ".pdf", ".docx", ".pptx", ".zip",
    ".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".tiff",
    ".mp3", ".mp4", ".m4a", ".mp4a", ".wav", ".webm", ".ogg", ".flac",
    ".avi", ".mpeg", ".mov",
}
logger = logging.getLogger(__name__)


class SmartSourceError(Exception):
    def __init__(self, status_code: int, detail: str):
        self.status_code = status_code
        self.detail = detail
        super().__init__(detail)


class SmartSourceService:
    def __init__(self, repository: SmartSourceRepository, note_repository: NoteRepository, onedrive: OneDriveService, embeddings: EmbeddingService):
        self._repo = repository
        self._notes = note_repository
        self._onedrive = onedrive
        self._embeddings = embeddings

    def _owned_note(self, user_id: int, note_id: int):
        note = self._notes.get_by_id(note_id)
        if not note or note.user_id != user_id or note.deleted_at is not None:
            raise SmartSourceError(404, "Note not found")
        return note

    def _owned_source(self, user_id: int, source_file_id: int, note_id: Optional[int] = None):
        source = self._repo.get_source(source_file_id)
        if not source or source.user_id != user_id or (note_id is not None and source.note_id != note_id):
            raise SmartSourceError(404, "Source file not found")
        return source

    def _require_book_link(self, user_id: int, note_id: int, book_id: Optional[int]) -> None:
        if book_id is not None and not self._repo.get_book_link(user_id, note_id, book_id):
            raise SmartSourceError(404, "Linked book not found")

    def _refresh_search_embedding(self, note) -> None:
        """Embed editable note text plus current annotation comments without mutating either."""
        comments = [
            row.comment_text.strip()
            for row in self._repo.list_annotations(note.user_id, note.id)
            if row.comment_text and row.comment_text.strip()
        ]
        searchable_text = "\n\n".join([note.content, *comments])
        try:
            self._notes.save_embedding(note.id, self._embeddings.embed_text(searchable_text))
            self._repo.db.commit()
        except Exception:
            # Annotation persistence must not be undone by a transient embedding
            # provider failure. The next note/annotation change retries indexing.
            self._repo.db.rollback()

    def get_workspace(self, user_id: int, note_id: int) -> SourceWorkspaceResponseDTO:
        self._owned_note(user_id, note_id)
        return SourceWorkspaceResponseDTO(
            source_files=[SourceFileResponseDTO.model_validate(row) for row in self._repo.list_sources(user_id, note_id)],
            annotations=[AnnotationResponseDTO.model_validate(row) for row in self._repo.list_annotations(user_id, note_id)],
            timeline=[TimelineEventResponseDTO.model_validate(row) for row in self._repo.list_timeline(user_id, note_id)],
            recordings=[RecordingMetadataResponseDTO.model_validate(row) for row in self._repo.list_recordings(user_id, note_id)],
        )

    def get_source(self, user_id: int, source_file_id: int) -> SourceFileResponseDTO:
        return SourceFileResponseDTO.model_validate(self._owned_source(user_id, source_file_id))

    def autosave_note(self, user_id: int, note_id: int, dto: SourceNoteAutosaveDTO) -> NoteResponseDTO:
        note = self._owned_note(user_id, note_id)
        if not self._repo.list_sources(user_id, note_id):
            raise SmartSourceError(409, "Autosave is only enabled for source-linked notes")
        content_changed = note.content != dto.content
        updated = self._notes.update_note(note.id, title=dto.title, content=dto.content)
        if not updated:
            raise SmartSourceError(404, "Note not found")
        self._refresh_search_embedding(updated)
        if content_changed:
            latest = self._repo.latest_timeline_event(user_id, note_id, "edited")
            latest_at = latest.created_at if latest else None
            if latest_at is not None and latest_at.tzinfo is None:
                latest_at = latest_at.replace(tzinfo=timezone.utc)
            if latest_at is None or (datetime.now(timezone.utc) - latest_at).total_seconds() >= 300:
                self._repo.create_timeline_event(
                    user_id, updated.workspace_id, updated.id,
                    {
                        "event_type": "edited",
                        "event_summary": "Edited source-linked note",
                        "metadata_json": {"autosave": True},
                    },
                )
        return NoteResponseDTO.model_validate(updated)

    async def create_imported_note(
        self,
        *,
        user_id: int,
        workspace_id: Optional[int],
        file_name: str,
        mime_type: Optional[str],
        content: bytes,
        extracted_html: str,
        extraction_status: str = "ready",
    ) -> NoteResponseDTO:
        """Create a new source-backed note after preserving its original in OneDrive."""
        extension = "." + file_name.rsplit(".", 1)[-1].lower() if "." in file_name else ""
        if extension not in NOTE_SOURCE_EXTENSIONS:
            raise SmartSourceError(415, "This note source format is not supported")
        uploaded = await self._onedrive.upload_source_bytes(
            file_name=file_name,
            content=content,
            mime_type=mime_type,
        )
        note = None
        try:
            note = self._notes.create_note(
                user_id=user_id,
                title=file_name,
                content=extracted_html,
                source=file_name,
                workspace_id=workspace_id,
            )
            if extraction_status == "ready":
                try:
                    self._notes.save_embedding(note.id, self._embeddings.embed_text(extracted_html))
                except Exception as exc:
                    logger.warning("Failed to embed imported source note %s: %s", note.id, exc)
            self._repo.db.commit()
            self._repo.db.refresh(note)
            self.link_source(user_id, SourceFileCreateDTO(
                note_id=note.id,
                workspace_id=workspace_id,
                source_type="upload",
                original_filename=file_name,
                mime_type=uploaded.get("mime_type") or mime_type,
                file_size=uploaded.get("size") or len(content),
                onedrive_drive_id=uploaded["drive_id"],
                onedrive_item_id=uploaded["item_id"],
                onedrive_web_url=uploaded.get("web_url"),
                onedrive_etag=uploaded.get("etag"),
                extraction_status=extraction_status,
            ))
            return NoteResponseDTO.model_validate(note)
        except Exception:
            self._repo.db.rollback()
            if note and getattr(note, "id", None):
                try:
                    self._notes.permanent_delete_note(note.id)
                except Exception:
                    self._repo.db.rollback()
            try:
                await self._onedrive.delete_file(
                    drive_id=uploaded["drive_id"],
                    item_id=uploaded["item_id"],
                )
            except Exception:
                pass
            raise

    def link_source(self, user_id: int, dto: SourceFileCreateDTO) -> SourceFileResponseDTO:
        note = self._owned_note(user_id, dto.note_id)
        if dto.workspace_id is not None and dto.workspace_id != note.workspace_id:
            raise SmartSourceError(400, "Source workspace must match the note workspace")
        values = dto.model_dump()
        values["workspace_id"] = note.workspace_id
        row = self._repo.create_source(user_id, values)
        self._repo.create_timeline_event(
            user_id,
            note.workspace_id,
            note.id,
            {
                "source_file_id": row.id,
                "event_type": "linked",
                "event_summary": f"Linked original source {row.original_filename}",
                "metadata_json": {"source_type": row.source_type},
            },
        )
        return SourceFileResponseDTO.model_validate(row)

    async def extract_source(self, user_id: int, source_file_id: int) -> SourceFileResponseDTO:
        source = self._owned_source(user_id, source_file_id)
        note = self._owned_note(user_id, source.note_id)
        if source.extraction_status == "ready":
            return SourceFileResponseDTO.model_validate(source)
        extension = source.original_filename.lower().rsplit(".", 1)[-1] if "." in source.original_filename else ""
        if source.mime_type and (source.mime_type.startswith("audio/") or source.mime_type.startswith("video/")):
            raise SmartSourceError(400, "Audio/video transcription requires an explicit transcription request")
        if extension in {"mp3", "mp4", "m4a", "wav", "webm", "ogg", "flac", "avi"}:
            raise SmartSourceError(400, "Audio/video transcription requires an explicit transcription request")
        self._repo.set_extraction_status(source.id, "extracting")
        try:
            from memolink_backend.utils.file_extractor import extract_text_local
            content = await self._onedrive.download_file_bytes(
                drive_id=source.onedrive_drive_id,
                item_id=source.onedrive_item_id,
            )
            extracted = extract_text_local(content, source.original_filename).strip()
            if not extracted or (extracted.startswith("[") and "error]" in extracted.lower()):
                raise ValueError("No extractable text was found")
            extracted_html = "".join(f"<p>{html.escape(line)}</p>" for line in extracted.splitlines() if line.strip())
            next_content = f"{note.content}<hr><h2>Extracted from {html.escape(source.original_filename)}</h2>{extracted_html}" if note.content.strip() else extracted_html
            self._notes.update_note(note.id, title=None, content=next_content)
            note.content = next_content
            self._refresh_search_embedding(note)
            row = self._repo.set_extraction_status(source.id, "ready")
            self._repo.create_timeline_event(
                user_id, note.workspace_id, note.id,
                {"source_file_id": source.id, "event_type": "extracted", "event_summary": f"Extracted text from {source.original_filename}", "metadata_json": None},
            )
            return SourceFileResponseDTO.model_validate(row)
        except Exception as exc:
            self._repo.set_extraction_status(source.id, "failed")
            if isinstance(exc, SmartSourceError):
                raise
            raise SmartSourceError(422, str(exc)[:300] or "Source extraction failed") from exc

    def update_cache_status(self, user_id: int, source_file_id: int, cache_status: str) -> SourceFileResponseDTO:
        source = self._owned_source(user_id, source_file_id)
        if cache_status not in {"unknown", "missing", "cached", "stale", "downloading", "error"}:
            raise SmartSourceError(400, "Invalid cache status")
        row = self._repo.mark_source_cache(source.id, cache_status)
        if cache_status == "cached":
            note = self._owned_note(user_id, source.note_id)
            self._repo.create_timeline_event(
                user_id, note.workspace_id, note.id,
                {"source_file_id": source.id, "event_type": "cached", "event_summary": "Cached source on this device", "metadata_json": None},
            )
        return SourceFileResponseDTO.model_validate(row)

    def list_annotations(self, user_id: int, note_id: int, source_file_id: Optional[int]) -> list[AnnotationResponseDTO]:
        self._owned_note(user_id, note_id)
        if source_file_id is not None:
            self._owned_source(user_id, source_file_id, note_id)
        return [AnnotationResponseDTO.model_validate(row) for row in self._repo.list_annotations(user_id, note_id, source_file_id)]

    def create_annotation(self, user_id: int, dto: AnnotationCreateDTO) -> AnnotationResponseDTO:
        note = self._owned_note(user_id, dto.note_id)
        if dto.source_file_id is not None:
            self._owned_source(user_id, dto.source_file_id, dto.note_id)
        self._require_book_link(user_id, dto.note_id, dto.book_id)
        row = self._repo.create_annotation(user_id, note.workspace_id, dto.model_dump())
        if dto.comment_text and dto.comment_text.strip():
            self._refresh_search_embedding(note)
        event_type = {
            "pen": "drawing_added",
            "handwriting": "drawing_added",
            "highlighter": "highlighted",
            "comment": "comment_added",
        }.get(dto.annotation_type, "annotation_added")
        should_add_timeline = True
        if dto.annotation_type in {"pen", "handwriting", "highlighter"}:
            latest = self._repo.latest_timeline_event(user_id, note.id, event_type)
            latest_at = latest.created_at if latest else None
            if latest_at is not None and latest_at.tzinfo is None:
                latest_at = latest_at.replace(tzinfo=timezone.utc)
            should_add_timeline = latest_at is None or (datetime.now(timezone.utc) - latest_at).total_seconds() >= 60
        if should_add_timeline:
            self._repo.create_timeline_event(
                user_id, note.workspace_id, note.id,
                {
                    "source_file_id": dto.source_file_id,
                    "book_id": dto.book_id,
                    "event_type": event_type,
                    "event_summary": f"Added {dto.annotation_type} annotation",
                    "metadata_json": {"annotation_id": row.id, "page_number": dto.page_number},
                },
            )
        return AnnotationResponseDTO.model_validate(row)

    def update_annotation(self, user_id: int, annotation_id: int, dto: AnnotationUpdateDTO) -> AnnotationResponseDTO:
        row = self._repo.get_annotation(annotation_id)
        if not row or row.user_id != user_id:
            raise SmartSourceError(404, "Annotation not found")
        note = self._owned_note(user_id, row.note_id)
        values = dto.model_dump(exclude_unset=True)
        if row.annotation_type in {"pen", "highlighter", "handwriting"} and values.get("strokes_json", row.strokes_json) is None:
            raise SmartSourceError(400, "Stroke annotations require editable stroke data")
        if row.annotation_type == "comment" and "comment_text" in values and not (values["comment_text"] or "").strip():
            raise SmartSourceError(400, "Comment annotations require text")
        updated = self._repo.update_annotation(row, values)
        if "comment_text" in dto.model_fields_set:
            self._refresh_search_embedding(note)
        self._repo.create_timeline_event(
            user_id, note.workspace_id, note.id,
            {
                "source_file_id": row.source_file_id,
                "book_id": row.book_id,
                "event_type": "annotation_updated",
                "event_summary": f"Updated {row.annotation_type} annotation",
                "metadata_json": {"annotation_id": row.id, "page_number": updated.page_number},
            },
        )
        return AnnotationResponseDTO.model_validate(updated)

    def delete_annotation(self, user_id: int, annotation_id: int) -> None:
        row = self._repo.get_annotation(annotation_id)
        if not row or row.user_id != user_id:
            raise SmartSourceError(404, "Annotation not found")
        note = self._owned_note(user_id, row.note_id)
        had_searchable_comment = bool(row.comment_text and row.comment_text.strip())
        self._repo.delete_annotation(row)
        if had_searchable_comment:
            self._refresh_search_embedding(note)
        self._repo.create_timeline_event(
            user_id, note.workspace_id, note.id,
            {
                "source_file_id": row.source_file_id,
                "book_id": row.book_id,
                "event_type": "annotation_deleted",
                "event_summary": f"Deleted {row.annotation_type} annotation",
                "metadata_json": {"annotation_id": row.id, "page_number": row.page_number},
            },
        )

    def add_timeline_event(self, user_id: int, note_id: int, dto: TimelineEventCreateDTO) -> TimelineEventResponseDTO:
        note = self._owned_note(user_id, note_id)
        if dto.source_file_id is not None:
            self._owned_source(user_id, dto.source_file_id, note_id)
        self._require_book_link(user_id, note_id, dto.book_id)
        row = self._repo.create_timeline_event(user_id, note.workspace_id, note_id, dto.model_dump())
        return TimelineEventResponseDTO.model_validate(row)

    def add_recording(self, user_id: int, note_id: int, dto: RecordingMetadataCreateDTO) -> RecordingMetadataResponseDTO:
        note = self._owned_note(user_id, note_id)
        if not dto.local_only:
            raise SmartSourceError(400, "Recording binaries are local-only; only metadata can be stored")
        row = self._repo.create_recording(user_id, note.workspace_id, note_id, dto.model_dump())
        self._repo.create_timeline_event(
            user_id, note.workspace_id, note_id,
            {
                "event_type": "recording_saved",
                "event_summary": f"Saved local recording {dto.file_name}",
                "metadata_json": {"recording_metadata_id": row.id, "duration_seconds": dto.duration_seconds, "local_only": True},
            },
        )
        return RecordingMetadataResponseDTO.model_validate(row)
