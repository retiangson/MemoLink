import type { Note } from "../types";

const NOTE_CHANGED_EVENT = "memolink:note-changed";

export interface NoteChangedDetail {
  note?: Note;
  noteId?: number;
}

export function notifyNoteChanged(detail: NoteChangedDetail = {}): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<NoteChangedDetail>(NOTE_CHANGED_EVENT, { detail }));
}

export function subscribeToNoteChanges(listener: (detail: NoteChangedDetail) => void): () => void {
  if (typeof window === "undefined") return () => {};
  const handle = (event: Event) => listener((event as CustomEvent<NoteChangedDetail>).detail ?? {});
  window.addEventListener(NOTE_CHANGED_EVENT, handle);
  return () => window.removeEventListener(NOTE_CHANGED_EVENT, handle);
}
