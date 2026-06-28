import { useCallback, useEffect, useRef, useState } from "react";

export type AutosaveStatus = "idle" | "saving" | "saved" | "offline" | "error";

export interface NoteSnapshot {
  title: string;
  content: string;
  updatedAt: number;
}

const DEBOUNCE_MS = 600;
const RETRY_MS = 5000;

function storageKey(noteKey: string): string {
  return `memolink-note-pending:${noteKey}`;
}

function legacyStorageKey(noteKey: string): string | null {
  const match = /^note-(\d+)$/.exec(noteKey);
  return match ? `memolink-source-note-pending:${match[1]}` : null;
}

function readPending(noteKey: string): NoteSnapshot | null {
  try {
    const legacyKey = legacyStorageKey(noteKey);
    const raw = localStorage.getItem(storageKey(noteKey)) ?? (legacyKey ? localStorage.getItem(legacyKey) : null);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<NoteSnapshot>;
    return typeof parsed.title === "string" && typeof parsed.content === "string"
      ? { title: parsed.title, content: parsed.content, updatedAt: Number(parsed.updatedAt) || Date.now() }
      : null;
  } catch {
    return null;
  }
}

function removePending(noteKey: string): void {
  try {
    localStorage.removeItem(storageKey(noteKey));
    const legacyKey = legacyStorageKey(noteKey);
    if (legacyKey) localStorage.removeItem(legacyKey);
  } catch { /* storage can be unavailable */ }
}

function writePending(noteKey: string, snapshot: NoteSnapshot): void {
  try { localStorage.setItem(storageKey(noteKey), JSON.stringify(snapshot)); } catch { /* storage can be unavailable */ }
}

export function useNoteAutosave({
  noteKey,
  title,
  content,
  dirty,
  save,
  saveOnPageExit,
  restore,
}: {
  noteKey: string;
  title: string;
  content: string;
  dirty: boolean;
  save: (noteKey: string, snapshot: NoteSnapshot) => Promise<void>;
  saveOnPageExit: (noteKey: string, snapshot: NoteSnapshot) => void;
  restore: (title: string, content: string) => void;
}) {
  const [status, setStatus] = useState<AutosaveStatus>(dirty ? "idle" : "saved");
  const [error, setError] = useState<string | null>(null);
  const saveRef = useRef(save);
  const exitSaveRef = useRef(saveOnPageExit);
  const restoreRef = useRef(restore);
  const keyRef = useRef(noteKey);
  const latestRef = useRef<NoteSnapshot>({ title, content, updatedAt: Date.now() });
  const inFlightRef = useRef<Promise<void> | null>(null);
  const queuedRef = useRef<NoteSnapshot | null>(null);
  const retryTimerRef = useRef<number | null>(null);
  const lastExitSnapshotRef = useRef<string | null>(null);
  saveRef.current = save;
  exitSaveRef.current = saveOnPageExit;
  restoreRef.current = restore;
  keyRef.current = noteKey;
  latestRef.current = { title, content, updatedAt: latestRef.current.updatedAt };

  const persist = useCallback(async (snapshot: NoteSnapshot): Promise<void> => {
    const key = keyRef.current;
    writePending(key, snapshot);
    if (!navigator.onLine) {
      setStatus("offline");
      return;
    }
    if (inFlightRef.current) {
      queuedRef.current = snapshot;
      await inFlightRef.current;
      return;
    }

    const operation = (async () => {
      setStatus("saving");
      setError(null);
      try {
        await saveRef.current(key, snapshot);
        const pending = readPending(key);
        if (pending?.updatedAt === snapshot.updatedAt) removePending(key);
        setStatus("saved");
      } catch (caught) {
        setStatus(navigator.onLine ? "error" : "offline");
        setError(caught instanceof Error ? caught.message : "Could not save changes");
        if (retryTimerRef.current == null) {
          retryTimerRef.current = window.setTimeout(() => {
            retryTimerRef.current = null;
            const pending = readPending(keyRef.current);
            if (pending) void persist(pending);
          }, RETRY_MS);
        }
      }
    })();
    inFlightRef.current = operation;
    await operation;
    inFlightRef.current = null;

    const queued = queuedRef.current;
    queuedRef.current = null;
    if (queued && queued.updatedAt !== snapshot.updatedAt) await persist(queued);
  }, []);

  const flush = useCallback(async (): Promise<void> => {
    if (!dirty) {
      if (inFlightRef.current) await inFlightRef.current;
      return;
    }
    const snapshot = { title: latestRef.current.title, content: latestRef.current.content, updatedAt: Date.now() };
    latestRef.current = snapshot;
    await persist(snapshot);
  }, [dirty, persist]);

  useEffect(() => {
    const pending = readPending(noteKey);
    if (pending && (pending.title !== title || pending.content !== content)) {
      restoreRef.current(pending.title, pending.content);
      setStatus(navigator.onLine ? "error" : "offline");
    } else if (!dirty) {
      if (pending) removePending(noteKey);
      setStatus("saved");
    }
    // Draft restoration is intentionally keyed only by the stable editor tab identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [noteKey]);

  useEffect(() => {
    if (!dirty) return;
    const snapshot = { title, content, updatedAt: Date.now() };
    latestRef.current = snapshot;
    writePending(noteKey, snapshot);
    const timer = window.setTimeout(() => void persist(snapshot), DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [content, dirty, noteKey, persist, title]);

  useEffect(() => {
    const retry = () => {
      const pending = readPending(keyRef.current);
      if (pending) void persist(pending);
    };
    window.addEventListener("online", retry);
    return () => window.removeEventListener("online", retry);
  }, [persist]);

  useEffect(() => {
    const saveBeforeLeaving = () => {
      const pending = readPending(keyRef.current);
      const exitId = pending ? `${keyRef.current}:${pending.updatedAt}` : null;
      if (!pending || inFlightRef.current || lastExitSnapshotRef.current === exitId) return;
      lastExitSnapshotRef.current = exitId;
      exitSaveRef.current(keyRef.current, pending);
    };
    const onVisibilityChange = () => {
      if (document.visibilityState !== "hidden") return;
      const pending = readPending(keyRef.current);
      if (pending) void persist(pending);
    };
    window.addEventListener("pagehide", saveBeforeLeaving);
    window.addEventListener("beforeunload", saveBeforeLeaving);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.removeEventListener("pagehide", saveBeforeLeaving);
      window.removeEventListener("beforeunload", saveBeforeLeaving);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [persist]);

  useEffect(() => {
    const key = noteKey;
    return () => {
      const pending = readPending(key);
      const exitId = pending ? `${key}:${pending.updatedAt}` : null;
      if (!pending || inFlightRef.current || lastExitSnapshotRef.current === exitId) return;
      lastExitSnapshotRef.current = exitId;
      exitSaveRef.current(key, pending);
    };
  }, [noteKey]);

  useEffect(() => () => {
    if (retryTimerRef.current != null) window.clearTimeout(retryTimerRef.current);
  }, []);

  return { status, error, flush };
}
