import React, { useEffect, useRef, useState } from "react";
import { fetchBookBlob, updateBookProgress, addBookHighlight, listBookHighlights, type BookHighlight } from "../../api/booksApi";
import type { ReaderViewProps, HighlightAnchor } from "./format";
import { readerSurfaceClass, readerThemeColors, readerFontSizePx, formatTimestamp } from "./format";
import { useTTS } from "../../hooks/useTTS";
import { usePageSwipe } from "../../hooks/usePageSwipe";
import { useHighlightColor } from "../../hooks/useHighlightColor";
import { TTSPlayerBar } from "../TTSPlayerBar";
import { NoteSourceButton } from "./NoteSourceButton";
import { HighlightColorPicker } from "./HighlightColorPicker";
import { PageNavArrows } from "./PageNavArrows";
import { ReaderLoadingState } from "./ReaderLoadingState";
import { parseCaptions, type Cue } from "./captions";
import { highlightColorMark } from "./highlightColors";
import { ZoomPanWrapper } from "./ZoomPanWrapper";
import { useSelectionChangeCapture } from "../../hooks/useSelectionChangeCapture";

interface PendingSelection { x: number; y: number; start: number; end: number; }
interface PersistedCueHighlight { id: number; start: number; end: number; color: string; }

const CUES_PER_PAGE = 25;
const SEPARATOR_LEN = 1; // matches the "\n" join used by pageJoinedText below

function paginateCues(cues: Cue[], perPage: number): Cue[][] {
  if (cues.length === 0) return [[]];
  const pages: Cue[][] = [];
  for (let i = 0; i < cues.length; i += perPage) pages.push(cues.slice(i, i + perPage));
  return pages;
}

function pageJoinedText(cues: Cue[]): string {
  return cues.map((c) => c.text).join("\n");
}

// Caption pages render a timestamp label + a ".cue-text" span per cue. Offsets and
// highlight-flashing only ever walk the ".cue-text" spans (skipping the non-selectable
// timestamp labels) — bespoke rather than the generic domTextHighlight.ts walker, since
// here the set of "real" text nodes is a known subset of the container, not all of it.
function offsetInCueText(container: HTMLElement, node: Node, offsetInNode: number): number | null {
  const cueEls = Array.from(container.querySelectorAll<HTMLElement>(".cue-text"));
  let total = 0;
  for (const cueEl of cueEls) {
    const walker = document.createTreeWalker(cueEl, NodeFilter.SHOW_TEXT);
    let n: Node | null;
    while ((n = walker.nextNode())) {
      if (n === node) return total + offsetInNode;
      total += (n.nodeValue || "").length;
    }
    total += SEPARATOR_LEN;
  }
  return null;
}

function findCueSegments(container: HTMLElement, start: number, end: number): { node: Text; start: number; end: number }[] {
  const cueEls = Array.from(container.querySelectorAll<HTMLElement>(".cue-text"));
  let total = 0;
  const segments: { node: Text; start: number; end: number }[] = [];
  for (const cueEl of cueEls) {
    const walker = document.createTreeWalker(cueEl, NodeFilter.SHOW_TEXT);
    let n: Node | null;
    while ((n = walker.nextNode())) {
      const tn = n as Text;
      const len = (tn.nodeValue || "").length;
      const segStart = total;
      const segEnd = total + len;
      total += len;
      if (segEnd <= start || segStart >= end) continue;
      segments.push({ node: tn, start: Math.max(0, start - segStart), end: Math.min(len, end - segStart) });
    }
    total += SEPARATOR_LEN;
  }
  return segments;
}

function wrapCueSegments(segments: { node: Text; start: number; end: number }[], decorate: (mark: HTMLElement) => void): HTMLElement[] {
  const marks: HTMLElement[] = [];
  segments.forEach(({ node, start, end }) => {
    if (end <= start) return;
    const range = document.createRange();
    range.setStart(node, start);
    range.setEnd(node, end);
    const mark = document.createElement("mark");
    decorate(mark);
    try {
      range.surroundContents(mark);
      marks.push(mark);
    } catch {
      // DOM structure prevented wrapping this segment; skip it
    }
  });
  return marks;
}

