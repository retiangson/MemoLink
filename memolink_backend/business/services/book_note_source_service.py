from __future__ import annotations

import io
import logging
import re
from typing import Optional

from memolink_backend.domain.repositories.book_repository import BookRepository
from memolink_backend.domain.repositories.user_book_repository import UserBookRepository
from memolink_backend.domain.repositories.note_repository import NoteRepository
from memolink_backend.domain.repositories.onedrive_account_repository import OneDriveAccountRepository
from memolink_backend.business.services.embedding_service import EmbeddingService
from memolink_backend.business.services.onedrive_service import OneDriveService
from memolink_backend.contracts.book_dtos import BookNoteSourceResponseDTO

logger = logging.getLogger(__name__)

AUDIO_EXTENSIONS = {".mp3", ".m4a", ".m4b", ".aac", ".wav", ".ogg"}
NO_TEXT_EXTENSIONS = {".cbz", ".cbr"}

_TIMESTAMP_LINE = re.compile(r"-->")
_INDEX_LINE = re.compile(r"^\d+$")


def _extract_pages_pdf(content: bytes) -> list[str]:
    import pdfplumber  # local import: heavy dependency, only needed for this job
    pages_text: list[str] = []
    with pdfplumber.open(io.BytesIO(content)) as pdf:
        for page in pdf.pages:
            pages_text.append(page.extract_text() or "")
    return pages_text


def _extract_pages_pptx(content: bytes) -> list[str]:
    from memolink_backend.utils.file_extractor import extract_text_local  # local import: heavy dependency
    return [extract_text_local(content, "book.pptx")]


def _extract_pages_epub(content: bytes) -> list[str]:
    import ebooklib  # local import: heavy dependency, only needed for this job
    from ebooklib import epub
    from bs4 import BeautifulSoup

    book = epub.read_epub(io.BytesIO(content))
    pages_text: list[str] = []
    for item in book.get_items_of_type(ebooklib.ITEM_DOCUMENT):
        soup = BeautifulSoup(item.get_content(), "html.parser")
        text = soup.get_text(separator="\n").strip()
        if text:
            pages_text.append(text)
    return pages_text


def _extract_pages_txt(content: bytes) -> list[str]:
    text = content.decode("utf-8", errors="replace")
    paragraphs = text.split("\n\n")
    chunks: list[str] = []
    current = ""
    for para in paragraphs:
        if current and len(current) + len(para) + 2 > 3000:
            chunks.append(current)
            current = para
        else:
            current = f"{current}\n\n{para}" if current else para
    if current:
        chunks.append(current)
    return chunks


def _extract_pages_captions(content: bytes, ext: str) -> list[str]:
    text = content.decode("utf-8", errors="replace")
    blocks = re.split(r"\r?\n\r?\n+", text.strip())
    cues: list[str] = []
    for block in blocks:
        lines = [ln.strip() for ln in block.splitlines() if ln.strip()]
        if not lines:
            continue
        first_upper = lines[0].upper()
        if first_upper.startswith(("WEBVTT", "NOTE", "STYLE", "REGION")):
            continue
        text_lines = [ln for ln in lines if not _TIMESTAMP_LINE.search(ln) and not _INDEX_LINE.match(ln)]
        cue_text = " ".join(text_lines).strip()
        if cue_text:
            cues.append(cue_text)

    chunks: list[str] = []
    for i in range(0, len(cues), 25):
        chunks.append("\n".join(cues[i : i + 25]))
    return chunks


