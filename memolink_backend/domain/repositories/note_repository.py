from typing import List, Optional
from sqlalchemy.orm import Session
from sqlalchemy import text, func
from memolink_backend.domain.models.note import Note
from memolink_backend.domain.models.embedding import Embedding


class NoteRepository:
    def __init__(self, db: Session):
        self.db = db

    def create_note(self, user_id: int, title: str | None, content: str, source: str | None) -> Note:
        note = Note(user_id=user_id, title=title, content=content, source=source)
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

    def get_for_user(self, user_id: int) -> List[Note]:
        return (
            self.db.query(Note)
            .filter(Note.user_id == user_id, Note.deleted_at == None)
            .order_by(Note.id.desc())
            .all()
        )

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

    def search_by_vector(self, query_vector: list[float], top_k: int = 5) -> List[Note]:
        embedding_str = "[" + ",".join(str(x) for x in query_vector) + "]"
        sql = text("""
            SELECT n.id
            FROM embeddings e
            JOIN notes n ON n.id = e.note_id
            WHERE n.deleted_at IS NULL
            ORDER BY e.vector <-> vector(:embedding)
            LIMIT :top_k
        """)
        rows = self.db.execute(sql, {"embedding": embedding_str, "top_k": top_k}).fetchall()
        note_ids = [r[0] for r in rows]
        if not note_ids:
            return []
        notes = self.db.query(Note).filter(Note.id.in_(note_ids)).all()
        note_map = {n.id: n for n in notes}
        return [note_map[nid] for nid in note_ids if nid in note_map]
