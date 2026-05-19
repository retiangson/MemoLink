import React, { useEffect, useState } from "react";
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
import { RecycleBinModal } from "../components/RecycleBinModal";
import { MessageList } from "../components/MessageList";
import { ChatInput } from "../components/ChatInput";
import { DeleteModal } from "../components/DeleteModal";
import { useSuggestions } from "../hooks/useSuggestions";
import type { Conversation, Note } from "../types";
import { TEMP_ID } from "../types";

export function ChatPage({ user }: { user: User }) {
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [showNotes, setShowNotes] = useState(true);
  const [showConversations, setShowConversations] = useState(true);
  const [menuData, setMenuData] = useState<{ type: "note" | "conversation"; item: any; top: number; left: number } | null>(null);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<{ id: number; content: string; index: number } | null>(null);
  const [activeTabType, setActiveTabType] = useState<"chat" | "note">("chat");
  const [rightPanelOpen, setRightPanelOpen] = useState(true);
  const [recycleBinOpen, setRecycleBinOpen] = useState(false);

  const { notes, setNotes, addNote, saveNote, removeNote } = useNotes(user.id);
  const suggestions = useSuggestions();
  const editor = useNoteEditor();
  const recording = useRecording((text) => {
    editor.setNoteContentDraft((prev) => prev ? prev + `<p>${text}</p>` : `<p>${text}</p>`);
  });
  const convs = useConversations();
  const chat = useChat({
    activeConversation: convs.activeConversation,
    setActiveConversation: convs.setActiveConversation,
    setConversations: convs.setConversations,
    bottomRef: convs.bottomRef,
  });

  useEffect(() => { convs.initConversations(); }, []);

  // When all note tabs are closed, switch back to chat
  useEffect(() => {
    if (editor.openNotes.length === 0 && activeTabType === "note") {
      setActiveTabType("chat");
    }
  }, [editor.openNotes.length]);

  useEffect(() => {
    const close = () => setMenuData(null);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, []);

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

  async function handleApplyNoteEdit(content: string, noteId: number | null) {
    const { marked } = await import("marked");
    const html = await marked(content) as string;
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

  if (!convs.activeConversation) return (
    <div className="flex h-screen w-screen items-center justify-center bg-[#0f0f13] text-gray-400">
      Loading…
    </div>
  );

  const isNoteActive = activeTabType === "note" && editor.openNotes.length > 0;

  const _d = new Date();
  const today = `${_d.getFullYear()}-${String(_d.getMonth() + 1).padStart(2, "0")}-${String(_d.getDate()).padStart(2, "0")}`;
  const todayItems = suggestions.items.filter((i) => !i.done && i.due_date === today);
  const urgentCount = todayItems.length;

  function handleGenerate() {
    if (isNoteActive) {
      suggestions.generateFromNote(editor.noteTitleDraft, editor.noteContentDraft);
    } else if (convs.activeConversation?.messages.length) {
      const content = convs.activeConversation.messages
        .slice(-20)
        .map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`)
        .join("\n\n");
      suggestions.generateFromNote(convs.activeConversation.title || "Conversation", content);
    }
  }

  return (
    <div className="h-screen w-screen bg-[#16161d] text-gray-100 flex relative">

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
        onNoteClick={(note: Note) => handleOpenNote(note)}
        onNewNote={() => handleOpenNote({ id: null, title: "", content: "" })}
        onNoteMenu={(note: Note, rect: DOMRect) => setMenuData({ type: "note", item: note, top: rect.bottom + 4, left: rect.right - 160 })}
        onConversationClick={(conv: Conversation) => { convs.handleSelectConversation(conv); setActiveTabType("chat"); }}
        onNewChat={() => {
          if (convs.activeConversation?.id === TEMP_ID && !convs.activeConversation.messages.length) {
            setActiveTabType("chat"); chat.textareaRef.current?.focus(); return;
          }
          convs.startNewChat();
          setActiveTabType("chat");
          setTimeout(() => chat.textareaRef.current?.focus(), 0);
        }}
        onConversationMenu={(conv: Conversation, rect: DOMRect) => setMenuData({ type: "conversation", item: conv, top: rect.bottom + 4, left: rect.right - 160 })}
        onOpenRecycleBin={() => setRecycleBinOpen(true)}
      />

      <div className="flex-1 flex flex-col h-full overflow-hidden">

        {/* ── Unified tab bar ───────────────────────────────────────────── */}
        <div className="flex bg-[#0a0a0f] border-b border-[#1e1e2a] shrink-0" style={{ minHeight: 40 }}>

          {/* Scrollable tabs — overflow only on this inner div */}
          <div className="flex items-center overflow-x-auto flex-1">

            {/* Chat tabs */}
            {convs.openChats.map((chat) => {
              const isActive = activeTabType === "chat" && convs.activeConversation?.id === chat.id;
              return (
                <div
                  key={chat.id}
                  onClick={() => handleActivateChat(chat.id)}
                  className={`flex items-center gap-1.5 px-3 h-10 text-xs cursor-pointer border-b-2 transition shrink-0 ${
                    isActive ? "border-indigo-500 text-white bg-[#0f0f13]" : "border-transparent text-gray-500 hover:text-gray-300 hover:bg-[#0f0f13]/60"
                  }`}
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="w-3 h-3 shrink-0 opacity-70" fill="currentColor" viewBox="0 0 16 16">
                    <path d="M2.678 11.894a1 1 0 0 1 .287.801 11 11 0 0 1-.398 2c1.395-.323 2.247-.697 2.634-.893a1 1 0 0 1 .71-.074A8 8 0 0 0 8 14c3.996 0 7-2.807 7-6s-3.004-6-7-6-7 2.808-7 6c0 1.468.617 2.83 1.678 3.894z"/>
                  </svg>
                  <span className="max-w-[120px] truncate">{chat.title || "New chat"}</span>
                  <button
                    onClick={(e) => { e.stopPropagation(); handleCloseChat(chat.id); }}
                    className="text-gray-600 hover:text-gray-300 w-3.5 h-3.5 flex items-center justify-center rounded-sm hover:bg-[#2a2a38] transition leading-none"
                  >×</button>
                </div>
              );
            })}

            {/* Note tabs */}
            {editor.openNotes.map((note, i) => {
              const isActive = activeTabType === "note" && editor.activeIndex === i;
              return (
                <div
                  key={i}
                  onClick={() => { editor.setActiveIndex(i); setActiveTabType("note"); }}
                  className={`flex items-center gap-1.5 px-3 h-10 text-xs cursor-pointer border-b-2 transition shrink-0 ${
                    isActive ? "border-indigo-500 text-white bg-[#0f0f13]" : "border-transparent text-gray-500 hover:text-gray-300 hover:bg-[#0f0f13]/60"
                  }`}
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="w-3 h-3 shrink-0 opacity-70" fill="currentColor" viewBox="0 0 16 16">
                    <path d="M2 2a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v13.5a.5.5 0 0 1-.777.416L8 13.101l-5.223 2.815A.5.5 0 0 1 2 15.5zm2-1a1 1 0 0 0-1 1v12.566l4.723-2.482a.5.5 0 0 1 .554 0L13 14.566V2a1 1 0 0 0-1-1z"/>
                  </svg>
                  <span className="max-w-[120px] truncate">{note.titleDraft.trim() || "Untitled"}</span>
                  <button
                    onClick={(e) => { e.stopPropagation(); editor.closeNote(i); }}
                    className="text-gray-600 hover:text-gray-300 w-3.5 h-3.5 flex items-center justify-center rounded-sm hover:bg-[#2a2a38] transition leading-none"
                  >×</button>
                </div>
              );
            })}

          </div>{/* end scrollable tabs */}

          {/* User info — outside overflow so the bell tooltip can extend below freely */}
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
                {/* Tooltip — renders below the bell, unclipped */}
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
            <span>{user.email}</span>
            <button
              onClick={() => { saveUser(null); window.location.reload(); }}
              className="px-3 py-1 bg-red-600/20 border border-red-600/30 text-red-400 rounded-full hover:bg-red-600/30 transition"
            >
              Logout
            </button>
          </div>
        </div>


        {/* ── Content area ─────────────────────────────────────────────── */}
        {isNoteActive ? (
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
          />
          </main>
        ) : (
          <>
            <main className="flex-1 px-4 py-6 overflow-hidden">
              <div className="h-full flex">
              <MessageList
                messages={convs.activeConversation.messages}
                loading={chat.loading}
                activeConversation={convs.activeConversation}
                messagesContainerRef={convs.messagesContainerRef}
                bottomRef={convs.bottomRef}
                onLoadOlder={() => convs.loadMessages(convs.activeConversation!.id, true)}
                onAddToNotes={handleAddMessageToNotes}
                onDeleteMessage={(id, content, index) => { setDeleteTarget({ id, content, index }); setShowDeleteModal(true); }}
                onDropFiles={(files) => chat.setPendingFiles((p) => [...p, ...files])}
                onApplyNoteEdit={handleApplyNoteEdit}
                hasOpenNote={isNoteActive}
              />
              </div>
            </main>
            <ChatInput
              input={chat.input}
              setInput={chat.setInput}
              loading={chat.loading}
              pendingFiles={chat.pendingFiles}
              setPendingFiles={chat.setPendingFiles}
              textareaRef={chat.textareaRef}
              attachmentInputRef={chat.attachmentInputRef}
              onSend={chat.handleSend}
              autoResize={chat.autoResize}
            />
          </>
        )}
      </div>

      <RightPanel
        open={rightPanelOpen}
        onClose={() => setRightPanelOpen(false)}
        items={suggestions.items}
        isGenerating={suggestions.isGenerating}
        onAddManual={suggestions.addManual}
        onToggleDone={suggestions.toggleDone}
        onRemove={suggestions.remove}
        onClearDone={suggestions.clearDone}
        onGenerate={handleGenerate}
        generateLabel={isNoteActive ? "current note" : "current chat"}
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
    </div>
  );
}
