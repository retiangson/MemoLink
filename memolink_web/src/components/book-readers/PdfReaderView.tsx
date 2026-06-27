import React, { useEffect, useRef, useState, useCallback } from "react";
import * as pdfjsLib from "pdfjs-dist";
import workerSrc from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import "pdfjs-dist/web/pdf_viewer.css";
import {
  fetchBookBlob, updateBookProgress, addBookmark, listBookmarks, addBookHighlight, listBookHighlights,
  type Bookmark, type BookHighlight,
} from "../../api/booksApi";
import type { ReaderViewProps, HighlightAnchor } from "./format";
import { currentHighlightRange, findSentenceIndexForOffset, pdfCanvasFilter, readerFontScale, readerSurfaceClass } from "./format";
import { useTTS, splitSentences, type TTSQueueOutcome } from "../../hooks/useTTS";
import { usePageSwipe } from "../../hooks/usePageSwipe";
import { useHighlightColor } from "../../hooks/useHighlightColor";
import { TTSPlayerBar } from "../TTSPlayerBar";
import { NoteSourceButton } from "./NoteSourceButton";
import { HighlightColorPicker } from "./HighlightColorPicker";
import { PageNavArrows } from "./PageNavArrows";
import { ReaderLoadingState } from "./ReaderLoadingState";
import { highlightColorMark } from "./highlightColors";
import { ZoomPanWrapper } from "./ZoomPanWrapper";
import { disposeReaderAfterPaint, isNativeReaderPlatform } from "./nativeReaderLifecycle";

interface PendingSelection { start: number; end: number; }

pdfjsLib.GlobalWorkerOptions.workerSrc = workerSrc;

