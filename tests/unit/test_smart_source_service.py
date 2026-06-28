from types import SimpleNamespace

import pytest
from pydantic import ValidationError

from memolink_backend.business.services.smart_source_service import SmartSourceError, SmartSourceService
from memolink_backend.contracts.smart_source_dtos import (
    AnnotationCreateDTO,
    RecordingMetadataCreateDTO,
    TimelineEventCreateDTO,
)


class FakeNotes:
    def __init__(self, note):
        self.note = note

    def get_by_id(self, note_id):
        return self.note if self.note and self.note.id == note_id else None


class FakeSmartSources:
    def __init__(self):
        self.recording_values = None
        self.timeline_values = None
        self.db = SimpleNamespace(commit=lambda: None, rollback=lambda: None, refresh=lambda row: None)

    def create_recording(self, user_id, workspace_id, note_id, values):
        self.recording_values = values
        return SimpleNamespace(
            id=1, note_id=note_id, file_name=values["file_name"],
            duration_seconds=values["duration_seconds"], local_only=values["local_only"],
            transcript_status="not_requested", transcript_note_id=None, created_at=None,
        )

    def create_timeline_event(self, user_id, workspace_id, note_id, values):
        self.timeline_values = values
        return SimpleNamespace(id=1, note_id=note_id, created_at=None, **values)

    def list_sources(self, user_id, note_id):
        return []


class FakeAutosaveNotes(FakeNotes):
    def update_note(self, note_id, title, content):
        self.note.title = title
        self.note.content = content
        return self.note

    def save_embedding(self, note_id, vector):
        return None


class FakeEmbeddings:
    def embed_text(self, content):
        return [0.1]


class FakeSourceWorkspace(FakeSmartSources):
    def list_sources(self, user_id, note_id):
        return [SimpleNamespace(id=1)]

    def list_annotations(self, user_id, note_id, source_file_id=None):
        return []

    def latest_timeline_event(self, user_id, note_id, event_type):
        return None


def service_for(note):
    repository = FakeSmartSources()
    return SmartSourceService(repository, FakeNotes(note), onedrive=None, embeddings=None), repository


def test_recording_metadata_rejects_non_local_binary_semantics():
    service, repository = service_for(SimpleNamespace(id=7, user_id=4, workspace_id=2, deleted_at=None))

    with pytest.raises(SmartSourceError, match="local-only"):
        service.add_recording(4, 7, RecordingMetadataCreateDTO(
            file_name="recording.webm", duration_seconds=3, local_only=False,
        ))

    assert repository.recording_values is None


def test_recording_metadata_enforces_note_ownership():
    service, _ = service_for(SimpleNamespace(id=7, user_id=99, workspace_id=None, deleted_at=None))

    with pytest.raises(SmartSourceError, match="Note not found"):
        service.add_recording(4, 7, RecordingMetadataCreateDTO(
            file_name="recording.webm", duration_seconds=3, local_only=True,
        ))


def test_stroke_annotation_requires_editable_stroke_payload():
    with pytest.raises(ValidationError, match="editable stroke data"):
        AnnotationCreateDTO(note_id=1, annotation_type="pen")


def test_stroke_annotation_rejects_out_of_bounds_coordinates():
    with pytest.raises(ValidationError):
        AnnotationCreateDTO(
            note_id=1,
            annotation_type="pen",
            strokes_json={
                "version": 1,
                "pointerType": "pen",
                "points": [
                    {"x": -0.1, "y": 0.5, "time": 1},
                    {"x": 0.2, "y": 0.5, "time": 2},
                ],
            },
        )


def test_annotation_rejects_embedded_base64_data():
    with pytest.raises(ValidationError, match="Binary/base64"):
        AnnotationCreateDTO(
            note_id=1,
            annotation_type="text",
            location_anchor={"preview": "data:image/png;base64,AAAA"},
        )


def test_recording_metadata_rejects_local_path():
    with pytest.raises(ValidationError, match="local path"):
        RecordingMetadataCreateDTO(
            file_name=r"C:\\Users\\person\\recording.webm",
            duration_seconds=2,
        )


def test_timeline_metadata_rejects_binary_payload():
    with pytest.raises(ValidationError, match="Binary/base64"):
        TimelineEventCreateDTO(
            event_type="exported",
            event_summary="Exported note",
            metadata_json={"file": "data:application/pdf;base64,AAAA"},
        )


def test_autosave_rejects_normal_note_without_source_workspace():
    note = SimpleNamespace(id=7, user_id=4, workspace_id=2, deleted_at=None, title="Old", content="Body")
    repository = FakeSmartSources()
    service = SmartSourceService(repository, FakeAutosaveNotes(note), onedrive=None, embeddings=FakeEmbeddings())

    from memolink_backend.contracts.smart_source_dtos import SourceNoteAutosaveDTO
    with pytest.raises(SmartSourceError, match="only enabled"):
        service.autosave_note(4, 7, SourceNoteAutosaveDTO(title="Old", content="Changed"))


def test_autosave_updates_only_source_linked_note_and_records_timeline():
    note = SimpleNamespace(
        id=7, user_id=4, workspace_id=2, deleted_at=None,
        title="Source", content="Body", source="upload.pdf", public_agent_enabled=False,
    )
    repository = FakeSourceWorkspace()
    service = SmartSourceService(repository, FakeAutosaveNotes(note), onedrive=None, embeddings=FakeEmbeddings())

    from memolink_backend.contracts.smart_source_dtos import SourceNoteAutosaveDTO
    result = service.autosave_note(4, 7, SourceNoteAutosaveDTO(title="Source", content="Changed"))

    assert result.content == "Changed"
    assert repository.timeline_values["event_type"] == "edited"
