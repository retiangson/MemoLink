import React, { useState, useEffect, useCallback } from "react";
import type { SuggestionItem } from "../hooks/useSuggestions";
import { ReminderDetailModal } from "./ReminderDetailModal";
import { AddReminderModal } from "./AddReminderModal";
import { buildGoogleCalendarUrl } from "../utils/reminderUtils";
import { InsightsPanel } from "./InsightsPanel";
import { listTeamsChats, getTeamsMessages, sendTeamsMessage, chatToNote } from "../api/teamsApi";
import type { TeamsChat, TeamsMessage } from "../api/teamsApi";
import type { EmailRecord, EmailAccount } from "../api/emailApi";
import { EmailDetailModal } from "./EmailDetailModal";

interface RightPanelProps {
  open: boolean;
  onClose: () => void;
  items: SuggestionItem[];
  isGenerating: boolean;
  onAddManual: (text: string, description?: string | null, due_date?: string | null, due_time?: string | null) => void;
  onToggleDone: (id: number) => void;
  onUpdate: (id: number, fields: { text: string; description: string | null; due_date: string | null; due_time: string | null; done: boolean }) => void;
  onRemove: (id: number) => void;
  onClearDone: () => void;
  onGenerate: () => void;
  notificationPermission: NotificationPermission;
  onRequestNotificationPermission: () => void;
  emailConnected?: boolean;
  emailAccounts?: EmailAccount[];
  emailRecords?: EmailRecord[];
  onCreateReminderFromEmail?: (emailId: number) => void;
  onDeleteEmailRecord?: (emailId: number) => Promise<void>;
  isSyncingEmail?: boolean;
  onSyncEmail?: () => void;
  emailSyncResult?: string | null;
  teamsConnected?: boolean;
  insightsEnabled?: boolean;
  workspaceId?: number | null;
  onOpenNote?: (noteId: number) => void;
}

