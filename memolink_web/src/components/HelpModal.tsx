import React, { useState } from "react";
import { submitFeedback } from "../api/client";

interface HelpModalProps {
  show: boolean;
  onClose: () => void;
}

const sections = [
  {
    title: "What is MemoLink?",
    body: "MemoLink is a context-aware AI knowledge companion. It helps you capture ideas, take notes, chat with an AI assistant, and retrieve information intelligently — all in one place.",
  },
  {
    title: "Conversations",
    items: [
      "Start a new conversation from the sidebar.",
      "Attach files (PDF, DOCX, TXT, images) by dragging them into the chat or using the attachment button.",
      "The AI uses your notes and conversation history to give context-aware answers.",
      "Click any message's menu to save it as a note or delete it.",
    ],
  },
  {
    title: "Notes",
    items: [
      "Create notes from the sidebar or by saving AI messages.",
      "Use the rich editor with bold, italic, headings, lists, and more.",
      "Record voice memos — transcription is automatic.",
      "Deleted notes go to the Recycle Bin and can be restored.",
    ],
  },
  {
    title: "Reminders",
    items: [
      "Open the right panel (bell icon) to view and create reminders.",
      "A pulsing amber bell in the top bar means you have reminders due today.",
      "Reminders can have a due date and optional time.",
    ],
  },
  {
    title: "Tips",
    items: [
      "Ask the AI to summarize your notes or find information across them.",
      "Use the search in the sidebar to quickly find notes and conversations.",
      "Switch between Chat and Note tabs at the top of the workspace.",
    ],
  },
];

