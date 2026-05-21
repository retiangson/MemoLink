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

    def search_by_vector(self, vector, top_k=5):
        return list(self.notes.values())[:top_k]
