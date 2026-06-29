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
  { id: "sources",    label: "Source & Drawing",  icon: <><path d="M2 2h8l4 4v8H2z"/><path d="M10 2v4h4M4 12l6-6 2 2-6 6H4z"/></> },
  { id: "import",     label: "File & Video",      icon: <path d="M.5 9.9a.5.5 0 0 1 .5.5v2.5a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-2.5a.5.5 0 0 1 1 0v2.5a2 2 0 0 1-2 2H2a2 2 0 0 1-2-2v-2.5a.5.5 0 0 1 .5-.5M7.646 1.146a.5.5 0 0 1 .708 0l3 3a.5.5 0 0 1-.708.708L8.5 2.707V11.5a.5.5 0 0 1-1 0V2.707L5.354 4.854a.5.5 0 1 1-.708-.708z"/> },
  { id: "books",      label: "Books Library",     icon: <path d="M1 2.828c.885-.37 2.154-.769 3.388-.893 1.33-.134 2.458.063 3.112.752v9.746c-.935-.53-2.12-.603-3.213-.493-1.18.12-2.37.461-3.287.811zm7.5-.141c.654-.689 1.782-.886 3.112-.752 1.234.124 2.503.523 3.388.893v9.923c-.918-.35-2.107-.692-3.287-.81-1.094-.111-2.278-.039-3.213.492zM8 1.783C7.015.936 5.587.81 4.287.94c-1.514.153-3.042.672-3.994 1.105A.5.5 0 0 0 0 2.5v11a.5.5 0 0 0 .707.455c.882-.4 2.303-.881 3.68-1.02 1.409-.142 2.59.087 3.223.877a.5.5 0 0 0 .78 0c.633-.79 1.814-1.019 3.223-.877 1.377.139 2.798.62 3.68 1.02A.5.5 0 0 0 16 13.5v-11a.5.5 0 0 0-.293-.455c-.952-.433-2.48-.952-3.994-1.105C10.413.809 8.985.936 8 1.783"/> },
  { id: "aitools",    label: "AI Tools",          icon: <><path d="M6 12.5a.5.5 0 0 1 .5-.5h3a.5.5 0 0 1 0 1h-3a.5.5 0 0 1-.5-.5M3 8.062C3 6.76 4.235 5.765 5.53 5.886a26.6 26.6 0 0 0 4.94 0C11.765 5.765 13 6.76 13 8.062v1.157a.93.93 0 0 1-.765.935c-.845.147-2.34.346-4.235.346s-3.39-.2-4.235-.346A.93.93 0 0 1 3 9.219zm4.542-.827a.25.25 0 0 0-.217.068l-.92.9a25 25 0 0 1-1.871-.183.25.25 0 0 0-.068.495c.55.076 1.232.149 2.02.193a.25.25 0 0 0 .189-.071l.754-.736.847 1.71a.25.25 0 0 0 .404.062l.932-.97a25 25 0 0 0 1.922-.188.25.25 0 0 0-.068-.495c-.538.074-1.207.145-1.98.189a.25.25 0 0 0-.166.076l-.754.785-.842-1.7a.25.25 0 0 0-.182-.134"/><path d="M8.5 1.866a1 1 0 1 0-1 0V3h-2A4.5 4.5 0 0 0 1 7.5V8a1 1 0 0 0-1 1v2a1 1 0 0 0 1 1v1a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-1a1 1 0 0 0 1-1V9a1 1 0 0 0-1-1v-.5A4.5 4.5 0 0 0 10.5 3h-2zM14 7.5V13a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V7.5A3.5 3.5 0 0 1 5.5 4h5A3.5 3.5 0 0 1 14 7.5"/></> },
  { id: "reminders",  label: "Reminders",         icon: <path d="M8 16a2 2 0 0 0 2-2H6a2 2 0 0 0 2 2M8 1.918l-.797.161A4 4 0 0 0 4 6c0 .628-.134 2.197-.459 3.742-.16.767-.376 1.566-.663 2.258h10.244c-.287-.692-.502-1.49-.663-2.258C12.134 8.197 12 6.628 12 6a4 4 0 0 0-3.203-3.92zM14.22 12c.223.447.481.801.78 1H1c.299-.199.557-.553.78-1C2.68 10.2 3 6.88 3 6c0-2.42 1.72-4.44 4.005-4.901a1 1 0 1 1 1.99 0A5 5 0 0 1 13 6c0 .88.32 4.2 1.22 6"/> },
  { id: "models",     label: "AI Models",         icon: <path d="M6 12.5a.5.5 0 0 1 .5-.5h3a.5.5 0 0 1 0 1h-3a.5.5 0 0 1-.5-.5M3 8.062C3 6.76 4.235 5.765 5.53 5.886a26.6 26.6 0 0 0 4.94 0C11.765 5.765 13 6.76 13 8.062v1.157a.93.93 0 0 1-.765.935c-.845.147-2.34.346-4.235.346s-3.39-.2-4.235-.346A.93.93 0 0 1 3 9.219zm4.542-.827a.25.25 0 0 0-.217.068l-.92.9a25 25 0 0 1-1.871-.183.25.25 0 0 0-.068.495c.55.076 1.232.149 2.02.193a.25.25 0 0 0 .189-.071l.754-.736.847 1.71a.25.25 0 0 0 .404.062l.932-.97a25 25 0 0 0 1.922-.188.25.25 0 0 0-.068-.495c-.538.074-1.207.145-1.98.189a.25.25 0 0 0-.166.076l-.754.785-.842-1.7a.25.25 0 0 0-.182-.134"/> },
  { id: "noteai",     label: "Note Improvement",  icon: <><path d="M10.5 8a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0"/><path d="M0 8s3-5.5 8-5.5S16 8 16 8s-3 5.5-8 5.5S0 8 0 8m8 3.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7"/></> },
  { id: "commands",   label: "Slash Commands",    icon: <path d="M14 4.5V14a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V2a2 2 0 0 1 2-2h5.5zm-3 0A1.5 1.5 0 0 1 9.5 3V1L14 5.5zM8.646 6.646a.5.5 0 1 0-.707.708L9.293 8.5l-1.354 1.646a.5.5 0 0 0 .707.708L9.707 9.5H11a.5.5 0 0 0 0-1H9.707zM5.5 8.5a.5.5 0 0 1 .5-.5h1a.5.5 0 0 1 0 1H6a.5.5 0 0 1-.5-.5"/> },
  { id: "apikeys",    label: "Custom API Keys",   icon: <path d="M0 8a4 4 0 0 1 7.465-2H14a.5.5 0 0 1 .354.146l1.5 1.5a.5.5 0 0 1 0 .708l-1.5 1.5a.5.5 0 0 1-.708 0L13 9.207l-.646.647a.5.5 0 0 1-.708 0L11 9.207l-.646.647a.5.5 0 0 1-.708 0L9 9.207l-.646.647A.5.5 0 0 1 8 10h-.535A4 4 0 0 1 0 8m4-3a3 3 0 1 0 2.712 4.285A.5.5 0 0 1 7.163 9h.63l.853-.854a.5.5 0 0 1 .708 0l.646.647.646-.647a.5.5 0 0 1 .708 0l.646.647.646-.647a.5.5 0 0 1 .708 0l.646.647.793-.793-1-1h-6.63a.5.5 0 0 1-.451-.285A3 3 0 0 0 4 5m0 3.5a.5.5 0 1 1 0-1 .5.5 0 0 1 0 1"/> },
  { id: "email",      label: "Gmail Email",       icon: <path d="M.05 3.555A2 2 0 0 1 2 2h12a2 2 0 0 1 1.95 1.555L8 8.414zM0 4.697v7.104l5.803-3.558zM6.761 8.83l-6.57 4.027A2 2 0 0 0 2 14h12a2 2 0 0 0 1.808-1.144l-6.57-4.027L8 9.586zm3.436-.586L16 11.801V4.697z"/> },
  { id: "memograph",  label: "AI Memory Graph",   icon: <path d="M6 3.5A1.5 1.5 0 0 1 7.5 2h1A1.5 1.5 0 0 1 10 3.5v1A1.5 1.5 0 0 1 8.5 6v1H14a.5.5 0 0 1 .5.5v1a.5.5 0 0 1-1 0V8h-5v.5a.5.5 0 0 1-1 0V8h-5v.5a.5.5 0 0 1-1 0v-1A.5.5 0 0 1 2 7h5.5V6A1.5 1.5 0 0 1 6 4.5zm-6 8A1.5 1.5 0 0 1 1.5 10h1A1.5 1.5 0 0 1 4 11.5v1A1.5 1.5 0 0 1 2.5 14h-1A1.5 1.5 0 0 1 0 12.5zm6 0A1.5 1.5 0 0 1 7.5 10h1a1.5 1.5 0 0 1 1.5 1.5v1A1.5 1.5 0 0 1 8.5 14h-1A1.5 1.5 0 0 1 6 12.5zm6 0a1.5 1.5 0 0 1 1.5-1.5h1a1.5 1.5 0 0 1 1.5 1.5v1a1.5 1.5 0 0 1-1.5 1.5h-1a1.5 1.5 0 0 1-1.5-1.5z"/> },
  { id: "proactive",  label: "Proactive Insights", icon: <path d="M2 6a6 6 0 1 1 10.174 4.31c-.203.196-.359.4-.453.619l-.762 1.769A.5.5 0 0 1 10.5 13a.5.5 0 0 1 0 1 .5.5 0 0 1 0 1l-.224.447a1 1 0 0 1-.894.553H6.618a1 1 0 0 1-.894-.553L5.5 15a.5.5 0 0 1 0-1 .5.5 0 0 1 0-1 .5.5 0 0 1-.46-.302l-.761-1.77a2 2 0 0 0-.453-.618A5.98 5.98 0 0 1 2 6m6-5a5 5 0 0 0-3.479 8.592c.263.254.514.564.676.941L5.83 12h4.342l.632-1.467c.162-.377.413-.687.676-.941A5 5 0 0 0 8 1"/> },
  { id: "confidence", label: "Answer Confidence",  icon: <path d="M5.072.56C6.157.265 7.31 0 8 0s1.843.265 2.928.56c1.11.3 2.229.655 2.887.87a1.54 1.54 0 0 1 1.044 1.262c.596 4.477-.787 7.795-2.465 9.99a11.8 11.8 0 0 1-2.517 2.453 7 7 0 0 1-1.048.625c-.28.132-.581.24-.829.24s-.548-.108-.829-.24a7 7 0 0 1-1.048-.625 11.8 11.8 0 0 1-2.517-2.453C1.928 10.487.545 7.169 1.141 2.692A1.54 1.54 0 0 1 2.185 1.43 63 63 0 0 1 5.072.56"/> },
  { id: "autopilot",  label: "AutoPilot Routing",  icon: <path d="M11.251.068a.5.5 0 0 1 .227.58L9.677 6.5H13a.5.5 0 0 1 .364.843l-8 8.5a.5.5 0 0 1-.842-.49L6.323 9.5H3a.5.5 0 0 1-.364-.843l8-8.5a.5.5 0 0 1 .615-.09z"/> },
  { id: "timeline",   label: "Lecture Timeline",   icon: <><path d="M8 3.5a.5.5 0 0 0-1 0V9a.5.5 0 0 0 .252.434l3.5 2a.5.5 0 0 0 .496-.868L8 8.71z"/><path d="M8 16A8 8 0 1 0 8 0a8 8 0 0 0 0 16m7-8A7 7 0 1 1 1 8a7 7 0 0 1 14 0"/></> },
  { id: "study",      label: "AI Study Mode",      icon: <path d="M8.211 2.047a.5.5 0 0 0-.422 0l-7.5 3.5a.5.5 0 0 0 .025.917l7.5 3a.5.5 0 0 0 .372 0L14 7.14V13a1 1 0 0 0-1 1v2h3v-2a1 1 0 0 0-1-1V6.739l.686-.275a.5.5 0 0 0 .025-.917zM8 8.46 1.758 5.965 8 3.052l6.242 2.913z"/> },
  { id: "workflow",   label: "Smart Actions",      icon: <path d="M9.405 1.05c-.413-1.4-2.397-1.4-2.81 0l-.1.34a1.46 1.46 0 0 1-2.105.872l-.31-.17c-1.283-.698-2.686.705-1.987 1.987l.169.311c.446.82.023 1.841-.872 2.105l-.34.1c-1.4.413-1.4 2.397 0 2.81l.34.1a1.46 1.46 0 0 1 .872 2.105l-.17.31c-.698 1.283.705 2.686 1.987 1.987l.311-.169a1.46 1.46 0 0 1 2.105.872l.1.34c.413 1.4 2.397 1.4 2.81 0l.1-.34a1.46 1.46 0 0 1 2.105-.872l.31.17c1.283.698 2.686-.705 1.987-1.987l-.169-.311a1.46 1.46 0 0 1 .872-2.105l.34-.1c1.4-.413 1.4-2.397 0-2.81l-.34-.1a1.46 1.46 0 0 1-.872-2.105l.17-.31c.698-1.283-.705-2.686-1.987-1.987l-.311.169a1.46 1.46 0 0 1-2.105-.872zM8 10.93a2.929 2.929 0 1 1 0-5.86 2.929 2.929 0 0 1 0 5.858z"/> },
  { id: "tips",       label: "Tips & Shortcuts",  icon: <path d="M2 2a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v13.5a.5.5 0 0 1-.777.416L8 13.101l-5.223 2.815A.5.5 0 0 1 2 15.5zm2-1a1 1 0 0 0-1 1v12.566l4.723-2.482a.5.5 0 0 1 .554 0L13 14.566V2a1 1 0 0 0-1-1z"/> },
];

