import { useState, useRef } from "react";
import type { Book } from "../api/booksApi";

export interface OpenBookTab {
  book: Book;
  initialPage: number;
}

/** Each opened book gets its own tab (mirrors useWhatsappTabs/useEmailTabs), separate
 *  from the single "Books" library tab used to browse/borrow. */
export function useBookTabs() {
  const [openTabs, setOpenTabs] = useState<OpenBookTab[]>([]);
  const [activeIndex, setActiveIndexState] = useState(0);
  const activeIdxRef = useRef(0);

  function setActiveIndex(i: number) {
    activeIdxRef.current = i;
    setActiveIndexState(i);
  }

  const safeActive = openTabs.length === 0 ? 0 : Math.min(activeIndex, openTabs.length - 1);
  const active = openTabs[safeActive] ?? null;

  function openBookTab(book: Book, initialPage = 1) {
    setOpenTabs((prev) => {
      const existing = prev.findIndex((t) => t.book.id === book.id);
      if (existing !== -1) {
        setActiveIndex(existing);
        return prev;
      }
      const next: OpenBookTab[] = [...prev, { book, initialPage }];
      setActiveIndex(next.length - 1);
      return next;
    });
  }

  // Keeps the resume position current as the reader reports progress, so switching
  // away to another tab type and back (which unmounts/remounts BookReader) picks up
  // where the user left off instead of jumping back to the page it was opened at.
  function updateBookTabPage(bookId: number, page: number) {
    setOpenTabs((prev) => prev.map((t) => (t.book.id === bookId ? { ...t, initialPage: page } : t)));
  }

  function closeBookTab(index?: number) {
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
    openBookTab,
    updateBookTabPage,
    closeBookTab,
  };
}
