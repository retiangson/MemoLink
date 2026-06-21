import React, { useRef, useState } from "react";
import { sendNewMail, composeSuggest, type EmailAccount } from "../api/emailApi";
import { RichNoteEditor } from "./RichNoteEditor";
import { useRecording } from "../hooks/useRecording";
import { LANGUAGES } from "../utils/languages";
import { VideoImportModal } from "./VideoImportModal";
import { useEmailAttachments } from "../hooks/useEmailAttachments";
import { EmailAttachmentList } from "./EmailAttachmentList";
import type { ComposeDraft } from "../hooks/useEmailTabs";

interface EmailComposeTabContentProps {
  accounts: EmailAccount[];
  // Lifted into the caller's useEmailTabs state (never unmounted) so an in-progress
  // compose survives switching to a different tab type and back.
  draft: ComposeDraft;
  onDraftChange: (patch: Partial<ComposeDraft>) => void;
}

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function escapeHtml(text: string) {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function textToHtml(text: string): string {
  return text
    .split(/\n{2,}/)
    .map((para) => para.trim())
    .filter(Boolean)
    .map((para) => `<p>${escapeHtml(para).replace(/\n/g, "<br/>")}</p>`)
    .join("");
}

export function EmailComposeTabContent({ accounts, draft, onDraftChange }: EmailComposeTabContentProps) {
  const fromAccountId = draft.fromAccountId ?? accounts[0]?.id;
  const setFromAccountId = (v: number | undefined) => onDraftChange({ fromAccountId: v });
  const to = draft.to;
  const setTo = (v: string) => onDraftChange({ to: v });
  const subject = draft.subject;
  const setSubject = (v: string) => onDraftChange({ subject: v });
  const body = draft.body;
  const setBody = (v: string) => onDraftChange({ body: v });
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; msg: string } | null>(null);
  const [suggesting, setSuggesting] = useState(false);
  const [showTopicPrompt, setShowTopicPrompt] = useState(false);
  const [topicDraft, setTopicDraft] = useState("");
  const [showVideoImport, setShowVideoImport] = useState(false);
  const [language, setLanguage] = useState("en");
  const [isDraggingFile, setIsDraggingFile] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const attachments = useEmailAttachments();

  const recording = useRecording((text) => {
    setBody(`${body}<p>${escapeHtml(text)}</p>`);
  });

  function handleVideoImport(title: string, content: string) {
    setBody(`${body}${content}`);
    setSubject(subject || title);
    setShowVideoImport(false);
  }

  async function runSuggest(topic: string) {
    setSuggesting(true);
    setResult(null);
    try {
      const res = await composeSuggest({ to: to.trim(), subject: subject.trim(), topic: topic.trim() });
      setBody(textToHtml(res.body));
      setShowTopicPrompt(false);
      setTopicDraft("");
    } catch (err: any) {
      setResult({ ok: false, msg: err?.response?.data?.detail || "Could not generate a draft." });
    } finally {
      setSuggesting(false);
    }
  }

  function handleSuggestClick() {
    const plainBody = stripHtml(body);
    if (!plainBody) {
      // No content yet — ask what the email is about before composing.
      setShowTopicPrompt(true);
      return;
    }
    runSuggest(plainBody);
  }

  async function handleSend() {
    const plainBody = stripHtml(body);
    if (!to.trim() || !plainBody) return;
    setSending(true);
    setResult(null);
    try {
      await sendNewMail({
        to: to.trim(),
        subject: subject.trim(),
        body,
        emailAccountId: fromAccountId,
        attachments: attachments.readyAttachments,
      });
      setResult({ ok: true, msg: `✓ Sent to ${to.trim()}` });
      setTo("");
      setSubject("");
      setBody("");
      attachments.reset();
    } catch (err: any) {
      setResult({ ok: false, msg: err?.response?.data?.detail || "Failed to send email." });
    } finally {
      setSending(false);
    }
  }

  const canSend = !!to.trim() && !!stripHtml(body) && !sending && !attachments.isUploading;

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="flex flex-col gap-2 px-5 py-4 border-b border-[var(--ml-bg-hover)] shrink-0">
        <div className="flex items-center gap-2">
          {accounts.length > 1 ? (
            <select
              value={fromAccountId ?? ""}
              onChange={(e) => setFromAccountId(e.target.value ? Number(e.target.value) : undefined)}
              className="shrink-0 w-56 bg-[var(--ml-bg-surface)] border border-[var(--ml-bg-hover)] rounded-xl px-3 py-2 text-xs text-gray-300 outline-none focus:border-indigo-500 transition"
            >
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.email}
                </option>
              ))}
            </select>
          ) : accounts.length === 1 ? (
            <span className="shrink-0 w-56 truncate bg-[var(--ml-bg-surface)] border border-[var(--ml-bg-hover)] rounded-xl px-3 py-2 text-xs text-gray-400">
              {accounts[0].email}
            </span>
          ) : null}
          <input
            value={to}
            onChange={(e) => setTo(e.target.value)}
            placeholder="To"
            className="flex-1 bg-[var(--ml-bg-surface)] border border-[var(--ml-bg-hover)] rounded-xl px-3 py-2 text-xs text-gray-200 placeholder-gray-600 outline-none focus:border-indigo-500 transition"
          />
        </div>
        <input
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          placeholder="Subject"
          className="w-full bg-[var(--ml-bg-surface)] border border-[var(--ml-bg-hover)] rounded-xl px-3 py-2 text-xs text-gray-200 placeholder-gray-600 outline-none focus:border-indigo-500 transition"
        />
      </div>

      <div className="flex-1 min-h-0 overflow-hidden flex flex-col px-5 py-3 gap-2">
        {showTopicPrompt && (
          <div className="shrink-0 flex items-center gap-2 bg-[var(--ml-bg-surface)] border border-indigo-500/30 rounded-xl px-3 py-2">
            <input
              autoFocus
              value={topicDraft}
              onChange={(e) => setTopicDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && topicDraft.trim()) runSuggest(topicDraft); }}
              placeholder="What's this email about?"
              className="flex-1 bg-transparent text-xs text-gray-200 placeholder-gray-600 outline-none"
            />
            <button
              onClick={() => topicDraft.trim() && runSuggest(topicDraft)}
              disabled={!topicDraft.trim() || suggesting}
              className="px-2.5 py-1.5 rounded-lg text-xs font-medium bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white transition shrink-0"
            >
              {suggesting ? "Generating…" : "Generate"}
            </button>
            <button
              onClick={() => { setShowTopicPrompt(false); setTopicDraft(""); }}
              className="text-gray-500 hover:text-gray-300 text-xs px-1 shrink-0"
            >
              ✕
            </button>
          </div>
        )}

        <div
          className={`relative flex-1 min-h-0 overflow-hidden flex flex-col border rounded-xl bg-[var(--ml-bg-bar)] w-full transition ${
            isDraggingFile ? "border-indigo-500/60" : "border-[var(--ml-bg-panel)]"
          }`}
          onDragOver={(e) => { e.preventDefault(); setIsDraggingFile(true); }}
          onDragLeave={() => setIsDraggingFile(false)}
          onDrop={(e) => {
            e.preventDefault();
            setIsDraggingFile(false);
            if (e.dataTransfer.files.length) attachments.addFiles(Array.from(e.dataTransfer.files));
          }}
        >
          <RichNoteEditor noteKey="email-compose" value={body} onChange={setBody} disabled={sending} />
          {isDraggingFile && (
            <div className="absolute inset-0 flex items-center justify-center bg-indigo-500/10 border-2 border-dashed border-indigo-500/50 rounded-xl pointer-events-none">
              <p className="text-xs text-indigo-300 font-medium">Drop files to attach</p>
            </div>
          )}
        </div>

        <EmailAttachmentList items={attachments.items} onRemove={attachments.removeAttachment} />

        {result && (
          <p className={`shrink-0 text-xs px-3 py-2 rounded-xl ${result.ok ? "bg-green-500/10 text-green-400" : "bg-red-500/10 text-red-400"}`}>
            {result.msg}
          </p>
        )}
      </div>

      <div className="flex items-center gap-2 px-5 py-4 border-t border-[var(--ml-bg-hover)] shrink-0">
        <button
          onClick={handleSuggestClick}
          disabled={suggesting || sending}
          className="flex items-center gap-1.5 px-3 py-2 bg-[var(--ml-bg-surface)] border border-[var(--ml-bg-hover)] hover:border-indigo-500/30 text-gray-400 hover:text-indigo-300 rounded-xl text-xs transition disabled:opacity-40"
        >
          {suggesting ? (
            <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
            </svg>
          ) : (
            <svg xmlns="http://www.w3.org/2000/svg" className="w-3 h-3" fill="currentColor" viewBox="0 0 16 16">
              <path d="M2 6a6 6 0 1 1 10.174 4.31c-.203.196-.359.4-.453.619l-.762 1.769A.5.5 0 0 1 10.5 13h-5a.5.5 0 0 1-.46-.302l-.761-1.77a2 2 0 0 0-.453-.618A5.98 5.98 0 0 1 2 6"/>
            </svg>
          )}
          {suggesting ? "Generating…" : "Suggest with AI"}
        </button>

        <button
          onClick={() => (recording.isRecording ? recording.stopRecording() : recording.startRecording("mic", { language }))}
          disabled={sending}
          title={recording.isRecording ? "Stop recording" : "Record voice"}
          className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs transition disabled:opacity-40 border ${
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
          className="bg-[var(--ml-bg-surface)] border border-[var(--ml-bg-hover)] hover:border-indigo-500/30 text-gray-400 rounded-xl text-xs px-2 py-2 outline-none focus:border-indigo-500 transition disabled:opacity-40"
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
          className="flex items-center gap-1.5 px-3 py-2 bg-[var(--ml-bg-surface)] border border-[var(--ml-bg-hover)] hover:border-indigo-500/30 text-gray-400 hover:text-indigo-300 rounded-xl text-xs transition disabled:opacity-40"
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="w-3 h-3" fill="currentColor" viewBox="0 0 16 16">
            <path d="M4.5 3a2.5 2.5 0 0 1 5 0v9a1.5 1.5 0 0 1-3 0V5a.5.5 0 0 1 1 0v7a.5.5 0 0 0 1 0V3a1.5 1.5 0 1 0-3 0v9a2.5 2.5 0 0 0 5 0V5a.5.5 0 0 1 1 0v7a3.5 3.5 0 1 1-7 0z" />
          </svg>
          Attach
        </button>

        <button
          onClick={() => setShowVideoImport(true)}
          disabled={sending}
          title="Import from video"
          className="flex items-center gap-1.5 px-3 py-2 bg-[var(--ml-bg-surface)] border border-[var(--ml-bg-hover)] hover:border-indigo-500/30 text-gray-400 hover:text-indigo-300 rounded-xl text-xs transition disabled:opacity-40"
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="w-3 h-3" fill="currentColor" viewBox="0 0 16 16">
            <path d="M0 1a1 1 0 0 1 1-1h14a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H1a1 1 0 0 1-1-1zm4 0v6h8V1zm8 8H4v6h8zm1-8v6h2V1zm2 7h-2v6h2zM1 1v6h2V1zm2 7H1v6h2z"/>
          </svg>
          Video
        </button>

        <button
          onClick={handleSend}
          disabled={!canSend}
          className="ml-auto flex items-center justify-center gap-1.5 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white rounded-xl text-xs font-medium transition"
        >
          {sending ? (
            <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
            </svg>
          ) : (
            <svg xmlns="http://www.w3.org/2000/svg" className="w-3 h-3" fill="currentColor" viewBox="0 0 16 16">
              <path d="M15.964.686a.5.5 0 0 0-.65-.65L.767 5.855H.766l-.452.18a.5.5 0 0 0-.082.887l.41.26.001.002 4.995 3.178 3.178 4.995.002.002.26.41a.5.5 0 0 0 .886-.083zm-1.833 1.89L6.637 10.07l-.215-.338a.5.5 0 0 0-.154-.154l-.338-.215 7.494-7.494 1.178-.471z" />
            </svg>
          )}
          {sending ? "Sending…" : "Send"}
        </button>
      </div>

      {showVideoImport && (
        <VideoImportModal onClose={() => setShowVideoImport(false)} onImport={handleVideoImport} />
      )}
    </div>
  );
}
