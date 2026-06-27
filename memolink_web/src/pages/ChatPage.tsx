import React, { useCallback, useEffect, useRef, useState } from "react";
import { Capacitor } from "@capacitor/core";
import { saveUser, type User } from "../utils/auth";
import { useNotes } from "../hooks/useNotes";
import { useNoteEditor } from "../hooks/useNoteEditor";
import { useConversations } from "../hooks/useConversations";
import { useChat } from "../hooks/useChat";
import { addMessageToNoteAPI, deleteMessage } from "../api/conversationApi";
import { getNote, updateNote, setNotePublicAgentEnabled } from "../api/client";
import { Sidebar } from "../components/Sidebar";
import { NoteEditorView } from "../components/NoteEditorView";
import { RightPanel } from "../components/RightPanel";
import { SplitPane } from "../components/SplitPane";
import { RecycleBinModal } from "../components/RecycleBinModal";
import { MessageList } from "../components/MessageList";
import { ChatInput } from "../components/ChatInput";
import { RunningProcessBanner } from "../components/RunningProcessBanner";
import { DeleteModal } from "../components/DeleteModal";
import { SettingsModal } from "../components/SettingsModal";
import { EmailTabContent } from "../components/EmailTabContent";
import { EmailComposeTabContent } from "../components/EmailComposeTabContent";
import { EmailListTabContent } from "../components/EmailListTabContent";
import { useEmailTabs } from "../hooks/useEmailTabs";
import { WhatsappTabContent } from "../components/WhatsappTabContent";
import { useWhatsappTabs } from "../hooks/useWhatsappTabs";
import { archiveEmail, trashEmail, pinEmail, unpinEmail } from "../api/emailApi";
import { HelpModal } from "../components/HelpModal";
import { MemoGraphView } from "../components/MemoGraphModal";
import { SurveyModal } from "../components/SurveyModal";
import { useEvaluationHeartbeat } from "../hooks/useEvaluationHeartbeat";
import { getMyRatings } from "../api/evaluationApi";
import { FeedbackModal } from "../components/FeedbackModal";
import { TTSPlayerBar } from "../components/TTSPlayerBar";
import { WorkspaceManagerModal } from "../components/WorkspaceManagerModal";
import { useSuggestions } from "../hooks/useSuggestions";
import { useReminderNotifications } from "../hooks/useReminderNotifications";
import { getSavedModel, saveModel } from "../constants/models";
import type { Conversation, Message, Note, Workspace } from "../types";
import { TEMP_ID, convLabel } from "../types";
import { useWorkspace } from "../hooks/useWorkspace";
import { useFeatureFlags } from "../hooks/useFeatureFlags";
import { fetchAdminFeedback } from "../api/adminApi";
import { getEmailStatus } from "../api/emailApi";
import { detectReminderFromMessage } from "../api/reminderApi";
import { ChatReminderSuggestion } from "../components/ChatReminderSuggestion";
import type { EmailAccount } from "../api/emailApi";
import { getTeamsStatus } from "../api/teamsApi";
import { getWhatsappStatus, startWhatsapp } from "../api/whatsappApi";
import { isDesktopOnline } from "../api/desktopApi";
import {
  controlSpotifyPlayback,
  getSpotifyLibrary,
  listConnectors,
  type SpotifyApiPlaylist,
  type SpotifyApiTrack,
  type SpotifyPlaybackAction,
  type SpotifyRepeatMode,
} from "../api/connectorsApi";
import { useSpotifyPlayer } from "../hooks/useSpotifyPlayer";
import { AdminPage } from "./AdminPage";
import { suggestActions, type WorkflowAction } from "../api/workflowApi";
import { OnboardingTour } from "../components/OnboardingTour";
import { CoreMemoryView } from "../components/CoreMemoryView";
import { useTheme, THEMES, THEME_META, type Theme } from "../hooks/useTheme";
import { SpotifyFullPlayer } from "../components/SpotifyPlayer";
import { CalendarTabContent } from "../components/CalendarTabContent";
import { useCalendar } from "../hooks/useCalendar";
import { BooksLibraryModal } from "../components/BooksLibraryModal";
import { BookReader } from "../components/BookReader";
import { useBookTabs } from "../hooks/useBookTabs";
import { listMyBooks, getBook, getBookHighlight, borrowBook, type Book } from "../api/booksApi";
import { DESKTOP_LAYOUT_MIN_WIDTH, useIsDesktop } from "../hooks/useIsDesktop";
import { useStudyTabs } from "../hooks/useStudyTabs";
import { StudyToolView } from "../components/StudyToolView";
import { TABS as STUDY_TABS, type Tab as StudyTab } from "../components/study/StudyTabs";
import { StudyToolIcon, getStudyToolStyle } from "../components/StudyToolIcon";

type WorkspaceHook = ReturnType<typeof useWorkspace>;
type LayoutMode = "stacked" | "columns" | "rows";
type TabType = "chat" | "note" | "email" | "spotify" | "whatsapp" | "calendar" | "books" | "book" | "study" | "memograph";
type DraggableTabType = "chat" | "note" | "email" | "whatsapp";
type AdminTab = "feedback" | "features" | "users" | "logs" | "survey" | "evaluation" | "books";

function getSavedLayout(): LayoutMode {
  return (localStorage.getItem("memolink_layout") as LayoutMode) ?? "stacked";
}
function getSavedRatio(key: string): number {
  return parseFloat(localStorage.getItem(key) ?? "0.5");
}

/** Returns spreadable props that hide a mounted reader tab without unmounting it.
 *  Keeps className + aria-hidden in sync so both are updated from one call site. */
function readerTabProps(baseClass: string, active: boolean) {
  return {
    className: active ? baseClass : `${baseClass} hidden`,
    "aria-hidden": active ? (undefined as undefined) : true,
  };
}