export function HelpModal({ show, onClose }: HelpModalProps) {
  const [fbType, setFbType] = useState<"bug" | "suggestion">("bug");
  const [fbMessage, setFbMessage] = useState("");
  const [fbState, setFbState] = useState<"idle" | "sending" | "sent" | "error">("idle");

  async function handleFeedbackSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!fbMessage.trim()) return;
    setFbState("sending");
    try {
      await submitFeedback(fbType, fbMessage.trim());
      setFbState("sent");
      setFbMessage("");
    } catch {
      setFbState("error");
    }
  }

  if (!show) return null;

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50" onClick={onClose}>
      <div
        className="bg-[#1a1a24] border border-[#2a2a38] rounded-2xl w-[520px] max-h-[80vh] flex flex-col shadow-2xl text-white overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#2a2a38] shrink-0">
          <div className="flex items-center gap-2.5">
            <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5 text-indigo-400" fill="currentColor" viewBox="0 0 16 16">
              <path d="M8 15A7 7 0 1 1 8 1a7 7 0 0 1 0 14m0 1A8 8 0 1 0 8 0a8 8 0 0 0 0 16"/>
              <path d="M5.255 5.786a.237.237 0 0 0 .241.247h.825c.138 0 .248-.113.266-.25.09-.656.54-1.134 1.342-1.134.686 0 1.314.343 1.314 1.168 0 .635-.374.927-.965 1.371-.673.489-1.206 1.06-1.168 1.987l.003.217a.25.25 0 0 0 .25.246h.811a.25.25 0 0 0 .25-.25v-.105c0-.718.273-.927 1.01-1.486.609-.463 1.244-.977 1.244-2.056 0-1.511-1.276-2.241-2.673-2.241-1.267 0-2.655.59-2.75 2.286m1.557 5.763c0 .533.425.927 1.01.927.609 0 1.028-.394 1.028-.927 0-.552-.42-.94-1.029-.94-.584 0-1.009.388-1.009.94"/>
            </svg>
            <h2 className="font-semibold text-base">Help & Guide</h2>
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

        {/* Scrollable body */}
        <div className="overflow-y-auto px-6 py-5 space-y-6">
          {sections.map((s) => (
            <div key={s.title}>
              <h3 className="text-sm font-semibold text-indigo-400 mb-2">{s.title}</h3>
              {"body" in s ? (
                <p className="text-sm text-gray-400 leading-relaxed">{s.body}</p>
              ) : (
                <ul className="space-y-1.5">
                  {s.items!.map((item, i) => (
                    <li key={i} className="flex gap-2 text-sm text-gray-400">
                      <span className="text-indigo-500 shrink-0 mt-0.5">•</span>
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}

          {/* Report Bug / Suggestion form */}
          <div className="border-t border-[#2a2a38] pt-5">
            <div className="flex items-center gap-2 mb-3">
              <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4 text-indigo-400 shrink-0" fill="currentColor" viewBox="0 0 16 16">
                <path d="M14 1a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H4.414A2 2 0 0 0 3 11.586l-2 2V2a1 1 0 0 1 1-1zM2 0a2 2 0 0 0-2 2v12.793a.5.5 0 0 0 .854.353l2.853-2.853A1 1 0 0 1 4.414 12H14a2 2 0 0 0 2-2V2a2 2 0 0 0-2-2z"/>
              </svg>
              <h3 className="text-sm font-semibold text-indigo-400">Report a Bug or Suggestion</h3>
            </div>

            {fbState === "sent" ? (
              <div className="flex flex-col items-center gap-2 py-4 text-center">
                <div className="w-9 h-9 rounded-full bg-emerald-500/10 flex items-center justify-center">
                  <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5 text-emerald-400" fill="currentColor" viewBox="0 0 16 16">
                    <path d="M13.854 3.646a.5.5 0 0 1 0 .708l-7 7a.5.5 0 0 1-.708 0l-3.5-3.5a.5.5 0 1 1 .708-.708L6.5 10.293l6.646-6.647a.5.5 0 0 1 .708 0"/>
                  </svg>
                </div>
                <p className="text-sm text-emerald-400 font-medium">Thank you for your feedback!</p>
                <p className="text-xs text-gray-500">Your report has been submitted successfully.</p>
                <button
                  onClick={() => setFbState("idle")}
                  className="mt-1 text-xs text-indigo-400 hover:text-indigo-300 underline underline-offset-2 transition"
                >
                  Submit another
                </button>
              </div>
            ) : (
              <form onSubmit={handleFeedbackSubmit} className="space-y-3">
                {/* Type toggle */}
                <div className="flex rounded-lg overflow-hidden border border-[#2a2a38]">
                  {(["bug", "suggestion"] as const).map((t) => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => setFbType(t)}
                      className={`flex-1 flex items-center justify-center gap-1.5 py-2 text-xs font-medium transition ${
                        fbType === t
                          ? "bg-indigo-600 text-white"
                          : "bg-[#12121a] text-gray-500 hover:text-gray-300"
                      }`}
                    >
                      {t === "bug" ? (
                        <>
                          <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 16 16">
                            <path d="M4.355.522a.5.5 0 0 1 .623.333l.291.956A5 5 0 0 1 8 1c.993 0 1.925.26 2.731.711l.29-.956a.5.5 0 1 1 .957.29l-.41 1.352A5 5 0 0 1 13 6h.5a.5.5 0 0 0 .5-.5V5a.5.5 0 0 1 1 0v.5A1.5 1.5 0 0 1 13.5 7H13v1h1.5a.5.5 0 0 1 0 1H13v1h.5a1.5 1.5 0 0 1 1.5 1.5v.5a.5.5 0 0 1-1 0v-.5a.5.5 0 0 0-.5-.5H13a5 5 0 0 1-10 0H2.5a.5.5 0 0 0-.5.5v.5a.5.5 0 0 1-1 0v-.5A1.5 1.5 0 0 1 2.5 10H3V9H1.5a.5.5 0 0 1 0-1H3V7h-.5A1.5 1.5 0 0 1 1 5.5V5a.5.5 0 0 1 1 0v.5a.5.5 0 0 0 .5.5H3a5 5 0 0 1 1.833-3.843L4.355.522zM8 2a4 4 0 1 0 0 8A4 4 0 0 0 8 2M5.5 7.5a.5.5 0 0 1 .5-.5h4a.5.5 0 0 1 0 1H6a.5.5 0 0 1-.5-.5m0-2a.5.5 0 0 1 .5-.5h4a.5.5 0 0 1 0 1H6a.5.5 0 0 1-.5-.5"/>
                          </svg>
                          Bug Report
                        </>
                      ) : (
                        <>
                          <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 16 16">
                            <path d="M8 1a7 7 0 1 0 0 14A7 7 0 0 0 8 1M0 8a8 8 0 1 1 16 0A8 8 0 0 1 0 8"/>
                            <path d="m8.93 6.588-2.29.287-.082.38.45.083c.294.07.352.176.288.469l-.738 3.468c-.194.897.105 1.319.808 1.319.545 0 1.178-.252 1.465-.598l.088-.416c-.2.176-.492.246-.686.246-.275 0-.375-.193-.304-.533zM9 4.5a1 1 0 1 1-2 0 1 1 0 0 1 2 0"/>
                          </svg>
                          Suggestion
                        </>
                      )}
                    </button>
                  ))}
                </div>

                {/* Message textarea */}
                <textarea
                  value={fbMessage}
                  onChange={(e) => { setFbMessage(e.target.value); if (fbState === "error") setFbState("idle"); }}
                  placeholder={fbType === "bug" ? "Describe the bug — what happened and what you expected…" : "Share your idea or feature request…"}
                  rows={4}
                  className="w-full bg-[#12121a] border border-[#2a2a38] rounded-xl px-3 py-2.5 text-sm text-gray-300 placeholder-gray-600 resize-none focus:outline-none focus:border-indigo-500/60 transition"
                />

                {fbState === "error" && (
                  <p className="text-xs text-red-400">Failed to submit — please try again.</p>
                )}

                <button
                  type="submit"
                  disabled={!fbMessage.trim() || fbState === "sending"}
                  className="w-full py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed text-sm font-medium text-white transition"
                >
                  {fbState === "sending" ? "Sending…" : "Submit"}
                </button>
              </form>
            )}
          </div>

          <div className="border-t border-[#2a2a38] pt-4">
            <p className="text-xs text-gray-600 text-center">
              MemoLink — AI Knowledge Companion &nbsp;·&nbsp; Capstone Project
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
