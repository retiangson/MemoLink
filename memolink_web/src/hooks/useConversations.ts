import { useState, useRef } from "react";
import {
  getConversations, getConversationMessagesPaginated, createConversation,
  deleteConversation, renameConversation,
} from "../api/conversationApi";
import type { Conversation, Message } from "../types";
import { TEMP_ID } from "../types";

interface OpenChat { id: number; title: string | null; created_at?: string | null; }

export function useConversations(workspaceId?: number | null) {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConversation, setActiveConversation] = useState<Conversation | null>(null);
  const [openChats, setOpenChats] = useState<OpenChat[]>([]);
  const [messagesCursor, setMessagesCursor] = useState<number | null>(null);
  const isLoadingOlderRef = useRef(false);
  const messagesContainerRef = useRef<HTMLDivElement | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  function addOpenChat(id: number, title: string | null, created_at?: string | null) {
    setOpenChats((prev) => prev.find((c) => c.id === id) ? prev : [...prev, { id, title, created_at }]);
  }

  function closeChat(id: number) {
    setOpenChats((prev) => prev.filter((c) => c.id !== id));
  }

  function reorderOpenChats(from: number, to: number) {
    if (from === to) return;
    setOpenChats((prev) => {
      const next = [...prev];
      const [item] = next.splice(from, 1);
      next.splice(to, 0, item);
      return next;
    });
  }

  async function loadMessages(conversationId: number, loadOlder = false) {
    if (loadOlder && isLoadingOlderRef.current) return;
    if (loadOlder) isLoadingOlderRef.current = true;
    const res: Message[] = await getConversationMessagesPaginated(
      conversationId, 10, loadOlder ? (messagesCursor ?? undefined) : undefined
    );
    const pageAsc = [...res].sort((a, b) => a.id - b.id);

    if (!loadOlder) {
      setMessagesCursor(null);
      setActiveConversation((prev) => prev ? { ...prev, messages: pageAsc } : null);
      if (pageAsc.length) setMessagesCursor(pageAsc[0].id);
      requestAnimationFrame(() => bottomRef.current?.scrollIntoView({ behavior: "auto" }));
      return;
    }

    try {
      const container = messagesContainerRef.current;
      if (!container) return;
      const prevScrollTop = container.scrollTop;
      const prevScrollHeight = container.scrollHeight;
      setActiveConversation((prev) => {
        if (!prev) return null;
        const ids = new Set(prev.messages.map((m) => m.id));
        return { ...prev, messages: [...pageAsc.filter((m) => !ids.has(m.id)), ...prev.messages] };
      });
      requestAnimationFrame(() => {
        container.scrollTop = prevScrollTop + (container.scrollHeight - prevScrollHeight);
      });
      if (pageAsc.length) setMessagesCursor(pageAsc[0].id);
    } finally {
      isLoadingOlderRef.current = false;
    }
  }

  async function initConversations(
    wsId?: number | null,
    savedChatState?: { chatIds: number[]; activeChatId: number | null } | null,
  ) {
    const activeWsId = wsId !== undefined ? wsId : workspaceId;
    const convs = await getConversations(activeWsId);
    if (Array.isArray(convs) && convs.length > 0) {
      const mapped: Conversation[] = convs
        .map((c: any) => ({ id: c.id, title: c.title ?? null, messages: [], created_at: c.created_at ?? null }))
        .sort((a: Conversation, b: Conversation) => b.id - a.id);
      setConversations(mapped);

      if (savedChatState?.chatIds?.length) {
        const savedChats = savedChatState.chatIds
          .map((id) => mapped.find((c) => c.id === id))
          .filter(Boolean) as Conversation[];
        if (savedChats.length > 0) {
          setOpenChats(savedChats.map((c) => ({ id: c.id, title: c.title, created_at: c.created_at })));
          const active = savedChats.find((c) => c.id === savedChatState.activeChatId) ?? savedChats[0];
          setActiveConversation(active);
          await loadMessages(active.id);
          return;
        }
      }

      setActiveConversation(mapped[0]);
      setOpenChats([{ id: mapped[0].id, title: mapped[0].title, created_at: mapped[0].created_at }]);
      await loadMessages(mapped[0].id);
    } else {
      const created = await createConversation(activeWsId);
      const newConv: Conversation = { id: created.id, title: null, messages: [], created_at: created.created_at ?? null };
      setConversations([newConv]);
      setActiveConversation(newConv);
      setOpenChats([{ id: newConv.id, title: newConv.title, created_at: newConv.created_at }]);
    }
  }

  async function handleSelectConversation(conv: Conversation) {
    addOpenChat(conv.id, conv.title, conv.created_at);
    setActiveConversation(conv);
    await loadMessages(conv.id, false);
    requestAnimationFrame(() =>
      requestAnimationFrame(() => bottomRef.current?.scrollIntoView({ behavior: "auto" }))
    );
  }

  async function handleRename(conv: Conversation) {
    const title = prompt("Rename conversation:", conv.title ?? "");
    if (!title?.trim()) return;
    await renameConversation(conv.id, title.trim());
    const updated = { ...conv, title: title.trim() };
    setConversations((p) => p.map((c) => (c.id === conv.id ? updated : c)));
    setOpenChats((p) => p.map((c) => (c.id === conv.id ? { ...c, title: title.trim() } : c)));
    if (activeConversation?.id === conv.id) setActiveConversation(updated);
  }

  async function renameInline(conv: { id: number; title: string | null }, title: string) {
    if (!title.trim()) return;
    await renameConversation(conv.id, title.trim());
    setConversations((p) => p.map((c) => (c.id === conv.id ? { ...c, title: title.trim() } : c)));
    setOpenChats((p) => p.map((c) => (c.id === conv.id ? { ...c, title: title.trim() } : c)));
    if (activeConversation?.id === conv.id) setActiveConversation((prev) => prev ? { ...prev, title: title.trim() } : prev);
  }

  async function handleDeleteConv(convId: number) {
    if (!confirm("Delete this conversation?")) return;
    await deleteConversation(convId);
    setOpenChats((p) => p.filter((c) => c.id !== convId));
    setConversations((p) => {
      const next = p.filter((c) => c.id !== convId);
      if (activeConversation?.id === convId)
        setActiveConversation(next[0] ?? { id: TEMP_ID, title: null, messages: [] });
      return next;
    });
  }

  function startNewChat() {
    addOpenChat(TEMP_ID, null);
    setActiveConversation({ id: TEMP_ID, title: null, messages: [] });
  }

  return {
    conversations, setConversations,
    activeConversation, setActiveConversation,
    openChats, closeChat, reorderOpenChats,
    messagesCursor,
    messagesContainerRef, bottomRef,
    loadMessages, initConversations,
    handleSelectConversation, handleRename, renameInline, handleDeleteConv, startNewChat,
  };
}
