import React, { useEffect, useState } from "react";
import {
  listTrashedNotes, restoreNote, permanentDeleteNote,
} from "../api/client";
import {
  listTrashedConversations, restoreConversation, permanentDeleteConversation,
} from "../api/conversationApi";

interface TrashedNote {
  id: number;
  title: string | null;
  content: string;
  deleted_at: string;
}

interface TrashedConversation {
  id: number;
  title: string | null;
  deleted_at: string;
}

interface RecycleBinModalProps {
  onClose: () => void;
  onNoteRestored: (note: { id: number; title: string | null; content: string }) => void;
  onConvRestored: (conv: { id: number; title: string | null }) => void;
}

export function RecycleBinModal({ onClose, onNoteRestored, onConvRestored }: RecycleBinModalProps) {
  const [tab, setTab] = useState<"notes" | "chats">("notes");
  const [notes, setNotes] = useState<TrashedNote[]>([]);
  const [convs, setConvs] = useState<TrashedConversation[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    Promise.all([listTrashedNotes(), listTrashedConversations()])
      .then(([n, c]) => { setNotes(n); setConvs(c); })
      .finally(() => setLoading(false));
  }, []);

  async function handleRestoreNote(id: number) {
    await restoreNote(id);
    const note = notes.find((n) => n.id === id)!;
    setNotes((p) => p.filter((n) => n.id !== id));
    onNoteRestored({ id: note.id, title: note.title, content: note.content });
  }

  async function handleDeleteNote(id: number) {
    if (!confirm("Permanently delete this note? This cannot be undone.")) return;
    await permanentDeleteNote(id);
    setNotes((p) => p.filter((n) => n.id !== id));
  }

  async function handleRestoreConv(id: number) {
    await restoreConversation(id);
    const conv = convs.find((c) => c.id === id)!;
    setConvs((p) => p.filter((c) => c.id !== id));
    onConvRestored({ id: conv.id, title: conv.title });
  }

  async function handleDeleteConv(id: number) {
    if (!confirm("Permanently delete this conversation? This cannot be undone.")) return;
    await permanentDeleteConversation(id);
    setConvs((p) => p.filter((c) => c.id !== id));
  }

  async function handleEmptyTrash() {
    if (!confirm("Permanently delete everything in the recycle bin? This cannot be undone.")) return;
    await Promise.all([
      ...notes.map((n) => permanentDeleteNote(n.id)),
      ...convs.map((c) => permanentDeleteConversation(c.id)),
    ]);
    setNotes([]);
    setConvs([]);
  }

  const totalCount = notes.length + convs.length;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-[520px] mx-4 max-h-[80vh] flex flex-col bg-[var(--ml-bg-base)] border border-[var(--ml-bg-hover)] rounded-2xl shadow-2xl overflow-hidden">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--ml-bg-panel)] shrink-0">
          <div className="flex items-center gap-2.5">
            <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4 text-gray-400" fill="currentColor" viewBox="0 0 16 16">
              <path d="M11 1.5v1h3.5a.5.5 0 0 1 0 1h-.538l-.853 10.66A2 2 0 0 1 11.115 16h-6.23a2 2 0 0 1-1.994-1.84L2.038 3.5H1.5a.5.5 0 0 1 0-1H5v-1A1.5 1.5 0 0 1 6.5 0h3A1.5 1.5 0 0 1 11 1.5m-5 0v1h4v-1a.5.5 0 0 0-.5-.5h-3a.5.5 0 0 0-.5.5M4.5 5.029l.5 8.5a.5.5 0 1 0 .998-.06l-.5-8.5a.5.5 0 1 0-.998.06m6.53-.528a.5.5 0 0 0-.528.47l-.5 8.5a.5.5 0 0 0 .998.058l.5-8.5a.5.5 0 0 0-.47-.528M8 4.5a.5.5 0 0 0-.5.5v8.5a.5.5 0 0 0 1 0V5a.5.5 0 0 0-.5-.5"/>
            </svg>
            <span className="text-sm font-semibold text-gray-200">Recycle Bin</span>
            {totalCount > 0 && (
              <span className="text-xs text-gray-500 bg-[var(--ml-bg-panel)] px-2 py-0.5 rounded-full">{totalCount}</span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {totalCount > 0 && (
              <button
                onClick={handleEmptyTrash}
                className="text-xs text-red-400/70 hover:text-red-400 transition px-2 py-1 rounded-lg hover:bg-red-400/10"
              >
                Empty all
              </button>
            )}
            <button onClick={onClose} className="text-gray-600 hover:text-gray-300 transition text-lg leading-none">✕</button>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-[var(--ml-bg-panel)] shrink-0">
          {(["notes", "chats"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-5 py-2 text-xs font-medium capitalize transition border-b-2 ${
                tab === t ? "border-indigo-500 text-white" : "border-transparent text-gray-500 hover:text-gray-300"
              }`}
            >
              {t === "notes" ? `Notes (${notes.length})` : `Chats (${convs.length})`}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4">
          {loading && (
            <div className="text-center text-gray-600 text-sm py-10">Loading…</div>
          )}

          {!loading && tab === "notes" && (
            notes.length === 0 ? (
              <EmptyState label="No deleted notes" />
            ) : (
              <div className="space-y-2">
                {notes.map((note) => (
                  <TrashItem
                    key={note.id}
                    title={note.title || "Untitled"}
                    subtitle={note.content.slice(0, 80)}
                    deletedAt={note.deleted_at}
                    onRestore={() => handleRestoreNote(note.id)}
                    onDelete={() => handleDeleteNote(note.id)}
                    icon="note"
                  />
                ))}
              </div>
            )
          )}

          {!loading && tab === "chats" && (
            convs.length === 0 ? (
              <EmptyState label="No deleted chats" />
            ) : (
              <div className="space-y-2">
                {convs.map((conv) => (
                  <TrashItem
                    key={conv.id}
                    title={conv.title || `Chat ${conv.id}`}
                    subtitle=""
                    deletedAt={conv.deleted_at}
                    onRestore={() => handleRestoreConv(conv.id)}
                    onDelete={() => handleDeleteConv(conv.id)}
                    icon="chat"
                  />
                ))}
              </div>
            )
          )}
        </div>
      </div>
    </div>
  );
}

function EmptyState({ label }: { label: string }) {
  return (
    <div className="text-center py-12">
      <svg xmlns="http://www.w3.org/2000/svg" className="w-10 h-10 text-gray-700 mx-auto mb-3" fill="currentColor" viewBox="0 0 16 16">
        <path d="M11 1.5v1h3.5a.5.5 0 0 1 0 1h-.538l-.853 10.66A2 2 0 0 1 11.115 16h-6.23a2 2 0 0 1-1.994-1.84L2.038 3.5H1.5a.5.5 0 0 1 0-1H5v-1A1.5 1.5 0 0 1 6.5 0h3A1.5 1.5 0 0 1 11 1.5m-5 0v1h4v-1a.5.5 0 0 0-.5-.5h-3a.5.5 0 0 0-.5.5"/>
      </svg>
      <p className="text-xs text-gray-600">{label}</p>
    </div>
  );
}

function TrashItem({
  title, subtitle, deletedAt, onRestore, onDelete, icon,
}: {
  title: string;
  subtitle: string;
  deletedAt: string;
  onRestore: () => void;
  onDelete: () => void;
  icon: "note" | "chat";
}) {
  const date = new Date(deletedAt).toLocaleDateString(undefined, { month: "short", day: "numeric" });
  return (
    <div className="flex items-start gap-3 p-3 rounded-xl bg-[#1a1a24] border border-[var(--ml-bg-hover)] hover:border-[#3a3a4a] transition group">
      <div className="mt-0.5 shrink-0 text-gray-600">
        {icon === "note" ? (
          <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="currentColor" viewBox="0 0 16 16">
            <path d="M2 2a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v13.5a.5.5 0 0 1-.777.416L8 13.101l-5.223 2.815A.5.5 0 0 1 2 15.5zm2-1a1 1 0 0 0-1 1v12.566l4.723-2.482a.5.5 0 0 1 .554 0L13 14.566V2a1 1 0 0 0-1-1z"/>
          </svg>
        ) : (
          <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="currentColor" viewBox="0 0 16 16">
            <path d="M2.678 11.894a1 1 0 0 1 .287.801 11 11 0 0 1-.398 2c1.395-.323 2.247-.697 2.634-.893a1 1 0 0 1 .71-.074A8 8 0 0 0 8 14c3.996 0 7-2.807 7-6s-3.004-6-7-6-7 2.808-7 6c0 1.468.617 2.83 1.678 3.894z"/>
          </svg>
        )}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-xs font-medium text-gray-200 truncate">{title}</p>
        {subtitle && <p className="text-[11px] text-gray-600 truncate mt-0.5">{subtitle}…</p>}
        <p className="text-[10px] text-gray-700 mt-1">Deleted {date}</p>
      </div>
      <div className="flex gap-1.5 shrink-0 opacity-0 group-hover:opacity-100 transition">
        <button
          onClick={onRestore}
          className="px-2 py-1 text-[11px] text-indigo-400 hover:text-indigo-300 bg-indigo-600/10 hover:bg-indigo-600/20 rounded-lg transition"
        >
          Restore
        </button>
        <button
          onClick={onDelete}
          className="px-2 py-1 text-[11px] text-red-400/70 hover:text-red-400 bg-red-600/10 hover:bg-red-600/20 rounded-lg transition"
        >
          Delete
        </button>
      </div>
    </div>
  );
}
