import React, { useState } from "react";
import { marked } from "marked";
import MarkdownRenderer from "./MarkdownRenderer";
import { translateText } from "../api/chatApi";
import { MODELS } from "../constants/models";
import { QuizRenderer } from "./QuizRenderer";
import { WorkflowApprovalCard } from "./WorkflowApprovalCard";
import { WorkflowActionBar } from "./WorkflowActionBar";
import { EvaluationRatingBar } from "./EvaluationRatingBar";
import { EmailDraftCard } from "./EmailDraftCard";
import { WhatsappDraftCard } from "./WhatsappDraftCard";
import { EmailResultsList } from "./EmailResultsList";
import type { BrowseEmailResult } from "../api/emailApi";
import type { Message } from "../types";
import "highlight.js/styles/github-dark.css";
import "../styles/markdown.css";

function b64DecodeUtf8(b64: string): string {
  try {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  } catch {
    return atob(b64);
  }
}

/** Parse <email_draft to="..." subject="..." body_b64="..." message_id="..." thread_id="..."> tags.
 *  Uses body_b64 (base64-encoded) to avoid issues with > < " in note content. */
function parseEmailDrafts(content: string): { before: string; drafts: Array<{ to: string; subject: string; body: string; messageId: string; threadId: string }>; after: string } {
  const drafts: Array<{ to: string; subject: string; body: string; messageId: string; threadId: string }> = [];
  // Match the tag using a regex that handles quoted attribute values containing any chars
  const TAG_RE = /<email_draft((?:\s+\w+(?:_\w+)*="[^"]*")*)\s*><\/email_draft>/g;
  const cleaned = content.replace(TAG_RE, (_, attrs) => {
    const get = (key: string) => { const m = attrs.match(new RegExp(`${key}="([^"]*)"`)); return m ? m[1] : ""; };
    const bodyB64 = get("body_b64");
    const body = bodyB64 ? b64DecodeUtf8(bodyB64) : get("body");
    drafts.push({ to: get("to"), subject: get("subject"), body, messageId: get("message_id"), threadId: get("thread_id") });
    return "[[EMAIL_DRAFT_PLACEHOLDER]]";
  });
  const parts = cleaned.split("[[EMAIL_DRAFT_PLACEHOLDER]]");
  return { before: parts[0] || "", drafts, after: parts.slice(1).join("") };
}

function parseWhatsappDrafts(content: string): { before: string; drafts: Array<{ to: string; body: string }>; after: string } {
  const drafts: Array<{ to: string; body: string }> = [];
  const TAG_RE = /<whatsapp_draft((?:\s+\w+(?:_\w+)*="[^"]*")*)\s*><\/whatsapp_draft>/g;
  const cleaned = content.replace(TAG_RE, (_, attrs) => {
    const get = (key: string) => { const m = attrs.match(new RegExp(`${key}="([^"]*)"`)); return m ? m[1] : ""; };
    const bodyB64 = get("body_b64");
    const body = bodyB64 ? b64DecodeUtf8(bodyB64) : get("body");
    drafts.push({ to: get("to"), body });
    return "[[WHATSAPP_DRAFT_PLACEHOLDER]]";
  });
  const parts = cleaned.split("[[WHATSAPP_DRAFT_PLACEHOLDER]]");
  return { before: parts[0] || "", drafts, after: parts.slice(1).join("") };
}

function modelLabel(id?: string): string {
  if (!id) return "";
  if (id === "gpt-image-2") return "GPT Image 2";
  if (id === "gpt-image-1") return "GPT Image 1";
  if (id === "dall-e-3") return "DALL-E 3";
  if (id === "dall-e-2") return "DALL-E 2";
  if (id === "stable-diffusion") return "Stable Diffusion";
  return MODELS.find((m) => m.id === id)?.label ?? id;
}

const NOTE_LINK_RE = /\[\[NOTE_LINK:(\d+):([^\]]+)\]\]/g;
const TOKEN_RE = /(\[\[NOTE_LINK:\d+:[^\]]+\]\]|\[\[BOOK_BORROW:[^\]:]+:[^\]]+\]\]|✅|⚠)/g;

function CmdCheck() {
  return (
    <span className="inline-flex items-center justify-center w-[18px] h-[18px] rounded-full bg-emerald-500/15 border border-emerald-500/25 mx-0.5 align-middle shrink-0">
      <svg className="w-2.5 h-2.5 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
      </svg>
    </span>
  );
}

function CmdWarn() {
  return (
    <span className="inline-flex items-center justify-center w-[18px] h-[18px] rounded-full bg-amber-500/15 border border-amber-500/25 mx-0.5 align-middle shrink-0">
      <svg className="w-2.5 h-2.5 text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
      </svg>
    </span>
  );
}

/** Render content splitting [[NOTE_LINK:id:title]], ✅ and ⚠ into styled components.
 *  Status icons (✅ ⚠) are paired with the immediately following text in a flex row
 *  so the icon stays inline with the first line of the MarkdownRenderer output. */
