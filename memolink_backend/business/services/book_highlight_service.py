from __future__ import annotations

import html
from typing import List

from memolink_backend.domain.repositories.book_repository import BookRepository
from memolink_backend.domain.repositories.user_book_repository import UserBookRepository
from memolink_backend.domain.repositories.note_repository import NoteRepository
from memolink_backend.contracts.book_dtos import BookHighlightCreateDTO, BookHighlightResponseDTO


class BookHighlightError(Exception):
    def __init__(self, status_code: int, detail: str):
        self.status_code = status_code
        self.detail = detail
        super().__init__(detail)


class BookHighlightService:
    """Captures a reader text selection as a highlight, and mirrors it into a
    per-book '{Book Title} - Highlights' Note (created on first highlight, appended
    to on every subsequent one) so highlights are browsable/searchable like any
    other note."""

    def __init__(self, book_repo: BookRepository, user_book_repo: UserBookRepository, note_repo: NoteRepository):
        self._books = book_repo
        self._user_books = user_book_repo
        self._notes = note_repo

    def add_highlight(self, user_id: int, book_id: int, dto: BookHighlightCreateDTO) -> BookHighlightResponseDTO:
        book = self._books.get_by_id(book_id)
        if not book:
            raise BookHighlightError(404, "Book not found")

        source = f"book-highlights:{book_id}"
        note = self._notes.get_by_source_for_user(user_id, source)
        if not note:
            note = self._notes.create_note(
                user_id=user_id,
                title=f"{book.title} - Highlights",
                content="",
                source=source,
                workspace_id=None,
            )

        row = self._user_books.add_highlight(
            user_id=user_id,
            book_id=book_id,
            note_id=note.id,
            format=dto.format,
            page_number=dto.page_number,
            start_offset=dto.start_offset,
            end_offset=dto.end_offset,
            snippet=dto.snippet,
            color=dto.color,
        )

        fragment = (
            f'<blockquote data-hl-id="{row.id}">'
            f"{html.escape(dto.snippet)}<br>"
            f"<em>— {html.escape(book.title)}, page {dto.page_number}</em>"
            f"</blockquote>"
        )
        self._notes.update_note(note.id, title=None, content=(note.content or "") + fragment)

        return BookHighlightResponseDTO.model_validate(row)

    def get_highlight(self, user_id: int, highlight_id: int) -> BookHighlightResponseDTO:
        row = self._user_books.get_highlight(highlight_id)
        if not row or row.user_id != user_id:
            raise BookHighlightError(404, "Highlight not found")
        return BookHighlightResponseDTO.model_validate(row)

    def list_highlights(self, user_id: int, book_id: int) -> List[BookHighlightResponseDTO]:
        rows = self._user_books.list_highlights(user_id, book_id)
        return [BookHighlightResponseDTO.model_validate(row) for row in rows]
