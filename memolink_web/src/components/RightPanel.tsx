import React, { useState, useEffect, useCallback } from "react";
import type { SuggestionItem } from "../hooks/useSuggestions";
import { ReminderDetailModal } from "./ReminderDetailModal";
import { AddReminderModal } from "./AddReminderModal";
import { buildGoogleCalendarUrl } from "../utils/reminderUtils";
import { InsightsPanel } from "./InsightsPanel";
import { listTeamsChats, getTeamsMessages, sendTeamsMessage, chatToNote } from "../api/teamsApi";
import type { TeamsChat, TeamsMessage } from "../api/teamsApi";
import type { EmailAccount, BrowseEmailResult } from "../api/emailApi";
import { updateEmailAccountDisplayName } from "../api/emailApi";
import { EmailFolderBrowser } from "./EmailFolderBrowser";
import { EmailAllMailList } from "./EmailAllMailList";
import { listWhatsappChats, getWhatsappMessages, getWhatsappProfilePicture, sendWhatsappMessage, deleteWhatsappMessage, deleteWhatsappChat, suggestWhatsappReply, getWhatsappMedia } from "../api/whatsappApi";
import type { WhatsappChat, WhatsappMessage } from "../api/whatsappApi";
import { SpotifyMiniPlayer } from "./SpotifyPlayer";
import type { SpotifyApiTrack, SpotifyRepeatMode } from "../api/connectorsApi";

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
  insightsEnabled, workspaceId, onOpenNote,
  spotifyTrack, spotifyQueueTracks, spotifyPlaying, spotifyConnected, spotifyProgressMs, spotifyDurationMs,
  spotifyShuffle, spotifyRepeatMode,
  onSpotifyPrevious, onSpotifyTogglePlay, onSpotifyStop, onSpotifyNext, onSpotifySelectTrack, onSpotifyShuffle, onSpotifyCycleRepeat, onSpotifySeek, onOpenSpotifyTab,
}: RightPanelProps) {
  const [showAddModal, setShowAddModal] = useState(false);
  const [selectedItem, setSelectedItem] = useState<SuggestionItem | null>(null);
  const [showNoteReminders, setShowNoteReminders] = useState(false);
  const [showEmailReminders, setShowEmailReminders] = useState(false);
  const [selectedMailTab, setSelectedMailTab] = useState<"all" | number | "calendar">("all");
  const [totalUnreadCount, setTotalUnreadCount] = useState(0);
  const [accountUnreadCounts, setAccountUnreadCounts] = useState<Record<number, number>>({});
  // Optimistic local overrides for account display names, keyed by account id.
  // The source of truth is `account.display_name` from the backend (refreshed via
  // getEmailStatus on load); this just avoids waiting on a refetch after saving.
  const [accountLabelOverrides, setAccountLabelOverrides] = useState<Record<number, string | null>>({});
  const [editingAccountTabId, setEditingAccountTabId] = useState<number | null>(null);
  const [editingAccountLabel, setEditingAccountLabel] = useState("");
  const [showSpotifyList, setShowSpotifyList] = useState(false);

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
  const [selectedWaChat, setSelectedWaChat] = useState<WhatsappChat | null>(null);
  const [waMessages, setWaMessages] = useState<WhatsappMessage[]>([]);
  const [waMsgTotal, setWaMsgTotal] = useState(0);
  const [waMsgOffset, setWaMsgOffset] = useState(0);
  const [waMsgLoading, setWaMsgLoading] = useState(false);
  const [waOlderLoading, setWaOlderLoading] = useState(false);
  const [waReply, setWaReply] = useState("");
  const [waSending, setWaSending] = useState(false);
  const [waSuggestions, setWaSuggestions] = useState<string[]>([]);
  const [waSuggestLoading, setWaSuggestLoading] = useState(false);
  const [waError, setWaError] = useState<string | null>(null);
  const [waMediaCache, setWaMediaCache] = useState<Map<string, string>>(new Map());
  const [waAvatarCache, setWaAvatarCache] = useState<Map<string, string | null>>(new Map());
  const [waDeletingId, setWaDeletingId] = useState<string | null>(null);
  const [waDeletingChat, setWaDeletingChat] = useState(false);

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
    loadWaChats();
    // Re-fetch a few times to catch history that arrives after connection
    let n = 0;
    const poll = setInterval(() => {
      n++;
      loadWaChats();
      if (n >= 8) clearInterval(poll); // stop after ~24 s
    }, 3000);
    return () => clearInterval(poll);
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

  async function handleOpenWaChat(chat: WhatsappChat) {
    setSelectedWaChat(chat);
    setWaMessages([]);
    setWaMsgTotal(0);
    setWaMsgOffset(0);
    setWaSuggestions([]);
    setWaReply("");
    setWaError(null);
    setWaMsgLoading(true);
    try {
      const { messages, total } = await getWhatsappMessages(chat.id, 30, 0);
      setWaMessages(messages);
      setWaMsgTotal(total);
      setWaMsgOffset(0);
    } catch {
      setWaError("Could not load messages.");
    } finally { setWaMsgLoading(false); }
  }

  async function handleLoadOlderWaMessages() {
    if (!selectedWaChat) return;
    const nextOffset = waMsgOffset + 30;
    setWaOlderLoading(true);
    try {
      const { messages, total } = await getWhatsappMessages(selectedWaChat.id, 30, nextOffset);
      setWaMessages((prev) => [...messages, ...prev]);
      setWaMsgTotal(total);
      setWaMsgOffset(nextOffset);
    } catch { /* ignore */ } finally { setWaOlderLoading(false); }
  }

  async function handleSendWaReply() {
    if (!selectedWaChat || !waReply.trim()) return;
    setWaSending(true);
    try {
      await sendWhatsappMessage(selectedWaChat.id, waReply.trim());
      setWaReply("");
      const { messages, total } = await getWhatsappMessages(selectedWaChat.id, 30, 0);
      setWaMessages(messages);
      setWaMsgTotal(total);
      setWaMsgOffset(0);
    } catch { /* ignore */ } finally { setWaSending(false); }
  }

  async function handleDeleteWaMessage(message: WhatsappMessage) {
    if (!selectedWaChat || !message.fromMe || waDeletingId) return;
    if (!window.confirm("Delete this WhatsApp message for everyone?")) return;
    setWaDeletingId(message.id);
    setWaError(null);
    try {
      await deleteWhatsappMessage(selectedWaChat.id, message.id);
      setWaMessages((prev) => prev.filter((m) => m.id !== message.id));
      setWaMsgTotal((prev) => Math.max(0, prev - 1));
      setWaMediaCache((prev) => {
        const next = new Map(prev);
        next.delete(message.id);
        return next;
      });
    } catch (err: any) {
      setWaError(err?.response?.data?.detail ?? "Could not delete message.");
    } finally {
      setWaDeletingId(null);
    }
  }

  async function handleDeleteWaConversation() {
    if (!selectedWaChat || waDeletingChat) return;
    if (!window.confirm(`Delete the WhatsApp conversation with ${selectedWaChat.name}? This removes the chat from your WhatsApp account.`)) return;
    const chatId = selectedWaChat.id;
    setWaDeletingChat(true);
    setWaError(null);
    try {
      await deleteWhatsappChat(chatId);
      setWaChats((prev) => prev.filter((chat) => chat.id !== chatId));
      setSelectedWaChat(null);
      setWaMessages([]);
      setWaMsgTotal(0);
      setWaMsgOffset(0);
      setWaSuggestions([]);
      setWaReply("");
      setWaMediaCache((prev) => {
        const next = new Map(prev);
        for (const msg of waMessages) next.delete(msg.id);
        return next;
      });
    } catch (err: any) {
      setWaError(err?.response?.data?.detail ?? "Could not delete conversation.");
    } finally {
      setWaDeletingChat(false);
    }
  }

  async function handleWaSuggestReply() {
    if (!selectedWaChat) return;
    setWaSuggestLoading(true);
    setWaSuggestions([]);
    try {
      setWaSuggestions(await suggestWhatsappReply(selectedWaChat.id));
    } catch { /* ignore */ } finally { setWaSuggestLoading(false); }
  }

  if (!open) return null;

  const _d = new Date();

  const today = `${_d.getFullYear()}-${String(_d.getMonth() + 1).padStart(2, "0")}-${String(_d.getDate()).padStart(2, "0")}`;
  const doneCount = items.filter((i) => i.done).length;

  const noteItems = items.filter((i) => !i.email_record_id);

  const hasEmail = emailConnected || emailAccounts.length > 0;

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
                    <button onClick={() => setSelectedMailTab("calendar")} className={mailNavButtonClass(selectedMailTab === "calendar")}>
                      Calendar
                    </button>
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

                    <div style={{ display: selectedMailTab === "calendar" ? "block" : "none" }}>
                      <div className="rounded-lg px-2.5 py-3 flex items-center gap-2 text-gray-600">
                        <svg xmlns="http://www.w3.org/2000/svg" className="w-3 h-3 shrink-0" fill="currentColor" viewBox="0 0 16 16">
                          <path d="M3.5 0a.5.5 0 0 1 .5.5V1h8V.5a.5.5 0 0 1 1 0V1h1a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H2a2 2 0 0 1-2-2V3a2 2 0 0 1 2-2h1V.5a.5.5 0 0 1 .5-.5M1 4v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V4z"/>
                        </svg>
                        <span className="text-[11px]">Calendar — coming soon</span>
                      </div>
                    </div>
                  </div>
                </>
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

      {/* ── Section 4: WhatsApp ── */}
      {whatsappConnected && whatsappAvailable && (
        <div className="border-b border-[var(--ml-bg-panel)]">
          <button
            onClick={() => setShowWhatsapp((v) => !v)}
            className="w-full flex items-center justify-between px-4 py-2.5 hover:bg-[#1a1a24] transition text-left"
          >
            <div className="flex items-center gap-2">
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

              {!selectedWaChat && (
                <button
                  onClick={loadWaChats}
                  disabled={waChatsLoading}
                  className="w-full flex items-center justify-center gap-1.5 px-3 py-1.5 text-[11px] text-green-400 hover:text-green-300 border border-green-500/20 hover:border-green-500/40 rounded-lg hover:bg-green-500/5 transition disabled:opacity-40"
                >
                  {waChatsLoading
                    ? <><svg className="w-3 h-3 animate-spin shrink-0" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/></svg>Loading…</>
                    : <>↻ Refresh chats ({waChats.length})</>}
                </button>
              )}

              {selectedWaChat ? (
                <div className="bg-[var(--ml-bg-surface)] border border-[var(--ml-bg-hover)] rounded-xl overflow-hidden">
                  {/* Chat header */}
                  <div className="flex items-center justify-between px-3 py-2 border-b border-[var(--ml-bg-hover)]">
                    <button
                      onClick={() => { setSelectedWaChat(null); setWaSuggestions([]); setWaReply(""); }}
                      className="text-[11px] text-gray-500 hover:text-gray-300 transition"
                    >← Back</button>
                    <div className="flex items-center gap-2 min-w-0 max-w-[150px]">
                      {renderWaAvatar(selectedWaChat, "h-7 w-7")}
                      <div className="flex flex-col min-w-0">
                        <span className="text-[11px] text-gray-300 font-medium truncate w-full">{selectedWaChat.name}</span>
                        {!selectedWaChat.id.endsWith("@g.us") && (
                          <span className="text-[9px] text-gray-600 truncate w-full">+{selectedWaChat.id.replace("@s.whatsapp.net", "")}</span>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <button
                        onClick={handleWaSuggestReply}
                        disabled={waSuggestLoading || waDeletingChat}
                        className="text-[11px] text-green-400 hover:text-green-300 transition disabled:opacity-40"
                      >
                        {waSuggestLoading ? "…" : "✦ Suggest"}
                      </button>
                      <button
                        onClick={handleDeleteWaConversation}
                        disabled={waDeletingChat}
                        title="Delete conversation"
                        className="flex h-6 w-6 items-center justify-center rounded-md text-gray-600 transition hover:bg-red-500/10 hover:text-red-300 disabled:cursor-wait disabled:opacity-50"
                      >
                        {waDeletingChat ? (
                          <svg className="h-3 w-3 animate-spin" fill="none" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
                          </svg>
                        ) : (
                          <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" fill="currentColor" viewBox="0 0 16 16">
                            <path d="M5.5 5.5A.5.5 0 0 1 6 6v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5m2.5 0a.5.5 0 0 1 .5.5v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5m3 .5a.5.5 0 0 0-1 0v6a.5.5 0 0 0 1 0z"/>
                            <path d="M14.5 3a1 1 0 0 1-1 1H13v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V4h-.5a1 1 0 0 1 0-2H5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1h2.5a1 1 0 0 1 1 1M4.118 4 4 4.059V13a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V4.059L11.882 4zM2.5 3h11V2h-11z"/>
                          </svg>
                        )}
                      </button>
                    </div>
                  </div>

                  {/* Messages */}
                  <div className="px-3 py-2 max-h-52 overflow-y-auto space-y-2">
                    {/* Load older */}
                    {!waMsgLoading && waMessages.length > 0 && waMsgOffset + 30 < waMsgTotal && (
                      <button
                        onClick={handleLoadOlderWaMessages}
                        disabled={waOlderLoading}
                        className="w-full text-[10px] text-gray-500 hover:text-gray-300 py-1 border border-[var(--ml-bg-hover)] rounded-lg hover:bg-[var(--ml-bg-hover)] transition disabled:opacity-40"
                      >
                        {waOlderLoading ? "Loading…" : `↑ Load older messages (${waMsgTotal - waMessages.length} more)`}
                      </button>
                    )}
                    {waMsgLoading ? (
                      <p className="text-[11px] text-gray-600">Loading…</p>
                    ) : waMessages.length === 0 ? (
                      <p className="text-[11px] text-gray-600">No messages yet</p>
                    ) : waMessages.map((m) => {
                      const senderLabel = m.senderName || m.from || m.senderId || "Unknown";
                      const bubbleCls = m.fromMe
                        ? "bg-green-600/20 text-gray-200"
                        : "bg-[var(--ml-bg-hover)] text-gray-300";
                      const isPreviewableImage = m.mediaType === "image" || m.mediaType === "sticker";
                      const cachedImg = isPreviewableImage ? waMediaCache.get(m.id) : undefined;
                      return (
                        <div key={m.id} className={`flex flex-col ${m.fromMe ? "items-end" : "items-start"}`}>
                          {!m.fromMe && (
                            <p className="text-[10px] text-green-400 font-medium mb-0.5">{senderLabel}</p>
                          )}
                          <div className="group/message flex items-start gap-1 max-w-[90%]">
                          {m.fromMe && (
                            <button
                              onClick={() => handleDeleteWaMessage(m)}
                              disabled={waDeletingId === m.id}
                              title="Delete for everyone"
                              className="mt-1 flex h-5 w-5 shrink-0 items-center justify-center rounded-md text-gray-600 opacity-0 transition hover:bg-red-500/10 hover:text-red-300 group-hover/message:opacity-100 disabled:cursor-wait disabled:opacity-50"
                            >
                              {waDeletingId === m.id ? (
                                <svg className="h-3 w-3 animate-spin" fill="none" viewBox="0 0 24 24">
                                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
                                </svg>
                              ) : (
                                <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3" fill="currentColor" viewBox="0 0 16 16">
                                  <path d="M5.5 5.5A.5.5 0 0 1 6 6v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5m2.5 0a.5.5 0 0 1 .5.5v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5m3 .5a.5.5 0 0 0-1 0v6a.5.5 0 0 0 1 0z"/>
                                  <path d="M14.5 3a1 1 0 0 1-1 1H13v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V4h-.5a1 1 0 0 1 0-2H5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1h2.5a1 1 0 0 1 1 1M4.118 4 4 4.059V13a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V4.059L11.882 4zM2.5 3h11V2h-11z"/>
                                </svg>
                              )}
                            </button>
                          )}
                          <div className={`rounded-xl overflow-hidden ${bubbleCls}`}>
                            {isPreviewableImage ? (
                              cachedImg ? (
                                <img
                                  src={cachedImg}
                                  alt={m.mediaType === "sticker" ? "sticker" : "image"}
                                  className={m.mediaType === "sticker"
                                    ? "max-w-28 max-h-28 object-contain rounded-xl"
                                    : "max-w-full max-h-36 object-cover rounded-xl"}
                                />
                              ) : (
                                <button
                                  onClick={async () => {
                                    const result = await getWhatsappMedia(m.chatId, m.id);
                                    if (result?.data_url) {
                                      setWaMediaCache((prev) => new Map(prev).set(m.id, result.data_url));
                                    }
                                  }}
                                  className="flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] text-gray-400 hover:text-gray-200 transition"
                                >
                                  <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5 shrink-0" fill="currentColor" viewBox="0 0 16 16">
                                    <path d="M6.002 5.5a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0"/>
                                    <path d="M2.002 1a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V3a2 2 0 0 0-2-2zm12 1a1 1 0 0 1 1 1v6.5l-3.777-1.947a.5.5 0 0 0-.577.093l-3.71 3.71-2.66-1.772a.5.5 0 0 0-.63.062L1.002 12V3a1 1 0 0 1 1-1z"/>
                                  </svg>
                                  {m.mediaType === "sticker"
                                    ? "Tap to load sticker"
                                    : m.body !== "[image]" ? m.body : "Tap to load image"}
                                </button>
                              )
                            ) : m.mediaType === "audio" ? (
                              <div className="flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] text-gray-400">
                                <svg xmlns="http://www.w3.org/2000/svg" className="w-3 h-3" fill="currentColor" viewBox="0 0 16 16">
                                  <path d="M6 3a.5.5 0 0 1 .5.5v9a.5.5 0 0 1-1 0v-9A.5.5 0 0 1 6 3m2.5 2a.5.5 0 0 1 .5.5v5a.5.5 0 0 1-1 0v-5a.5.5 0 0 1 .5-.5M3 6.5a.5.5 0 0 1 1 0v3a.5.5 0 0 1-1 0zm6.5-.5a.5.5 0 0 1 .5.5v3a.5.5 0 0 1-1 0v-3a.5.5 0 0 1 .5-.5M1 8a.5.5 0 0 1 .5-.5h.5a.5.5 0 0 1 0 1h-.5A.5.5 0 0 1 1 8m11 0a.5.5 0 0 1 .5-.5h.5a.5.5 0 0 1 0 1h-.5A.5.5 0 0 1 12 8"/>
                                </svg>
                                Voice message
                              </div>
                            ) : m.mediaType === "video" || m.mediaType === "document" ? (
                              <div className="flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] text-gray-400">
                                <svg xmlns="http://www.w3.org/2000/svg" className="w-3 h-3 shrink-0" fill="currentColor" viewBox="0 0 16 16">
                                  <path d="M4 0h5.293A1 1 0 0 1 10 .293L13.707 4a1 1 0 0 1 .293.707V14a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V2a2 2 0 0 1 2-2m5.5 1.5v2a1 1 0 0 0 1 1h2z"/>
                                </svg>
                                {m.body}
                              </div>
                            ) : (
                              <p className="px-2.5 py-1.5 text-[11px] leading-snug">{m.body}</p>
                            )}
                          </div>
                          </div>
                          <p className="text-[9px] text-gray-700 mt-0.5 px-1">
                            {new Date(m.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                          </p>
                        </div>
                      );
                    })}
                  </div>

                  {/* AI Suggestions */}
                  {waSuggestions.length > 0 && (
                    <div className="px-3 pb-2 flex flex-col gap-1">
                      <p className="text-[10px] text-gray-600 mb-0.5">AI suggestions — tap to use:</p>
                      {waSuggestions.map((s, i) => (
                        <button
                          key={i}
                          onClick={() => setWaReply(s)}
                          className="text-left text-[11px] px-2.5 py-1.5 rounded-lg border border-green-500/20 bg-green-500/5 text-gray-300 hover:bg-green-500/15 hover:border-green-500/40 transition leading-snug"
                        >
                          {s}
                        </button>
                      ))}
                    </div>
                  )}

                  {/* Reply input */}
                  <div className="px-3 pb-2.5 flex gap-1.5">
                    <input
                      type="text"
                      value={waReply}
                      onChange={(e) => setWaReply(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter") handleSendWaReply(); }}
                      placeholder="Reply…"
                      className="flex-1 bg-[var(--ml-bg-base)] border border-[var(--ml-bg-hover)] rounded-lg px-2 py-1 text-[11px] text-gray-200 outline-none focus:border-green-500/50"
                    />
                    <button
                      onClick={handleSendWaReply}
                      disabled={waSending || !waReply.trim()}
                      className="px-2.5 py-1 text-[11px] bg-green-600/20 border border-green-500/30 text-green-300 rounded-lg hover:bg-green-600/30 disabled:opacity-40 transition"
                    >
                      {waSending ? "…" : "Send"}
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  {waChats.length === 0 && !waChatsLoading && (
                    <p className="text-[11px] text-gray-600 text-center pt-1">
                      {waError ?? "No chats yet — send a WhatsApp message to populate."}
                    </p>
                  )}
                  {waChats.map((chat) => {
                    const isGroup = chat.id.endsWith("@g.us");
                    const phoneNum = !isGroup ? `+${chat.id.replace("@s.whatsapp.net", "")}` : null;
                    const showNum = phoneNum && phoneNum !== `+${chat.name}`;
                    return (
                      <button
                        key={chat.id}
                        onClick={() => handleOpenWaChat(chat)}
                        className="w-full text-left px-2.5 py-2 bg-[#1a1a24] border border-[var(--ml-bg-hover)] rounded-xl hover:border-green-500/30 transition shadow-sm shadow-black/30"
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
                </>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── Section 5: AI Insights ── */}
      {insightsEnabled && (
        <InsightsPanel
          workspaceId={workspaceId ?? null}
          onOpenNote={onOpenNote}
        />
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
