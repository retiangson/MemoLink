import React, { useEffect, useRef, useState } from "react";
import { initMobiFile } from "@lingo-reader/mobi-parser";
import type { Mobi } from "@lingo-reader/mobi-parser";
import {
  fetchBookBlob, updateBookProgress, addBookHighlight, listBookHighlights, reportBookReaderError,
  BookDownloadError, type BookHighlight,
} from "../../api/booksApi";
import type { ReaderViewProps } from "./format";
import { readerSurfaceClass, readerThemeColors, readerFontSizePx, findSentenceIndexForOffset } from "./format";
import { useTTS, splitSentences } from "../../hooks/useTTS";
import { usePageSwipe } from "../../hooks/usePageSwipe";
import { useHighlightColor } from "../../hooks/useHighlightColor";
import { TTSPlayerBar } from "../TTSPlayerBar";
import { HighlightColorPicker } from "./HighlightColorPicker";
import { PageNavArrows } from "./PageNavArrows";
import { ReaderLoadingState } from "./ReaderLoadingState";
import { captureSelectionInContainer, applyPersistentMarks, flashOrPulseRange, offsetOfNodeInContainer } from "./domTextHighlight";
import { ZoomPanWrapper } from "./ZoomPanWrapper";

interface PendingSelection { x: number; y: number; start: number; end: number; }

function describeMobiLoadError(error: unknown): string {
  if (error instanceof BookDownloadError) {
    if (error.status === 403) return "Add this book to My Books before opening it.";
    if (error.status === 404 || error.status === 410) {
      return "Could not download this book from OneDrive. It may no longer be available in the library.";
    }
    if (error.code === "ECONNABORTED") return "The book download timed out. Please try again on a stronger connection.";
    if (!error.status) return "Network error while downloading this book. Please check your connection and try again.";
    return error.message;
  }
  // initMobiFile throwing here (download succeeded) almost always means the file isn't a
  // MOBI/PRC Palm database the parser recognizes — e.g. a pure KF8/AZW3 export, or a
  // renamed/corrupted file (common when a .mobi was pulled out of a .zip incorrectly).
  return "Could not open this MOBI file. It may be corrupted, or not a format this reader supports (e.g. a KF8/AZW3-only export).";
}

function technicalMobiLoadDetail(error: unknown): string | null {
  if (error instanceof BookDownloadError) {
    const parts = [
      error.status ? `HTTP ${error.status}` : null,
      error.code ? `code=${error.code}` : null,
      error.detail ? (typeof error.detail === "string" ? error.detail : JSON.stringify(error.detail)) : null,
    ].filter(Boolean);
    return parts.length ? parts.join(" | ") : null;
  }
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  return error ? String(error) : null;
}

