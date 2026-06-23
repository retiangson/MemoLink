import React, { useEffect, useRef, useState, useCallback } from "react";
import * as pdfjsLib from "pdfjs-dist";
import workerSrc from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import "pdfjs-dist/web/pdf_viewer.css";
import {
  fetchBookBlob, updateBookProgress, addBookmark, listBookmarks,
  type Bookmark,
} from "../../api/booksApi";
import type { ReaderViewProps } from "./format";
import { currentHighlightRange, findSentenceIndexForOffset, pdfCanvasFilter, readerSurfaceClass } from "./format";
import { useTTS, splitSentences } from "../../hooks/useTTS";
import { usePageSwipe } from "../../hooks/usePageSwipe";
import { TTSPlayerBar } from "../TTSPlayerBar";
import { NoteSourceButton } from "./NoteSourceButton";
import { PageNavArrows } from "./PageNavArrows";
import { ReaderLoadingState } from "./ReaderLoadingState";

pdfjsLib.GlobalWorkerOptions.workerSrc = workerSrc;

export function PdfReaderView({
  book, initialPage, colorMode, onProgress,
  noteStatus, noteStatusLoaded, savingNoteSource, onSaveAsNoteSource,
}: ReaderViewProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const textLayerRef = useRef<HTMLDivElement | null>(null);
  const pdfDocRef = useRef<pdfjsLib.PDFDocumentProxy | null>(null);
  const renderTaskRef = useRef<{ cancel: () => void } | null>(null);
  const pageTextRef = useRef<string>("");
  const itemRangesRef = useRef<{ start: number; end: number }[]>([]);
  const textDivsRef = useRef<HTMLElement[]>([]);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [numPages, setNumPages] = useState(0);
  const [currentPage, setCurrentPage] = useState(Math.max(1, initialPage || 1));
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([]);
  const [showBookmarks, setShowBookmarks] = useState(false);
  const [viewportSize, setViewportSize] = useState({ width: 0, height: 0 });
  const [pageAnim, setPageAnim] = useState<"next" | "prev" | null>(null);
  const autoContinueRef = useRef(false);

  const tts = useTTS();

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const blob = await fetchBookBlob(book);
        const buf = await blob.arrayBuffer();
        const doc = await pdfjsLib.getDocument({ data: buf }).promise;
        if (cancelled) return;
        pdfDocRef.current = doc;
        setNumPages(doc.numPages);
        setCurrentPage((p) => Math.min(Math.max(1, p), doc.numPages));
      } catch {
        if (!cancelled) setError("Could not load this book. It may no longer be available in OneDrive.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [book.id]);

  useEffect(() => {
    listBookmarks(book.id).then(setBookmarks).catch(() => {});
  }, [book.id]);

  const renderPage = useCallback(async (pageNum: number) => {
    const doc = pdfDocRef.current;
    const canvas = canvasRef.current;
    if (!doc || !canvas) return;
    renderTaskRef.current?.cancel();
    const page = await doc.getPage(pageNum);
    const viewport = page.getViewport({ scale: 1.4 });
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
      textLayerDiv.style.setProperty("--scale-factor", String(viewport.scale));
      const textLayer = new pdfjsLib.TextLayer({ textContentSource: content, container: textLayerDiv, viewport });
      await textLayer.render();
      textDivsRef.current = textLayer.textDivs as HTMLElement[];
    }
  }, []);

  useEffect(() => {
    if (loading || !pdfDocRef.current) return;
    renderPage(currentPage).then(() => {
      if (autoContinueRef.current) {
        autoContinueRef.current = false;
        speakPage(0);
      }
    });
  }, [currentPage, loading, renderPage]);

  useEffect(() => {
    if (loading || numPages === 0) return;
    const t = setTimeout(() => {
      updateBookProgress(book.id, currentPage, numPages).catch(() => {});
      onProgress?.(currentPage, numPages);
    }, 600);
    return () => clearTimeout(t);
  }, [currentPage, numPages, loading, book.id, onProgress]);

  useEffect(() => {
    return () => { window.speechSynthesis.cancel(); };
  }, []);

  // Highlight the text currently being read aloud, synced to TTS playback position.
  useEffect(() => {
    const divs = textDivsRef.current;
    divs.forEach((d) => { d.style.backgroundColor = ""; });
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
    setPageAnim(p > currentPage ? "next" : "prev");
    setCurrentPage(p);
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

  function handleAutoAdvanceRead() {
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
      <div
        className={`flex-1 overflow-auto flex justify-center py-6 px-4 relative transition-colors ${readerSurfaceClass(colorMode)}`}
        {...swipeHandlers}
      >
        {loading ? (
          <ReaderLoadingState book={book} colorMode={colorMode} />
        ) : error ? (
          <div className="flex items-center justify-center text-red-400 text-sm">{error}</div>
        ) : (
          <>
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
              <div
                ref={textLayerRef}
                className="textLayer absolute inset-0 cursor-text"
                title="Double-click a sentence to start reading from there"
                onDoubleClick={(e) => {
                  const target = (e.target as HTMLElement).closest("span, div") as HTMLElement | null;
                  if (!target) return;
                  const idx = textDivsRef.current.indexOf(target);
                  if (idx === -1) return;
                  const range = itemRangesRef.current[idx];
                  if (!range) return;
                  handleSentenceClick(range.start);
                }}
              />
            </div>
            <PageNavArrows
              onPrev={() => goToPage(currentPage - 1)}
              onNext={() => goToPage(currentPage + 1)}
              canPrev={currentPage > 1}
              canNext={currentPage < numPages}
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
