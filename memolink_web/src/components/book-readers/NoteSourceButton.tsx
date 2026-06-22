import React from "react";
import type { BookNoteSourceStatus } from "../../api/booksApi";

interface Props {
  noteStatus?: BookNoteSourceStatus | null;
  noteStatusLoaded?: boolean;
  savingNoteSource?: boolean;
  onSaveAsNoteSource?: () => void;
}

export function NoteSourceButton({ noteStatus, noteStatusLoaded, savingNoteSource, onSaveAsNoteSource }: Props) {
  if (!onSaveAsNoteSource || !noteStatusLoaded) return null;

  if (noteStatus?.status === "pending" || noteStatus?.status === "processing") {
    return <span className="px-2.5 py-1.5 text-xs rounded-lg bg-amber-500/15 text-amber-400">Processing…</span>;
  }

  // "ready" stays clickable so the note can be regenerated if the user deletes
  // the underlying Note from the Notes list — the source row would otherwise be stuck.
  const isReady = noteStatus?.status === "ready";
  return (
    <button
      onClick={onSaveAsNoteSource}
      disabled={savingNoteSource}
      title={isReady ? "Re-save as Note Source" : "Save as Note Source"}
      className={`px-2.5 py-1.5 text-xs rounded-lg border transition disabled:opacity-50 ${
        isReady
          ? "border-green-500/30 text-green-400 bg-green-500/10 hover:bg-green-500/15"
          : "text-gray-400 border-[var(--ml-bg-hover)] hover:bg-[var(--ml-bg-hover)]"
      }`}
    >
      {savingNoteSource ? "Starting…" : isReady ? "✓ Saved — Re-save" : "Save as Note Source"}
    </button>
  );
}