class BookNoteSourceService:
    """Drives the on-demand 'Save as Note Source' job. Reuses the existing Note +
    Embedding pipeline (a single Note holding the whole book's text) instead of a
    separate vector store, so processed books are automatically retrievable by the
    existing chat/notes search.
    """

    def __init__(
        self,
        book_repo: BookRepository,
        user_book_repo: UserBookRepository,
        note_repo: NoteRepository,
        embedding_service: EmbeddingService,
        onedrive_service: OneDriveService,
    ):
        self._books = book_repo
        self._user_books = user_book_repo
        self._notes = note_repo
        self._embeddings = embedding_service
        self._onedrive = onedrive_service

    def get_status(self, user_id: int, book_id: int) -> Optional[BookNoteSourceResponseDTO]:
        row = self._user_books.get_note_source(user_id, book_id)
        return BookNoteSourceResponseDTO.model_validate(row) if row else None

    def start(self, user_id: int, book_id: int) -> BookNoteSourceResponseDTO:
        """Starts (or restarts) the note-extraction job. Re-running when status is
        already "ready" is allowed on purpose — it lets the user regenerate the Note
        if they deleted it from the Notes list, since the source row would otherwise
        be stuck pointing at notes that no longer exist."""
        existing = self._user_books.get_note_source(user_id, book_id)
        if existing and existing.status == "processing":
            return BookNoteSourceResponseDTO.model_validate(existing)
        row = self._user_books.get_or_create_note_source(user_id, book_id)
        self._user_books.set_note_source_status(row.id, "processing")
        return self.get_status(user_id, book_id)

    async def process(self, user_id: int, book_id: int) -> None:
        """Runs as a FastAPI BackgroundTask. Must use repos bound to a session that
        outlives the originating request (see run_book_note_source_job)."""
        source = self._user_books.get_or_create_note_source(user_id, book_id)
        try:
            book = self._books.get_by_id(book_id)
            if not book:
                raise ValueError("Book not found")

            ext = (book.file_extension or "").lower()
            if ext in AUDIO_EXTENSIONS:
                raise ValueError("Note extraction is not supported for audiobooks — there is no text to extract")
            if ext in NO_TEXT_EXTENSIONS:
                raise ValueError("Note extraction is not supported for comic books — there is no text to extract")
            if ext == ".mobi":
                raise ValueError("Note extraction for MOBI books isn't supported yet")

            content = await self._onedrive.download_file_bytes(
                drive_id=book.onedrive_drive_id, item_id=book.onedrive_item_id
            )

            if ext == ".epub":
                pages_text = _extract_pages_epub(content)
            elif ext == ".pptx":
                pages_text = _extract_pages_pptx(content)
            elif ext == ".txt":
                pages_text = _extract_pages_txt(content)
            elif ext in (".srt", ".vtt"):
                pages_text = _extract_pages_captions(content, ext)
            else:
                pages_text = _extract_pages_pdf(content)
            full_text = "\n\n".join(t.strip() for t in pages_text if t and t.strip())
            if not full_text:
                raise ValueError("No extractable text found — this file may be a scanned image without text")

            for note_id in self._user_books.list_note_ids_for_source(source.id):
                self._notes.permanent_delete_note(note_id)
            self._user_books.clear_note_chunks(source.id)

            note = self._notes.create_note(
                user_id=user_id,
                title=book.title,
                content=full_text,
                source=f"book:{book_id}",
                workspace_id=None,
            )
            try:
                vector = self._embeddings.embed_text(full_text)
                self._notes.save_embedding(note.id, vector)
            except Exception:
                logger.warning("Embedding failed for book %s", book_id, exc_info=True)
            self._user_books.add_note_chunk(source.id, note.id, book_id, None)

            self._user_books.set_note_source_status(source.id, "ready", None)
        except Exception as exc:
            logger.error("Book note-source processing failed for book %s user %s", book_id, user_id, exc_info=True)
            self._user_books.set_note_source_status(source.id, "failed", str(exc)[:500])


async def run_book_note_source_job(user_id: int, book_id: int) -> None:
    """Entry point for BackgroundTasks: opens its own DB session because the
    request-scoped session is closed once the HTTP response has been sent."""
    from memolink_backend.core.db import SessionLocal

    db = SessionLocal()
    try:
        service = BookNoteSourceService(
            book_repo=BookRepository(db),
            user_book_repo=UserBookRepository(db),
            note_repo=NoteRepository(db),
            embedding_service=EmbeddingService(),
            onedrive_service=OneDriveService(OneDriveAccountRepository(db)),
        )
        await service.process(user_id, book_id)
    finally:
        db.close()
