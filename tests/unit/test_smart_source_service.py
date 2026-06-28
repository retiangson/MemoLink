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
