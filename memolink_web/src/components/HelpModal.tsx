import React from "react";

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
