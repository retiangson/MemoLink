from typing import Protocol, List, Optional
from memolink_backend.domain.models.note import Note
from memolink_backend.domain.models.embedding import Embedding


class INoteRepository(Protocol):
    def create_note(self, user_id: int, title: str | None, content: str, source: str | None) -> Note: ...
    def save_embedding(self, note_id: int, vector: list[float]) -> Embedding: ...
    def get_by_id(self, note_id: int) -> Optional[Note]: ...
    def get_for_user(self, user_id: int) -> List[Note]: ...
    def get_trash_for_user(self, user_id: int) -> List[Note]: ...
    def update_note(self, note_id: int, title: str | None, content: str | None) -> Optional[Note]: ...
    def delete_note(self, note_id: int) -> bool: ...
    def restore_note(self, note_id: int) -> bool: ...
    def permanent_delete_note(self, note_id: int) -> bool: ...
    def search_by_vector(
        self,
        query_vector: list[float],
        top_k: int = 5,
        workspace_id: int | None = None,
        user_id: int | None = None,
    ) -> List[Note]: ...
    def search_hybrid(
        self,
        query_text: str,
        query_vector: list[float],
        top_k: int = 10,
        workspace_id: int | None = None,
        user_id: int | None = None,
    ) -> List[Note]: ...

    # ── Core Memory ──────────────────────────────────────────────────────────
    def get_core_memories(self, user_id: int, workspace_id: int | None = None) -> List[Note]: ...
    def get_core_memory_by_id(self, note_id: int, user_id: int) -> Optional[Note]: ...
    def get_core_memory_by_title(self, user_id: int, title: str, workspace_id: int | None = None) -> Optional[Note]: ...
    def create_core_memory(
        self,
        user_id: int,
        title: str,
        content: str,
        memory_type: str,
        sensitivity_level: str,
        encrypted_content: str | None,
        masked_content: str | None,
        searchable_content: str | None,
        memory_source: str,
        memory_confidence: float | None,
        memory_created_by: str | None,
        workspace_id: int | None,
    ) -> Note: ...
    def update_core_memory(
        self,
        note_id: int,
        title: str | None,
        memory_type: str | None,
        sensitivity_level: str | None,
        masked_content: str | None,
        searchable_content: str | None,
    ) -> Optional[Note]: ...
    def touch_memory_last_used(self, note_id: int) -> None: ...
