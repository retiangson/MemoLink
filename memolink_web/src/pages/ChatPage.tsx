import React, { useEffect, useRef, useState } from "react";
import { saveUser, type User } from "../utils/auth";
import { useNotes } from "../hooks/useNotes";
import { useNoteEditor } from "../hooks/useNoteEditor";
import { useRecording } from "../hooks/useRecording";
import { useConversations } from "../hooks/useConversations";
import { useChat } from "../hooks/useChat";
import { addMessageToNoteAPI, deleteMessage } from "../api/conversationApi";
import { getNote, updateNote } from "../api/client";
import { Sidebar } from "../components/Sidebar";
import { NoteEditorView } from "../components/NoteEditorView";
import { RightPanel } from "../components/RightPanel";
import { SplitPane } from "../components/SplitPane";
import { RecycleBinModal } from "../components/RecycleBinModal";
import { MessageList } from "../components/MessageList";
import { ChatInput } from "../components/ChatInput";
import { DeleteModal } from "../components/DeleteModal";
import { SettingsModal } from "../components/SettingsModal";
import { HelpModal } from "../components/HelpModal";
import { MemoGraphModal } from "../components/MemoGraphModal";
import { StudyModeModal } from "../components/StudyModeModal";
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
import { getEmailStatus, autoProcessEmails } from "../api/emailApi";
import { getTeamsStatus } from "../api/teamsApi";
import { AdminPage } from "./AdminPage";
import { suggestActions, type WorkflowAction } from "../api/workflowApi";
import { OnboardingTour } from "../components/OnboardingTour";

type WorkspaceHook = ReturnType<typeof useWorkspace>;
type LayoutMode = "stacked" | "columns" | "rows";

function getSavedLayout(): LayoutMode {
  return (localStorage.getItem("memolink_layout") as LayoutMode) ?? "stacked";
}
function getSavedRatio(key: string): number {
  return parseFloat(localStorage.getItem(key) ?? "0.5");
}