function unwrapCueMarks(marks: HTMLElement[]) {
  marks.forEach((mark) => {
    const parent = mark.parentNode;
    if (!parent) return;
    while (mark.firstChild) parent.insertBefore(mark.firstChild, mark);
    parent.removeChild(mark);
    parent.normalize();
  });
}

function flashCueRange(container: HTMLElement, anchor: Pick<HighlightAnchor, "start" | "end">) {
  const marks = wrapCueSegments(findCueSegments(container, anchor.start, anchor.end), (mark) => {
    mark.style.backgroundColor = "rgba(250,204,21,0.6)";
    mark.style.color = "inherit";
  });
  marks[0]?.scrollIntoView({ behavior: "smooth", block: "center" });
  setTimeout(() => unwrapCueMarks(marks), 2500);
}

const CUE_PERSIST_CLASS = "ml-persist-hl";
const CUE_PULSE_CLASS = "ml-hl-pulse";

function clearPersistentCueMarks(container: HTMLElement): void {
  unwrapCueMarks(Array.from(container.querySelectorAll<HTMLElement>(`mark.${CUE_PERSIST_CLASS}`)));
}

function applyPersistentCueMarks(container: HTMLElement, highlights: PersistedCueHighlight[]): void {
  clearPersistentCueMarks(container);
  const sorted = [...highlights].sort((a, b) => a.start - b.start);
  for (const h of sorted) {
    wrapCueSegments(findCueSegments(container, h.start, h.end), (mark) => {
      mark.className = CUE_PERSIST_CLASS;
      mark.dataset.hlId = String(h.id);
      mark.dataset.hlStart = String(h.start);
      mark.dataset.hlEnd = String(h.end);
      mark.style.backgroundColor = highlightColorMark(h.color);
      mark.style.color = "inherit";
      mark.style.borderRadius = "2px";
    });
  }
}

function flashOrPulseCueRange(container: HTMLElement, anchor: Pick<HighlightAnchor, "start" | "end">): void {
  const marks = Array.from(
    container.querySelectorAll<HTMLElement>(`mark.${CUE_PERSIST_CLASS}[data-hl-start="${anchor.start}"][data-hl-end="${anchor.end}"]`),
  );
  if (marks.length > 0) {
    marks.forEach((m) => m.classList.add(CUE_PULSE_CLASS));
    marks[0].scrollIntoView({ behavior: "smooth", block: "center" });
    setTimeout(() => marks.forEach((m) => m.classList.remove(CUE_PULSE_CLASS)), 1600);
    return;
  }
  flashCueRange(container, anchor);
}

