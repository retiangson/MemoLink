from datetime import datetime
import json
from typing import Any, Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

ANNOTATION_TYPES = {"pen", "handwriting", "highlighter", "text", "comment", "shape"}
TIMELINE_EVENT_TYPES = {
    "uploaded", "linked", "cached", "extracted", "edited", "annotation_added",
    "annotation_updated", "annotation_deleted", "transcribed", "rag_used",
    "drawing_added", "highlighted", "comment_added", "reminder_generated",
    "exported", "recording_saved", "book_linked",
}


def _validate_annotation_json(payload: dict[str, Any]) -> None:
    encoded = json.dumps(payload, separators=(",", ":"))
    if len(encoded.encode("utf-8")) > 2 * 1024 * 1024:
        raise ValueError("Annotation payload exceeds 2 MB")
    lowered = encoded.lower()
    if ";base64," in lowered or "data:application/" in lowered or "data:image/" in lowered:
        raise ValueError("Binary/base64 annotation payloads are not allowed")


class SourceFileCreateDTO(BaseModel):
    note_id: int
    workspace_id: Optional[int] = None
    source_type: str = Field(max_length=40)
    original_filename: str = Field(min_length=1, max_length=500)
    mime_type: Optional[str] = Field(default=None, max_length=200)
    file_size: Optional[int] = Field(default=None, ge=0)
    onedrive_drive_id: str = Field(min_length=1, max_length=255)
    onedrive_item_id: str = Field(min_length=1, max_length=500)
    onedrive_web_url: Optional[str] = Field(default=None, max_length=2000)
    onedrive_etag: Optional[str] = Field(default=None, max_length=500)
    extraction_status: str = Field(default="pending", max_length=30)


class SourceFileResponseDTO(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    user_id: int
    workspace_id: Optional[int]
    note_id: int
    source_type: str
    original_filename: str
    mime_type: Optional[str]
    file_size: Optional[int]
    onedrive_drive_id: str
    onedrive_item_id: str
    onedrive_web_url: Optional[str]
    onedrive_etag: Optional[str]
    extraction_status: str
    cache_status: str
    last_synced_at: Optional[datetime]
    created_at: Optional[datetime]
    updated_at: Optional[datetime]


class StrokePointDTO(BaseModel):
    x: float = Field(ge=0, le=1)
    y: float = Field(ge=0, le=1)
    pressure: Optional[float] = Field(default=None, ge=0, le=1)
    tiltX: Optional[float] = Field(default=None, ge=-90, le=90)
    tiltY: Optional[float] = Field(default=None, ge=-90, le=90)
    time: int = Field(ge=0)


class StrokePayloadDTO(BaseModel):
    version: int = Field(default=1, ge=1, le=1)
    pointerType: str = Field(max_length=20)
    points: list[StrokePointDTO] = Field(min_length=2, max_length=20000)


class AnnotationCreateDTO(BaseModel):
    note_id: int
    source_file_id: Optional[int] = None
    book_id: Optional[int] = None
    page_number: Optional[int] = Field(default=None, ge=1)
    location_anchor: Optional[dict[str, Any]] = None
    annotation_type: str = Field(max_length=40)
    strokes_json: Optional[StrokePayloadDTO] = None
    highlight_data: Optional[dict[str, Any]] = None
    comment_text: Optional[str] = Field(default=None, max_length=10000)
    color: Optional[str] = Field(default=None, max_length=40)
    pen_size: Optional[float] = Field(default=None, gt=0, le=100)
    tool_type: Optional[str] = Field(default=None, max_length=40)

    @model_validator(mode="after")
    def validate_payload(self):
        if self.annotation_type not in ANNOTATION_TYPES:
            raise ValueError("Unsupported annotation type")
        if self.annotation_type in {"pen", "highlighter", "handwriting"} and not self.strokes_json:
            raise ValueError("Stroke annotations require editable stroke data")
        if self.annotation_type == "comment" and not (self.comment_text or "").strip():
            raise ValueError("Comment annotations require text")
        _validate_annotation_json(self.model_dump(mode="json"))
        return self


class AnnotationUpdateDTO(BaseModel):
    page_number: Optional[int] = Field(default=None, ge=1)
    location_anchor: Optional[dict[str, Any]] = None
    strokes_json: Optional[StrokePayloadDTO] = None
    highlight_data: Optional[dict[str, Any]] = None
    comment_text: Optional[str] = Field(default=None, max_length=10000)
    color: Optional[str] = Field(default=None, max_length=40)
    pen_size: Optional[float] = Field(default=None, gt=0, le=100)
    tool_type: Optional[str] = Field(default=None, max_length=40)

    @model_validator(mode="after")
    def validate_payload(self):
        _validate_annotation_json(self.model_dump(mode="json", exclude_unset=True))
        return self


class AnnotationResponseDTO(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    user_id: int
    workspace_id: Optional[int]
    note_id: int
    source_file_id: Optional[int]
    book_id: Optional[int]
    page_number: Optional[int]
    location_anchor: Optional[dict[str, Any]]
    annotation_type: str
    strokes_json: Optional[StrokePayloadDTO]
    highlight_data: Optional[dict[str, Any]]
    comment_text: Optional[str]
    color: Optional[str]
    pen_size: Optional[float]
    tool_type: Optional[str]
    created_at: Optional[datetime]
    updated_at: Optional[datetime]


class TimelineEventCreateDTO(BaseModel):
    source_file_id: Optional[int] = None
    book_id: Optional[int] = None
    event_type: str = Field(max_length=50)
    event_summary: str = Field(min_length=1, max_length=500)
    metadata_json: Optional[dict[str, Any]] = None

    @model_validator(mode="after")
    def validate_event(self):
        if self.event_type not in TIMELINE_EVENT_TYPES:
            raise ValueError("Unsupported timeline event type")
        if self.metadata_json:
            _validate_annotation_json(self.metadata_json)
        return self


class TimelineEventResponseDTO(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    note_id: int
    source_file_id: Optional[int]
    book_id: Optional[int]
    event_type: str
    event_summary: str
    metadata_json: Optional[dict[str, Any]]
    created_at: Optional[datetime]


class RecordingMetadataCreateDTO(BaseModel):
    file_name: str = Field(min_length=1, max_length=500)
    duration_seconds: float = Field(ge=0)
    local_only: bool = True

    @field_validator("file_name")
    @classmethod
    def validate_file_name(cls, value: str) -> str:
        if "/" in value or "\\" in value or value in {".", ".."}:
            raise ValueError("Recording metadata must contain a file name, not a local path")
        return value


class RecordingMetadataResponseDTO(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    note_id: int
    file_name: str
    duration_seconds: float
    local_only: bool
    transcript_status: str
    transcript_note_id: Optional[int]
    created_at: Optional[datetime]


class SourceWorkspaceResponseDTO(BaseModel):
    source_files: list[SourceFileResponseDTO]
    annotations: list[AnnotationResponseDTO]
    timeline: list[TimelineEventResponseDTO]
    recordings: list[RecordingMetadataResponseDTO]


class SourceNoteAutosaveDTO(BaseModel):
    title: str = Field(max_length=255)
    content: str
