import { useState, useEffect, useCallback } from "react";
import { listNotes, deleteNote, createNote, updateNote, getNote } from "../api/client";
import type { Note } from "../types";
import { subscribeToNoteChanges } from "../utils/noteEvents";

export function useNotes(userId: number, workspaceId?: number | null) {
  const [notes, setNotes] = useState<Note[]>([]);

  const reloadNotes = useCallback(async (): Promise<Note[]> => {
    try {
      const fresh = await listNotes(workspaceId);
      setNotes(fresh);
      return fresh;
    } catch {
      return [];
    }
  }, [workspaceId]);

  useEffect(() => { void reloadNotes(); }, [userId, reloadNotes]);

  useEffect(() => subscribeToNoteChanges(({ note, noteId }) => {
    if (!note) {
      if (noteId != null) {
        void getNote(noteId).then((fresh: Note) => {
          const belongsToWorkspace = fresh.workspace_id == null || fresh.workspace_id === workspaceId;
          if (belongsToWorkspace) {
            setNotes((previous) => [fresh, ...previous.filter((item) => item.id !== fresh.id)]);
          }
        }).catch(() => { void reloadNotes(); });
        return;
      }
      void reloadNotes();
      return;
    }
    const belongsToWorkspace = note.workspace_id == null || note.workspace_id === workspaceId;
    if (!belongsToWorkspace) return;
    setNotes((previous) => [note, ...previous.filter((item) => item.id !== note.id)]);
  }), [reloadNotes, workspaceId]);

  async function addNote(title: string, content: string): Promise<Note> {
    const created = await createNote(title, content, "manual", workspaceId);
    const fresh = await getNote(created.id);
    setNotes((p) => [fresh, ...p.filter((note) => note.id !== fresh.id)]);
    return fresh;
  }

  async function saveNote(id: number, title: string, content: string): Promise<Note> {
    await updateNote(id, title, content);
    const fresh = await getNote(id);
    setNotes((p) => p.map((n) => (n.id === id ? fresh : n)));
    return fresh;
  }

  async function removeNote(id: number): Promise<void> {
    await deleteNote(id);
    setNotes((p) => p.filter((n) => n.id !== id));
  }

  return { notes, setNotes, addNote, saveNote, removeNote, reloadNotes };
}
