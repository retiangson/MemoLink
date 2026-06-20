import { useState, useRef } from "react";
import { getNote } from "../api/client";

type NoteEditState = { id: number | null; title: string; content: string; source?: string; public_agent_enabled?: boolean };

interface OpenTab {
  note: NoteEditState;
  titleDraft: string;
  contentDraft: string;
  viewTab: "raw" | "formatted";
}

export type { OpenTab };

function defaultNoteTitle() {
  return new Date().toLocaleString("en-US", {
    month: "short", day: "numeric", year: "numeric",
    hour: "numeric", minute: "2-digit",
  });
}

export function useNoteEditor() {
  const [openNotes, setOpenNotes] = useState<OpenTab[]>([]);
  const [activeIndex, setActiveIndexState] = useState(0);
  const activeIdxRef = useRef(0);

  function setActiveIndex(i: number) {
    activeIdxRef.current = i;
    setActiveIndexState(i);
  }

  const safeActive = openNotes.length === 0 ? 0 : Math.min(activeIndex, openNotes.length - 1);
  const active = openNotes[safeActive] ?? null;

  async function openNote(note: NoteEditState) {
    if (note.id !== null) {
      const existing = openNotes.findIndex((t) => t.note.id === note.id);
      if (existing !== -1) { setActiveIndex(existing); return; }
      const fresh = await getNote(note.id);
      setOpenNotes((prev) => {
        const next = [...prev, { note: fresh, titleDraft: fresh.title ?? "", contentDraft: fresh.content ?? "", viewTab: "raw" as const }];
        setActiveIndex(next.length - 1);
        return next;
      });
    } else {
      const title = note.title || defaultNoteTitle();
      setOpenNotes((prev) => {
        const next = [...prev, { note: { id: null, title, content: note.content }, titleDraft: title, contentDraft: note.content ?? "", viewTab: "raw" as const }];
        setActiveIndex(next.length - 1);
        return next;
      });
    }
  }

  function reorderNotes(from: number, to: number) {
    if (from === to) return;
    setOpenNotes((prev) => {
      const next = [...prev];
      const [item] = next.splice(from, 1);
      next.splice(to, 0, item);
      return next;
    });
    const cur = activeIdxRef.current;
    if (cur === from) setActiveIndex(to);
    else if (from < to && cur > from && cur <= to) setActiveIndex(cur - 1);
    else if (from > to && cur >= to && cur < from) setActiveIndex(cur + 1);
  }

  function closeAllNotes() {
    setOpenNotes([]);
    setActiveIndex(0);
  }

  function closeNote(index?: number) {
    const idx = index ?? activeIdxRef.current;
    setOpenNotes((prev) => {
      const next = prev.filter((_, i) => i !== idx);
      const cur = activeIdxRef.current;
      const newActive = idx < cur ? cur - 1 : Math.max(0, Math.min(cur, next.length - 1));
      setActiveIndex(Math.max(0, newActive));
      return next;
    });
  }

  function closeNoteById(id: number) {
    setOpenNotes((prev) => {
      const idx = prev.findIndex((t) => t.note.id === id);
      if (idx === -1) return prev;
      const next = prev.filter((_, i) => i !== idx);
      const cur = activeIdxRef.current;
      const newActive = idx < cur ? cur - 1 : Math.max(0, Math.min(cur, next.length - 1));
      setActiveIndex(Math.max(0, newActive));
      return next;
    });
  }

  function updateActiveNote(fresh: NoteEditState) {
    setOpenNotes((prev) =>
      prev.map((t, i) =>
        i === activeIdxRef.current
          ? { ...t, note: fresh, titleDraft: fresh.title ?? "", contentDraft: fresh.content ?? "" }
          : t
      )
    );
  }

  // Sync any open tab that matches this note id - called after a direct DB save
  function syncNoteById(id: number, fresh: NoteEditState) {
    setOpenNotes((prev) =>
      prev.map((t) =>
        t.note.id === id
          ? { ...t, note: fresh, titleDraft: fresh.title ?? "", contentDraft: fresh.content ?? "" }
          : t
      )
    );
  }

  function discardChanges() {
    setOpenNotes((prev) =>
      prev.map((t, i) =>
        i === activeIdxRef.current
          ? { ...t, titleDraft: t.note.title ?? "", contentDraft: t.note.content ?? "" }
          : t
      )
    );
  }

  function applyFormat(type: string) {
    const snippets: Record<string, string> = {
      bold: "**bold text**", italic: "_italic_", h1: "\n\n# Heading 1\n", h2: "\n\n## Heading 2\n",
      bullet: "\n- item\n", number: "\n1. First\n", quote: "\n> Quote\n",
      code: "\n```\ncode\n```\n", inlinecode: " `inline` ", math: "\n$$ a^2 + b^2 = c^2 $$\n", clear: "",
    };
    setOpenNotes((prev) =>
      prev.map((t, i) =>
        i === activeIdxRef.current
          ? { ...t, contentDraft: type === "clear" ? "" : t.contentDraft + (snippets[type] ?? "") }
          : t
      )
    );
  }

  const noteTitleDraft = active?.titleDraft ?? "";
  const noteContentDraft = active?.contentDraft ?? "";
  const noteTab = active?.viewTab ?? "raw";
  const isNoteDirty = active
    ? (active.titleDraft ?? "") !== (active.note.title ?? "") ||
      (active.contentDraft ?? "") !== (active.note.content ?? "")
    : false;

  function setNoteTitleDraft(v: string | ((prev: string) => string)) {
    setOpenNotes((prev) =>
      prev.map((t, i) => {
        if (i !== activeIdxRef.current) return t;
        const nextTitle = typeof v === "function" ? v(t.titleDraft) : v;
        return { ...t, titleDraft: nextTitle };
      }),
    );
  }

  function setNoteContentDraft(v: string | ((prev: string) => string)) {
    if (typeof v === "function") {
      setOpenNotes((prev) => prev.map((t, i) => i === activeIdxRef.current ? { ...t, contentDraft: v(t.contentDraft) } : t));
    } else {
      setOpenNotes((prev) => prev.map((t, i) => i === activeIdxRef.current ? { ...t, contentDraft: v } : t));
    }
  }

  function setNoteTab(tab: "raw" | "formatted") {
    setOpenNotes((prev) => prev.map((t, i) => i === activeIdxRef.current ? { ...t, viewTab: tab } : t));
  }

  return {
    openNotes,
    activeIndex: safeActive,
    setActiveIndex,
    active,
    noteTitleDraft, setNoteTitleDraft,
    noteContentDraft, setNoteContentDraft,
    isNoteDirty,
    noteTab, setNoteTab,
    openNote, closeNote, closeNoteById, closeAllNotes, reorderNotes, updateActiveNote, syncNoteById, discardChanges, applyFormat,
    selectedNote: active?.note ?? null,
  };
}
