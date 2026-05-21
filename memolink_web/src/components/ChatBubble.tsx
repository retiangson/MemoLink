import React, { useState } from "react";
import { marked } from "marked";
import MarkdownRenderer from "./MarkdownRenderer";
import { translateText } from "../api/chatApi";
import "highlight.js/styles/github-dark.css";
import "../styles/markdown.css";

interface Props {
  role: "user" | "assistant";
  content: string;
  streaming?: boolean;
  onAdd?: (text: string) => void;
  onDelete?: () => void;
  onApplyEdit?: (content: string, noteId: number | null) => void;
  hasOpenNote?: boolean;
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

export default function ChatBubble({ role, content, streaming, onAdd, onDelete, onApplyEdit, hasOpenNote }: Props) {
  const isUser = role === "user";
  const [copied, setCopied] = useState(false);
  const [showLangPicker, setShowLangPicker] = useState(false);
  const [isTranslating, setIsTranslating] = useState(false);
  const [translation, setTranslation] = useState<string | null>(null);
  const [translatedTo, setTranslatedTo] = useState("");
  const [editApplied, setEditApplied] = useState(false);
  const [editPreviewOpen, setEditPreviewOpen] = useState(false);

  const { pre, edit, noteId, post } = parseNoteEdit(content);

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

  async function handleTranslate(lang: string) {
    setShowLangPicker(false);
    setIsTranslating(true);
    setTranslation(null);
    try {
      const { translation: result } = await translateText(content, lang);
      setTranslation(result);
      setTranslatedTo(lang);
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

  const translateButton = (
    <div className="relative">
      {showLangPicker && (
        <>
          <div className="fixed inset-0 z-[9]" onClick={() => setShowLangPicker(false)} />
          <div className={`absolute bottom-full mb-1 z-10 bg-[#1e1e2a] border border-[#2a2a38] rounded-xl shadow-xl overflow-hidden min-w-[140px] ${isUser ? "right-0" : "left-0"}`}>
            {TRANSLATE_LANGUAGES.map((lang) => (
              <button
                key={lang}
                onClick={() => handleTranslate(lang)}
                className="w-full text-left px-3 py-2 text-xs text-gray-300 hover:bg-[#2a2a38] transition"
              >
                {lang}
              </button>
            ))}
          </div>
        </>
      )}
      <button
        onClick={() => setShowLangPicker((v) => !v)}
        className="flex items-center gap-1 px-2 py-1 bg-[#2A2A2A]/60 backdrop-blur-sm rounded-md hover:text-indigo-300"
      >
        {isTranslating ? (
          <span className="animate-pulse">Translating…</span>
        ) : (
          <>
            <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" fill="currentColor" viewBox="0 0 16 16">
              <path d="M4.545 6.714 4.11 8H3l1.862-5h1.284L8 8H6.833l-.435-1.286H4.545zm1.634-.736L5.5 3.956h-.049l-.679 2.022H6.18z"/>
              <path d="M0 2a2 2 0 0 1 2-2h7a2 2 0 0 1 2 2v3h3a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-3H2a2 2 0 0 1-2-2V2zm2-1a1 1 0 0 0-1 1v7a1 1 0 0 0 1 1h7a1 1 0 0 0 1-1V2a1 1 0 0 0-1-1H2zm7.138 9.995c.193.301.402.583.63.846-.748.575-1.673 1.001-2.768 1.292.178.217.451.635.555.867 1.125-.359 2.08-.844 2.886-1.494.777.665 1.739 1.165 2.93 1.472.133-.254.414-.673.629-.89-1.125-.253-2.057-.694-2.82-1.284.681-.747 1.222-1.651 1.621-2.757H14v-.91h-3v-.703h-.905v.703h-3v.91h1.05c.171.592.43 1.147.774 1.657a6.08 6.08 0 0 1-1.927 1.292 5.085 5.085 0 0 0 .536.732 6.73 6.73 0 0 0 1.862-1.276z"/>
            </svg>
            Translate
          </>
        )}
      </button>
    </div>
  );

  return (
    <div className={`w-full flex ${isUser ? "justify-end" : "justify-start"} my-[3px]`}>
      <div
        className={`relative max-w-[740px] px-5 py-4 rounded-2xl text-[16px] leading-relaxed backdrop-blur-sm shadow-sm
          ${isUser ? "bg-[#2F2F3F]/80 text-gray-100" : "text-white"}`}
      >
        {/* Pre-edit text (or full content if no edit block) */}
        {pre && (
          <span>
            <MarkdownRenderer>{pre}</MarkdownRenderer>
            {streaming && (
              <span className="inline-block w-[2px] h-[1em] bg-indigo-400 ml-0.5 align-middle animate-[blink_0.8s_step-end_infinite]" />
            )}
          </span>
        )}
        {!pre && streaming && (
          <span className="inline-block w-[2px] h-[1em] bg-indigo-400 align-middle animate-[blink_0.8s_step-end_infinite]" />
        )}

        {/* Note edit block */}
        {edit && (
          <div className="mt-3 rounded-xl border border-indigo-500/30 bg-indigo-950/30 overflow-hidden">
            {/* Block header */}
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

            {/* Preview (collapsible) */}
            {editPreviewOpen && (
              <div className="px-4 py-3 max-h-60 overflow-y-auto border-b border-indigo-500/20">
                <MarkdownRenderer>{edit}</MarkdownRenderer>
              </div>
            )}

            {/* Raw content (always shown, scrollable) */}
            {!editPreviewOpen && (
              <pre className="px-4 py-3 text-xs text-indigo-100/80 whitespace-pre-wrap break-words font-mono leading-relaxed max-h-48 overflow-y-auto">
                {edit}
              </pre>
            )}

            {/* Action bar */}
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
                  className="px-2.5 py-1 text-[11px] text-gray-400 hover:text-gray-200 bg-[#1e1e2a] rounded-lg transition"
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

        {/* Post-edit text */}
        {post && <div className="mt-3"><MarkdownRenderer>{post}</MarkdownRenderer></div>}

        {/* Translation block */}
        {translation && (
          <div className="mt-3 pt-3 border-t border-[#2a2a38]">
            <div className="flex items-center justify-between mb-1">
              <span className="text-[11px] text-indigo-400 uppercase tracking-wider">{translatedTo}</span>
              <button onClick={() => setTranslation(null)} className="text-gray-600 hover:text-gray-400 text-xs">✕</button>
            </div>
            <p className="text-sm text-gray-300 leading-relaxed">{translation}</p>
          </div>
        )}

        {/* Assistant action bar */}
        {!isUser && (
          <div className="absolute -bottom-6 left-3 flex items-center gap-2 text-xs opacity-60 hover:opacity-100 transition">
            {translateButton}
            <button onClick={handleCopy} className="flex items-center gap-1 px-2 py-1 bg-[#2A2A2A]/60 backdrop-blur-sm rounded-md hover:text-indigo-300">
              <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" fill="currentColor" viewBox="0 0 16 16">
                <path d="M10 1.5A1.5 1.5 0 0 1 11.5 3v8A1.5 1.5 0 0 1 10 12.5H4A1.5 1.5 0 0 1 2.5 11V3A1.5 1.5 0 0 1 4 1.5h6Zm-6 1A.5.5 0 0 0 3.5 3v8a.5.5 0 0 0 .5.5h6a.5.5 0 0 0 .5-.5V3a.5.5 0 0 0-.5-.5H4Zm9 1.5v7.528a2.5 2.5 0 0 1-2 2.45V13h1a1.5 1.5 0 0 0 1.5-1.5V4h-.5Z"/>
              </svg>
              {copied ? "Copied!" : "Copy"}
            </button>
            {onAdd && (
              <button onClick={() => onAdd(translation ?? content)} className="flex items-center gap-1 px-2 py-1 bg-[#2A2A2A]/60 backdrop-blur-sm rounded-md hover:text-indigo-300">
                📒 Save
              </button>
            )}
            {onDelete && (
              <button onClick={onDelete} className="flex items-center gap-1 px-2 py-1 bg-[#2A2A2A]/60 backdrop-blur-sm rounded-md hover:text-red-300">
                🗑 Delete
              </button>
            )}
          </div>
        )}

        {/* User action bar */}
        {isUser && (
          <div className="absolute -bottom-6 right-3 flex items-center gap-2 text-xs opacity-60 hover:opacity-100 transition">
            {translateButton}
            {onDelete && (
              <button onClick={onDelete} className="flex items-center gap-1 px-2 py-1 bg-[#2A2A2A]/60 backdrop-blur-sm rounded-md hover:text-red-300">
                🗑
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