const CONTENT: Record<string, React.ReactNode> = {
  overview: (
    <div className="space-y-4">
      <p className="text-sm text-gray-400 leading-relaxed">
        <span className="text-white font-medium">MemoLink</span> is a smart AI companion for thinking, writing, planning, and staying organised. It combines notes, grounded chat, and practical tools in one workspace.
      </p>
      <div className="grid grid-cols-2 gap-3">
        {[
          { label: "Workspaces", desc: "Separate contexts for different subjects or projects" },
          { label: "AI Chat", desc: "Grounded answers routed through MemoLink's Smart Response Engine" },
          { label: "Smart Notes", desc: "Autosaved rich text mixed with handwriting, drawing, equations, and local recording" },
          { label: "Smart Sources", desc: "OneDrive originals, per-device cache, editable annotations, source metadata, and history" },
          { label: "File & Video", desc: "Import PDFs, DOCX, PPTX, YouTube, and recordings" },
          { label: "Books Library", desc: "Read PDF, EPUB, PPTX, audio, TXT, captions, comics, and MOBI books with highlights, bookmarks, and TTS" },
          { label: "AI Tools", desc: "Web search, smart actions, research, image generation, and long academic drafting" },
          { label: "Reminders", desc: "Auto-detected from notes or set manually" },
          { label: "Slash Commands", desc: "14 commands - /Improve, /Quiz, /Discuss and more" },
          { label: "Gmail Email", desc: "Connect Gmail, auto-sync important emails to notes and reminders, reply in-app" },
          { label: "AI Memory Graph", desc: "Visual force-directed graph of entities extracted from notes with cross-note links" },
          { label: "Proactive Insights", desc: "AI scans notes to surface missed deadlines, action items, and urgency signals" },
          { label: "Answer Confidence", desc: "HIGH / MEDIUM / LOW confidence badge on every AI response" },
          { label: "AutoPilot Routing", desc: "Automatically selects the best AI model based on your question's intent" },
          { label: "Lecture Timeline", desc: "Timestamped chapters, action items, and key moments for any transcript note" },
          { label: "AI Study Mode", desc: "Flashcards, quizzes, exam reviewers, study plans, weak-topic detection, and summaries" },
          { label: "Smart Actions", desc: "AI offers to save notes, set reminders, or search the web right below a chat reply" },
          { label: "Custom API Keys", desc: "Use your own OpenAI, Gemini, or any compatible key" },
        ].map((f) => (
          <div key={f.label} className="bg-[var(--ml-bg-surface)] border border-[var(--ml-bg-hover)] rounded-xl p-3">
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
      <p>MemoLink grounds answers in the notes and context available in your current workspace. Internally, the Smart Response Engine analyses the request, routes it to the right mode, and builds the context before the AI answers.</p>
      <ul className="space-y-2">
        {[
          "Start a new conversation from the sidebar. Conversations are scoped to the active workspace.",
          "Responses stream token-by-token so you can start reading before the reply is complete.",
          "Each AI reply shows a \"replied by [model]\" attribution badge (if enabled by admin).",
          "Save any AI reply as a note with the bookmark button - it becomes searchable in future chats.",
          "When MemoLink suggests a follow-up action like saving a note, creating a reminder, or searching online, your choice and the result are saved back into the conversation.",
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

  sources: (
    <div className="space-y-4 text-sm text-gray-400 leading-relaxed">
      <p>Smart Source Workspace connects an editable note to its preserved original without changing the original file. Source-linked notes use <span className="text-gray-200">Original, Editor, Source File, and Timeline</span> tabs.</p>
      <div>
        <p className="text-xs font-semibold text-indigo-300 mb-2 uppercase tracking-wider">Drawing and handwriting</p>
        <ul className="space-y-2">
          {[
            "Switch between text and pen mode from the note toolbar. The entire note surface remains available for ink, signatures, underlining, and mixed text/handwriting.",
            "Choose Ballpoint, Pencil, Marker, Highlighter, Brush, Calligraphy, or Dashed pen from the pen icon dropdown. Color, opacity, thickness, pressure, and stylus tilt are retained where available.",
            "The eraser icon offers Partial Eraser and Stroke Eraser. The size slider changes both the visible eraser footprint and the actual affected area.",
            "Auto mode lets a finger scroll while a stylus/Apple Pencil draws without moving the page. Turn on Touch Draw lock only when you intentionally want to draw with a finger; palm rejection prioritises the active stylus.",
            "Ink appears immediately and saves through a background queue. A failed save leaves the stroke visible and offers Retry; undo and redo remain available.",
          ].map((item, i) => <li key={i} className="flex gap-2"><span className="text-indigo-500 shrink-0 mt-0.5">•</span><span>{item}</span></li>)}
        </ul>
      </div>
      <div>
        <p className="text-xs font-semibold text-indigo-300 mb-2 uppercase tracking-wider">Sources, books, and privacy</p>
        <ul className="space-y-2">
          {[
            "Uploaded originals are stored in OneDrive and cached only on the current device for faster viewing. The database stores metadata, extracted text, and editable annotation JSON—not file binaries.",
            "Save as Note Source reuses an existing OneDrive book instead of uploading it again. Supported text extraction includes PDF, EPUB, MOBI, PPTX, TXT, SRT, and VTT.",
            "Extracted text, editor content, transcripts, highlight comments, and saved equation solutions can be used by search and RAG. Raw source and audio binaries are not embedded.",
            "Local recordings request microphone access only when recording starts. The recording remains local unless you explicitly request transcription.",
            "Solve Equation or Complete Equation can read typed content and a temporary ink snapshot, then append every explanation with its next rendered formula plus the formatted final answer to the autosaved note.",
          ].map((item, i) => <li key={i} className="flex gap-2"><span className="text-indigo-500 shrink-0 mt-0.5">•</span><span>{item}</span></li>)}
        </ul>
      </div>
      <p className="rounded-lg border border-indigo-500/20 bg-indigo-500/5 p-3 text-xs text-gray-500">Original source files remain unchanged unless you explicitly export an annotated copy. Annotation data synchronises through MemoLink; each device maintains its own local source cache.</p>
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
            "Upload a video or audio file (MP4, M4A, WebM, MOV, MP3, WAV - max 200 MB) - files ≤25 MB use Whisper, larger files use Deepgram Nova-2.",
            "Upload a Zoom recording or lecture capture; the transcript is saved as a searchable note.",
          ].map((item, i) => (
            <li key={i} className="flex gap-2"><span className="text-indigo-500 shrink-0 mt-0.5">•</span><span>{item}</span></li>
          ))}
        </ul>
      </div>
    </div>
  ),

  books: (
    <div className="space-y-4 text-sm text-gray-400 leading-relaxed">
      <p>The Books Library is a shared collection of books curated by an admin. Open it from the top bar to browse, borrow, and read books in-app.</p>
      <div>
        <p className="text-xs font-semibold text-indigo-300 mb-2 uppercase tracking-wider">Supported Formats</p>
        <p>PDF, EPUB, PPTX, audio, TXT, SRT/VTT (captions), CBZ/CBR (comics), and MOBI.</p>
      </div>
      <div>
        <p className="text-xs font-semibold text-indigo-300 mb-2 uppercase tracking-wider">Reading</p>
        <ul className="space-y-2">
          {[
            "Borrow a book to add it to \"My Books\" - your reading progress and current page are saved automatically.",
            "Switch between light, dark, and sepia color modes from the reader toolbar.",
            "Use Read Aloud for text-to-speech with play/pause and speed controls.",
            "Add a bookmark on any page to jump back to it later.",
          ].map((item, i) => (
            <li key={i} className="flex gap-2"><span className="text-indigo-500 shrink-0 mt-0.5">•</span><span>{item}</span></li>
          ))}
        </ul>
      </div>
      <div>
        <p className="text-xs font-semibold text-indigo-300 mb-2 uppercase tracking-wider">Highlights & Notes</p>
        <ul className="space-y-2">
          {[
            "Select text in PDF, EPUB, PPTX, TXT, captions, or MOBI books, then click Highlight - pick a color to tag it.",
            "Every highlight is appended to an auto-generated \"{Book Title} - Highlights\" note, and the Notes list updates instantly.",
            "Click a highlight inside that note to jump the reader straight back to the exact passage - the highlighted text itself can't be edited.",
            "\"Save as Note Source\" extracts a book's full text (PDF, EPUB, PPTX, TXT, SRT/VTT) into searchable notes so it becomes part of AI Chat's grounded answers.",
            "Deleting the highlights note permanently (from the Recycle Bin) also permanently deletes all highlights saved for that book.",
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
          title: "Smart Actions",
          desc: "MemoLink now routes note actions, reminder creation, and live-search tasks through an internal action agent automatically. When tool use is needed, you will see tool-call chips as it works before the final answer arrives.",
        },
        {
          title: "Research Mode",
          desc: "The Research toggle runs a dedicated multi-source pipeline - your notes, live web results, and academic papers - and returns a cited, structured answer. Requires Plus or higher access level (configurable by admin).",
        },
        {
          title: "Image Generation",
          desc: "Type a request like \"generate an image of…\" and MemoLink tries gpt-image-2 → DALL-E 3 → DALL-E 2 → Pollinations.ai in sequence until one succeeds. The image is embedded inline in the chat.",
        },
        {
          title: "Translation",
          desc: "Click the translate button on any AI message. Uses a Gemini quality-loop: initial translation → back-translate → similarity score (0–100) → up to 3 refinements if the score is below 85.",
        },
        {
          title: "Academic Writing",
          desc: "Large assessment or report requests are routed into a long-form academic draft path. MemoLink plans sections, streams progress, retrieves academic papers, and can save cited papers back into notes for future retrieval.",
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
          "Connect Gmail in Settings → Email to sync important emails. A \"Sync from Email\" button appears in the Reminders panel - email-sourced reminders are global and appear across all workspaces.",
          "Click an email-sourced reminder to see the original email and reply to it directly from MemoLink without leaving the app.",
        ].map((item, i) => (
          <li key={i} className="flex gap-2"><span className="text-indigo-500 shrink-0 mt-0.5">•</span><span>{item}</span></li>
        ))}
      </ul>
    </div>
  ),

  models: (
    <div className="space-y-4 text-sm text-gray-400 leading-relaxed">
      <p>Open <span className="text-white">Settings → AI Model</span> to choose your chat model. Every reply shows a "replied by" badge and the model is saved in conversation history. Add custom providers in <span className="text-white">Settings → API Keys</span> - they appear here too.</p>
      <div className="space-y-3">
        {[
          {
            provider: "OpenAI",
            models: ["GPT-4o (most capable)", "GPT-4o Mini (default, fast)", "GPT-4 Turbo", "GPT-3.5 Turbo"],
          },
          {
            provider: "Google Gemini",
            models: ["Gemini 2.5 Flash", "Gemini 2.5 Flash Lite", "Gemini 2.5 Pro"],
            note: "Rate limits may apply. Falls back to GPT-4o Mini on quota exceeded.",
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

  noteai: (
    <div className="space-y-4 text-sm text-gray-400 leading-relaxed">
      <p>
        Ask the AI to <span className="text-white font-medium">automatically improve and save</span> any note just by mentioning its name in chat. The AI reformats the content with proper headings, paragraphs, lists, and bold terms - then saves it directly. No copy-paste needed.
      </p>

      {/* How it works */}
      <div className="bg-[var(--ml-bg-surface)] border border-[var(--ml-bg-hover)] rounded-xl p-3 space-y-1.5">
        <p className="text-xs font-semibold text-indigo-300 uppercase tracking-wider">How it works</p>
        <ol className="space-y-1">
          {[
            "If the note is open in an editor tab, it closes automatically first",
            "A spinning indicator shows while the AI is working",
            "The improved content is saved directly to the database",
            "An \"Open Note\" button appears - click it to see the result",
          ].map((s, i) => (
            <li key={i} className="flex gap-2 text-[12px]"><span className="text-indigo-500 shrink-0 font-bold">{i + 1}.</span><span>{s}</span></li>
          ))}
        </ol>
      </div>

      {/* All trigger phrases */}
      <div>
        <p className="text-xs font-semibold text-indigo-300 uppercase tracking-wider mb-2">All supported phrases</p>
        <p className="text-[11px] text-gray-500 mb-2">Replace <code className="bg-[var(--ml-bg-surface)] px-1 rounded text-indigo-300">Note Name</code> with any part of your note's title - exact match, partial, or filename with extension.</p>
        <div className="space-y-1">
          {[
            ["improve",  "improve my note Note Name"],
            ["improve",  "improve note: Note Name"],
            ["reformat", "reformat my note Note Name"],
            ["format",   "format note Note Name"],
            ["clean up", "clean up my note Note Name"],
            ["fix",      "fix my note Note Name"],
            ["polish",   "polish note Note Name"],
            ["rewrite",  "rewrite my note Note Name"],
            ["update",   "update my note Note Name"],
            ["edit",     "edit note Note Name"],
            ["upgrade",  "upgrade my note Note Name"],
            ["revise",   "revise my note Note Name"],
            ["optimize", "optimize my note Note Name"],
            ["make better", "make my Note Name note better"],
            ["make better", "make my note Note Name better"],
            ["make nicer",  "make my Note Name note nicer"],
            ["make cleaner","make my Note Name note cleaner"],
            ["make clearer","make Note Name note clearer"],
          ].map(([badge, phrase], i) => (
            <div key={i} className="flex items-center gap-2">
              <span className="shrink-0 text-[9px] font-bold px-1.5 py-0.5 rounded bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 uppercase tracking-wide w-[72px] text-center">
                {badge}
              </span>
              <code className="text-[11px] text-gray-300 bg-[var(--ml-bg-surface)] px-2 py-0.5 rounded border border-[var(--ml-bg-hover)] flex-1">
                {phrase}
              </code>
            </div>
          ))}
        </div>
      </div>

      {/* Real examples */}
      <div>
        <p className="text-xs font-semibold text-indigo-300 uppercase tracking-wider mb-2">Real examples</p>
        <div className="space-y-1.5">
          {[
            "improve my note Overview",
            "reformat note Recording (7).m4a",
            "can you improve my note 01_20250816082443.wav",
            "make my Recording (7).m4a note better",
            "make my note Project Plan nicer",
            "clean up my note Meeting Notes",
            "polish note Lecture 3 - Database Design",
            "fix my note Budget 2026.pdf",
          ].map((ex, i) => (
            <div key={i} className="flex items-start gap-2">
              <span className="text-indigo-500 shrink-0 mt-0.5">›</span>
              <code className="text-[11px] text-emerald-300/80 break-all">"{ex}"</code>
            </div>
          ))}
        </div>
      </div>

      {/* Tips */}
      <div className="bg-amber-500/5 border border-amber-500/20 rounded-xl p-3">
        <p className="text-xs font-semibold text-amber-400 mb-1.5">Tips</p>
        <ul className="space-y-1">
          {[
            "You don't need the full note title - a partial match works (e.g. \"Recording\" matches \"Recording (7).m4a\").",
            "Works with any file type - audio transcriptions, PDFs, DOCX imports, or hand-written notes.",
            "The original content is replaced immediately. If you want to keep the old version, duplicate the note first.",
          ].map((t, i) => (
            <li key={i} className="flex gap-2 text-[11px] text-gray-400"><span className="text-amber-500 shrink-0 mt-0.5">•</span><span>{t}</span></li>
          ))}
        </ul>
      </div>
    </div>
  ),

  commands: (
    <div className="space-y-4 text-sm text-gray-400 leading-relaxed">
      <p>Type <code className="bg-[var(--ml-bg-surface)] px-1.5 py-0.5 rounded text-indigo-300 text-xs">/</code> in the chat input to access slash commands. Commands let you improve, summarize, quiz, and manage notes without leaving the chat.</p>

      <div className="bg-[var(--ml-bg-surface)] border border-[var(--ml-bg-hover)] rounded-xl p-3 space-y-1.5">
        <p className="text-xs font-semibold text-indigo-300 uppercase tracking-wider">Keyboard Navigation</p>
        <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[11px]">
          {[
            ["Type /", "open command picker"],
            ["↑ ↓ arrows", "navigate the list"],
            ["Tab or Enter", "select highlighted item"],
            ["Type /imp", "filter to matching commands"],
            ["Tab after command", "open note picker"],
            ["Esc", "cancel and clear"],
          ].map(([k, v]) => (
            <div key={k} className="flex items-center gap-1.5">
              <code className="bg-[var(--ml-bg-panel)] border border-[var(--ml-bg-hover)] rounded px-1.5 py-0.5 text-indigo-300 shrink-0">{k}</code>
              <span className="text-gray-600">{v}</span>
            </div>
          ))}
        </div>
      </div>

      {[
        {
          group: "Note Editing",
          color: "indigo",
          cmds: [
            { cmd: "/Improve", args: "All | \"Note Name\"", desc: "Improve grammar, clarity, structure, and Markdown. Does not add new information." },
            { cmd: "/Enhance", args: "All | \"Note Name\"", desc: "Expand and enrich - adds helpful context and examples while preserving all original content." },
            { cmd: "/Natural", args: "\"Note Name\"", desc: "Rewrite the note in a natural, readable style. Also available as /Humanize." },
            { cmd: "/Update", args: "\"Note Name\" : instruction", desc: "Merge an instruction into the note - AI decides the best section to update." },
            { cmd: "/Add", args: "\"Note Name\" : content", desc: "Append or insert new content into the most appropriate section." },
            { cmd: "/Undo", args: "\"Note Name\"", desc: "Restore the immediately previous version of a note. One level only." },
          ],
        },
        {
          group: "Content Creation",
          color: "emerald",
          cmds: [
            { cmd: "/Summarize", args: "All | \"Note Name\"", desc: "Creates a new summary note. Does not modify the original." },
          ],
        },
        {
          group: "Interactive Tools",
          color: "violet",
          cmds: [
            { cmd: "/Quiz", args: "All | \"Note Name\" : count", desc: "Generate an interactive quiz from the note. Supports radio and checkbox questions. Save results to Notes after submission." },
            { cmd: "/Discussion", args: "\"Note Name\" your question", desc: "Iterative multi-model debate driven by your question - e.g. /Discussion \"Chat Snippet\" how do we improve this? GPT, Gemini, DeepSeek, plus any custom providers each contribute in turn, seeing the running discussion and building on or challenging each other. They loop round-by-round (up to 4) until they all agree, then a final \"Best Approach\" conclusion answers your question. You can also use /Discussion All : your question, or simply /Discussion your question to discuss across your notes." },
            { cmd: "/Read", args: "\"Note Name\"", desc: "Display a note's content inline in the chat, open it in the editor, and read it aloud. Reading starts from the body (the title is never read) - place your cursor anywhere first to begin from that point. A TTS player bar appears with play/pause, stop, ◀◀ / ▶▶ sentence navigation, and speed controls (0.75× – 2×), and the sentence being spoken is highlighted in the editor." },
          ],
        },
        {
          group: "Productivity",
          color: "amber",
          cmds: [
            { cmd: "/Reminder", args: "title : YYYY-MM-DD HH:MM", desc: "Create a reminder in the active workspace. A format hint popup shows example dates - the note picker does not appear for this command." },
            { cmd: "/Feedback", args: "title : message", desc: "Submit a suggestion. A format hint popup shows examples instead of the note picker." },
            { cmd: "/ReportBug", args: "title : description", desc: "Report a bug. A format hint popup shows examples instead of the note picker." },
          ],
        },
      ].map(({ group, color, cmds }) => (
        <div key={group}>
          <p className={`text-xs font-semibold uppercase tracking-wider mb-2 ${
            color === "indigo" ? "text-indigo-400" : color === "emerald" ? "text-emerald-400" : color === "violet" ? "text-violet-400" : "text-amber-400"
          }`}>{group}</p>
          <div className="space-y-1.5">
            {cmds.map(({ cmd, args, desc }) => (
              <div key={cmd} className="bg-[var(--ml-bg-surface)] border border-[var(--ml-bg-hover)] rounded-xl px-3 py-2">
                <div className="flex items-baseline gap-2 mb-0.5 flex-wrap">
                  <code className="text-indigo-300 font-mono text-xs font-semibold">{cmd}</code>
                  <code className="text-gray-600 font-mono text-[10px]">{args}</code>
                </div>
                <p className="text-[11px] text-gray-500">{desc}</p>
              </div>
            ))}
          </div>
        </div>
      ))}

      <div className="bg-[var(--ml-bg-surface)] border border-[var(--ml-bg-hover)] rounded-xl p-3 space-y-2">
        <p className="text-xs font-semibold text-indigo-300 uppercase tracking-wider">Note picker vs Format hint</p>
        <p className="text-[11px] text-gray-400">Commands that need a note name (/Improve, /Enhance, /Quiz, /Read, etc.) open a note picker after Tab - showing all workspace notes with arrow-key navigation. Commands that take free text (/Feedback, /ReportBug, /Reminder) show a format hint popup with the expected syntax and examples instead.</p>
      </div>

      <div className="bg-[var(--ml-bg-surface)] border border-[var(--ml-bg-hover)] rounded-xl p-3 space-y-2">
        <p className="text-xs font-semibold text-indigo-300 uppercase tracking-wider">Model fallback order</p>
        <p className="text-[11px] text-gray-400">All commands use the model you selected in Settings → AI Model. If that model fails, the fallback order is: <strong className="text-gray-300">1.</strong> your other configured custom providers → <strong className="text-gray-300">2.</strong> server-configured providers (Gemini, DeepSeek) → <strong className="text-gray-300">3.</strong> server default (GPT-4o Mini).</p>
      </div>

      <div className="bg-amber-500/5 border border-amber-500/20 rounded-xl p-3">
        <p className="text-xs font-semibold text-amber-400 mb-1.5">Undo - how it works</p>
        <p className="text-[11px] text-gray-400">Before any command modifies a note (/Improve, /Enhance, /Natural, /Humanize, /Update, /Add), the current version is saved as an undo snapshot. Use <code className="bg-[var(--ml-bg-surface)] px-1 rounded text-indigo-300">/Undo "Note Name"</code> to restore it. Only one level is supported - a second modification overwrites the snapshot.</p>
      </div>
    </div>
  ),

  apikeys: (
    <div className="space-y-4 text-sm text-gray-400 leading-relaxed">
      <p>Add your own API keys in <span className="text-white">Settings → API Keys</span>. When set, your key takes priority over the shared server key for all requests. Your custom providers also appear as extra participants in <code className="bg-[var(--ml-bg-surface)] px-1 rounded text-indigo-300">/Discussion</code> - each sharing their own perspective alongside GPT, Gemini, and DeepSeek.</p>

      <div className="space-y-3">
        {[
          { provider: "OpenAI", placeholder: "sk-proj-...", hint: "platform.openai.com → API keys" },
          { provider: "Google Gemini", placeholder: "AIza...", hint: "aistudio.google.com → Get API key" },
          { provider: "DeepSeek", placeholder: "sk-...", hint: "platform.deepseek.com → API keys" },
        ].map(({ provider, placeholder, hint }) => (
          <div key={provider} className="bg-[var(--ml-bg-surface)] border border-[var(--ml-bg-hover)] rounded-xl p-3">
            <p className="text-xs font-semibold text-indigo-300 mb-1">{provider}</p>
            <p className="text-[11px] text-gray-500 font-mono mb-1">{placeholder}</p>
            <p className="text-[11px] text-gray-600">{hint}</p>
          </div>
        ))}
      </div>

      <p className="text-xs font-semibold text-indigo-300 uppercase tracking-wider mt-2">Adding a Custom Provider</p>
      <p>You can add <span className="text-white">any OpenAI-compatible API</span> - Groq, Mistral, Together AI, Ollama, Perplexity, and more.</p>
      <div className="bg-[var(--ml-bg-surface)] border border-[var(--ml-bg-hover)] rounded-xl p-3 space-y-2">
        {[
          ["Provider Name", "A label you choose - e.g. \"Groq\" or \"My Ollama\""],
          ["Model ID", "The model to send requests to - e.g. llama3-8b-8192"],
          ["Base URL", "The OpenAI-compatible endpoint - e.g. https://api.groq.com/openai/v1"],
          ["API Key", "Your key for that provider"],
        ].map(([field, desc]) => (
          <div key={field} className="flex gap-2 text-[11px]">
            <span className="text-indigo-300 font-medium shrink-0 w-28">{field}</span>
            <span className="text-gray-500">{desc}</span>
          </div>
        ))}
      </div>

      <div className="space-y-1.5 text-[11px] text-gray-500">
        <p>Once added, your custom provider appears in <span className="text-gray-300">Settings → AI Model</span> under <em>Your Custom Providers</em> and can be selected like any built-in model.</p>
        <p>Keys are encrypted at rest (Fernet symmetric encryption). The raw key is never returned by the API - only whether a key is set.</p>
        <p>Remove a provider at any time; requests fall back to the server's shared key immediately.</p>
      </div>
    </div>
  ),

  email: (
    <div className="space-y-4 text-sm text-gray-400 leading-relaxed">
      <p>Connect your Gmail account to automatically sync important emails, turn them into notes and reminders, and reply directly from MemoLink - without switching apps.</p>

      <div className="space-y-3">
        {[
          {
            title: "Connect Gmail",
            desc: "Go to Settings → Email → Connect Gmail. MemoLink uses Google OAuth 2.0 - it never stores your password. You can disconnect at any time from the same settings tab.",
          },
          {
            title: "Auto-Sync on Email Tab Open",
            desc: "Every time you open Settings → Email, MemoLink fetches new unread and important emails, scores their importance with AI (1–5), and saves those scoring ≥ 3. Only new emails are fetched - already-synced ones are skipped.",
          },
          {
            title: "Sync from Email button",
            desc: "A blue \"Sync from Email\" button appears in the Reminders panel (right sidebar) when Gmail is connected. Clicking it runs auto-process: syncs new emails, appends them to your Email Digest note, and creates reminders for any emails that mention a deadline.",
          },
          {
            title: "Email Digest Note",
            desc: "Important emails are appended to a global note called \"Email Digest\". This note is created automatically on first sync and updated on each subsequent sync - only new emails are added, never duplicated. It appears in every workspace.",
          },
          {
            title: "Importance Badges",
            desc: "🔴 Urgent (score ≥ 4.5)  ·  🟠 Important (score ≥ 3.5)  ·  🔵 Notable (score = 3). Emails scoring below 3 are filtered out entirely - newsletters and promotions are excluded from the sync query.",
          },
          {
            title: "Email-sourced Reminders",
            desc: "When AI detects a deadline in an email, a reminder is automatically created and linked back to that email. These reminders are global - they appear in all workspaces, not just the active one. Click any email-sourced reminder to see the original email.",
          },
          {
            title: "In-App Email Reply",
            desc: "Open a reminder that originated from an email, or open the email detail in Settings → Email - a collapsible reply panel appears. Choose a tone (Formal / Friendly / Brief), optionally click \"Suggest Reply\" to get 3 AI-drafted options, edit if needed, then click \"Send Reply\". The reply threads correctly in Gmail.",
          },
          {
            title: "Save as Note / Add Reminder manually",
            desc: "From the email detail view in Settings → Email, you can save any email as a standalone note or manually create a reminder from it with the action buttons.",
          },
        ].map((t) => (
          <div key={t.title}>
            <p className="text-xs font-semibold text-indigo-300 mb-1">{t.title}</p>
            <p>{t.desc}</p>
          </div>
        ))}
      </div>

      <div className="bg-amber-500/5 border border-amber-500/20 rounded-xl p-3">
        <p className="text-xs font-semibold text-amber-400 mb-1.5">Privacy note</p>
        <p className="text-[11px] text-gray-400">OAuth tokens are encrypted at rest using Fernet symmetric encryption. Email bodies are fetched on demand - only subject, sender, and snippet are stored in the database after scoring. Your Gmail password is never seen or stored by MemoLink.</p>
      </div>
    </div>
  ),

  memograph: (
    <div className="space-y-4 text-sm text-gray-400 leading-relaxed">
      <p>The <span className="text-white font-medium">AI Memory Graph</span> visualises how your knowledge is connected - entities extracted from notes are drawn as colour-coded nodes, and shared entities between notes are linked with edges.</p>
      <div className="space-y-3">
        {[
          { title: "Opening MemoGraph", desc: "Click the graph icon (⬡) in the top toolbar. MemoLink builds or re-uses the graph for your current workspace. Click \"Rebuild\" to re-scan all notes." },
          { title: "Node types", desc: "note (indigo) · reminder (amber) · person (green) · topic (cyan) · project (orange) · deadline (red) · decision (yellow) · action item (pink) · question (purple) · theme (teal). Each type can be toggled with the filter chips at the top." },
          { title: "Pan & Zoom", desc: "Drag on empty canvas to pan. Scroll to zoom in/out. Click \"Fit\" to auto-scale so all nodes are visible. Drag a node to pin it - it will stay fixed until you drag it again." },
          { title: "Graph-Enhanced Answers", desc: "The graph isn't just visual - it helps MemoLink find related notes you might not have mentioned, so answers can use broader and more connected context." },
          { title: "How entities are extracted", desc: "GPT processes your notes in batches of 5. It identifies people, topics, projects, deadlines, decisions, action items, questions, and themes. Notes that share an entity are automatically linked with a \"related_to\" edge." },
        ].map((t) => (
          <div key={t.title}>
            <p className="text-xs font-semibold text-indigo-300 mb-1">{t.title}</p>
            <p>{t.desc}</p>
          </div>
        ))}
      </div>
    </div>
  ),

  proactive: (
    <div className="space-y-4 text-sm text-gray-400 leading-relaxed">
      <p><span className="text-white font-medium">Proactive Insights</span> scans your notes and surfaces things you might have missed - deadlines without reminders, incomplete action items, and urgent signals buried in your notes.</p>
      <div className="space-y-3">
        {[
          { title: "How to use it", desc: "Open the Reminders panel (bell icon) and expand the \"AI Insights\" section. Click \"Scan Notes\" to trigger a fresh analysis of all your notes in the current workspace." },
          { title: "Insight types", desc: "🔴 Urgency Signal - something needs immediate attention. 🟠 Missing Reminder - a deadline mentioned in a note has no reminder. 🔵 Incomplete Actions - action items detected in a note with no follow-up." },
          { title: "Unreviewed uploads", desc: "Files uploaded to the workspace in the last 14 days that haven't been reviewed are automatically flagged - no AI call needed for this check." },
          { title: "Dismissing insights", desc: "Click the × on any insight card to dismiss it. Dismissed insights are not re-shown on the next scan." },
          { title: "Open Note link", desc: "Each insight card has an \"Open Note\" link that takes you directly to the source note so you can act on it immediately." },
        ].map((t) => (
          <div key={t.title}>
            <p className="text-xs font-semibold text-indigo-300 mb-1">{t.title}</p>
            <p>{t.desc}</p>
          </div>
        ))}
      </div>
    </div>
  ),

  confidence: (
    <div className="space-y-4 text-sm text-gray-400 leading-relaxed">
      <p>Every AI response carries a <span className="text-white font-medium">confidence badge</span> inline with the model attribution - so you always know how well-grounded the answer is in your notes.</p>
      <div className="space-y-2">
        {[
          { level: "HIGH", color: "text-emerald-400", desc: "The AI found strong, relevant evidence in your notes and is confident in the answer." },
          { level: "MEDIUM", color: "text-amber-400", desc: "Some relevant notes were found but the evidence is partial or indirect." },
          { level: "LOW", color: "text-orange-400", desc: "Very little relevant context was found - treat the answer with caution." },
          { level: "UNSUPPORTED", color: "text-red-400", desc: "No notes in this workspace cover the topic. The AI answered from general knowledge only." },
        ].map(({ level, color, desc }) => (
          <div key={level} className="bg-[var(--ml-bg-surface)] border border-[var(--ml-bg-hover)] rounded-xl px-3 py-2.5">
            <p className={`text-xs font-bold mb-0.5 ${color}`}>{level}</p>
            <p className="text-[11px] text-gray-500">{desc}</p>
          </div>
        ))}
      </div>
      <p className="text-[11px] text-gray-600">Hover over the badge to see the AI's reasoning. The badge is always shown - even if the model doesn't self-assess, a server-side fallback computes a level based on how many relevant notes were retrieved.</p>
    </div>
  ),

  autopilot: (
    <div className="space-y-4 text-sm text-gray-400 leading-relaxed">
      <p><span className="text-white font-medium">AutoPilot</span> automatically picks the best AI model for each message based on what you're asking - no manual switching needed.</p>
      <div className="space-y-2">
        {[
          { intent: "Translation", model: "Gemini 2.5 Flash", signal: "Any translation-related phrase (\"translate to French\", \"in Spanish\", etc.)", color: "text-blue-400" },
          { intent: "Code / Debug", model: "DeepSeek Coder", signal: "Any programming language name (Python, Rust, SQL, React, Go…) or ≥2 code keywords", color: "text-emerald-400" },
          { intent: "Deep Research", model: "GPT-4o", signal: "Research, analysis, compare, evaluate, elaborate, implications…", color: "text-violet-400" },
          { intent: "Long Context", model: "Gemini 2.5 Flash", signal: "Prompt longer than 250 words", color: "text-cyan-400" },
          { intent: "Simple Query", model: "GPT-4o Mini (default)", signal: "Short question ≤12 words with no complex intent", color: "text-gray-400" },
        ].map(({ intent, model, signal, color }) => (
          <div key={intent} className="bg-[var(--ml-bg-surface)] border border-[var(--ml-bg-hover)] rounded-xl px-3 py-2.5">
            <div className="flex items-baseline gap-2 mb-0.5">
              <span className={`text-xs font-semibold ${color}`}>{intent}</span>
              <span className="text-[10px] text-gray-600">→ {model}</span>
            </div>
            <p className="text-[11px] text-gray-500">{signal}</p>
          </div>
        ))}
      </div>
      <p className="text-[11px] text-gray-600">When AutoPilot routes a message, a violet <strong className="text-violet-400">⚡ AutoPilot · {"{reason}"}</strong> chip appears next to the model name. Simple Query never shows a chip. AutoPilot skips a rule if the target model's API key isn't configured.</p>
    </div>
  ),

  timeline: (
    <div className="space-y-4 text-sm text-gray-400 leading-relaxed">
      <p>Open any note that was created from an audio or video recording and click the <span className="text-white font-medium">⏱ Timeline</span> tab (next to Editor | Source). One AI call analyses the full transcript and returns a structured timeline.</p>

      <div className="space-y-3">
        {[
          {
            title: "Generate / Regenerate",
            desc: "Click Generate Timeline to run the analysis (one GPT call). Results are cached - switching to the Timeline tab later is instant. Click Regenerate any time to refresh after editing the note.",
          },
          {
            title: "Chapters",
            desc: "Major topic sections with timestamps - e.g. 00:03:12 Assessment requirement explained. Timestamps are estimated from word position at 130 wpm (average lecture speaking rate), accurate to ±30–90 seconds.",
          },
          {
            title: "Action Items",
            desc: "Detected tasks, assignments, and follow-ups with the person responsible (if mentioned). Each item carries a timestamp showing roughly when it was said.",
          },
          {
            title: "Important Moments",
            desc: "Key statements tagged by type: ⚖️ Decision · ⚠️ Warning · 💡 Key Point · ⏰ Deadline · ❓ Question. Shown as near-exact quotes from the transcript.",
          },
          {
            title: "Jump → to section",
            desc: "Every chapter, action item, and moment has a Jump → button. Clicking it switches to the Editor tab, finds the exact phrase in the transcript, highlights it, and scrolls to it - no manual searching through thousands of words.",
          },
        ].map((t) => (
          <div key={t.title}>
            <p className="text-xs font-semibold text-indigo-300 mb-1">{t.title}</p>
            <p>{t.desc}</p>
          </div>
        ))}
      </div>

      <div className="bg-amber-500/5 border border-amber-500/20 rounded-xl p-3">
        <p className="text-xs font-semibold text-amber-400 mb-1.5">Works best with</p>
        <ul className="space-y-1">
          {[
            "Lecture recordings imported via the Video Import modal (YouTube URL or uploaded file)",
            "Voice memos recorded directly in MemoLink with the microphone button",
            "Meeting recordings uploaded as MP4, M4A, WebM, MOV, MP3, or WAV",
          ].map((t, i) => (
            <li key={i} className="flex gap-2 text-[11px] text-gray-400"><span className="text-amber-500 shrink-0 mt-0.5">•</span><span>{t}</span></li>
          ))}
        </ul>
      </div>
    </div>
  ),

  study: (
    <div className="space-y-4 text-sm text-gray-400 leading-relaxed">
      <p>Open <span className="text-white font-medium">AI Study Mode</span> from the user menu (top-right). It turns the notes in your active workspace into active-recall study tools - all generated on demand from your own content.</p>

      <div className="space-y-3">
        {[
          { icon: "🃏", title: "Flashcards", desc: "Generate question/answer cards from a single note or the whole workspace. Flip each card to reveal the answer and step through them for spaced review." },
          { icon: "❓", title: "Quiz", desc: "Build an interactive quiz (single- and multiple-choice) from any note or all notes - the same engine as the /Quiz slash command. Submit to see your score, the correct answers, and explanations, then save the result as a note." },
          { icon: "📋", title: "Exam Review", desc: "Pick one or more notes to get a reviewer: key concepts, definitions, important facts, likely exam questions, and the topics to focus on most." },
          { icon: "📅", title: "Study Plan", desc: "Describe your goal and time frame (e.g. \"before my final presentation\" or \"before my operating systems exam\") and get a day-by-day plan - each day lists focus topics, tasks, and which notes to revise." },
          { icon: "🔍", title: "Weak Topics", desc: "AI scans the questions you keep asking across your chats and notes, identifies recurring weak spots, and explains each one simply with a study tip." },
          { icon: "📝", title: "Summary", desc: "Summarise any note at three levels - short, medium, or detailed - with optional bullet points. Great for a quick refresher or a condensed revision sheet." },
        ].map((t) => (
          <div key={t.title} className="bg-[var(--ml-bg-surface)] border border-[var(--ml-bg-hover)] rounded-xl px-3 py-2.5">
            <p className="text-xs font-semibold text-indigo-300 mb-0.5">{t.icon} {t.title}</p>
            <p className="text-[11px] text-gray-500">{t.desc}</p>
          </div>
        ))}
      </div>

      <p className="text-[11px] text-gray-600">Everything is scoped to the active workspace, so a quiz or plan only ever draws from that workspace's notes. Study Mode can be turned off by an admin via the <code className="bg-[var(--ml-bg-surface)] px-1 rounded text-indigo-300">study_mode</code> feature flag.</p>
    </div>
  ),

  workflow: (
    <div className="space-y-4 text-sm text-gray-400 leading-relaxed">
      <p><span className="text-white font-medium">Smart Actions</span> let the AI offer to <em>do</em> things for you - not just answer. After a normal chat reply, MemoLink quietly analyses the exchange and, when something useful is possible, shows action buttons right below the message. Nothing happens until you approve.</p>

      <div className="bg-[var(--ml-bg-surface)] border border-[var(--ml-bg-hover)] rounded-xl p-3 space-y-1.5">
        <p className="text-xs font-semibold text-indigo-300 uppercase tracking-wider">How it works</p>
        <ol className="space-y-1">
          {[
            "Chat normally - no toggle or mode to turn on.",
            "When an action fits, a short question appears under the reply (e.g. \"Do you want me to search the web for this?\").",
            "Click Yes to run it, or No to dismiss. Your click is recorded as your message, and the result comes back as an assistant reply.",
            "Both are saved to the conversation, so the whole exchange is still there after a reload.",
          ].map((s, i) => (
            <li key={i} className="flex gap-2 text-[12px]"><span className="text-indigo-500 shrink-0 font-bold">{i + 1}.</span><span>{s}</span></li>
          ))}
        </ol>
      </div>

      <div>
        <p className="text-xs font-semibold text-indigo-300 uppercase tracking-wider mb-2">Available actions</p>
        <div className="space-y-1.5">
          {[
            ["⏰", "Create reminder", "Turn a mentioned deadline or task into a reminder in the current workspace."],
            ["📝", "Create note", "Save the AI's response as a new note you can search later."],
            ["📋", "Summarise workspace", "Produce a summary across the notes in the active workspace."],
            ["🌐", "Search web", "Run a live web search when the answer needs information beyond your notes."],
            ["🗂️", "Organise notes", "Suggest a structure / grouping for your existing notes."],
            ["✏️", "Suggest title", "Propose a clearer title for the note being discussed."],
            ["✅", "Extract tasks", "Pull actionable tasks out of the response or a note."],
            ["📄", "Prepare report outline", "Draft a structured outline from your notes to start a report."],
          ].map(([icon, name, desc]) => (
            <div key={name} className="flex items-start gap-2 bg-[var(--ml-bg-surface)] border border-[var(--ml-bg-hover)] rounded-xl px-3 py-2">
              <span className="shrink-0 text-sm leading-none mt-0.5">{icon}</span>
              <div>
                <p className="text-[12px] font-medium text-gray-300">{name}</p>
                <p className="text-[11px] text-gray-500">{desc}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      <p className="text-[11px] text-gray-600">Turn suggestions on or off any time in <span className="text-gray-300">Settings → Workflow</span>. Admins can disable the whole feature via the <code className="bg-[var(--ml-bg-surface)] px-1 rounded text-indigo-300">workflow</code> feature flag. After an action runs, the affected panel (Notes or Reminders) refreshes automatically.</p>
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
          "If MemoLink offers a \"Search online?\" button, it now uses the actual topic from your recent conversation instead of searching a vague phrase like \"latest news\" on its own.",
          "The default model set by the admin applies when model selection is disabled - check Settings to see what's available to you.",
          "Reminders → Suggest scans only the active workspace - switch workspaces to suggest from different note sets.",
          "Paste a YouTube video URL in the Upload Notes panel to instantly transcribe and import it.",
          "Ask the AI to improve any note by name - e.g. \"improve my note Recording (7).m4a\". See the Note Improvement section for all supported phrases.",
          "Type / in chat to access 14 slash commands - use ↑↓ arrows to navigate, Tab to complete. After a command, Tab opens a note picker with all your notes.",
          "Add your own API key in Settings → API Keys to use your personal quota. You can also add any OpenAI-compatible provider (Groq, Mistral, Ollama) with a custom base URL.",
          "Use /Read to hear a note read aloud. Playback starts from where your cursor is and skips the title - click into the paragraph you want to start from, then play. The sentence being spoken is highlighted live in the editor.",
          "Open AI Study Mode from the top-right user menu for flashcards, quizzes, exam reviewers, study plans, weak-topic detection, and multi-level summaries - all built from your workspace notes.",
          "Let Smart Actions help after a chat reply: when MemoLink can do something useful (save a note, set a reminder, search the web), it asks below the message - click Yes and it runs, with both your click and the result saved to the conversation.",
          "Custom providers added in Settings → API Keys automatically join /Discussion as extra participants - each model gives its own perspective on the note.",
          "After a /Quiz submission, click \"Save Results to Notes\" to store questions, your answers, correct answers, and explanations as a searchable note.",
          "Connect Gmail in Settings → Email to automatically sync important emails to an \"Email Digest\" note and create deadline reminders. The \"Sync from Email\" button in the Reminders panel triggers a fresh sync at any time.",
          "Email-sourced reminders are global - they appear in every workspace, not just the one that was active when they were created.",
          "Reply to emails directly from a reminder detail or the email list in Settings → Email - MemoLink builds 3 AI-drafted options based on your notes, and sends the reply threaded correctly in Gmail.",
          "Open the AI Memory Graph (⬡ icon in toolbar) to see how your notes are connected through shared entities. Rebuild the graph after adding new notes to update the relationships.",
          "Graph-enhanced retrieval is automatic - when you chat, MemoLink can pull in related notes beyond the first search hits to give more complete answers.",
          "Use the AI Insights scan (Reminders panel → AI Insights → Scan Notes) before important deadlines to catch anything you may have forgotten to set a reminder for.",
          "The Answer Confidence badge tells you how grounded each AI reply is. UNSUPPORTED means the topic isn't in your notes - try uploading a relevant document first.",
          "AutoPilot automatically routes coding questions to DeepSeek Coder - just mention any language name (Python, Go, Rust, SQL…) in your message.",
          "AutoPilot routes research and analysis questions to GPT-4o. For quick factual questions it stays on the default fast model. The violet ⚡ chip shows when a routing decision was made.",
          "For large reports or assessments, ask directly for the complete final draft and include the required word count or rubric. MemoLink now has a dedicated long-form academic path instead of treating these like normal short chat replies.",
          "Open the Timeline tab on any lecture or meeting transcript note to get chapters, action items, and key moments with timestamps - no manual note-taking needed.",
          "The Jump → button in the Timeline tab finds the exact phrase in the transcript and scrolls the editor to it - useful for long recordings where scrolling manually would take too long.",
          "Timeline results are cached - clicking Regenerate re-runs the AI analysis after you've edited or improved the transcript note.",
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
        className="bg-[#1a1a24] border border-[var(--ml-bg-hover)] rounded-2xl w-full max-w-[700px] mx-4 max-h-[82vh] flex flex-col shadow-2xl text-white overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--ml-bg-hover)] shrink-0">
          <div className="flex items-center gap-2.5">
            <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5 text-indigo-400" fill="currentColor" viewBox="0 0 16 16">
              <path d="M8 15A7 7 0 1 1 8 1a7 7 0 0 1 0 14m0 1A8 8 0 1 0 8 0a8 8 0 0 0 0 16"/>
              <path d="M5.255 5.786a.237.237 0 0 0 .241.247h.825c.138 0 .248-.113.266-.25.09-.656.54-1.134 1.342-1.134.686 0 1.314.343 1.314 1.168 0 .635-.374.927-.965 1.371-.673.489-1.206 1.06-1.168 1.987l.003.217a.25.25 0 0 0 .25.246h.811a.25.25 0 0 0 .25-.25v-.105c0-.718.273-.927 1.01-1.486.609-.463 1.244-.977 1.244-2.056 0-1.511-1.276-2.241-2.673-2.241-1.267 0-2.655.59-2.75 2.286m1.557 5.763c0 .533.425.927 1.01.927.609 0 1.028-.394 1.028-.927 0-.552-.42-.94-1.029-.94-.584 0-1.009.388-1.009.94"/>
            </svg>
            <h2 className="font-semibold text-base">Help &amp; Guide</h2>
          </div>
          <button
            onClick={onClose}
            className="w-7 h-7 flex items-center justify-center rounded-lg text-gray-500 hover:text-gray-200 hover:bg-[var(--ml-bg-hover)] transition"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Body: sidebar nav + content */}
        <div className="flex flex-1 overflow-hidden">
          {/* Nav */}
          <nav className="w-44 shrink-0 border-r border-[var(--ml-bg-hover)] py-3 px-2 flex flex-col gap-0.5 overflow-y-auto">
            {NAV.map(({ id, label, icon }) => (
              <button
                key={id}
                onClick={() => setActive(id)}
                className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs text-left transition ${
                  active === id
                    ? "bg-indigo-600/20 text-indigo-300 font-medium"
                    : "text-gray-500 hover:text-gray-200 hover:bg-[var(--ml-bg-panel)]"
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
        <div className="px-6 py-3 border-t border-[var(--ml-bg-hover)] shrink-0">
          <p className="text-[11px] text-gray-700 text-center">
            MemoLink - Smart AI Companion
          </p>
        </div>
      </div>
    </div>
  );
}