export function ChatPage({ user, workspaceHook }: { user: User; workspaceHook: WorkspaceHook }) {
  const [sidebarOpen, setSidebarOpen] = useState(() => window.innerWidth >= 640);
  const [layoutMode, setLayoutMode] = useState<LayoutMode>(getSavedLayout);
  const [colRatio, setColRatio] = useState(() => getSavedRatio("memolink_split_col"));
  const [rowRatio, setRowRatio] = useState(() => getSavedRatio("memolink_split_row"));
  const [showNotes, setShowNotes] = useState(true);
  const [showConversations, setShowConversations] = useState(true);
  const [menuData, setMenuData] = useState<{ type: "note" | "conversation"; item: any; top: number; left: number } | null>(null);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<{ id: number; content: string; index: number } | null>(null);
  const [activeTabType, setActiveTabType] = useState<"chat" | "note">("chat");
  const [rightPanelOpen, setRightPanelOpen] = useState(() => window.innerWidth >= 640);
  const [recycleBinOpen, setRecycleBinOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [showMemoGraph, setShowMemoGraph] = useState(false);
  const [showStudyMode, setShowStudyMode] = useState(false);
  const [showSurvey, setShowSurvey] = useState(false);
  const [workflowSuggestions, setWorkflowSuggestions] = useState<Record<number, WorkflowAction[]>>({});
  const prevStreamingRef = useRef(false);
  const [showWorkspaceManager, setShowWorkspaceManager] = useState(false);
  const [showAdmin, setShowAdmin] = useState(false);
  const [showFeedback, setShowFeedback] = useState(false);
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
  const [teamsConnected, setTeamsConnected] = useState(false);
  const [isSyncingEmail, setIsSyncingEmail] = useState(false);
  const [emailSyncResult, setEmailSyncResult] = useState<string | null>(null);
  const [showTour, setShowTour] = useState(() => !localStorage.getItem("memolink_walkthrough_done"));

  // Tab drag-and-drop
  const dragSrcRef = useRef<{ type: "chat" | "note"; index: number } | null>(null);
  const [dragOverTab, setDragOverTab] = useState<{ type: "chat" | "note"; index: number } | null>(null);

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

  useEffect(() => {
    getEmailStatus().then(s => setEmailConnected(s.connected)).catch(() => {});
    getTeamsStatus().then(s => setTeamsConnected(s.connected)).catch(() => {});
  }, []);

  async function handleSyncEmail() {
    setIsSyncingEmail(true);
    setEmailSyncResult(null);
    try {
      const result = await autoProcessEmails();
      await Promise.all([suggestions.reload(), reloadNotes()]);
      if (result.synced === 0) {
        setEmailSyncResult("✓ No new emails");
      } else {
        const parts = [`✓ ${result.synced} email${result.synced !== 1 ? "s" : ""} synced`];
        if (result.notes_added > 0) parts.push(`Email Digest updated`);
        if (result.reminders_created > 0) parts.push(`${result.reminders_created} reminder${result.reminders_created !== 1 ? "s" : ""} added`);
        setEmailSyncResult(parts.join(" · "));
      }
    } catch (err: any) {
      const detail = err?.response?.data?.detail ?? "Email sync failed";
      setEmailSyncResult(`✗ ${detail}`);
    } finally {
      setIsSyncingEmail(false);
    }
  }

  // Open Settings after OAuth redirects
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("email_connected") === "1" || params.get("teams_connected") === "1") {
      setShowSettings(true);
      if (params.get("teams_connected") === "1") setTeamsConnected(true);
      window.history.replaceState({}, "", window.location.pathname);
    }
    const emailErr = params.get("email_error");
    if (emailErr) {
      setShowSettings(true);
      window.history.replaceState({}, "", window.location.pathname);
      // emailConnectError is shown in SettingsModal — pass via sessionStorage so it survives the redirect
      sessionStorage.setItem("email_oauth_error", decodeURIComponent(emailErr));
    }
  }, []);

  const activeWorkspaceId = workspaceHook.activeWorkspace?.id ?? null;

  const { notes, setNotes, addNote, saveNote, removeNote, reloadNotes } = useNotes(user.id, activeWorkspaceId);
  const suggestions = useSuggestions(activeWorkspaceId);
  const { permission: notifPermission, requestPermission: requestNotifPermission } = useReminderNotifications(suggestions.items);
  const editor = useNoteEditor();
  const recording = useRecording((text) => {
    editor.setNoteContentDraft((prev) => prev ? prev + `<p>${text}</p>` : `<p>${text}</p>`);
  });
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

  useEffect(() => {
    const close = () => { setMenuData(null); setUserMenuOpen(false); };
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, []);

  // ── Auto-suggest workflow actions after each AI response ─────────────────
  useEffect(() => {
    const wasStreaming = prevStreamingRef.current;
    prevStreamingRef.current = chat.streaming;

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

  function handleTabDrop(type: "chat" | "note", toIndex: number) {
    const src = dragSrcRef.current;
    if (!src || src.type !== type) return;
    if (type === "chat") convs.reorderOpenChats(src.index, toIndex);
    else editor.reorderNotes(src.index, toIndex);
  }

  if (!convs.activeConversation) return (
    <div className="flex h-full w-full items-center justify-center bg-[#0f0f13] text-gray-400">
      Loading…
    </div>
  );

  const isNoteActive = activeTabType === "note" && editor.openNotes.length > 0;

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
    <div className="h-full w-full bg-[#16161d] text-gray-100 flex relative">

      {menuData && (
        <div className="absolute z-[9999]" style={{ top: menuData.top, left: menuData.left, width: 160 }}>
          <div className="bg-[#1e1e2a] border border-[#2a2a38] rounded-xl shadow-xl overflow-hidden">
            {menuData.type === "note" && (
              <>
                <button onClick={() => { handleOpenNote(menuData.item); setMenuData(null); }} className="w-full text-left px-4 py-2.5 hover:bg-[#2a2a38] text-sm">Edit</button>
                <button onClick={() => { handleDeleteNote(menuData.item.id); setMenuData(null); }} className="w-full text-left px-4 py-2.5 hover:bg-[#3a1a1a] text-red-400 text-sm">Delete</button>
              </>
            )}
            {menuData.type === "conversation" && (
              <>
                <button onClick={() => { convs.handleRename(menuData.item); setMenuData(null); }} className="w-full text-left px-4 py-2.5 hover:bg-[#2a2a38] text-sm">Rename</button>
                <button onClick={() => { convs.handleDeleteConv(menuData.item.id); setMenuData(null); }} className="w-full text-left px-4 py-2.5 hover:bg-[#3a1a1a] text-red-400 text-sm">Delete</button>
              </>
            )}
          </div>
        </div>
      )}

      {!sidebarOpen && (
        <button
          onClick={() => setSidebarOpen(true)}
          className="absolute top-[52px] left-4 z-20 flex h-9 w-9 items-center justify-center rounded-lg bg-[#1e1e2a] hover:bg-[#2a2a38] transition"
          aria-label="Open sidebar"
        >
          <img src="/memolink-icon.png" alt="" className="h-6 w-6 rounded-md bg-white object-cover" />
        </button>
      )}


      {!rightPanelOpen && (
        <button
          onClick={() => setRightPanelOpen(true)}
          className="absolute top-[52px] right-4 z-20 flex h-9 w-9 items-center justify-center rounded-lg bg-[#1e1e2a] hover:bg-[#2a2a38] transition"
          title="Open suggestions & reminders"
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4 text-indigo-400" fill="currentColor" viewBox="0 0 16 16">
            <path d="M2 6a6 6 0 1 1 10.174 4.31c-.203.196-.359.4-.453.619l-.762 1.769A.5.5 0 0 1 10.5 13h-5a.5.5 0 0 1-.46-.302l-.761-1.77a2 2 0 0 0-.453-.618A5.98 5.98 0 0 1 2 6m3 8.5a.5.5 0 0 1 .5-.5h5a.5.5 0 0 1 0 1l-.224.447a1 1 0 0 1-.894.553H6.618a1 1 0 0 1-.894-.553L5.5 15a.5.5 0 0 1-.5-.5"/>
          </svg>
          {urgentCount > 0 && (
            <span className="absolute -top-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-amber-500 text-[9px] font-bold text-black leading-none">
              {urgentCount}
            </span>
          )}
        </button>
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
        onNoteClick={(note: Note) => { handleOpenNote(note); if (window.innerWidth < 640) setSidebarOpen(false); }}
        onNewNote={() => { handleOpenNote({ id: null, title: "", content: "" }); if (window.innerWidth < 640) setSidebarOpen(false); }}
        onNoteMenu={(note: Note, rect: DOMRect) => setMenuData({ type: "note", item: note, top: rect.bottom + 4, left: rect.right - 160 })}
        onConversationClick={(conv: Conversation) => { convs.handleSelectConversation(conv); setActiveTabType("chat"); if (window.innerWidth < 640) setSidebarOpen(false); }}
        onNewChat={() => {
          if (convs.activeConversation?.id === TEMP_ID && !convs.activeConversation.messages.length) {
            setActiveTabType("chat"); chat.textareaRef.current?.focus(); if (window.innerWidth < 640) setSidebarOpen(false); return;
          }
          convs.startNewChat();
          setActiveTabType("chat");
          setTimeout(() => chat.textareaRef.current?.focus(), 0);
          if (window.innerWidth < 640) setSidebarOpen(false);
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
            // Snapshot current tabs for the workspace we're leaving
            const snapshot = {
              chatIds: convs.openChats.filter((c) => c.id !== TEMP_ID).map((c) => c.id),
              activeChatId: convs.activeConversation?.id !== TEMP_ID ? (convs.activeConversation?.id ?? null) : null,
              noteIds: editor.openNotes.filter((t) => t.note.id !== null).map((t) => t.note.id as number),
              activeNoteId: editor.active?.note.id ?? null,
              activeTabType,
            };
            localStorage.setItem(`memolink_tabs_ws_${currentWsId}`, JSON.stringify(snapshot));

            // Stage restores for the workspace we're entering
            try {
              const raw = localStorage.getItem(`memolink_tabs_ws_${ws.id}`);
              if (raw) {
                const saved = JSON.parse(raw);
                pendingChatRestoreRef.current = { chatIds: saved.chatIds ?? [], activeChatId: saved.activeChatId ?? null };
                pendingNoteRestoreRef.current = { wsId: ws.id, noteIds: saved.noteIds ?? [], activeNoteId: saved.activeNoteId ?? null, activeTabType: saved.activeTabType ?? "chat" };
              }
            } catch { /* ignore corrupt saved state */ }

            editor.closeAllNotes();
            setActiveTabType("chat");
          }
          await workspaceHook.switchWorkspace(ws);
        }}
        onManageWorkspaces={() => setShowWorkspaceManager(true)}
        evalStatus={evalStatus}
      />

      <div className="flex-1 flex flex-col h-full overflow-hidden">

        {/* ── Unified tab bar ───────────────────────────────────────────── */}
        <div id="tour-tab-bar" className="flex bg-[#0a0a0f] border-b border-[#1e1e2a] shrink-0" style={{ minHeight: 40 }}>

          {/* Scrollable tabs - hidden in split modes (each panel has its own tab bar) */}
          <div className="flex items-center overflow-x-auto flex-1">

            {/* Chat tabs */}
            {layoutMode === "stacked" && convs.openChats.map((chat, i) => {
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
                    isActive ? "border-indigo-500 text-white bg-[#0f0f13]" : "border-transparent text-gray-500 hover:text-gray-300 hover:bg-[#0f0f13]/60"
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
                  <button onClick={(e) => { e.stopPropagation(); handleCloseChat(chat.id); }} className="text-gray-600 hover:text-gray-300 w-3.5 h-3.5 flex items-center justify-center rounded-sm hover:bg-[#2a2a38] transition leading-none">×</button>
                </div>
              );
            })}

            {/* Note tabs */}
            {layoutMode === "stacked" && editor.openNotes.map((note, i) => {
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
                    isActive ? "border-indigo-500 text-white bg-[#0f0f13]" : "border-transparent text-gray-500 hover:text-gray-300 hover:bg-[#0f0f13]/60"
                  } ${isDragOver ? "border-l-2 border-l-indigo-400" : ""}`}
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="w-3 h-3 shrink-0 opacity-70" fill="currentColor" viewBox="0 0 16 16">
                    <path d="M2 2a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v13.5a.5.5 0 0 1-.777.416L8 13.101l-5.223 2.815A.5.5 0 0 1 2 15.5zm2-1a1 1 0 0 0-1 1v12.566l4.723-2.482a.5.5 0 0 1 .554 0L13 14.566V2a1 1 0 0 0-1-1z"/>
                  </svg>
                  {editingNoteTab === i ? (
                    <input autoFocus value={note.titleDraft} onChange={(e) => editor.setNoteTitleDraft(e.target.value)}
                      onBlur={() => setEditingNoteTab(null)}
                      onKeyDown={(e) => { if (e.key === "Enter" || e.key === "Escape") { e.preventDefault(); setEditingNoteTab(null); } }}
                      onClick={(e) => e.stopPropagation()} className="max-w-[120px] bg-transparent border-b border-indigo-400 outline-none text-white text-xs" />
                  ) : (
                    <span className="max-w-[120px] truncate">{note.titleDraft.trim() || "Untitled"}</span>
                  )}
                  <button onClick={(e) => { e.stopPropagation(); editor.closeNote(i); }} className="text-gray-600 hover:text-gray-300 w-3.5 h-3.5 flex items-center justify-center rounded-sm hover:bg-[#2a2a38] transition leading-none">×</button>
                </div>
              );
            })}

          </div>{/* end scrollable tabs */}

          {/* Layout toggle */}
          <div className="shrink-0 flex items-center gap-0.5 px-2 border-l border-[#1e1e2a] ml-1">
            {([
              ["stacked", "M2 3h12v4H2zm0 6h12v4H2z", "Stacked (default)"],
              ["columns", "M2 3h5v10H2zm7 0h5v10H9z", "Side by side"],
              ["rows", "M2 3h12v4H2zm0 6h12v4H2z", "Top / bottom"],
            ] as [LayoutMode, string, string][]).map(([mode, , label], idx) => (
              <button
                key={mode}
                title={label}
                onClick={() => handleLayoutChange(mode)}
                className={`flex items-center justify-center w-7 h-7 rounded transition ${layoutMode === mode ? "bg-indigo-600 text-white" : "text-gray-500 hover:text-gray-300 hover:bg-[#1e1e2a]"}`}
              >
                {idx === 0 && (
                  <svg viewBox="0 0 16 16" className="w-3.5 h-3.5" fill="currentColor">
                    <rect x="2" y="3" width="12" height="4" rx="1"/>
                    <rect x="2" y="9" width="12" height="4" rx="1"/>
                  </svg>
                )}
                {idx === 1 && (
                  <svg viewBox="0 0 16 16" className="w-3.5 h-3.5" fill="currentColor">
                    <rect x="2" y="3" width="5" height="10" rx="1"/>
                    <rect x="9" y="3" width="5" height="10" rx="1"/>
                  </svg>
                )}
                {idx === 2 && (
                  <svg viewBox="0 0 16 16" className="w-3.5 h-3.5" fill="currentColor">
                    <rect x="2" y="2" width="12" height="5" rx="1"/>
                    <rect x="2" y="9" width="12" height="5" rx="1"/>
                  </svg>
                )}
              </button>
            ))}
          </div>

          {/* User info - outside overflow so the bell tooltip can extend below freely */}
          <div className="shrink-0 flex items-center gap-3 px-4 text-xs text-gray-500">
            {urgentCount > 0 && (
              <div className="relative group">
                <button
                  onClick={() => setRightPanelOpen(true)}
                  className="relative flex items-center justify-center w-7 h-7 rounded-lg hover:bg-amber-500/10 transition"
                  title={`${urgentCount} reminder${urgentCount > 1 ? "s" : ""} due today`}
                >
                  <span className="animate-ping absolute inline-flex w-3.5 h-3.5 rounded-full bg-amber-400 opacity-30" />
                  <svg xmlns="http://www.w3.org/2000/svg" className="relative w-4 h-4 text-amber-400" fill="currentColor" viewBox="0 0 16 16">
                    <path d="M8 16a2 2 0 0 0 2-2H6a2 2 0 0 0 2 2M8 1.918l-.797.161A4 4 0 0 0 4 6c0 .628-.134 2.197-.459 3.742-.16.767-.376 1.566-.663 2.258h10.244c-.287-.692-.502-1.49-.663-2.258C12.134 8.197 12 6.628 12 6a4 4 0 0 0-3.203-3.92zM14.22 12c.223.447.481.801.78 1H1c.299-.199.557-.553.78-1C2.68 10.2 3 6.88 3 6c0-2.42 1.72-4.44 4.005-4.901a1 1 0 1 1 1.99 0A5 5 0 0 1 13 6c0 .88.32 4.2 1.22 6"/>
                  </svg>
                  <span className="absolute -top-1 -right-1 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-amber-500 text-[8px] font-bold text-black leading-none">
                    {urgentCount}
                  </span>
                </button>
                {/* Tooltip - renders below the bell, unclipped */}
                <div className="pointer-events-none absolute right-0 top-full mt-1 z-[9999] hidden group-hover:block w-56 rounded-xl bg-[#1e1e2a] border border-amber-500/30 shadow-xl p-2.5">
                  <p className="text-[10px] font-semibold text-amber-400 uppercase tracking-wider mb-1.5">Due today</p>
                  {todayItems.map((item) => (
                    <div key={item.id} className="py-0.5 border-b border-[#2a2a38] last:border-0">
                      <p className="text-[11px] text-gray-300 leading-snug">{item.text}</p>
                      {item.due_time && (
                        <p className="text-[10px] text-amber-400/70 mt-0.5">{item.due_time}</p>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

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
                  <div className="fixed inset-0 z-[9998] bg-black/50 sm:hidden" onClick={() => setUserMenuOpen(false)} />
                  <div className="fixed inset-x-0 bottom-0 z-[9999] rounded-t-2xl max-h-[70vh] overflow-y-auto sm:absolute sm:inset-auto sm:right-0 sm:top-full sm:mt-2 sm:rounded-xl sm:w-52 sm:max-h-none bg-[#1e1e2a] border border-[#2a2a38] shadow-2xl py-1">
                  {/* Email header */}
                  <div className="px-3 py-2.5 border-b border-[#2a2a38]">
                    <p className="text-[11px] text-gray-500 truncate">{user.email}</p>
                  </div>

                  {/* Settings */}
                  <button
                    onClick={() => { setUserMenuOpen(false); setShowSettings(true); }}
                    className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-gray-300 hover:bg-[#2a2a38] hover:text-white transition"
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
                    className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-gray-300 hover:bg-[#2a2a38] hover:text-white transition"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4 text-gray-500" fill="currentColor" viewBox="0 0 16 16">
                      <path d="M8 15A7 7 0 1 1 8 1a7 7 0 0 1 0 14m0 1A8 8 0 1 0 8 0a8 8 0 0 0 0 16"/>
                      <path d="M5.255 5.786a.237.237 0 0 0 .241.247h.825c.138 0 .248-.113.266-.25.09-.656.54-1.134 1.342-1.134.686 0 1.314.343 1.314 1.168 0 .635-.374.927-.965 1.371-.673.489-1.206 1.06-1.168 1.987l.003.217a.25.25 0 0 0 .25.246h.811a.25.25 0 0 0 .25-.25v-.105c0-.718.273-.927 1.01-1.486.609-.463 1.244-.977 1.244-2.056 0-1.511-1.276-2.241-2.673-2.241-1.267 0-2.655.59-2.75 2.286m1.557 5.763c0 .533.425.927 1.01.927.609 0 1.028-.394 1.028-.927 0-.552-.42-.94-1.029-.94-.584 0-1.009.388-1.009.94"/>
                    </svg>
                    Help
                  </button>

                  {/* MemoGraph */}
                  {flags.memograph_enabled && activeWorkspaceId && (
                    <button
                      onClick={() => { setUserMenuOpen(false); setShowMemoGraph(true); }}
                      className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-indigo-300 hover:bg-indigo-500/10 hover:text-indigo-200 transition"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                        <circle cx="5" cy="12" r="2.5"/><circle cx="19" cy="5" r="2.5"/><circle cx="19" cy="19" r="2.5"/>
                        <circle cx="12" cy="8" r="2.5"/><circle cx="12" cy="16" r="2.5"/>
                        <line x1="7.2" y1="11" x2="10" y2="9"/><line x1="14" y1="9" x2="16.8" y2="6.5"/>
                        <line x1="7.2" y1="13" x2="10" y2="15"/><line x1="14" y1="15" x2="16.8" y2="17.5"/>
                        <line x1="12" y1="10.5" x2="12" y2="13.5"/>
                      </svg>
                      MemoGraph
                    </button>
                  )}

                  {/* Study Mode */}
                  {flags.study_mode_enabled && activeWorkspaceId && (
                    <button
                      onClick={() => { setUserMenuOpen(false); setShowStudyMode(true); }}
                      className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-emerald-300 hover:bg-emerald-500/10 hover:text-emerald-200 transition"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4 shrink-0" fill="currentColor" viewBox="0 0 16 16">
                        <path d="M8.5 2.687c.654-.689 1.782-.886 3.112-.752 1.234.124 2.503.523 3.388.893v9.923c-.918-.35-2.107-.692-3.287-.81-1.094-.111-2.278-.039-3.213.492zM8 1.783C7.015.936 5.587.81 4.287.94c-1.514.153-3.042.672-3.994 1.105A.5.5 0 0 0 0 2.5v11a.5.5 0 0 0 .707.455c.882-.4 2.303-.881 3.68-1.02 1.409-.142 2.59.087 3.223.877a.5.5 0 0 0 .78 0c.633-.79 1.814-1.019 3.222-.877 1.378.139 2.8.62 3.681 1.02A.5.5 0 0 0 16 13.5v-11a.5.5 0 0 0-.293-.455c-.952-.433-2.48-.952-3.994-1.105C10.413.809 8.985.936 8 1.783"/>
                      </svg>
                      Study Mode
                    </button>
                  )}

                  {/* Admin Panel - only shown to admins */}
                  {user.is_admin && (
                    <button
                      id="tour-admin-menu"
                      onClick={() => { setUserMenuOpen(false); setShowAdmin(true); }}
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
                    className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-gray-300 hover:bg-[#2a2a38] hover:text-white transition"
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

                  <div className="border-t border-[#2a2a38] my-1" />

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


        {/* ── Content area ─────────────────────────────────────────────── */}
        {layoutMode === "stacked" ? (
          isNoteActive ? (
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
                isRecording={recording.isRecording}
                isTranscribing={recording.isTranscribing}
                onStartRecording={(src, lang) => recording.startRecording(src, lang)}
                onStopRecording={recording.stopRecording}
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
                agentMode={chat.agentMode}
                onToggleAgentMode={() => chat.setAgentMode((v) => !v)}
                workflowMode={false}
                onToggleWorkflowMode={() => {}}
                researchMode={chat.researchMode}
                onToggleResearchMode={() => chat.setResearchMode((v) => !v)}
                flags={flags}
                notes={notes}
              />
            </>
          )
        ) : (
          <SplitPane
            direction={layoutMode === "columns" ? "horizontal" : "vertical"}
            ratio={layoutMode === "columns" ? colRatio : rowRatio}
            onRatioChange={layoutMode === "columns" ? handleColRatio : handleRowRatio}
            first={
              <div className="flex flex-col h-full min-h-0 bg-[#0f0f13]">
                {/* Chat panel mini tab bar */}
                <div className="flex items-center overflow-x-auto shrink-0 bg-[#0a0a0f] border-b border-[#1e1e2a]" style={{ minHeight: 36 }}>
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
                          isActive ? "border-indigo-500 text-white bg-[#0f0f13]" : "border-transparent text-gray-500 hover:text-gray-300"
                        } ${isDragOver ? "border-l-2 border-l-indigo-400" : ""}`}
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" className="w-3 h-3 shrink-0 opacity-70" fill="currentColor" viewBox="0 0 16 16">
                          <path d="M2.678 11.894a1 1 0 0 1 .287.801 11 11 0 0 1-.398 2c1.395-.323 2.247-.697 2.634-.893a1 1 0 0 1 .71-.074A8 8 0 0 0 8 14c3.996 0 7-2.807 7-6s-3.004-6-7-6-7 2.808-7 6c0 1.468.617 2.83 1.678 3.894z"/>
                        </svg>
                        <span className="max-w-[100px] truncate">{convLabel(ch)}</span>
                        <button onClick={(e) => { e.stopPropagation(); handleCloseChat(ch.id); }} className="text-gray-600 hover:text-gray-300 w-3.5 h-3.5 flex items-center justify-center rounded-sm hover:bg-[#2a2a38] transition leading-none">×</button>
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
                  agentMode={chat.agentMode}
                  onToggleAgentMode={() => chat.setAgentMode((v) => !v)}
                  workflowMode={false}
                  onToggleWorkflowMode={() => {}}
                  researchMode={chat.researchMode}
                  onToggleResearchMode={() => chat.setResearchMode((v) => !v)}
                  flags={flags}
                  notes={notes}
                />
              </div>
            }
            second={
              <div className="flex flex-col h-full min-h-0 bg-[#0f0f13]">
                {/* Note panel mini tab bar */}
                <div className="flex items-center overflow-x-auto shrink-0 bg-[#0a0a0f] border-b border-[#1e1e2a]" style={{ minHeight: 36 }}>
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
                          isActive ? "border-indigo-500 text-white bg-[#0f0f13]" : "border-transparent text-gray-500 hover:text-gray-300"
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
                            onBlur={() => setEditingNoteTab(null)}
                            onKeyDown={(e) => { if (e.key === "Enter" || e.key === "Escape") { e.preventDefault(); setEditingNoteTab(null); } }}
                            onClick={(e) => e.stopPropagation()}
                            className="max-w-[100px] bg-transparent border-b border-indigo-400 outline-none text-white text-xs"
                          />
                        ) : (
                          <span className="max-w-[100px] truncate">{note.titleDraft.trim() || "Untitled"}</span>
                        )}
                        <button onClick={(e) => { e.stopPropagation(); editor.closeNote(i); }} className="text-gray-600 hover:text-gray-300 w-3.5 h-3.5 flex items-center justify-center rounded-sm hover:bg-[#2a2a38] transition leading-none">×</button>
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
                      isRecording={recording.isRecording}
                      isTranscribing={recording.isTranscribing}
                      onStartRecording={(src, lang) => recording.startRecording(src, lang)}
                      onStopRecording={recording.stopRecording}
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
      </div>

      <RightPanel
        open={rightPanelOpen}
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
        teamsConnected={teamsConnected}
        isSyncingEmail={isSyncingEmail}
        onSyncEmail={handleSyncEmail}
        emailSyncResult={emailSyncResult}
        insightsEnabled={flags.proactive_insights_enabled}
        workspaceId={activeWorkspaceId}
        onOpenNote={(noteId) => {
          const note = notes.find((n) => n.id === noteId);
          if (note) handleOpenNote(note);
        }}
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

      <SettingsModal show={showSettings} user={user} onClose={() => setShowSettings(false)} selectedModel={selectedModel} onModelChange={handleModelChange} modelSelectionEnabled={flags.model_selection_enabled} customApiKeysEnabled={flags.custom_api_keys_enabled} ttsEnabled={flags.tts_enabled} emailEnabled={flags.email_enabled} workflowEnabled={flags.workflow_enabled} onReplayTour={() => { localStorage.removeItem("memolink_walkthrough_done"); setShowTour(true); setShowSettings(false); }} />
      <HelpModal show={showHelp} onClose={() => setShowHelp(false)} />
      <FeedbackModal show={showFeedback} onClose={() => setShowFeedback(false)} />
      <MemoGraphModal
        show={showMemoGraph}
        onClose={() => setShowMemoGraph(false)}
        workspaceId={activeWorkspaceId}
        workspaceName={workspaceHook.activeWorkspace?.name}
        onOpenNote={(noteId) => {
          const note = notes.find((n) => n.id === noteId);
          if (note) handleOpenNote(note);
        }}
      />

      <StudyModeModal
        show={showStudyMode}
        onClose={() => setShowStudyMode(false)}
        workspaceId={activeWorkspaceId}
        notes={notes.map(n => ({ id: n.id, title: n.title }))}
      />

      <SurveyModal
        show={showSurvey}
        onClose={() => setShowSurvey(false)}
        workspaceId={activeWorkspaceId}
      />

      {showWorkspaceManager && (
        <WorkspaceManagerModal
          workspaces={workspaceHook.workspaces}
          activeWorkspace={workspaceHook.activeWorkspace}
          onClose={() => setShowWorkspaceManager(false)}
          onCreated={(ws) => workspaceHook.setWorkspaces((prev) => [...prev, ws])}
          onDeleted={(id) => workspaceHook.setWorkspaces((prev) => prev.filter((w) => w.id !== id))}
        />
      )}

      {showAdmin && <AdminPage onClose={() => { setShowAdmin(false); refreshFeedbackCount(); }} currentUserId={user.id} onResetWalkthrough={() => { localStorage.removeItem("memolink_walkthrough_done"); setShowTour(true); setShowAdmin(false); }} />}

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
