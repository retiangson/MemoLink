from types import SimpleNamespace


class FakeNoteRepository:
    def __init__(self):
        self.notes = {}

    def create_note(self, user_id, title, content, source, workspace_id=None):
        note = SimpleNamespace(
            id=len(self.notes) + 1,
            user_id=user_id,
            title=title,
            content=content,
            source=source,
            workspace_id=workspace_id,
        )
        self.notes[note.id] = note
        return note

    def get_by_id(self, note_id):
        return self.notes.get(note_id)

    def get_for_user(self, user_id, workspace_id=None):
        notes = [
            n for n in self.notes.values()
            if n.user_id == user_id and not getattr(n, "is_core_memory", False)
        ]
        if workspace_id is not None:
            notes = [n for n in notes if n.workspace_id == workspace_id]
        return notes

    def find_by_title_for_user(self, user_id, title, workspace_id=None):
        wanted = (title or "").strip().lower()
        for note in self.get_for_user(user_id, workspace_id):
            if (note.title or "").strip().lower() == wanted:
                return note
        return None

    def get_trash_for_user(self, user_id):
        return []

    def update_note(self, note_id, title, content):
        note = self.notes.get(note_id)
        if not note:
            return None
        if title is not None:
            note.title = title
        if content is not None:
            note.content = content
        return note

    def delete_note(self, note_id):
        note = self.notes.get(note_id)
        if note:
            note.deleted_at = "now"
            return True
        return False

    def restore_note(self, note_id):
        return note_id in self.notes

    def permanent_delete_note(self, note_id):
        return self.notes.pop(note_id, None) is not None

    def search_by_vector(self, vector, top_k=5, workspace_id=None, user_id=None):
        notes = [n for n in self.notes.values() if not getattr(n, "is_core_memory", False)]
        if user_id is not None:
            notes = [n for n in notes if n.user_id == user_id]
        if workspace_id is not None:
            notes = [n for n in notes if n.workspace_id in (workspace_id, None)]
        return notes[:top_k]

    def search_hybrid(self, query_text, query_vector, top_k=10, workspace_id=None, user_id=None):
        notes = self.search_by_vector(query_vector, top_k=top_k, workspace_id=workspace_id, user_id=user_id)
        query_l = query_text.lower()
        return sorted(
            notes,
            key=lambda note: (
                query_l in (note.title or "").lower(),
                query_l in (note.content or "").lower(),
                note.id,
            ),
            reverse=True,
        )[:top_k]

    # ── Core Memory ──────────────────────────────────────────────────────────

    def get_core_memories(self, user_id, workspace_id=None):
        notes = [n for n in self.notes.values()
                 if n.user_id == user_id and getattr(n, "is_core_memory", False)
                 and getattr(n, "deleted_at", None) is None]
        if workspace_id is not None:
            notes = [n for n in notes if getattr(n, "workspace_id", None) in (workspace_id, None)]
        return notes

    def get_core_memory_by_id(self, note_id, user_id):
        note = self.notes.get(note_id)
        if note and note.user_id == user_id and getattr(note, "is_core_memory", False) and getattr(note, "deleted_at", None) is None:
            return note
        return None

    def get_core_memory_by_title(self, user_id, title, workspace_id=None):
        for note in self.notes.values():
            if note.user_id == user_id and getattr(note, "is_core_memory", False) and note.title == title:
                return note
        return None

    def create_core_memory(self, user_id, title, content, memory_type, sensitivity_level,
                           encrypted_content, masked_content, searchable_content,
                           memory_source, memory_confidence, memory_created_by, workspace_id):
        note = SimpleNamespace(
            id=len(self.notes) + 1,
            user_id=user_id,
            title=title,
            content=content,
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
            memory_updated_at=None,
            memory_last_used_at=None,
            created_at=None,
        )
        self.notes[note.id] = note
        return note

    def update_core_memory(self, note_id, title, memory_type, sensitivity_level, masked_content, searchable_content):
        note = self.notes.get(note_id)
        if not note or not getattr(note, "is_core_memory", False):
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
        return note

    def touch_memory_last_used(self, note_id):
        pass

    def save_undo_snapshot(self, note_id, title, content, command, instruction):
        pass

    def clear_undo_snapshot(self, note_id):
        pass