export function CaptionReaderView({
  book, initialPage, colorMode, fontSize, onProgress,
  noteStatus, noteStatusLoaded, savingNoteSource, onSaveAsNoteSource,
  jumpToHighlight, onJumpToHighlightHandled, onHighlightAdded, isFullscreen,
}: ReaderViewProps) {
  const ext = (book.file_extension || "").toLowerCase() === ".vtt" ? "vtt" : "srt";

  const [pages, setPages] = useState<Cue[][]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(Math.max(1, initialPage || 1));
  const [pageAnim, setPageAnim] = useState<"next" | "prev" | null>(null);
  const [pendingSelection, setPendingSelection] = useState<PendingSelection | null>(null);
  const [highlights, setHighlights] = useState<BookHighlight[]>([]);
  const [progress, setProgress] = useState<{ loaded: number; total: number | null } | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

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
        const cues = parseCaptions(text, ext);
        const p = paginateCues(cues, CUES_PER_PAGE);
        setPages(p);
        setCurrentPage((cp) => Math.min(Math.max(1, cp), p.length));
      })
      .catch(() => {
        if (!cancelled) setError("Could not load this file. It may no longer be available in the library.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [book.id, ext]);

  useEffect(() => {
    if (loading || pages.length === 0) return;
    const t = setTimeout(() => {
      updateBookProgress(book.id, currentPage, pages.length).catch(() => {});
      onProgress?.(currentPage, pages.length);
    }, 600);
    return () => clearTimeout(t);
  }, [currentPage, pages.length, loading, book.id, onProgress]);

  useEffect(() => {
    return () => { window.speechSynthesis?.cancel(); };
  }, []);

  useEffect(() => {
    listBookHighlights(book.id).then(setHighlights).catch(() => {});
  }, [book.id]);

  useEffect(() => {
    if (!containerRef.current) return;
    const onThisPage = highlights.filter((h) => h.page_number === currentPage);
    applyPersistentCueMarks(containerRef.current, onThisPage.map((h) => ({ id: h.id, start: h.start_offset, end: h.end_offset, color: h.color })));
  }, [highlights, currentPage, pages]);

  function goToPage(p: number) {
    if (p < 1 || p > pages.length || p === currentPage) return;
    tts.stop();
    setPendingSelection(null);
    setPageAnim(p > currentPage ? "next" : "prev");
    setCurrentPage(p);
  }

  const swipeHandlers = usePageSwipe(() => goToPage(currentPage - 1), () => goToPage(currentPage + 1));

  function captureCurrentSelection() {
    const container = containerRef.current;
    const sel = window.getSelection();
    if (!container || !sel || sel.isCollapsed || sel.rangeCount === 0 || !container.contains(sel.anchorNode)) {
      setPendingSelection(null);
      return;
    }
    const range = sel.getRangeAt(0);
    const start = offsetInCueText(container, range.startContainer, range.startOffset);
    const end = offsetInCueText(container, range.endContainer, range.endOffset);
    if (start == null || end == null || end <= start) {
      setPendingSelection(null);
      return;
    }
    const rect = range.getBoundingClientRect();
    setPendingSelection({ x: rect.left + rect.width / 2, y: rect.top, start, end });
  }

  useSelectionChangeCapture(containerRef, captureCurrentSelection);

  async function handleAddHighlight(colorId: string) {
    if (!pendingSelection) return;
    const fullText = pageJoinedText(pages[currentPage - 1] || []);
    const snippet = fullText.slice(pendingSelection.start, pendingSelection.end);
    const created = await addBookHighlight(book.id, {
      format: ext,
      page_number: currentPage,
      start_offset: pendingSelection.start,
      end_offset: pendingSelection.end,
      snippet,
      color: colorId,
    });
    setHighlights((prev) => [...prev, created]);
    void onHighlightAdded?.(created.note_id);
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
      if (containerRef.current) flashOrPulseCueRange(containerRef.current, jumpToHighlight);
      onJumpToHighlightHandled?.();
    });
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jumpToHighlight, currentPage, loading]);

  function handleReadAloud() {
    if (tts.playing) {
      if (tts.paused) tts.resume(); else tts.pause();
      return;
    }
    const text = (pages[currentPage - 1] || []).map((c) => c.text).join(". ");
    if (text.trim()) tts.speak(text);
  }

  const colors = readerThemeColors(colorMode);
  const pageCues = pages[currentPage - 1] || [];

  return (
    <>
      <ZoomPanWrapper
        active={!!isFullscreen}
        surfaceClass={readerSurfaceClass(colorMode)}
        onSwipeLeft={() => goToPage(currentPage + 1)}
        onSwipeRight={() => goToPage(currentPage - 1)}
        overlay={!loading && !error ? <PageNavArrows onPrev={() => goToPage(currentPage - 1)} onNext={() => goToPage(currentPage + 1)} canPrev={currentPage > 1} canNext={currentPage < pages.length} /> : undefined}
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
            ref={containerRef}
            onAnimationEnd={() => setPageAnim(null)}
            className={`relative shadow-lg rounded-xl w-full h-fit p-8 ${pageAnim === "next" ? "ml-page-anim-next" : pageAnim === "prev" ? "ml-page-anim-prev" : ""}`}
            style={{ backgroundColor: colors.background, color: colors.foreground }}
          >
            {pageCues.map((cue) => (
              <div key={cue.index} className="mb-3 flex gap-3 leading-relaxed" style={{ fontSize: `${readerFontSizePx(fontSize, 15)}px` }}>
                <span className="select-none shrink-0 w-20 pt-0.5 text-xs" style={{ color: colors.muted }}>
                  {formatTimestamp(cue.startSeconds)}
                </span>
                <span className="cue-text flex-1">{cue.text}</span>
              </div>
            ))}
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
