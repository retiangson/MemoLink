import { useState, useRef } from "react";
import type { BrowseEmailResult } from "../api/emailApi";

export interface ComposeDraft {
  fromAccountId?: number;
  to: string;
  subject: string;
  body: string;
}

const EMPTY_COMPOSE_DRAFT: ComposeDraft = { to: "", subject: "", body: "" };

export type EmailFolder = "inbox" | "outbox" | "drafts" | "trash";

export type EmailListScope =
  | { type: "all" }
  | { type: "account"; accountId: number };

function listScopeKey(scope: EmailListScope): string {
  return scope.type === "all" ? "all" : `account:${scope.accountId}`;
}

export type OpenEmailTab =
  // replyDraft lives here (in ChatPage's hook state, never unmounted) rather than as
  // local state inside EmailReplyPanel, so an in-progress reply survives switching to a
  // different tab type (Chat/WhatsApp/Note) and back, which unmounts/remounts EmailTabContent.
  | { kind: "view"; email: BrowseEmailResult; replyDraft: string }
  | { kind: "compose"; composeId: string; draft: ComposeDraft }
  // A "list" tab shows All Mail or a single account's folders (Inbox/Sent/Drafts/Deleted as
  // sub-tabs via selectedFolder); selecting an email within it sets viewingEmail to show that
  // email in the SAME tab, with a Back button to return to the list.
  | { kind: "list"; scope: EmailListScope; selectedFolder: EmailFolder; viewingEmail: BrowseEmailResult | null; replyDraft: string };

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
      const next: OpenEmailTab[] = [...prev, { kind: "view", email, replyDraft: "" }];
      setActiveIndex(next.length - 1);
      return next;
    });
  }

  function openComposeTab() {
    setOpenTabs((prev) => {
      const composeId = `compose-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const next: OpenEmailTab[] = [...prev, { kind: "compose", composeId, draft: { ...EMPTY_COMPOSE_DRAFT } }];
      setActiveIndex(next.length - 1);
      return next;
    });
  }

  function openListTab(scope: EmailListScope) {
    setOpenTabs((prev) => {
      const key = listScopeKey(scope);
      const existing = prev.findIndex((t) => t.kind === "list" && listScopeKey(t.scope) === key);
      if (existing !== -1) {
        setActiveIndex(existing);
        return prev;
      }
      const next: OpenEmailTab[] = [...prev, { kind: "list", scope, selectedFolder: "inbox", viewingEmail: null, replyDraft: "" }];
      setActiveIndex(next.length - 1);
      return next;
    });
  }

  function openAllMailTab() {
    openListTab({ type: "all" });
  }

  function openAccountTab(accountId: number) {
    openListTab({ type: "account", accountId });
  }

  function setListFolder(index: number, folder: EmailFolder) {
    setOpenTabs((prev) =>
      prev.map((t, i) => (i === index && t.kind === "list" ? { ...t, selectedFolder: folder, viewingEmail: null } : t))
    );
  }

  // Shows an email inside an already-open list tab (in place of the list), instead of
  // opening a brand-new separate tab — pairs with backToListInTab for the Back button.
  function viewEmailInListTab(index: number, email: BrowseEmailResult) {
    setOpenTabs((prev) =>
      prev.map((t, i) => (i === index && t.kind === "list" ? { ...t, viewingEmail: email, replyDraft: "" } : t))
    );
  }

  function backToListInTab(index: number) {
    setOpenTabs((prev) => prev.map((t, i) => (i === index && t.kind === "list" ? { ...t, viewingEmail: null } : t)));
  }

  function setListReplyDraft(index: number, replyDraft: string) {
    setOpenTabs((prev) => prev.map((t, i) => (i === index && t.kind === "list" ? { ...t, replyDraft } : t)));
  }

  function updateListViewingEmail(index: number, patch: Partial<BrowseEmailResult>) {
    setOpenTabs((prev) =>
      prev.map((t, i) => (i === index && t.kind === "list" && t.viewingEmail ? { ...t, viewingEmail: { ...t.viewingEmail, ...patch } } : t))
    );
  }

  function setEmailReplyDraft(gmailMessageId: string, replyDraft: string) {
    setOpenTabs((prev) =>
      prev.map((t) => (t.kind === "view" && t.email.gmail_message_id === gmailMessageId ? { ...t, replyDraft } : t))
    );
  }

  function setComposeDraft(composeId: string, patch: Partial<ComposeDraft>) {
    setOpenTabs((prev) =>
      prev.map((t) => (t.kind === "compose" && t.composeId === composeId ? { ...t, draft: { ...t.draft, ...patch } } : t))
    );
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

  // Replaces the whole tab list at once — used to restore tabs saved to localStorage
  // after a reload or a fresh login, as opposed to opening tabs one at a time.
  function restoreTabs(tabs: OpenEmailTab[], activeIndex: number) {
    setOpenTabs(tabs);
    setActiveIndex(tabs.length > 0 ? Math.min(Math.max(activeIndex, 0), tabs.length - 1) : 0);
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
    openAllMailTab,
    openAccountTab,
    setListFolder,
    viewEmailInListTab,
    backToListInTab,
    setListReplyDraft,
    updateListViewingEmail,
    closeEmailTab,
    closeEmailTabById,
    updateEmailTab,
    closeAllEmailTabs,
    reorderEmailTabs,
    setEmailReplyDraft,
    setComposeDraft,
    restoreTabs,
  };
}
