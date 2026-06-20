from typing import Optional, List, Any
from sqlalchemy.orm import Session

from memolink_backend.domain.repositories.note_repository import NoteRepository
from memolink_backend.domain.interfaces.i_note_repository import INoteRepository
from memolink_backend.business.services.embedding_service import EmbeddingService
from memolink_backend.business.interfaces.i_note_service import INoteService
from memolink_backend.contracts.note_dtos import NoteCreateDTO, NoteUpdateDTO, NoteResponseDTO


class NoteService(INoteService):
    def __init__(
        self,
        db: Optional[Session] = None,
        embedding_service: Optional[EmbeddingService] = None,
        note_repo: Optional[INoteRepository] = None,
    ):
        self.db = db
        self.repo: INoteRepository = note_repo if note_repo is not None else NoteRepository(db)
        self.embedding_service = embedding_service

    def create_note(self, dto: NoteCreateDTO) -> NoteResponseDTO:
        note = self.repo.create_note(user_id=dto.user_id, title=dto.title, content=dto.content, source=dto.source, workspace_id=getattr(dto, "workspace_id", None))
        if self.embedding_service and self.db:
            try:
                with self.db.begin_nested():  # savepoint - rolls back only embedding on failure
                    vector = self.embedding_service.embed_text(dto.content)
                    self.repo.save_embedding(note.id, vector)
            except Exception:
                pass  # note is still committed without an embedding
        if self.db:
            self.db.commit()
            self.db.refresh(note)
        return NoteResponseDTO.model_validate(note)

    def get_note(self, note_id: int) -> NoteResponseDTO | None:
        note = self.repo.get_by_id(note_id)
        return NoteResponseDTO.model_validate(note) if note else None

    def list_notes(self, user_id: int, workspace_id: int | None = None) -> List[NoteResponseDTO]:
        return [NoteResponseDTO.model_validate(n) for n in self.repo.get_for_user(user_id, workspace_id)]

    def list_trash(self, user_id: int) -> List[dict[str, Any]]:
        notes = self.repo.get_trash_for_user(user_id)
        return [
            {"id": n.id, "title": n.title, "content": n.content, "deleted_at": n.deleted_at}
            for n in notes
        ]

    def update_note(self, dto: NoteUpdateDTO) -> NoteResponseDTO | None:
        note = self.repo.update_note(dto.note_id, dto.title, dto.content)
        if not note:
            return None
        if dto.content is not None and self.embedding_service and self.db:
            try:
                with self.db.begin_nested():
                    vector = self.embedding_service.embed_text(dto.content)
                    self.repo.save_embedding(note.id, vector)
            except Exception:
                pass
        if self.db:
            self.db.commit()
            self.db.refresh(note)
        return NoteResponseDTO.model_validate(note)

    def delete_note(self, note_id: int) -> bool:
        return self.repo.delete_note(note_id)

    def restore_note(self, note_id: int) -> bool:
        return self.repo.restore_note(note_id)

    def permanent_delete_note(self, note_id: int) -> bool:
        return self.repo.permanent_delete_note(note_id)

    def search_notes(self, vector: list[float], top_k: int = 5) -> List[NoteResponseDTO]:
        return [NoteResponseDTO.model_validate(n) for n in self.repo.search_by_vector(vector, top_k)]

    def set_public_agent_enabled(self, note_id: int, user_id: int, enabled: bool) -> NoteResponseDTO | None:
        note = self.repo.get_by_id(note_id)
        if not note or note.user_id != user_id:
            return None
        if note.is_core_memory and enabled:
            raise ValueError("Core memory notes can never be exposed to the public agent")
        updated = self.repo.set_public_agent_enabled(note_id, enabled)
        return NoteResponseDTO.model_validate(updated) if updated else None