function ContentWithNoteLinks({ content, onOpenNote, onBorrowBook }: { content: string; onOpenNote?: (id: number) => void; onBorrowBook?: (bookId: number) => void }) {
  TOKEN_RE.lastIndex = 0;
  const parts = content.split(TOKEN_RE).filter(Boolean);
  if (parts.length === 1 && !TOKEN_RE.test(content)) {
    return <MarkdownRenderer>{content}</MarkdownRenderer>;
  }

  const nodes: React.ReactNode[] = [];
  let i = 0;
  while (i < parts.length) {
    const part = parts[i];

    if (part === "✅" || part === "⚠") {
      const Icon = part === "✅" ? CmdCheck : CmdWarn;
      const next = parts[i + 1];
      // Pair icon + following text segment in a flex row to keep them on the same line
      if (next && !next.match(/^[✅⚠]$/) && !next.startsWith("[[NOTE_LINK:")) {
        nodes.push(
          <div key={i} className="flex items-start gap-1.5">
            <span className="shrink-0 mt-[3px]"><Icon /></span>
            <div className="flex-1 min-w-0"><MarkdownRenderer>{next}</MarkdownRenderer></div>
          </div>
        );
        i += 2;
        continue;
      }
      nodes.push(<Icon key={i} />);
      i++;
      continue;
    }

    const noteMatch = part.match(/^\[\[NOTE_LINK:(\d+):([^\]]+)\]\]$/);
    if (noteMatch) {
      const noteId = parseInt(noteMatch[1]);
      const noteTitle = noteMatch[2];
      nodes.push(
        <button
          key={i}
          onClick={() => onOpenNote?.(noteId)}
          className="inline-flex items-center gap-2 my-2 px-4 py-2 rounded-xl bg-indigo-600/20 border border-indigo-500/30 text-indigo-300 text-sm font-medium hover:bg-indigo-600/40 hover:text-indigo-100 transition"
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4 shrink-0" fill="currentColor" viewBox="0 0 16 16">
            <path d="M5 0h8a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V2a2 2 0 0 1 2-2h2zm-1 1H3a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V2a1 1 0 0 0-1-1H6v2.5a.5.5 0 0 1-.5.5h-2A.5.5 0 0 1 3 4.5V1.5A.5.5 0 0 1 3.5 1H4z"/>
          </svg>
          Open Note: {noteTitle}
          <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
          </svg>
        </button>
      );
      i++;
      continue;
    }

    const bookMatch = part.match(/^\[\[BOOK_BORROW:([^\]:]+):([^\]]+)\]\]$/);
    if (bookMatch) {
      const bookId = parseInt(bookMatch[1], 10);
      const bookTitle = bookMatch[2];
      const validId = !isNaN(bookId) && bookId > 0;
      nodes.push(
        <div key={i} className="my-3 flex items-center gap-3 px-4 py-3 rounded-xl bg-[#1a1a2e] border border-indigo-500/25 max-w-sm">
          <span className="shrink-0 inline-flex items-center justify-center w-9 h-9 rounded-lg bg-indigo-500/15 text-indigo-400">
            <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" fill="currentColor" viewBox="0 0 16 16">
              <path d="M1 2.828c.885-.37 2.154-.769 3.388-.893 1.33-.134 2.458.063 3.112.752v9.746c-.935-.53-2.12-.603-3.213-.493-1.18.12-2.37.461-3.287.811V2.828zm7.5-.141c.654-.689 1.782-.886 3.112-.752 1.234.124 2.503.523 3.388.893v9.923c-.918-.35-2.107-.692-3.287-.81-1.094-.111-2.278-.039-3.213.492V2.687zM8 1.783C7.015.936 5.649.505 4.18.42 2.546.328 1.107.605 0 1.125v14.018c0 .494.535.814 1.002.6 1.007-.44 2.155-.749 3.178-.849 1.18-.12 2.37.039 3.212.492.842-.453 2.033-.612 3.213-.492 1.022.1 2.17.408 3.178.849.467.213 1.002-.107 1.002-.6V1.125c-1.107-.52-2.547-.797-4.18-.705C10.35.505 8.985.936 8 1.783z"/>
            </svg>
          </span>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-gray-200 truncate">{bookTitle}</p>
            <p className="text-[11px] text-gray-500 mt-0.5">Available in library</p>
          </div>
          {onBorrowBook && validId && (
            <button
              onClick={() => onBorrowBook(bookId)}
              className="shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium transition"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 16 16">
                <path d="M1 2.828c.885-.37 2.154-.769 3.388-.893 1.33-.134 2.458.063 3.112.752v9.746c-.935-.53-2.12-.603-3.213-.493-1.18.12-2.37.461-3.287.811V2.828zm7.5-.141c.654-.689 1.782-.886 3.112-.752 1.234.124 2.503.523 3.388.893v9.923c-.918-.35-2.107-.692-3.287-.81-1.094-.111-2.278-.039-3.213.492V2.687zM8 1.783C7.015.936 5.649.505 4.18.42 2.546.328 1.107.605 0 1.125v14.018c0 .494.535.814 1.002.6 1.007-.44 2.155-.749 3.178-.849 1.18-.12 2.37.039 3.212.492.842-.453 2.033-.612 3.213-.492 1.022.1 2.17.408 3.178.849.467.213 1.002-.107 1.002-.6V1.125c-1.107-.52-2.547-.797-4.18-.705C10.35.505 8.985.936 8 1.783z"/>
              </svg>
              Read Book
            </button>
          )}
        </div>
      );
      i++;
      continue;
    }

    nodes.push(<MarkdownRenderer key={i}>{part}</MarkdownRenderer>);
    i++;
  }

  return <>{nodes}</>;
}

