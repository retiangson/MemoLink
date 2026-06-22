import React, { useEffect, useRef, useState } from "react";
import ePub from "epubjs";
import type Book from "epubjs/types/book";
import type Rendition from "epubjs/types/rendition";
import type Contents from "epubjs/types/contents";
import {
  fetchBookBlob, updateBookProgress, addBookmark, listBookmarks,
  type Bookmark,
} from "../../api/booksApi";
import type { ReaderViewProps } from "./format";
import { currentHighlightRange, findSentenceIndexForOffset } from "./format";
import { useTTS, splitSentences } from "../../hooks/useTTS";
import { usePageSwipe, computeSwipeDirection } from "../../hooks/usePageSwipe";
import { TTSPlayerBar } from "../TTSPlayerBar";
import { NoteSourceButton } from "./NoteSourceButton";
import { PageNavArrows } from "./PageNavArrows";

const HIGHLIGHT_NAME = "ml-tts";

interface TextNodeEntry {
  node: Text;
  start: number;
  end: number;
  doc: Document;
  win: any;
}

function buildCombinedTextMap(list: Contents[]): { text: string; nodes: TextNodeEntry[] } {
  let text = "";
  const nodes: TextNodeEntry[] = [];
  list.forEach((c: any, ci: number) => {
    const root: Element | undefined = c?.content;
    const doc: Document | undefined = c?.document;
    if (!root || !doc) return;
    const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let n: Node | null;
    while ((n = walker.nextNode())) {
      const tn = n as Text;
      const value = tn.nodeValue || "";
      if (!value) continue;
      nodes.push({ node: tn, start: text.length, end: text.length + value.length, doc, win: c.window });
      text += value;
    }
    if (ci < list.length - 1) text += " ";
  });
  return { text, nodes };
}

function ensureHighlightStyle(doc: Document) {
  if (doc.getElementById("ml-tts-highlight-style")) return;
  const style = doc.createElement("style");
  style.id = "ml-tts-highlight-style";
  style.textContent = `::highlight(${HIGHLIGHT_NAME}) { background-color: rgba(99,102,241,0.45); }`;
  doc.head?.appendChild(style);
}

