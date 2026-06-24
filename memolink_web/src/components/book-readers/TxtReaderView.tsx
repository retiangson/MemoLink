import React, { useEffect, useRef, useState } from "react";
import {
  fetchBookBlob, updateBookProgress, addBookmark, listBookmarks, addBookHighlight, listBookHighlights,
  type Bookmark, type BookHighlight,
} from "../../api/booksApi";
import type { ReaderViewProps } from "./format";
import { readerSurfaceClass, readerThemeColors, findSentenceIndexForOffset } from "./format";
import { useTTS, splitSentences } from "../../hooks/useTTS";
import { usePageSwipe } from "../../hooks/usePageSwipe";
import { useHighlightColor } from "../../hooks/useHighlightColor";
import { TTSPlayerBar } from "../TTSPlayerBar";
import { NoteSourceButton } from "./NoteSourceButton";
import { HighlightColorPicker } from "./HighlightColorPicker";
import { PageNavArrows } from "./PageNavArrows";
import { ReaderLoadingState } from "./ReaderLoadingState";
import { captureSelectionInContainer, applyPersistentMarks, flashOrPulseRange, offsetOfNodeInContainer } from "./domTextHighlight";

interface PendingSelection { x: number; y: number; start: number; end: number; }

const PAGE_SIZE = 4000;

// Splits the full file into ~PAGE_SIZE-char pages at whitespace boundaries (never
// mid-word) — computed once per load and treated as fixed, same as PDF pages.
function paginateText(text: string, pageSize: number): string[] {
  if (!text) return [""];
  const pages: string[] = [];
  const len = text.length;
  let start = 0;
  while (start < len) {
    let end = Math.min(start + pageSize, len);
    if (end < len) {
      let boundary = end;
      while (boundary > start && !/\s/.test(text[boundary])) boundary--;
      if (boundary > start) end = boundary;
    }
    pages.push(text.slice(start, end));
    start = end;
  }
  return pages.length ? pages : [""];
}

