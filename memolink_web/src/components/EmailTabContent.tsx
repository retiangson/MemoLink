import React, { useEffect, useState } from "react";
import type { BrowseEmailResult } from "../api/emailApi";
import { emailToNote, gmailEmailToNote, getAttachmentDownloadUrl } from "../api/emailApi";
import { EmailReplyPanel } from "./EmailReplyPanel";
import { EmailHtmlBody } from "./EmailHtmlBody";
import { useTTS } from "../hooks/useTTS";

function formatAttachmentSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

interface EmailTabContentProps {
  email: BrowseEmailResult;
  actionLoading?: boolean;
  onArchive: () => Promise<void>;
  onTrash: () => Promise<void>;
  onTogglePin: () => Promise<void>;
}

export function EmailTabContent({ email, actionLoading, onArchive, onTrash, onTogglePin }: EmailTabContentProps) {
  const [noteResult, setNoteResult] = useState<string | null>(null);
  const [noteSaving, setNoteSaving] = useState(false);
  const tts = useTTS();

  useEffect(() => {
    return () => tts.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [email.gmail_message_id, email.id]);

  function handleReadAloud() {
    if (tts.playing) {
      tts.stop();
      return;
    }
    const text = email.body_text || email.snippet || "";
    if (text.trim()) tts.speak(text);
  }

  async function handleSaveNote() {
    setNoteSaving(true);
    setNoteResult(null);
    try {
      const res = email.id != null
        ? await emailToNote(email.id)
        : await gmailEmailToNote(email.gmail_message_id as string, email.email_account_id ?? undefined);
      setNoteResult(`✓ Saved as "${res.title}"`);
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
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="flex items-start gap-3 px-5 py-4 border-b border-[var(--ml-bg-hover)] shrink-0">
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-semibold text-gray-100 leading-snug break-words">{email.subject || "(no subject)"}</h3>
          <p className="text-xs text-gray-500 mt-1">
            From: <span className="text-gray-400">{email.sender_name ? `${email.sender_name} <${email.sender_email}>` : email.sender_email}</span>
          </p>
          {dateLabel && <p className="text-[11px] text-gray-600 mt-0.5">{dateLabel}</p>}
        </div>
        <button
          onClick={handleReadAloud}
          title={tts.playing ? "Stop reading" : "Read aloud"}
          className={`shrink-0 flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs border transition ${
            tts.playing
              ? "border-indigo-500/40 text-indigo-400 bg-indigo-500/10"
              : "border-[var(--ml-bg-hover)] text-gray-500 hover:text-indigo-300 hover:border-indigo-500/30"
          }`}
        >
          {tts.playing ? (
            <svg xmlns="http://www.w3.org/2000/svg" className="w-3 h-3" fill="currentColor" viewBox="0 0 16 16">
              <path d="M5 3.5a.5.5 0 0 1 .5-.5h1a.5.5 0 0 1 .5.5v9a.5.5 0 0 1-.5.5h-1a.5.5 0 0 1-.5-.5zm4 0a.5.5 0 0 1 .5-.5h1a.5.5 0 0 1 .5.5v9a.5.5 0 0 1-.5.5h-1a.5.5 0 0 1-.5-.5z"/>
            </svg>
          ) : (
            <svg xmlns="http://www.w3.org/2000/svg" className="w-3 h-3" fill="currentColor" viewBox="0 0 16 16">
              <path d="M11.536 14.01A8.47 8.47 0 0 0 14.026 8a8.47 8.47 0 0 0-2.49-6.01l-.708.707A7.48 7.48 0 0 1 13.025 8c0 2.071-.84 3.946-2.197 5.303z"/>
              <path d="M10.121 12.596A6.48 6.48 0 0 0 12.025 8a6.48 6.48 0 0 0-1.904-4.596l-.707.707A5.48 5.48 0 0 1 11.025 8a5.48 5.48 0 0 1-1.61 3.89z"/>
              <path d="M8.707 11.182A4.5 4.5 0 0 0 10.025 8a4.5 4.5 0 0 0-1.318-3.182L8 5.525A3.5 3.5 0 0 1 9.025 8 3.5 3.5 0 0 1 8 10.475zM6.717 3.55A.5.5 0 0 1 7 4v8a.5.5 0 0 1-.812.39L3.825 10.5H1.5A.5.5 0 0 1 1 10V6a.5.5 0 0 1 .5-.5h2.325l2.363-1.89a.5.5 0 0 1 .529-.06"/>
            </svg>
          )}
          {tts.playing ? "Stop" : "Read aloud"}
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
        {email.body_html ? (
          <EmailHtmlBody
            bodyHtml={email.body_html}
            attachments={email.attachments || []}
            gmailMessageId={(email.gmail_message_id as string) ?? ""}
            emailAccountId={email.email_account_id}
          />
        ) : (
          <div className="bg-[var(--ml-bg-surface)] rounded-xl px-4 py-3">
            <p className="text-xs text-gray-300 leading-relaxed whitespace-pre-wrap">
              {email.body_text || email.snippet || "(no content)"}
            </p>
          </div>
        )}

        {!!email.attachments?.filter((a) => !a.is_inline).length && (
          <div className="space-y-1.5">
            <p className="text-[10px] text-gray-500 uppercase tracking-wider">Attachments</p>
            <div className="flex flex-wrap gap-2">
              {email.attachments!.filter((a) => !a.is_inline).map((a) => (
                <a
                  key={a.attachment_id}
                  href={getAttachmentDownloadUrl({
                    gmailMessageId: (email.gmail_message_id as string) ?? "",
                    attachmentId: a.attachment_id,
                    filename: a.filename,
                    emailAccountId: email.email_account_id,
                  })}
                  target="_blank"
                  rel="noopener noreferrer"
                  title={a.filename}
                  className="flex items-center gap-2 pl-2 pr-3 py-1.5 rounded-lg border border-[var(--ml-bg-hover)] bg-[var(--ml-bg-surface)] text-gray-300 text-xs hover:border-indigo-500/30 hover:text-indigo-300 transition"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5 text-gray-500 shrink-0" fill="currentColor" viewBox="0 0 16 16">
                    <path d="M4.5 3a2.5 2.5 0 0 1 5 0v9a1.5 1.5 0 0 1-3 0V5a.5.5 0 0 1 1 0v7a.5.5 0 0 0 1 0V3a1.5 1.5 0 1 0-3 0v9a2.5 2.5 0 0 0 5 0V5a.5.5 0 0 1 1 0v7a3.5 3.5 0 1 1-7 0z" />
                  </svg>
                  <span className="max-w-[160px] truncate">{a.filename}</span>
                  <span className="text-gray-600 shrink-0">{formatAttachmentSize(a.size)}</span>
                </a>
              ))}
            </div>
          </div>
        )}

        <EmailReplyPanel
          emailRecordId={email.id}
          gmailMessageId={email.id == null ? (email.gmail_message_id as string) : undefined}
          emailAccountId={email.email_account_id ?? undefined}
          senderName={email.sender_name}
          senderEmail={email.sender_email}
          subject={email.subject}
          defaultOpen={false}
        />

        {noteResult && (
          <p className={`text-xs px-3 py-2 rounded-lg ${noteResult.startsWith("✓") ? "bg-green-500/10 text-green-400" : "bg-red-500/10 text-red-400"}`}>
            {noteResult}
          </p>
        )}
      </div>

      <div className="flex items-center gap-2 flex-wrap px-5 py-4 border-t border-[var(--ml-bg-hover)] shrink-0">
        <button
          onClick={onTogglePin}
          disabled={actionLoading}
          className={`text-xs px-3 py-2 rounded-xl border transition disabled:opacity-40 ${
            email.is_pinned
              ? "border-blue-500/40 text-blue-400 bg-blue-500/10"
              : "border-blue-500/25 text-blue-400 hover:bg-blue-500/10"
          }`}
        >
          {email.is_pinned ? "📌 Unpin" : "📌 Pin"}
        </button>

        <button
          onClick={handleSaveNote}
          disabled={noteSaving}
          className="text-xs px-3 py-2 rounded-xl border border-indigo-500/25 text-indigo-400 hover:bg-indigo-500/10 transition disabled:opacity-40"
        >
          {noteSaving ? "Saving…" : "Save as Note"}
        </button>

        <button
          onClick={onArchive}
          disabled={actionLoading}
          className="text-xs px-3 py-2 rounded-xl border border-amber-500/25 text-amber-400 hover:bg-amber-500/10 transition disabled:opacity-40 ml-auto"
        >
          {actionLoading ? "Working…" : "Archive"}
        </button>

        <button
          onClick={onTrash}
          disabled={actionLoading}
          className="text-xs px-3 py-2 rounded-xl border border-gray-700 text-gray-500 hover:text-red-400 hover:border-red-500/25 transition disabled:opacity-40"
        >
          {actionLoading ? "Working…" : "Trash"}
        </button>
      </div>
    </div>
  );
}
