import hashlib
from datetime import datetime, timezone
from typing import Optional
from sqlalchemy.orm import Session
from memolink_backend.domain.models.translation_cache import TranslationCache


def _make_hash(source_text: str, target_language: str) -> str:
    key = f"{source_text.strip()}::{target_language.strip().lower()}"
    return hashlib.sha256(key.encode()).hexdigest()


class TranslationCacheRepository:
    def __init__(self, db: Session):
        self._db = db

    def find(self, source_text: str, target_language: str) -> Optional[TranslationCache]:
        h = _make_hash(source_text, target_language)
        return self._db.query(TranslationCache).filter(TranslationCache.text_hash == h).first()

    def upsert(
        self,
        source_text: str,
        target_language: str,
        translation: str,
        accuracy: Optional[int],
        model: str,
    ) -> TranslationCache:
        h = _make_hash(source_text, target_language)
        entry = self._db.query(TranslationCache).filter(TranslationCache.text_hash == h).first()
        now = datetime.now(timezone.utc)
        if entry:
            entry.translation = translation
            entry.accuracy = accuracy
            entry.model = model
            entry.updated_at = now
        else:
            entry = TranslationCache(
                text_hash=h,
                source_text=source_text,
                target_language=target_language,
                translation=translation,
                accuracy=accuracy,
                model=model,
                hit_count=0,
                created_at=now,
                updated_at=now,
            )
            self._db.add(entry)
        self._db.commit()
        self._db.refresh(entry)
        return entry

    def increment_hits(self, entry_id: int) -> None:
        self._db.query(TranslationCache).filter(TranslationCache.id == entry_id).update(
            {"hit_count": TranslationCache.hit_count + 1}
        )
        self._db.commit()
