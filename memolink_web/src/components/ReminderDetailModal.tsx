import React, { useEffect, useState } from "react";
import type { SuggestionItem } from "../hooks/useSuggestions";
import { buildGoogleCalendarUrl } from "../utils/reminderUtils";
import { getEmail } from "../api/emailApi";
import type { EmailRecord } from "../api/emailApi";
import { EmailReplyPanel } from "./EmailReplyPanel";

interface ReminderDetailModalProps {
  item: SuggestionItem | null;
  onClose: () => void;
  onSave: (id: number, fields: { text: string; description: string | null; due_date: string | null; due_time: string | null; done: boolean }) => void;
  onDelete: (id: number) => void;
  onToggleDone: (id: number) => void;
}

export function ReminderDetailModal({ item, onClose, onSave, onDelete, onToggleDone }: ReminderDetailModalProps) {
  const [text, setText] = useState("");
  const [description, setDescription] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [dueTime, setDueTime] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [linkedEmail, setLinkedEmail] = useState<EmailRecord | null>(null);

  useEffect(() => {
    if (item) {
      setText(item.text);
      setDescription(item.description ?? "");
      setDueDate(item.due_date ?? "");
      setDueTime(item.due_time ?? "");
      setConfirmDelete(false);
      setLinkedEmail(null);
      if (item.email_record_id) {
        getEmail(item.email_record_id).then(setLinkedEmail).catch(() => {});
      }
    }
  }, [item]);

  if (!item) return null;

  const isDirty =
    text.trim() !== item.text ||
    (description.trim() || null) !== item.description ||
    (dueDate || null) !== item.due_date ||
    (dueTime || null) !== item.due_time;

  function handleSave() {
    if (!text.trim()) return;
    onSave(item!.id, {
      text: text.trim(),
      description: description.trim() || null,
      due_date: dueDate || null,
      due_time: dueTime || null,
      done: item!.done,
    });
    onClose();
  }

  function handleDelete() {
    if (!confirmDelete) { setConfirmDelete(true); return; }
    onDelete(item!.id);
    onClose();
  }

  const _d = new Date();
  const today = `${_d.getFullYear()}-${String(_d.getMonth() + 1).padStart(2, "0")}-${String(_d.getDate()).padStart(2, "0")}`;
  const isToday = !item.done && item.due_date === today;
  const isOverdue = !item.done && item.due_date && item.due_date < today;

  function formatDate(d: string) {
    if (!d) return "";
    const [y, m, day] = d.split("-");
    const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
    return `${months[parseInt(m) - 1]} ${parseInt(day)}, ${y}`;
  }

  function formatTime(t: string) {
    if (!t) return "";
    const [h, m] = t.split(":").map(Number);
    const ampm = h >= 12 ? "PM" : "AM";
    const hour = h % 12 || 12;
    return `${hour}:${String(m).padStart(2, "0")} ${ampm}`;
  }

  return (
    <div
      className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4"
      onClick={onClose}
    >
      <div
        className={`bg-[#1a1a24] border border-[#2a2a38] rounded-2xl w-full shadow-2xl flex flex-col max-h-[90vh] ${linkedEmail ? "max-w-lg" : "max-w-md"}`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#2a2a38]">
          <div className="flex items-center gap-2">
            {item.type === "ai" ? (
              <span className="flex items-center gap-1 text-[10px] font-semibold text-indigo-400 bg-indigo-500/10 border border-indigo-500/20 px-2 py-0.5 rounded-full uppercase tracking-wider">
                <svg xmlns="http://www.w3.org/2000/svg" className="w-2.5 h-2.5" fill="currentColor" viewBox="0 0 16 16">
                  <path d="M2 6a6 6 0 1 1 10.174 4.31c-.203.196-.359.4-.453.619l-.762 1.769A.5.5 0 0 1 10.5 13h-5a.5.5 0 0 1-.46-.302l-.761-1.77a2 2 0 0 0-.453-.618A5.98 5.98 0 0 1 2 6"/>
                </svg>
                AI Suggestion
              </span>
            ) : (
              <span className="flex items-center gap-1 text-[10px] font-semibold text-gray-400 bg-[#252533] border border-[#2a2a38] px-2 py-0.5 rounded-full uppercase tracking-wider">
                <svg xmlns="http://www.w3.org/2000/svg" className="w-2.5 h-2.5" fill="currentColor" viewBox="0 0 16 16">
                  <path d="M8 15A7 7 0 1 0 8 1a7 7 0 0 0 0 14m0 1A8 8 0 1 1 8 0a8 8 0 0 1 0 16"/>
                  <path d="M8 4a.5.5 0 0 1 .5.5v3h3a.5.5 0 0 1 0 1h-3v3a.5.5 0 0 1-1 0v-3h-3a.5.5 0 0 1 0-1h3v-3A.5.5 0 0 1 8 4"/>
                </svg>
                Reminder
              </span>
            )}

            {/* Status badge */}
            {item.done ? (
              <span className="text-[10px] font-semibold text-green-400 bg-green-500/10 border border-green-500/20 px-2 py-0.5 rounded-full uppercase tracking-wider">
                Done
              </span>
            ) : isOverdue ? (
              <span className="text-[10px] font-semibold text-red-400 bg-red-500/10 border border-red-500/20 px-2 py-0.5 rounded-full uppercase tracking-wider">
                Overdue
              </span>
            ) : isToday ? (
              <span className="text-[10px] font-semibold text-amber-400 bg-amber-500/10 border border-amber-500/20 px-2 py-0.5 rounded-full uppercase tracking-wider">
                Due Today
              </span>
            ) : null}
          </div>

          <button
            onClick={onClose}
            className="w-7 h-7 flex items-center justify-center rounded-lg text-gray-500 hover:text-gray-200 hover:bg-[#2a2a38] transition"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="px-5 py-4 space-y-4 overflow-y-auto flex-1">
          {/* Title */}
          <div>
            <label className="block text-[11px] text-gray-500 uppercase tracking-wider mb-1.5">Title</label>
            <input
              type="text"
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Short title…"
              className="w-full bg-[#12121a] border border-[#2a2a38] rounded-xl px-3 py-2.5 text-sm text-gray-200 outline-none focus:border-indigo-500 transition"
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
              placeholder="Add more context or detail…"
              className="w-full bg-[#12121a] border border-[#2a2a38] rounded-xl px-3 py-2.5 text-sm text-gray-200 placeholder-gray-700 outline-none focus:border-indigo-500 transition resize-none leading-relaxed"
            />
          </div>

          {/* Date + Time row */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] text-gray-500 uppercase tracking-wider mb-1.5">Due Date</label>
              <input
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                className="w-full bg-[#12121a] border border-[#2a2a38] rounded-xl px-3 py-2 text-sm text-gray-200 outline-none focus:border-indigo-500 transition [color-scheme:dark]"
              />
            </div>
            <div>
              <label className="block text-[11px] text-gray-500 uppercase tracking-wider mb-1.5">Due Time</label>
              <input
                type="time"
                value={dueTime}
                onChange={(e) => setDueTime(e.target.value)}
                className="w-full bg-[#12121a] border border-[#2a2a38] rounded-xl px-3 py-2 text-sm text-gray-200 outline-none focus:border-indigo-500 transition [color-scheme:dark]"
              />
            </div>
          </div>

          {/* Current schedule summary */}
          {(item.due_date || item.due_time) && (
            <div className={`flex items-center gap-2 text-xs rounded-xl px-3 py-2 ${
              isOverdue
                ? "bg-red-500/10 border border-red-500/20 text-red-400"
                : isToday
                  ? "bg-amber-500/10 border border-amber-500/20 text-amber-400"
                  : "bg-[#12121a] border border-[#2a2a38] text-gray-500"
            }`}>
              <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5 shrink-0" fill="currentColor" viewBox="0 0 16 16">
                <path d="M11 6.5a.5.5 0 0 1 .5-.5h1a.5.5 0 0 1 .5.5v1a.5.5 0 0 1-.5.5h-1a.5.5 0 0 1-.5-.5z"/>
                <path d="M3.5 0a.5.5 0 0 1 .5.5V1h8V.5a.5.5 0 0 1 1 0V1h1a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H2a2 2 0 0 1-2-2V3a2 2 0 0 1 2-2h1V.5a.5.5 0 0 1 .5-.5M1 4v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V4z"/>
              </svg>
              <span>
                {item.due_date ? formatDate(item.due_date) : "No date"}
                {item.due_time ? ` at ${formatTime(item.due_time)}` : ""}
                {isOverdue ? " - overdue" : isToday ? " - due today" : ""}
              </span>
            </div>
          )}

          {/* Email reply - shown when reminder was created from an email */}
          {linkedEmail && (
            <div className="space-y-2">
              <div className="flex items-center gap-2 px-3 py-2 bg-[#12121a] border border-[#2a2a38] rounded-xl">
                <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5 text-blue-400 shrink-0" fill="currentColor" viewBox="0 0 16 16">
                  <path d="M0 4a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H2a2 2 0 0 1-2-2zm2-1a1 1 0 0 0-1 1v.217l7 4.2 7-4.2V4a1 1 0 0 0-1-1zm13 2.383-4.708 2.825L15 11.105zm-.034 6.876-5.64-3.471L8 9.583l-1.326-.795-5.64 3.47A1 1 0 0 0 2 13h12a1 1 0 0 0 .966-.741M1 11.105l4.708-2.897L1 5.383z"/>
                </svg>
                <div className="min-w-0">
                  <p className="text-[11px] text-gray-300 truncate font-medium">{linkedEmail.subject}</p>
                  <p className="text-[10px] text-gray-600 truncate">from {linkedEmail.sender_name || linkedEmail.sender_email}</p>
                </div>
              </div>
              <EmailReplyPanel
                emailRecordId={linkedEmail.id}
                senderName={linkedEmail.sender_name}
                senderEmail={linkedEmail.sender_email}
                subject={linkedEmail.subject}
              />
            </div>
          )}

          {/* Mark done toggle */}
          <button
            onClick={() => { onToggleDone(item.id); onClose(); }}
            className={`w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-medium transition border ${
              item.done
                ? "bg-[#12121a] border-[#2a2a38] text-gray-400 hover:text-gray-200 hover:border-[#3a3a4a]"
                : "bg-green-500/10 border-green-500/20 text-green-400 hover:bg-green-500/20"
            }`}
          >
            {item.done ? (
              <>
                <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 4l16 16M4 20L20 4" />
                </svg>
                Mark as Pending
              </>
            ) : (
              <>
                <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
                Mark as Done
              </>
            )}
          </button>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-5 py-4 border-t border-[#2a2a38] bg-[#12121a]/50">
          <button
            onClick={handleDelete}
            className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs transition ${
              confirmDelete
                ? "bg-red-600 text-white hover:bg-red-500"
                : "text-red-500/70 hover:text-red-400 hover:bg-red-500/10"
            }`}
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 16 16">
              <path d="M5.5 5.5A.5.5 0 0 1 6 6v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5m2.5 0a.5.5 0 0 1 .5.5v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5m3 .5a.5.5 0 0 0-1 0v6a.5.5 0 0 0 1 0z"/>
              <path d="M14.5 3a1 1 0 0 1-1 1H13v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V4h-.5a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1H6a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1h3.5a1 1 0 0 1 1 1zM4.118 4 4 4.059V13a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V4.059L11.882 4zM2.5 3h11V2h-11z"/>
            </svg>
            {confirmDelete ? "Confirm Delete" : "Delete"}
          </button>

          <div className="flex items-center gap-2">
            {item.due_date && (
              <a
                href={buildGoogleCalendarUrl(item.text, item.description, item.due_date, item.due_time)}
                target="_blank"
                rel="noopener noreferrer"
                title="Add to Google Calendar"
                className="flex items-center gap-1.5 px-3 py-2 text-xs text-gray-400 hover:text-indigo-300 hover:bg-indigo-500/10 rounded-xl transition"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 16 16">
                  <path d="M3.5 0a.5.5 0 0 1 .5.5V1h8V.5a.5.5 0 0 1 1 0V1h1a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H2a2 2 0 0 1-2-2V3a2 2 0 0 1 2-2h1V.5a.5.5 0 0 1 .5-.5M1 4v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V4z"/>
                </svg>
                Add to Calendar
              </a>
            )}
            <button
              onClick={onClose}
              className="px-4 py-2 text-xs text-gray-400 hover:text-gray-200 hover:bg-[#2a2a38] rounded-xl transition"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={!text.trim() || !isDirty}
              className="px-4 py-2 text-xs font-medium bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-xl transition"
            >
              Save Changes
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
