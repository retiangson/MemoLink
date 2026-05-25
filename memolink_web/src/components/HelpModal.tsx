import React, { useState } from "react";

interface HelpModalProps {
  show: boolean;
  onClose: () => void;
}

type Section = {
  id: string;
  label: string;
  icon: React.ReactNode;
};

const NAV: Section[] = [
  { id: "overview",   label: "Overview",         icon: <path d="M8 4a.5.5 0 0 1 .5.5v3h3a.5.5 0 0 1 0 1h-3v3a.5.5 0 0 1-1 0v-3h-3a.5.5 0 0 1 0-1h3v-3A.5.5 0 0 1 8 4"/> },
  { id: "workspaces", label: "Workspaces",        icon: <path d="M1 3.5A1.5 1.5 0 0 1 2.5 2h2.764c.958 0 1.76.56 2.311 1.184C7.985 3.648 8.48 4 9 4h4.5A1.5 1.5 0 0 1 15 5.5v7a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 1 12.5z"/> },
  { id: "chat",       label: "AI Chat",           icon: <path d="M14 1a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H4.414A2 2 0 0 0 3 11.586l-2 2V2a1 1 0 0 1 1-1zM2 0a2 2 0 0 0-2 2v12.793a.5.5 0 0 0 .854.353l2.853-2.853A1 1 0 0 1 4.414 12H14a2 2 0 0 0 2-2V2a2 2 0 0 0-2-2z"/> },
  { id: "notes",      label: "Notes",             icon: <path d="M2.5 1A1.5 1.5 0 0 0 1 2.5v11A1.5 1.5 0 0 0 2.5 15h6.086a1.5 1.5 0 0 0 1.06-.44l4.915-4.914A1.5 1.5 0 0 0 15 8.586V2.5A1.5 1.5 0 0 0 13.5 1zm6 8.5a1 1 0 0 1 1-1h4.396l-5.396 5.397z"/> },
  { id: "import",     label: "File & Video",      icon: <path d="M.5 9.9a.5.5 0 0 1 .5.5v2.5a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-2.5a.5.5 0 0 1 1 0v2.5a2 2 0 0 1-2 2H2a2 2 0 0 1-2-2v-2.5a.5.5 0 0 1 .5-.5M7.646 1.146a.5.5 0 0 1 .708 0l3 3a.5.5 0 0 1-.708.708L8.5 2.707V11.5a.5.5 0 0 1-1 0V2.707L5.354 4.854a.5.5 0 1 1-.708-.708z"/> },
  { id: "aitools",    label: "AI Tools",          icon: <><path d="M6 12.5a.5.5 0 0 1 .5-.5h3a.5.5 0 0 1 0 1h-3a.5.5 0 0 1-.5-.5M3 8.062C3 6.76 4.235 5.765 5.53 5.886a26.6 26.6 0 0 0 4.94 0C11.765 5.765 13 6.76 13 8.062v1.157a.93.93 0 0 1-.765.935c-.845.147-2.34.346-4.235.346s-3.39-.2-4.235-.346A.93.93 0 0 1 3 9.219zm4.542-.827a.25.25 0 0 0-.217.068l-.92.9a25 25 0 0 1-1.871-.183.25.25 0 0 0-.068.495c.55.076 1.232.149 2.02.193a.25.25 0 0 0 .189-.071l.754-.736.847 1.71a.25.25 0 0 0 .404.062l.932-.97a25 25 0 0 0 1.922-.188.25.25 0 0 0-.068-.495c-.538.074-1.207.145-1.98.189a.25.25 0 0 0-.166.076l-.754.785-.842-1.7a.25.25 0 0 0-.182-.134"/><path d="M8.5 1.866a1 1 0 1 0-1 0V3h-2A4.5 4.5 0 0 0 1 7.5V8a1 1 0 0 0-1 1v2a1 1 0 0 0 1 1v1a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-1a1 1 0 0 0 1-1V9a1 1 0 0 0-1-1v-.5A4.5 4.5 0 0 0 10.5 3h-2zM14 7.5V13a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V7.5A3.5 3.5 0 0 1 5.5 4h5A3.5 3.5 0 0 1 14 7.5"/></> },
  { id: "reminders",  label: "Reminders",         icon: <path d="M8 16a2 2 0 0 0 2-2H6a2 2 0 0 0 2 2M8 1.918l-.797.161A4 4 0 0 0 4 6c0 .628-.134 2.197-.459 3.742-.16.767-.376 1.566-.663 2.258h10.244c-.287-.692-.502-1.49-.663-2.258C12.134 8.197 12 6.628 12 6a4 4 0 0 0-3.203-3.92zM14.22 12c.223.447.481.801.78 1H1c.299-.199.557-.553.78-1C2.68 10.2 3 6.88 3 6c0-2.42 1.72-4.44 4.005-4.901a1 1 0 1 1 1.99 0A5 5 0 0 1 13 6c0 .88.32 4.2 1.22 6"/> },
  { id: "models",     label: "AI Models",         icon: <path d="M6 12.5a.5.5 0 0 1 .5-.5h3a.5.5 0 0 1 0 1h-3a.5.5 0 0 1-.5-.5M3 8.062C3 6.76 4.235 5.765 5.53 5.886a26.6 26.6 0 0 0 4.94 0C11.765 5.765 13 6.76 13 8.062v1.157a.93.93 0 0 1-.765.935c-.845.147-2.34.346-4.235.346s-3.39-.2-4.235-.346A.93.93 0 0 1 3 9.219zm4.542-.827a.25.25 0 0 0-.217.068l-.92.9a25 25 0 0 1-1.871-.183.25.25 0 0 0-.068.495c.55.076 1.232.149 2.02.193a.25.25 0 0 0 .189-.071l.754-.736.847 1.71a.25.25 0 0 0 .404.062l.932-.97a25 25 0 0 0 1.922-.188.25.25 0 0 0-.068-.495c-.538.074-1.207.145-1.98.189a.25.25 0 0 0-.166.076l-.754.785-.842-1.7a.25.25 0 0 0-.182-.134"/> },
  { id: "tips",       label: "Tips & Shortcuts",  icon: <path d="M2 2a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v13.5a.5.5 0 0 1-.777.416L8 13.101l-5.223 2.815A.5.5 0 0 1 2 15.5zm2-1a1 1 0 0 0-1 1v12.566l4.723-2.482a.5.5 0 0 1 .554 0L13 14.566V2a1 1 0 0 0-1-1z"/> },
];

