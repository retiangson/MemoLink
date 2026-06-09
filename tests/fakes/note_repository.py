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
        notes = [n for n in self.notes.values() if n.user_id == user_id]
        if workspace_id is not None:
            notes = [n for n in notes if n.workspace_id == workspace_id]
        return notes

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
        return note_id in self.notes

    def restore_note(self, note_id):
        return note_id in self.notes

    def permanent_delete_note(self, note_id):
        return self.notes.pop(note_id, None) is not None

    def search_by_vector(self, vector, top_k=5, workspace_id=None, user_id=None):
        notes = list(self.notes.values())
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
