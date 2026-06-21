import { useState, useRef } from "react";
import type { WhatsappChat } from "../api/whatsappApi";

export interface OpenWhatsappTab {
  chat: WhatsappChat;
  // Lives here (in ChatPage's hook state, never unmounted) rather than as local state
  // inside WhatsappTabContent, so an in-progress reply survives switching to a different
  // tab type (Chat/Email/Note) and back, which unmounts and remounts WhatsappTabContent.
  draft: string;
}

export function useWhatsappTabs() {
  const [openTabs, setOpenTabs] = useState<OpenWhatsappTab[]>([]);
  const [activeIndex, setActiveIndexState] = useState(0);
  const activeIdxRef = useRef(0);

  function setActiveIndex(i: number) {
    activeIdxRef.current = i;
    setActiveIndexState(i);
  }

  const safeActive = openTabs.length === 0 ? 0 : Math.min(activeIndex, openTabs.length - 1);
  const active = openTabs[safeActive] ?? null;

  function openWhatsappTab(chat: WhatsappChat) {
    setOpenTabs((prev) => {
      const existing = prev.findIndex((t) => t.chat.id === chat.id);
      if (existing !== -1) {
        setActiveIndex(existing);
        return prev;
      }
      const next: OpenWhatsappTab[] = [...prev, { chat, draft: "" }];
      setActiveIndex(next.length - 1);
      return next;
    });
  }

  function setWhatsappDraft(chatId: string, draft: string) {
    setOpenTabs((prev) => prev.map((t) => (t.chat.id === chatId ? { ...t, draft } : t)));
  }

  function closeWhatsappTab(index?: number) {
    const idx = index ?? activeIdxRef.current;
    setOpenTabs((prev) => {
      const next = prev.filter((_, i) => i !== idx);
      const cur = activeIdxRef.current;
      const newActive = idx < cur ? cur - 1 : Math.max(0, Math.min(cur, next.length - 1));
      setActiveIndex(Math.max(0, newActive));
      return next;
    });
  }

  function closeWhatsappTabById(chatId: string) {
    setOpenTabs((prev) => {
      const idx = prev.findIndex((t) => t.chat.id === chatId);
      if (idx === -1) return prev;
      const next = prev.filter((_, i) => i !== idx);
      const cur = activeIdxRef.current;
      const newActive = idx < cur ? cur - 1 : Math.max(0, Math.min(cur, next.length - 1));
      setActiveIndex(Math.max(0, newActive));
      return next;
    });
  }

  function closeAllWhatsappTabs() {
    setOpenTabs([]);
    setActiveIndex(0);
  }

  // Replaces the whole tab list at once — used to restore tabs saved to localStorage
  // after a reload or a fresh login, as opposed to opening tabs one at a time.
  function restoreTabs(tabs: OpenWhatsappTab[], activeIndex: number) {
    setOpenTabs(tabs);
    setActiveIndex(tabs.length > 0 ? Math.min(Math.max(activeIndex, 0), tabs.length - 1) : 0);
  }

  function reorderWhatsappTabs(fromIndex: number, toIndex: number) {
    if (fromIndex === toIndex) return;
    setOpenTabs((prev) => {
      const next = [...prev];
      const [moved] = next.splice(fromIndex, 1);
      next.splice(toIndex, 0, moved);
      return next;
    });
    const cur = activeIdxRef.current;
    if (cur === fromIndex) setActiveIndex(toIndex);
    else if (fromIndex < cur && toIndex >= cur) setActiveIndex(cur - 1);
    else if (fromIndex > cur && toIndex <= cur) setActiveIndex(cur + 1);
  }

  return {
    openTabs,
    activeIndex: safeActive,
    setActiveIndex,
    active,
    openWhatsappTab,
    closeWhatsappTab,
    closeWhatsappTabById,
    closeAllWhatsappTabs,
    reorderWhatsappTabs,
    setWhatsappDraft,
    restoreTabs,
  };
}