export function ChatPage({ user, workspaceHook }: { user: User; workspaceHook: WorkspaceHook }) {
  const isDesktop = useIsDesktop();
  const [sidebarOpen, setSidebarOpen] = useState(isDesktop);
  const [layoutMode, setLayoutMode] = useState<LayoutMode>(getSavedLayout);
  const [colRatio, setColRatio] = useState(() => getSavedRatio("memolink_split_col"));
  const [rowRatio, setRowRatio] = useState(() => getSavedRatio("memolink_split_row"));
  const [showNotes, setShowNotes] = useState(true);
  const [showConversations, setShowConversations] = useState(true);
  const [menuData, setMenuData] = useState<{ type: "note" | "conversation"; item: any; top: number; left: number } | null>(null);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<{ id: number; content: string; index: number } | null>(null);
  const [activeTabType, setActiveTabType] = useState<TabType>("chat");
  const emailTabs = useEmailTabs();
  const whatsappTabs = useWhatsappTabs();
  const [emailActionLoadingId, setEmailActionLoadingId] = useState<string | null>(null);
  const [rightPanelOpen, setRightPanelOpen] = useState(isDesktop);
  const activeLayoutMode: LayoutMode = isDesktop ? layoutMode : "stacked";

  // Re-sync both panels whenever the viewport crosses the desktop breakpoint
  // (resize, orientation change, devtools device toolbar) instead of only checking at mount.
  useEffect(() => {
    setSidebarOpen(isDesktop);
    setRightPanelOpen(isDesktop);
  }, [isDesktop]);
  const [recycleBinOpen, setRecycleBinOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const { theme, setTheme } = useTheme();
  const [showSettings, setShowSettings] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [memographTabOpen, setMemographTabOpen] = useState(false);
  const [showCoreMemory, setShowCoreMemory] = useState(false);
  const [showSurvey, setShowSurvey] = useState(false);
  const [workflowSuggestions, setWorkflowSuggestions] = useState<Record<number, WorkflowAction[]>>({});
  const prevStreamingRef = useRef(false);
  const [showWorkspaceManager, setShowWorkspaceManager] = useState(false);
  const [showAdmin, setShowAdmin] = useState(false);
  const [adminInitialTab, setAdminInitialTab] = useState<AdminTab>("feedback");
  const [showFeedback, setShowFeedback] = useState(false);
  const [booksTabOpen, setBooksTabOpen] = useState(false);
  const [booksInitialView, setBooksInitialView] = useState<"browse" | "my">("browse");
  const bookTabs = useBookTabs();
  const [bookReaderFullscreen, setBookReaderFullscreen] = useState(false);
  const [myBooks, setMyBooks] = useState<import("../api/booksApi").UserBook[]>([]);
  const studyTabs = useStudyTabs();
  const [chatReminderSuggestion, setChatReminderSuggestion] = useState<{
    text: string; due_date: string | null; due_time: string | null; messageId: number;
  } | null>(null);
  const [editingNoteTab, setEditingNoteTab] = useState<number | null>(null);
  const [editingChatTabId, setEditingChatTabId] = useState<number | null>(null);
  const [editingChatTitle, setEditingChatTitle] = useState("");
  const [openFeedbackCount, setOpenFeedbackCount] = useState(0);
  const [selectedModel, setSelectedModel] = useState<string>(getSavedModel);
  const { flags } = useFeatureFlags();
  const evalStatus = useEvaluationHeartbeat(flags.evaluation_analytics_enabled);
  const evaluationActive = flags.evaluation_analytics_enabled && evalStatus.loaded && !evalStatus.exhausted;
  const [evalRatings, setEvalRatings] = useState<Record<string, Record<string, number | string>>>({});
  const [emailConnected, setEmailConnected] = useState(false);
  const [emailAccounts, setEmailAccounts] = useState<EmailAccount[]>([]);
  const [teamsConnected, setTeamsConnected] = useState(false);
  const [whatsappConnected, setWhatsappConnected] = useState(false);
  const [whatsappAvailable, setWhatsappAvailable] = useState(false);
  const [spotifyTabOpen, setSpotifyTabOpen] = useState(false);
  const [calendarTabOpen, setCalendarTabOpen] = useState(false);
  const [spotifyConnected, setSpotifyConnected] = useState(false);
  const [spotifyPlaybackError, setSpotifyPlaybackError] = useState<string | null>(null);
  const [spotifyShuffle, setSpotifyShuffle] = useState(false);
  const [spotifyRepeatMode, setSpotifyRepeatMode] = useState<SpotifyRepeatMode>("off");
  const [spotifyLibrary, setSpotifyLibrary] = useState<{ playlists: SpotifyApiPlaylist[]; tracks: SpotifyApiTrack[] }>({ playlists: [], tracks: [] });
  const [spotifyQueueContext, setSpotifyQueueContext] = useState<SpotifyApiTrack[] | null>(null);
  const spotifyPlayer = useSpotifyPlayer(spotifyConnected);
  const [spotifyOptimisticPaused, setSpotifyOptimisticPaused] = useState<boolean | null>(null);
  const spotifyPaused = spotifyOptimisticPaused ?? spotifyPlayer.isPaused;
  const spotifyPlaying = !spotifyPaused;
  const [showTour, setShowTour] = useState(() => !localStorage.getItem("memolink_walkthrough_done"));
  const [bellTooltipVisible, setBellTooltipVisible] = useState(false);

  // Tab drag-and-drop
  const dragSrcRef = useRef<{ type: DraggableTabType; index: number } | null>(null);
  const [dragOverTab, setDragOverTab] = useState<{ type: DraggableTabType; index: number } | null>(null);

  // Long-press to edit tab title on mobile
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  function startLongPress(action: () => void) {
    longPressTimer.current = setTimeout(() => { action(); longPressTimer.current = null; }, 500);
  }
  function cancelLongPress() {
    if (longPressTimer.current) { clearTimeout(longPressTimer.current); longPressTimer.current = null; }
  }

  // Per-workspace tab persistence
  const pendingChatRestoreRef = useRef<{ chatIds: number[]; activeChatId: number | null } | null>(null);
  const pendingNoteRestoreRef = useRef<{ wsId: number; noteIds: number[]; activeNoteId: number | null; activeTabType: "chat" | "note" } | null>(null);

  function handleLayoutChange(mode: LayoutMode) {
    setLayoutMode(mode);
    localStorage.setItem("memolink_layout", mode);
  }
  function closeSidebarOnCompactLayout() {
    if (window.innerWidth < DESKTOP_LAYOUT_MIN_WIDTH) setSidebarOpen(false);
  }
  function handleColRatio(r: number) { setColRatio(r); localStorage.setItem("memolink_split_col", String(r)); }
  function handleRowRatio(r: number) { setRowRatio(r); localStorage.setItem("memolink_split_row", String(r)); }

  function handleModelChange(id: string) {
    saveModel(id);
    setSelectedModel(id);
  }

  // Force default model when model selection is disabled
  useEffect(() => {
    if (!flags.model_selection_enabled) {
      setSelectedModel(flags.default_model);
    }
  }, [flags.model_selection_enabled, flags.default_model]);

  // Fetch open feedback count for admins (badge on avatar)
  async function refreshFeedbackCount() {
    if (!user.is_admin) return;
    try {
      const items = await fetchAdminFeedback("all", "open");
      setOpenFeedbackCount(items.length);
    } catch { /* ignore */ }
  }
  useEffect(() => { refreshFeedbackCount(); }, []);

  async function loadEmailData() {
    try {
      const s = await getEmailStatus();
      setEmailConnected(s.connected);
      setEmailAccounts(s.accounts ?? []);
    } catch { /* ignore */ }
  }

  useEffect(() => {
    loadEmailData();
    getTeamsStatus().then(s => setTeamsConnected(s.connected)).catch(() => {});
    listMyBooks().then(setMyBooks).catch(() => {});
    listConnectors()
      .then((rows) => setSpotifyConnected(Boolean(rows.find((item) => item.id === "spotify")?.connected)))
      .catch(() => {});
    // WhatsApp is only available when the desktop app is running locally.
    isDesktopOnline().then(online => {
      setWhatsappAvailable(online);
      if (!online) return;
      // Desktop is up — check if bridge is still alive. On a full app reload/relaunch,
      // Electron kills the bridge child process entirely, so the /health request itself
      // fails (not just "disconnected") — restart silently if the user was connected before.
      function restartAndPoll() {
        startWhatsapp().catch(() => {}).finally(() => {
          let tries = 0;
          const poll = setInterval(() => {
            tries++;
            getWhatsappStatus().then(st => {
              if (st.connected) {
                setWhatsappConnected(true);
                clearInterval(poll);
              } else if (tries >= 5) {
                localStorage.removeItem("memolink_wa_connected");
                clearInterval(poll);
              }
            }).catch(() => {
              if (tries >= 5) {
                localStorage.removeItem("memolink_wa_connected");
                clearInterval(poll);
              }
            });
          }, 2000);
        });
      }
      getWhatsappStatus().then(s => {
        if (s.connected) {
          setWhatsappConnected(true);
          localStorage.setItem("memolink_wa_connected", "1");
        } else if (localStorage.getItem("memolink_wa_connected") === "1") {
          restartAndPoll();
        }
      }).catch(() => {
        // Bridge process isn't running at all (e.g. killed on app relaunch) — same
        // recovery as the "disconnected" case above, just reached via the request failing.
        if (localStorage.getItem("memolink_wa_connected") === "1") {
          restartAndPoll();
        }
      });
    });
  }, []);

  useEffect(() => {
    if (!spotifyConnected) {
      setSpotifyLibrary({ playlists: [], tracks: [] });
      setSpotifyQueueContext(null);
      setSpotifyOptimisticPaused(null);
      return;
    }
    let cancelled = false;
    getSpotifyLibrary()
      .then((data) => { if (!cancelled) setSpotifyLibrary(data); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [spotifyConnected]);

  useEffect(() => {
    if (spotifyOptimisticPaused !== null && spotifyPlayer.isPaused === spotifyOptimisticPaused) {
      setSpotifyOptimisticPaused(null);
    }
  }, [spotifyPlayer.isPaused, spotifyOptimisticPaused]);

  // Open the relevant modal after OAuth redirects
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("onedrive_connected") === "1" || params.get("admin") === "books") {
      if (user.is_admin) {
        setAdminInitialTab("books");
        setShowAdmin(true);
      }
      window.history.replaceState({}, "", window.location.pathname);
      return;
    }
    if (
      params.get("email_connected") === "1" ||
      params.get("teams_connected") === "1" ||
      params.get("github_connected") === "1" ||
      params.get("jira_connected") === "1" ||
      params.get("spotify_connected") === "1"
    ) {
      setShowSettings(true);
      if (params.get("teams_connected") === "1") setTeamsConnected(true);
      if (params.get("spotify_connected") === "1") setSpotifyConnected(true);
      if (params.get("email_connected") === "1") loadEmailData();
      window.history.replaceState({}, "", window.location.pathname);
    }
    const emailErr = params.get("email_error");
    const githubErr = params.get("github_error");
    const jiraErr = params.get("jira_error");
    const spotifyErr = params.get("spotify_error");
    if (emailErr || githubErr || jiraErr || spotifyErr) {
      setShowSettings(true);
      window.history.replaceState({}, "", window.location.pathname);
      if (emailErr) {
        sessionStorage.setItem("email_oauth_error", decodeURIComponent(emailErr));
      }
      if (githubErr) {
        sessionStorage.setItem("github_oauth_error", decodeURIComponent(githubErr));
      }
      if (jiraErr) {
        sessionStorage.setItem("jira_oauth_error", decodeURIComponent(jiraErr));
      }
      if (spotifyErr) {
        sessionStorage.setItem("spotify_oauth_error", decodeURIComponent(spotifyErr));
      }
    }
  }, []);

  const activeWorkspaceId = workspaceHook.activeWorkspace?.id ?? null;

  const { notes, setNotes, addNote, saveNote, removeNote, reloadNotes } = useNotes(user.id, activeWorkspaceId);
  const suggestions = useSuggestions(activeWorkspaceId);
  const calendar = useCalendar(activeWorkspaceId);
  const { permission: notifPermission, requestPermission: requestNotifPermission } = useReminderNotifications(suggestions.items);
  const editor = useNoteEditor();
  const convs = useConversations(activeWorkspaceId);

  // Load the user's saved answer ratings so selections persist across reloads.
  useEffect(() => {
    if (!flags.evaluation_analytics_enabled) return;
    getMyRatings().then(setEvalRatings).catch(() => {});
  }, [flags.evaluation_analytics_enabled, convs.activeConversation?.id]);

  async function handleNoteUpdated(noteId: number) {
    try {
      const fresh = await getNote(noteId);
      setNotes((p) => p.map((n) => n.id === noteId ? fresh : n));
      editor.syncNoteById(noteId, fresh);
    } catch {}
  }

  const chat = useChat({
    activeConversation: convs.activeConversation,
    setActiveConversation: convs.setActiveConversation,
    setConversations: convs.setConversations,
    bottomRef: convs.bottomRef,
    workspaceId: activeWorkspaceId,
    model: selectedModel,
    spotifyDeviceId: spotifyPlayer.deviceId,
    onCloseNote: editor.closeNoteById,
    onNoteUpdated: handleNoteUpdated,
    onOpenNote: handleOpenNoteById,
  });

  function appendWorkflowMessages(messages: Message[]) {
    if (!messages.length) return;
    convs.setActiveConversation((prev) => {
      if (!prev) return prev;
      const existing = new Set(prev.messages.map((m) => m.id));
      const nextMessages = [...prev.messages, ...messages.filter((m) => !existing.has(m.id))];
      return { ...prev, messages: nextMessages };
    });
    convs.setConversations((prev) => prev.map((conv) => {
      if (conv.id !== convs.activeConversation?.id) return conv;
      const existing = new Set(conv.messages.map((m) => m.id));
      return { ...conv, messages: [...conv.messages, ...messages.filter((m) => !existing.has(m.id))] };
    }));
    requestAnimationFrame(() => convs.bottomRef.current?.scrollIntoView({ behavior: "smooth" }));
  }

  // Stage chat/note tab restore on first mount (covers full page reload and a fresh
  // login, where there's no onSwitchWorkspace click to populate these refs) — runs once,
  // before the restore-consuming effects below, by virtue of declaration order within
  // the same effect-commit when activeWorkspaceId first resolves.
  const initialWsTabRestoreDoneRef = useRef(false);
  useEffect(() => {
    if (activeWorkspaceId == null || initialWsTabRestoreDoneRef.current) return;
    initialWsTabRestoreDoneRef.current = true;
    try {
      const raw = localStorage.getItem(`memolink_tabs_ws_${activeWorkspaceId}`);
      if (raw) {
        const saved = JSON.parse(raw);
        const savedTabType = saved.activeTabType === "note" ? "note" : "chat";
        pendingChatRestoreRef.current = { chatIds: saved.chatIds ?? [], activeChatId: saved.activeChatId ?? null };
        pendingNoteRestoreRef.current = { wsId: activeWorkspaceId, noteIds: saved.noteIds ?? [], activeNoteId: saved.activeNoteId ?? null, activeTabType: savedTabType };
      }
    } catch { /* ignore corrupt saved state */ }
  }, [activeWorkspaceId]);

  useEffect(() => {
    const saved = pendingChatRestoreRef.current;
    pendingChatRestoreRef.current = null;
    convs.initConversations(activeWorkspaceId, saved);
  }, [activeWorkspaceId]);

  // Restore note tabs after notes load for the new workspace
  useEffect(() => {
    const pending = pendingNoteRestoreRef.current;
    if (!pending || notes.length === 0 || pending.wsId !== activeWorkspaceId) return;
    pendingNoteRestoreRef.current = null;
    const { noteIds, activeNoteId, activeTabType: savedTabType } = pending;
    async function restoreNoteTabs() {
      for (const id of noteIds) {
        const note = notes.find((n) => n.id === id);
        if (note) await editor.openNote(note);
      }
      if (savedTabType === "note" && noteIds.length > 0) setActiveTabType("note");
    }
    restoreNoteTabs();
  }, [notes, activeWorkspaceId]);

  // When all note tabs are closed, switch back to chat
  useEffect(() => {
    if (editor.openNotes.length === 0 && activeTabType === "note") {
      setActiveTabType("chat");
    }
  }, [editor.openNotes.length]);

  // When all email tabs are closed, switch back to chat
  useEffect(() => {
    if (emailTabs.openTabs.length === 0 && activeTabType === "email") {
      setActiveTabType("chat");
    }
  }, [emailTabs.openTabs.length]);

  // When all whatsapp tabs are closed, switch back to chat
  useEffect(() => {
    if (whatsappTabs.openTabs.length === 0 && activeTabType === "whatsapp") {
      setActiveTabType("chat");
    }
  }, [whatsappTabs.openTabs.length]);

  // Continuously snapshot chat/note tabs for the current workspace (not just on
  // switch-away) so a plain reload also restores them, via the staging effect above.
  useEffect(() => {
    if (activeWorkspaceId == null) return;
    const snapshot = {
      chatIds: convs.openChats.filter((c) => c.id !== TEMP_ID).map((c) => c.id),
      activeChatId: convs.activeConversation?.id !== TEMP_ID ? (convs.activeConversation?.id ?? null) : null,
      noteIds: editor.openNotes.filter((t) => t.note.id !== null).map((t) => t.note.id as number),
      activeNoteId: editor.active?.note.id ?? null,
      activeTabType: activeTabType === "note" ? "note" : "chat",
    };
    localStorage.setItem(`memolink_tabs_ws_${activeWorkspaceId}`, JSON.stringify(snapshot));
  }, [activeWorkspaceId, convs.openChats, convs.activeConversation?.id, editor.openNotes, editor.active?.note.id, activeTabType]);

  // Email and WhatsApp tabs aren't tied to a workspace, so they're snapshotted under
  // their own global keys and restored once on mount (reload or fresh login).
  useEffect(() => {
    localStorage.setItem("memolink_tabs_email", JSON.stringify({ tabs: emailTabs.openTabs, activeIndex: emailTabs.activeIndex }));
  }, [emailTabs.openTabs, emailTabs.activeIndex]);

  useEffect(() => {
    localStorage.setItem("memolink_tabs_whatsapp", JSON.stringify({ tabs: whatsappTabs.openTabs, activeIndex: whatsappTabs.activeIndex }));
  }, [whatsappTabs.openTabs, whatsappTabs.activeIndex]);

  useEffect(() => {
    localStorage.setItem("memolink_active_tab_type", activeTabType);
  }, [activeTabType]);

  const initialEmailWaRestoreDoneRef = useRef(false);
  useEffect(() => {
    if (initialEmailWaRestoreDoneRef.current) return;
    initialEmailWaRestoreDoneRef.current = true;
    const desiredTabType = localStorage.getItem("memolink_active_tab_type");
    try {
      const raw = localStorage.getItem("memolink_tabs_email");
      if (raw) {
        const saved = JSON.parse(raw);
        if (Array.isArray(saved.tabs) && saved.tabs.length > 0) {
          emailTabs.restoreTabs(saved.tabs, saved.activeIndex ?? 0);
          if (desiredTabType === "email") setActiveTabType("email");
        }
      }
    } catch { /* ignore corrupt saved state */ }
    try {
      const raw = localStorage.getItem("memolink_tabs_whatsapp");
      if (raw) {
        const saved = JSON.parse(raw);
        if (Array.isArray(saved.tabs) && saved.tabs.length > 0) {
          whatsappTabs.restoreTabs(saved.tabs, saved.activeIndex ?? 0);
          if (desiredTabType === "whatsapp") setActiveTabType("whatsapp");
        }
      }
    } catch { /* ignore corrupt saved state */ }
    if (localStorage.getItem("memolink_calendar_tab_open") === "true") {
      setCalendarTabOpen(true);
      if (desiredTabType === "calendar") setActiveTabType("calendar");
    }
    if (localStorage.getItem("memolink_books_tab_open") === "true") {
      setBooksTabOpen(true);
      if (desiredTabType === "books") setActiveTabType("books");
    }
    if (localStorage.getItem("memolink_memograph_tab_open") === "true") {
      setMemographTabOpen(true);
      if (desiredTabType === "memograph") setActiveTabType("memograph");
    }
  }, []);

  useEffect(() => {
    if (!spotifyTabOpen && activeTabType === "spotify") {
      setActiveTabType("chat");
    }
  }, [spotifyTabOpen, activeTabType]);

  useEffect(() => {
    if (!calendarTabOpen && activeTabType === "calendar") {
      setActiveTabType("chat");
    }
  }, [calendarTabOpen, activeTabType]);

  useEffect(() => {
    localStorage.setItem("memolink_calendar_tab_open", String(calendarTabOpen));
  }, [calendarTabOpen]);

  useEffect(() => {
    if (!memographTabOpen && activeTabType === "memograph") {
      setActiveTabType("chat");
    }
  }, [memographTabOpen, activeTabType]);

  useEffect(() => {
    localStorage.setItem("memolink_memograph_tab_open", String(memographTabOpen));
  }, [memographTabOpen]);

  useEffect(() => {
    if (!booksTabOpen && activeTabType === "books") {
      setActiveTabType("chat");
    }
  }, [booksTabOpen, activeTabType]);

  useEffect(() => {
    localStorage.setItem("memolink_books_tab_open", String(booksTabOpen));
  }, [booksTabOpen]);

  // When all book reader tabs are closed, switch back to chat
  useEffect(() => {
    if (bookTabs.openTabs.length === 0 && activeTabType === "book") {
      setActiveTabType("chat");
    }
  }, [bookTabs.openTabs.length, activeTabType]);

  // When all study tool tabs are closed, switch back to chat
  useEffect(() => {
    if (studyTabs.openTabs.length === 0 && activeTabType === "study") {
      setActiveTabType("chat");
    }
  }, [studyTabs.openTabs.length, activeTabType]);

  useEffect(() => {
    const close = () => { setMenuData(null); setUserMenuOpen(false); };
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, []);

  // ── Auto-suggest workflow actions after each AI response ─────────────────
  useEffect(() => {
    const wasStreaming = prevStreamingRef.current;
    prevStreamingRef.current = chat.streaming;

    // Clear old suggestion when user sends a new message (streaming starts)
    if (!wasStreaming && chat.streaming) { setChatReminderSuggestion(null); return; }
    if (!wasStreaming || chat.streaming) return;           // only on streaming → false transition
    if (!flags.workflow_enabled) return;
    if (localStorage.getItem("memolink_workflow_suggestions") === "false") return;

    const messages = convs.activeConversation?.messages;
    if (!messages?.length) return;

    // Find the last assistant message that was just finalized
    const last = messages[messages.length - 1];
    if (!last || last.role !== "assistant") return;
    if (last.id <= 0) return;                             // still temp/streaming ID
    if (last.content.startsWith("__")) return;            // quiz, plan, etc.
    if (last.content.length < 80) return;                 // too short to be useful

    // Already have suggestions for this message
    if (workflowSuggestions[last.id]) return;

    // Find the user message that immediately preceded this assistant response
    const precedingUser = [...messages].reverse().find((m, i) => i > 0 && m.role === "user");
    const userMsg = precedingUser?.content ?? undefined;

    suggestActions(last.content, activeWorkspaceId, userMsg).then(actions => {
      if (actions.length > 0) {
        setWorkflowSuggestions(prev => ({ ...prev, [last.id]: actions }));
      }
    });

    // Smart reminder detection — scan the user's message (most likely to contain tasks/deadlines)
    const scanText = precedingUser?.content ?? last.content;
    if (scanText.length >= 5 && !chatReminderSuggestion) {
      detectReminderFromMessage(scanText).then((result) => {
        if (result.detected && result.text) {
          setChatReminderSuggestion({
            text: result.text,
            due_date: result.due_date,
            due_time: result.due_time,
            messageId: last.id,
          });
        }
      }).catch(() => {});
    }
  }, [chat.streaming]);

  // ── Chat tab actions ──────────────────────────────────────────────────────
  async function handleActivateChat(chatId: number) {
    setActiveTabType("chat");
    if (chatId === TEMP_ID) {
      convs.setActiveConversation({ id: TEMP_ID, title: null, messages: [] });
      return;
    }
    const conv = convs.conversations.find((c) => c.id === chatId);
    if (conv) await convs.handleSelectConversation(conv);
  }

  function handleCloseChat(chatId: number) {
    const remaining = convs.openChats.filter((c) => c.id !== chatId);
    convs.closeChat(chatId);
    if (activeTabType === "chat" && convs.activeConversation?.id === chatId) {
      if (remaining.length > 0) {
        handleActivateChat(remaining[remaining.length - 1].id);
      } else if (editor.openNotes.length > 0) {
        setActiveTabType("note");
      } else {
        convs.startNewChat();
      }
    }
  }

  // ── Note tab actions ──────────────────────────────────────────────────────
  async function handleOpenNote(note: Note | { id: null; title: string; content: string }) {
    await editor.openNote(note);
    setActiveTabType("note");
  }

  async function handleRenameNoteTab(index: number) {
    const tab = editor.openNotes[index];
    if (!tab) return;
    const title = tab.titleDraft.trim();
    if (!title || tab.note.id === null || title === (tab.note.title ?? "")) return;
    const fresh = await updateNote(tab.note.id, title, null);
    editor.syncNoteTitle(tab.note.id, fresh.title ?? title);
    setNotes((prev) => prev.map((n) => (n.id === tab.note.id ? { ...n, title: fresh.title ?? title } : n)));
  }

  // ── Note CRUD ─────────────────────────────────────────────────────────────
  async function handleSaveNote() {
    if (!editor.noteTitleDraft.trim() && !editor.noteContentDraft.trim()) {
      alert("Cannot save an empty note."); return;
    }
    if (editor.selectedNote?.id === null) {
      const fresh = await addNote(editor.noteTitleDraft, editor.noteContentDraft);
      editor.updateActiveNote(fresh);
      suggestions.generateFromNote(editor.noteTitleDraft, editor.noteContentDraft);
      return;
    }
    const fresh = await saveNote(editor.selectedNote!.id, editor.noteTitleDraft, editor.noteContentDraft);
    editor.updateActiveNote(fresh);
    suggestions.generateFromNote(editor.noteTitleDraft, editor.noteContentDraft);
  }

  async function handleTogglePublicAgent() {
    const note = editor.selectedNote;
    if (!note || note.id === null) return;
    const next = !note.public_agent_enabled;
    try {
      const fresh = await setNotePublicAgentEnabled(note.id, next);
      editor.syncNoteById(note.id, fresh);
    } catch (e: any) {
      alert(e?.response?.data?.detail || "Could not change this note's public agent visibility.");
    }
  }

  async function handleDeleteNote(noteId: number) {
    if (!confirm("Delete this note?")) return;
    await removeNote(noteId);
    editor.closeNoteById(noteId);
  }

  async function handleOpenNoteById(noteId: number) {
    const found = notes.find((n) => n.id === noteId);
    if (found) {
      await handleOpenNote(found);
    } else {
      const fresh = await getNote(noteId);
      if (fresh) await handleOpenNote(fresh);
    }
  }

  async function handleApplyNoteEdit(content: string, noteId: number | null) {
    const { marked } = await import("marked");
    const unwrapMarkdownFence = (value: string) => {
      const match = value.trim().match(/^```(?:markdown|md)?\s*\n([\s\S]*?)\n```$/i);
      return match ? match[1].trim() : value;
    };
    const html = await marked(unwrapMarkdownFence(content)) as string;
    if (noteId) {
      await updateNote(noteId, null, html);
      const fresh = await getNote(noteId);
      setNotes((p) => p.map((n) => n.id === noteId ? fresh : n));
      editor.syncNoteById(noteId, fresh);
    } else if (isNoteActive) {
      editor.setNoteContentDraft(html);
    } else {
      await handleOpenNote({ id: null, title: "AI-Edited Note", content: html });
    }
  }

  async function handleAddMessageToNotes(content: string) {
    try {
      const { marked } = await import("marked");
      const html = await marked(content) as string;
      const res = await addMessageToNoteAPI(html, "Chat Snippet");
      const fresh = await getNote(res.id);
      setNotes((p) => [fresh, ...p]);
      await handleOpenNote(fresh);
    } catch {
      alert("Failed to save note. Please try again.");
    }
  }

  async function handleAddToNotesAndDelete() {
    if (!deleteTarget || !convs.activeConversation) return;
    await handleAddMessageToNotes(deleteTarget.content);
    await deleteMessage(deleteTarget.id);
    convs.setActiveConversation({
      ...convs.activeConversation,
      messages: convs.activeConversation.messages.filter((_, i) => i !== deleteTarget.index),
    });
    setShowDeleteModal(false);
  }

  async function handleFinalDelete() {
    if (!deleteTarget || !convs.activeConversation) return;
    await deleteMessage(deleteTarget.id);
    convs.setActiveConversation({
      ...convs.activeConversation,
      messages: convs.activeConversation.messages.filter((_, i) => i !== deleteTarget.index),
    });
    setShowDeleteModal(false);
  }

  function handleTabDrop(type: DraggableTabType, toIndex: number) {
    const src = dragSrcRef.current;
    if (!src || src.type !== type) return;
    if (type === "chat") convs.reorderOpenChats(src.index, toIndex);
    else if (type === "note") editor.reorderNotes(src.index, toIndex);
    else if (type === "email") emailTabs.reorderEmailTabs(src.index, toIndex);
    else whatsappTabs.reorderWhatsappTabs(src.index, toIndex);
  }

  function openEmailInTab(email: import("../api/emailApi").BrowseEmailResult) {
    emailTabs.openEmailTab(email);
    setActiveTabType("email");
  }

  function openWhatsappInTab(chat: import("../api/whatsappApi").WhatsappChat) {
    whatsappTabs.openWhatsappTab(chat);
    setActiveTabType("whatsapp");
  }

  function openComposeInTab() {
    emailTabs.openComposeTab();
    setActiveTabType("email");
  }

  function openAllMailInTab() {
    emailTabs.openAllMailTab();
    setActiveTabType("email");
  }

  function openEmailAccountInTab(account: import("../api/emailApi").EmailAccount) {
    emailTabs.openAccountTab(account.id);
    setActiveTabType("email");
  }

  function openSpotifyInTab() {
    setSpotifyTabOpen(true);
    setActiveTabType("spotify");
  }

  function openCalendarInTab() {
    setCalendarTabOpen(true);
    setActiveTabType("calendar");
  }

  function openMemoGraphInTab() {
    setMemographTabOpen(true);
    setActiveTabType("memograph");
  }

  function openBrowseBooks() {
    setBooksInitialView("browse");
    setBooksTabOpen(true);
    setActiveTabType("books");
  }

  function openMyBooks() {
    setBooksInitialView("my");
    setBooksTabOpen(true);
    setActiveTabType("books");
  }

  async function handleChatBorrowBook(bookId: number) {
    // Already in library → open the reader directly
    const existing = myBooks.find((m) => m.book_id === bookId);
    if (existing?.book) {
      openBookTab(existing.book, existing.current_page || 1);
      setActiveTabType("book");
      return;
    }
    // Not yet in library → borrow first (failure is non-fatal; may already be owned)
    try { await borrowBook(bookId); } catch { /* already owned or network hiccup — continue */ }

    // Always refresh the list so we get the latest server state
    try {
      const updated = await listMyBooks();
      setMyBooks(updated);
      const newEntry = updated.find((m) => m.book_id === bookId);
      if (newEntry?.book) {
        openBookTab(newEntry.book, 1);
        setActiveTabType("book");
      }
    } catch {
      // listMyBooks itself failed — fall back to whatever is in local state
      const fallback = myBooks.find((m) => m.book_id === bookId);
      if (fallback?.book) {
        openBookTab(fallback.book, fallback.current_page || 1);
        setActiveTabType("book");
      }
    }
  }

  function openBookTab(book: Book, page: number) {
    bookTabs.openBookTab(book, page || 1);
    setActiveTabType("book");
  }

  function openBookReader(bookId: number) {
    const ub = myBooks.find((m) => m.book_id === bookId);
    if (!ub?.book) return;
    openBookTab(ub.book, ub.current_page || 1);
  }

  function openStudyTool(tool: StudyTab) {
    studyTabs.openStudyTab(tool);
    setActiveTabType("study");
  }

  // Double-clicking a highlight blockquote inside a Note jumps back into the book it
  // came from, scrolled to and flashed at the exact highlighted text.
  async function openBookHighlight(highlightId: number) {
    try {
      const highlight = await getBookHighlight(highlightId);
      const book = await getBook(highlight.book_id);
      bookTabs.openBookTab(book, highlight.page_number, {
        page: highlight.page_number,
        start: highlight.start_offset,
        end: highlight.end_offset,
      });
      setActiveTabType("book");
    } catch {
      // ignore — book may no longer be available
    }
  }

  // useBookTabs returns a new object each render. Deferred callbacks must resolve
  // against the latest tabs, while the captured book ID remains stable if another
  // tab is closed before the animation frame runs.
  const bookTabsRef = useRef(bookTabs);
  bookTabsRef.current = bookTabs;

  function closeBookTabNextFrame(index = bookTabsRef.current.activeIndex) {
    const bookId = bookTabsRef.current.openTabs[index]?.book.id;
    if (bookId == null) return;
    requestAnimationFrame(() => {
      const currentIndex = bookTabsRef.current.openTabs.findIndex((tab) => tab.book.id === bookId);
      if (currentIndex >= 0) bookTabsRef.current.closeBookTab(currentIndex);
    });
  }

  function closeBookTabFromTabBar(index: number) {
    setBookReaderFullscreen(false);
    if (index === bookTabs.activeIndex && bookTabs.openTabs.length === 1) {
      setBooksTabOpen(true);
      setActiveTabType("books");
    }
    closeBookTabNextFrame(index);
  }

  function closeActiveBookTab() {
    setBookReaderFullscreen(false);
    setBooksTabOpen(true);
    setActiveTabType("books");
    // Defer the actual unmount by one animation frame. This lets React hide the
    // reader container (isBookReaderActive → false) and paint the books library
    // BEFORE BookReader unmounts its canvas / epub.js iframes. On Android WebView,
    // GPU canvas teardown and epub.js destroy() can flash a blank frame when they
    // race with the display:none that hides the reader in the same paint.
    closeBookTabNextFrame();
  }

  // Readers persist progress to the backend themselves; this just mirrors it into the
  // local myBooks list immediately so the right panel's Continue Reading list (and any
  // other UI reading from myBooks) updates without waiting for the Books tab to reopen
  // and refetch /books/my.
  const handleBookProgress = useCallback((page: number, totalPages: number) => {
    const bookId = bookTabsRef.current.active?.book.id;
    if (bookId == null) return;
    bookTabsRef.current.updateBookTabPage(bookId, page);
    setMyBooks((prev) =>
      prev.map((ub) =>
        ub.book_id === bookId
          ? {
              ...ub,
              current_page: page,
              total_pages: totalPages || ub.total_pages,
              progress_percent: totalPages > 0 ? Math.min(100, (page / totalPages) * 100) : ub.progress_percent,
              last_read_at: new Date().toISOString(),
            }
          : ub
      )
    );
  }, []);

  function spotifyErrorMessage(err: any): string {
    return err?.response?.data?.detail ?? err?.message ?? "Spotify playback failed.";
  }

  async function sendSpotifyPlayback(
    action: SpotifyPlaybackAction,
    payload?: { uri?: string | null; uris?: string[] | null; context_uri?: string | null; shuffle?: boolean | null; repeat_mode?: SpotifyRepeatMode | null; position_ms?: number | null },
  ): Promise<boolean> {
    if (!spotifyConnected) return false;
    try {
      setSpotifyPlaybackError(null);
      await controlSpotifyPlayback(action, { ...payload, device_id: spotifyPlayer.deviceId });
      return true;
    } catch (err) {
      console.warn("Spotify playback control failed", err);
      setSpotifyPlaybackError(spotifyErrorMessage(err));
      openSpotifyInTab();
      return false;
    }
  }

  // Builds an ad-hoc Spotify queue starting at `startUri` so native next/previous
  // stay within this list instead of falling back to Spotify's autoplay/radio queue.
  function buildQueueUris(tracks: SpotifyApiTrack[], startUri: string): string[] {
    const startIndex = tracks.findIndex((t) => t.uri === startUri);
    const ordered = startIndex >= 0 ? tracks.slice(startIndex) : tracks;
    return ordered.map((t) => t.uri).filter((u): u is string => Boolean(u)).slice(0, 100);
  }

  async function handleSpotifySelectTrack(track: SpotifyApiTrack) {
    if (!track.uri) return;
    const contextTracks = spotifyQueueContext ?? spotifyLibrary.tracks;
    const queueUris = buildQueueUris(contextTracks, track.uri);
    await sendSpotifyPlayback("play", queueUris.length > 1 ? { uris: queueUris } : { uri: track.uri });
  }

  async function handleSpotifyPlayUri(
    uri: string,
    kind: "track" | "playlist",
    contextTracks?: SpotifyApiTrack[],
    contextUri?: string | null,
  ) {
    setSpotifyQueueContext(contextTracks && contextTracks.length > 0 ? contextTracks : null);
    if (kind === "playlist") {
      await sendSpotifyPlayback("play", { context_uri: uri });
      return;
    }
    if (contextUri) {
      await sendSpotifyPlayback("play", { context_uri: contextUri, uri });
      return;
    }
    if (contextTracks && contextTracks.length > 0) {
      const queueUris = buildQueueUris(contextTracks, uri);
      await sendSpotifyPlayback("play", queueUris.length > 1 ? { uris: queueUris } : { uri });
      return;
    }
    await sendSpotifyPlayback("play", { uri });
  }

  async function handleSpotifySeek(positionMs: number) {
    await sendSpotifyPlayback("seek", { position_ms: Math.max(0, Math.round(positionMs)) });
  }

  async function handleSpotifyShuffle(nextShuffle: boolean) {
    const previous = spotifyShuffle;
    setSpotifyShuffle(nextShuffle);
    const ok = await sendSpotifyPlayback("shuffle", { shuffle: nextShuffle });
    if (!ok) setSpotifyShuffle(previous);
  }

  async function handleSpotifyCycleRepeat() {
    const previous = spotifyRepeatMode;
    const next: SpotifyRepeatMode = previous === "off" ? "context" : previous === "context" ? "track" : "off";
    setSpotifyRepeatMode(next);
    const ok = await sendSpotifyPlayback("repeat", { repeat_mode: next });
    if (!ok) setSpotifyRepeatMode(previous);
  }

  async function handleSpotifyPrevious() {
    await sendSpotifyPlayback("previous");
  }

  async function handleSpotifyNext() {
    await sendSpotifyPlayback("next");
  }

  async function handleSpotifyTogglePlay() {
    const nextPaused = !spotifyPaused;
    const previous = spotifyPaused;
    setSpotifyOptimisticPaused(nextPaused);
    const ok = await sendSpotifyPlayback(nextPaused ? "pause" : "play");
    if (!ok) setSpotifyOptimisticPaused(previous);
  }

  async function handleEmailArchive() {
    const active = emailTabs.active;
    if (!active) return;
    if (active.kind === "view" && active.email.gmail_message_id) {
      const gmailMessageId = active.email.gmail_message_id;
      setEmailActionLoadingId(gmailMessageId);
      try {
        await archiveEmail(gmailMessageId, active.email.email_account_id ?? undefined);
        emailTabs.closeEmailTabById(gmailMessageId);
      } finally {
        setEmailActionLoadingId(null);
      }
    } else if (active.kind === "list" && active.viewingEmail?.gmail_message_id) {
      const gmailMessageId = active.viewingEmail.gmail_message_id;
      setEmailActionLoadingId(gmailMessageId);
      try {
        await archiveEmail(gmailMessageId, active.viewingEmail.email_account_id ?? undefined);
        emailTabs.backToListInTab(emailTabs.activeIndex);
      } finally {
        setEmailActionLoadingId(null);
      }
    }
  }

  async function handleEmailTrash() {
    const active = emailTabs.active;
    if (!active) return;
    if (active.kind === "view" && active.email.gmail_message_id) {
      const gmailMessageId = active.email.gmail_message_id;
      setEmailActionLoadingId(gmailMessageId);
      try {
        await trashEmail(gmailMessageId, active.email.email_account_id ?? undefined);
        emailTabs.closeEmailTabById(gmailMessageId);
      } finally {
        setEmailActionLoadingId(null);
      }
    } else if (active.kind === "list" && active.viewingEmail?.gmail_message_id) {
      const gmailMessageId = active.viewingEmail.gmail_message_id;
      setEmailActionLoadingId(gmailMessageId);
      try {
        await trashEmail(gmailMessageId, active.viewingEmail.email_account_id ?? undefined);
        emailTabs.backToListInTab(emailTabs.activeIndex);
      } finally {
        setEmailActionLoadingId(null);
      }
    }
  }

  async function handleEmailTogglePin() {
    const active = emailTabs.active;
    if (!active) return;
    if (active.kind === "view" && active.email.gmail_message_id) {
      const gmailMessageId = active.email.gmail_message_id;
      setEmailActionLoadingId(gmailMessageId);
      try {
        if (active.email.is_pinned) {
          const res = await unpinEmail(gmailMessageId);
          emailTabs.updateEmailTab(gmailMessageId, { is_pinned: res.is_pinned });
        } else {
          const res = await pinEmail(gmailMessageId, active.email.email_account_id ?? undefined);
          emailTabs.updateEmailTab(gmailMessageId, { is_pinned: res.is_pinned, id: res.id });
        }
      } finally {
        setEmailActionLoadingId(null);
      }
    } else if (active.kind === "list" && active.viewingEmail?.gmail_message_id) {
      const gmailMessageId = active.viewingEmail.gmail_message_id;
      setEmailActionLoadingId(gmailMessageId);
      try {
        if (active.viewingEmail.is_pinned) {
          const res = await unpinEmail(gmailMessageId);
          emailTabs.updateListViewingEmail(emailTabs.activeIndex, { is_pinned: res.is_pinned });
        } else {
          const res = await pinEmail(gmailMessageId, active.viewingEmail.email_account_id ?? undefined);
          emailTabs.updateListViewingEmail(emailTabs.activeIndex, { is_pinned: res.is_pinned, id: res.id });
        }
      } finally {
        setEmailActionLoadingId(null);
      }
    }
  }

  if (!convs.activeConversation) return (
    <div className="flex h-full w-full items-center justify-center bg-[var(--ml-bg-base)] text-gray-400">
      Loading…
    </div>
  );

  const isNoteActive = activeTabType === "note" && editor.openNotes.length > 0;
  const isEmailActive = activeTabType === "email" && emailTabs.openTabs.length > 0;
  const isSpotifyActive = activeTabType === "spotify" && spotifyTabOpen;
  const isWhatsappActive = activeTabType === "whatsapp" && whatsappTabs.openTabs.length > 0;
  const isCalendarActive = activeTabType === "calendar" && calendarTabOpen;
  const isBooksActive = activeTabType === "books" && booksTabOpen;
  const isBookReaderActive = activeTabType === "book" && bookTabs.openTabs.length > 0;
  const isNativePlatform = Capacitor.isNativePlatform();
  const isStudyActive = activeTabType === "study" && studyTabs.openTabs.length > 0;
  const isMemoGraphActive = activeTabType === "memograph" && memographTabOpen;

  const _LEVEL_ORDER: Record<string, number> = { regular: 0, plus: 1, pro: 2 };
  const _userLevel = user.access_level ?? "regular";
  const modelAttributionEnabled =
    flags.model_attribution_enabled &&
    _LEVEL_ORDER[_userLevel] >= _LEVEL_ORDER[flags.model_attribution_min_level ?? "regular"];

  const _d = new Date();
  const today = `${_d.getFullYear()}-${String(_d.getMonth() + 1).padStart(2, "0")}-${String(_d.getDate()).padStart(2, "0")}`;
  const todayItems = suggestions.items.filter((i) => !i.done && i.due_date === today);
  const urgentCount = todayItems.length;

  function handleGenerate() {
    if (notes.length === 0) return;
    const stripHtml = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    const combined = notes
      .slice(0, 15)
      .map((n) => `[${n.title?.trim() || "Untitled"}]\n${stripHtml(n.content)}`)
      .join("\n\n");
    suggestions.generateFromNote("Notes", combined);
  }

  return (
    <div className="h-full w-full bg-[var(--ml-bg-surface)] text-gray-100 flex relative">

      {menuData && (
        <div className="absolute z-[9999]" style={{ top: menuData.top, left: menuData.left, width: 160 }}>
          <div className="bg-[var(--ml-bg-panel)] border border-[var(--ml-bg-hover)] rounded-xl shadow-xl overflow-hidden">
            {menuData.type === "note" && (
              <>
                <button onClick={() => { handleOpenNote(menuData.item); setMenuData(null); }} className="w-full text-left px-4 py-2.5 hover:bg-[var(--ml-bg-hover)] text-sm">Edit</button>
                <button onClick={() => { handleDeleteNote(menuData.item.id); setMenuData(null); }} className="w-full text-left px-4 py-2.5 hover:bg-[var(--ml-bg-danger)] text-red-400 text-sm">Delete</button>
              </>
            )}
            {menuData.type === "conversation" && (
              <>
                <button onClick={() => { convs.handleRename(menuData.item); setMenuData(null); }} className="w-full text-left px-4 py-2.5 hover:bg-[var(--ml-bg-hover)] text-sm">Rename</button>
                <button onClick={() => { convs.handleDeleteConv(menuData.item.id); setMenuData(null); }} className="w-full text-left px-4 py-2.5 hover:bg-[var(--ml-bg-danger)] text-red-400 text-sm">Delete</button>
              </>
            )}
          </div>
        </div>
      )}


      <Sidebar
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        notes={notes}
        setNotes={setNotes}
        showNotes={showNotes}
        setShowNotes={setShowNotes}
        showConversations={showConversations}
        setShowConversations={setShowConversations}
        conversations={convs.conversations}
        activeConversation={convs.activeConversation}
        overlay={!isDesktop}
        onNoteClick={(note: Note) => { handleOpenNote(note); closeSidebarOnCompactLayout(); }}
        onNewNote={() => { handleOpenNote({ id: null, title: "", content: "" }); closeSidebarOnCompactLayout(); }}
        onNoteMenu={(note: Note, rect: DOMRect) => setMenuData({ type: "note", item: note, top: rect.bottom + 4, left: rect.right - 160 })}
        onConversationClick={(conv: Conversation) => { convs.handleSelectConversation(conv); setActiveTabType("chat"); closeSidebarOnCompactLayout(); }}
        onNewChat={() => {
          if (convs.activeConversation?.id === TEMP_ID && !convs.activeConversation.messages.length) {
            setActiveTabType("chat"); chat.textareaRef.current?.focus(); closeSidebarOnCompactLayout(); return;
          }
          convs.startNewChat();
          setActiveTabType("chat");
          setTimeout(() => chat.textareaRef.current?.focus(), 0);
          closeSidebarOnCompactLayout();
        }}
        onConversationMenu={(conv: Conversation, rect: DOMRect) => setMenuData({ type: "conversation", item: conv, top: rect.bottom + 4, left: rect.right - 160 })}
        onOpenRecycleBin={() => setRecycleBinOpen(true)}
        onNotesUploaded={(uploaded) => {
          const stripHtml = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
          const combined = uploaded
            .slice(0, 5)
            .map((n: any) => `[${n.title?.trim() || "Untitled"}]\n${stripHtml(n.content || "")}`)
            .join("\n\n");
          if (combined.trim()) suggestions.generateFromNote("Uploaded Notes", combined);
        }}
        workspaces={workspaceHook.workspaces}
        activeWorkspace={workspaceHook.activeWorkspace}
        onSwitchWorkspace={async (ws: Workspace) => {
          const currentWsId = workspaceHook.activeWorkspace?.id;
          if (currentWsId && currentWsId !== ws.id) {
            // Current workspace's tabs are already kept up to date in localStorage by the
            // continuous snapshot effect above — just stage restores for the workspace we're entering.
            try {
              const raw = localStorage.getItem(`memolink_tabs_ws_${ws.id}`);
              if (raw) {
                const saved = JSON.parse(raw);
                const savedTabType = saved.activeTabType === "note" ? "note" : "chat";
                pendingChatRestoreRef.current = { chatIds: saved.chatIds ?? [], activeChatId: saved.activeChatId ?? null };
                pendingNoteRestoreRef.current = { wsId: ws.id, noteIds: saved.noteIds ?? [], activeNoteId: saved.activeNoteId ?? null, activeTabType: savedTabType };
              }
            } catch { /* ignore corrupt saved state */ }

            editor.closeAllNotes();
            setSpotifyTabOpen(false);
            setActiveTabType("chat");
          }
          await workspaceHook.switchWorkspace(ws);
        }}
        onManageWorkspaces={() => setShowWorkspaceManager(true)}
        evalStatus={evalStatus}
      />

      <div className="flex-1 flex flex-col h-full overflow-hidden">
        <>
        {/* ── Unified tab bar ───────────────────────────────────────────── */}
        {/* Hidden on Capacitor when a book reader is in fullscreen so content fills the whole screen */}
        <div id="tour-tab-bar" className={`flex bg-[var(--ml-bg-bar)] border-b border-[var(--ml-bg-panel)] shrink-0 ${isNativePlatform && isBookReaderActive && bookReaderFullscreen ? "hidden" : ""}`} style={{ minHeight: 40 }}>

          {/* Sidebar toggle - all screen sizes, left of tabs */}
          {!sidebarOpen && (
            <button
              onClick={() => setSidebarOpen(true)}
              className="flex shrink-0 h-full px-3 items-center justify-center hover:bg-[var(--ml-bg-panel)] transition border-r border-[var(--ml-bg-panel)]"
              aria-label="Open sidebar"
            >
              <img src={`${import.meta.env.BASE_URL}memolink-icon.png`} alt="" className="h-5 w-5 rounded-md bg-white object-cover" />
            </button>
          )}

          {/* Scrollable tabs - hidden in split modes (each panel has its own tab bar) */}
          <div className="flex items-center overflow-x-auto flex-1">

            {/* Chat tabs */}
            {activeLayoutMode === "stacked" && convs.openChats.map((chat, i) => {
              const isActive = activeTabType === "chat" && convs.activeConversation?.id === chat.id;
              const isDragOver = dragOverTab?.type === "chat" && dragOverTab.index === i && dragSrcRef.current?.index !== i;
              return (
                <div
                  key={chat.id}
                  draggable
                  onDragStart={() => { dragSrcRef.current = { type: "chat", index: i }; }}
                  onDragOver={(e) => { e.preventDefault(); setDragOverTab({ type: "chat", index: i }); }}
                  onDrop={(e) => { e.preventDefault(); handleTabDrop("chat", i); setDragOverTab(null); }}
                  onDragEnd={() => { dragSrcRef.current = null; setDragOverTab(null); }}
                  onClick={() => handleActivateChat(chat.id)}
                  onDoubleClick={(e) => { e.stopPropagation(); handleActivateChat(chat.id); setEditingChatTabId(chat.id); setEditingChatTitle(convLabel(chat)); }}
                  onTouchStart={() => startLongPress(() => { handleActivateChat(chat.id); setEditingChatTabId(chat.id); setEditingChatTitle(convLabel(chat)); })}
                  onTouchEnd={cancelLongPress}
                  onTouchMove={cancelLongPress}
                  className={`flex items-center gap-1.5 px-3 h-10 text-xs cursor-grab active:cursor-grabbing border-b-2 transition shrink-0 select-none ${
                    isActive ? "border-indigo-500 text-white bg-[var(--ml-bg-base)]" : "border-transparent text-gray-500 hover:text-gray-300 hover:bg-[var(--ml-bg-base)]"
                  } ${isDragOver ? "border-l-2 border-l-indigo-400" : ""}`}
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="w-3 h-3 shrink-0 opacity-70" fill="currentColor" viewBox="0 0 16 16">
                    <path d="M2.678 11.894a1 1 0 0 1 .287.801 11 11 0 0 1-.398 2c1.395-.323 2.247-.697 2.634-.893a1 1 0 0 1 .71-.074A8 8 0 0 0 8 14c3.996 0 7-2.807 7-6s-3.004-6-7-6-7 2.808-7 6c0 1.468.617 2.83 1.678 3.894z"/>
                  </svg>
                  {editingChatTabId === chat.id ? (
                    <input autoFocus value={editingChatTitle} onChange={(e) => setEditingChatTitle(e.target.value)}
                      onBlur={() => { convs.renameInline(chat, editingChatTitle); setEditingChatTabId(null); }}
                      onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); convs.renameInline(chat, editingChatTitle); setEditingChatTabId(null); } if (e.key === "Escape") { e.preventDefault(); setEditingChatTabId(null); } }}
                      onClick={(e) => e.stopPropagation()} className="max-w-[120px] bg-transparent border-b border-indigo-400 outline-none text-white text-xs" />
                  ) : (
                    <span className="max-w-[120px] truncate">{convLabel(chat)}</span>
                  )}
                  <button onClick={(e) => { e.stopPropagation(); handleCloseChat(chat.id); }} className="text-gray-600 hover:text-gray-300 w-3.5 h-3.5 flex items-center justify-center rounded-sm hover:bg-[var(--ml-bg-hover)] transition leading-none">×</button>
                </div>
              );
            })}

            {/* Note tabs */}
            {activeLayoutMode === "stacked" && editor.openNotes.map((note, i) => {
              const isActive = activeTabType === "note" && editor.activeIndex === i;
              const isDragOver = dragOverTab?.type === "note" && dragOverTab.index === i && dragSrcRef.current?.index !== i;
              return (
                <div
                  key={note.note.id ?? `new-${i}`}
                  draggable
                  onDragStart={() => { dragSrcRef.current = { type: "note", index: i }; }}
                  onDragOver={(e) => { e.preventDefault(); setDragOverTab({ type: "note", index: i }); }}
                  onDrop={(e) => { e.preventDefault(); handleTabDrop("note", i); setDragOverTab(null); }}
                  onDragEnd={() => { dragSrcRef.current = null; setDragOverTab(null); }}
                  onClick={() => { editor.setActiveIndex(i); setActiveTabType("note"); }}
                  onDoubleClick={(e) => { e.stopPropagation(); editor.setActiveIndex(i); setActiveTabType("note"); setEditingNoteTab(i); }}
                  onTouchStart={() => startLongPress(() => { editor.setActiveIndex(i); setActiveTabType("note"); setEditingNoteTab(i); })}
                  onTouchEnd={cancelLongPress}
                  onTouchMove={cancelLongPress}
                  className={`flex items-center gap-1.5 px-3 h-10 text-xs cursor-grab active:cursor-grabbing border-b-2 transition shrink-0 select-none ${
                    isActive ? "border-indigo-500 text-white bg-[var(--ml-bg-base)]" : "border-transparent text-gray-500 hover:text-gray-300 hover:bg-[var(--ml-bg-base)]"
                  } ${isDragOver ? "border-l-2 border-l-indigo-400" : ""}`}
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="w-3 h-3 shrink-0 opacity-70" fill="currentColor" viewBox="0 0 16 16">
                    <path d="M2 2a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v13.5a.5.5 0 0 1-.777.416L8 13.101l-5.223 2.815A.5.5 0 0 1 2 15.5zm2-1a1 1 0 0 0-1 1v12.566l4.723-2.482a.5.5 0 0 1 .554 0L13 14.566V2a1 1 0 0 0-1-1z"/>
                  </svg>
                  {editingNoteTab === i ? (
                    <input autoFocus value={note.titleDraft} onChange={(e) => editor.setNoteTitleDraft(e.target.value)}
                      onBlur={() => { handleRenameNoteTab(i); setEditingNoteTab(null); }}
                      onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); handleRenameNoteTab(i); setEditingNoteTab(null); } if (e.key === "Escape") { e.preventDefault(); setEditingNoteTab(null); } }}
                      onClick={(e) => e.stopPropagation()} className="max-w-[120px] bg-transparent border-b border-indigo-400 outline-none text-white text-xs" />
                  ) : (
                    <span className="max-w-[120px] truncate">{note.titleDraft.trim() || "Untitled"}</span>
                  )}
                  <button onClick={(e) => { e.stopPropagation(); editor.closeNote(i); }} className="text-gray-600 hover:text-gray-300 w-3.5 h-3.5 flex items-center justify-center rounded-sm hover:bg-[var(--ml-bg-hover)] transition leading-none">×</button>
                </div>
              );
            })}

            {/* Email tabs */}
            {activeLayoutMode === "stacked" && emailTabs.openTabs.map((tab, i) => {
              const isActive = activeTabType === "email" && emailTabs.activeIndex === i;
              const isDragOver = dragOverTab?.type === "email" && dragOverTab.index === i && dragSrcRef.current?.index !== i;
              let tabLabel: string;
              if (tab.kind === "compose") {
                tabLabel = "New Mail";
              } else if (tab.kind === "list") {
                const scope = tab.scope;
                if (scope.type === "all") {
                  tabLabel = "All Mail";
                } else {
                  const acc = emailAccounts.find((a) => a.id === scope.accountId);
                  tabLabel = acc?.display_name || acc?.email || "Account";
                }
              } else {
                tabLabel = tab.email.subject || "(no subject)";
              }
              return (
                <div
                  key={tab.kind === "view" ? (tab.email.gmail_message_id ?? `email-${i}`) : tab.kind === "compose" ? tab.composeId : (tab.scope.type === "all" ? "list-all" : `list-${tab.scope.accountId}`)}
                  draggable
                  onDragStart={() => { dragSrcRef.current = { type: "email", index: i }; }}
                  onDragOver={(e) => { e.preventDefault(); setDragOverTab({ type: "email", index: i }); }}
                  onDrop={(e) => { e.preventDefault(); handleTabDrop("email", i); setDragOverTab(null); }}
                  onDragEnd={() => { dragSrcRef.current = null; setDragOverTab(null); }}
                  onClick={() => { emailTabs.setActiveIndex(i); setActiveTabType("email"); }}
                  className={`flex items-center gap-1.5 px-3 h-10 text-xs cursor-grab active:cursor-grabbing border-b-2 transition shrink-0 select-none ${
                    isActive ? "border-indigo-500 text-white bg-[var(--ml-bg-base)]" : "border-transparent text-gray-500 hover:text-gray-300 hover:bg-[var(--ml-bg-base)]"
                  } ${isDragOver ? "border-l-2 border-l-indigo-400" : ""}`}
                >
                  {tab.kind === "compose" ? (
                    <svg xmlns="http://www.w3.org/2000/svg" className="w-3 h-3 shrink-0 opacity-70" fill="currentColor" viewBox="0 0 16 16">
                      <path d="M12.146.146a.5.5 0 0 1 .708 0l3 3a.5.5 0 0 1 0 .708l-10 10a.5.5 0 0 1-.168.11l-5 2a.5.5 0 0 1-.65-.65l2-5a.5.5 0 0 1 .11-.168zM11.207 2.5 13.5 4.793 14.793 3.5 12.5 1.207zM9.5 2.207 12.793 5.5 11.5 6.793 8.207 3.5z"/>
                    </svg>
                  ) : (
                    <svg xmlns="http://www.w3.org/2000/svg" className="w-3 h-3 shrink-0 opacity-70" fill="currentColor" viewBox="0 0 16 16">
                      <path d="M0 4a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H2a2 2 0 0 1-2-2zm2-1a1 1 0 0 0-1 1v.217l7 4.2 7-4.2V4a1 1 0 0 0-1-1zm13 2.383-4.708 2.825L15 11.105zm-.034 6.876-5.64-3.471L8 9.583l-1.326-.795-5.64 3.47A1 1 0 0 0 2 13h12a1 1 0 0 0 .966-.741M1 11.105l4.708-2.897L1 5.383z"/>
                    </svg>
                  )}
                  <span className="max-w-[120px] truncate">{tabLabel}</span>
                  <button onClick={(e) => { e.stopPropagation(); emailTabs.closeEmailTab(i); }} className="text-gray-600 hover:text-gray-300 w-3.5 h-3.5 flex items-center justify-center rounded-sm hover:bg-[var(--ml-bg-hover)] transition leading-none">×</button>
                </div>
              );
            })}

            {/* WhatsApp tabs */}
            {activeLayoutMode === "stacked" && whatsappTabs.openTabs.map((tab, i) => {
              const isActive = activeTabType === "whatsapp" && whatsappTabs.activeIndex === i;
              const isDragOver = dragOverTab?.type === "whatsapp" && dragOverTab.index === i && dragSrcRef.current?.index !== i;
              return (
                <div
                  key={tab.chat.id}
                  draggable
                  onDragStart={() => { dragSrcRef.current = { type: "whatsapp", index: i }; }}
                  onDragOver={(e) => { e.preventDefault(); setDragOverTab({ type: "whatsapp", index: i }); }}
                  onDrop={(e) => { e.preventDefault(); handleTabDrop("whatsapp", i); setDragOverTab(null); }}
                  onDragEnd={() => { dragSrcRef.current = null; setDragOverTab(null); }}
                  onClick={() => { whatsappTabs.setActiveIndex(i); setActiveTabType("whatsapp"); }}
                  className={`flex items-center gap-1.5 px-3 h-10 text-xs cursor-grab active:cursor-grabbing border-b-2 transition shrink-0 select-none ${
                    isActive ? "border-green-500 text-white bg-[var(--ml-bg-base)]" : "border-transparent text-gray-500 hover:text-gray-300 hover:bg-[var(--ml-bg-base)]"
                  } ${isDragOver ? "border-l-2 border-l-green-400" : ""}`}
                >
                  <svg viewBox="0 0 16 16" className="w-3 h-3 shrink-0 text-green-500" fill="currentColor">
                    <path d="M13.601 2.326A7.85 7.85 0 0 0 7.994 0C3.627 0 .068 3.558.064 7.926c0 1.399.366 2.76 1.057 3.965L0 16l4.204-1.102a7.93 7.93 0 0 0 3.79.965h.004c4.368 0 7.926-3.558 7.93-7.93a7.9 7.9 0 0 0-2.327-5.607M7.994 14.521a6.6 6.6 0 0 1-3.356-.92l-.24-.144-2.494.654.666-2.433-.156-.251a6.56 6.56 0 0 1-1.007-3.505c0-3.626 2.957-6.584 6.591-6.584a6.56 6.56 0 0 1 4.66 1.931 6.56 6.56 0 0 1 1.928 4.66c-.004 3.639-2.961 6.592-6.592 6.592m3.615-4.934c-.197-.099-1.17-.578-1.353-.646-.182-.065-.315-.099-.445.099-.133.197-.513.646-.627.775-.114.133-.232.148-.43.05-.197-.1-.836-.308-1.592-.985-.59-.525-.985-1.175-1.103-1.372-.114-.198-.011-.304.084-.404.084-.089.197-.232.296-.346.1-.114.133-.198.198-.33.065-.134.034-.248-.015-.347-.05-.1-.347-.836-.476-1.146-.129-.31-.262-.27-.353-.275-.084-.005-.182-.005-.282-.005a.5.5 0 0 0-.345.16c-.114.114-.444.43-.444 1.05 0 .62.456 1.215.516 1.298.065.084 1.052 1.605 2.55 2.187.355.137.633.219.852.28.36.099.687.084.946.05.297-.034.913-.373 1.04-.74.13-.365.13-.677.09-.742-.04-.06-.214-.13-.41-.23z"/>
                  </svg>
                  <span className="max-w-[120px] truncate">{tab.chat.name}</span>
                  <button onClick={(e) => { e.stopPropagation(); whatsappTabs.closeWhatsappTab(i); }} className="text-gray-600 hover:text-gray-300 w-3.5 h-3.5 flex items-center justify-center rounded-sm hover:bg-[var(--ml-bg-hover)] transition leading-none">×</button>
                </div>
              );
            })}

            {/* Spotify app tab */}
            {activeLayoutMode === "stacked" && spotifyTabOpen && (
              <div
                onClick={() => setActiveTabType("spotify")}
                className={`flex items-center gap-1.5 px-3 h-10 text-xs cursor-pointer border-b-2 transition shrink-0 select-none ${
                  activeTabType === "spotify" ? "border-emerald-500 text-white bg-[var(--ml-bg-base)]" : "border-transparent text-gray-500 hover:text-gray-300 hover:bg-[var(--ml-bg-base)]"
                }`}
              >
                <svg viewBox="0 0 24 24" className="w-3.5 h-3.5 shrink-0 text-emerald-400" fill="currentColor">
                  <path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20m4.59 14.42a.62.62 0 0 1-.86.2c-2.35-1.43-5.3-1.75-8.78-.96a.62.62 0 1 1-.27-1.21c3.8-.87 7.08-.49 9.7 1.11.29.18.38.56.21.86m1.22-2.72a.77.77 0 0 1-1.06.25c-2.68-1.65-6.77-2.13-9.94-1.16a.77.77 0 1 1-.45-1.48c3.62-1.1 8.12-.57 11.2 1.32.36.22.47.7.25 1.07m.1-2.84C14.7 8.95 9.39 8.77 6.32 9.7a.92.92 0 1 1-.54-1.76c3.52-1.07 9.38-.86 13.07 1.33a.92.92 0 0 1-.94 1.59"/>
                </svg>
                <span className="max-w-[120px] truncate">Spotify</span>
                <button
                  onClick={(e) => { e.stopPropagation(); setSpotifyTabOpen(false); }}
                  className="text-gray-600 hover:text-gray-300 w-3.5 h-3.5 flex items-center justify-center rounded-sm hover:bg-[var(--ml-bg-hover)] transition leading-none"
                >
                  ×
                </button>
              </div>
            )}

            {/* Calendar app tab */}
            {activeLayoutMode === "stacked" && calendarTabOpen && (
              <div
                onClick={() => setActiveTabType("calendar")}
                className={`flex items-center gap-1.5 px-3 h-10 text-xs cursor-pointer border-b-2 transition shrink-0 select-none ${
                  activeTabType === "calendar" ? "border-indigo-500 text-white bg-[var(--ml-bg-base)]" : "border-transparent text-gray-500 hover:text-gray-300 hover:bg-[var(--ml-bg-base)]"
                }`}
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="w-3 h-3 shrink-0 text-indigo-400" fill="currentColor" viewBox="0 0 16 16">
                  <path d="M3.5 0a.5.5 0 0 1 .5.5V1h8V.5a.5.5 0 0 1 1 0V1h1a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H2a2 2 0 0 1-2-2V3a2 2 0 0 1 2-2h1V.5a.5.5 0 0 1 .5-.5M1 4v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V4z"/>
                </svg>
                <span className="max-w-[120px] truncate">Calendar</span>
                <button
                  onClick={(e) => { e.stopPropagation(); setCalendarTabOpen(false); }}
                  className="text-gray-600 hover:text-gray-300 w-3.5 h-3.5 flex items-center justify-center rounded-sm hover:bg-[var(--ml-bg-hover)] transition leading-none"
                >
                  ×
                </button>
              </div>
            )}

            {/* Books app tab */}
            {activeLayoutMode === "stacked" && booksTabOpen && (
              <div
                onClick={() => setActiveTabType("books")}
                className={`flex items-center gap-1.5 px-3 h-10 text-xs cursor-pointer border-b-2 transition shrink-0 select-none ${
                  activeTabType === "books" ? "border-amber-500 text-white bg-[var(--ml-bg-base)]" : "border-transparent text-gray-500 hover:text-gray-300 hover:bg-[var(--ml-bg-base)]"
                }`}
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="w-3 h-3 shrink-0 text-amber-400" fill="currentColor" viewBox="0 0 16 16">
                  <path d="M1 2.828c.885-.37 2.154-.769 3.388-.893 1.33-.134 2.458.063 3.112.752v9.746c-.935-.53-2.12-.603-3.213-.493-1.18.12-2.37.461-3.287.811zm7.5-.141c.654-.689 1.782-.886 3.112-.752 1.234.124 2.503.523 3.388.893v9.923c-.918-.35-2.107-.692-3.287-.81-1.094-.111-2.278-.039-3.213.492zM8 1.783C7.015.936 5.587.81 4.287.94c-1.514.153-3.042.672-3.994 1.105A.5.5 0 0 0 0 2.5v11a.5.5 0 0 0 .707.455c.882-.4 2.303-.881 3.68-1.02 1.409-.142 2.59.087 3.223.877a.5.5 0 0 0 .78 0c.633-.79 1.814-1.019 3.222-.877 1.378.139 2.8.62 3.681 1.02A.5.5 0 0 0 16 13.5v-11a.5.5 0 0 0-.293-.455c-.952-.433-2.48-.952-3.994-1.105C10.413.809 8.985.936 8 1.783"/>
                </svg>
                <span className="max-w-[120px] truncate">Books</span>
                <button
                  onClick={(e) => { e.stopPropagation(); setBooksTabOpen(false); }}
                  className="text-gray-600 hover:text-gray-300 w-3.5 h-3.5 flex items-center justify-center rounded-sm hover:bg-[var(--ml-bg-hover)] transition leading-none"
                >
                  ×
                </button>
              </div>
            )}

            {/* Book reader tabs — each opened book gets its own tab */}
            {activeLayoutMode === "stacked" && bookTabs.openTabs.map((tab, i) => {
              const isActive = activeTabType === "book" && bookTabs.activeIndex === i;
              return (
                <div
                  key={tab.book.id}
                  onClick={() => { bookTabs.setActiveIndex(i); setActiveTabType("book"); setBookReaderFullscreen(false); }}
                  className={`flex items-center gap-1.5 px-3 h-10 text-xs cursor-pointer border-b-2 transition shrink-0 select-none ${
                    isActive ? "border-amber-500 text-white bg-[var(--ml-bg-base)]" : "border-transparent text-gray-500 hover:text-gray-300 hover:bg-[var(--ml-bg-base)]"
                  }`}
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="w-3 h-3 shrink-0 text-amber-400" fill="currentColor" viewBox="0 0 16 16">
                    <path d="M1 2.828c.885-.37 2.154-.769 3.388-.893 1.33-.134 2.458.063 3.112.752v9.746c-.935-.53-2.12-.603-3.213-.493-1.18.12-2.37.461-3.287.811zm7.5-.141c.654-.689 1.782-.886 3.112-.752 1.234.124 2.503.523 3.388.893v9.923c-.918-.35-2.107-.692-3.287-.81-1.094-.111-2.278-.039-3.213.492zM8 1.783C7.015.936 5.587.81 4.287.94c-1.514.153-3.042.672-3.994 1.105A.5.5 0 0 0 0 2.5v11a.5.5 0 0 0 .707.455c.882-.4 2.303-.881 3.68-1.02 1.409-.142 2.59.087 3.223.877a.5.5 0 0 0 .78 0c.633-.79 1.814-1.019 3.222-.877 1.378.139 2.8.62 3.681 1.02A.5.5 0 0 0 16 13.5v-11a.5.5 0 0 0-.293-.455c-.952-.433-2.48-.952-3.994-1.105C10.413.809 8.985.936 8 1.783"/>
                  </svg>
                  <span className="max-w-[120px] truncate">{tab.book.title}</span>
                  <button
                    onClick={(e) => { e.stopPropagation(); closeBookTabFromTabBar(i); }}
                    className="text-gray-600 hover:text-gray-300 w-3.5 h-3.5 flex items-center justify-center rounded-sm hover:bg-[var(--ml-bg-hover)] transition leading-none"
                  >
                    ×
                  </button>
                </div>
              );
            })}

            {/* MemoGraph app tab */}
            {activeLayoutMode === "stacked" && memographTabOpen && (
              <div
                onClick={() => setActiveTabType("memograph")}
                className={`flex items-center gap-1.5 px-3 h-10 text-xs cursor-pointer border-b-2 transition shrink-0 select-none ${
                  activeTabType === "memograph" ? "border-indigo-500 text-white bg-[var(--ml-bg-base)]" : "border-transparent text-gray-500 hover:text-gray-300 hover:bg-[var(--ml-bg-base)]"
                }`}
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="w-3 h-3 shrink-0 text-indigo-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                  <circle cx="5" cy="12" r="2.5" /><circle cx="19" cy="5" r="2.5" /><circle cx="19" cy="19" r="2.5" />
                  <circle cx="12" cy="8" r="2.5" /><circle cx="12" cy="16" r="2.5" />
                  <line x1="7.2" y1="11" x2="10" y2="9" /><line x1="14" y1="9" x2="16.8" y2="6.5" />
                  <line x1="7.2" y1="13" x2="10" y2="15" /><line x1="14" y1="15" x2="16.8" y2="17.5" />
                  <line x1="12" y1="10.5" x2="12" y2="13.5" />
                </svg>
                <span className="max-w-[120px] truncate">MemoGraph</span>
                <button
                  onClick={(e) => { e.stopPropagation(); setMemographTabOpen(false); }}
                  className="text-gray-600 hover:text-gray-300 w-3.5 h-3.5 flex items-center justify-center rounded-sm hover:bg-[var(--ml-bg-hover)] transition leading-none"
                >
                  ×
                </button>
              </div>
            )}

            {/* Study tool tabs — each opened study tool gets its own tab */}
            {activeLayoutMode === "stacked" && studyTabs.openTabs.map((tab, i) => {
              const isActive = activeTabType === "study" && studyTabs.activeIndex === i;
              const meta = STUDY_TABS.find((t) => t.id === tab.tool);
              const style = getStudyToolStyle(tab.tool);
              return (
                <div
                  key={tab.tool}
                  onClick={() => { studyTabs.setActiveIndex(i); setActiveTabType("study"); }}
                  className={`flex items-center gap-1.5 px-3 h-10 text-xs cursor-pointer border-b-2 transition shrink-0 select-none ${
                    isActive ? "border-emerald-500 text-white bg-[var(--ml-bg-base)]" : "border-transparent text-gray-500 hover:text-gray-300 hover:bg-[var(--ml-bg-base)]"
                  }`}
                >
                  <StudyToolIcon tool={tab.tool} className={`w-3.5 h-3.5 shrink-0 ${isActive ? style.fg : ""}`} />
                  <span className="max-w-[120px] truncate">{meta?.label}</span>
                  <button
                    onClick={(e) => { e.stopPropagation(); studyTabs.closeStudyTab(i); }}
                    className="text-gray-600 hover:text-gray-300 w-3.5 h-3.5 flex items-center justify-center rounded-sm hover:bg-[var(--ml-bg-hover)] transition leading-none"
                  >
                    ×
                  </button>
                </div>
              );
            })}

          </div>{/* end scrollable tabs */}

          {/* User info - outside overflow so the bell tooltip can extend below freely */}
          <div className="shrink-0 flex items-center gap-3 px-4 text-xs text-gray-500">
            {/* Bell / reminders - always visible */}
            <div
              className="relative"
              onMouseEnter={() => { if (urgentCount > 0) setBellTooltipVisible(true); }}
              onMouseLeave={() => setBellTooltipVisible(false)}
            >
              <button
                onClick={() => setRightPanelOpen(true)}
                className={`relative flex items-center justify-center w-7 h-7 rounded-lg transition ${urgentCount > 0 ? "hover:bg-amber-500/10" : "hover:bg-[var(--ml-bg-hover)]"}`}
                title={urgentCount > 0 ? `${urgentCount} reminder${urgentCount > 1 ? "s" : ""} due today` : "Open suggestions & reminders"}
              >
                {urgentCount > 0 && <span className="animate-ping absolute inline-flex w-3.5 h-3.5 rounded-full bg-amber-400 opacity-30" />}
                <svg xmlns="http://www.w3.org/2000/svg" className={`relative w-4 h-4 ${urgentCount > 0 ? "text-amber-400" : "text-gray-500"}`} fill="currentColor" viewBox="0 0 16 16">
                  <path d="M8 16a2 2 0 0 0 2-2H6a2 2 0 0 0 2 2M8 1.918l-.797.161A4 4 0 0 0 4 6c0 .628-.134 2.197-.459 3.742-.16.767-.376 1.566-.663 2.258h10.244c-.287-.692-.502-1.49-.663-2.258C12.134 8.197 12 6.628 12 6a4 4 0 0 0-3.203-3.92zM14.22 12c.223.447.481.801.78 1H1c.299-.199.557-.553.78-1C2.68 10.2 3 6.88 3 6c0-2.42 1.72-4.44 4.005-4.901a1 1 0 1 1 1.99 0A5 5 0 0 1 13 6c0 .88.32 4.2 1.22 6"/>
                </svg>
                {urgentCount > 0 && (
                  <span className="absolute -top-1 -right-1 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-amber-500 text-[8px] font-bold text-black leading-none">
                    {urgentCount}
                  </span>
                )}
              </button>
              {bellTooltipVisible && urgentCount > 0 && (
                <div className="absolute right-0 top-full mt-1 z-[9999] w-56 rounded-xl bg-[var(--ml-bg-panel)] border border-amber-500/30 shadow-xl p-2.5">
                  <p className="text-[10px] font-semibold text-amber-400 uppercase tracking-wider mb-1.5">Due today</p>
                  <div className="overflow-y-auto max-h-40" onScroll={() => setBellTooltipVisible(false)}>
                    {todayItems.map((item) => (
                      <div key={item.id} className="py-0.5 border-b border-[var(--ml-bg-hover)] last:border-0">
                        <p className="text-[11px] text-gray-300 leading-snug">{item.text}</p>
                        {item.due_time && (
                          <p className="text-[10px] text-amber-400/70 mt-0.5">{item.due_time}</p>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* User avatar + dropdown */}
            <div className="relative">
              <button
                id="tour-user-menu"
                onClick={(e) => { e.stopPropagation(); setUserMenuOpen((v) => !v); }}
                className="relative flex items-center justify-center w-7 h-7 rounded-full bg-indigo-600 hover:bg-indigo-500 text-white text-[11px] font-bold transition"
                title={user.email}
              >
                {user.email.slice(0, 2).toUpperCase()}
                {user.is_admin && openFeedbackCount > 0 && (
                  <span className="absolute -top-1 -right-1 min-w-[14px] h-[14px] px-0.5 bg-red-500 text-white text-[9px] font-bold rounded-full flex items-center justify-center leading-none pointer-events-none">
                    {openFeedbackCount > 99 ? "99+" : openFeedbackCount}
                  </span>
                )}
              </button>

              {userMenuOpen && (
                <>
                  {!isDesktop && <div className="fixed inset-0 z-[9998] bg-black/50" onClick={() => setUserMenuOpen(false)} />}
                  <div className={`${isDesktop ? "absolute right-0 top-full mt-2 rounded-xl w-52 max-h-none" : "fixed inset-x-0 bottom-0 rounded-t-2xl max-h-[70vh]"} z-[9999] overflow-y-auto bg-[var(--ml-bg-panel)] border border-[var(--ml-bg-hover)] shadow-2xl py-1`}>
                  {/* Email header */}
                  <div className="px-3 py-2.5 border-b border-[var(--ml-bg-hover)]">
                    <p className="text-[11px] text-gray-500 truncate">{user.email}</p>
                  </div>

                  {isDesktop && (
                    <div className="px-3 py-2 border-b border-[var(--ml-bg-hover)]">
                      <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-1.5">Layout</p>
                      <div className="flex gap-1">
                        {([
                          ["stacked", "Stacked"] as const,
                          ["columns", "Side by side"] as const,
                          ["rows", "Top / bottom"] as const,
                        ]).map(([mode, label], idx) => (
                          <button
                            key={mode}
                            title={label}
                            onClick={() => { handleLayoutChange(mode); setUserMenuOpen(false); }}
                            className={`flex-1 flex flex-col items-center gap-1 py-1.5 rounded-lg transition text-[10px] ${layoutMode === mode ? "bg-indigo-600 text-white" : "text-gray-400 hover:bg-[var(--ml-bg-hover)] hover:text-gray-200"}`}
                          >
                            {idx === 0 && (
                              <svg viewBox="0 0 16 16" className="w-4 h-4" fill="currentColor">
                                <rect x="2" y="3" width="12" height="4" rx="1"/>
                                <rect x="2" y="9" width="12" height="4" rx="1"/>
                              </svg>
                            )}
                            {idx === 1 && (
                              <svg viewBox="0 0 16 16" className="w-4 h-4" fill="currentColor">
                                <rect x="2" y="3" width="5" height="10" rx="1"/>
                                <rect x="9" y="3" width="5" height="10" rx="1"/>
                              </svg>
                            )}
                            {idx === 2 && (
                              <svg viewBox="0 0 16 16" className="w-4 h-4" fill="currentColor">
                                <rect x="2" y="2" width="12" height="5" rx="1"/>
                                <rect x="2" y="9" width="12" height="5" rx="1"/>
                              </svg>
                            )}
                            <span>{label}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Theme */}
                  <div className="px-3 py-2 border-b border-[var(--ml-bg-hover)]">
                    <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-1.5">Theme</p>
                    <div className="flex gap-1.5">
                      {THEMES.map((t) => (
                        <button
                          key={t}
                          title={THEME_META[t].label}
                          onClick={() => setTheme(t)}
                          style={{ backgroundColor: THEME_META[t].swatch }}
                          className={`w-6 h-6 rounded-full border-2 transition-transform ${theme === t ? "border-indigo-400 scale-110" : "border-white/20 hover:border-white/50"}`}
                        />
                      ))}
                    </div>
                  </div>

                  {/* Settings */}
                  <button
                    onClick={() => { setUserMenuOpen(false); setShowSettings(true); }}
                    className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-gray-300 hover:bg-[var(--ml-bg-hover)] hover:text-white transition"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4 text-gray-500" fill="currentColor" viewBox="0 0 16 16">
                      <path d="M8 4.754a3.246 3.246 0 1 0 0 6.492 3.246 3.246 0 0 0 0-6.492M5.754 8a2.246 2.246 0 1 1 4.492 0 2.246 2.246 0 0 1-4.492 0"/>
                      <path d="M9.796 1.343c-.527-1.79-3.065-1.79-3.592 0l-.094.319a.873.873 0 0 1-1.255.52l-.292-.16c-1.64-.892-3.433.902-2.54 2.541l.159.292a.873.873 0 0 1-.52 1.255l-.319.094c-1.79.527-1.79 3.065 0 3.592l.319.094a.873.873 0 0 1 .52 1.255l-.16.292c-.892 1.64.901 3.434 2.541 2.54l.292-.159a.873.873 0 0 1 1.255.52l.094.319c.527 1.79 3.065 1.79 3.592 0l.094-.319a.873.873 0 0 1 1.255-.52l.292.16c1.64.893 3.434-.902 2.54-2.541l-.159-.292a.873.873 0 0 1 .52-1.255l.319-.094c1.79-.527 1.79-3.065 0-3.592l-.319-.094a.873.873 0 0 1-.52-1.255l.16-.292c.893-1.64-.902-3.433-2.541-2.54l-.292.159a.873.873 0 0 1-1.255-.52zm-2.633.283c.246-.835 1.428-.835 1.674 0l.094.319a1.873 1.873 0 0 0 2.693 1.115l.291-.16c.764-.415 1.6.42 1.184 1.185l-.159.292a1.873 1.873 0 0 0 1.116 2.692l.318.094c.835.246.835 1.428 0 1.674l-.319.094a1.873 1.873 0 0 0-1.115 2.693l.16.291c.415.764-.42 1.6-1.185 1.184l-.291-.159a1.873 1.873 0 0 0-2.693 1.116l-.094.318c-.246.835-1.428.835-1.674 0l-.094-.319a1.873 1.873 0 0 0-2.692-1.115l-.292.16c-.764.415-1.6-.42-1.184-1.185l.159-.291A1.873 1.873 0 0 0 1.945 8.93l-.319-.094c-.835-.246-.835-1.428 0-1.674l.319-.094A1.873 1.873 0 0 0 3.06 4.375l-.16-.292c-.415-.764.42-1.6 1.185-1.184l.292.159a1.873 1.873 0 0 0 2.692-1.115z"/>
                    </svg>
                    Settings
                  </button>

                  {/* Help */}
                  <button
                    onClick={() => { setUserMenuOpen(false); setShowHelp(true); }}
                    className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-gray-300 hover:bg-[var(--ml-bg-hover)] hover:text-white transition"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4 text-gray-500" fill="currentColor" viewBox="0 0 16 16">
                      <path d="M8 15A7 7 0 1 1 8 1a7 7 0 0 1 0 14m0 1A8 8 0 1 0 8 0a8 8 0 0 0 0 16"/>
                      <path d="M5.255 5.786a.237.237 0 0 0 .241.247h.825c.138 0 .248-.113.266-.25.09-.656.54-1.134 1.342-1.134.686 0 1.314.343 1.314 1.168 0 .635-.374.927-.965 1.371-.673.489-1.206 1.06-1.168 1.987l.003.217a.25.25 0 0 0 .25.246h.811a.25.25 0 0 0 .25-.25v-.105c0-.718.273-.927 1.01-1.486.609-.463 1.244-.977 1.244-2.056 0-1.511-1.276-2.241-2.673-2.241-1.267 0-2.655.59-2.75 2.286m1.557 5.763c0 .533.425.927 1.01.927.609 0 1.028-.394 1.028-.927 0-.552-.42-.94-1.029-.94-.584 0-1.009.388-1.009.94"/>
                    </svg>
                    Help
                  </button>

                  {/* Admin Panel - only shown to admins */}
                  {user.is_admin && (
                    <button
                      id="tour-admin-menu"
                      onClick={() => { setUserMenuOpen(false); setAdminInitialTab("feedback"); setShowAdmin(true); }}
                      className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-indigo-400 hover:bg-indigo-500/10 hover:text-indigo-300 transition"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="currentColor" viewBox="0 0 16 16">
                        <path d="M8 1a2 2 0 0 1 2 2v4H6V3a2 2 0 0 1 2-2m3 6V3a3 3 0 0 0-6 0v4a2 2 0 0 0-2 2v5a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2"/>
                      </svg>
                      Admin Panel
                      {openFeedbackCount > 0 && (
                        <span className="ml-auto min-w-[18px] h-[18px] px-1 bg-red-500 text-white text-[9px] font-bold rounded-full flex items-center justify-center leading-none">
                          {openFeedbackCount > 99 ? "99+" : openFeedbackCount}
                        </span>
                      )}
                    </button>
                  )}

                  {/* Reset Walkthrough - admin only */}
                  {user.is_admin && (
                    <button
                      onClick={() => { setUserMenuOpen(false); localStorage.removeItem("memolink_walkthrough_done"); setShowTour(true); }}
                      className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-indigo-300 hover:bg-indigo-500/10 hover:text-indigo-200 transition"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4 text-indigo-400 shrink-0" fill="currentColor" viewBox="0 0 16 16">
                        <path d="M11.534 7h3.932a.25.25 0 0 1 .192.41l-1.966 2.36a.25.25 0 0 1-.384 0l-1.966-2.36a.25.25 0 0 1 .192-.41m-11 2h3.932a.25.25 0 0 0 .192-.41L2.692 6.23a.25.25 0 0 0-.384 0L.342 8.59A.25.25 0 0 0 .534 9"/>
                        <path fillRule="evenodd" d="M8 3c-1.552 0-2.94.707-3.857 1.818a.5.5 0 1 1-.771-.636A6.002 6.002 0 0 1 13.917 7H12.9A5 5 0 0 0 8 3M3.1 9a5.002 5.002 0 0 0 8.757 2.182.5.5 0 1 1 .771.636A6.002 6.002 0 0 1 2.083 9z"/>
                      </svg>
                      Reset Walkthrough
                    </button>
                  )}

                  {/* Send Feedback */}
                  <button
                    onClick={() => { setUserMenuOpen(false); setShowFeedback(true); }}
                    className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-gray-300 hover:bg-[var(--ml-bg-hover)] hover:text-white transition"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4 text-gray-500 shrink-0" fill="currentColor" viewBox="0 0 16 16">
                      <path d="M14 1a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H4.414A2 2 0 0 0 3 11.586l-2 2V2a1 1 0 0 1 1-1zM2 0a2 2 0 0 0-2 2v12.793a.5.5 0 0 0 .854.353l2.853-2.853A1 1 0 0 1 4.414 12H14a2 2 0 0 0 2-2V2a2 2 0 0 0-2-2z"/>
                    </svg>
                    Send Feedback
                  </button>

                  {/* Take Evaluation Survey */}
                  {flags.evaluation_survey_enabled && (
                    <button
                      onClick={() => { setUserMenuOpen(false); setShowSurvey(true); }}
                      className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-violet-300 hover:bg-violet-500/10 hover:text-violet-200 transition"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4 shrink-0" fill="currentColor" viewBox="0 0 16 16">
                        <path d="M9.5 0a.5.5 0 0 1 .5.5.5.5 0 0 0 .5.5.5.5 0 0 1 .5.5V2a.5.5 0 0 1-.5.5h-5A.5.5 0 0 1 5 2v-.5a.5.5 0 0 1 .5-.5.5.5 0 0 0 .5-.5.5.5 0 0 1 .5-.5z"/>
                        <path d="M3 2.5a.5.5 0 0 1 .5-.5H4a.5.5 0 0 0 0-1h-.5A1.5 1.5 0 0 0 2 2.5v12A1.5 1.5 0 0 0 3.5 16h9a1.5 1.5 0 0 0 1.5-1.5v-12A1.5 1.5 0 0 0 12.5 1H12a.5.5 0 0 0 0 1h.5a.5.5 0 0 1 .5.5v12a.5.5 0 0 1-.5.5h-9a.5.5 0 0 1-.5-.5z"/>
                        <path d="M10.854 7.854a.5.5 0 0 0-.708-.708L7.5 9.793 6.354 8.646a.5.5 0 1 0-.708.708l1.5 1.5a.5.5 0 0 0 .708 0z"/>
                      </svg>
                      Take Evaluation Survey
                    </button>
                  )}

                  <div className="border-t border-[var(--ml-bg-hover)] my-1" />

                  {/* Sign Out */}
                  <button
                    onClick={() => { saveUser(null); window.location.reload(); }}
                    className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-red-400 hover:bg-red-500/10 hover:text-red-300 transition"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="currentColor" viewBox="0 0 16 16">
                      <path fillRule="evenodd" d="M10 12.5a.5.5 0 0 1-.5.5h-8a.5.5 0 0 1-.5-.5v-9a.5.5 0 0 1 .5-.5h8a.5.5 0 0 1 .5.5v2a.5.5 0 0 0 1 0v-2A1.5 1.5 0 0 0 9.5 2h-8A1.5 1.5 0 0 0 0 3.5v9A1.5 1.5 0 0 0 1.5 14h8a1.5 1.5 0 0 0 1.5-1.5v-2a.5.5 0 0 0-1 0z"/>
                      <path fillRule="evenodd" d="M15.854 8.354a.5.5 0 0 0 0-.708l-3-3a.5.5 0 0 0-.708.708L14.293 7.5H5.5a.5.5 0 0 0 0 1h8.793l-2.147 2.146a.5.5 0 0 0 .708.708z"/>
                    </svg>
                    Sign Out
                  </button>
                </div>
                </>
              )}
            </div>
          </div>
        </div>


        {/* Book readers stay mounted when switching tab types (prevents epub.js state teardown).
            display:none keeps inactive epub.js iframes dormant; PdfReaderView re-paints its
            canvas when isActive flips to true (Chromium frees the canvas GPU texture under
            display:none, so we skip the render while hidden and re-fire it on reveal). */}
        {activeLayoutMode === "stacked" && (
          <div {...readerTabProps("flex-1 min-h-0 flex flex-col overflow-hidden", isBookReaderActive)}>
            {bookTabs.openTabs.map((tab, i) => (
              <div
                key={tab.book.id}
                {...readerTabProps("flex-1 flex flex-col min-h-0 h-full", i === bookTabs.activeIndex)}
              >
                <BookReader
                  book={tab.book}
                  initialPage={tab.initialPage}
                  onClose={closeActiveBookTab}
                  onProgress={handleBookProgress}
                  jumpToHighlight={tab.pendingHighlight}
                  onJumpToHighlightHandled={() => bookTabs.clearPendingHighlight(tab.book.id)}
                  onHighlightAdded={reloadNotes}
                  onFullscreenChange={i === bookTabs.activeIndex ? setBookReaderFullscreen : undefined}
                  isActive={isBookReaderActive && i === bookTabs.activeIndex}
                />
              </div>
            ))}
          </div>
        )}
        {/* ── Content area ─────────────────────────────────────────────── */}
        {activeLayoutMode === "stacked" ? (
          isSpotifyActive ? (
            <SpotifyFullPlayer
              track={spotifyPlayer.liveTrack}
              isPlaying={spotifyPlaying}
              onPrevious={handleSpotifyPrevious}
              onTogglePlay={handleSpotifyTogglePlay}
              onNext={handleSpotifyNext}
              onPlayUri={handleSpotifyPlayUri}
              shuffle={spotifyShuffle}
              onShuffle={handleSpotifyShuffle}
              playerStatus={spotifyPlayer.playerStatus}
              sdkError={spotifyPlayer.sdkError}
              playbackError={spotifyPlaybackError}
              onClearPlaybackError={() => setSpotifyPlaybackError(null)}
            />
          ) : isCalendarActive ? (
            <CalendarTabContent calendar={calendar} />
          ) : isBooksActive ? (
            <BooksLibraryModal
              show
              onClose={() => setBooksTabOpen(false)}
              initialView={booksInitialView}
              onMyBooksChanged={setMyBooks}
              onOpenBook={openBookTab}
            />
          ) : isBookReaderActive ? (
            null
          ) : isStudyActive ? (
            studyTabs.active && (
              <StudyToolView
                key={studyTabs.active.tool}
                tool={studyTabs.active.tool}
                workspaceId={activeWorkspaceId}
                notes={notes.map((n) => ({ id: n.id, title: n.title }))}
              />
            )
          ) : isMemoGraphActive ? (
            <MemoGraphView
              workspaceId={activeWorkspaceId}
              workspaceName={workspaceHook.activeWorkspace?.name}
              onOpenNote={(noteId) => {
                const note = notes.find((n) => n.id === noteId);
                if (note) handleOpenNote(note);
              }}
            />
          ) : isEmailActive ? (
            <main className="flex-1 overflow-hidden flex flex-col">
              {(() => {
                const activeEmailTab = emailTabs.active;
                if (!activeEmailTab) return null;
                if (activeEmailTab.kind === "compose") {
                  return (
                    <EmailComposeTabContent
                      accounts={emailAccounts}
                      draft={activeEmailTab.draft}
                      onDraftChange={(patch) => emailTabs.setComposeDraft(activeEmailTab.composeId, patch)}
                    />
                  );
                }
                if (activeEmailTab.kind === "list") {
                  return (
                    <EmailListTabContent
                      scope={activeEmailTab.scope}
                      selectedFolder={activeEmailTab.selectedFolder}
                      onFolderChange={(folder) => emailTabs.setListFolder(emailTabs.activeIndex, folder)}
                      viewingEmail={activeEmailTab.viewingEmail}
                      emailAccounts={emailAccounts}
                      onOpenEmail={(email) => emailTabs.viewEmailInListTab(emailTabs.activeIndex, email)}
                      onBack={() => emailTabs.backToListInTab(emailTabs.activeIndex)}
                      actionLoading={!!activeEmailTab.viewingEmail && emailActionLoadingId === activeEmailTab.viewingEmail.gmail_message_id}
                      onArchive={handleEmailArchive}
                      onTrash={handleEmailTrash}
                      onTogglePin={handleEmailTogglePin}
                      replyDraft={activeEmailTab.replyDraft}
                      onReplyDraftChange={(_, draft) => emailTabs.setListReplyDraft(emailTabs.activeIndex, draft)}
                    />
                  );
                }
                return (
                  <EmailTabContent
                    email={activeEmailTab.email}
                    actionLoading={emailActionLoadingId === activeEmailTab.email.gmail_message_id}
                    onArchive={handleEmailArchive}
                    onTrash={handleEmailTrash}
                    onTogglePin={handleEmailTogglePin}
                    replyDraft={activeEmailTab.replyDraft}
                    onReplyDraftChange={emailTabs.setEmailReplyDraft}
                  />
                );
              })()}
            </main>
          ) : isWhatsappActive ? (
            <main className="flex-1 overflow-hidden flex flex-col">
              {whatsappTabs.active && (
                <WhatsappTabContent
                  chat={whatsappTabs.active.chat}
                  draft={whatsappTabs.active.draft}
                  onDraftChange={whatsappTabs.setWhatsappDraft}
                  onChatDeleted={whatsappTabs.closeWhatsappTabById}
                />
              )}
            </main>
          ) : isNoteActive ? (
            <main className="flex-1 px-4 py-6 overflow-hidden flex flex-col">
              <NoteEditorView
                noteKey={editor.active?.note.id ?? `new-${editor.activeIndex}`}
                noteTitleDraft={editor.noteTitleDraft}
                setNoteTitleDraft={editor.setNoteTitleDraft}
                noteContentDraft={editor.noteContentDraft}
                setNoteContentDraft={editor.setNoteContentDraft}
                isNoteDirty={editor.isNoteDirty}
                onSave={handleSaveNote}
                onDiscard={editor.discardChanges}
                onPlay={chat.tts.speak}
                ttsPlaying={chat.tts.playing}
                ttsPaused={chat.tts.paused}
                onTtsStop={chat.tts.stop}
                onTtsPauseResume={chat.tts.paused ? chat.tts.resume : chat.tts.pause}
                onTtsBack={chat.tts.back}
                onTtsForward={chat.tts.forward}
                ttsRate={chat.tts.rate}
                ttsVoices={chat.tts.voices}
                ttsSelectedVoice={chat.tts.selectedVoice}
                onTtsRateChange={chat.tts.setRate}
                onTtsVoiceChange={chat.tts.setSelectedVoice}
                ttsSentenceIdx={chat.tts.currentSentenceIdx}
                ttsSentences={chat.tts.sentencesList}
                ttsWord={chat.tts.currentWord}
                ttsEnabled={flags.tts_enabled}
                videoImportEnabled={flags.video_import_enabled}
                timelineEnabled={flags.timeline_enabled}
                noteId={editor.active?.note.id ?? null}
                publicAgentFeatureEnabled={flags.public_portfolio_agent_enabled}
                publicAgentEnabled={editor.active?.note.public_agent_enabled ?? false}
                onTogglePublicAgent={handleTogglePublicAgent}
                onOpenHighlight={openBookHighlight}
              />
            </main>
          ) : (
            <>
              <main className="flex-1 px-4 py-6 overflow-hidden">
                <div className="h-full flex">
                  <MessageList
                    messages={convs.activeConversation.messages}
                    loading={chat.loading}
                    streaming={chat.streaming}
                    activeConversation={convs.activeConversation}
                    messagesContainerRef={convs.messagesContainerRef}
                    bottomRef={convs.bottomRef}
                    onLoadOlder={() => convs.loadMessages(convs.activeConversation!.id, true)}
                    onAddToNotes={handleAddMessageToNotes}
                    onDeleteMessage={(id, content, index) => { setDeleteTarget({ id, content, index }); setShowDeleteModal(true); }}
                    onDropFiles={(files) => chat.setPendingFiles((p) => [...p, ...files])}
                    onApplyNoteEdit={handleApplyNoteEdit}
                    onOpenNote={handleOpenNoteById}
                    onBorrowBook={flags.books_library_enabled ? handleChatBorrowBook : undefined}
                    onSaveNote={(title, content) => addNote(title, content)}
                    hasOpenNote={isNoteActive}
                    translationEnabled={flags.translation_enabled}
                    modelAttributionEnabled={modelAttributionEnabled}
                    confidenceEnabled={flags.confidence_enabled}
                    autopilotEnabled={flags.autopilot_enabled}
                    workflowContext={convs.activeConversation?.id && convs.activeConversation.id !== TEMP_ID ? { conversationId: convs.activeConversation.id, workspaceId: activeWorkspaceId, model: selectedModel } : undefined}
                    workflowSuggestions={workflowSuggestions}
                    onWorkflowActionDone={(type) => {
                      const notesActions = new Set(["create_note","summarise_workspace","organise_notes","extract_tasks","prepare_report_outline","suggest_title"]);
                      const reminderActions = new Set(["create_reminder"]);
                      if (notesActions.has(type)) reloadNotes();
                      if (reminderActions.has(type)) suggestions.reload();
                    }}
                    onWorkflowConversationMessages={appendWorkflowMessages}
                    evaluationActive={evaluationActive}
                    evalRatings={evalRatings}
                    onRetry={(idx) => {
                      const msgs = convs.activeConversation?.messages ?? [];
                      const msg = msgs[idx];
                      if (!msg || chat.loading || chat.streaming) return;
                      if (msg.role === "user") {
                        void chat.handleSend(msg.content);
                      } else {
                        for (let i = idx - 1; i >= 0; i--) {
                          if (msgs[i].role === "user") {
                            void chat.handleSend(msgs[i].content);
                            break;
                          }
                        }
                      }
                    }}
                    onSearchOnline={chat.searchOnline}
                    onOpenEmail={openEmailInTab}
                  />
                </div>
              </main>
              {chat.tts.playing && (
                <TTSPlayerBar
                  paused={chat.tts.paused}
                  rate={chat.tts.rate}
                  voices={chat.tts.voices}
                  selectedVoice={chat.tts.selectedVoice}
                  onPauseResume={chat.tts.paused ? chat.tts.resume : chat.tts.pause}
                  onStop={chat.tts.stop}
                  onBack={chat.tts.back}
                  onForward={chat.tts.forward}
                  onRateChange={chat.tts.setRate}
                  onVoiceChange={chat.tts.setSelectedVoice}
                />
              )}
              <RunningProcessBanner />
              {chatReminderSuggestion && (
                <ChatReminderSuggestion
                  text={chatReminderSuggestion.text}
                  due_date={chatReminderSuggestion.due_date}
                  due_time={chatReminderSuggestion.due_time}
                  onAdd={(text, due_date, due_time) => {
                    suggestions.addManual(text, null, due_date, due_time);
                    setChatReminderSuggestion(null);
                  }}
                  onDismiss={() => setChatReminderSuggestion(null)}
                />
              )}
              <ChatInput
                input={chat.input}
                setInput={chat.setInput}
                loading={chat.loading || chat.streaming}
                pendingFiles={chat.pendingFiles}
                setPendingFiles={chat.setPendingFiles}
                textareaRef={chat.textareaRef}
                attachmentInputRef={chat.attachmentInputRef}
                onSend={chat.handleSend}
                autoResize={chat.autoResize}
                webSearch={chat.webSearch}
                onToggleWebSearch={() => chat.setWebSearch((v) => !v)}
                workflowMode={false}
                onToggleWorkflowMode={() => {}}
                discussionMode={chat.discussionMode}
                onToggleDiscussionMode={() => chat.setDiscussionMode((v) => !v)}
                flags={flags}
                notes={notes}
              />
            </>
          )
        ) : (
          <SplitPane
            direction={activeLayoutMode === "columns" ? "horizontal" : "vertical"}
            ratio={activeLayoutMode === "columns" ? colRatio : rowRatio}
            onRatioChange={activeLayoutMode === "columns" ? handleColRatio : handleRowRatio}
            first={
              <div className="flex flex-col h-full min-h-0 bg-[var(--ml-bg-base)]">
                {/* Chat panel mini tab bar */}
                <div className="flex items-center overflow-x-auto shrink-0 bg-[var(--ml-bg-bar)] border-b border-[var(--ml-bg-panel)]" style={{ minHeight: 36 }}>
                  {convs.openChats.map((ch, i) => {
                    const isActive = convs.activeConversation?.id === ch.id;
                    const isDragOver = dragOverTab?.type === "chat" && dragOverTab.index === i && dragSrcRef.current?.index !== i;
                    return (
                      <div
                        key={ch.id}
                        draggable
                        onDragStart={() => { dragSrcRef.current = { type: "chat", index: i }; }}
                        onDragOver={(e) => { e.preventDefault(); setDragOverTab({ type: "chat", index: i }); }}
                        onDrop={(e) => { e.preventDefault(); handleTabDrop("chat", i); setDragOverTab(null); }}
                        onDragEnd={() => { dragSrcRef.current = null; setDragOverTab(null); }}
                        onClick={() => handleActivateChat(ch.id)}
                        className={`flex items-center gap-1.5 px-3 h-9 text-xs cursor-grab active:cursor-grabbing border-b-2 transition shrink-0 select-none ${
                          isActive ? "border-indigo-500 text-white bg-[var(--ml-bg-base)]" : "border-transparent text-gray-500 hover:text-gray-300"
                        } ${isDragOver ? "border-l-2 border-l-indigo-400" : ""}`}
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" className="w-3 h-3 shrink-0 opacity-70" fill="currentColor" viewBox="0 0 16 16">
                          <path d="M2.678 11.894a1 1 0 0 1 .287.801 11 11 0 0 1-.398 2c1.395-.323 2.247-.697 2.634-.893a1 1 0 0 1 .71-.074A8 8 0 0 0 8 14c3.996 0 7-2.807 7-6s-3.004-6-7-6-7 2.808-7 6c0 1.468.617 2.83 1.678 3.894z"/>
                        </svg>
                        <span className="max-w-[100px] truncate">{convLabel(ch)}</span>
                        <button onClick={(e) => { e.stopPropagation(); handleCloseChat(ch.id); }} className="text-gray-600 hover:text-gray-300 w-3.5 h-3.5 flex items-center justify-center rounded-sm hover:bg-[var(--ml-bg-hover)] transition leading-none">×</button>
                      </div>
                    );
                  })}
                  <button
                    onClick={() => { convs.startNewChat(); setActiveTabType("chat"); setTimeout(() => chat.textareaRef.current?.focus(), 0); }}
                    className="px-2 h-9 text-gray-600 hover:text-gray-300 text-sm shrink-0 transition"
                    title="New chat"
                  >+</button>
                </div>
                {/* Chat content */}
                <main className="flex-1 px-4 py-4 overflow-hidden min-h-0">
                  <div className="h-full flex">
                    <MessageList
                      messages={convs.activeConversation.messages}
                      loading={chat.loading}
                      streaming={chat.streaming}
                      activeConversation={convs.activeConversation}
                      messagesContainerRef={convs.messagesContainerRef}
                      bottomRef={convs.bottomRef}
                      onLoadOlder={() => convs.loadMessages(convs.activeConversation!.id, true)}
                      onAddToNotes={handleAddMessageToNotes}
                      onDeleteMessage={(id, content, index) => { setDeleteTarget({ id, content, index }); setShowDeleteModal(true); }}
                      onDropFiles={(files) => chat.setPendingFiles((p) => [...p, ...files])}
                      onApplyNoteEdit={handleApplyNoteEdit}
                      onSaveNote={(title, content) => addNote(title, content)}
                      hasOpenNote={editor.openNotes.length > 0}
                      translationEnabled={flags.translation_enabled}
                      modelAttributionEnabled={modelAttributionEnabled}
                      confidenceEnabled={flags.confidence_enabled}
                      autopilotEnabled={flags.autopilot_enabled}
                      workflowContext={convs.activeConversation?.id && convs.activeConversation.id !== TEMP_ID ? { conversationId: convs.activeConversation.id, workspaceId: activeWorkspaceId, model: selectedModel } : undefined}
                      workflowSuggestions={workflowSuggestions}
                      onWorkflowActionDone={(type) => {
                        const notesActions = new Set(["create_note","summarise_workspace","organise_notes","extract_tasks","prepare_report_outline","suggest_title"]);
                        const reminderActions = new Set(["create_reminder"]);
                        if (notesActions.has(type)) reloadNotes();
                        if (reminderActions.has(type)) suggestions.reload();
                      }}
                      onWorkflowConversationMessages={appendWorkflowMessages}
                      evaluationActive={evaluationActive}
                      evalRatings={evalRatings}
                      onRetry={(idx) => {
                        const msgs = convs.activeConversation?.messages ?? [];
                        const msg = msgs[idx];
                        if (!msg || chat.loading || chat.streaming) return;
                        if (msg.role === "user") {
                          void chat.handleSend(msg.content);
                        } else {
                          for (let i = idx - 1; i >= 0; i--) {
                            if (msgs[i].role === "user") {
                              void chat.handleSend(msgs[i].content);
                              break;
                            }
                          }
                        }
                      }}
                      onSearchOnline={chat.searchOnline}
                      onOpenEmail={openEmailInTab}
                    />
                  </div>
                </main>
                {chat.tts.playing && (
                  <div className="flex justify-center pb-1">
                    <button
                      onClick={chat.tts.stop}
                      className="flex items-center gap-2 px-3 py-1.5 bg-indigo-500/15 border border-indigo-500/30 rounded-full text-xs text-indigo-300 hover:bg-indigo-500/25 transition"
                    >
                      <span className="flex gap-[3px] items-end h-3.5">
                        {[0,1,2].map(i => (
                          <span key={i} className="w-[3px] bg-indigo-400 rounded-full animate-pulse" style={{height:`${8+i*3}px`,animationDelay:`${i*0.15}s`}} />
                        ))}
                      </span>
                      Reading aloud - click to stop
                    </button>
                  </div>
                )}
                <RunningProcessBanner />
                {chatReminderSuggestion && (
                  <ChatReminderSuggestion
                    text={chatReminderSuggestion.text}
                    due_date={chatReminderSuggestion.due_date}
                    due_time={chatReminderSuggestion.due_time}
                    onAdd={(text, due_date, due_time) => {
                      suggestions.addManual(text, null, due_date, due_time);
                      setChatReminderSuggestion(null);
                    }}
                    onDismiss={() => setChatReminderSuggestion(null)}
                  />
                )}
                <ChatInput
                  input={chat.input}
                  setInput={chat.setInput}
                  loading={chat.loading || chat.streaming}
                  pendingFiles={chat.pendingFiles}
                  setPendingFiles={chat.setPendingFiles}
                  textareaRef={chat.textareaRef}
                  attachmentInputRef={chat.attachmentInputRef}
                  onSend={chat.handleSend}
                  autoResize={chat.autoResize}
                  webSearch={chat.webSearch}
                  onToggleWebSearch={() => chat.setWebSearch((v) => !v)}
                  workflowMode={false}
                  onToggleWorkflowMode={() => {}}
                  discussionMode={chat.discussionMode}
                  onToggleDiscussionMode={() => chat.setDiscussionMode((v) => !v)}
                  flags={flags}
                  notes={notes}
                />
              </div>
            }
            second={
              <div className="flex flex-col h-full min-h-0 bg-[var(--ml-bg-base)]">
                {/* Note panel mini tab bar */}
                <div className="flex items-center overflow-x-auto shrink-0 bg-[var(--ml-bg-bar)] border-b border-[var(--ml-bg-panel)]" style={{ minHeight: 36 }}>
                  {editor.openNotes.map((note, i) => {
                    const isActive = editor.activeIndex === i;
                    const isDragOver = dragOverTab?.type === "note" && dragOverTab.index === i && dragSrcRef.current?.index !== i;
                    return (
                      <div
                        key={note.note.id ?? `new-${i}`}
                        draggable
                        onDragStart={() => { dragSrcRef.current = { type: "note", index: i }; }}
                        onDragOver={(e) => { e.preventDefault(); setDragOverTab({ type: "note", index: i }); }}
                        onDrop={(e) => { e.preventDefault(); handleTabDrop("note", i); setDragOverTab(null); }}
                        onDragEnd={() => { dragSrcRef.current = null; setDragOverTab(null); }}
                        onClick={() => { editor.setActiveIndex(i); setActiveTabType("note"); }}
                        onDoubleClick={(e) => { e.stopPropagation(); editor.setActiveIndex(i); setActiveTabType("note"); setEditingNoteTab(i); }}
                        className={`flex items-center gap-1.5 px-3 h-9 text-xs cursor-grab active:cursor-grabbing border-b-2 transition shrink-0 select-none ${
                          isActive ? "border-indigo-500 text-white bg-[var(--ml-bg-base)]" : "border-transparent text-gray-500 hover:text-gray-300"
                        } ${isDragOver ? "border-l-2 border-l-indigo-400" : ""}`}
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" className="w-3 h-3 shrink-0 opacity-70" fill="currentColor" viewBox="0 0 16 16">
                          <path d="M2 2a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v13.5a.5.5 0 0 1-.777.416L8 13.101l-5.223 2.815A.5.5 0 0 1 2 15.5z"/>
                        </svg>
                        {editingNoteTab === i ? (
                          <input
                            autoFocus
                            value={note.titleDraft}
                            onChange={(e) => editor.setNoteTitleDraft(e.target.value)}
                            onBlur={() => { handleRenameNoteTab(i); setEditingNoteTab(null); }}
                            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); handleRenameNoteTab(i); setEditingNoteTab(null); } if (e.key === "Escape") { e.preventDefault(); setEditingNoteTab(null); } }}
                            onClick={(e) => e.stopPropagation()}
                            className="max-w-[100px] bg-transparent border-b border-indigo-400 outline-none text-white text-xs"
                          />
                        ) : (
                          <span className="max-w-[100px] truncate">{note.titleDraft.trim() || "Untitled"}</span>
                        )}
                        <button onClick={(e) => { e.stopPropagation(); editor.closeNote(i); }} className="text-gray-600 hover:text-gray-300 w-3.5 h-3.5 flex items-center justify-center rounded-sm hover:bg-[var(--ml-bg-hover)] transition leading-none">×</button>
                      </div>
                    );
                  })}
                  <button
                    onClick={() => handleOpenNote({ id: null, title: "", content: "" })}
                    className="px-2 h-9 text-gray-600 hover:text-gray-300 text-sm shrink-0 transition"
                    title="New note"
                  >+</button>
                </div>
                {/* Note content */}
                {editor.openNotes.length > 0 ? (
                  <main className="flex-1 px-4 py-4 overflow-hidden flex flex-col min-h-0">
                    <NoteEditorView
                      noteKey={editor.active?.note.id ?? `new-${editor.activeIndex}`}
                      noteTitleDraft={editor.noteTitleDraft}
                      setNoteTitleDraft={editor.setNoteTitleDraft}
                      noteContentDraft={editor.noteContentDraft}
                      setNoteContentDraft={editor.setNoteContentDraft}
                      isNoteDirty={editor.isNoteDirty}
                      onSave={handleSaveNote}
                      onDiscard={editor.discardChanges}
                      onPlay={chat.tts.speak}
                      ttsPlaying={chat.tts.playing}
                      ttsPaused={chat.tts.paused}
                      onTtsStop={chat.tts.stop}
                      onTtsPauseResume={chat.tts.paused ? chat.tts.resume : chat.tts.pause}
                      onTtsBack={chat.tts.back}
                      onTtsForward={chat.tts.forward}
                      ttsRate={chat.tts.rate}
                      ttsVoices={chat.tts.voices}
                      ttsSelectedVoice={chat.tts.selectedVoice}
                      onTtsRateChange={chat.tts.setRate}
                      onTtsVoiceChange={chat.tts.setSelectedVoice}
                      ttsSentenceIdx={chat.tts.currentSentenceIdx}
                      ttsSentences={chat.tts.sentencesList}
                      ttsWord={chat.tts.currentWord}
                      ttsEnabled={flags.tts_enabled}
                      videoImportEnabled={flags.video_import_enabled}
                      timelineEnabled={flags.timeline_enabled}
                      noteId={editor.active?.note.id ?? null}
                      publicAgentFeatureEnabled={flags.public_portfolio_agent_enabled}
                      publicAgentEnabled={editor.active?.note.public_agent_enabled ?? false}
                      onTogglePublicAgent={handleTogglePublicAgent}
                      onOpenHighlight={openBookHighlight}
                    />
                  </main>
                ) : (
                  <div className="flex-1 flex flex-col items-center justify-center gap-3 text-gray-600">
                    <svg xmlns="http://www.w3.org/2000/svg" className="w-8 h-8 opacity-30" fill="currentColor" viewBox="0 0 16 16">
                      <path d="M2 2a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v13.5a.5.5 0 0 1-.777.416L8 13.101l-5.223 2.815A.5.5 0 0 1 2 15.5z"/>
                    </svg>
                    <p className="text-xs">No note open</p>
                    <button
                      onClick={() => handleOpenNote({ id: null, title: "", content: "" })}
                      className="px-3 py-1.5 rounded-lg text-xs bg-indigo-600/20 text-indigo-400 hover:bg-indigo-600/30 border border-indigo-500/20 transition"
                    >
                      New note
                    </button>
                  </div>
                )}
              </div>
            }
          />
        )}
        </>
      </div>

      <RightPanel
        open={rightPanelOpen}
        overlay={!isDesktop}
        onClose={() => setRightPanelOpen(false)}
        items={suggestions.items}
        isGenerating={suggestions.isGenerating}
        onAddManual={suggestions.addManual}
        onToggleDone={suggestions.toggleDone}
        onUpdate={suggestions.updateItem}
        onRemove={suggestions.remove}
        onClearDone={suggestions.clearDone}
        onGenerate={handleGenerate}
        notificationPermission={notifPermission}
        onRequestNotificationPermission={requestNotifPermission}
        emailConnected={emailConnected && flags.email_enabled}
        emailAccounts={flags.email_enabled ? emailAccounts : []}
        onOpenEmailTab={openEmailInTab}
        onComposeNewMail={openComposeInTab}
        onOpenAllMailTab={openAllMailInTab}
        onOpenEmailAccountTab={openEmailAccountInTab}
        openEmailTabId={emailTabs.active?.kind === "view" ? (emailTabs.active.email.gmail_message_id ?? null) : null}
        onOpenWhatsappTab={openWhatsappInTab}
        openWhatsappChatId={whatsappTabs.active?.chat.id ?? null}
        onEmailArchived={emailTabs.closeEmailTabById}
        onEmailTrashed={emailTabs.closeEmailTabById}
        onEmailPinChanged={(gmailMessageId, isPinned) => emailTabs.updateEmailTab(gmailMessageId, { is_pinned: isPinned })}
        teamsConnected={teamsConnected}
        whatsappConnected={whatsappConnected}
        whatsappAvailable={whatsappAvailable}
        insightsEnabled={flags.proactive_insights_enabled}
        workspaceId={activeWorkspaceId}
        onOpenNote={(noteId) => {
          const note = notes.find((n) => n.id === noteId);
          if (note) handleOpenNote(note);
        }}
        spotifyTrack={spotifyPlayer.liveTrack}
        spotifyQueueTracks={spotifyQueueContext ?? spotifyLibrary.tracks}
        spotifyPlaying={spotifyPlaying}
        spotifyConnected={spotifyConnected}
        spotifyProgressMs={spotifyPlayer.progressMs}
        spotifyDurationMs={spotifyPlayer.durationMs}
        spotifyShuffle={spotifyShuffle}
        spotifyRepeatMode={spotifyRepeatMode}
        onSpotifyPrevious={handleSpotifyPrevious}
        onSpotifyTogglePlay={handleSpotifyTogglePlay}
        onSpotifyNext={handleSpotifyNext}
        onSpotifySelectTrack={handleSpotifySelectTrack}
        onSpotifySeek={handleSpotifySeek}
        onOpenSpotifyTab={openSpotifyInTab}
        calendarEvents={calendar.events}
        calendarLoading={calendar.loading}
        onOpenCalendarTab={openCalendarInTab}
        booksEnabled={flags.books_library_enabled}
        myBooks={myBooks}
        onOpenBrowseBooks={openBrowseBooks}
        onOpenMyBooks={openMyBooks}
        onOpenBookReader={openBookReader}
        studyEnabled={flags.study_mode_enabled}
        onOpenStudyTool={openStudyTool}
        memographEnabled={flags.memograph_enabled && !!activeWorkspaceId}
        onOpenMemoGraphTab={openMemoGraphInTab}
      />

      <DeleteModal
        show={showDeleteModal}
        onSaveAndDelete={handleAddToNotesAndDelete}
        onDeleteOnly={handleFinalDelete}
        onCancel={() => setShowDeleteModal(false)}
      />

      {recycleBinOpen && (
        <RecycleBinModal
          onClose={() => setRecycleBinOpen(false)}
          onNoteRestored={(note) => {
            setNotes((p) => [note as any, ...p.filter((n) => n.id !== note.id)]);
          }}
          onConvRestored={(conv) => {
            convs.setConversations((p) => {
              if (p.find((c) => c.id === conv.id)) return p;
              return [{ ...conv, messages: [] }, ...p];
            });
          }}
        />
      )}

      <SettingsModal show={showSettings} user={user} onClose={() => setShowSettings(false)} selectedModel={selectedModel} onModelChange={handleModelChange} modelSelectionEnabled={flags.model_selection_enabled} customApiKeysEnabled={flags.custom_api_keys_enabled} ttsEnabled={flags.tts_enabled} emailEnabled={flags.email_enabled} workflowEnabled={flags.workflow_enabled} publicPortfolioAgentEnabled={flags.public_portfolio_agent_enabled} onReplayTour={() => { localStorage.removeItem("memolink_walkthrough_done"); setShowTour(true); setShowSettings(false); }} whatsappAvailable={whatsappAvailable}
        onWhatsappConnected={() => { setWhatsappConnected(true); localStorage.setItem("memolink_wa_connected", "1"); }}
        onWhatsappDisconnected={() => { setWhatsappConnected(false); localStorage.removeItem("memolink_wa_connected"); }}
        coreMemoryEnabled={flags.core_memory_notes_enabled}
        onOpenCoreMemory={() => { setShowSettings(false); setShowCoreMemory(true); }} />
      <HelpModal show={showHelp} onClose={() => setShowHelp(false)} />
      <FeedbackModal show={showFeedback} onClose={() => setShowFeedback(false)} />

      <SurveyModal
        show={showSurvey}
        onClose={() => setShowSurvey(false)}
        workspaceId={activeWorkspaceId}
      />

      {showCoreMemory && (
        <CoreMemoryView
          workspaceId={activeWorkspaceId}
          onClose={() => setShowCoreMemory(false)}
        />
      )}

      {showWorkspaceManager && (
        <WorkspaceManagerModal
          workspaces={workspaceHook.workspaces}
          activeWorkspace={workspaceHook.activeWorkspace}
          onClose={() => setShowWorkspaceManager(false)}
          onCreated={(ws) => workspaceHook.setWorkspaces((prev) => [...prev, ws])}
          onDeleted={(id) => workspaceHook.setWorkspaces((prev) => prev.filter((w) => w.id !== id))}
        />
      )}

      {showAdmin && <AdminPage initialTab={adminInitialTab} onClose={() => { setShowAdmin(false); refreshFeedbackCount(); }} currentUserId={user.id} onResetWalkthrough={() => { localStorage.removeItem("memolink_walkthrough_done"); setShowTour(true); setShowAdmin(false); }} />}

      <OnboardingTour
        run={showTour}
        isAdmin={user.is_admin ?? false}
        onOpenUserMenu={() => setUserMenuOpen(true)}
        onCloseUserMenu={() => setUserMenuOpen(false)}
        onFinish={() => {
          localStorage.setItem("memolink_walkthrough_done", "1");
          setShowTour(false);
          setUserMenuOpen(false);
        }}
      />
    </div>
  );
}
