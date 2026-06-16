import React, { useState, useMemo } from "react";
import { marked } from "marked";
import { api } from "../api/client";
import { RichNoteEditor } from "./RichNoteEditor";

interface EmailDraftCardProps {
  to: string;
  subject: string;
  body: string;
  messageId: string;
  threadId: string;
}

const sentKey = (messageId: string, threadId: string) => `memolink_draft_sent_${messageId || threadId}`;

function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>|<\/li>|<\/h[1-6]>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, " ")
    .replace(/\n{3,}/g, "\n\n").trim();
}

function isMarkdown(text: string): boolean {
  return /(\*\*|__|\*|_|^#{1,6} |^- |\d+\. )/m.test(text);
}

function isHtmlContent(text: string): boolean {
  return /^\s*<[a-z]/.test(text);
}

export function EmailDraftCard({ to, subject, body: initialBody, messageId, threadId }: EmailDraftCardProps) {
  // bodyContent is the editable source — plain text, markdown, or HTML (after editing in TipTap)
  const [bodyContent, setBodyContent] = useState(stripHtml(initialBody));
  const [editing, setEditing] = useState(false);
  const trackKey = messageId || threadId ? sentKey(messageId, threadId) : null;
  const alreadySent = trackKey ? !!localStorage.getItem(trackKey) : false;
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">(alreadySent ? "sent" : "idle");
  const [errorMsg, setErrorMsg] = useState("");

  // Preview HTML: render markdown → HTML, or use as-is if already HTML
  const previewHtml = useMemo(() => {
    if (isHtmlContent(bodyContent)) return bodyContent;
    if (isMarkdown(bodyContent)) {
      try { return marked.parse(bodyContent, { async: false }) as string; } catch { /* fall through */ }
    }
    return null;
  }, [bodyContent]);

  async function handleSend() {
    setStatus("sending");
    try {
      // Prefer HTML body for rich rendering in Gmail; fall back to plain text
      const sendBody = previewHtml ?? bodyContent;
      await api.post("/email/send-draft", { to, subject, body: sendBody, message_id: messageId, thread_id: threadId });
      if (trackKey) localStorage.setItem(trackKey, "1");
      setStatus("sent");
    } catch (e: any) {
      setStatus("error");
      setErrorMsg(e?.response?.data?.detail ?? "Failed to send");
    }
  }

  if (status === "sent") {
    return (
      <div className="my-2 flex items-center gap-2 px-4 py-3 rounded-xl bg-green-500/10 border border-green-500/30 text-green-300 text-sm">
        <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4 shrink-0" fill="currentColor" viewBox="0 0 16 16">
          <path d="M16 8A8 8 0 1 1 0 8a8 8 0 0 1 16 0m-3.97-3.03a.75.75 0 0 0-1.08.022L7.477 9.417 5.384 7.323a.75.75 0 0 0-1.06 1.06L6.97 11.03a.75.75 0 0 0 1.079-.02l3.992-4.99a.75.75 0 0 0-.01-1.05z"/>
        </svg>
        Email sent to <span className="font-medium">{to}</span>
      </div>
    );
  }

  return (
    <div className="my-2 rounded-xl border border-indigo-500/30 bg-[#13131f] overflow-hidden text-sm">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-indigo-500/20 bg-indigo-500/5">
        <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5 text-indigo-400 shrink-0" fill="currentColor" viewBox="0 0 16 16">
          <path d="M0 4a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H2a2 2 0 0 1-2-2zm2-1a1 1 0 0 0-1 1v.217l7 4.2 7-4.2V4a1 1 0 0 0-1-1zm13 2.383-4.708 2.825L15 11.105zm-.034 6.876-5.64-3.471L8 9.583l-1.326-.795-5.64 3.47A1 1 0 0 0 2 13h12a1 1 0 0 0 .966-.741M1 11.105l4.708-2.897L1 5.383z"/>
        </svg>
        <span className="text-indigo-300 font-medium text-xs">Draft Email</span>
        <span className="ml-auto text-[11px] text-gray-500">Review before sending</span>
      </div>

      {/* To / Subject */}
      <div className="px-4 pt-3 pb-2 space-y-2">
        <div className="flex gap-2 text-xs">
          <span className="text-gray-500 w-14 shrink-0 pt-0.5">To</span>
          <span className="text-gray-200">{to}</span>
        </div>
        <div className="flex gap-2 text-xs">
          <span className="text-gray-500 w-14 shrink-0 pt-0.5">Subject</span>
          <span className="text-gray-300">{subject}</span>
        </div>
      </div>

      {/* Message — divider then editor/preview */}
      <div className="border-t border-[var(--ml-bg-panel)]">
        {editing ? (
          /* Full TipTap editor with toolbar */
          <div className="h-72">
            <RichNoteEditor
              value={bodyContent}
              onChange={setBodyContent}
              noteKey="email-draft"
            />
          </div>
        ) : (
          /* Preview */
          <div className="px-4 py-3">
            {previewHtml ? (
              <div
                className="text-gray-200 text-xs prose prose-invert prose-xs max-w-none
                  [&_h1]:text-sm [&_h1]:font-bold [&_h1]:mb-1 [&_h1]:mt-2
                  [&_h2]:text-xs [&_h2]:font-bold [&_h2]:mb-1 [&_h2]:mt-2
                  [&_h3]:text-xs [&_h3]:font-semibold [&_h3]:mb-0.5 [&_h3]:mt-1.5
                  [&_p]:mb-1.5 [&_p]:leading-relaxed
                  [&_ul]:pl-4 [&_ul]:mb-1.5 [&_ul]:space-y-0.5
                  [&_ol]:pl-4 [&_ol]:mb-1.5 [&_ol]:space-y-0.5
                  [&_li]:leading-relaxed
                  [&_strong]:text-white [&_strong]:font-semibold"
                dangerouslySetInnerHTML={{ __html: previewHtml }}
              />
            ) : (
              <span className="text-gray-200 text-xs whitespace-pre-wrap">{bodyContent}</span>
            )}
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2 px-4 py-2.5 border-t border-[var(--ml-bg-panel)]">
        {status === "error" && (
          <span className="text-red-400 text-xs flex-1">{errorMsg}</span>
        )}
        <div className="flex gap-2 ml-auto">
          <button
            onClick={() => setEditing((v) => !v)}
            disabled={status === "sending"}
            className="px-3 py-1.5 text-xs text-gray-400 hover:text-gray-200 bg-[var(--ml-bg-panel)] hover:bg-[var(--ml-bg-hover)] rounded-lg transition"
          >
            {editing ? "Done" : "Edit"}
          </button>
          <button
            onClick={handleSend}
            disabled={status === "sending" || !bodyContent.trim()}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg transition"
          >
            {status === "sending" ? (
              <>
                <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
                </svg>
                Sending…
              </>
            ) : (
              <>
                <svg xmlns="http://www.w3.org/2000/svg" className="w-3 h-3" fill="currentColor" viewBox="0 0 16 16">
                  <path d="M15.854.146a.5.5 0 0 1 .11.54l-5.819 14.547a.75.75 0 0 1-1.329.124l-3.178-4.995L.643 7.184a.75.75 0 0 1 .124-1.33L15.314.037a.5.5 0 0 1 .54.11ZM6.636 10.07l2.761 4.338L14.13 2.576zm6.787-8.201L1.591 6.602l4.339 2.76z"/>
                </svg>
                Send
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
