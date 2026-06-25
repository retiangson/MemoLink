import { useState, useRef } from "react";
import type { Tab } from "../components/study/StudyTabs";

export interface OpenStudyTab {
  tool: Tab;
}

/** Each opened study tool (Flashcards, Quiz, etc.) gets its own tab, mirroring useBookTabs. */
export function useStudyTabs() {
  const [openTabs, setOpenTabs] = useState<OpenStudyTab[]>([]);
  const [activeIndex, setActiveIndexState] = useState(0);
  const activeIdxRef = useRef(0);

  function setActiveIndex(i: number) {
    activeIdxRef.current = i;
    setActiveIndexState(i);
  }

  const safeActive = openTabs.length === 0 ? 0 : Math.min(activeIndex, openTabs.length - 1);
  const active = openTabs[safeActive] ?? null;

  function openStudyTab(tool: Tab) {
    setOpenTabs((prev) => {
      const existing = prev.findIndex((t) => t.tool === tool);
      if (existing !== -1) {
        setActiveIndex(existing);
        return prev;
      }
      const next: OpenStudyTab[] = [...prev, { tool }];
      setActiveIndex(next.length - 1);
      return next;
    });
  }

  function closeStudyTab(index?: number) {
    const idx = index ?? activeIdxRef.current;
    setOpenTabs((prev) => {
      const next = prev.filter((_, i) => i !== idx);
      const cur = activeIdxRef.current;
      const newActive = idx < cur ? cur - 1 : Math.max(0, Math.min(cur, next.length - 1));
      setActiveIndex(Math.max(0, newActive));
      return next;
    });
  }

  return {
    openTabs,
    activeIndex: safeActive,
    setActiveIndex,
    active,
    openStudyTab,
    closeStudyTab,
  };
}