export function PdfReaderView({
  book, initialPage, colorMode, fontSize, onProgress,
  noteStatus, noteStatusLoaded, savingNoteSource, onSaveAsNoteSource,
  jumpToHighlight, onJumpToHighlightHandled, onHighlightAdded, isFullscreen, isActive,
}: ReaderViewProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const textLayerRef = useRef<HTMLDivElement | null>(null);
  const pdfDocRef = useRef<pdfjsLib.PDFDocumentProxy | null>(null);
  const renderTaskRef = useRef<{ cancel: () => void } | null>(null);
  const pageTextRef = useRef<string>("");
  const itemRangesRef = useRef<{ start: number; end: number }[]>([]);
  const textDivsRef = useRef<HTMLElement[]>([]);
  const persistentBgRef = useRef<string[]>([]);
  const highlightsRef = useRef<BookHighlight[]>([]);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [numPages, setNumPages] = useState(0);
  const [currentPage, setCurrentPage] = useState(Math.max(1, initialPage || 1));
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([]);
  const [showBookmarks, setShowBookmarks] = useState(false);
  const [viewportSize, setViewportSize] = useState({ width: 0, height: 0 });
  const [pageAnim, setPageAnim] = useState<"next" | "prev" | null>(null);
  const [pendingSelection, setPendingSelection] = useState<PendingSelection | null>(null);
  const [highlights, setHighlights] = useState<BookHighlight[]>([]);
  const [progress, setProgress] = useState<{ loaded: number; total: number | null } | null>(null);
  const autoContinueRef = useRef(false);

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
        const buf = await blob.arrayBuffer();
        const doc = await pdfjsLib.getDocument({ data: buf }).promise;
        if (cancelled) {
          if (isNativeReaderPlatform()) {
            disposeReaderAfterPaint(() => { void doc.destroy().catch(() => {}); });
          }
          return;
        }
        pdfDocRef.current = doc;
        setNumPages(doc.numPages);
        setCurrentPage((p) => Math.min(Math.max(1, p), doc.numPages));
      } catch {
        if (!cancelled) setError("Could not load this book. It may no longer be available in the library.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
      if (!isNativeReaderPlatform()) return;
      const renderTask = renderTaskRef.current;
      const pdfDoc = pdfDocRef.current;
      renderTaskRef.current = null;
      pdfDocRef.current = null;
      disposeReaderAfterPaint(() => {
        try { renderTask?.cancel(); } catch { /* best-effort teardown */ }
        void pdfDoc?.destroy().catch(() => {});
      });
    };
  }, [book.id]);

  useEffect(() => {
    listBookmarks(book.id).then(setBookmarks).catch(() => {});
  }, [book.id]);

  useEffect(() => {
    listBookHighlights(book.id).then(setHighlights).catch(() => {});
  }, [book.id]);

  // Kept in sync via effect so applyPersistentHighlights always reads the latest fetched
  // highlights regardless of which render's closure happens to invoke it — the highlights
  // fetch and the page text-layer render race independently, and whichever finishes last
  // needs fresh data from the other, not whatever was captured when its own effect fired.
  useEffect(() => {
    highlightsRef.current = highlights;
  }, [highlights]);

  // Repaints every saved highlight on the currently rendered page as a permanent text-div
  // background color — this is what makes highlights visible again on revisit, not just
  // flash briefly. Stored per-div in persistentBgRef so the TTS-highlight effect below can
  // restore to it (instead of clearing to "") when TTS moves past a div.
  const applyPersistentHighlights = useCallback(() => {
    const divs = textDivsRef.current;
    const ranges = itemRangesRef.current;
    const onThisPage = highlightsRef.current.filter((h) => h.page_number === currentPage);
    const bg = ranges.map((r) => {
      const match = onThisPage.find((h) => r.end > h.start_offset && r.start < h.end_offset);
      return match ? highlightColorMark(match.color) : "";
    });
    persistentBgRef.current = bg;
    divs.forEach((d, i) => { d.style.backgroundColor = bg[i] || ""; });
  }, [currentPage]);

  // Re-applies whenever the highlights list itself changes (initial fetch resolving, or a
  // highlight just added) — the page-change case is handled explicitly in the renderPage
  // effect below, since textDivsRef is only fresh once that async render completes.
  useEffect(() => {
    applyPersistentHighlights();
  }, [highlights, applyPersistentHighlights]);

  const renderPage = useCallback(async (pageNum: number) => {
    const doc = pdfDocRef.current;
    const canvas = canvasRef.current;
    if (!doc || !canvas) return;
    renderTaskRef.current?.cancel();
    const page = await doc.getPage(pageNum);
    const viewport = page.getViewport({ scale: 1.4 * readerFontScale(fontSize) });
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    setViewportSize({ width: viewport.width, height: viewport.height });
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const task = page.render({ canvasContext: ctx, viewport, canvas });
    renderTaskRef.current = task;
    try {
      await task.promise;
    } catch {
      // cancelled render, ignore
    }

    const content = await page.getTextContent();
    let text = "";
    const ranges: { start: number; end: number }[] = [];
    const items = content.items as any[];
    items.forEach((item, i) => {
      const str = item.str ?? "";
      const start = text.length;
      text += str;
      ranges.push({ start, end: start + str.length });
      if (i < items.length - 1) text += " ";
    });
    pageTextRef.current = text;
    itemRangesRef.current = ranges;

    const textLayerDiv = textLayerRef.current;
    if (textLayerDiv) {
      textLayerDiv.replaceChildren();
      // pdf_viewer.css derives span font sizes from --total-scale-factor (normally supplied
      // by the full PDFPageView's ".pdfViewer .page" wrapper, which this custom integration
      // doesn't use) — without it the calc() chain is invalid and spans collapse to the
      // inherited font-size, breaking the geometry text selection depends on.
      textLayerDiv.style.setProperty("--scale-factor", String(viewport.scale));
      textLayerDiv.style.setProperty("--user-unit", "1");
      textLayerDiv.style.setProperty("--total-scale-factor", String(viewport.scale));
      const textLayer = new pdfjsLib.TextLayer({ textContentSource: content, container: textLayerDiv, viewport });
      await textLayer.render();
      textDivsRef.current = textLayer.textDivs as HTMLElement[];
    }
  }, [fontSize]);

  useEffect(() => {
    if (loading || !pdfDocRef.current) return;
    // Skip rendering while the reader is hidden with display:none (isActive===false).
    // Chromium frees the canvas GPU texture under display:none, so rendering is wasted.
    // When isActive flips back to true this effect re-fires and re-paints the page.
    if (isActive === false) return;
    renderPage(currentPage).then(() => {
      applyPersistentHighlights();
      if (autoContinueRef.current) {
        autoContinueRef.current = false;
        speakPage(0);
      }
      if (jumpToHighlight && jumpToHighlight.page === currentPage) {
        flashOrPulseHighlight(jumpToHighlight);
        onJumpToHighlightHandled?.();
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPage, loading, renderPage, isActive]);

  // Arrival from a Note double-click: jump to the highlight's page if we're not
  // already there (the render effect above handles the flash once that page loads).
  useEffect(() => {
    if (!jumpToHighlight || loading) return;
    if (jumpToHighlight.page !== currentPage) {
      goToPage(jumpToHighlight.page);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jumpToHighlight, loading]);

  useEffect(() => {
    if (loading || numPages === 0) return;
    const t = setTimeout(() => {
      updateBookProgress(book.id, currentPage, numPages).catch(() => {});
      onProgress?.(currentPage, numPages);
    }, 600);
    return () => clearTimeout(t);
  }, [currentPage, numPages, loading, book.id, onProgress]);

  useEffect(() => {
    return () => { window.speechSynthesis?.cancel(); };
  }, []);

  // Highlight the text currently being read aloud, synced to TTS playback position.
  useEffect(() => {
    const divs = textDivsRef.current;
    divs.forEach((d, i) => { d.style.backgroundColor = persistentBgRef.current[i] || ""; });
    if (!tts.playing) return;
    const range = currentHighlightRange(pageTextRef.current, tts.sentencesList, tts.currentSentenceIdx, tts.currentWord);
    if (!range) return;
    itemRangesRef.current.forEach((r, i) => {
      if (r.end > range.start && r.start < range.end) {
        const d = divs[i];
        if (d) d.style.backgroundColor = "rgba(99,102,241,0.45)";
      }
    });
  }, [tts.playing, tts.currentSentenceIdx, tts.currentWord, tts.sentencesList]);

  function goToPage(p: number) {
    if (p < 1 || p > numPages || p === currentPage) return;
    autoContinueRef.current = false;
    tts.stop();
    setPendingSelection(null);
    setPageAnim(p > currentPage ? "next" : "prev");
    setCurrentPage(p);
  }

  // Maps a DOM (node, offsetInNode) selection boundary back to an absolute char
  // offset into pageTextRef, via the same textDivsRef/itemRangesRef lookup the
  // existing onDoubleClick handler below uses (just per-character, not per-item).
  function domNodeToOffset(node: Node | null, offsetInNode: number): number | null {
    if (!node) return null;
    // Walk all the way up to whichever ancestor is actually one of the rendered text
    // divs — pdf.js wraps tagged-content text items in an intermediate ".markedContent"
    // span, so the nearest span/div ancestor isn't always the one tracked in textDivsRef.
    let el: HTMLElement | null = node.nodeType === Node.TEXT_NODE ? node.parentElement : (node as HTMLElement);
    const divs = textDivsRef.current;
    while (el && !divs.includes(el)) el = el.parentElement;
    if (!el) return null;
    const idx = divs.indexOf(el);
    if (idx === -1) return null;
    const range = itemRangesRef.current[idx];
    if (!range) return null;
    const len = range.end - range.start;
    return range.start + Math.min(len, Math.max(0, offsetInNode));
  }

  function handleTextLayerMouseUp() {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || sel.rangeCount === 0 || !textLayerRef.current?.contains(sel.anchorNode)) {
      setPendingSelection(null);
      return;
    }
    const startOffset = domNodeToOffset(sel.anchorNode, sel.anchorOffset);
    const endOffset = domNodeToOffset(sel.focusNode, sel.focusOffset);
    if (startOffset == null || endOffset == null) {
      setPendingSelection(null);
      return;
    }
    const start = Math.min(startOffset, endOffset);
    const end = Math.max(startOffset, endOffset);
    if (end <= start) {
      setPendingSelection(null);
      return;
    }
    setPendingSelection({ start, end });
  }

  async function handleAddHighlight(colorId: string) {
    if (!pendingSelection) return;
    const snippet = pageTextRef.current.slice(pendingSelection.start, pendingSelection.end);
    const created = await addBookHighlight(book.id, {
      format: "pdf",
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

  // Arrival from a Note double-click: pulse the divs if they already carry a persistent
  // highlight color (the usual case), otherwise fall back to a temporary yellow flash.
  function flashOrPulseHighlight(anchor: HighlightAnchor) {
    const divs = textDivsRef.current;
    const ranges = itemRangesRef.current;
    const indices: number[] = [];
    ranges.forEach((r, i) => {
      if (r.end > anchor.start && r.start < anchor.end) indices.push(i);
    });
    const targets = indices.map((i) => divs[i]).filter(Boolean);
    if (targets.length === 0) return;
    targets[0].scrollIntoView({ behavior: "smooth", block: "center" });
    const alreadyPersisted = indices.some((i) => persistentBgRef.current[i]);
    if (alreadyPersisted) {
      targets.forEach((d) => d.classList.add("ml-hl-pulse"));
      setTimeout(() => targets.forEach((d) => d.classList.remove("ml-hl-pulse")), 1600);
      return;
    }
    targets.forEach((d) => { d.style.backgroundColor = "rgba(250,204,21,0.6)"; });
    setTimeout(() => {
      targets.forEach((d, idx) => { d.style.backgroundColor = persistentBgRef.current[indices[idx]] || ""; });
    }, 2500);
  }

  const swipeHandlers = usePageSwipe(() => goToPage(currentPage - 1), () => goToPage(currentPage + 1));

  async function handleBookmark() {
    try {
      const bm = await addBookmark(book.id, currentPage);
      setBookmarks((prev) => [bm, ...prev.filter((b) => b.page_number !== currentPage)]);
    } catch {
      // ignore
    }
  }

  function handleAutoAdvanceRead(outcome: TTSQueueOutcome) {
    if (outcome !== "completed") return;
    if (currentPage >= numPages) return;
    autoContinueRef.current = true;
    setPageAnim("next");
    setCurrentPage((p) => Math.min(p + 1, numPages));
  }

  function speakPage(startIdx: number) {
    const text = pageTextRef.current;
    if (!text.trim()) return;
    tts.speak(text, startIdx, handleAutoAdvanceRead);
  }

  function handleReadAloud() {
    if (tts.playing) {
      if (tts.paused) tts.resume(); else tts.pause();
      return;
    }
    speakPage(0);
  }

  function handleSentenceClick(charOffset: number) {
    const text = pageTextRef.current;
    if (!text.trim()) return;
    if (tts.playing) tts.stop();
    const idx = findSentenceIndexForOffset(text, splitSentences(text), charOffset);
    speakPage(idx);
  }

  const isBookmarked = bookmarks.some((b) => b.page_number === currentPage);

  return (
    <>
      <ZoomPanWrapper
        active={!!isFullscreen}
        surfaceClass={readerSurfaceClass(colorMode)}
        onSwipeLeft={() => goToPage(currentPage + 1)}
        onSwipeRight={() => goToPage(currentPage - 1)}
        overlay={!loading && !error ? <PageNavArrows onPrev={() => goToPage(currentPage - 1)} onNext={() => goToPage(currentPage + 1)} canPrev={currentPage > 1} canNext={currentPage < numPages} /> : undefined}
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
            onAnimationEnd={() => setPageAnim(null)}
            className={`relative shadow-lg rounded bg-white max-w-full h-fit overflow-hidden ${pageAnim === "next" ? "ml-page-anim-next" : pageAnim === "prev" ? "ml-page-anim-prev" : ""}`}
            style={{ width: viewportSize.width || undefined, height: viewportSize.height || undefined }}
          >
            <canvas
              ref={canvasRef}
              className="block w-full h-full transition-[filter]"
              style={{ filter: pdfCanvasFilter(colorMode) }}
            />
            {/* pdf_viewer.css sets ::selection to transparent (pdf.js's own viewer draws its
                own highlight overlay instead) — without an override, dragging to select text
                here gives zero visual feedback, which looks identical to selection not working
                at all even though the underlying Range API is functioning correctly. */}
            <style>{`
              .textLayer ::selection, .textLayer ::-moz-selection {
                background: rgba(99, 102, 241, 0.4);
              }
            `}</style>
            <div
              ref={textLayerRef}
              className="textLayer absolute inset-0 cursor-text"
              title="Double-click a sentence to start reading from there"
              onMouseUp={handleTextLayerMouseUp}
              onDoubleClick={(e) => {
                const target = (e.target as HTMLElement).closest("span, div") as HTMLElement | null;
                window.getSelection()?.removeAllRanges();
                setPendingSelection(null);
                if (!target) return;
                const idx = textDivsRef.current.indexOf(target);
                if (idx === -1) return;
                const range = itemRangesRef.current[idx];
                if (!range) return;
                handleSentenceClick(range.start);
              }}
            />
          </div>
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
              Page {currentPage} / {numPages}
            </span>
            <button
              onClick={() => goToPage(currentPage + 1)}
              disabled={currentPage >= numPages}
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
