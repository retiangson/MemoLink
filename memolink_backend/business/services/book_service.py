from __future__ import annotations

from typing import List, Optional

from memolink_backend.domain.repositories.book_repository import BookRepository
from memolink_backend.domain.repositories.user_book_repository import UserBookRepository
from memolink_backend.domain.models.book import Book
from memolink_backend.contracts.book_dtos import (
    BookResponseDTO,
    BookUpdateDTO,
    UserBookResponseDTO,
    BookmarkCreateDTO,
    BookmarkResponseDTO,
)


class BookAccessError(Exception):
    def __init__(self, status_code: int, detail: str):
        self.status_code = status_code
        self.detail = detail
        super().__init__(detail)


class BookService:
    def __init__(self, book_repo: BookRepository, user_book_repo: UserBookRepository):
        self._books = book_repo
        self._user_books = user_book_repo

    # ── Browse ───────────────────────────────────────────────────────────────

    def list_published(self, search: Optional[str] = None, category: Optional[str] = None, tag: Optional[str] = None) -> List[BookResponseDTO]:
        return [BookResponseDTO.model_validate(b) for b in self._books.list_published(search, category, tag)]

    def get_published_book(self, book_id: int) -> BookResponseDTO:
        book = self._require_published(book_id)
        return BookResponseDTO.model_validate(book)

    def _require_published(self, book_id: int) -> Book:
        book = self._books.get_by_id(book_id)
        if not book or not book.is_published:
            raise BookAccessError(404, "Book not found")
        return book

    def _require_borrowed_or_admin(self, user_id: int, book_id: int, is_admin: bool) -> Book:
        book = self._books.get_by_id(book_id)
        if not book:
            raise BookAccessError(404, "Book not found")
        if is_admin:
            return book
        if not book.is_published:
            raise BookAccessError(404, "Book not found")
        user_book = self._user_books.get(user_id, book_id)
        if not user_book or user_book.status == "removed":
            raise BookAccessError(403, "You must add this book to My Books before opening it")
        return book

    # ── My Books / borrowing ─────────────────────────────────────────────────

    def borrow(self, user_id: int, book_id: int) -> UserBookResponseDTO:
        self._require_published(book_id)
        row = self._user_books.borrow(user_id, book_id)
        return self._to_user_book_dto(row)

    def remove_from_my_books(self, user_id: int, book_id: int) -> bool:
        return self._user_books.remove(user_id, book_id)

    def list_my_books(self, user_id: int) -> List[UserBookResponseDTO]:
        rows = self._user_books.list_for_user(user_id)
        out = []
        for row in rows:
            book = self._books.get_by_id(row.book_id)
            out.append(self._to_user_book_dto(row, book))
        return out

    def _to_user_book_dto(self, row, book: Optional[Book] = None) -> UserBookResponseDTO:
        dto = UserBookResponseDTO.model_validate(row)
        if book:
            dto.book = BookResponseDTO.model_validate(book)
        return dto

    # ── Progress & bookmarks ─────────────────────────────────────────────────

    def update_progress(self, user_id: int, book_id: int, current_page: int, total_pages: Optional[int]) -> UserBookResponseDTO:
        row = self._user_books.update_progress(user_id, book_id, current_page, total_pages)
        if not row:
            raise BookAccessError(404, "Add this book to My Books before tracking progress")
        return self._to_user_book_dto(row)

    def add_bookmark(self, user_id: int, book_id: int, dto: BookmarkCreateDTO) -> BookmarkResponseDTO:
        self._require_borrowed_or_admin(user_id, book_id, is_admin=False)
        row = self._user_books.add_bookmark(user_id, book_id, dto.page_number, dto.note)
        return BookmarkResponseDTO.model_validate(row)

    def list_bookmarks(self, user_id: int, book_id: int) -> List[BookmarkResponseDTO]:
        return [BookmarkResponseDTO.model_validate(b) for b in self._user_books.list_bookmarks(user_id, book_id)]

    # ── Reading access (used before streaming the file) ─────────────────────

    def get_book_for_reading(self, user_id: int, book_id: int, is_admin: bool) -> Book:
        return self._require_borrowed_or_admin(user_id, book_id, is_admin)

    # ── Admin ────────────────────────────────────────────────────────────────

    def list_all_for_admin(self, search: Optional[str] = None, page: int = 1, page_size: int = 20) -> dict:
        total = self._books.count_all(search)
        items = [BookResponseDTO.model_validate(b) for b in self._books.list_all(search, page, page_size)]
        pages = max(1, (total + page_size - 1) // page_size)
        return {"items": items, "total": total, "page": page, "page_size": page_size, "pages": pages}

    def update_metadata(self, book_id: int, dto: BookUpdateDTO) -> BookResponseDTO:
        book = self._books.update_metadata(
            book_id,
            title=dto.title,
            author=dto.author,
            description=dto.description,
            category=dto.category,
            tags=dto.tags,
            cover_image_url=dto.cover_image_url,
        )
        if not book:
            raise BookAccessError(404, "Book not found")
        return BookResponseDTO.model_validate(book)

    def set_published(self, book_id: int, is_published: bool) -> BookResponseDTO:
        book = self._books.set_published(book_id, is_published)
        if not book:
            raise BookAccessError(404, "Book not found")
        return BookResponseDTO.model_validate(book)

    def publish_all(self) -> int:
        return self._books.set_published_all(True)

    def unpublish_all(self) -> int:
        return self._books.set_published_all(False)

    def publish_many(self, book_ids: List[int]) -> int:
        return self._books.set_published_many(book_ids, True)

    def unpublish_many(self, book_ids: List[int]) -> int:
        return self._books.set_published_many(book_ids, False)
