import React, { useState, useEffect, useCallback, useRef } from "react";
import type { SuggestionItem } from "../hooks/useSuggestions";
import { ReminderDetailModal } from "./ReminderDetailModal";
import { AddReminderModal } from "./AddReminderModal";
import { InsightsPanel } from "./InsightsPanel";
import { listTeamsChats, getTeamsMessages, sendTeamsMessage, chatToNote } from "../api/teamsApi";
import type { TeamsChat, TeamsMessage } from "../api/teamsApi";
import type { EmailAccount, BrowseEmailResult } from "../api/emailApi";
import { updateEmailAccountDisplayName } from "../api/emailApi";
import { EmailFolderBrowser } from "./EmailFolderBrowser";
import { EmailAllMailList } from "./EmailAllMailList";
import { listWhatsappChats, getWhatsappProfilePicture, getWhatsappStatus } from "../api/whatsappApi";
import type { WhatsappChat } from "../api/whatsappApi";
import { SpotifyMiniPlayer } from "./SpotifyPlayer";
import type { SpotifyApiTrack, SpotifyRepeatMode } from "../api/connectorsApi";
import type { CalendarOccurrence } from "../api/calendarApi";
import type { UserBook } from "../api/booksApi";

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
  onOpenEmailTab?: (email: BrowseEmailResult) => void;
  onComposeNewMail?: () => void;
  openEmailTabId?: string | null;
  onEmailArchived?: (gmailMessageId: string) => void;
  onEmailTrashed?: (gmailMessageId: string) => void;
  onEmailPinChanged?: (gmailMessageId: string, isPinned: boolean) => void;
  teamsConnected?: boolean;
  whatsappConnected?: boolean;
  whatsappAvailable?: boolean;
  onOpenWhatsappTab?: (chat: WhatsappChat) => void;
  openWhatsappChatId?: string | null;
  insightsEnabled?: boolean;
  workspaceId?: number | null;
  onOpenNote?: (noteId: number) => void;
  spotifyTrack: SpotifyApiTrack | null;
  spotifyQueueTracks: SpotifyApiTrack[];
  spotifyPlaying: boolean;
  spotifyConnected: boolean;
  spotifyProgressMs: number;
  spotifyDurationMs: number;
  spotifyShuffle: boolean;
  spotifyRepeatMode: SpotifyRepeatMode;
  onSpotifyPrevious: () => void;
  onSpotifyTogglePlay: () => void;
  onSpotifyStop: () => void;
  onSpotifyNext: () => void;
  onSpotifySelectTrack: (track: SpotifyApiTrack) => void;
  onSpotifyShuffle: (shuffle: boolean) => void;
  onSpotifyCycleRepeat: () => void;
  onSpotifySeek: (positionMs: number) => void;
  onOpenSpotifyTab: () => void;
  calendarEvents?: CalendarOccurrence[];
  calendarLoading?: boolean;
  onOpenCalendarTab?: () => void;
  booksEnabled?: boolean;
  myBooks?: UserBook[];
  onOpenBrowseBooks?: () => void;
  onOpenMyBooks?: () => void;
  onOpenBookReader?: (bookId: number) => void;
}

type PanelSectionKey = "reminders" | "calendar" | "email" | "teams" | "whatsapp" | "books";
const DEFAULT_SECTION_ORDER: PanelSectionKey[] = ["reminders", "calendar", "email", "teams", "whatsapp", "books"];
const SECTION_ORDER_STORAGE_KEY = "memolink_panel_section_order";

function loadSectionOrder(): PanelSectionKey[] {
  try {
    const raw = localStorage.getItem(SECTION_ORDER_STORAGE_KEY);
    if (!raw) return DEFAULT_SECTION_ORDER;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return DEFAULT_SECTION_ORDER;
    const valid = parsed.filter((k): k is PanelSectionKey => DEFAULT_SECTION_ORDER.includes(k));
    const missing = DEFAULT_SECTION_ORDER.filter((k) => !valid.includes(k));
    return [...valid, ...missing];
  } catch {
    return DEFAULT_SECTION_ORDER;
  }
}

function SectionDragHandle() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" className="w-3 h-3 text-gray-700 shrink-0" fill="currentColor" viewBox="0 0 16 16">
      <path d="M7 2a1 1 0 1 1-2 0 1 1 0 0 1 2 0zm3 0a1 1 0 1 1-2 0 1 1 0 0 1 2 0zM7 5a1 1 0 1 1-2 0 1 1 0 0 1 2 0zm3 0a1 1 0 1 1-2 0 1 1 0 0 1 2 0zM7 8a1 1 0 1 1-2 0 1 1 0 0 1 2 0zm3 0a1 1 0 1 1-2 0 1 1 0 0 1 2 0zm-3 3a1 1 0 1 1-2 0 1 1 0 0 1 2 0zm3 0a1 1 0 1 1-2 0 1 1 0 0 1 2 0z"/>
    </svg>
  );
}