import type { ConfidenceLevel } from "../types";

const CONFIDENCE_CONFIG: Record<ConfidenceLevel, { label: string; dot: string; pill: string; text: string }> = {
  HIGH:        { label: "High Confidence",   dot: "bg-emerald-400", pill: "bg-emerald-500/10 border-emerald-500/25", text: "text-emerald-400" },
  MEDIUM:      { label: "Medium Confidence", dot: "bg-amber-400",   pill: "bg-amber-500/10  border-amber-500/25",   text: "text-amber-400"   },
  LOW:         { label: "Low Confidence",    dot: "bg-orange-400",  pill: "bg-orange-500/10 border-orange-500/25",  text: "text-orange-400"  },
  UNSUPPORTED: { label: "General Knowledge", dot: "bg-gray-500",    pill: "bg-gray-500/10   border-gray-500/25",    text: "text-gray-400"    },
};

interface Props {
  role: "user" | "assistant";
  content: string;
  model?: string;
  streaming?: boolean;
  onAdd?: (text: string) => Promise<void> | void;
  onDelete?: () => void;
  onApplyEdit?: (content: string, noteId: number | null) => void;
  onOpenNote?: (noteId: number) => void;
  onBorrowBook?: (bookId: number) => void;
  onSaveNote?: (title: string, content: string) => Promise<void> | void;
  hasOpenNote?: boolean;
  translationEnabled?: boolean;
  modelAttributionEnabled?: boolean;
  confidence?: ConfidenceLevel;
  confidenceReason?: string;
  confidenceEnabled?: boolean;
  routingReason?: string;
  autopilotEnabled?: boolean;
  workflowContext?: { conversationId: number; workspaceId: number | null; model: string | null };
  workflowActions?: { id: string; type: string; label: string; preview: string; params: Record<string, unknown> }[];
  onWorkflowActionDone?: (type: string) => void;
  onWorkflowConversationMessages?: (messages: Message[]) => void;
  messageId?: number;
  evaluationActive?: boolean;
  evalRating?: Record<string, number | string>;
  onRetry?: () => void;
  suggestWebSearch?: boolean;
  onSearchOnline?: () => void;
  emailResults?: BrowseEmailResult[];
  onOpenEmail?: (email: BrowseEmailResult) => void;
}

const TRANSLATE_LANGUAGES = [
  "English", "Māori", "Chinese", "Japanese", "Korean",
  "Spanish", "French", "German", "Portuguese", "Italian",
  "Russian", "Arabic", "Hindi", "Tagalog",
];

/** Split AI response into plain text + an optional <note_edit> block. */
function parseNoteEdit(content: string): {
  pre: string;
  edit: string | null;
  noteId: number | null;
  post: string;
} {
  const match = content.match(/^([\s\S]*?)<note_edit(?:\s+note_id="(\d+)")?>([\s\S]*?)<\/note_edit>([\s\S]*)$/);
  if (!match) return { pre: content, edit: null, noteId: null, post: "" };
  return {
    pre: match[1].trim(),
    noteId: match[2] ? parseInt(match[2], 10) : null,
    edit: match[3].trim(),
    post: match[4].trim(),
  };
}

