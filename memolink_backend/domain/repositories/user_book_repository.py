from datetime import datetime, timezone
from typing import List, Optional
from sqlalchemy.orm import Session
from memolink_backend.domain.models.user_book import UserBook
from memolink_backend.domain.models.book_bookmark import BookBookmark
from memolink_backend.domain.models.book_note_source import BookNoteSource, BookNoteChunk
from memolink_backend.domain.models.book_highlight import BookHighlight


class UserBookRepository:
    def __init__(self, db: Session):
        self.db = db

    # ── UserBook (borrow / progress) ─────────────────────────────────────────

    def get(self, user_id: int, book_id: int) -> Optional[UserBook]:
        return (
            self.db.query(UserBook)
            .filter(UserBook.user_id == user_id, UserBook.book_id == book_id)
            .first()
        )

    def list_for_user(self, user_id: int) -> List[UserBook]:
        return (
            self.db.query(UserBook)
            .filter(UserBook.user_id == user_id, UserBook.status != "removed")
            .order_by(UserBook.last_read_at.desc().nullslast(), UserBook.borrowed_at.desc())
            .all()
        )

    def borrow(self, user_id: int, book_id: int) -> UserBook:
        row = self.get(user_id, book_id)
        if row:
            if row.status == "removed":
                row.status = "borrowed"
            return row
        row = UserBook(user_id=user_id, book_id=book_id, status="borrowed")
        self.db.add(row)
        self.db.commit()
        self.db.refresh(row)
        return row

    def remove(self, user_id: int, book_id: int) -> bool:
        row = self.get(user_id, book_id)
        if not row:
            return False
        row.status = "removed"
        self.db.commit()
        return True

    def update_progress(
        self, user_id: int, book_id: int, current_page: int, total_pages: Optional[int]
    ) -> Optional[UserBook]:
        row = self.get(user_id, book_id)
        if not row:
            return None
        row.current_page = current_page
        if total_pages is not None:
            row.total_pages = total_pages
        if row.total_pages:
            row.progress_percent = min(100.0, round((current_page / row.total_pages) * 100, 2))
            if current_page >= row.total_pages and not row.completed_at:
                row.completed_at = datetime.now(timezone.utc)
                row.status = "completed"
            elif row.status == "borrowed":
                row.status = "reading"
        row.last_read_at = datetime.now(timezone.utc)
        self.db.commit()
        self.db.refresh(row)
        return row

    # ── Bookmarks ─────────────────────────────────────────────────────────────

    def add_bookmark(self, user_id: int, book_id: int, page_number: int, note: Optional[str]) -> BookBookmark:
        row = BookBookmark(user_id=user_id, book_id=book_id, page_number=page_number, note=note)
        self.db.add(row)
        self.db.commit()
        self.db.refresh(row)
        return row

    def list_bookmarks(self, user_id: int, book_id: int) -> List[BookBookmark]:
        return (
            self.db.query(BookBookmark)
            .filter(BookBookmark.user_id == user_id, BookBookmark.book_id == book_id)
            .order_by(BookBookmark.page_number.asc())
            .all()
        )

    def delete_bookmark(self, user_id: int, bookmark_id: int) -> bool:
        deleted = (
            self.db.query(BookBookmark)
            .filter(BookBookmark.id == bookmark_id, BookBookmark.user_id == user_id)
            .delete()
        )
        self.db.commit()
        return deleted > 0

    # ── Highlights ────────────────────────────────────────────────────────────

    def add_highlight(
        self,
        user_id: int,
        book_id: int,
        note_id: int,
        format: str,
        page_number: int,
        start_offset: int,
        end_offset: int,
        snippet: str,
        color: str = "yellow",
    ) -> BookHighlight:
        row = BookHighlight(
            user_id=user_id,
            book_id=book_id,
            note_id=note_id,
            format=format,
            page_number=page_number,
            start_offset=start_offset,
            end_offset=end_offset,
            snippet=snippet,
            color=color,
        )
        self.db.add(row)
        self.db.commit()
        self.db.refresh(row)
        return row

    def get_highlight(self, highlight_id: int) -> Optional[BookHighlight]:
        return self.db.query(BookHighlight).filter(BookHighlight.id == highlight_id).first()

    def list_highlights(self, user_id: int, book_id: int) -> List[BookHighlight]:
        return (
            self.db.query(BookHighlight)
            .filter(BookHighlight.user_id == user_id, BookHighlight.book_id == book_id)
            .order_by(BookHighlight.page_number.asc(), BookHighlight.start_offset.asc())
            .all()
        )

    # ── Note source (Save as Note Source) ───────────────────────────────────

    def get_note_source(self, user_id: int, book_id: int) -> Optional[BookNoteSource]:
        return (
            self.db.query(BookNoteSource)
            .filter(BookNoteSource.user_id == user_id, BookNoteSource.book_id == book_id)
            .first()
        )

    def get_or_create_note_source(self, user_id: int, book_id: int) -> BookNoteSource:
        row = self.get_note_source(user_id, book_id)
        if row:
            return row
        row = BookNoteSource(user_id=user_id, book_id=book_id, status="pending")
        self.db.add(row)
        self.db.commit()
        self.db.refresh(row)
        return row

    def set_note_source_status(self, source_id: int, status: str, error_message: Optional[str] = None) -> None:
        row = self.db.query(BookNoteSource).filter(BookNoteSource.id == source_id).first()
        if not row:
            return
        row.status = status
        row.error_message = error_message
        self.db.commit()

    def claim_pending_note_source(self, source_id: int) -> bool:
        updated = (
            self.db.query(BookNoteSource)
            .filter(BookNoteSource.id == source_id, BookNoteSource.status == "pending")
            .update(
                {
                    BookNoteSource.status: "processing",
                    BookNoteSource.error_message: None,
                    BookNoteSource.updated_at: datetime.now(timezone.utc),
                },
                synchronize_session=False,
            )
        )
        self.db.commit()
        return updated == 1

    def add_note_chunk(self, book_note_source_id: int, note_id: int, book_id: int, page_number: Optional[int]) -> BookNoteChunk:
        row = BookNoteChunk(
            book_note_source_id=book_note_source_id,
            note_id=note_id,
            book_id=book_id,
            page_number=page_number,
        )
        self.db.add(row)
        self.db.commit()
        return row

    def list_note_ids_for_source(self, book_note_source_id: int) -> list[int]:
        rows = (
            self.db.query(BookNoteChunk.note_id)
            .filter(BookNoteChunk.book_note_source_id == book_note_source_id)
            .all()
        )
        return [r[0] for r in rows]

    def clear_note_chunks(self, book_note_source_id: int) -> None:
        self.db.query(BookNoteChunk).filter(BookNoteChunk.book_note_source_id == book_note_source_id).delete()
        self.db.commit()