const CONTENT: Record<string, React.ReactNode> = {
  overview: (
    <div className="space-y-4">
      <p className="text-sm text-gray-400 leading-relaxed">
        <span className="text-white font-medium">MemoLink</span> is a context-aware AI knowledge companion designed for students and knowledge workers. It combines intelligent note management, RAG-powered AI chat, and productivity tools into one workspace.
      </p>
      <div className="grid grid-cols-2 gap-3">
        {[
          { label: "Workspaces", desc: "Separate contexts for different subjects or projects" },
          { label: "AI Chat", desc: "Grounded answers from your own notes via RAG" },
          { label: "Smart Notes", desc: "Rich editor with voice, images, and formatting" },
          { label: "File & Video", desc: "Import PDFs, DOCX, PPTX, YouTube, and recordings" },
          { label: "AI Tools", desc: "Web search, agent mode, research, image generation" },
          { label: "Reminders", desc: "Auto-detected from notes or set manually" },
        ].map((f) => (
          <div key={f.label} className="bg-[#12121a] border border-[#2a2a38] rounded-xl p-3">
            <p className="text-xs font-semibold text-indigo-300 mb-0.5">{f.label}</p>
            <p className="text-[11px] text-gray-500 leading-relaxed">{f.desc}</p>
          </div>
        ))}
      </div>
    </div>
  ),

  workspaces: (
    <div className="space-y-3 text-sm text-gray-400 leading-relaxed">
      <p>Workspaces keep your notes, conversations, and reminders completely separate. Switch between them from the workspace selector in the top bar.</p>
      <ul className="space-y-2">
        {[
          "Create a workspace for each subject, project, or client - AI answers never mix content across workspaces.",
          "The last-used workspace is restored automatically when you log back in.",
          "Each workspace has its own conversation list and note library.",
          "Delete a workspace to cascade-remove all its notes, conversations, and reminders.",
          "Rename or change the description of a workspace anytime from the workspace manager.",
        ].map((item, i) => (
          <li key={i} className="flex gap-2"><span className="text-indigo-500 shrink-0 mt-0.5">•</span><span>{item}</span></li>
        ))}
      </ul>
    </div>
  ),

  chat: (
    <div className="space-y-3 text-sm text-gray-400 leading-relaxed">
      <p>MemoLink uses <span className="text-white">Retrieval-Augmented Generation (RAG)</span> - every AI answer is grounded in the notes you've uploaded to the current workspace. Sources are cited below the reply.</p>
      <ul className="space-y-2">
        {[
          "Start a new conversation from the sidebar. Conversations are scoped to the active workspace.",
          "Responses stream token-by-token so you can start reading before the reply is complete.",
          "Each AI reply shows a \"replied by [model]\" attribution badge (if enabled by admin).",
          "Save any AI reply as a note with the ⊕ button - it becomes searchable in future chats.",
          "Delete individual messages with the trash icon.",
          "Rename a conversation by clicking its title in the sidebar.",
          "Deleted conversations go to the Recycle Bin and can be restored.",
          "Drag and drop files directly into the chat to attach them inline.",
        ].map((item, i) => (
          <li key={i} className="flex gap-2"><span className="text-indigo-500 shrink-0 mt-0.5">•</span><span>{item}</span></li>
        ))}
      </ul>
    </div>
  ),

  notes: (
    <div className="space-y-3 text-sm text-gray-400 leading-relaxed">
      <p>Notes are the core of MemoLink's knowledge base. Everything you write is vectorised and becomes context for AI answers.</p>
      <ul className="space-y-2">
        {[
          "Create a note from the sidebar or by saving an AI message.",
          "The rich editor supports headings (H1–H4), bold, italic, underline, bullet and numbered lists, checklists, tables, and code blocks.",
          "Paste a screenshot directly into the editor - images are embedded as base64 and stored inline.",
          "Record a voice memo with the microphone button; transcription is automatic via OpenAI Whisper.",
          "Deleted notes go to the Recycle Bin (bell icon in sidebar) and can be restored or permanently deleted.",
          "AI answers retrieve the most relevant chunks from your notes using semantic search.",
        ].map((item, i) => (
          <li key={i} className="flex gap-2"><span className="text-indigo-500 shrink-0 mt-0.5">•</span><span>{item}</span></li>
        ))}
      </ul>
    </div>
  ),

  import: (
    <div className="space-y-4 text-sm text-gray-400 leading-relaxed">
      <div>
        <p className="text-xs font-semibold text-indigo-300 mb-2 uppercase tracking-wider">Document Import</p>
        <ul className="space-y-2">
          {[
            "PDF - headings inferred from font-size ratio; plain text extracted.",
            "DOCX - H1–H4 headings, bold, italic, underline, bullet and numbered lists, tables, and embedded images preserved.",
            "PPTX - slide titles become H2, slide content becomes lists.",
            "TXT - plain text imported as-is.",
            "Bulk upload: drag multiple files into the Upload Notes panel; each becomes a separate note.",
          ].map((item, i) => (
            <li key={i} className="flex gap-2"><span className="text-indigo-500 shrink-0 mt-0.5">•</span><span>{item}</span></li>
          ))}
        </ul>
      </div>
      <div>
        <p className="text-xs font-semibold text-indigo-300 mb-2 uppercase tracking-wider">Video & Audio Import</p>
        <ul className="space-y-2">
          {[
            "Paste a YouTube URL - the transcript is extracted via YouTube Caption API and saved as a note.",
            "Upload a video or audio file (MP4, M4A, WebM, MOV, MP3, WAV - max 25 MB) for Whisper transcription.",
            "Upload a Zoom recording or lecture capture; the transcript is saved as a searchable note.",
          ].map((item, i) => (
            <li key={i} className="flex gap-2"><span className="text-indigo-500 shrink-0 mt-0.5">•</span><span>{item}</span></li>
          ))}
        </ul>
      </div>
    </div>
  ),

  aitools: (
    <div className="space-y-4 text-sm text-gray-400 leading-relaxed">
      {[
        {
          title: "Web Search",
          desc: "Toggle the globe icon in the chat input to inject live Brave Search results as context before the AI responds. Useful for questions about recent events beyond your notes.",
        },
        {
          title: "Agent Mode",
          desc: "Enable the Agent toggle for complex multi-step questions. The AI reasons through sub-tasks using tools, showing tool-call chips as it works, then delivers a final answer.",
        },
        {
          title: "Research Mode",
          desc: "The Research toggle runs a dedicated multi-source pipeline - web search + your notes - and returns a cited, structured answer. Requires Plus or higher access level (configurable by admin).",
        },
        {
          title: "Image Generation",
          desc: "Type a request like \"generate an image of…\" and MemoLink tries gpt-image-2 → DALL-E 3 → DALL-E 2 → Pollinations.ai in sequence until one succeeds. The image is embedded inline in the chat.",
        },
        {
          title: "Translation",
          desc: "Click the translate button on any AI message. Uses a Gemini quality-loop: initial translation → back-translate → similarity score (0–100) → up to 3 refinements if the score is below 85.",
        },
      ].map((t) => (
        <div key={t.title}>
          <p className="text-xs font-semibold text-indigo-300 mb-1">{t.title}</p>
          <p>{t.desc}</p>
        </div>
      ))}
    </div>
  ),

  reminders: (
    <div className="space-y-3 text-sm text-gray-400 leading-relaxed">
      <p>Reminders help you track deadlines and tasks extracted from your study or work notes.</p>
      <ul className="space-y-2">
        {[
          "Open the right panel with the bell icon to view, create, and manage reminders.",
          "Use the Suggest button to let AI scan your notes and propose reminders for detected deadlines.",
          "Each reminder has a title, optional description, due date, and optional time.",
          "A pulsing amber bell in the top bar means you have reminders due today.",
          "Browser notifications are sent when a reminder fires (grant permission when prompted).",
          "Reminders are scoped to the active workspace, keeping study and work tasks separate.",
        ].map((item, i) => (
          <li key={i} className="flex gap-2"><span className="text-indigo-500 shrink-0 mt-0.5">•</span><span>{item}</span></li>
        ))}
      </ul>
    </div>
  ),

  models: (
    <div className="space-y-4 text-sm text-gray-400 leading-relaxed">
      <p>Open <span className="text-white">Settings → AI Model</span> to choose your chat model. Every reply shows a "replied by" badge and the model is saved in conversation history.</p>
      <div className="space-y-3">
        {[
          {
            provider: "OpenAI",
            models: ["GPT-4o (most capable)", "GPT-4o Mini (default, fast)", "GPT-4 Turbo", "GPT-3.5 Turbo"],
          },
          {
            provider: "Google Gemini",
            models: ["Gemini 2.0 Flash", "Gemini 2.0 Flash Lite", "Gemini 1.5 Flash 8B", "Gemini 1.5 Pro"],
            note: "Free tier - rate limits may apply. Falls back to GPT-4o Mini on quota exceeded.",
          },
          {
            provider: "DeepSeek",
            models: ["DeepSeek V3 (general)", "DeepSeek R1 (reasoning)", "DeepSeek Coder (code-focused)"],
          },
        ].map((p) => (
          <div key={p.provider}>
            <p className="text-xs font-semibold text-indigo-300 mb-1">{p.provider}</p>
            <ul className="space-y-1">
              {p.models.map((m) => (
                <li key={m} className="flex gap-2"><span className="text-indigo-500 shrink-0 mt-0.5">·</span><span>{m}</span></li>
              ))}
            </ul>
            {p.note && <p className="text-[11px] text-gray-600 mt-1">{p.note}</p>}
          </div>
        ))}
      </div>
    </div>
  ),

  tips: (
    <div className="space-y-3 text-sm text-gray-400 leading-relaxed">
      <ul className="space-y-2">
        {[
          "Press Enter to send a message; Shift+Enter for a new line.",
          "Drag files directly onto the chat area to attach them without clicking the attachment button.",
          "Save a useful AI reply as a note immediately - it becomes searchable context for future chats.",
          "Use specific, descriptive workspace names (e.g. \"COMP301 Capstone\") for cleaner AI context isolation.",
          "If an AI answer misses something, upload the relevant document and ask again - retrieval improves instantly.",
          "Research Mode works best for broad questions; use regular chat for quick note look-ups.",
          "The default model set by the admin applies when model selection is disabled - check Settings to see what's available to you.",
          "Reminders → Suggest scans only the active workspace - switch workspaces to suggest from different note sets.",
          "Paste a YouTube video URL in the Upload Notes panel to instantly transcribe and import it.",
        ].map((item, i) => (
          <li key={i} className="flex gap-2"><span className="text-indigo-500 shrink-0 mt-0.5">•</span><span>{item}</span></li>
        ))}
      </ul>
    </div>
  ),
};

