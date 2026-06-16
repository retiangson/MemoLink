import React, { useState } from "react";
import type { EmailRecord } from "../api/emailApi";
import { emailToNote } from "../api/emailApi";
import { EmailReplyPanel } from "./EmailReplyPanel";

interface EmailDetailModalProps {
  email: EmailRecord | null;
  isPinned: boolean;
  linkedReminderId?: number | null;
  onClose: () => void;
  onPinEmail: (emailId: number) => Promise<void>;
  onUnpinReminder: (reminderId: number) => void;
  onDeleteEmail: (emailId: number) => Promise<void>;
  onNoteSaved?: () => void;
}

export function EmailDetailModal({
  email,
  isPinned,
  linkedReminderId,
  onClose,
  onPinEmail,
  onUnpinReminder,
  onDeleteEmail,
  onNoteSaved,
}: EmailDetailModalProps) {
  const [pinLoading, setPinLoading] = useState(false);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [noteResult, setNoteResult] = useState<string | null>(null);
  const [noteSaving, setNoteSaving] = useState(false);

  if (!email) return null;

  async function handlePin() {
    setPinLoading(true);
    try { await onPinEmail(email!.id); } finally { setPinLoading(false); }
  }

  async function handleDelete() {
    setDeleteLoading(true);
    try { await onDeleteEmail(email!.id); onClose(); } finally { setDeleteLoading(false); }
  }

  async function handleSaveNote() {
    setNoteSaving(true);
    setNoteResult(null);
    try {
      const res = await emailToNote(email!.id);
      setNoteResult(`✓ Saved as "${res.title}"`);
      onNoteSaved?.();
    } catch {
      setNoteResult("✗ Failed to save note");
    } finally {
      setNoteSaving(false);
    }
  }

  const dateLabel = email.email_date
    ? new Date(email.email_date).toLocaleString(undefined, {
        month: "short", day: "numeric", year: "numeric",
        hour: "numeric", minute: "2-digit",
      })
    : null;

  return (
    <div
      className="fixed inset-0 bg-black/70 flex items-center justify-center z-[200] p-4"
      onClick={onClose}
    >
      <div
        className="bg-[#1a1a24] border border-[var(--ml-bg-hover)] rounded-2xl w-full max-w-lg shadow-2xl flex flex-col max-h-[90vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start gap-3 px-5 py-4 border-b border-[var(--ml-bg-hover)] shrink-0">
          <div className="flex-1 min-w-0">
            <h3 className="text-sm font-semibold text-gray-100 leading-snug break-words">{email.subject}</h3>
            <p className="text-xs text-gray-500 mt-1">
              From: <span className="text-gray-400">{email.sender_name ? `${email.sender_name} <${email.sender_email}>` : email.sender_email}</span>
            </p>
            {dateLabel && <p className="text-[11px] text-gray-600 mt-0.5">{dateLabel}</p>}
          </div>
          <button
            onClick={onClose}
            className="text-gray-600 hover:text-gray-300 transition text-lg leading-none shrink-0 mt-0.5"
          >✕</button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {/* Snippet / body */}
          {email.snippet && (
            <div className="bg-[var(--ml-bg-surface)] rounded-xl px-4 py-3">
              <p className="text-xs text-gray-300 leading-relaxed whitespace-pre-wrap">{email.snippet}</p>
            </div>
          )}

          {/* AI Reply Panel */}
          <EmailReplyPanel
            emailRecordId={email.id}
            senderName={email.sender_name}
            senderEmail={email.sender_email}
            subject={email.subject}
            defaultOpen={true}
          />

          {/* Note save result */}
          {noteResult && (
            <p className={`text-xs px-3 py-2 rounded-lg ${noteResult.startsWith("✓") ? "bg-green-500/10 text-green-400" : "bg-red-500/10 text-red-400"}`}>
              {noteResult}
            </p>
          )}
        </div>

        {/* Footer actions */}
        <div className="flex items-center gap-2 flex-wrap px-5 py-4 border-t border-[var(--ml-bg-hover)] shrink-0">
          {/* Pin / Unpin */}
          {isPinned ? (
            <button
              onClick={() => linkedReminderId != null && onUnpinReminder(linkedReminderId)}
              className="text-xs px-3 py-2 rounded-xl border border-red-500/25 text-red-400 hover:bg-red-500/10 transition"
            >
              Unpin Reminder
            </button>
          ) : (
            <button
              onClick={handlePin}
              disabled={pinLoading}
              className="text-xs px-3 py-2 rounded-xl border border-blue-500/25 text-blue-400 hover:bg-blue-500/10 transition disabled:opacity-40"
            >
              {pinLoading ? "Pinning…" : "📌 Pin as Reminder"}
            </button>
          )}

          {/* Save as Note */}
          <button
            onClick={handleSaveNote}
            disabled={noteSaving}
            className="text-xs px-3 py-2 rounded-xl border border-indigo-500/25 text-indigo-400 hover:bg-indigo-500/10 transition disabled:opacity-40"
          >
            {noteSaving ? "Saving…" : "Save as Note"}
          </button>

          {/* Delete */}
          <button
            onClick={handleDelete}
            disabled={deleteLoading}
            className="text-xs px-3 py-2 rounded-xl border border-gray-700 text-gray-500 hover:text-red-400 hover:border-red-500/25 transition ml-auto disabled:opacity-40"
          >
            {deleteLoading ? "Deleting…" : "Delete"}
          </button>
        </div>
      </div>
    </div>
  );
}
