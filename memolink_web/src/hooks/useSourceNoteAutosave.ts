import { useEffect, useRef, useState } from "react";

export type AutosaveStatus = "idle" | "saving" | "saved" | "offline" | "error";

interface NoteSnapshot {
  title: string;
  content: string;
  updatedAt: number;
}

const DEBOUNCE_MS = 800;
const RETRY_MS = 5000;

function storageKey(noteId: number): string {
  return `memolink-source-note-pending:${noteId}`;
}

function readPending(noteId: number): NoteSnapshot | null {
  try {
    const raw = localStorage.getItem(storageKey(noteId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<NoteSnapshot>;
    return typeof parsed.title === "string" && typeof parsed.content === "string"
      ? { title: parsed.title, content: parsed.content, updatedAt: Number(parsed.updatedAt) || Date.now() }
      : null;
  } catch {
    return null;
  }
}

function writePending(noteId: number, snapshot: NoteSnapshot): void {
  try { localStorage.setItem(storageKey(noteId), JSON.stringify(snapshot)); } catch {}
}

export function useSourceNoteAutosave({
  enabled,
  noteId,
  title,
  content,
  dirty,
  save,
  restore,
}: {
  enabled: boolean;
  noteId: number | null;
  title: string;
  content: string;
  dirty: boolean;
  save: (title: string, content: string) => Promise<void>;
  restore: (title: string, content: string) => void;
}) {
  const [status, setStatus] = useState<AutosaveStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const saveRef = useRef(save);
  const restoreRef = useRef(restore);
  const inFlightRef = useRef(false);
  const queuedRef = useRef<NoteSnapshot | null>(null);
  const retryTimerRef = useRef<number | null>(null);
  saveRef.current = save;
  restoreRef.current = restore;

  async function persist(snapshot: NoteSnapshot) {
    if (!enabled || noteId == null) return;
    writePending(noteId, snapshot);
    if (!navigator.onLine) {
      setStatus("offline");
      return;
    }
    if (inFlightRef.current) {
      queuedRef.current = snapshot;
      return;
    }
    inFlightRef.current = true;
    setStatus("saving");
    setError(null);
    try {
      await saveRef.current(snapshot.title, snapshot.content);
      const pending = readPending(noteId);
      if (pending?.updatedAt === snapshot.updatedAt) localStorage.removeItem(storageKey(noteId));
      setStatus("saved");
    } catch (caught) {
      setStatus(navigator.onLine ? "error" : "offline");
      setError(caught instanceof Error ? caught.message : "Could not save changes");
      if (retryTimerRef.current == null) {
        retryTimerRef.current = window.setTimeout(() => {
          retryTimerRef.current = null;
          const pending = readPending(noteId);
          if (pending) void persist(pending);
        }, RETRY_MS);
      }
    } finally {
      inFlightRef.current = false;
      const queued = queuedRef.current;
      queuedRef.current = null;
      if (queued && queued.updatedAt !== snapshot.updatedAt) void persist(queued);
    }
  }

  useEffect(() => {
    if (!enabled || noteId == null) {
      setStatus("idle");
      return;
    }
    const pending = readPending(noteId);
    if (pending && (pending.title !== title || pending.content !== content)) {
      restoreRef.current(pending.title, pending.content);
      setStatus(navigator.onLine ? "error" : "offline");
    } else if (!dirty) {
      if (pending) localStorage.removeItem(storageKey(noteId));
      setStatus("saved");
    }
    // Restore once when a note becomes a source workspace; draft changes are
    // handled by the debounced effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, noteId]);

  useEffect(() => {
    if (!enabled || noteId == null || !dirty) return;
    const snapshot = { title, content, updatedAt: Date.now() };
    writePending(noteId, snapshot);
    const timer = window.setTimeout(() => void persist(snapshot), DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
    // persist intentionally reads mutable refs and the current snapshot.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [content, dirty, enabled, noteId, title]);

  useEffect(() => {
    if (!enabled || noteId == null) return;
    const retry = () => {
      const pending = readPending(noteId);
      if (pending) void persist(pending);
    };
    window.addEventListener("online", retry);
    return () => window.removeEventListener("online", retry);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, noteId]);

  useEffect(() => () => {
    if (retryTimerRef.current != null) window.clearTimeout(retryTimerRef.current);
  }, []);

  return { status, error };
}
