import { useState, useRef } from "react";
import type { BrowseEmailResult } from "../api/emailApi";

export type OpenEmailTab =
  | { kind: "view"; email: BrowseEmailResult }
  | { kind: "compose"; composeId: string };

export function useEmailTabs() {
  const [openTabs, setOpenTabs] = useState<OpenEmailTab[]>([]);
  const [activeIndex, setActiveIndexState] = useState(0);
  const activeIdxRef = useRef(0);

  function setActiveIndex(i: number) {
    activeIdxRef.current = i;
    setActiveIndexState(i);
  }

  const safeActive = openTabs.length === 0 ? 0 : Math.min(activeIndex, openTabs.length - 1);
  const active = openTabs[safeActive] ?? null;

  function openEmailTab(email: BrowseEmailResult) {
    setOpenTabs((prev) => {
      const existing = prev.findIndex((t) => t.kind === "view" && t.email.gmail_message_id === email.gmail_message_id);
      if (existing !== -1) {
        setActiveIndex(existing);
        return prev;
      }
      const next: OpenEmailTab[] = [...prev, { kind: "view", email }];
      setActiveIndex(next.length - 1);
      return next;
    });
  }

  function openComposeTab() {
    setOpenTabs((prev) => {
      const composeId = `compose-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const next: OpenEmailTab[] = [...prev, { kind: "compose", composeId }];
      setActiveIndex(next.length - 1);
      return next;
    });
  }

  function closeEmailTab(index?: number) {
    const idx = index ?? activeIdxRef.current;
    setOpenTabs((prev) => {
      const next = prev.filter((_, i) => i !== idx);
      const cur = activeIdxRef.current;
      const newActive = idx < cur ? cur - 1 : Math.max(0, Math.min(cur, next.length - 1));
      setActiveIndex(Math.max(0, newActive));
      return next;
    });
  }

  function closeEmailTabById(gmailMessageId: string) {
    setOpenTabs((prev) => {
      const idx = prev.findIndex((t) => t.kind === "view" && t.email.gmail_message_id === gmailMessageId);
      if (idx === -1) return prev;
      const next = prev.filter((_, i) => i !== idx);
      const cur = activeIdxRef.current;
      const newActive = idx < cur ? cur - 1 : Math.max(0, Math.min(cur, next.length - 1));
      setActiveIndex(Math.max(0, newActive));
      return next;
    });
  }

  function updateEmailTab(gmailMessageId: string, patch: Partial<BrowseEmailResult>) {
    setOpenTabs((prev) =>
      prev.map((t) =>
        t.kind === "view" && t.email.gmail_message_id === gmailMessageId ? { ...t, email: { ...t.email, ...patch } } : t
      )
    );
  }

  function closeAllEmailTabs() {
    setOpenTabs([]);
    setActiveIndex(0);
  }

  function reorderEmailTabs(fromIndex: number, toIndex: number) {
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
    openEmailTab,
    openComposeTab,
    closeEmailTab,
    closeEmailTabById,
    updateEmailTab,
    closeAllEmailTabs,
    reorderEmailTabs,
  };
}
