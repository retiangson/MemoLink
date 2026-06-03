import React from "react";
import { UploadNotes } from "./UploadNotes";
import { WorkspaceSelector } from "./WorkspaceSelector";
import type { Conversation, Note, Workspace } from "../types";
import { convLabel } from "../types";
import type { EvalStatus } from "../hooks/useEvaluationHeartbeat";

function fmtClock(s: number): string {
  const m = Math.floor(s / 60), sec = Math.max(0, s % 60);
  return `${m}:${String(sec).padStart(2, "0")}`;
}

interface SidebarProps {
  open: boolean;
  onClose: () => void;
  notes: Note[];
  setNotes: React.Dispatch<React.SetStateAction<any[]>>;
  showNotes: boolean;
  setShowNotes: (v: boolean) => void;
  showConversations: boolean;
  setShowConversations: (v: boolean) => void;
  conversations: Conversation[];
  activeConversation: Conversation | null;
  onNoteClick: (note: Note) => void;
  onNewNote: () => void;
  onNoteMenu: (note: Note, rect: DOMRect) => void;
  onConversationClick: (conv: Conversation) => void;
  onNewChat: () => void;
  onConversationMenu: (conv: Conversation, rect: DOMRect) => void;
  onOpenRecycleBin: () => void;
  workspaces: Workspace[];
  activeWorkspace: Workspace | null;
  onSwitchWorkspace: (ws: Workspace) => void;
  onManageWorkspaces: () => void;
  onNotesUploaded?: (notes: any[]) => void;
  evalStatus?: EvalStatus | null;
}

