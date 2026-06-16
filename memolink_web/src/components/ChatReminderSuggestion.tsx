import React, { useState } from "react";

interface Props {
  text: string;
  due_date: string | null;
  due_time: string | null;
  onAdd: (text: string, due_date: string | null, due_time: string | null) => void;
  onDismiss: () => void;
}

export function ChatReminderSuggestion({ text, due_date, due_time, onAdd, onDismiss }: Props) {
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState(text);
  const [editDate, setEditDate] = useState(due_date ?? "");
  const [editTime, setEditTime] = useState(due_time ?? "");

  function handleAdd() {
    onAdd(text, due_date, due_time);
  }

  function handleConfirmEdit() {
    if (!editText.trim()) return;
    onAdd(editText.trim(), editDate || null, editTime || null);
  }

  const dateLabel = due_date
    ? new Date(due_date + "T00:00:00").toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })
    : null;

  return (
    <div className="mx-3 mb-2 rounded-xl border border-indigo-500/30 bg-indigo-500/5 overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 pt-2.5 pb-1">
        <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5 text-indigo-400 shrink-0" fill="currentColor" viewBox="0 0 16 16">
          <path d="M2 6a6 6 0 1 1 10.174 4.31c-.203.196-.359.4-.453.619l-.762 1.769A.5.5 0 0 1 10.5 13h-5a.5.5 0 0 1-.46-.302l-.761-1.77a2 2 0 0 0-.453-.618A5.98 5.98 0 0 1 2 6m3 8.5a.5.5 0 0 1 .5-.5h5a.5.5 0 0 1 0 1l-.224.447a1 1 0 0 1-.894.553H6.618a1 1 0 0 1-.894-.553L5.5 15a.5.5 0 0 1-.5-.5"/>
        </svg>
        <span className="text-[10px] font-semibold text-indigo-400 uppercase tracking-wider flex-1">
          Reminder detected
        </span>
        <button
          onClick={onDismiss}
          className="text-gray-600 hover:text-gray-300 transition text-sm leading-none"
          title="Dismiss"
        >✕</button>
      </div>

      <div className="px-3 pb-3 space-y-2">
        {editing ? (
          /* Edit mode */
          <>
            <textarea
              value={editText}
              onChange={(e) => setEditText(e.target.value)}
              rows={2}
              className="w-full bg-[var(--ml-bg-base)] border border-indigo-500/30 rounded-lg px-2.5 py-1.5 text-xs text-gray-200 outline-none focus:border-indigo-500 resize-none leading-relaxed"
            />
            <div className="flex gap-2">
              <input
                type="date"
                value={editDate}
                onChange={(e) => setEditDate(e.target.value)}
                className="flex-1 bg-[var(--ml-bg-base)] border border-[var(--ml-bg-hover)] rounded-lg px-2 py-1 text-[11px] text-gray-300 outline-none focus:border-indigo-500"
              />
              <input
                type="time"
                value={editTime}
                onChange={(e) => setEditTime(e.target.value)}
                className="flex-1 bg-[var(--ml-bg-base)] border border-[var(--ml-bg-hover)] rounded-lg px-2 py-1 text-[11px] text-gray-300 outline-none focus:border-indigo-500"
              />
            </div>
            <div className="flex gap-2">
              <button
                onClick={handleConfirmEdit}
                disabled={!editText.trim()}
                className="flex-1 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium transition disabled:opacity-40"
              >
                ✓ Confirm &amp; Add
              </button>
              <button
                onClick={() => { setEditing(false); setEditText(text); setEditDate(due_date ?? ""); setEditTime(due_time ?? ""); }}
                className="px-3 py-1.5 rounded-lg border border-[var(--ml-bg-hover)] text-gray-400 hover:text-gray-200 text-xs transition"
              >
                Cancel
              </button>
            </div>
          </>
        ) : (
          /* Preview mode */
          <>
            <p className="text-xs text-gray-200 leading-snug">{text}</p>
            {(dateLabel || due_time) && (
              <div className="flex items-center gap-1.5 text-[11px] text-indigo-400/80">
                <svg xmlns="http://www.w3.org/2000/svg" className="w-3 h-3 shrink-0" fill="currentColor" viewBox="0 0 16 16">
                  <path d="M3.5 0a.5.5 0 0 1 .5.5V1h8V.5a.5.5 0 0 1 1 0V1h1a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H2a2 2 0 0 1-2-2V3a2 2 0 0 1 2-2h1V.5a.5.5 0 0 1 .5-.5M1 4v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V4z"/>
                </svg>
                <span>{[dateLabel, due_time].filter(Boolean).join(" at ")}</span>
              </div>
            )}
            <div className="flex gap-2 pt-0.5">
              <button
                onClick={handleAdd}
                className="flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium transition"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
                Add Reminder
              </button>
              <button
                onClick={() => setEditing(true)}
                className="px-3 py-1.5 rounded-lg border border-indigo-500/30 text-indigo-400 hover:bg-indigo-500/10 text-xs transition"
              >
                ✏ Edit
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
