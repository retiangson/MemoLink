import React, { useRef, useState } from "react";
import { getReplySuggestions, sendEmailReply, getGmailReplySuggestions, sendGmailReply } from "../api/emailApi";
import { useRecording } from "../hooks/useRecording";
import { LANGUAGES } from "../utils/languages";
import { useEmailAttachments } from "../hooks/useEmailAttachments";
import { EmailAttachmentList } from "./EmailAttachmentList";

interface EmailReplyPanelProps {
  emailRecordId?: number | null;
  gmailMessageId?: string;
  emailAccountId?: number;
  senderName: string | null;
  senderEmail: string;
  subject: string;
  defaultOpen?: boolean;
}

export function EmailReplyPanel({ emailRecordId, gmailMessageId, emailAccountId, senderName, senderEmail, subject, defaultOpen = false }: EmailReplyPanelProps) {
  const [open, setOpen] = useState(defaultOpen);
  const [replyBody, setReplyBody] = useState("");
  const [suggesting, setSuggesting] = useState(false);
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; msg: string } | null>(null);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [language, setLanguage] = useState("en");
  const [isDraggingFile, setIsDraggingFile] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const attachments = useEmailAttachments();

  const recording = useRecording((text) => {
    setReplyBody((prev) => (prev ? `${prev}\n${text}` : text));
  });

  async function handleSuggest() {
    setSuggesting(true);
    setResult(null);
    const hint = replyBody.trim() || undefined;
    try {
      const replies = gmailMessageId
        ? await getGmailReplySuggestions(gmailMessageId, emailAccountId, hint)
        : await getReplySuggestions(emailRecordId!, hint);
      setSuggestions(replies);
      if (replies.length > 0) setReplyBody(replies[0]);
    } catch {
      setResult({ ok: false, msg: "Could not generate suggestions." });
    } finally {
      setSuggesting(false);
    }
  }

  async function handleSend() {
    if (!replyBody.trim()) return;
    setSending(true);
    setResult(null);
    try {
      if (gmailMessageId) {
        await sendGmailReply(gmailMessageId, replyBody.trim(), emailAccountId, attachments.readyAttachments);
      } else {
        await sendEmailReply(emailRecordId!, replyBody.trim(), attachments.readyAttachments);
      }
      setResult({ ok: true, msg: `✓ Reply sent to ${senderName || senderEmail}` });
      setReplyBody("");
      setSuggestions([]);
      attachments.reset();
    } catch (err: any) {
      setResult({ ok: false, msg: err?.response?.data?.detail ?? "Failed to send reply." });
    } finally {
      setSending(false);
    }
  }

  const displayName = senderName || senderEmail;
  const replySubject = subject.toLowerCase().startsWith("re:") ? subject : `Re: ${subject}`;

  return (
    <div className="border border-[var(--ml-bg-hover)] rounded-xl overflow-hidden">
      {/* Toggle header */}
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full px-4 py-2.5 bg-[var(--ml-bg-surface)] flex items-center gap-2 hover:bg-[#1e1e2c] transition"
      >
        <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5 text-indigo-400 shrink-0" fill="currentColor" viewBox="0 0 16 16">
          <path d="M.05 3.555A2 2 0 0 1 2 2h12a2 2 0 0 1 1.95 1.555L8 8.414zM0 4.697v7.104l5.803-3.558zM6.761 8.83l-6.57 4.026A2 2 0 0 0 2 14h12a2 2 0 0 0 1.808-1.144l-6.57-4.026L8 9.586zm3.436-.586L16 11.801V4.697z"/>
        </svg>
        <div className="min-w-0 flex-1 text-left">
          <p className="text-xs font-medium text-gray-300 truncate">Reply to {displayName}</p>
          <p className="text-[10px] text-gray-600 truncate">{replySubject}</p>
        </div>
        <svg
          xmlns="http://www.w3.org/2000/svg"
          className={`w-3.5 h-3.5 text-gray-500 shrink-0 transition-transform ${open ? "rotate-180" : ""}`}
          fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && <div className="p-3 space-y-2.5 border-t border-[var(--ml-bg-hover)]">
        {/* Suggestions picker */}
        {suggestions.length > 0 && (
          <div className="space-y-1.5">
            <p className="text-[10px] text-gray-500 uppercase tracking-wider">Suggestions - click to use</p>
            {suggestions.map((s, i) => (
              <button
                key={i}
                onClick={() => setReplyBody(s)}
                className={`w-full text-left px-3 py-2 rounded-lg text-xs transition border ${
                  replyBody === s
                    ? "border-indigo-500/50 bg-indigo-500/10 text-gray-200"
                    : "border-[var(--ml-bg-hover)] bg-[#0e0e16] text-gray-400 hover:border-indigo-500/30 hover:text-gray-300"
                }`}
              >
                <span className="text-[10px] text-indigo-500 mr-1.5 font-semibold">
                  {i === 0 ? "Formal" : i === 1 ? "Friendly" : "Brief"}
                </span>
                {s.slice(0, 80)}{s.length > 80 ? "…" : ""}
              </button>
            ))}
          </div>
        )}

        {/* Reply textarea */}
        <div
          className={`relative rounded-xl transition ${isDraggingFile ? "ring-2 ring-indigo-500/60" : ""}`}
          onDragOver={(e) => { e.preventDefault(); setIsDraggingFile(true); }}
          onDragLeave={() => setIsDraggingFile(false)}
          onDrop={(e) => {
            e.preventDefault();
            setIsDraggingFile(false);
            if (e.dataTransfer.files.length) attachments.addFiles(Array.from(e.dataTransfer.files));
          }}
        >
          <textarea
            value={replyBody}
            onChange={e => setReplyBody(e.target.value)}
            rows={3}
            placeholder="Write your reply…"
            className="w-full bg-[#0e0e16] border border-[var(--ml-bg-hover)] rounded-xl px-3 py-2.5 text-xs text-gray-200 placeholder-gray-700 outline-none focus:border-indigo-500 transition resize-y leading-relaxed"
          />
          {isDraggingFile && (
            <div className="absolute inset-0 flex items-center justify-center bg-indigo-500/10 border-2 border-dashed border-indigo-500/50 rounded-xl pointer-events-none">
              <p className="text-xs text-indigo-300 font-medium">Drop files to attach</p>
            </div>
          )}
        </div>

        <EmailAttachmentList items={attachments.items} onRemove={attachments.removeAttachment} />

        {/* Result */}
        {result && (
          <p className={`text-[11px] px-3 py-1.5 rounded-lg ${result.ok ? "bg-green-500/10 text-green-400" : "bg-red-500/10 text-red-400"}`}>
            {result.msg}
          </p>
        )}

        {/* Actions */}
        <div className="flex gap-2 flex-wrap">
          <button
            onClick={handleSuggest}
            disabled={suggesting || sending || recording.isRecording}
            className="flex items-center gap-1.5 px-3 py-2 bg-[var(--ml-bg-surface)] border border-[var(--ml-bg-hover)] hover:border-indigo-500/30 text-gray-400 hover:text-indigo-300 rounded-lg text-xs transition disabled:opacity-40"
          >
            {suggesting ? (
              <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
              </svg>
            ) : (
              <svg xmlns="http://www.w3.org/2000/svg" className="w-3 h-3" fill="currentColor" viewBox="0 0 16 16">
                <path d="M2 6a6 6 0 1 1 10.174 4.31c-.203.196-.359.4-.453.619l-.762 1.769A.5.5 0 0 1 10.5 13h-5a.5.5 0 0 1-.46-.302l-.761-1.77a2 2 0 0 0-.453-.618A5.98 5.98 0 0 1 2 6"/>
              </svg>
            )}
            {suggesting ? "Generating…" : "Suggest Reply"}
          </button>

          <button
            onClick={() => (recording.isRecording ? recording.stopRecording() : recording.startRecording("mic", { language }))}
            disabled={sending || suggesting}
            title={recording.isRecording ? "Stop recording" : "Record voice"}
            className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs transition disabled:opacity-40 border ${
              recording.isRecording
                ? "bg-red-500/10 border-red-500/30 text-red-400"
                : "bg-[var(--ml-bg-surface)] border-[var(--ml-bg-hover)] hover:border-indigo-500/30 text-gray-400 hover:text-indigo-300"
            }`}
          >
            {recording.isRecording ? (
              <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
            ) : (
              <svg xmlns="http://www.w3.org/2000/svg" className="w-3 h-3" fill="currentColor" viewBox="0 0 16 16">
                <path d="M3 6.5a.5.5 0 0 1 1 0V8a4 4 0 0 0 8 0V6.5a.5.5 0 0 1 1 0V8a5 5 0 0 1-4.5 4.975V15h2a.5.5 0 0 1 0 1h-5a.5.5 0 0 1 0-1h2v-2.025A5 5 0 0 1 3 8z"/>
                <path d="M10 8a2 2 0 1 1-4 0V3a2 2 0 1 1 4 0z"/>
              </svg>
            )}
            {recording.isRecording ? (recording.isTranscribing ? "Transcribing…" : "Recording…") : "Record"}
          </button>

          <select
            value={language}
            onChange={(e) => setLanguage(e.target.value)}
            disabled={sending || recording.isRecording}
            title="Recording language"
            className="bg-[var(--ml-bg-surface)] border border-[var(--ml-bg-hover)] hover:border-indigo-500/30 text-gray-400 rounded-lg text-xs px-2 outline-none focus:border-indigo-500 transition disabled:opacity-40"
          >
            {LANGUAGES.map((l) => (
              <option key={l.code} value={l.code}>{l.label}</option>
            ))}
          </select>

          <input
            type="file"
            multiple
            hidden
            ref={fileInputRef}
            onChange={(e) => { if (e.target.files?.length) attachments.addFiles(Array.from(e.target.files)); e.target.value = ""; }}
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={sending}
            title="Attach files"
            className="flex items-center gap-1.5 px-3 py-2 bg-[var(--ml-bg-surface)] border border-[var(--ml-bg-hover)] hover:border-indigo-500/30 text-gray-400 hover:text-indigo-300 rounded-lg text-xs transition disabled:opacity-40"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="w-3 h-3" fill="currentColor" viewBox="0 0 16 16">
              <path d="M4.5 3a2.5 2.5 0 0 1 5 0v9a1.5 1.5 0 0 1-3 0V5a.5.5 0 0 1 1 0v7a.5.5 0 0 0 1 0V3a1.5 1.5 0 1 0-3 0v9a2.5 2.5 0 0 0 5 0V5a.5.5 0 0 1 1 0v7a3.5 3.5 0 1 1-7 0z" />
            </svg>
            Attach
          </button>

          <button
            onClick={handleSend}
            disabled={!replyBody.trim() || sending || suggesting || recording.isRecording || attachments.isUploading}
            className="flex items-center gap-1.5 px-3 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white rounded-lg text-xs font-medium transition ml-auto"
          >
            {sending ? (
              <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
              </svg>
            ) : (
              <svg xmlns="http://www.w3.org/2000/svg" className="w-3 h-3" fill="currentColor" viewBox="0 0 16 16">
                <path d="M15.964.686a.5.5 0 0 0-.65-.65L.767 5.855H.766l-.452.18a.5.5 0 0 0-.082.887l.41.26.001.002 4.995 3.178 3.178 4.995.002.002.26.41a.5.5 0 0 0 .886-.083zm-1.833 1.89L6.637 10.07l-.215-.338a.5.5 0 0 0-.154-.154l-.338-.215 7.494-7.494 1.178-.471z"/>
              </svg>
            )}
            {sending ? "Sending…" : "Send Reply"}
          </button>
        </div>
      </div>}
    </div>
  );
}