export function RightPanel({
  open, onClose, items, isGenerating,
  onAddManual, onToggleDone, onUpdate, onRemove, onClearDone,
  onGenerate, notificationPermission, onRequestNotificationPermission,
  emailConnected, emailAccounts = [], emailRecords = [], onCreateReminderFromEmail, onDeleteEmailRecord,
  isSyncingEmail, onSyncEmail, emailSyncResult,
  teamsConnected,
  insightsEnabled, workspaceId, onOpenNote,
}: RightPanelProps) {
  const [showAddModal, setShowAddModal] = useState(false);
  const [selectedItem, setSelectedItem] = useState<SuggestionItem | null>(null);
  const [showNoteReminders, setShowNoteReminders] = useState(false);
  const [showEmailReminders, setShowEmailReminders] = useState(false);
  const [collapsedAccountIds, setCollapsedAccountIds] = useState<Set<number>>(new Set());
  const [selectedEmail, setSelectedEmail] = useState<EmailRecord | null>(null);
  const [emailDeleteLoading, setEmailDeleteLoading] = useState<number | null>(null);
  const [showTeams, setShowTeams] = useState(false);
  const [teamsChats, setTeamsChats] = useState<TeamsChat[]>([]);
  const [teamsChatsLoading, setTeamsChatsLoading] = useState(false);
  const [selectedChat, setSelectedChat] = useState<TeamsChat | null>(null);
  const [teamsMessages, setTeamsMessages] = useState<TeamsMessage[]>([]);
  const [teamsMsgLoading, setTeamsMsgLoading] = useState(false);
  const [teamsReply, setTeamsReply] = useState("");
  const [teamsSending, setTeamsSending] = useState(false);
  const [teamsSaveResult, setTeamsSaveResult] = useState<string | null>(null);
  const [teamsError, setTeamsError] = useState<string | null>(null);

  const loadTeamsChats = useCallback(async () => {
    setTeamsChatsLoading(true);
    setTeamsError(null);
    try {
      setTeamsChats(await listTeamsChats());
    } catch (err: any) {
      const detail = err?.response?.data?.detail;
      setTeamsError(detail?.message ?? "Could not load Teams chats.");
      setTeamsChats([]);
    } finally { setTeamsChatsLoading(false); }
  }, []);

  useEffect(() => {
    if (open && teamsConnected) loadTeamsChats();
  }, [open, teamsConnected]);

  async function handleOpenChat(chat: TeamsChat) {
    setSelectedChat(chat);
    setTeamsMessages([]);
    setTeamsSaveResult(null);
    setTeamsError(null);
    setTeamsMsgLoading(true);
    try {
      setTeamsMessages(await getTeamsMessages(chat.id, 20));
    } catch (err: any) {
      const detail = err?.response?.data?.detail;
      setTeamsError(detail?.message ?? "Could not load Teams messages.");
    } finally { setTeamsMsgLoading(false); }
  }

  async function handleSendReply() {
    if (!selectedChat || !teamsReply.trim()) return;
    setTeamsSending(true);
    try {
      await sendTeamsMessage(selectedChat.id, teamsReply.trim());
      setTeamsReply("");
      setTeamsMessages(await getTeamsMessages(selectedChat.id, 20));
    } catch { /* ignore */ } finally { setTeamsSending(false); }
  }

  async function handleSaveToNote() {
    if (!selectedChat) return;
    setTeamsSaveResult(null);
    try {
      const res = await chatToNote(selectedChat.id, selectedChat.topic, workspaceId);
      setTeamsSaveResult(`✓ Saved: "${res.title}"`);
    } catch { setTeamsSaveResult("Failed to save."); }
  }

  if (!open) return null;

  const _d = new Date();

  const today = `${_d.getFullYear()}-${String(_d.getMonth() + 1).padStart(2, "0")}-${String(_d.getDate()).padStart(2, "0")}`;
  const doneCount = items.filter((i) => i.done).length;

  const noteItems = items.filter((i) => !i.email_record_id);

  // Build a set of email_record_ids that already have reminders (for "Pinned" badge)
  const pinnedEmailIds = new Set(items.filter((i) => !!i.email_record_id).map((i) => i.email_record_id!));

  const hasEmail = emailConnected || emailRecords.length > 0;

  // Count only records that are actually rendered in a collapsible section
  const visibleEmailCount = emailAccounts.length === 0
    ? emailRecords.length
    : emailAccounts.reduce((sum, acct) => sum + emailRecords.filter((r) =>
        r.email_account_id === acct.id ||
        (emailAccounts.length === 1 && r.email_account_id == null)
      ).length, 0);

  function toggleAccountCollapse(accountId: number) {
    setCollapsedAccountIds((prev) => {
      const next = new Set(prev);
      next.has(accountId) ? next.delete(accountId) : next.add(accountId);
      return next;
    });
  }

  function renderEmailCard(email: EmailRecord) {
    const isPinned = pinnedEmailIds.has(email.id);
    const score = email.importance_score ?? 3;
    const urgencyLabel = score >= 4.5 ? { t: "Urgent", cls: "text-red-400 bg-red-500/15" }
      : score >= 3.5 ? { t: "Important", cls: "text-orange-400 bg-orange-500/15" }
      : { t: "Notable", cls: "text-blue-400 bg-blue-500/10" };
    const dateLabel = email.email_date
      ? new Date(email.email_date).toLocaleDateString(undefined, { month: "short", day: "numeric" })
      : "";
    return (
      <div
        key={email.id}
        className="group rounded-xl border bg-[#131320] border-[var(--ml-bg-hover)] hover:border-blue-500/30 transition overflow-hidden cursor-pointer"
        onClick={() => setSelectedEmail(email)}
      >
        <div className="flex items-start gap-2 p-2.5">
          <div className="flex-1 min-w-0">
            <p className="text-[11px] font-medium text-gray-200 leading-snug break-words line-clamp-2">{email.subject}</p>
            <p className="text-[10px] text-gray-500 truncate mt-0.5">{email.sender_name || email.sender_email}</p>
          </div>
          <button
            title="Remove email"
            disabled={emailDeleteLoading === email.id}
            onClick={async (e) => {
              e.stopPropagation();
              if (!onDeleteEmailRecord) return;
              setEmailDeleteLoading(email.id);
              try { await onDeleteEmailRecord(email.id); } finally { setEmailDeleteLoading(null); }
            }}
            className="shrink-0 w-5 h-5 flex items-center justify-center text-gray-700 hover:text-red-400 transition opacity-0 group-hover:opacity-100 disabled:opacity-40 text-xs leading-none"
          >
            {emailDeleteLoading === email.id
              ? <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/></svg>
              : "✕"}
          </button>
        </div>
        <div className="flex items-center gap-1.5 px-2.5 pb-2 flex-wrap">
          <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded ${urgencyLabel.cls}`}>{urgencyLabel.t}</span>
          {dateLabel && <span className="text-[10px] text-gray-600">{dateLabel}</span>}
          {isPinned && (
            <span className="text-[9px] text-blue-400/70 px-1.5 py-0.5 rounded border border-blue-500/20 bg-blue-500/10 ml-auto">📌 Pinned</span>
          )}
        </div>
      </div>
    );
  }

  const renderCard = (item: SuggestionItem) => {
    const isToday   = !item.done && item.due_date === today;
    const isOverdue = !item.done && !!item.due_date && item.due_date < today;
    return (
      <div
        key={item.id}
        onClick={() => setSelectedItem(item)}
        className={`group flex items-start gap-2.5 p-2.5 rounded-xl border transition-all cursor-pointer ${
          item.done
            ? "bg-[var(--ml-bg-bar)] border-[var(--ml-bg-panel)] opacity-50 hover:opacity-70"
            : isOverdue
              ? "bg-[#1a0a0a] border-red-500/30 hover:border-red-400/50"
              : isToday
                ? "bg-[#1a1a10] border-amber-500/40 hover:border-amber-400/60"
                : "bg-[#1a1a24] border-[var(--ml-bg-hover)] hover:border-indigo-500/40"
        }`}
      >
        <button
          onClick={(e) => { e.stopPropagation(); onToggleDone(item.id); }}
          className={`mt-0.5 w-4 h-4 rounded-full border-2 flex items-center justify-center shrink-0 transition-all ${
            item.done ? "bg-indigo-600 border-indigo-600" : "border-gray-600 hover:border-indigo-400"
          }`}
        >
          {item.done && (
            <svg className="w-2 h-2 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          )}
        </button>

        <div className="flex-1 min-w-0">
          <p className={`text-xs leading-snug break-words ${item.done ? "line-through text-gray-600" : "text-gray-200"}`}>
            {item.text}
          </p>
          {item.description && (
            <p className={`text-[11px] mt-0.5 leading-snug break-words line-clamp-2 ${item.done ? "text-gray-700" : "text-gray-500"}`}>
              {item.description}
            </p>
          )}
          <div className="flex items-center gap-2 mt-1 flex-wrap">
            {item.type === "ai" && !item.email_record_id && (
              <span className="inline-flex items-center gap-0.5 text-[10px] text-indigo-400/60 uppercase tracking-wider">✦ AI</span>
            )}
            {item.due_date && (
              <span className={`text-[10px] ${
                isOverdue ? "text-red-400 font-medium" : isToday ? "text-amber-400 font-medium" : "text-gray-600"
              }`}>
                {isOverdue ? "⚠ Overdue" : isToday ? "⚠ Today" : item.due_date}
                {item.due_time && ` · ${item.due_time}`}
              </span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-1 shrink-0 opacity-0 group-hover:opacity-100 transition">
          {item.due_date && (
            <a
              href={buildGoogleCalendarUrl(item.text, item.description, item.due_date, item.due_time)}
              target="_blank" rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              title="Add to Google Calendar"
              className="w-5 h-5 flex items-center justify-center text-gray-700 hover:text-indigo-400 transition"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="w-3 h-3" fill="currentColor" viewBox="0 0 16 16">
                <path d="M3.5 0a.5.5 0 0 1 .5.5V1h8V.5a.5.5 0 0 1 1 0V1h1a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H2a2 2 0 0 1-2-2V3a2 2 0 0 1 2-2h1V.5a.5.5 0 0 1 .5-.5M1 4v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V4z"/>
              </svg>
            </a>
          )}
          <button
            onClick={(e) => { e.stopPropagation(); onRemove(item.id); }}
            className="w-5 h-5 flex items-center justify-center text-gray-700 hover:text-red-400 transition text-sm leading-none"
            title="Delete"
          >×</button>
        </div>
      </div>
    );
  };

  return (
    <>
      {/* Mobile backdrop */}
      <div className="fixed inset-0 bg-black/60 z-40 sm:hidden" onClick={onClose} />
      <div id="tour-right-panel" className="fixed inset-y-0 right-0 z-50 sm:relative sm:inset-auto w-72 h-full flex flex-col bg-[var(--ml-bg-base)] border-l border-[var(--ml-bg-panel)] shrink-0">

      {/* Header */}
      <div className="h-10 flex items-center justify-between px-4 border-b border-[var(--ml-bg-panel)] shrink-0 bg-[var(--ml-bg-bar)]">
        <div className="flex items-center gap-2">
          <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5 text-indigo-400" fill="currentColor" viewBox="0 0 16 16">
            <path d="M2 6a6 6 0 1 1 10.174 4.31c-.203.196-.359.4-.453.619l-.762 1.769A.5.5 0 0 1 10.5 13h-5a.5.5 0 0 1-.46-.302l-.761-1.77a2 2 0 0 0-.453-.618A5.98 5.98 0 0 1 2 6m3 8.5a.5.5 0 0 1 .5-.5h5a.5.5 0 0 1 0 1l-.224.447a1 1 0 0 1-.894.553H6.618a1 1 0 0 1-.894-.553L5.5 15a.5.5 0 0 1-.5-.5"/>
          </svg>
          <span className="text-xs font-medium text-gray-400 uppercase tracking-wider">Reminders</span>
          <button
            onClick={() => setShowAddModal(true)}
            title="Add reminder"
            className="w-4 h-4 flex items-center justify-center rounded text-gray-600 hover:text-indigo-400 hover:bg-[var(--ml-bg-hover)] transition"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
            </svg>
          </button>
        </div>
        <div className="flex items-center gap-1.5">
          {/* Notification bell */}
          <button
            onClick={notificationPermission === "granted" ? undefined : onRequestNotificationPermission}
            title={
              notificationPermission === "granted" ? "Browser alerts enabled" :
              notificationPermission === "denied" ? "Notifications blocked - enable in browser settings" :
              "Enable browser alerts for due reminders"
            }
            className={`w-6 h-6 flex items-center justify-center rounded-md transition ${
              notificationPermission === "granted"
                ? "text-amber-400 cursor-default"
                : notificationPermission === "denied"
                  ? "text-gray-700 cursor-not-allowed"
                  : "text-gray-600 hover:text-amber-400 hover:bg-[var(--ml-bg-hover)]"
            }`}
          >
            {notificationPermission === "denied" ? (
              <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 16 16">
                <path d="M5.388 1.17A4.001 4.001 0 0 1 12 5c0 .588.0 2.197.459 3.742c.316 1.508.52 2.16.52 2.16l.831.831a1 1 0 0 1-.707 1.707H9a2 2 0 0 1-4 0H1.5a1 1 0 0 1-.707-1.707l.5-.5M13.5 2.5l-11 11"/>
                <path d="M13.646.354a.5.5 0 0 0-.707 0l-12 12a.5.5 0 0 0 .707.707l12-12a.5.5 0 0 0 0-.707"/>
              </svg>
            ) : (
              <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 16 16">
                <path d="M8 16a2 2 0 0 0 2-2H6a2 2 0 0 0 2 2M8 1.918l-.797.161A4 4 0 0 0 4 6c0 .628-.134 2.197-.459 3.742-.16.767-.376 1.566-.663 2.258h10.244c-.287-.692-.502-1.49-.663-2.258C12.134 8.197 12 6.628 12 6a4 4 0 0 0-3.203-3.92zM14.22 12c.223.447.481.801.78 1H1c.299-.199.557-.553.78-1C2.68 10.2 3 6.88 3 6c0-2.42 1.72-4.44 4.005-4.901a1 1 0 1 1 1.99 0A5 5 0 0 1 13 6c0 .88.32 4.2 1.22 6"/>
              </svg>
            )}
          </button>
          <button onClick={onClose} className="text-gray-600 hover:text-gray-300 transition text-sm leading-none">✕</button>
        </div>
      </div>

      {/* Scrollable body - everything between header and footer scrolls together */}
      <div className="flex-1 overflow-y-auto flex flex-col min-h-0">

      {/* ── Section 1: General Reminders ── */}
      <div className="border-b border-[var(--ml-bg-panel)]">
        <button
          onClick={() => setShowNoteReminders((v) => !v)}
          className="w-full flex items-center justify-between px-4 py-2.5 hover:bg-[#1a1a24] transition text-left"
        >
          <div className="flex items-center gap-2">
            <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5 text-indigo-400 shrink-0" fill="currentColor" viewBox="0 0 16 16">
              <path d="M14.5 3a.5.5 0 0 1 .5.5v9a.5.5 0 0 1-.5.5h-13a.5.5 0 0 1-.5-.5v-9a.5.5 0 0 1 .5-.5zm-13-1A1.5 1.5 0 0 0 0 3.5v9A1.5 1.5 0 0 0 1.5 14h13a1.5 1.5 0 0 0 1.5-1.5v-9A1.5 1.5 0 0 0 14.5 2z"/>
              <path d="M7 5.5a.5.5 0 0 1 .5-.5h5a.5.5 0 0 1 0 1h-5a.5.5 0 0 1-.5-.5m-1.496-.854a.5.5 0 0 1 0 .708l-1.5 1.5a.5.5 0 0 1-.708 0l-.5-.5a.5.5 0 1 1 .708-.708l.146.147 1.146-1.147a.5.5 0 0 1 .708 0M7 9.5a.5.5 0 0 1 .5-.5h5a.5.5 0 0 1 0 1h-5a.5.5 0 0 1-.5-.5m-1.496-.854a.5.5 0 0 1 0 .708l-1.5 1.5a.5.5 0 0 1-.708 0l-.5-.5a.5.5 0 1 1 .708-.708l.146.147 1.146-1.147a.5.5 0 0 1 .708 0"/>
            </svg>
            <span className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider">General Reminders</span>
            {noteItems.length > 0 && (
              <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-indigo-500/20 text-indigo-400">
                {noteItems.length}
              </span>
            )}
          </div>
          <svg xmlns="http://www.w3.org/2000/svg" className={`w-3 h-3 text-gray-600 transition-transform ${showNoteReminders ? "" : "-rotate-90"}`} fill="currentColor" viewBox="0 0 16 16">
            <path d="M7.247 11.14 2.451 5.658C1.885 5.013 2.345 4 3.204 4h9.592a1 1 0 0 1 .753 1.659l-4.796 5.48a1 1 0 0 1-1.506 0z"/>
          </svg>
        </button>

        {showNoteReminders && (
          <div className="px-3 pb-3 flex flex-col gap-2">
            <button
              onClick={onGenerate}
              disabled={isGenerating}
              className="w-full flex items-center justify-center gap-2 px-3 py-2 bg-indigo-600/20 hover:bg-indigo-600/30 border border-indigo-500/30 text-indigo-300 rounded-lg text-xs transition disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {isGenerating ? (
                <><svg className="w-3 h-3 animate-spin shrink-0" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/></svg>Generating…</>
              ) : (
                <>
                  <svg xmlns="http://www.w3.org/2000/svg" className="w-3 h-3 shrink-0" fill="currentColor" viewBox="0 0 16 16">
                    <path d="M2 6a6 6 0 1 1 10.174 4.31c-.203.196-.359.4-.453.619l-.762 1.769A.5.5 0 0 1 10.5 13h-5a.5.5 0 0 1-.46-.302l-.761-1.77a2 2 0 0 0-.453-.618A5.98 5.98 0 0 1 2 6m3 8.5a.5.5 0 0 1 .5-.5h5a.5.5 0 0 1 0 1l-.224.447a1 1 0 0 1-.894.553H6.618a1 1 0 0 1-.894-.553L5.5 15a.5.5 0 0 1-.5-.5"/>
                  </svg>
                  Generate from Notes &amp; Chat
                </>
              )}
            </button>

            {noteItems.length === 0 && !isGenerating && (
              <p className="text-[11px] text-gray-600 text-center pt-1">
                No reminders yet — generate from your notes or chat.
              </p>
            )}
            {noteItems.map(renderCard)}
          </div>
        )}
      </div>

      {/* ── Section 2: Email (shown when connected or records exist) ── */}
      {hasEmail && (
        <div className="border-b border-[var(--ml-bg-panel)]">
          <button
            onClick={() => setShowEmailReminders((v) => !v)}
            className="w-full flex items-center justify-between px-4 py-2.5 hover:bg-[#1a1a24] transition text-left"
          >
            <div className="flex items-center gap-2">
              <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5 text-blue-400 shrink-0" fill="currentColor" viewBox="0 0 16 16">
                <path d="M0 4a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H2a2 2 0 0 1-2-2zm2-1a1 1 0 0 0-1 1v.217l7 4.2 7-4.2V4a1 1 0 0 0-1-1zm13 2.383-4.708 2.825L15 11.105zm-.034 6.876-5.64-3.471L8 9.583l-1.326-.795-5.64 3.47A1 1 0 0 0 2 13h12a1 1 0 0 0 .966-.741M1 11.105l4.708-2.897L1 5.383z"/>
              </svg>
              <span className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider">Email</span>
              {visibleEmailCount > 0 && (
                <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-blue-500/20 text-blue-400">
                  {visibleEmailCount}
                </span>
              )}
            </div>
            <svg xmlns="http://www.w3.org/2000/svg" className={`w-3 h-3 text-gray-600 transition-transform ${showEmailReminders ? "" : "-rotate-90"}`} fill="currentColor" viewBox="0 0 16 16">
              <path d="M7.247 11.14 2.451 5.658C1.885 5.013 2.345 4 3.204 4h9.592a1 1 0 0 1 .753 1.659l-4.796 5.48a1 1 0 0 1-1.506 0z"/>
            </svg>
          </button>

          {showEmailReminders && (
            <div className="px-3 pb-3 flex flex-col gap-2">

              {/* Sync button */}
              {emailConnected && (
                <>
                  <button
                    onClick={onSyncEmail}
                    disabled={isSyncingEmail}
                    className="w-full flex items-center justify-center gap-2 px-3 py-2 bg-blue-600/10 hover:bg-blue-600/20 border border-blue-500/20 text-blue-300 rounded-lg text-xs transition disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    {isSyncingEmail ? (
                      <><svg className="w-3 h-3 animate-spin shrink-0" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/></svg>Syncing Email…</>
                    ) : (
                      <><svg xmlns="http://www.w3.org/2000/svg" className="w-3 h-3 shrink-0" fill="currentColor" viewBox="0 0 16 16"><path d="M0 4a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H2a2 2 0 0 1-2-2zm2-1a1 1 0 0 0-1 1v.217l7 4.2 7-4.2V4a1 1 0 0 0-1-1zm13 2.383-4.708 2.825L15 11.105zm-.034 6.876-5.64-3.471L8 9.583l-1.326-.795-5.64 3.47A1 1 0 0 0 2 13h12a1 1 0 0 0 .966-.741M1 11.105l4.708-2.897L1 5.383z"/></svg>Sync from Email</>
                    )}
                  </button>
                  {emailSyncResult && (
                    <p className={`text-[10px] text-center px-2 py-1 rounded-md ${emailSyncResult.startsWith("✓") ? "text-green-400 bg-green-500/10" : "text-red-400 bg-red-500/10"}`}>
                      {emailSyncResult}
                    </p>
                  )}
                </>
              )}

              {/* Per-account collapsible sections */}
              {emailAccounts.length === 0 ? (
                <p className="text-[11px] text-gray-600 text-center pt-1">
                  {emailConnected ? "Sync to load emails." : "No emails yet."}
                </p>
              ) : (
                emailAccounts.map((account) => {
                  const isCollapsed = collapsedAccountIds.has(account.id);
                  const accountEmails = emailRecords.filter(
                    (r) => r.email_account_id === account.id ||
                      (emailAccounts.length === 1 && r.email_account_id == null)
                  );
                  return (
                    <div key={account.id} className="rounded-xl border border-[var(--ml-bg-hover)] overflow-hidden">
                      {/* Account header — collapse toggle */}
                      <button
                        onClick={() => toggleAccountCollapse(account.id)}
                        className="w-full flex items-center gap-2 px-2.5 py-2 bg-[var(--ml-bg-surface)] hover:bg-[#1e1e2c] transition text-left"
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" className="w-3 h-3 text-blue-400 shrink-0" fill="currentColor" viewBox="0 0 16 16">
                          <path d="M0 4a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H2a2 2 0 0 1-2-2zm2-1a1 1 0 0 0-1 1v.217l7 4.2 7-4.2V4a1 1 0 0 0-1-1zm13 2.383-4.708 2.825L15 11.105zm-.034 6.876-5.64-3.471L8 9.583l-1.326-.795-5.64 3.47A1 1 0 0 0 2 13h12a1 1 0 0 0 .966-.741M1 11.105l4.708-2.897L1 5.383z"/>
                        </svg>
                        <span className="flex-1 min-w-0 text-[11px] font-medium text-gray-300 truncate" title={account.email}>
                          {account.email}
                        </span>
                        {accountEmails.length > 0 && (
                          <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-blue-500/20 text-blue-400 shrink-0">
                            {accountEmails.length}
                          </span>
                        )}
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          className={`w-3 h-3 text-gray-600 shrink-0 transition-transform ${isCollapsed ? "-rotate-90" : ""}`}
                          fill="currentColor" viewBox="0 0 16 16"
                        >
                          <path d="M7.247 11.14 2.451 5.658C1.885 5.013 2.345 4 3.204 4h9.592a1 1 0 0 1 .753 1.659l-4.796 5.48a1 1 0 0 1-1.506 0z"/>
                        </svg>
                      </button>

                      {/* Account emails */}
                      {!isCollapsed && (
                        <div className="p-2 flex flex-col gap-1.5 border-t border-[var(--ml-bg-hover)]">
                          {accountEmails.length === 0 ? (
                            <p className="text-[11px] text-gray-600 text-center py-2">No emails synced yet.</p>
                          ) : (
                            accountEmails.map(renderEmailCard)
                          )}
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          )}
        </div>
      )}

      {/* ── Section 3: Teams ── */}
      {teamsConnected && (
        <div className="border-b border-[var(--ml-bg-panel)]">
          <button
            onClick={() => setShowTeams((v) => !v)}
            className="w-full flex items-center justify-between px-4 py-2.5 hover:bg-[#1a1a24] transition text-left"
          >
            <div className="flex items-center gap-2">
              <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5 text-violet-400 shrink-0" fill="currentColor" viewBox="0 0 24 24">
                <path d="M19.5 5.25a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0M14.25 10.5a2.25 2.25 0 1 0 0-4.5 2.25 2.25 0 0 0 0 4.5M5.25 7.5a2.25 2.25 0 1 0 4.5 0 2.25 2.25 0 0 0-4.5 0m2.25 3a3.75 3.75 0 0 0-3.75 3.75v.75h7.5v-.75A3.75 3.75 0 0 0 7.5 10.5m6.75 1.5a5.26 5.26 0 0 1 1.575.243A3.74 3.74 0 0 1 17.25 15v.75H21V15a3.75 3.75 0 0 0-6.75-2.25z"/>
              </svg>
              <span className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider">Teams</span>
              {teamsChats.length > 0 && (
                <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-violet-500/20 text-violet-400">
                  {teamsChats.length}
                </span>
              )}
            </div>
            <svg xmlns="http://www.w3.org/2000/svg" className={`w-3 h-3 text-gray-600 transition-transform ${showTeams ? "" : "-rotate-90"}`} fill="currentColor" viewBox="0 0 16 16">
              <path d="M7.247 11.14 2.451 5.658C1.885 5.013 2.345 4 3.204 4h9.592a1 1 0 0 1 .753 1.659l-4.796 5.48a1 1 0 0 1-1.506 0z"/>
            </svg>
          </button>

          {showTeams && (
            <div className="px-3 pb-3 flex flex-col gap-2">
              {teamsError && (
                <div className="rounded-lg border border-amber-500/20 bg-amber-500/10 px-2.5 py-2 text-[11px] leading-relaxed text-amber-200">
                  {teamsError}
                </div>
              )}

              {selectedChat ? (
                <div className="bg-[var(--ml-bg-surface)] border border-[var(--ml-bg-hover)] rounded-xl overflow-hidden">
                  {/* Chat header */}
                  <div className="flex items-center justify-between px-3 py-2 border-b border-[var(--ml-bg-hover)]">
                    <button onClick={() => { setSelectedChat(null); setTeamsSaveResult(null); }} className="text-[11px] text-gray-500 hover:text-gray-300 transition">← Back</button>
                    <span className="text-[11px] text-gray-300 font-medium truncate max-w-[110px]">{selectedChat.topic}</span>
                    <button onClick={handleSaveToNote} className="text-[11px] text-indigo-400 hover:text-indigo-300 transition">Save</button>
                  </div>
                  {teamsSaveResult && (
                    <p className={`mx-3 mt-1.5 text-[10px] px-2 py-1 rounded-md ${teamsSaveResult.startsWith("✓") ? "bg-green-500/10 text-green-400" : "bg-red-500/10 text-red-400"}`}>{teamsSaveResult}</p>
                  )}
                  {/* Messages */}
                  <div className="px-3 py-2 max-h-40 overflow-y-auto space-y-2">
                    {teamsMsgLoading ? (
                      <p className="text-[11px] text-gray-600">Loading…</p>
                    ) : teamsMessages.length === 0 ? (
                      <p className="text-[11px] text-gray-600">No messages</p>
                    ) : teamsMessages.map((m) => (
                      <div key={m.id}>
                        <p className="text-[10px] text-violet-400 font-medium">{m.from}</p>
                        <p className="text-[11px] text-gray-300 leading-snug">{m.content}</p>
                      </div>
                    ))}
                  </div>
                  {/* Reply */}
                  <div className="px-3 pb-2.5 flex gap-1.5">
                    <input
                      type="text"
                      value={teamsReply}
                      onChange={(e) => setTeamsReply(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter") handleSendReply(); }}
                      placeholder="Reply…"
                      className="flex-1 bg-[var(--ml-bg-base)] border border-[var(--ml-bg-hover)] rounded-lg px-2 py-1 text-[11px] text-gray-200 outline-none focus:border-violet-500/50"
                    />
                    <button
                      onClick={handleSendReply}
                      disabled={teamsSending || !teamsReply.trim()}
                      className="px-2.5 py-1 text-[11px] bg-violet-600/20 border border-violet-500/30 text-violet-300 rounded-lg hover:bg-violet-600/30 disabled:opacity-40 transition"
                    >
                      {teamsSending ? "…" : "Send"}
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <button
                    onClick={loadTeamsChats}
                    disabled={teamsChatsLoading}
                    className="w-full flex items-center justify-center gap-2 px-3 py-2 bg-violet-600/10 hover:bg-violet-600/20 border border-violet-500/20 text-violet-300 rounded-lg text-xs transition disabled:opacity-40"
                  >
                    {teamsChatsLoading ? (
                      <><svg className="w-3 h-3 animate-spin shrink-0" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/></svg>Loading…</>
                    ) : (
                      <>↻ Refresh Chats</>
                    )}
                  </button>
                  {teamsChats.length === 0 && !teamsChatsLoading && (
                    <p className="text-[11px] text-gray-600 text-center pt-1">{teamsError ?? "No chats found"}</p>
                  )}
                  {teamsChats.map((chat) => (
                    <button
                      key={chat.id}
                      onClick={() => handleOpenChat(chat)}
                      className="w-full text-left px-2.5 py-2 bg-[#1a1a24] border border-[var(--ml-bg-hover)] rounded-xl hover:border-violet-500/30 transition"
                    >
                      <p className="text-[11px] text-gray-200 font-medium truncate">{chat.topic}</p>
                      {chat.lastMessagePreview && (
                        <p className="text-[10px] text-gray-600 truncate mt-0.5">{chat.lastMessagePreview}</p>
                      )}
                    </button>
                  ))}
                </>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── Section 4: AI Insights ── */}
      {insightsEnabled && (
        <InsightsPanel
          workspaceId={workspaceId ?? null}
          onOpenNote={onOpenNote}
        />
      )}

      </div>{/* end scrollable body */}

      {/* Footer: clear done - pinned at bottom */}
      {doneCount > 0 && (
        <div className="px-3 py-2 border-t border-[var(--ml-bg-panel)] shrink-0">
          <button
            onClick={onClearDone}
            className="w-full text-xs text-gray-600 hover:text-gray-400 transition py-1"
          >
            Clear {doneCount} completed
          </button>
        </div>
      )}

      {/* Add reminder popup */}
      {showAddModal && (
        <AddReminderModal
          onClose={() => setShowAddModal(false)}
          onAdd={(t, d, date, time) => onAddManual(t, d, date, time)}
        />
      )}

      {/* Detail modal - keep up-to-date version of item from list */}
      <ReminderDetailModal
        item={selectedItem ? (items.find((i) => i.id === selectedItem.id) ?? selectedItem) : null}
        onClose={() => setSelectedItem(null)}
        onSave={(id, fields) => onUpdate(id, fields)}
        onDelete={(id) => onRemove(id)}
        onToggleDone={(id) => onToggleDone(id)}
      />

      {/* Email detail modal */}
      <EmailDetailModal
        email={selectedEmail}
        isPinned={selectedEmail ? pinnedEmailIds.has(selectedEmail.id) : false}
        linkedReminderId={selectedEmail ? (items.find((i) => i.email_record_id === selectedEmail.id)?.id ?? null) : null}
        onClose={() => setSelectedEmail(null)}
        onPinEmail={async (emailId) => { await onCreateReminderFromEmail?.(emailId); }}
        onUnpinReminder={(reminderId) => onRemove(reminderId)}
        onDeleteEmail={async (emailId) => { await onDeleteEmailRecord?.(emailId); }}
      />
    </div>
    </>
  );
}