export function EpubReaderView({
  book, initialPage, onProgress,
  noteStatus, noteStatusLoaded, savingNoteSource, onSaveAsNoteSource,
}: ReaderViewProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const epubBookRef = useRef<Book | null>(null);
  const renditionRef = useRef<Rendition | null>(null);
  const pageTextRef = useRef<string>("");
  const textNodesRef = useRef<TextNodeEntry[]>([]);
  const activeHighlightWinsRef = useRef<Set<any>>(new Set());
  const clickListenersRef = useRef<{ doc: Document; fn: (e: MouseEvent) => void }[]>([]);
  const swipeListenersRef = useRef<{ doc: Document; start: (e: TouchEvent) => void; end: (e: TouchEvent) => void }[]>([]);
  const autoContinueRef = useRef(false);
  // epub.js callbacks (rendition.on("relocated", ...), iframe doc listeners) are registered
  // once outside React's render cycle, so they'd otherwise close over stale currentPage/numPages
  // state from whenever they were attached. These refs are updated synchronously alongside the
  // state setters so imperative code always sees the latest values.
  const currentPageRef = useRef(Math.max(1, initialPage || 1));
  const numPagesRef = useRef(0);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [numPages, setNumPages] = useState(0);
  const [currentPage, setCurrentPage] = useState(Math.max(1, initialPage || 1));
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([]);
  const [showBookmarks, setShowBookmarks] = useState(false);
  const [pageAnim, setPageAnim] = useState<"next" | "prev" | null>(null);

  const tts = useTTS();

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    (async () => {
      try {
        const blob = await fetchBookBlob(book.id);
        const buf = await blob.arrayBuffer();
        if (cancelled || !containerRef.current) return;

        const epubBook = ePub(buf);
        epubBookRef.current = epubBook;
        await epubBook.ready;

        const rendition = epubBook.renderTo(containerRef.current, {
          width: "100%",
          height: "100%",
          flow: "paginated",
          spread: "none",
        });
        renditionRef.current = rendition;

        await epubBook.locations.generate(1000);
        if (cancelled) return;
        const total = epubBook.locations.length();
        numPagesRef.current = total;
        setNumPages(total);

        const startLoc = Math.min(Math.max(0, (initialPage || 1) - 1), Math.max(0, total - 1));
        currentPageRef.current = startLoc + 1;
        const startCfi = total > 0 ? epubBook.locations.cfiFromLocation(startLoc) : undefined;
        await rendition.display(startCfi);
        if (cancelled) return;
        refreshTextMap();

        rendition.on("relocated", (location: any) => {
          const idx = epubBook.locations.locationFromCfi(location.start.cfi);
          if (typeof idx === "number" && idx >= 0) {
            currentPageRef.current = idx + 1;
            setCurrentPage(idx + 1);
          }
          refreshTextMap();
          if (autoContinueRef.current) {
            autoContinueRef.current = false;
            speakPage(0);
          }
        });

        setLoading(false);
      } catch {
        if (!cancelled) {
          setError("Could not load this book. It may no longer be available in OneDrive.");
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
      clearHighlight();
      clearClickListeners();
      clearSwipeListeners();
      renditionRef.current?.destroy();
      epubBookRef.current?.destroy();
      renditionRef.current = null;
      epubBookRef.current = null;
    };
  }, [book.id]);

  useEffect(() => {
    listBookmarks(book.id).then(setBookmarks).catch(() => {});
  }, [book.id]);

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

  function clearHighlight() {
    activeHighlightWinsRef.current.forEach((win) => {
      try { win?.CSS?.highlights?.delete(HIGHLIGHT_NAME); } catch { /* ignore */ }
    });
    activeHighlightWinsRef.current.clear();
  }

  function applyHighlight(range: { start: number; end: number } | null) {
    clearHighlight();
    if (!range) return;
    const byWin = new Map<any, Range[]>();
    for (const n of textNodesRef.current) {
      if (n.end <= range.start || n.start >= range.end) continue;
      if (!n.win?.CSS?.highlights || !n.win?.Highlight) continue;
      const s = Math.max(0, range.start - n.start);
      const e = Math.min(n.node.length, range.end - n.start);
      if (e <= s) continue;
      const r = n.doc.createRange();
      r.setStart(n.node, s);
      r.setEnd(n.node, e);
      ensureHighlightStyle(n.doc);
      const arr = byWin.get(n.win) ?? [];
      arr.push(r);
      byWin.set(n.win, arr);
    }
    byWin.forEach((ranges, win) => {
      const hl = new win.Highlight(...ranges);
      win.CSS.highlights.set(HIGHLIGHT_NAME, hl);
      activeHighlightWinsRef.current.add(win);
    });
  }

  // Highlight the text currently being read aloud, synced to TTS playback position.
  useEffect(() => {
    if (!tts.playing) { clearHighlight(); return; }
    const range = currentHighlightRange(pageTextRef.current, tts.sentencesList, tts.currentSentenceIdx, tts.currentWord);
    applyHighlight(range);
  }, [tts.playing, tts.currentSentenceIdx, tts.currentWord, tts.sentencesList]);

  function clearClickListeners() {
    clickListenersRef.current.forEach(({ doc, fn }) => doc.removeEventListener("dblclick", fn));
    clickListenersRef.current = [];
  }

  function clearSwipeListeners() {
    swipeListenersRef.current.forEach(({ doc, start, end }) => {
      doc.removeEventListener("touchstart", start);
      doc.removeEventListener("touchend", end);
    });
    swipeListenersRef.current = [];
  }

  function refreshTextMap() {
    const rendition = renditionRef.current;
    if (!rendition) return;
    const contents = rendition.getContents();
    const list = (Array.isArray(contents) ? contents : [contents]) as Contents[];
    const { text, nodes } = buildCombinedTextMap(list);
    pageTextRef.current = text;
    textNodesRef.current = nodes;
    attachClickListeners(list);
    attachSwipeListeners(list);
  }

  function attachClickListeners(list: Contents[]) {
    clearClickListeners();
    list.forEach((c: any) => {
      const doc: Document | undefined = c?.document;
      if (!doc) return;
      const fn = (e: MouseEvent) => {
        const d: any = doc;
        let range: Range | null = null;
        if (d.caretRangeFromPoint) {
          range = d.caretRangeFromPoint(e.clientX, e.clientY);
        } else if (d.caretPositionFromPoint) {
          const pos = d.caretPositionFromPoint(e.clientX, e.clientY);
          if (pos) { range = doc.createRange(); range.setStart(pos.offsetNode, pos.offset); }
        }
        if (!range) return;
        const entry = textNodesRef.current.find((n) => n.node === range!.startContainer);
        if (!entry) return;
        handleSentenceClick(entry.start + range!.startOffset);
      };
      doc.addEventListener("dblclick", fn);
      clickListenersRef.current.push({ doc, fn });
    });
  }

  // The rendered page content lives inside epub.js's own iframe per chapter, which is a
  // separate DOM tree — touch events inside it never bubble out to the outer container's
  // usePageSwipe handlers. Attaching listeners directly to each iframe document is the only
  // way to detect a swipe gesture made over the actual book content.
  function attachSwipeListeners(list: Contents[]) {
    clearSwipeListeners();
    list.forEach((c: any) => {
      const doc: Document | undefined = c?.document;
      if (!doc) return;
      let startPoint: { x: number; y: number } | null = null;
      const start = (e: TouchEvent) => {
        const t = e.touches[0];
        if (t) startPoint = { x: t.clientX, y: t.clientY };
      };
      const end = (e: TouchEvent) => {
        const s = startPoint;
        startPoint = null;
        if (!s) return;
        const t = e.changedTouches[0];
        if (!t) return;
        const dir = computeSwipeDirection(t.clientX - s.x, t.clientY - s.y, 50);
        if (dir === "next") void goToPage(currentPageRef.current + 1);
        else if (dir === "prev") void goToPage(currentPageRef.current - 1);
      };
      doc.addEventListener("touchstart", start, { passive: true });
      doc.addEventListener("touchend", end, { passive: true });
      swipeListenersRef.current.push({ doc, start, end });
    });
  }

  async function navigateTo(p: number) {
    const epubBook = epubBookRef.current;
    const rendition = renditionRef.current;
    const numPagesNow = numPagesRef.current;
    const curPage = currentPageRef.current;
    if (!epubBook || !rendition || p < 1 || p > numPagesNow || p === curPage) return;
    tts.stop();
    clearHighlight();
    setPageAnim(p > curPage ? "next" : "prev");
    await rendition.display(epubBook.locations.cfiFromLocation(p - 1));
  }

  async function goToPage(p: number) {
    autoContinueRef.current = false;
    await navigateTo(p);
  }

  const swipeHandlers = usePageSwipe(
    () => goToPage(currentPageRef.current - 1),
    () => goToPage(currentPageRef.current + 1),
  );

  async function handleBookmark() {
    try {
      const bm = await addBookmark(book.id, currentPage);
      setBookmarks((prev) => [bm, ...prev.filter((b) => b.page_number !== currentPage)]);
    } catch {
      // ignore
    }
  }

  function handleAutoAdvanceRead() {
    if (currentPageRef.current >= numPagesRef.current) return;
    autoContinueRef.current = true;
    void navigateTo(currentPageRef.current + 1);
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
      <div className="flex-1 overflow-hidden relative" {...swipeHandlers}>
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center text-gray-500 text-sm">Loading book…</div>
        )}
        {error ? (
          <div className="absolute inset-0 flex items-center justify-center text-red-400 text-sm">{error}</div>
        ) : (
          <>
            <div
              onAnimationEnd={() => setPageAnim(null)}
              className={`w-full h-full ${pageAnim === "next" ? "ml-page-anim-next" : pageAnim === "prev" ? "ml-page-anim-prev" : ""}`}
            >
              <div ref={containerRef} className="w-full h-full bg-white" />
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
