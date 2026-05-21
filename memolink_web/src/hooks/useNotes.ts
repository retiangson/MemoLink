import { useState, useEffect } from "react";
import { listNotes, deleteNote, createNote, updateNote, getNote } from "../api/client";
import type { Note } from "../types";

export function useNotes(userId: number, workspaceId?: number | null) {
  const [notes, setNotes] = useState<Note[]>([]);

  useEffect(() => {
    listNotes(workspaceId).then(setNotes);
  }, [userId, workspaceId]);

  async function addNote(title: string, content: string): Promise<Note> {
    const created = await createNote(title, content, "manual", workspaceId);
    const fresh = await getNote(created.id);
    setNotes((p) => [fresh, ...p]);
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

  return { notes, setNotes, addNote, saveNote, removeNote };
}
