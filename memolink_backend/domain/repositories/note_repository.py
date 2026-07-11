from datetime import datetime, timezone
from typing import List, Optional
from sqlalchemy.orm import Session
from sqlalchemy import text, func, or_
from memolink_backend.domain.models.note import Note
from memolink_backend.domain.models.embedding import Embedding

_SEARCH_STOP_WORDS = {
    "the", "a", "an", "is", "in", "of", "to", "and", "or", "for", "with", "on", "at", "by",
    "from", "into", "your", "my", "our", "their", "this", "that", "these", "those", "about",
    "please", "could", "would", "should", "have", "has", "had", "been", "being", "what",
    "when", "where", "which", "who", "why", "how",
    "can", "you", "yours", "i", "me", "we", "us", "he", "she", "they", "them", "it", "its",
    "do", "does", "did", "will", "shall", "may", "might", "must", "am", "are", "was", "were",
    "be", "not", "just", "want", "need", "get", "give", "let", "know", "like", "also", "tell",
    "look", "see", "help", "some", "any", "all", "so", "if", "than", "then", "there", "here",
    "out", "up", "down", "over", "again", "such", "no", "yes", "each", "both", "more", "most",
    "other", "own", "same", "too", "very", "s", "t", "now",
}

class NoteRepository:
    def __init__(self, db: Session):
        self.db = db

    def create_note(self, user_id: int, title: str | None, content: str, source: str | None, workspace_id: int | None = None) -> Note:
        note = Note(user_id=user_id, title=title, content=content, source=source, workspace_id=workspace_id)
        self.db.add(note)
        self.db.flush()
        return note

    def save_embedding(self, note_id: int, vector: list[float]) -> Embedding:
        vector_str = "[" + ",".join(str(v) for v in vector) + "]"
        sql = text("""
            INSERT INTO embeddings (note_id, vector)
            VALUES (:note_id, CAST(:vector AS vector))
            ON CONFLICT (note_id)
            DO UPDATE SET vector = EXCLUDED.vector
            RETURNING id
        """)
        row = self.db.execute(sql, {"note_id": note_id, "vector": vector_str}).fetchone()
        return self.db.query(Embedding).filter(Embedding.id == row[0]).first()

    def get_by_id(self, note_id: int) -> Optional[Note]:
        return self.db.query(Note).filter(Note.id == note_id).first()

    def get_for_user(self, user_id: int, workspace_id: int | None = None) -> List[Note]:
        from sqlalchemy import or_
        q = self.db.query(Note).filter(
            Note.user_id == user_id,
            Note.deleted_at == None,
            or_(Note.is_core_memory == None, Note.is_core_memory == False),
        )
        if workspace_id is not None:
            q = q.filter(or_(Note.workspace_id == workspace_id, Note.workspace_id == None))
        return q.order_by(Note.id.desc()).all()

    def get_trash_for_user(self, user_id: int) -> List[Note]:
        return (
            self.db.query(Note)
            .filter(Note.user_id == user_id, Note.deleted_at != None)
            .order_by(Note.deleted_at.desc())
            .all()
        )

    def update_note(self, note_id: int, title: str | None, content: str | None) -> Optional[Note]:
        note = self.get_by_id(note_id)
        if not note:
            return None
        if title is not None:
            note.title = title
        if content is not None:
            note.content = content
        self.db.commit()
        self.db.refresh(note)
        return note

    def delete_note(self, note_id: int) -> bool:
        note = self.get_by_id(note_id)
        if not note:
            return False
        note.deleted_at = func.now()
        self.db.commit()
        return True

    def restore_note(self, note_id: int) -> bool:
        note = self.get_by_id(note_id)
        if not note:
            return False
        note.deleted_at = None
        self.db.commit()
        return True

    def permanent_delete_note(self, note_id: int) -> bool:
        note = self.get_by_id(note_id)
        if not note:
            return False
        self.db.query(Embedding).filter(Embedding.note_id == note_id).delete()
        self.db.delete(note)
        self.db.commit()
        return True

    def save_undo_snapshot(self, note_id: int, title: str | None, content: str, command: str, instruction: str | None) -> None:
        note = self.get_by_id(note_id)
        if not note:
            return
        note.undo_title = title
        note.undo_content = content
        note.undo_command = command
        note.undo_instruction = instruction
        note.undo_created_at = datetime.now(timezone.utc)
        note.undo_available = True
        self.db.commit()

    def clear_undo_snapshot(self, note_id: int) -> None:
        note = self.get_by_id(note_id)
        if not note:
            return
        note.undo_title = None
        note.undo_content = None
        note.undo_command = None
        note.undo_instruction = None
        note.undo_created_at = None
        note.undo_available = False
        self.db.commit()

    def get_by_source_for_user(self, user_id: int, source: str, workspace_id: int | None = None) -> Optional[Note]:
        q = self.db.query(Note).filter(
            Note.user_id == user_id,
            Note.source == source,
            Note.deleted_at == None,
        )
        if workspace_id is not None:
            q = q.filter(or_(Note.workspace_id == workspace_id, Note.workspace_id == None))
        return q.first()

    def find_by_title_for_user(self, user_id: int, name: str, workspace_id: int | None = None) -> Optional[Note]:
        """Fuzzy title search: exact → starts-with → contains."""
        notes = self.get_for_user(user_id, workspace_id)
        name_l = name.lower().strip()
        for strategy in (
            lambda t: t == name_l,
            lambda t: t.startswith(name_l),
            lambda t: name_l in t,
            lambda t: t in name_l,
        ):
            for n in notes:
                if strategy((n.title or "").lower()):
                    return n
        return None

    @staticmethod
    def _normalize_search_text(text_value: str | None) -> str:
        if not text_value:
            return ""
        return " ".join("".join(ch.lower() if ch.isalnum() else " " for ch in text_value).split())

    @classmethod
    def _tokenize_search_terms(cls, query_text: str) -> list[str]:
        normalized = cls._normalize_search_text(query_text)
        if not normalized:
            return []
        seen: set[str] = set()
        terms: list[str] = []
        for token in normalized.split():
            if len(token) < 3 or token in _SEARCH_STOP_WORDS or token in seen:
                continue
            seen.add(token)
            terms.append(token)
        return terms

    def _base_note_query(self, workspace_id: int | None = None, user_id: int | None = None):
        q = self.db.query(Note).filter(
            Note.deleted_at == None,
            or_(Note.is_core_memory == None, Note.is_core_memory == False),
        )
        if user_id is not None:
            q = q.filter(Note.user_id == user_id)
        if workspace_id is not None:
            q = q.filter(or_(Note.workspace_id == workspace_id, Note.workspace_id == None))
        return q

    @classmethod
    def _keyword_rank(cls, note: Note, query_text: str, query_terms: list[str]) -> float:
        normalized_query = cls._normalize_search_text(query_text)
        title = cls._normalize_search_text(note.title)
        content = cls._normalize_search_text(note.content)
        combined = f"{title} {content}".strip()
        if not combined:
            return 0.0

        title_hits = sum(1 for term in query_terms if term in title)
        content_hits = sum(1 for term in query_terms if term in content)
        exact_title_bonus = 4.0 if title == normalized_query and normalized_query else 0.0
        title_phrase_bonus = 2.0 if normalized_query and normalized_query in title else 0.0
        content_phrase_bonus = 1.0 if normalized_query and normalized_query in combined else 0.0

        combined_terms = set(combined.split())
        query_term_set = set(query_terms)
        jaccard = 0.0
        if query_term_set and combined_terms:
            jaccard = len(query_term_set & combined_terms) / len(query_term_set | combined_terms)

        coverage = (content_hits + title_hits) / max(len(query_terms), 1)
        return (
            exact_title_bonus
            + title_phrase_bonus
            + content_phrase_bonus
            + (title_hits * 2.5)
            + (content_hits * 1.25)
            + (coverage * 2.0)
            + jaccard
        )

    def search_by_keywords(
        self,
        query_text: str,
        top_k: int = 10,
        workspace_id: int | None = None,
        user_id: int | None = None,
    ) -> List[Note]:
        query_terms = self._tokenize_search_terms(query_text)
        normalized_query = self._normalize_search_text(query_text)
        if not query_terms and not normalized_query:
            return []

        q = self._base_note_query(workspace_id=workspace_id, user_id=user_id)
        if query_terms:
            like_filters = [
                or_(Note.title.ilike(f"%{term}%"), Note.content.ilike(f"%{term}%"))
                for term in query_terms
            ]
            q = q.filter(or_(*like_filters))
        elif normalized_query:
            q = q.filter(or_(Note.title.ilike(f"%{normalized_query}%"), Note.content.ilike(f"%{normalized_query}%")))

        candidate_limit = max(top_k * 6, 30)
        candidates = q.order_by(Note.updated_at.desc().nullslast(), Note.id.desc()).limit(candidate_limit).all()
        ranked = sorted(
            candidates,
            key=lambda note: self._keyword_rank(note, query_text, query_terms),
            reverse=True,
        )
        return ranked[:top_k]

    def search_hybrid(
        self,
        query_text: str,
        query_vector: list[float],
        top_k: int = 10,
        workspace_id: int | None = None,
        user_id: int | None = None,
    ) -> List[Note]:
        """Combine vector and keyword candidates with reciprocal-rank fusion plus lexical reranking."""
        vector_hits = self.search_by_vector(
            query_vector,
            top_k=max(top_k * 4, 24),
            workspace_id=workspace_id,
            user_id=user_id,
        )
        keyword_hits = self.search_by_keywords(
            query_text,
            top_k=max(top_k * 4, 24),
            workspace_id=workspace_id,
            user_id=user_id,
        )
        if not vector_hits and not keyword_hits:
            return []

        query_terms = self._tokenize_search_terms(query_text)
        note_by_id: dict[int, Note] = {}
        fused_scores: dict[int, float] = {}

        for rank, note in enumerate(vector_hits, start=1):
            note_by_id[note.id] = note
            fused_scores[note.id] = fused_scores.get(note.id, 0.0) + (1.0 / (60 + rank))

        for rank, note in enumerate(keyword_hits, start=1):
            note_by_id[note.id] = note
            fused_scores[note.id] = fused_scores.get(note.id, 0.0) + (1.35 / (60 + rank))
            fused_scores[note.id] += self._keyword_rank(note, query_text, query_terms) * 0.08

        ranked_ids = sorted(
            fused_scores,
            key=lambda note_id: (fused_scores[note_id], note_by_id[note_id].id),
            reverse=True,
        )
        return [note_by_id[note_id] for note_id in ranked_ids[:top_k]]

    def search_by_vector(
        self,
        query_vector: list[float],
        top_k: int = 5,
        workspace_id: int | None = None,
        user_id: int | None = None,
    ) -> List[Note]:
        embedding_str = "[" + ",".join(str(x) for x in query_vector) + "]"
        sql = text("""
            SELECT n.id
            FROM embeddings e
            JOIN notes n ON n.id = e.note_id
            WHERE n.deleted_at IS NULL
              AND (n.is_core_memory IS NULL OR n.is_core_memory = FALSE)
              AND (:user_id IS NULL OR n.user_id = :user_id)
              AND (
                    :workspace_id IS NULL
                    OR n.workspace_id = :workspace_id
                    OR n.workspace_id IS NULL
                  )
            ORDER BY e.vector <-> vector(:embedding)
            LIMIT :top_k
        """)
        rows = self.db.execute(
            sql,
            {
                "embedding": embedding_str,
                "top_k": top_k,
                "workspace_id": workspace_id,
                "user_id": user_id,
            },
        ).fetchall()
        note_ids = [r[0] for r in rows]
        if not note_ids:
            return []
        notes = self.db.query(Note).filter(Note.id.in_(note_ids)).all()
        note_map = {n.id: n for n in notes}
        return [note_map[nid] for nid in note_ids if nid in note_map]

    # ── Core Memory ──────────────────────────────────────────────────────────

    def get_core_memories(self, user_id: int, workspace_id: int | None = None) -> List[Note]:
        q = (
            self.db.query(Note)
            .filter(Note.user_id == user_id, Note.is_core_memory == True, Note.deleted_at == None)
        )
        if workspace_id is not None:
            q = q.filter(or_(Note.workspace_id == workspace_id, Note.workspace_id == None))
        return q.order_by(Note.id.desc()).all()

    def get_core_memory_by_id(self, note_id: int, user_id: int) -> Optional[Note]:
        return (
            self.db.query(Note)
            .filter(Note.id == note_id, Note.user_id == user_id, Note.is_core_memory == True, Note.deleted_at == None)
            .first()
        )

    def get_core_memory_by_title(self, user_id: int, title: str, workspace_id: int | None = None) -> Optional[Note]:
        q = (
            self.db.query(Note)
            .filter(Note.user_id == user_id, Note.is_core_memory == True, Note.deleted_at == None,
                    Note.title == title)
        )
        if workspace_id is not None:
            q = q.filter(or_(Note.workspace_id == workspace_id, Note.workspace_id == None))
        return q.first()

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
    ) -> Note:
        now = datetime.now(timezone.utc)
        note = Note(
            user_id=user_id,
            title=title,
            content=masked_content or title,
            source="core_memory",
            workspace_id=workspace_id,
            is_core_memory=True,
            is_encrypted=bool(encrypted_content),
            memory_type=memory_type,
            sensitivity_level=sensitivity_level,
            encrypted_content=encrypted_content,
            masked_content=masked_content,
            searchable_content=searchable_content,
            memory_source=memory_source,
            memory_confidence=memory_confidence,
            memory_locked=True,
            memory_created_by=memory_created_by,
            memory_updated_at=now,
        )
        self.db.add(note)
        self.db.commit()
        self.db.refresh(note)
        return note

    def update_core_memory(
        self,
        note_id: int,
        title: str | None,
        memory_type: str | None,
        sensitivity_level: str | None,
        masked_content: str | None,
        searchable_content: str | None,
    ) -> Optional[Note]:
        note = self.get_by_id(note_id)
        if not note or not note.is_core_memory:
            return None
        if title is not None:
            note.title = title
        if memory_type is not None:
            note.memory_type = memory_type
        if sensitivity_level is not None:
            note.sensitivity_level = sensitivity_level
        if masked_content is not None:
            note.masked_content = masked_content
            note.content = masked_content
        if searchable_content is not None:
            note.searchable_content = searchable_content
        note.memory_updated_at = datetime.now(timezone.utc)
        self.db.commit()
        self.db.refresh(note)
        return note

    def touch_memory_last_used(self, note_id: int) -> None:
        note = self.get_by_id(note_id)
        if note and note.is_core_memory:
            note.memory_last_used_at = datetime.now(timezone.utc)
            self.db.commit()

    # ── Public Portfolio Agent ───────────────────────────────────────────────
    # These are the ONLY methods that may back the unauthenticated public agent's
    # retrieval. Both enforce, in SQL, all three conditions at once: exact workspace
    # match (no null-workspace passthrough like the personal search methods above),
    # public_agent_enabled = TRUE, and core-memory exclusion. Do not add a workspace_id
    # parameter to search_by_vector/search_hybrid/get_for_user and reuse those for public
    # access — their permissive "OR workspace_id IS NULL" semantics would leak notes from
    # outside the intended public workspace.

    def set_public_agent_enabled(self, note_id: int, enabled: bool) -> Optional[Note]:
        note = self.get_by_id(note_id)
        if not note:
            return None
        note.public_agent_enabled = enabled
        self.db.commit()
        self.db.refresh(note)
        return note

    def get_public_agent_notes_for_workspace(self, workspace_id: int) -> List[Note]:
        return (
            self.db.query(Note)
            .filter(
                Note.workspace_id == workspace_id,
                Note.deleted_at == None,
                Note.public_agent_enabled == True,
                or_(Note.is_core_memory == None, Note.is_core_memory == False),
            )
            .order_by(Note.id.desc())
            .all()
        )

    def search_public_agent_notes_by_vector(
        self,
        workspace_id: int,
        query_vector: list[float],
        top_k: int = 5,
    ) -> List[Note]:
        embedding_str = "[" + ",".join(str(x) for x in query_vector) + "]"
        sql = text("""
            SELECT n.id
            FROM embeddings e
            JOIN notes n ON n.id = e.note_id
            WHERE n.deleted_at IS NULL
              AND n.workspace_id = :workspace_id
              AND n.public_agent_enabled = TRUE
              AND (n.is_core_memory IS NULL OR n.is_core_memory = FALSE)
            ORDER BY e.vector <-> vector(:embedding)
            LIMIT :top_k
        """)
        rows = self.db.execute(
            sql,
            {"embedding": embedding_str, "workspace_id": workspace_id, "top_k": top_k},
        ).fetchall()
        note_ids = [r[0] for r in rows]
        if not note_ids:
            return []
        notes = self.db.query(Note).filter(Note.id.in_(note_ids)).all()
        note_map = {n.id: n for n in notes}
        return [note_map[nid] for nid in note_ids if nid in note_map]
