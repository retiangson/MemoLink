from datetime import datetime
from typing import List, Optional
from sqlalchemy.orm import Session
from sqlalchemy import or_
from memolink_backend.domain.models.book import Book


class BookRepository:
    def __init__(self, db: Session):
        self.db = db

    def get_by_id(self, book_id: int) -> Optional[Book]:
        return self.db.query(Book).filter(Book.id == book_id).first()

    def get_by_onedrive_item_id(self, onedrive_item_id: str) -> Optional[Book]:
        return self.db.query(Book).filter(Book.onedrive_item_id == onedrive_item_id).first()

    def get_by_onedrive_item_ids(self, onedrive_item_ids: list[str]) -> dict[str, Book]:
        if not onedrive_item_ids:
            return {}
        rows = self.db.query(Book).filter(Book.onedrive_item_id.in_(onedrive_item_ids)).all()
        return {b.onedrive_item_id: b for b in rows}

    def list_all(self, search: Optional[str] = None, page: int = 1, page_size: int = 20) -> List[Book]:
        q = self._filter_search(self.db.query(Book), search)
        offset = (page - 1) * page_size
        return q.order_by(Book.id.desc()).offset(offset).limit(page_size).all()

    def count_all(self, search: Optional[str] = None) -> int:
        return self._filter_search(self.db.query(Book), search).count()

    def _filter_search(self, q, search: Optional[str]):
        if search:
            like = f"%{search}%"
            q = q.filter(or_(Book.title.ilike(like), Book.author.ilike(like)))
        return q

    def list_published(
        self,
        search: Optional[str] = None,
        category: Optional[str] = None,
        tag: Optional[str] = None,
    ) -> List[Book]:
        q = self.db.query(Book).filter(Book.is_published == True)
        if search:
            like = f"%{search}%"
            q = q.filter(or_(Book.title.ilike(like), Book.author.ilike(like)))
        if category:
            q = q.filter(Book.category == category)
        if tag:
            q = q.filter(Book.tags.ilike(f"%{tag}%"))
        return q.order_by(Book.title.asc()).all()

    def upsert_from_sync(
        self,
        *,
        onedrive_drive_id: str,
        onedrive_item_id: str,
        file_name: str,
        file_extension: Optional[str],
        mime_type: Optional[str],
        file_size: Optional[int],
        onedrive_web_url: Optional[str],
        last_modified: Optional[datetime],
        created_by_admin_id: int,
        default_title: str,
        existing: Optional[Book] = None,
        commit: bool = True,
    ) -> Book:
        book = existing if existing is not None else self.get_by_onedrive_item_id(onedrive_item_id)
        if book:
            book.onedrive_drive_id = onedrive_drive_id
            book.file_name = file_name
            book.file_extension = file_extension
            book.mime_type = mime_type
            book.file_size = file_size
            book.onedrive_web_url = onedrive_web_url
            book.last_modified = last_modified
            book.sync_status = "synced"
            book.sync_error = None
        else:
            book = Book(
                title=default_title,
                file_name=file_name,
                file_extension=file_extension,
                mime_type=mime_type,
                file_size=file_size,
                onedrive_drive_id=onedrive_drive_id,
                onedrive_item_id=onedrive_item_id,
                onedrive_web_url=onedrive_web_url,
                last_modified=last_modified,
                created_by_admin_id=created_by_admin_id,
                sync_status="synced",
                is_published=True,
            )
            self.db.add(book)
        if commit:
            self.db.commit()
            self.db.refresh(book)
        else:
            self.db.flush()
        return book

    def update_metadata(
        self,
        book_id: int,
        *,
        title: Optional[str] = None,
        author: Optional[str] = None,
        description: Optional[str] = None,
        category: Optional[str] = None,
        tags: Optional[str] = None,
        cover_image_url: Optional[str] = None,
    ) -> Optional[Book]:
        book = self.get_by_id(book_id)
        if not book:
            return None
        if title is not None:
            book.title = title
        if author is not None:
            book.author = author
        if description is not None:
            book.description = description
        if category is not None:
            book.category = category
        if tags is not None:
            book.tags = tags
        if cover_image_url is not None:
            book.cover_image_url = cover_image_url
        self.db.commit()
        self.db.refresh(book)
        return book

    def set_published(self, book_id: int, is_published: bool) -> Optional[Book]:
        book = self.get_by_id(book_id)
        if not book:
            return None
        book.is_published = is_published
        self.db.commit()
        self.db.refresh(book)
        return book

    def set_published_all(self, is_published: bool) -> int:
        updated = self.db.query(Book).update({Book.is_published: is_published}, synchronize_session=False)
        self.db.commit()
        return updated

    def set_published_many(self, book_ids: List[int], is_published: bool) -> int:
        if not book_ids:
            return 0
        updated = (
            self.db.query(Book)
            .filter(Book.id.in_(book_ids))
            .update({Book.is_published: is_published}, synchronize_session=False)
        )
        self.db.commit()
        return updated

    def set_sync_error(self, book_id: int, error: str) -> None:
        book = self.get_by_id(book_id)
        if not book:
            return
        book.sync_status = "error"
        book.sync_error = error
        self.db.commit()