// MOBI chapters are parsed entirely client-side via @lingo-reader/mobi-parser; each
// chapter's own CSS is intentionally ignored (it can't be trusted to play well with the
// app's dark/light/sepia modes) in favor of readerThemeColors — the same approach
// EpubReaderView already uses for injected book content. Note extraction (RAG ingestion)
// is deferred since it would need a new backend Python MOBI dependency; highlight-to-note
// still works fully since it only needs this browser-side parse.
export function MobiReaderView({
  book, initialPage, colorMode, fontSize, onProgress,
  jumpToHighlight, onJumpToHighlightHandled, onHighlightAdded, isFullscreen,
}: ReaderViewProps) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [chapterCount, setChapterCount] = useState(0);
  const [currentPage, setCurrentPage] = useState(Math.max(1, initialPage || 1));
  const [pageAnim, setPageAnim] = useState<"next" | "prev" | null>(null);
  const [pendingSelection, setPendingSelection] = useState<PendingSelection | null>(null);
  const [chapterHtml, setChapterHtml] = useState("");
  const [highlights, setHighlights] = useState<BookHighlight[]>([]);
  const [progress, setProgress] = useState<{ loaded: number; total: number | null } | null>(null);

  const mobiRef = useRef<Mobi | null>(null);
  const spineRef = useRef<{ id: string }[]>([]);
  const chapterRef = useRef<HTMLDivElement | null>(null);

  const tts = useTTS();
  const [highlightColor, setHighlightColor] = useHighlightColor();

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setProgress(null);
    (async () => {
      try {
        const blob = await fetchBookBlob(book, (loaded, total) => { if (!cancelled) setProgress({ loaded, total }); });
        const buf = new Uint8Array(await blob.arrayBuffer());
        const mobi = await initMobiFile(buf);
        if (cancelled) {
          mobi.destroy();
          return;
        }
        mobiRef.current = mobi;
        const spine = mobi.getSpine();
        spineRef.current = spine;
        setChapterCount(spine.length);
        setCurrentPage((p) => Math.min(Math.max(1, p), Math.max(1, spine.length)));
      } catch (loadError) {
        if (!cancelled) {
          console.error("MOBI reader failed", loadError);
          const message = describeMobiLoadError(loadError);
          setError(message);
          reportBookReaderError({
            book_id: book.id,
            format: "mobi",
            stage: "mobi-load",
            message,
            technical_detail: technicalMobiLoadDetail(loadError),
            user_agent: navigator.userAgent,
            url: window.location.pathname,
            online: navigator.onLine,
          }).catch(() => {});
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
      mobiRef.current?.destroy();
      mobiRef.current = null;
    };
  }, [book.id]);

  useEffect(() => {
    if (loading || !mobiRef.current || spineRef.current.length === 0) return;
    const chapter = spineRef.current[currentPage - 1];
    if (!chapter) return;
    const processed = mobiRef.current.loadChapter(chapter.id);
    setChapterHtml(processed?.html ?? "");
  }, [currentPage, loading]);

  useEffect(() => {
    listBookHighlights(book.id).then(setHighlights).catch(() => {});
  }, [book.id]);

  // Re-paint persisted highlights every time the chapter content actually changes —
  // dangerouslySetInnerHTML replaces the DOM wholesale, wiping any previous marks.
  useEffect(() => {
    if (!chapterRef.current) return;
    const onThisChapter = highlights.filter((h) => h.page_number === currentPage);
    applyPersistentMarks(chapterRef.current, onThisChapter.map((h) => ({ id: h.id, start: h.start_offset, end: h.end_offset, color: h.color })));
  }, [highlights, currentPage, chapterHtml]);

  useEffect(() => {
    if (loading || chapterCount === 0) return;
    const t = setTimeout(() => {
      updateBookProgress(book.id, currentPage, chapterCount).catch(() => {});
      onProgress?.(currentPage, chapterCount);
    }, 600);
    return () => clearTimeout(t);
  }, [currentPage, chapterCount, loading, book.id, onProgress]);

  useEffect(() => {
    return () => { window.speechSynthesis.cancel(); };
  }, []);

  function goToPage(p: number) {
    if (p < 1 || p > chapterCount || p === currentPage) return;
    tts.stop();
    setPendingSelection(null);
    setPageAnim(p > currentPage ? "next" : "prev");
    setCurrentPage(p);
  }

  const swipeHandlers = usePageSwipe(() => goToPage(currentPage - 1), () => goToPage(currentPage + 1));

  function handleMouseUp() {
    const container = chapterRef.current;
    if (!container) {
      setPendingSelection(null);
      return;
    }
    setPendingSelection(captureSelectionInContainer(container));
  }

  async function handleAddHighlight(colorId: string) {
    if (!pendingSelection || !chapterRef.current) return;
    const snippet = (chapterRef.current.textContent || "").slice(pendingSelection.start, pendingSelection.end);
    const created = await addBookHighlight(book.id, {
      format: "mobi",
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

  // Arrival from a Note double-click: switch to the highlight's chapter if needed, then pulse
  // its persistent mark (or flash, if it hasn't rendered yet).
  useEffect(() => {
    if (loading || !jumpToHighlight) return;
    if (jumpToHighlight.page !== currentPage) {
      goToPage(jumpToHighlight.page);
      return;
    }
    const raf = requestAnimationFrame(() => {
      if (chapterRef.current) flashOrPulseRange(chapterRef.current, jumpToHighlight);
      onJumpToHighlightHandled?.();
    });
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jumpToHighlight, currentPage, loading]);

  function speakChapter(startIdx: number) {
    const text = chapterRef.current?.textContent || "";
    if (text.trim()) tts.speak(text, startIdx);
  }

  function handleReadAloud() {
    if (tts.playing) {
      if (tts.paused) tts.resume(); else tts.pause();
      return;
    }
    speakChapter(0);
  }

  function handleDoubleClick() {
    const container = chapterRef.current;
    const sel = window.getSelection();
    if (!container || !sel || sel.rangeCount === 0) return;
    const offset = offsetOfNodeInContainer(container, sel.anchorNode as Node, sel.anchorOffset);
    window.getSelection()?.removeAllRanges();
    setPendingSelection(null);
    if (offset == null) return;
    const text = container.textContent || "";
    if (!text.trim()) return;
    if (tts.playing) tts.stop();
    const idx = findSentenceIndexForOffset(text, splitSentences(text), offset);
    speakChapter(idx);
  }

  const colors = readerThemeColors(colorMode);

  return (
    <>
      <ZoomPanWrapper
        active={!!isFullscreen}
        surfaceClass={readerSurfaceClass(colorMode)}
        onSwipeLeft={() => goToPage(currentPage + 1)}
        onSwipeRight={() => goToPage(currentPage - 1)}
        overlay={!loading && !error ? <PageNavArrows onPrev={() => goToPage(currentPage - 1)} onNext={() => goToPage(currentPage + 1)} canPrev={currentPage > 1} canNext={currentPage < chapterCount} /> : undefined}
      >
      <div
        className={`flex-1 ${isFullscreen ? "overflow-visible" : "overflow-auto"} flex justify-center py-6 px-4 relative transition-colors ${readerSurfaceClass(colorMode)}`}
        {...(!isFullscreen ? swipeHandlers : {})}
      >
        {loading ? (
          <ReaderLoadingState book={book} colorMode={colorMode} progress={progress} />
        ) : error ? (
          <div className="flex items-center justify-center text-red-400 text-sm">{error}</div>
        ) : (
          <div
            ref={chapterRef}
            onAnimationEnd={() => setPageAnim(null)}
            onMouseUp={handleMouseUp}
            onDoubleClick={handleDoubleClick}
            className={`relative shadow-lg rounded-xl max-w-2xl w-full h-fit p-10 leading-relaxed ${pageAnim === "next" ? "ml-page-anim-next" : pageAnim === "prev" ? "ml-page-anim-prev" : ""}`}
            style={{ backgroundColor: colors.background, color: colors.foreground, fontSize: `${readerFontSizePx(fontSize, 15)}px` }}
            dangerouslySetInnerHTML={{ __html: chapterHtml }}
          />
        )}
      </div>
      </ZoomPanWrapper>

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
            <span className="text-xs text-gray-500 w-24 text-center shrink-0">
              Chapter {currentPage} / {chapterCount}
            </span>
            <button
              onClick={() => goToPage(currentPage + 1)}
              disabled={currentPage >= chapterCount}
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