export function TxtReaderView({
  book, initialPage, colorMode, onProgress,
  noteStatus, noteStatusLoaded, savingNoteSource, onSaveAsNoteSource,
  jumpToHighlight, onJumpToHighlightHandled, onHighlightAdded,
}: ReaderViewProps) {
  const [pages, setPages] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(Math.max(1, initialPage || 1));
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([]);
  const [showBookmarks, setShowBookmarks] = useState(false);
  const [pageAnim, setPageAnim] = useState<"next" | "prev" | null>(null);
  const [pendingSelection, setPendingSelection] = useState<PendingSelection | null>(null);
  const [highlights, setHighlights] = useState<BookHighlight[]>([]);
  const [progress, setProgress] = useState<{ loaded: number; total: number | null } | null>(null);
  const pageRef = useRef<HTMLDivElement | null>(null);

  const tts = useTTS();
  const [highlightColor, setHighlightColor] = useHighlightColor();

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setProgress(null);
    fetchBookBlob(book, (loaded, total) => { if (!cancelled) setProgress({ loaded, total }); })
      .then((blob) => blob.text())
      .then((text) => {
        if (cancelled) return;
        const p = paginateText(text, PAGE_SIZE);
        setPages(p);
        setCurrentPage((cp) => Math.min(Math.max(1, cp), p.length));
      })
      .catch(() => {
        if (!cancelled) setError("Could not load this book. It may no longer be available in the library.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [book.id]);

  useEffect(() => {
    listBookmarks(book.id).then(setBookmarks).catch(() => {});
  }, [book.id]);

  useEffect(() => {
    listBookHighlights(book.id).then(setHighlights).catch(() => {});
  }, [book.id]);

  useEffect(() => {
    if (!pageRef.current) return;
    const onThisPage = highlights.filter((h) => h.page_number === currentPage);
    applyPersistentMarks(pageRef.current, onThisPage.map((h) => ({ id: h.id, start: h.start_offset, end: h.end_offset, color: h.color })));
  }, [highlights, currentPage, pages]);

  useEffect(() => {
    if (loading || pages.length === 0) return;
    const t = setTimeout(() => {
      updateBookProgress(book.id, currentPage, pages.length).catch(() => {});
      onProgress?.(currentPage, pages.length);
    }, 600);
    return () => clearTimeout(t);
  }, [currentPage, pages.length, loading, book.id, onProgress]);

  useEffect(() => {
    return () => { window.speechSynthesis.cancel(); };
  }, []);

  function goToPage(p: number) {
    if (p < 1 || p > pages.length || p === currentPage) return;
    tts.stop();
    setPendingSelection(null);
    setPageAnim(p > currentPage ? "next" : "prev");
    setCurrentPage(p);
  }

  const swipeHandlers = usePageSwipe(() => goToPage(currentPage - 1), () => goToPage(currentPage + 1));

  function handleMouseUp() {
    const container = pageRef.current;
    if (!container) {
      setPendingSelection(null);
      return;
    }
    setPendingSelection(captureSelectionInContainer(container));
  }

  async function handleAddHighlight(colorId: string) {
    if (!pendingSelection || !pageRef.current) return;
    const snippet = (pageRef.current.textContent || "").slice(pendingSelection.start, pendingSelection.end);
    const created = await addBookHighlight(book.id, {
      format: "txt",
      page_number: currentPage,
      start_offset: pendingSelection.start,
      end_offset: pendingSelection.end,
      snippet,
      color: colorId,
    });
    setHighlights((prev) => [...prev, created]);
    onHighlightAdded?.();
    window.getSelection()?.removeAllRanges();
    setPendingSelection(null);
  }

  // Arrival from a Note double-click: switch to the highlight's page if needed, then pulse
  // its persistent mark (or flash, if it hasn't rendered yet).
  useEffect(() => {
    if (loading || !jumpToHighlight) return;
    if (jumpToHighlight.page !== currentPage) {
      goToPage(jumpToHighlight.page);
      return;
    }
    const raf = requestAnimationFrame(() => {
      if (pageRef.current) flashOrPulseRange(pageRef.current, jumpToHighlight);
      onJumpToHighlightHandled?.();
    });
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jumpToHighlight, currentPage, loading]);

  async function handleBookmark() {
    try {
      const bm = await addBookmark(book.id, currentPage);
      setBookmarks((prev) => [bm, ...prev.filter((b) => b.page_number !== currentPage)]);
    } catch {
      // ignore
    }
  }

  function speakPage(startIdx: number) {
    const text = pages[currentPage - 1] || "";
    if (!text.trim()) return;
    tts.speak(text, startIdx);
  }

  function handleReadAloud() {
    if (tts.playing) {
      if (tts.paused) tts.resume(); else tts.pause();
      return;
    }
    speakPage(0);
  }

  function handleDoubleClick() {
    const container = pageRef.current;
    const sel = window.getSelection();
    if (!container || !sel || sel.rangeCount === 0) return;
    const offset = offsetOfNodeInContainer(container, sel.anchorNode as Node, sel.anchorOffset);
    window.getSelection()?.removeAllRanges();
    setPendingSelection(null);
    if (offset == null) return;
    const text = pages[currentPage - 1] || "";
    if (!text.trim()) return;
    if (tts.playing) tts.stop();
    const idx = findSentenceIndexForOffset(text, splitSentences(text), offset);
    speakPage(idx);
  }

  const isBookmarked = bookmarks.some((b) => b.page_number === currentPage);
  const colors = readerThemeColors(colorMode);

  return (
    <>
      <div
        className={`flex-1 overflow-auto flex justify-center py-6 px-4 relative transition-colors ${readerSurfaceClass(colorMode)}`}
        {...swipeHandlers}
      >
        {loading ? (
          <ReaderLoadingState book={book} colorMode={colorMode} progress={progress} />
        ) : error ? (
          <div className="flex items-center justify-center text-red-400 text-sm">{error}</div>
        ) : (
          <>
            <div
              ref={pageRef}
              onAnimationEnd={() => setPageAnim(null)}
              onMouseUp={handleMouseUp}
              onDoubleClick={handleDoubleClick}
              title="Double-click a sentence to start reading from there"
              className={`relative shadow-lg rounded-xl max-w-2xl w-full h-fit p-10 whitespace-pre-wrap leading-relaxed text-[15px] cursor-text ${pageAnim === "next" ? "ml-page-anim-next" : pageAnim === "prev" ? "ml-page-anim-prev" : ""}`}
              style={{ backgroundColor: colors.background, color: colors.foreground }}
            >
              {pages[currentPage - 1] || ""}
            </div>
            <PageNavArrows
              onPrev={() => goToPage(currentPage - 1)}
              onNext={() => goToPage(currentPage + 1)}
              canPrev={currentPage > 1}
              canNext={currentPage < pages.length}
            />
          </>
        )}
      </div>

      {tts.playing && (
        <div className="fixed bottom-20 left-1/2 -translate-x-1/2 z-50">
          <TTSPlayerBar
            paused={tts.paused}
            rate={tts.rate}
            voices={tts.voices}
            selectedVoice={tts.selectedVoice}
            onPauseResume={() => (tts.paused ? tts.resume() : tts.pause())}
            onStop={tts.stop}
            onBack={tts.back}
            onForward={tts.forward}
            onRateChange={tts.setRate}
            onVoiceChange={tts.setSelectedVoice}
          />
        </div>
      )}

      {!loading && !error && (
        <div className="flex items-center justify-between px-5 py-3 border-t border-[var(--ml-bg-hover)] shrink-0 gap-3">
          <div className="flex items-center gap-2">
            <NoteSourceButton
              noteStatus={noteStatus}
              noteStatusLoaded={noteStatusLoaded}
              savingNoteSource={savingNoteSource}
              onSaveAsNoteSource={onSaveAsNoteSource}
            />
            <button
              onClick={handleBookmark}
              className={`px-2.5 py-1.5 text-xs rounded-lg border transition ${isBookmarked ? "border-indigo-500/40 text-indigo-400 bg-indigo-500/10" : "border-[var(--ml-bg-hover)] text-gray-400 hover:bg-[var(--ml-bg-hover)]"}`}
            >
              {isBookmarked ? "★ Bookmarked" : "☆ Bookmark"}
            </button>
            <div className="relative">
              <button
                onClick={() => setShowBookmarks((v) => !v)}
                className="px-2.5 py-1.5 text-xs rounded-lg text-gray-400 border border-[var(--ml-bg-hover)] hover:bg-[var(--ml-bg-hover)] transition"
              >
                Bookmarks ({bookmarks.length})
              </button>
              {showBookmarks && (
                <div className="absolute bottom-full left-0 mb-2 w-48 max-h-56 overflow-auto bg-[var(--ml-bg-surface)] border border-[var(--ml-bg-hover)] rounded-lg shadow-xl p-1.5 flex flex-col gap-0.5">
                  {bookmarks.length === 0 ? (
                    <p className="text-xs text-gray-600 px-2 py-1.5">No bookmarks yet.</p>
                  ) : (
                    bookmarks.map((b) => (
                      <button
                        key={b.id}
                        onClick={() => { goToPage(b.page_number); setShowBookmarks(false); }}
                        className="text-left text-xs text-gray-300 hover:bg-[#1a1a24] rounded-md px-2 py-1.5 transition"
                      >
                        Page {b.page_number}
                      </button>
                    ))
                  )}
                </div>
              )}
            </div>
            <button
              onClick={handleReadAloud}
              className="px-2.5 py-1.5 text-xs rounded-lg text-gray-400 border border-[var(--ml-bg-hover)] hover:bg-[var(--ml-bg-hover)] transition"
            >
              {tts.playing ? (tts.paused ? "Resume" : "Pause") : "Read Aloud"}
            </button>
            <HighlightColorPicker value={highlightColor} onChange={setHighlightColor} disabled={!pendingSelection} onApply={handleAddHighlight} />
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => goToPage(currentPage - 1)}
              disabled={currentPage <= 1}
              className="px-2.5 py-1.5 text-xs rounded-lg text-gray-400 border border-[var(--ml-bg-hover)] hover:bg-[var(--ml-bg-hover)] transition disabled:opacity-30"
            >
              Prev
            </button>
            <span className="text-xs text-gray-500 w-20 text-center shrink-0">
              Page {currentPage} / {pages.length}
            </span>
            <button
              onClick={() => goToPage(currentPage + 1)}
              disabled={currentPage >= pages.length}
              className="px-2.5 py-1.5 text-xs rounded-lg text-gray-400 border border-[var(--ml-bg-hover)] hover:bg-[var(--ml-bg-hover)] transition disabled:opacity-30"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </>
  );
}
