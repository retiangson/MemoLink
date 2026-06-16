import React, { useRef, useState } from "react";

interface AddReminderModalProps {
  onClose: () => void;
  onAdd: (title: string, description: string | null, due_date: string | null, due_time: string | null) => void;
}

export function AddReminderModal({ onClose, onAdd }: AddReminderModalProps) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [dueTime, setDueTime] = useState("");
  const titleRef = useRef<HTMLInputElement>(null);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const t = title.trim();
    if (!t) return;
    onAdd(t, description.trim() || null, dueDate || null, dueTime || null);
    onClose();
  }

  return (
    <div
      className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4"
      onClick={onClose}
    >
      <div
        className="bg-[#1a1a24] border border-[var(--ml-bg-hover)] rounded-2xl w-full max-w-md shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--ml-bg-hover)]">
          <h2 className="text-sm font-semibold text-white">Add Reminder</h2>
          <button
            onClick={onClose}
            className="w-7 h-7 flex items-center justify-center rounded-lg text-gray-500 hover:text-gray-200 hover:bg-[var(--ml-bg-hover)] transition"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="px-5 py-4 space-y-4">
          {/* Title */}
          <div>
            <label className="block text-[11px] text-gray-500 uppercase tracking-wider mb-1.5">
              Title <span className="text-red-500">*</span>
            </label>
            <input
              ref={titleRef}
              autoFocus
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Submit assignment, Call dentist…"
              className="w-full bg-[var(--ml-bg-surface)] border border-[var(--ml-bg-hover)] rounded-xl px-3 py-2.5 text-sm text-gray-200 placeholder-gray-600 outline-none focus:border-indigo-500 transition"
            />
          </div>

          {/* Description */}
          <div>
            <label className="block text-[11px] text-gray-500 uppercase tracking-wider mb-1.5">
              Description
              <span className="normal-case tracking-normal text-gray-600 ml-1">(optional)</span>
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              placeholder="Add more context or detail about this reminder…"
              className="w-full bg-[var(--ml-bg-surface)] border border-[var(--ml-bg-hover)] rounded-xl px-3 py-2.5 text-sm text-gray-200 placeholder-gray-600 outline-none focus:border-indigo-500 transition resize-none leading-relaxed"
            />
          </div>

          {/* Date + Time */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] text-gray-500 uppercase tracking-wider mb-1.5">Due Date</label>
              <input
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                className="w-full bg-[var(--ml-bg-surface)] border border-[var(--ml-bg-hover)] rounded-xl px-3 py-2.5 text-sm text-gray-200 outline-none focus:border-indigo-500 transition [color-scheme:dark]"
              />
            </div>
            <div>
              <label className="block text-[11px] text-gray-500 uppercase tracking-wider mb-1.5">Due Time</label>
              <input
                type="time"
                value={dueTime}
                onChange={(e) => setDueTime(e.target.value)}
                className="w-full bg-[var(--ml-bg-surface)] border border-[var(--ml-bg-hover)] rounded-xl px-3 py-2.5 text-sm text-gray-200 outline-none focus:border-indigo-500 transition [color-scheme:dark]"
              />
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs text-gray-400 hover:text-gray-200 hover:bg-[var(--ml-bg-hover)] rounded-xl transition"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!title.trim()}
              className="px-5 py-2 text-xs font-medium bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-xl transition"
            >
              Add Reminder
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
