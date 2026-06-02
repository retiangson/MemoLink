from typing import Optional
from sqlalchemy.orm import Session
from memolink_backend.domain.models.note_timeline import NoteTimeline


class TimelineRepository:
    def __init__(self, db: Session):
        self._db = db

    def get_by_note(self, note_id: int) -> Optional[NoteTimeline]:
        return self._db.query(NoteTimeline).filter(NoteTimeline.note_id == note_id).first()

    def upsert(
        self,
        note_id: int,
        user_id: int,
        summary: str,
        chapters: list,
        action_items: list,
        important_moments: list,
        estimated_duration_seconds: Optional[int],
        word_count: Optional[int],
    ) -> NoteTimeline:
        existing = self.get_by_note(note_id)
        if existing:
            existing.summary                    = summary
            existing.chapters                   = chapters
            existing.action_items               = action_items
            existing.important_moments          = important_moments
            existing.estimated_duration_seconds = estimated_duration_seconds
            existing.word_count                 = word_count
        else:
            existing = NoteTimeline(
                note_id=note_id,
                user_id=user_id,
                summary=summary,
                chapters=chapters,
                action_items=action_items,
                important_moments=important_moments,
                estimated_duration_seconds=estimated_duration_seconds,
                word_count=word_count,
            )
            self._db.add(existing)
        self._db.commit()
        self._db.refresh(existing)
        return existing
