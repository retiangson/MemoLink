import React, { useEffect, useRef, useState } from "react";
import { fetchBookSlides, updateBookProgress, addBookHighlight, listBookHighlights, type BookHighlight } from "../../api/booksApi";
import type { ReaderViewProps } from "./format";
import { readerSurfaceClass, readerThemeColors } from "./format";
import { useTTS } from "../../hooks/useTTS";
import { usePageSwipe } from "../../hooks/usePageSwipe";
import { useHighlightColor } from "../../hooks/useHighlightColor";
import { TTSPlayerBar } from "../TTSPlayerBar";
import { NoteSourceButton } from "./NoteSourceButton";
import { HighlightColorPicker } from "./HighlightColorPicker";
import { PageNavArrows } from "./PageNavArrows";
import { ReaderLoadingState } from "./ReaderLoadingState";
import { captureSelectionInContainer, captureSettledTouchSelection, applyPersistentMarks, flashOrPulseRange } from "./domTextHighlight";
import { ZoomPanWrapper } from "./ZoomPanWrapper";

interface PendingSelection { x: number; y: number; start: number; end: number; }

// Slides are extracted server-side via python-pptx (title + bullet text + embedded
// images as HTML) since there's no LibreOffice-free way to render PPTX visually —
// this gives a readable, Lambda-compatible stand-in for a true slide renderer.
export function PptxReaderView({
  book, initialPage, colorMode, onProgress,
  noteStatus, noteStatusLoaded, savingNoteSource, onSaveAsNoteSource,
  jumpToHighlight, onJumpToHighlightHandled, onHighlightAdded, isFullscreen,
}: ReaderViewProps) {
  const [slides, setSlides] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [currentSlide, setCurrentSlide] = useState(Math.max(1, initialPage || 1));
  const [slideAnim, setSlideAnim] = useState<"next" | "prev" | null>(null);
  const [pendingSelection, setPendingSelection] = useState<PendingSelection | null>(null);
  const [highlights, setHighlights] = useState<BookHighlight[]>([]);
  const slideRef = useRef<HTMLDivElement | null>(null);

  const tts = useTTS();
  const [highlightColor, setHighlightColor] = useHighlightColor();

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchBookSlides(book.id)
      .then((s) => {
        if (cancelled) return;
        setSlides(s);
        setCurrentSlide((p) => Math.min(Math.max(1, p), Math.max(1, s.length)));
      })
      .catch(() => {
        if (!cancelled) setError("Could not load this presentation. It may no longer be available in the library.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [book.id]);

  useEffect(() => {
    listBookHighlights(book.id).then(setHighlights).catch(() => {});
  }, [book.id]);

  // Re-paint persisted highlights every time the slide content actually changes —
  // dangerouslySetInnerHTML replaces the DOM wholesale, wiping any previous marks.
  useEffect(() => {
    if (!slideRef.current) return;
    const onThisSlide = highlights.filter((h) => h.page_number === currentSlide);
    applyPersistentMarks(slideRef.current, onThisSlide.map((h) => ({ id: h.id, start: h.start_offset, end: h.end_offset, color: h.color })));
  }, [highlights, currentSlide, slides]);

  useEffect(() => {
    if (loading || slides.length === 0) return;
    const t = setTimeout(() => {
      updateBookProgress(book.id, currentSlide, slides.length).catch(() => {});
      onProgress?.(currentSlide, slides.length);
    }, 600);
    return () => clearTimeout(t);
  }, [currentSlide, slides.length, loading, book.id, onProgress]);

  useEffect(() => {
    return () => { window.speechSynthesis?.cancel(); };
  }, []);

  function goToSlide(p: number) {
    if (p < 1 || p > slides.length || p === currentSlide) return;
    tts.stop();
    setPendingSelection(null);
    setSlideAnim(p > currentSlide ? "next" : "prev");
    setCurrentSlide(p);
  }

  const swipeHandlers = usePageSwipe(() => goToSlide(currentSlide - 1), () => goToSlide(currentSlide + 1));

  function captureCurrentSelection() {
    const container = slideRef.current;
    if (!container) {
      setPendingSelection(null);
      return;
    }
    setPendingSelection(captureSelectionInContainer(container));
  }

  async function handleAddHighlight(colorId: string) {
    if (!pendingSelection || !slideRef.current) return;
    const snippet = (slideRef.current.textContent || "").slice(pendingSelection.start, pendingSelection.end);
    const created = await addBookHighlight(book.id, {
      format: "pptx",
      page_number: currentSlide,
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

  // Arrival from a Note double-click: switch to the highlight's slide if needed, then pulse
  // its persistent mark (or flash, if it hasn't rendered yet).
  useEffect(() => {
    if (loading || !jumpToHighlight) return;
    if (jumpToHighlight.page !== currentSlide) {
      goToSlide(jumpToHighlight.page);
      return;
    }
    const raf = requestAnimationFrame(() => {
      if (slideRef.current) flashOrPulseRange(slideRef.current, jumpToHighlight);
      onJumpToHighlightHandled?.();
    });
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jumpToHighlight, currentSlide, loading]);

  function handleReadAloud() {
    if (tts.playing) {
      if (tts.paused) tts.resume(); else tts.pause();
      return;
    }
    const text = slideRef.current?.textContent || "";
    if (text.trim()) tts.speak(text);
  }

  const colors = readerThemeColors(colorMode);

  return (
    <>
      <ZoomPanWrapper
        active={!!isFullscreen}
        surfaceClass={readerSurfaceClass(colorMode)}
        onSwipeLeft={() => goToSlide(currentSlide + 1)}
        onSwipeRight={() => goToSlide(currentSlide - 1)}
        overlay={!loading && !error ? <PageNavArrows onPrev={() => goToSlide(currentSlide - 1)} onNext={() => goToSlide(currentSlide + 1)} canPrev={currentSlide > 1} canNext={currentSlide < slides.length} /> : undefined}
      >
      <div
        className={`flex-1 ${isFullscreen ? "overflow-visible" : "overflow-auto"} flex justify-center py-6 px-4 relative transition-colors ${readerSurfaceClass(colorMode)}`}
        {...(!isFullscreen ? swipeHandlers : {})}
      >
        {loading ? (
          <ReaderLoadingState book={book} colorMode={colorMode} label="Loading presentation, please wait" />
        ) : error ? (
          <div className="flex items-center justify-center text-red-400 text-sm">{error}</div>
        ) : (
          <div
            ref={slideRef}
            onAnimationEnd={() => setSlideAnim(null)}
            onMouseUp={captureCurrentSelection}
            onTouchEnd={() => captureSettledTouchSelection(captureCurrentSelection)}
            className={`pptx-slide relative shadow-lg rounded-xl max-w-2xl w-full h-fit p-10 ${slideAnim === "next" ? "ml-page-anim-next" : slideAnim === "prev" ? "ml-page-anim-prev" : ""}`}
            style={{ backgroundColor: colors.background, color: colors.foreground }}
            dangerouslySetInnerHTML={{ __html: slides[currentSlide - 1] || "" }}
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
              onClick={() => goToSlide(currentSlide - 1)}
              disabled={currentSlide <= 1}
              className="px-2.5 py-1.5 text-xs rounded-lg text-gray-400 border border-[var(--ml-bg-hover)] hover:bg-[var(--ml-bg-hover)] transition disabled:opacity-30"
            >
              Prev
            </button>
            <span className="text-xs text-gray-500 w-24 text-center shrink-0">
              Slide {currentSlide} / {slides.length}
            </span>
            <button
              onClick={() => goToSlide(currentSlide + 1)}
              disabled={currentSlide >= slides.length}
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