export default function ChatBubble({ role, content, model, streaming, onAdd, onDelete, onApplyEdit, onOpenNote, onBorrowBook, onSaveNote, hasOpenNote, translationEnabled = true, modelAttributionEnabled = true, confidence, confidenceReason, confidenceEnabled = true, routingReason, autopilotEnabled = true, workflowContext, workflowActions, onWorkflowActionDone, onWorkflowConversationMessages, messageId, evaluationActive, evalRating, onRetry, suggestWebSearch, onSearchOnline, emailResults, onOpenEmail }: Props) {
  const isUser = role === "user";
  const [copied, setCopied] = useState(false);
  const [showLangPicker, setShowLangPicker] = useState(false);
  const [isTranslating, setIsTranslating] = useState(false);
  const [translation, setTranslation] = useState<string | null>(null);
  const [translatedTo, setTranslatedTo] = useState("");
  const [translationAccuracy, setTranslationAccuracy] = useState<number | null>(null);
  const [translationModel, setTranslationModel] = useState<string | undefined>(undefined);
  const [translationCached, setTranslationCached] = useState(false);
  const [editApplied, setEditApplied] = useState(false);
  const [editPreviewOpen, setEditPreviewOpen] = useState(false);
  const [isSavingNote, setIsSavingNote] = useState(false);
  const [noteSaved, setNoteSaved] = useState(false);

  const isThinking = content === "__THINKING__";
  const isImageGenerating = content === "__IMAGE_GENERATING__";
  const isImprovingNote = content.startsWith("__IMPROVING_NOTE__:");
  const improvingNoteTitle = isImprovingNote ? content.slice("__IMPROVING_NOTE__:".length) : "";
  const isQuiz = content.startsWith("__QUIZ__:");
  const quizData = isQuiz ? (() => { try { return JSON.parse(content.slice("__QUIZ__:".length)); } catch { return null; } })() : null;
  const isWorkflowPlan = content.startsWith("__WORKFLOW_PLAN__:");
  const workflowPlanData = isWorkflowPlan ? (() => { try { return JSON.parse(content.slice("__WORKFLOW_PLAN__:".length)); } catch { return null; } })() : null;
  const isCmdRunning = content.startsWith("__CMD_RUNNING__:");
  const cmdRunningMsg = isCmdRunning ? content.slice("__CMD_RUNNING__:".length) : "";
  const { pre, edit, noteId, post } = (isThinking || isImageGenerating || isImprovingNote || isQuiz || isWorkflowPlan || isCmdRunning) ? { pre: "", edit: null, noteId: null, post: "" } : parseNoteEdit(content);
  const { before: draftBefore, drafts: emailDrafts, after: draftAfter } = parseEmailDrafts(pre || content);
  const { before: whatsappDraftBefore, drafts: whatsappDrafts, after: whatsappDraftAfter } = parseWhatsappDrafts(pre || content);
  const hasAssistantContent = !isThinking && content.trim().length > 0;

  async function handleCopy() {
    const textToCopy = translation ?? content;
    const html = await marked.parse(textToCopy);
    await navigator.clipboard.write([
      new ClipboardItem({
        "text/html": new Blob([html], { type: "text/html" }),
        "text/plain": new Blob([textToCopy], { type: "text/plain" }),
      }),
    ]);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  async function handleTranslate(lang: string, force = false) {
    setShowLangPicker(false);
    setIsTranslating(true);
    if (!force) {
      setTranslation(null);
      setTranslationAccuracy(null);
      setTranslationModel(undefined);
      setTranslationCached(false);
    }
    try {
      const { translation: result, accuracy, model: txModel, cached } = await translateText(content, lang, force);
      setTranslation(result);
      setTranslatedTo(lang);
      setTranslationAccuracy(accuracy);
      setTranslationModel(txModel);
      setTranslationCached(cached);
    } catch (err: any) {
      const msg = err?.response?.data?.detail ?? err?.message ?? "Unknown error";
      setTranslation(`Translation failed: ${msg}`);
    } finally {
      setIsTranslating(false);
    }
  }

  function handleApply() {
    if (!edit || !onApplyEdit) return;
    onApplyEdit(edit, noteId);
    setEditApplied(true);
  }

  async function handleSaveToNotes() {
    if (!onAdd || isSavingNote) return;
    setIsSavingNote(true);
    setNoteSaved(false);
    try {
      await onAdd(translation ?? content);
      setNoteSaved(true);
      setTimeout(() => setNoteSaved(false), 1500);
    } finally {
      setIsSavingNote(false);
    }
  }

  const translateButton = (
    <div className="relative group">
      {showLangPicker && (
        <>
          <div className="fixed inset-0 z-[9]" onClick={() => setShowLangPicker(false)} />
          <div className={`absolute bottom-full mb-1 z-10 bg-[var(--ml-bg-panel)] border border-[var(--ml-bg-hover)] rounded-xl shadow-xl overflow-hidden min-w-[140px] ${isUser ? "right-0" : "left-0"}`}>
            {TRANSLATE_LANGUAGES.map((lang) => (
              <button
                key={lang}
                onClick={() => handleTranslate(lang)}
                className="w-full text-left px-3 py-2 text-xs text-gray-300 hover:bg-[var(--ml-bg-hover)] transition"
              >
                {lang}
              </button>
            ))}
          </div>
        </>
      )}
      <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 px-1.5 py-0.5 text-[10px] text-white bg-[var(--ml-bg-panel)] border border-[var(--ml-bg-hover)] rounded whitespace-nowrap hidden group-hover:block pointer-events-none z-50">
        {isTranslating ? "Translating…" : "Translate"}
      </span>
      <button
        onClick={() => setShowLangPicker((v) => !v)}
        disabled={isTranslating}
        className="flex items-center justify-center w-7 h-7 rounded-md hover:text-indigo-300 hover:bg-white/10 disabled:opacity-80 disabled:cursor-wait"
      >
        {isTranslating ? (
          <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
          </svg>
        ) : (
          <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" fill="currentColor" viewBox="0 0 16 16">
            <path d="M4.545 6.714 4.11 8H3l1.862-5h1.284L8 8H6.833l-.435-1.286H4.545zm1.634-.736L5.5 3.956h-.049l-.679 2.022H6.18z"/>
            <path d="M0 2a2 2 0 0 1 2-2h7a2 2 0 0 1 2 2v3h3a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-3H2a2 2 0 0 1-2-2V2zm2-1a1 1 0 0 0-1 1v7a1 1 0 0 0 1 1h7a1 1 0 0 0 1-1V2a1 1 0 0 0-1-1H2zm7.138 9.995c.193.301.402.583.63.846-.748.575-1.673 1.001-2.768 1.292.178.217.451.635.555.867 1.125-.359 2.08-.844 2.886-1.494.777.665 1.739 1.165 2.93 1.472.133-.254.414-.673.629-.89-1.125-.253-2.057-.694-2.82-1.284.681-.747 1.222-1.651 1.621-2.757H14v-.91h-3v-.703h-.905v.703h-3v.91h1.05c.171.592.43 1.147.774 1.657a6.08 6.08 0 0 1-1.927 1.292 5.085 5.085 0 0 0 .536.732 6.73 6.73 0 0 0 1.862-1.276z"/>
          </svg>
        )}
      </button>
    </div>
  );

  return (
    <div className={`w-full flex flex-col ${isUser ? "items-end" : "items-start"} my-[3px] gap-1`}>
      {/* Original message bubble */}
      <div
        className={`max-w-full sm:max-w-[740px] px-5 py-4 rounded-2xl text-[16px] leading-relaxed backdrop-blur-sm shadow-sm
          ${isUser ? "bg-[#2F2F3F]/80 text-gray-100" : "text-white"}`}
      >
        {isWorkflowPlan && workflowPlanData && workflowContext ? (
          <WorkflowApprovalCard
            understanding={workflowPlanData.understanding ?? ""}
            actions={workflowPlanData.actions ?? []}
            conversationId={workflowContext.conversationId}
            workspaceId={workflowContext.workspaceId}
            model={workflowContext.model}
          />
        ) : isQuiz && quizData ? (
          <QuizRenderer quiz={quizData} onSaveNote={onSaveNote} />
        ) : isThinking ? (
          <div className="py-1 text-sm text-indigo-300/80 flex items-center gap-2">
            <span>Thinking</span>
            <span className="inline-flex items-end gap-0.5" aria-hidden="true">
              <span className="w-1 h-1 rounded-full bg-indigo-400 animate-[pulse_1.2s_ease-in-out_infinite]" />
              <span className="w-1 h-1 rounded-full bg-indigo-400 animate-[pulse_1.2s_ease-in-out_0.2s_infinite]" />
              <span className="w-1 h-1 rounded-full bg-indigo-400 animate-[pulse_1.2s_ease-in-out_0.4s_infinite]" />
            </span>
          </div>
        ) : isCmdRunning ? (
          <div className="py-1">
            <MarkdownRenderer>{cmdRunningMsg}</MarkdownRenderer>
          </div>
        ) : isImprovingNote ? (
          <div className="py-1 text-sm text-indigo-300/80">
            Improving <span className="font-medium text-indigo-300">{improvingNoteTitle}</span>…
          </div>
        ) : isImageGenerating ? (
          <div className="py-1 text-sm text-indigo-300/80">
            Generating image…
          </div>
        ) : (
          <>
            {pre && (
              <span>
                {emailDrafts.length > 0 ? (
                  <>
                    {draftBefore && <ContentWithNoteLinks content={draftBefore} onOpenNote={onOpenNote} onBorrowBook={onBorrowBook} />}
                    {emailDrafts.map((d, idx) => (
                      <EmailDraftCard key={idx} to={d.to} subject={d.subject} body={d.body} messageId={d.messageId} threadId={d.threadId} />
                    ))}
                    {draftAfter && <ContentWithNoteLinks content={draftAfter} onOpenNote={onOpenNote} onBorrowBook={onBorrowBook} />}
                  </>
                ) : whatsappDrafts.length > 0 ? (
                  <>
                    {whatsappDraftBefore && <ContentWithNoteLinks content={whatsappDraftBefore} onOpenNote={onOpenNote} onBorrowBook={onBorrowBook} />}
                    {whatsappDrafts.map((d, idx) => (
                      <WhatsappDraftCard key={idx} to={d.to} body={d.body} />
                    ))}
                    {whatsappDraftAfter && <ContentWithNoteLinks content={whatsappDraftAfter} onOpenNote={onOpenNote} onBorrowBook={onBorrowBook} />}
                  </>
                ) : (
                  <ContentWithNoteLinks content={pre} onOpenNote={onOpenNote} onBorrowBook={onBorrowBook} />
                )}
                {streaming && (
                  <span className="inline-block w-[2px] h-[1em] bg-indigo-400 ml-0.5 align-middle animate-[blink_0.8s_step-end_infinite]" />
                )}
              </span>
            )}
            {!pre && streaming && (
              <span className="inline-block w-[2px] h-[1em] bg-indigo-400 align-middle animate-[blink_0.8s_step-end_infinite]" />
            )}
          </>
        )}

        {/* Note edit block */}
        {edit && (
          <div className="mt-3 rounded-xl border border-indigo-500/30 bg-indigo-950/30 overflow-hidden">
            <div className="flex items-center justify-between px-4 py-2.5 bg-indigo-950/40 border-b border-indigo-500/20">
              <div className="flex items-center gap-2">
                <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5 text-indigo-400" fill="currentColor" viewBox="0 0 16 16">
                  <path d="M12.854.146a.5.5 0 0 0-.707 0L10.5 1.793 14.207 5.5l1.647-1.646a.5.5 0 0 0 0-.708zm.646 6.061L9.793 2.5 3.293 9H3.5a.5.5 0 0 1 .5.5v.5h.5a.5.5 0 0 1 .5.5v.5h.5a.5.5 0 0 1 .5.5v.5h.5a.5.5 0 0 1 .5.5v.207zm-7.468 7.468A.5.5 0 0 1 6 13.5V13h-.5a.5.5 0 0 1-.5-.5V12h-.5a.5.5 0 0 1-.5-.5V11h-.5a.5.5 0 0 1-.5-.5V10h-.5a.499.499 0 0 1-.175-.032l-.179.178a.5.5 0 0 0-.11.168l-2 5a.5.5 0 0 0 .65.65l5-2a.5.5 0 0 0 .168-.11z"/>
                </svg>
                <span className="text-xs font-medium text-indigo-300 uppercase tracking-wider">Edited Note</span>
              </div>
              <button
                onClick={() => setEditPreviewOpen((v) => !v)}
                className="text-[11px] text-indigo-400/70 hover:text-indigo-300 transition"
              >
                {editPreviewOpen ? "Hide preview" : "Show preview"}
              </button>
            </div>
            {editPreviewOpen && (
              <div className="px-4 py-3 max-h-60 overflow-y-auto border-b border-indigo-500/20">
                <MarkdownRenderer>{edit}</MarkdownRenderer>
              </div>
            )}
            {!editPreviewOpen && (
              <pre className="px-4 py-3 text-xs text-indigo-100/80 whitespace-pre-wrap break-words font-mono leading-relaxed max-h-48 overflow-y-auto">
                {edit}
              </pre>
            )}
            <div className="flex items-center justify-between px-4 py-2.5 bg-indigo-950/20">
              <span className="text-[11px] text-indigo-400/60">
                {editApplied
                  ? noteId ? "✓ Saved directly to note" : "✓ Applied to note editor"
                  : noteId
                    ? "Will save directly to the referenced note"
                    : hasOpenNote
                      ? "Ready to apply to current note"
                      : "Will open as a new note"}
              </span>
              <div className="flex gap-2">
                <button
                  onClick={() => navigator.clipboard.writeText(edit)}
                  className="px-2.5 py-1 text-[11px] text-gray-400 hover:text-gray-200 bg-[var(--ml-bg-panel)] rounded-lg transition"
                >
                  Copy
                </button>
                {onApplyEdit && (
                  <button
                    onClick={handleApply}
                    disabled={editApplied}
                    className="px-3 py-1 text-[11px] font-medium text-white bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg transition"
                  >
                    {editApplied
                      ? "Saved ✓"
                      : noteId
                        ? "Save to Note"
                        : hasOpenNote
                          ? "Apply to Note"
                          : "Open as Note"}
                  </button>
                )}
              </div>
            </div>
          </div>
        )}

        {post && <div className="mt-3"><ContentWithNoteLinks content={post} onOpenNote={onOpenNote} onBorrowBook={onBorrowBook} /></div>}

        {!!emailResults?.length && onOpenEmail && (
          <EmailResultsList results={emailResults} onOpen={onOpenEmail} />
        )}
      </div>

      {/* Translation bubble */}
      {translation && (
        <div
          className={`max-w-full sm:max-w-[740px] px-5 py-4 rounded-2xl text-[16px] leading-relaxed backdrop-blur-sm shadow-sm
            ${isUser ? "bg-[#2F2F3F]/80 text-gray-100" : "text-white"}`}
        >
          <div className="flex items-center justify-between mb-2.5">
            <div className="flex items-center gap-2">
              <span className="text-[11px] text-indigo-400 uppercase tracking-wider font-medium">{translatedTo}</span>
              {translationCached && !isTranslating && (
                <span className="px-1.5 py-0.5 rounded text-[9px] font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 uppercase tracking-wide">Cached</span>
              )}
              {isTranslating && (
                <span className="flex items-center gap-1 text-[10px] text-indigo-400/70">
                  <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
                  </svg>
                  Re-translating…
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              {!isTranslating && (
                <button
                  onClick={() => handleTranslate(translatedTo, true)}
                  className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium bg-indigo-600/20 text-indigo-300 border border-indigo-500/30 hover:bg-indigo-600/40 hover:text-indigo-200 transition"
                  title="Re-translate and update cache"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                  Re-translate
                </button>
              )}
              <button onClick={() => setTranslation(null)} className="text-gray-600 hover:text-gray-400 text-xs leading-none px-1">✕</button>
            </div>
          </div>
          <MarkdownRenderer>{translation}</MarkdownRenderer>
          {(translationModel || translationAccuracy !== null) && (
            <p className={`mt-2 text-[10px] select-none ${
              translationAccuracy === null ? "text-gray-600"
              : translationAccuracy >= 85 ? "text-emerald-600/50"
              : translationAccuracy >= 70 ? "text-amber-600/50"
              : "text-red-600/50"
            }`}>
              {translationModel ? `by ${modelLabel(translationModel)}` : ""}
              {translationAccuracy !== null ? ` · ${translationAccuracy}% accuracy` : ""}
            </p>
          )}
        </div>
      )}

      {/* Action bar - always at the bottom of whatever is last */}
      {!isUser && hasAssistantContent && (
        <div className="flex flex-col gap-0.5 pl-3">
        <div className="flex items-center gap-1 text-xs text-gray-500 opacity-60 hover:opacity-100 transition">
          {translationEnabled && translateButton}
          <div className="relative group">
            <button onClick={handleCopy} className="flex items-center justify-center w-7 h-7 rounded-md hover:text-indigo-300 hover:bg-white/10">
              {copied ? (
                <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              ) : (
                <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" fill="currentColor" viewBox="0 0 16 16">
                  <path d="M10 1.5A1.5 1.5 0 0 1 11.5 3v8A1.5 1.5 0 0 1 10 12.5H4A1.5 1.5 0 0 1 2.5 11V3A1.5 1.5 0 0 1 4 1.5h6Zm-6 1A.5.5 0 0 0 3.5 3v8a.5.5 0 0 0 .5.5h6a.5.5 0 0 0 .5-.5V3a.5.5 0 0 0-.5-.5H4Zm9 1.5v7.528a2.5 2.5 0 0 1-2 2.45V13h1a1.5 1.5 0 0 0 1.5-1.5V4h-.5Z"/>
                </svg>
              )}
            </button>
            <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 px-1.5 py-0.5 text-[10px] text-white bg-[var(--ml-bg-panel)] border border-[var(--ml-bg-hover)] rounded whitespace-nowrap hidden group-hover:block pointer-events-none z-50">
              {copied ? "Copied!" : "Copy"}
            </span>
          </div>
          {onAdd && (
            <div className="relative group">
              <button
                onClick={() => { void handleSaveToNotes(); }}
                disabled={isSavingNote}
                className="flex items-center justify-center w-7 h-7 rounded-md hover:text-indigo-300 hover:bg-white/10 disabled:opacity-80 disabled:cursor-wait"
              >
                {isSavingNote ? (
                  <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
                  </svg>
                ) : noteSaved ? (
                  <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                ) : (
                  <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M17 3H7a2 2 0 00-2 2v16l7-3 7 3V5a2 2 0 00-2-2z" />
                  </svg>
                )}
              </button>
              <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 px-1.5 py-0.5 text-[10px] text-white bg-[var(--ml-bg-panel)] border border-[var(--ml-bg-hover)] rounded whitespace-nowrap hidden group-hover:block pointer-events-none z-50">
                {isSavingNote ? "Saving to notes..." : noteSaved ? "Saved to notes" : "Save to notes"}
              </span>
            </div>
          )}
          {!isUser && onRetry && !streaming && (
            <div className="relative group">
              <button onClick={onRetry} className="flex items-center justify-center w-7 h-7 rounded-md hover:text-indigo-300 hover:bg-white/10">
                <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
              </button>
              <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 px-1.5 py-0.5 text-[10px] text-white bg-[var(--ml-bg-panel)] border border-[var(--ml-bg-hover)] rounded whitespace-nowrap hidden group-hover:block pointer-events-none z-50">
                Try again
              </span>
            </div>
          )}
          {onDelete && (
            <div className="relative group">
              <button onClick={onDelete} className="flex items-center justify-center w-7 h-7 rounded-md hover:text-red-300 hover:bg-white/10">
                <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
              </button>
              <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 px-1.5 py-0.5 text-[10px] text-white bg-[var(--ml-bg-panel)] border border-[var(--ml-bg-hover)] rounded whitespace-nowrap hidden group-hover:block pointer-events-none z-50">
                Delete
              </span>
            </div>
          )}
        </div>
        {!streaming && hasAssistantContent && (
          <div className="flex items-center gap-3 flex-wrap">
            {modelAttributionEnabled && model && (
              <div className="flex items-center gap-1.5 text-[10px] text-gray-700 select-none">
                <span className="inline-flex items-center justify-center w-[14px] h-[14px] rounded bg-[#1a1a24] border border-[var(--ml-bg-hover)]">
                  <svg className="w-2 h-2 text-indigo-400/60" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
                  </svg>
                </span>
                {modelLabel(model)}
              </div>
            )}
            {autopilotEnabled && routingReason && routingReason !== "Simple Query" && (
              <div className="flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-violet-500/10 border border-violet-500/20 text-[10px] text-violet-400 select-none" title={`AutoPilot routed to ${modelLabel(model)} for: ${routingReason}`}>
                <svg xmlns="http://www.w3.org/2000/svg" className="w-2.5 h-2.5" fill="currentColor" viewBox="0 0 16 16">
                  <path d="M11.251.068a.5.5 0 0 1 .227.58L9.677 6.5H13a.5.5 0 0 1 .364.843l-8 8.5a.5.5 0 0 1-.842-.49L6.323 9.5H3a.5.5 0 0 1-.364-.843l8-8.5a.5.5 0 0 1 .615-.09z"/>
                </svg>
                AutoPilot · {routingReason}
              </div>
            )}
            {confidenceEnabled && confidence && (() => {
              const cfg = CONFIDENCE_CONFIG[confidence];
              return (
                <div className="group relative inline-flex">
                  <div className={`flex items-center gap-1.5 px-2 py-0.5 rounded-full border text-[10px] font-medium select-none cursor-default ${cfg.pill} ${cfg.text}`}>
                    <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${cfg.dot}`} />
                    {cfg.label}
                    <svg xmlns="http://www.w3.org/2000/svg" className="w-2.5 h-2.5 opacity-50" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  </div>
                  {confidenceReason && (
                    <div className="absolute bottom-full left-0 mb-1.5 w-56 hidden group-hover:block z-50">
                      <div className="bg-[var(--ml-bg-panel)] border border-[var(--ml-bg-hover)] rounded-xl px-3 py-2 shadow-xl">
                        <p className={`text-[10px] font-semibold mb-0.5 ${cfg.text}`}>{cfg.label}</p>
                        <p className="text-[11px] text-gray-400 leading-relaxed">{confidenceReason}</p>
                      </div>
                    </div>
                  )}
                </div>
              );
            })()}
          </div>
        )}
        {/* Web search suggestion chip — shown when notes had no relevant content */}
        {!streaming && suggestWebSearch && onSearchOnline && (
          <div className="mt-2">
            <button
              onClick={onSearchOnline}
              className="flex items-center gap-2 px-3 py-1.5 rounded-xl text-xs font-medium bg-sky-500/10 border border-sky-500/25 text-sky-400 hover:bg-sky-500/20 hover:border-sky-500/40 transition"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <circle cx="12" cy="12" r="10" />
                <path strokeLinecap="round" d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
              </svg>
              Not in your notes — search online?
            </button>
          </div>
        )}

        {/* Workflow action buttons - appear below AI message when suggestions are ready */}
        {!streaming && workflowActions && workflowActions.length > 0 && workflowContext && (
          <WorkflowActionBar
            actions={workflowActions}
            conversationId={workflowContext.conversationId}
            workspaceId={workflowContext.workspaceId}
            model={workflowContext.model}
            onActionDone={onWorkflowActionDone}
            onConversationMessages={onWorkflowConversationMessages}
          />
        )}
        {/* Evaluation rating bar - shown when admin has evaluation analytics on */}
        {!streaming && role === "assistant" && evaluationActive && messageId != null && (
          <EvaluationRatingBar messageId={messageId} initial={evalRating} />
        )}
        </div>
      )}
      {isUser && (
        <div className="flex items-center gap-1 text-xs text-gray-500 opacity-60 hover:opacity-100 transition pr-3">
          {translationEnabled && translateButton}
          {onRetry && (
            <div className="relative group">
              <button onClick={onRetry} className="flex items-center justify-center w-7 h-7 rounded-md hover:text-indigo-300 hover:bg-white/10">
                <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
              </button>
              <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 px-1.5 py-0.5 text-[10px] text-white bg-[var(--ml-bg-panel)] border border-[var(--ml-bg-hover)] rounded whitespace-nowrap hidden group-hover:block pointer-events-none z-50">
                Try again
              </span>
            </div>
          )}
          {onDelete && (
            <div className="relative group">
              <button onClick={onDelete} className="flex items-center justify-center w-7 h-7 rounded-md hover:text-red-300 hover:bg-white/10">
                <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
              </button>
              <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 px-1.5 py-0.5 text-[10px] text-white bg-[var(--ml-bg-panel)] border border-[var(--ml-bg-hover)] rounded whitespace-nowrap hidden group-hover:block pointer-events-none z-50">
                Delete
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