export function RightPanel({
  open, onClose, items, isGenerating,
  onAddManual, onToggleDone, onUpdate, onRemove, onClearDone,
  onGenerate, notificationPermission, onRequestNotificationPermission,
  emailConnected, emailAccounts = [],
  onOpenEmailTab, onComposeNewMail, openEmailTabId, onEmailArchived, onEmailTrashed, onEmailPinChanged,
  teamsConnected,
  whatsappConnected,
  whatsappAvailable,
  onOpenWhatsappTab, openWhatsappChatId,
  insightsEnabled, workspaceId, onOpenNote,
  spotifyTrack, spotifyQueueTracks, spotifyPlaying, spotifyConnected, spotifyProgressMs, spotifyDurationMs,
  spotifyShuffle, spotifyRepeatMode,
  onSpotifyPrevious, onSpotifyTogglePlay, onSpotifyStop, onSpotifyNext, onSpotifySelectTrack, onSpotifyShuffle, onSpotifyCycleRepeat, onSpotifySeek, onOpenSpotifyTab,
  calendarEvents = [], calendarLoading, onOpenCalendarTab,
  booksEnabled, myBooks = [], onOpenBrowseBooks, onOpenMyBooks, onOpenBookReader,
}: RightPanelProps) {
  const [showAddModal, setShowAddModal] = useState(false);
  const [selectedItem, setSelectedItem] = useState<SuggestionItem | null>(null);
  const [showNoteReminders, setShowNoteReminders] = useState(false);
  const [showCalendar, setShowCalendar] = useState(false);
  const [showEmailReminders, setShowEmailReminders] = useState(false);
  const [selectedMailTab, setSelectedMailTab] = useState<"all" | number>("all");
  const [totalUnreadCount, setTotalUnreadCount] = useState(0);
  const [accountUnreadCounts, setAccountUnreadCounts] = useState<Record<number, number>>({});
  // Optimistic local overrides for account display names, keyed by account id.
  // The source of truth is `account.display_name` from the backend (refreshed via
  // getEmailStatus on load); this just avoids waiting on a refetch after saving.
  const [accountLabelOverrides, setAccountLabelOverrides] = useState<Record<number, string | null>>({});
  const [editingAccountTabId, setEditingAccountTabId] = useState<number | null>(null);
  const [editingAccountLabel, setEditingAccountLabel] = useState("");
  const [showSpotifyList, setShowSpotifyList] = useState(false);
  const [showBooks, setShowBooks] = useState(false);

  const [sectionOrder, setSectionOrder] = useState<PanelSectionKey[]>(loadSectionOrder);
  const sectionDragRef = useRef<PanelSectionKey | null>(null);
  const [sectionDragOver, setSectionDragOver] = useState<PanelSectionKey | null>(null);

  useEffect(() => {
    localStorage.setItem(SECTION_ORDER_STORAGE_KEY, JSON.stringify(sectionOrder));
  }, [sectionOrder]);

  function handleSectionDragStart(key: PanelSectionKey) {
    sectionDragRef.current = key;
  }

  function handleSectionDragEnd() {
    sectionDragRef.current = null;
    setSectionDragOver(null);
  }

  function handleSectionDrop(targetKey: PanelSectionKey) {
    const sourceKey = sectionDragRef.current;
    sectionDragRef.current = null;
    setSectionDragOver(null);
    if (!sourceKey || sourceKey === targetKey) return;
    setSectionOrder((prev) => {
      const next = prev.filter((k) => k !== sourceKey);
      next.splice(next.indexOf(targetKey), 0, sourceKey);
      return next;
    });
  }

  function handleAccountUnreadCountChange(accountId: number, count: number) {
    setAccountUnreadCounts((prev) => (prev[accountId] === count ? prev : { ...prev, [accountId]: count }));
  }

  function getAccountLabel(account: EmailAccount): string {
    const override = accountLabelOverrides[account.id];
    if (override !== undefined) return override || account.email;
    return account.display_name || account.email;
  }

  function commitAccountLabel(accountId: number, value: string) {
    const trimmed = value.trim();
    setEditingAccountTabId(null);
    setAccountLabelOverrides((prev) => ({ ...prev, [accountId]: trimmed || null }));
    updateEmailAccountDisplayName(accountId, trimmed || null).catch(() => {
      setAccountLabelOverrides((prev) => {
        const next = { ...prev };
        delete next[accountId];
        return next;
      });
    });
  }
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

  // WhatsApp state
  const [showWhatsapp, setShowWhatsapp] = useState(false);
  const [waChats, setWaChats] = useState<WhatsappChat[]>([]);
  const [waChatsLoading, setWaChatsLoading] = useState(false);
  const [waError, setWaError] = useState<string | null>(null);
  const [waAvatarCache, setWaAvatarCache] = useState<Map<string, string | null>>(new Map());
  const [waSyncComplete, setWaSyncComplete] = useState(true);
  const [waSyncProgress, setWaSyncProgress] = useState<number | null>(null);

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

  const loadWaChats = useCallback(async () => {
    setWaChatsLoading(true);
    setWaError(null);
    try {
      const chats = await listWhatsappChats();
      setWaChats(chats);
      setWaAvatarCache((prev) => {
        const liveIds = new Set(chats.map((chat) => chat.id));
        const next = new Map<string, string | null>();
        for (const [chatId, url] of prev) {
          if (liveIds.has(chatId) && url) next.set(chatId, url);
        }
        return next;
      });
    } catch {
      setWaError("Could not load WhatsApp chats.");
    } finally { setWaChatsLoading(false); }
  }, []);

  useEffect(() => {
    if (!open || !whatsappConnected) return;
    setWaSyncComplete(true);
    setWaSyncProgress(null);
    loadWaChats();
    // Re-fetch while WhatsApp's full history sync is still in progress, so
    // chats/groups that arrive late aren't silently missing from the list.
    let n = 0;
    let cancelled = false;
    const poll = setInterval(async () => {
      n++;
      loadWaChats();
      try {
        const status = await getWhatsappStatus();
        if (cancelled) return;
        // Some accounts never flip the bridge's "complete" flag even once
        // progress visibly hits 100%, so treat that as done here too.
        const complete = (status.historySyncComplete ?? true) || status.historySyncProgress === 100;
        setWaSyncComplete(complete);
        setWaSyncProgress(status.historySyncProgress ?? null);
        if (complete) { clearInterval(poll); return; }
      } catch { /* ignore, keep polling */ }
      if (n >= 40) clearInterval(poll); // stop after ~2 min even if still syncing
    }, 3000);
    return () => { cancelled = true; clearInterval(poll); };
  }, [open, whatsappConnected]);

  useEffect(() => {
    if (!showWhatsapp || waChats.length === 0) return;
    const missing = waChats.filter((chat) => !waAvatarCache.has(chat.id)).slice(0, 12);
    if (missing.length === 0) return;

    let cancelled = false;
    (async () => {
      const entries = await Promise.all(
        missing.map(async (chat) => [chat.id, await getWhatsappProfilePicture(chat.id)] as const)
      );
      if (cancelled) return;
      setWaAvatarCache((prev) => {
        const next = new Map(prev);
        for (const [chatId, url] of entries) next.set(chatId, url);
        return next;
      });
    })();

    return () => { cancelled = true; };
  }, [showWhatsapp, waChats, waAvatarCache]);

  function handleOpenWaChat(chat: WhatsappChat) {
    onOpenWhatsappTab?.(chat);
  }

  if (!open) return null;

  const _d = new Date();

  const today = `${_d.getFullYear()}-${String(_d.getMonth() + 1).padStart(2, "0")}-${String(_d.getDate()).padStart(2, "0")}`;
  const doneCount = items.filter((i) => i.done).length;

  const noteItems = items.filter((i) => !i.email_record_id);

  const hasEmail = emailConnected || emailAccounts.length > 0;

  const todayCalendarEvents = calendarEvents.filter((e) => e.occurrence_date === today);
  const upcomingCalendarEvents = calendarEvents
    .filter((e) => e.occurrence_date >= today && !e.done)
    .sort((a, b) => a.occurrence_date.localeCompare(b.occurrence_date) || (a.due_time ?? "").localeCompare(b.due_time ?? ""))
    .slice(0, 3);

  function waInitials(name: string): string {
    const clean = (name || "?").replace(/^\+/, "").trim();
    const parts = clean.split(/\s+/).filter(Boolean);
    if (parts.length >= 2) return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
    return clean.slice(0, 2).toUpperCase();
  }

  function renderWaAvatar(chat: WhatsappChat, sizeClass = "h-7 w-7") {
    const avatarUrl = waAvatarCache.get(chat.id) ?? chat.avatarUrl ?? null;
    if (avatarUrl) {
      return (
        <img
          src={avatarUrl}
          alt=""
          onError={() => setWaAvatarCache((prev) => {
            const next = new Map(prev);
            next.set(chat.id, null);
            return next;
          })}
          className={`${sizeClass} shrink-0 rounded-full object-cover border border-green-500/20 bg-[var(--ml-bg-hover)]`}
        />
      );
    }
    return (
      <div className={`${sizeClass} shrink-0 rounded-full border border-green-500/20 bg-green-500/10 text-[10px] font-semibold text-green-300 flex items-center justify-center`}>
        {waInitials(chat.name)}
      </div>
    );
  }

  function mailNavButtonClass(active: boolean) {
    return `w-full text-center text-[11px] py-1.5 px-2.5 rounded-lg border transition ${
      active
        ? "border-indigo-500/40 text-indigo-300 bg-indigo-600/10"
        : "border-[var(--ml-bg-hover)] text-gray-400 hover:text-indigo-300 hover:border-indigo-500/30"
    }`;
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
      <div
        draggable
        onDragStart={() => handleSectionDragStart("reminders")}
        onDragOver={(e) => { e.preventDefault(); if (sectionDragOver !== "reminders") setSectionDragOver("reminders"); }}
        onDrop={(e) => { e.preventDefault(); handleSectionDrop("reminders"); }}
        onDragEnd={handleSectionDragEnd}
        style={{ order: sectionOrder.indexOf("reminders") }}
        className={`border-b border-[var(--ml-bg-panel)] cursor-grab active:cursor-grabbing ${sectionDragOver === "reminders" ? "ring-1 ring-inset ring-indigo-500/50 bg-indigo-500/5" : ""}`}
      >
        <button
          onClick={() => setShowNoteReminders((v) => !v)}
          className="w-full flex items-center justify-between px-4 py-2.5 hover:bg-[#1a1a24] transition text-left"
        >
          <div className="flex items-center gap-2">
            <SectionDragHandle />
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

      {/* ── Section 1.5: Calendar ── */}
      {onOpenCalendarTab && (
        <div
          draggable
          onDragStart={() => handleSectionDragStart("calendar")}
          onDragOver={(e) => { e.preventDefault(); if (sectionDragOver !== "calendar") setSectionDragOver("calendar"); }}
          onDrop={(e) => { e.preventDefault(); handleSectionDrop("calendar"); }}
          onDragEnd={handleSectionDragEnd}
          style={{ order: sectionOrder.indexOf("calendar") }}
          className={`border-b border-[var(--ml-bg-panel)] cursor-grab active:cursor-grabbing ${sectionDragOver === "calendar" ? "ring-1 ring-inset ring-indigo-500/50 bg-indigo-500/5" : ""}`}
        >
          <button
            onClick={() => setShowCalendar((v) => !v)}
            className="w-full flex items-center justify-between px-4 py-2.5 hover:bg-[#1a1a24] transition text-left"
          >
            <div className="flex items-center gap-2">
              <SectionDragHandle />
              <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5 text-indigo-400 shrink-0" fill="currentColor" viewBox="0 0 16 16">
                <path d="M3.5 0a.5.5 0 0 1 .5.5V1h8V.5a.5.5 0 0 1 1 0V1h1a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H2a2 2 0 0 1-2-2V3a2 2 0 0 1 2-2h1V.5a.5.5 0 0 1 .5-.5M1 4v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V4z"/>
              </svg>
              <span className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider">Calendar</span>
              {todayCalendarEvents.length > 0 && (
                <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-indigo-500/20 text-indigo-400">
                  {todayCalendarEvents.length}
                </span>
              )}
              {calendarLoading && (
                <svg className="w-3 h-3 animate-spin text-gray-600" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/></svg>
              )}
            </div>
            <div className="flex items-center gap-1">
              <button
                onClick={(e) => { e.stopPropagation(); onOpenCalendarTab(); }}
                title="Open Calendar"
                className="w-5 h-5 flex items-center justify-center rounded-md text-gray-600 hover:text-indigo-400 hover:bg-[var(--ml-bg-hover)] transition shrink-0"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 8V6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-2m8-5h8m-4-4v8" />
                </svg>
              </button>
              <svg xmlns="http://www.w3.org/2000/svg" className={`w-3 h-3 text-gray-600 transition-transform ${showCalendar ? "" : "-rotate-90"}`} fill="currentColor" viewBox="0 0 16 16">
                <path d="M7.247 11.14 2.451 5.658C1.885 5.013 2.345 4 3.204 4h9.592a1 1 0 0 1 .753 1.659l-4.796 5.48a1 1 0 0 1-1.506 0z"/>
              </svg>
            </div>
          </button>

          {showCalendar && (
            <div className="px-4 pb-3">
              {upcomingCalendarEvents.length === 0 ? (
                <p className="text-[11px] text-gray-600 text-center pt-1">No upcoming events.</p>
              ) : (
                <div className="flex flex-col gap-1">
                  {upcomingCalendarEvents.map((ev) => (
                    <button
                      key={`${ev.reminder_id}-${ev.occurrence_date}`}
                      onClick={onOpenCalendarTab}
                      className="w-full flex items-center gap-2 text-left px-2 py-1 rounded-lg hover:bg-[#1a1a24] transition"
                    >
                      <span className={`text-[10px] shrink-0 w-12 ${ev.occurrence_date === today ? "text-indigo-400" : "text-gray-600"}`}>
                        {ev.occurrence_date === today ? "Today" : ev.occurrence_date.slice(5)}
                      </span>
                      <span className="text-[11px] text-gray-300 truncate">{ev.text}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── Section 2: Email (shown when connected or records exist) ── */}
      {hasEmail && (
        <div
          draggable
          onDragStart={() => handleSectionDragStart("email")}
          onDragOver={(e) => { e.preventDefault(); if (sectionDragOver !== "email") setSectionDragOver("email"); }}
          onDrop={(e) => { e.preventDefault(); handleSectionDrop("email"); }}
          onDragEnd={handleSectionDragEnd}
          style={{ order: sectionOrder.indexOf("email") }}
          className={`border-b border-[var(--ml-bg-panel)] cursor-grab active:cursor-grabbing ${sectionDragOver === "email" ? "ring-1 ring-inset ring-indigo-500/50 bg-indigo-500/5" : ""}`}
        >
          <button
            onClick={() => setShowEmailReminders((v) => !v)}
            className="w-full flex items-center justify-between px-4 py-2.5 hover:bg-[#1a1a24] transition text-left"
          >
            <div className="flex items-center gap-2">
              <SectionDragHandle />
              <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5 text-blue-400 shrink-0" fill="currentColor" viewBox="0 0 16 16">
                <path d="M0 4a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H2a2 2 0 0 1-2-2zm2-1a1 1 0 0 0-1 1v.217l7 4.2 7-4.2V4a1 1 0 0 0-1-1zm13 2.383-4.708 2.825L15 11.105zm-.034 6.876-5.64-3.471L8 9.583l-1.326-.795-5.64 3.47A1 1 0 0 0 2 13h12a1 1 0 0 0 .966-.741M1 11.105l4.708-2.897L1 5.383z"/>
              </svg>
              <span className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider">Email</span>
              {totalUnreadCount > 0 && (
                <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-indigo-600/30 text-indigo-300">
                  {totalUnreadCount}
                </span>
              )}
            </div>
            <svg xmlns="http://www.w3.org/2000/svg" className={`w-3 h-3 text-gray-600 transition-transform ${showEmailReminders ? "" : "-rotate-90"}`} fill="currentColor" viewBox="0 0 16 16">
              <path d="M7.247 11.14 2.451 5.658C1.885 5.013 2.345 4 3.204 4h9.592a1 1 0 0 1 .753 1.659l-4.796 5.48a1 1 0 0 1-1.506 0z"/>
            </svg>
          </button>

          {showEmailReminders && (
            <div className="px-3 pb-3 flex flex-col gap-2">
              {emailAccounts.length === 0 ? (
                <p className="text-[11px] text-gray-600 text-center pt-1">No email accounts connected.</p>
              ) : (
                <>
                  {/* Mail/Calendar nav — vertical list of "Load more"-style buttons */}
                  <div className="flex flex-col gap-1">
                    <button
                      onClick={() => onComposeNewMail?.()}
                      className="w-full flex items-center justify-center gap-1.5 text-[11px] font-medium py-1.5 rounded-lg border border-indigo-500/25 text-indigo-300 bg-indigo-600/10 hover:bg-indigo-600/20 transition"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" className="w-3 h-3" fill="currentColor" viewBox="0 0 16 16">
                        <path d="M12.146.146a.5.5 0 0 1 .708 0l3 3a.5.5 0 0 1 0 .708l-10 10a.5.5 0 0 1-.168.11l-5 2a.5.5 0 0 1-.65-.65l2-5a.5.5 0 0 1 .11-.168zM11.207 2.5 13.5 4.793 14.793 3.5 12.5 1.207zM9.5 2.207 12.793 5.5 11.5 6.793 8.207 3.5z"/>
                      </svg>
                      New Mail
                    </button>
                    <button onClick={() => setSelectedMailTab("all")} className={`${mailNavButtonClass(selectedMailTab === "all")} flex items-center justify-center gap-1.5`}>
                      All Mail
                      {totalUnreadCount > 0 && (
                        <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-indigo-600/30 text-indigo-300">
                          {totalUnreadCount}
                        </span>
                      )}
                    </button>
                    {emailAccounts.map((account) => (
                      <button
                        key={account.id}
                        onClick={() => setSelectedMailTab(account.id)}
                        onDoubleClick={(e) => {
                          e.stopPropagation();
                          setSelectedMailTab(account.id);
                          setEditingAccountTabId(account.id);
                          setEditingAccountLabel(getAccountLabel(account));
                        }}
                        title={account.email}
                        className={`${mailNavButtonClass(selectedMailTab === account.id)} flex items-center justify-center gap-1.5`}
                      >
                        {editingAccountTabId === account.id ? (
                          <input
                            autoFocus
                            value={editingAccountLabel}
                            onChange={(e) => setEditingAccountLabel(e.target.value)}
                            onBlur={() => commitAccountLabel(account.id, editingAccountLabel)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") {
                                e.preventDefault();
                                commitAccountLabel(account.id, editingAccountLabel);
                              }
                              if (e.key === "Escape") {
                                e.preventDefault();
                                setEditingAccountTabId(null);
                              }
                            }}
                            onClick={(e) => e.stopPropagation()}
                            className="max-w-[140px] bg-transparent border-b border-indigo-400 outline-none text-white text-[11px] text-center"
                          />
                        ) : (
                          <span className="truncate max-w-[140px]">{getAccountLabel(account)}</span>
                        )}
                        {!!accountUnreadCounts[account.id] && (
                          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-indigo-600/30 text-indigo-300 shrink-0">
                            {accountUnreadCounts[account.id]}
                          </span>
                        )}
                      </button>
                    ))}
                  </div>

                  {/* All sub-views stay mounted (hidden via CSS, not unmounted) so switching
                      tabs never re-triggers a Gmail fetch — only the first load per view does. */}
                  <div className="flex flex-col gap-1.5 min-h-[2rem]">
                    <div style={{ display: selectedMailTab === "all" ? "block" : "none" }}>
                      {onOpenEmailTab && (
                        <EmailAllMailList
                          onOpenEmail={onOpenEmailTab}
                          selectedGmailMessageId={openEmailTabId}
                          onEmailArchived={onEmailArchived}
                          onEmailTrashed={onEmailTrashed}
                          onPinChanged={onEmailPinChanged}
                          onUnreadCountChange={setTotalUnreadCount}
                        />
                      )}
                    </div>

                    {emailAccounts.map((account) => (
                      <div key={account.id} style={{ display: selectedMailTab === account.id ? "block" : "none" }}>
                        {onOpenEmailTab && (
                          <EmailFolderBrowser
                            account={account}
                            onOpenEmail={onOpenEmailTab}
                            selectedGmailMessageId={openEmailTabId}
                            onEmailArchived={onEmailArchived}
                            onEmailTrashed={onEmailTrashed}
                            onPinChanged={onEmailPinChanged}
                            onUnreadCountChange={handleAccountUnreadCountChange}
                          />
                        )}
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── Section 3: Teams ── */}
      {teamsConnected && (
        <div
          draggable
          onDragStart={() => handleSectionDragStart("teams")}
          onDragOver={(e) => { e.preventDefault(); if (sectionDragOver !== "teams") setSectionDragOver("teams"); }}
          onDrop={(e) => { e.preventDefault(); handleSectionDrop("teams"); }}
          onDragEnd={handleSectionDragEnd}
          style={{ order: sectionOrder.indexOf("teams") }}
          className={`border-b border-[var(--ml-bg-panel)] cursor-grab active:cursor-grabbing ${sectionDragOver === "teams" ? "ring-1 ring-inset ring-indigo-500/50 bg-indigo-500/5" : ""}`}
        >
          <button
            onClick={() => setShowTeams((v) => !v)}
            className="w-full flex items-center justify-between px-4 py-2.5 hover:bg-[#1a1a24] transition text-left"
          >
            <div className="flex items-center gap-2">
              <SectionDragHandle />
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

      {/* ── Section 4: WhatsApp ── */}
      {whatsappConnected && whatsappAvailable && (
        <div
          draggable
          onDragStart={() => handleSectionDragStart("whatsapp")}
          onDragOver={(e) => { e.preventDefault(); if (sectionDragOver !== "whatsapp") setSectionDragOver("whatsapp"); }}
          onDrop={(e) => { e.preventDefault(); handleSectionDrop("whatsapp"); }}
          onDragEnd={handleSectionDragEnd}
          style={{ order: sectionOrder.indexOf("whatsapp") }}
          className={`border-b border-[var(--ml-bg-panel)] cursor-grab active:cursor-grabbing ${sectionDragOver === "whatsapp" ? "ring-1 ring-inset ring-indigo-500/50 bg-indigo-500/5" : ""}`}
        >
          <button
            onClick={() => setShowWhatsapp((v) => !v)}
            className="w-full flex items-center justify-between px-4 py-2.5 hover:bg-[#1a1a24] transition text-left"
          >
            <div className="flex items-center gap-2">
              <SectionDragHandle />
              <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5 text-green-400 shrink-0" fill="currentColor" viewBox="0 0 16 16">
                <path d="M13.601 2.326A7.85 7.85 0 0 0 7.994 0C3.627 0 .068 3.558.064 7.926c0 1.399.366 2.76 1.057 3.965L0 16l4.204-1.102a7.9 7.9 0 0 0 3.79.965h.004c4.368 0 7.926-3.558 7.93-7.93A7.9 7.9 0 0 0 13.6 2.326zM7.994 14.521a6.6 6.6 0 0 1-3.356-.92l-.24-.144-2.494.654.666-2.433-.156-.251a6.56 6.56 0 0 1-1.007-3.505c0-3.626 2.957-6.584 6.591-6.584a6.56 6.56 0 0 1 4.66 1.931 6.56 6.56 0 0 1 1.928 4.66c-.004 3.639-2.961 6.592-6.592 6.592m3.615-4.934c-.197-.099-1.17-.578-1.353-.646-.182-.065-.315-.099-.445.099-.133.197-.513.646-.627.775-.114.133-.232.148-.43.05-.197-.1-.836-.308-1.592-.985-.59-.525-.985-1.175-1.103-1.372-.114-.198-.011-.304.088-.403.087-.088.197-.232.296-.346.1-.114.133-.198.198-.33.065-.134.034-.248-.015-.347-.05-.099-.445-1.076-.612-1.47-.16-.389-.323-.335-.445-.34-.114-.007-.247-.007-.38-.007a.73.73 0 0 0-.529.247c-.182.198-.691.677-.691 1.654s.71 1.916.81 2.049c.098.133 1.394 2.132 3.383 2.992.47.205.84.326 1.129.418.475.152.904.129 1.246.08.38-.058 1.171-.48 1.338-.943.164-.464.164-.86.114-.943-.049-.084-.182-.133-.38-.232"/>
              </svg>
              <span className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider">WhatsApp</span>
              {waChats.length > 0 && (
                <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-green-500/20 text-green-400">
                  {waChats.length}
                </span>
              )}
            </div>
            <svg xmlns="http://www.w3.org/2000/svg" className={`w-3 h-3 text-gray-600 transition-transform ${showWhatsapp ? "" : "-rotate-90"}`} fill="currentColor" viewBox="0 0 16 16">
              <path d="M7.247 11.14 2.451 5.658C1.885 5.013 2.345 4 3.204 4h9.592a1 1 0 0 1 .753 1.659l-4.796 5.48a1 1 0 0 1-1.506 0z"/>
            </svg>
          </button>

          {showWhatsapp && (
            <div className="px-3 pb-3 flex flex-col gap-2">
              {waError && (
                <div className="rounded-lg border border-red-500/20 bg-red-500/10 px-2.5 py-2 text-[11px] text-red-300">
                  {waError}
                </div>
              )}

              {!waSyncComplete && (
                <div className="flex items-center gap-1.5 rounded-lg border border-green-500/15 bg-green-500/5 px-2.5 py-2 text-[11px] text-green-300/80">
                  <svg className="w-3 h-3 animate-spin shrink-0" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/></svg>
                  Still syncing chat history{waSyncProgress != null ? ` (${waSyncProgress}%)` : ""} — some chats or groups may not be visible yet.
                </div>
              )}

              <button
                onClick={loadWaChats}
                disabled={waChatsLoading}
                className="w-full flex items-center justify-center gap-1.5 px-3 py-1.5 text-[11px] text-green-400 hover:text-green-300 border border-green-500/20 hover:border-green-500/40 rounded-lg hover:bg-green-500/5 transition disabled:opacity-40"
              >
                {waChatsLoading
                  ? <><svg className="w-3 h-3 animate-spin shrink-0" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/></svg>Loading…</>
                  : <>↻ Refresh chats ({waChats.length})</>}
              </button>

              {waChats.length === 0 && !waChatsLoading && (
                <p className="text-[11px] text-gray-600 text-center pt-1">
                  {waError ?? "No chats yet — send a WhatsApp message to populate."}
                </p>
              )}
              {waChats.map((chat) => {
                const isGroup = chat.id.endsWith("@g.us");
                const phoneNum = !isGroup ? `+${chat.id.replace("@s.whatsapp.net", "")}` : null;
                const showNum = phoneNum && phoneNum !== `+${chat.name}`;
                const isActive = openWhatsappChatId === chat.id;
                return (
                  <button
                    key={chat.id}
                    onClick={() => handleOpenWaChat(chat)}
                    className={`w-full text-left px-2.5 py-2 bg-[#1a1a24] border rounded-xl transition shadow-sm shadow-black/30 ${
                      isActive ? "border-green-500/50" : "border-[var(--ml-bg-hover)] hover:border-green-500/30"
                    }`}
                  >
                    <div className="flex items-start gap-2 min-w-0">
                      {renderWaAvatar(chat)}
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5 min-w-0">
                          <p className="text-[11px] text-gray-200 font-medium truncate flex-1">{chat.name}</p>
                          {isGroup && (
                            <span className="text-[9px] text-green-600 shrink-0">group</span>
                          )}
                        </div>
                        {showNum && (
                          <p className="text-[10px] text-gray-600 truncate mt-0.5">{phoneNum}</p>
                        )}
                        {chat.lastMessage && (
                          <p className="text-[10px] text-gray-600 truncate mt-0.5 opacity-70">{chat.lastMessage}</p>
                        )}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ── Section 4.5: Books ── */}
      {booksEnabled && (
        <div
          draggable
          onDragStart={() => handleSectionDragStart("books")}
          onDragOver={(e) => { e.preventDefault(); if (sectionDragOver !== "books") setSectionDragOver("books"); }}
          onDrop={(e) => { e.preventDefault(); handleSectionDrop("books"); }}
          onDragEnd={handleSectionDragEnd}
          style={{ order: sectionOrder.indexOf("books") }}
          className={`border-b border-[var(--ml-bg-panel)] cursor-grab active:cursor-grabbing ${sectionDragOver === "books" ? "ring-1 ring-inset ring-indigo-500/50 bg-indigo-500/5" : ""}`}
        >
          <button
            onClick={() => setShowBooks((v) => !v)}
            className="w-full flex items-center justify-between px-4 py-2.5 hover:bg-[#1a1a24] transition text-left"
          >
            <div className="flex items-center gap-2">
              <SectionDragHandle />
              <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5 text-indigo-400 shrink-0" fill="currentColor" viewBox="0 0 16 16">
                <path d="M1 2.828c.885-.37 2.154-.769 3.388-.893 1.33-.134 2.458.063 3.112.752v9.746c-.935-.53-2.12-.603-3.213-.493-1.18.12-2.37.461-3.287.811zm7.5-.141c.654-.689 1.782-.886 3.112-.752 1.234.124 2.503.523 3.388.893v9.923c-.918-.35-2.107-.692-3.287-.81-1.094-.111-2.278-.039-3.213.492z"/>
              </svg>
              <span className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider">Books</span>
              {myBooks.length > 0 && (
                <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-indigo-500/20 text-indigo-400">
                  {myBooks.length}
                </span>
              )}
            </div>
            <svg xmlns="http://www.w3.org/2000/svg" className={`w-3 h-3 text-gray-600 transition-transform ${showBooks ? "" : "-rotate-90"}`} fill="currentColor" viewBox="0 0 16 16">
              <path d="M7.247 11.14 2.451 5.658C1.885 5.013 2.345 4 3.204 4h9.592a1 1 0 0 1 .753 1.659l-4.796 5.48a1 1 0 0 1-1.506 0z"/>
            </svg>
          </button>

          {showBooks && (
            <div className="px-4 pb-3 flex flex-col gap-2">
              <div className="flex gap-2">
                <button
                  onClick={onOpenBrowseBooks}
                  className="flex-1 px-2.5 py-1.5 text-[11px] rounded-lg bg-indigo-600/20 text-indigo-300 hover:bg-indigo-600/30 transition"
                >
                  Browse Books
                </button>
                <button
                  onClick={onOpenMyBooks}
                  className="flex-1 px-2.5 py-1.5 text-[11px] rounded-lg text-gray-400 border border-[var(--ml-bg-hover)] hover:bg-[var(--ml-bg-hover)] transition"
                >
                  My Books
                </button>
              </div>

              {myBooks.filter((ub) => ub.current_page > 0).length > 0 && (
                <div className="flex flex-col gap-1 mt-1">
                  <span className="text-[10px] text-gray-600 uppercase tracking-wider px-0.5">Continue Reading</span>
                  {myBooks
                    .filter((ub) => ub.current_page > 0)
                    .sort((a, b) => (b.last_read_at ?? "").localeCompare(a.last_read_at ?? ""))
                    .slice(0, 4)
                    .map((ub) => (
                      <button
                        key={ub.id}
                        onClick={() => onOpenBookReader?.(ub.book_id)}
                        className="w-full flex items-center gap-2 text-left px-2 py-1 rounded-lg hover:bg-[#1a1a24] transition"
                      >
                        <span className="text-[11px] text-gray-300 truncate flex-1">{ub.book?.title ?? `Book #${ub.book_id}`}</span>
                        <span className="text-[10px] text-gray-600 shrink-0">{Math.round(ub.progress_percent)}%</span>
                      </button>
                    ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── Section 5: AI Insights (always last, not reorderable) ── */}
      {insightsEnabled && (
        <div style={{ order: 99 }}>
          <InsightsPanel
            workspaceId={workspaceId ?? null}
            onOpenNote={onOpenNote}
          />
        </div>
      )}

      </div>{/* end scrollable body */}

      {/* Footer: clear done - pinned above the media controls */}
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

      {spotifyConnected && (
        <SpotifyMiniPlayer
          track={spotifyTrack}
          queueTracks={spotifyQueueTracks}
          isPlaying={spotifyPlaying}
          progressMs={spotifyProgressMs}
          durationMs={spotifyDurationMs}
          showList={showSpotifyList}
          shuffle={spotifyShuffle}
          repeatMode={spotifyRepeatMode}
          onPrevious={onSpotifyPrevious}
          onTogglePlay={onSpotifyTogglePlay}
          onStop={onSpotifyStop}
          onNext={onSpotifyNext}
          onSelectTrack={onSpotifySelectTrack}
          onToggleShuffle={() => onSpotifyShuffle(!spotifyShuffle)}
          onCycleRepeat={onSpotifyCycleRepeat}
          onSeek={onSpotifySeek}
          onToggleList={() => setShowSpotifyList((v) => !v)}
          onOpenFull={onOpenSpotifyTab}
        />
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

    </div>
    </>
  );
}