export function HelpModal({ show, onClose }: HelpModalProps) {
  const [active, setActive] = useState("overview");

  if (!show) return null;

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50" onClick={onClose}>
      <div
        className="bg-[#1a1a24] border border-[#2a2a38] rounded-2xl w-[700px] max-h-[82vh] flex flex-col shadow-2xl text-white overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#2a2a38] shrink-0">
          <div className="flex items-center gap-2.5">
            <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5 text-indigo-400" fill="currentColor" viewBox="0 0 16 16">
              <path d="M8 15A7 7 0 1 1 8 1a7 7 0 0 1 0 14m0 1A8 8 0 1 0 8 0a8 8 0 0 0 0 16"/>
              <path d="M5.255 5.786a.237.237 0 0 0 .241.247h.825c.138 0 .248-.113.266-.25.09-.656.54-1.134 1.342-1.134.686 0 1.314.343 1.314 1.168 0 .635-.374.927-.965 1.371-.673.489-1.206 1.06-1.168 1.987l.003.217a.25.25 0 0 0 .25.246h.811a.25.25 0 0 0 .25-.25v-.105c0-.718.273-.927 1.01-1.486.609-.463 1.244-.977 1.244-2.056 0-1.511-1.276-2.241-2.673-2.241-1.267 0-2.655.59-2.75 2.286m1.557 5.763c0 .533.425.927 1.01.927.609 0 1.028-.394 1.028-.927 0-.552-.42-.94-1.029-.94-.584 0-1.009.388-1.009.94"/>
            </svg>
            <h2 className="font-semibold text-base">Help &amp; Guide</h2>
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

        {/* Body: sidebar nav + content */}
        <div className="flex flex-1 overflow-hidden">
          {/* Nav */}
          <nav className="w-44 shrink-0 border-r border-[#2a2a38] py-3 px-2 flex flex-col gap-0.5 overflow-y-auto">
            {NAV.map(({ id, label, icon }) => (
              <button
                key={id}
                onClick={() => setActive(id)}
                className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs text-left transition ${
                  active === id
                    ? "bg-indigo-600/20 text-indigo-300 font-medium"
                    : "text-gray-500 hover:text-gray-200 hover:bg-[#1e1e2a]"
                }`}
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5 shrink-0" fill="currentColor" viewBox="0 0 16 16">
                  {icon}
                </svg>
                {label}
              </button>
            ))}
          </nav>

          {/* Content */}
          <div className="flex-1 overflow-y-auto px-6 py-5">
            <h3 className="text-sm font-semibold text-white mb-4">
              {NAV.find((n) => n.id === active)?.label}
            </h3>
            {CONTENT[active]}
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-[#2a2a38] shrink-0">
          <p className="text-[11px] text-gray-700 text-center">
            MemoLink - AI Knowledge Companion &nbsp;·&nbsp; Capstone Project
          </p>
        </div>
      </div>
    </div>
  );
}