export function Sidebar({
  open, onClose, notes, setNotes,
  showNotes, setShowNotes, showConversations, setShowConversations,
  conversations, activeConversation,
  onNoteClick, onNewNote, onNoteMenu,
  onConversationClick, onNewChat, onConversationMenu,
  onOpenRecycleBin,
  workspaces, activeWorkspace, onSwitchWorkspace, onManageWorkspaces,
  onNotesUploaded, evalStatus,
}: SidebarProps) {
  if (!open) return null;

  const showEvalTimer = !!evalStatus?.enabled && !!evalStatus?.loaded && !evalStatus?.exhausted;

  return (
    <aside className="w-[300px] h-full bg-[#0f0f13] border-r border-[#1e1e2a] flex flex-col flex-shrink-0">
      <div className="px-4 py-3 border-b border-[#1e1e2a] flex justify-between items-center">
        <div className="flex items-center gap-2 min-w-0">
          <img
            src="/memolink-icon.png"
            alt=""
            className="h-7 w-7 rounded-md bg-white object-cover shrink-0"
          />
          <span className="font-semibold text-sm text-gray-100 shrink-0">MemoLink</span>
          {showEvalTimer && evalStatus && (
            <span
              title={`Evaluation collection window — ${fmtClock(evalStatus.consumedSeconds)} of ${fmtClock(evalStatus.budgetSeconds)} used. Data stops recording when it ends.`}
              className="flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10px] font-medium bg-cyan-500/10 text-cyan-300 border border-cyan-500/25 whitespace-nowrap"
            >
              <svg className="w-3 h-3 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <circle cx="12" cy="12" r="9" /><path strokeLinecap="round" d="M12 7v5l3 2" />
              </svg>
              Eval {fmtClock(evalStatus.remainingSeconds)}
            </span>
          )}
        </div>
        <button onClick={onClose} className="text-gray-500 hover:text-gray-300 text-sm shrink-0">✕</button>
      </div>

      <div className="px-3 py-2.5 border-b border-[#1e1e2a]">
        <WorkspaceSelector
          workspaces={workspaces}
          activeWorkspace={activeWorkspace}
          onSwitch={onSwitchWorkspace}
          onManage={onManageWorkspaces}
        />
      </div>

      <div className="px-3 py-3 border-b border-[#1e1e2a]">
        <UploadNotes setNotes={setNotes} workspaceId={activeWorkspace?.id} onUploaded={onNotesUploaded} />
      </div>

      <div className="border-b border-[#1e1e2a]">
        <button
          onClick={() => setShowNotes(!showNotes)}
          className="w-full px-4 py-2.5 flex justify-between items-center text-gray-400 text-xs font-semibold uppercase tracking-wider hover:text-gray-200 transition"
        >
          <span>Notes ({notes.length})</span>
          <span>{showNotes ? "▾" : "▸"}</span>
        </button>
        {showNotes && (
          <div className="px-3 pb-3 max-h-52 overflow-y-auto space-y-1">
            <button
              onClick={onNewNote}
              className="w-full py-1.5 px-3 text-xs font-medium bg-indigo-600/20 border border-indigo-600/30 text-indigo-300 rounded-lg hover:bg-indigo-600/30 transition"
            >
              + New Note
            </button>
            {notes.length === 0 && <p className="text-xs text-gray-600 px-1">No notes yet</p>}
            {notes.map((note) => (
              <div
                key={note.id}
                className="flex items-center justify-between rounded-lg px-2 py-1.5 hover:bg-[#1e1e2a] cursor-pointer group"
                onClick={() => onNoteClick(note)}
              >
                <span className="truncate text-xs text-gray-300 flex-1">{note.title || "Untitled"}</span>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onNoteMenu(note, e.currentTarget.getBoundingClientRect());
                  }}
                  className="opacity-0 group-hover:opacity-100 text-gray-500 hover:text-gray-200 px-1 text-base transition"
                >⋯</button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="flex-1 flex flex-col overflow-hidden">
        <button
          onClick={() => setShowConversations(!showConversations)}
          className="w-full px-4 py-2.5 flex justify-between items-center text-gray-400 text-xs font-semibold uppercase tracking-wider hover:text-gray-200 transition border-b border-[#1e1e2a]"
        >
          <span>Chats</span>
          <span>{showConversations ? "▾" : "▸"}</span>
        </button>
        {showConversations && (
          <div className="flex-1 overflow-y-auto p-3 space-y-1">
            <button
              onClick={onNewChat}
              className="w-full py-1.5 px-3 text-xs font-medium bg-green-600/20 border border-green-600/30 text-green-300 rounded-lg hover:bg-green-600/30 transition"
            >
              + New Chat
            </button>
            {conversations.map((conv) => (
              <div key={conv.id} className="relative">
                <div
                  onClick={() => onConversationClick(conv)}
                  className={`flex items-center justify-between rounded-lg px-2 py-1.5 cursor-pointer transition group ${activeConversation?.id === conv.id ? "bg-[#1e1e2a] text-white" : "text-gray-400 hover:bg-[#1a1a24] hover:text-white"}`}
                >
                  <span className="truncate text-xs flex-1">{convLabel(conv)}</span>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onConversationMenu(conv, e.currentTarget.getBoundingClientRect());
                    }}
                    className="opacity-0 group-hover:opacity-100 text-gray-500 hover:text-gray-200 px-1 text-base transition"
                  >⋯</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Recycle Bin */}
      <div className="shrink-0 border-t border-[#1e1e2a] p-3">
        <button
          onClick={onOpenRecycleBin}
          className="w-full flex items-center gap-2 px-3 py-2 text-xs text-gray-500 hover:text-gray-300 hover:bg-[#1e1e2a] rounded-lg transition"
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5 shrink-0" fill="currentColor" viewBox="0 0 16 16">
            <path d="M11 1.5v1h3.5a.5.5 0 0 1 0 1h-.538l-.853 10.66A2 2 0 0 1 11.115 16h-6.23a2 2 0 0 1-1.994-1.84L2.038 3.5H1.5a.5.5 0 0 1 0-1H5v-1A1.5 1.5 0 0 1 6.5 0h3A1.5 1.5 0 0 1 11 1.5m-5 0v1h4v-1a.5.5 0 0 0-.5-.5h-3a.5.5 0 0 0-.5.5M4.5 5.029l.5 8.5a.5.5 0 1 0 .998-.06l-.5-8.5a.5.5 0 1 0-.998.06m6.53-.528a.5.5 0 0 0-.528.47l-.5 8.5a.5.5 0 0 0 .998.058l.5-8.5a.5.5 0 0 0-.47-.528M8 4.5a.5.5 0 0 0-.5.5v8.5a.5.5 0 0 0 1 0V5a.5.5 0 0 0-.5-.5"/>
          </svg>
          Recycle Bin
        </button>
      </div>
    </aside>
  );
}
