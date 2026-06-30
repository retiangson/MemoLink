import React, { useEffect, useRef, useState } from "react";
import { Capacitor } from "@capacitor/core";
import { saveAsNoteSource, getNoteSourceStatus, type Book, type BookNoteSourceStatus } from "../api/booksApi";
import { getBookFormat, type HighlightAnchor } from "./book-readers/format";
import { PdfReaderView } from "./book-readers/PdfReaderView";
import { EpubReaderView } from "./book-readers/EpubReaderView";
import { PptxReaderView } from "./book-readers/PptxReaderView";
import { AudioReaderView } from "./book-readers/AudioReaderView";
import { VideoReaderView } from "./book-readers/VideoReaderView";
import { TxtReaderView } from "./book-readers/TxtReaderView";
import { CaptionReaderView } from "./book-readers/CaptionReaderView";
import { ComicReaderView } from "./book-readers/ComicReaderView";
import { MobiReaderView } from "./book-readers/MobiReaderView";
import { ColorModePicker } from "./ColorModePicker";
import { FontSizePicker } from "./FontSizePicker";
import { useReaderColorMode } from "../hooks/useReaderColorMode";
import { useReaderFontSize } from "../hooks/useReaderFontSize";
import { listSourceAnnotations, type SourceAnnotation } from "../api/smartSourceApi";
import { AnnotationCanvas } from "./smart-source/AnnotationCanvas";

interface Props {
  book: Book;
  initialPage: number;
  onClose: () => void;
  onProgress?: (currentPage: number, totalPages: number) => void;
  onAskAI?: (book: Book) => void;
  jumpToHighlight?: HighlightAnchor | null;
  onJumpToHighlightHandled?: () => void;
  onHighlightAdded?: (noteId: number) => Promise<void> | void;
  /** Called on Capacitor when fullscreen state changes so the parent can hide/show the tab bar. */
  onFullscreenChange?: (isFullscreen: boolean) => void;
  /** True only when this reader tab is the currently visible one. Passed to PdfReaderView so it
   *  can skip canvas renders while hidden (display:none frees the GPU texture) and re-paint
   *  the page when it becomes active again. */
  isActive?: boolean;
}

export function BookReader({ book, initialPage, onClose, onProgress, onAskAI, jumpToHighlight, onJumpToHighlightHandled, onHighlightAdded, onFullscreenChange, isActive }: Props) {
  const [noteStatus, setNoteStatus] = useState<BookNoteSourceStatus | null>(null);
  const [noteStatusLoaded, setNoteStatusLoaded] = useState(false);
  const [savingNoteSource, setSavingNoteSource] = useState(false);
  const [colorMode, setColorMode] = useReaderColorMode();
  const [fontSize, setFontSize] = useReaderFontSize();
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [currentPage, setCurrentPage] = useState(Math.max(1, initialPage));
  const [bookAnnotations, setBookAnnotations] = useState<SourceAnnotation[]>([]);
  const [inkEnabled, setInkEnabled] = useState(false);
  const [inkMessage, setInkMessage] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const format = getBookFormat(book);
  const canFullscreen = format !== "audio" && format !== "video" && format !== "unsupported";
  const isNativePlatform = Capacitor.isNativePlatform();

  // Sync React state with native fullscreen changes (ESC key, focus loss, etc.)
  // Not used on Capacitor/Android where requestFullscreen is unavailable.
  useEffect(() => {
    if (isNativePlatform) return;
    const onFSChange = () => {
      setIsFullscreen(document.fullscreenElement === containerRef.current);
    };
    document.addEventListener("fullscreenchange", onFSChange);
    return () => document.removeEventListener("fullscreenchange", onFSChange);
  }, [isNativePlatform]);

  // On Capacitor, notify parent so it can hide the tab bar (giving a true full-screen
  // reading area without using position:fixed, which causes a black-screen flash on
  // Android WebView when the element is removed).
  useEffect(() => {
    if (!isNativePlatform) return;
    onFullscreenChange?.(isFullscreen);
    return () => { onFullscreenChange?.(false); };
  }, [isFullscreen, isNativePlatform, onFullscreenChange]);

  async function enterFullscreen() {
    if (isNativePlatform) {
      setIsFullscreen(true);
      return;
    }
    try {
      await containerRef.current?.requestFullscreen();
    } catch {
      setIsFullscreen(true);
    }
  }

  function exitFullscreen() {
    if (isNativePlatform || !document.fullscreenElement) {
      setIsFullscreen(false);
    } else {
      document.exitFullscreen().catch(() => {});
    }
  }

  useEffect(() => {
    getNoteSourceStatus(book.id)
      .then(setNoteStatus)
      .catch(() => {})
      .finally(() => setNoteStatusLoaded(true));
  }, [book.id]);

  useEffect(() => {
    if (!noteStatus || (noteStatus.status !== "pending" && noteStatus.status !== "processing")) return;
    const t = setInterval(() => {
      getNoteSourceStatus(book.id).then((s) => setNoteStatus(s)).catch(() => {});
    }, 4000);
    return () => clearInterval(t);
  }, [noteStatus, book.id]);

  useEffect(() => {
    const noteId = noteStatus?.status === "ready" ? noteStatus.note_id : null;
    const sourceFileId = noteStatus?.status === "ready" ? noteStatus.source_file_id : null;
    if (!noteId || !sourceFileId || !isFullscreen) return;
    let cancelled = false;
    listSourceAnnotations(noteId, sourceFileId)
      .then((rows) => { if (!cancelled) setBookAnnotations(rows); })
      .catch(() => { if (!cancelled) setInkMessage("Could not load saved book drawings."); });
    return () => { cancelled = true; };
  }, [book.id, isFullscreen, noteStatus?.note_id, noteStatus?.source_file_id, noteStatus?.status]);

  useEffect(() => {
    if (!isFullscreen) setInkEnabled(false);
  }, [isFullscreen]);

  async function handleSaveAsNoteSource() {
    if (savingNoteSource) return;
    setSavingNoteSource(true);
    try {
      const status = await saveAsNoteSource(book.id);
      setNoteStatus(status);
    } catch {
      getNoteSourceStatus(book.id).then(setNoteStatus).catch(() => {});
    } finally {
      setSavingNoteSource(false);
    }
  }

  async function toggleBookInk() {
    setInkMessage(null);
    if (inkEnabled) {
      setInkEnabled(false);
      return;
    }
    if (noteStatus?.status === "ready" && noteStatus.note_id && noteStatus.source_file_id) {
      setInkEnabled(true);
      return;
    }
    if (noteStatus?.status === "ready") {
      setInkMessage("The book source link is incomplete. Reopen the book after the source workspace is refreshed.");
      return;
    }
    if (noteStatus?.status === "pending" || noteStatus?.status === "processing") {
      setInkMessage("Preparing the book note source. Drawing will be available when extraction finishes.");
      return;
    }
    await handleSaveAsNoteSource();
    setInkMessage("Preparing the book note source. Drawing will be available when extraction finishes.");
  }

  function handleReaderProgress(page: number, totalPages: number) {
    setCurrentPage(Math.max(1, page));
    onProgress?.(page, totalPages);
  }

  const canExtractNotes =
    format === "pdf" || format === "epub" || format === "pptx" ||
    format === "txt" || format === "srt" || format === "vtt" || format === "mobi";

  const noteSourceProps = canExtractNotes
    ? { noteStatus, noteStatusLoaded, savingNoteSource, onSaveAsNoteSource: handleSaveAsNoteSource }
    : {};
  const bookInk = inkEnabled && noteStatus?.note_id && noteStatus.source_file_id
    ? {
        enabled: true,
        noteId: noteStatus.note_id,
        sourceFileId: noteStatus.source_file_id,
        bookId: book.id,
        annotations: bookAnnotations,
      }
    : undefined;

  return (
    <div
      ref={containerRef}
      className={`flex flex-col bg-[var(--ml-bg-base)] ${(isFullscreen && !isNativePlatform) ? "w-full h-full" : "flex-1 min-h-0 h-full"}`}
    >
      {/* ── Top bar ──────────────────────────────────────────────── */}
      {isFullscreen ? (
        <div className="flex items-center justify-between px-4 py-2 border-b border-[var(--ml-bg-hover)] shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <p className="text-xs text-gray-400 truncate max-w-[200px]">{book.title}</p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {onAskAI && <button onClick={() => { exitFullscreen(); onAskAI(book); }} title="Ask AI from this book" className="rounded-lg px-2 py-1 text-[11px] text-indigo-300 hover:bg-indigo-600/20">Ask AI</button>}
            {canExtractNotes && <button onClick={() => void toggleBookInk()} title="Draw, write, or highlight on this book" aria-pressed={inkEnabled} className={`flex h-8 w-8 items-center justify-center rounded-lg ${inkEnabled ? "bg-indigo-600 text-white" : "text-gray-400 hover:bg-[var(--ml-bg-hover)]"}`}><svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2"><path d="m4 20 4.5-1 10-10a2.1 2.1 0 0 0-3-3l-10 10L4 20Z"/><path d="m13.5 8 3 3"/></svg></button>}
            <FontSizePicker value={fontSize} onChange={setFontSize} />
            <ColorModePicker value={colorMode} onChange={setColorMode} />
            <button
              onClick={exitFullscreen}
              title="Exit fullscreen (Esc)"
              className="p-1.5 rounded-lg text-gray-400 hover:text-gray-200 hover:bg-[var(--ml-bg-hover)] transition"
            >
              {/* Arrows-pointing-in / compress icon */}
              <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 9L4 4m5 5H4m5 0V4M15 9l5-5m-5 5h5m-5 0V4M9 15l-5 5m5-5H4m5 0v5M15 15l5 5m-5-5h5m-5 0v5" />
              </svg>
            </button>
          </div>
        </div>
      ) : (
        <div className="flex items-center justify-between px-5 py-3 border-b border-[var(--ml-bg-hover)] shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <button onClick={onClose} className="text-gray-500 hover:text-gray-300 transition shrink-0 flex items-center gap-1" title="Back to library">
              <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
              </svg>
              <span className="text-xs">Library</span>
            </button>
            <div className="min-w-0">
              <p className="text-sm font-medium text-gray-200 truncate">{book.title}</p>
              <p className="text-xs text-gray-600 truncate">{book.author || "Unknown author"}</p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <FontSizePicker value={fontSize} onChange={setFontSize} />
            <ColorModePicker value={colorMode} onChange={setColorMode} />
            {canFullscreen && (
              <button
                onClick={enterFullscreen}
                title="Fullscreen reading mode"
                className="p-1.5 rounded-lg text-gray-400 hover:text-gray-200 hover:bg-[var(--ml-bg-hover)] transition"
              >
                {/* Arrows-pointing-out / expand icon */}
                <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 8V4m0 0h4M4 4l5 5m7-5h4m0 0v4m0-4l-5 5M4 16v4m0 0h4m-4 0l5-5m7 5h4m0 0v-4m0 4l-5-5" />
                </svg>
              </button>
            )}
            {onAskAI && (
              <button
                onClick={() => onAskAI(book)}
                className="px-3 py-1.5 text-xs rounded-lg bg-indigo-600/20 text-indigo-300 hover:bg-indigo-600/30 transition"
              >
                Ask AI from this Book
              </button>
            )}
          </div>
        </div>
      )}

      {noteStatus?.status === "failed" && (
        <div className="px-5 py-2 bg-red-500/10 text-red-400 text-xs shrink-0">
          Note extraction failed{noteStatus.error_message ? `: ${noteStatus.error_message}` : "."}
        </div>
      )}

      {inkMessage && <div className="shrink-0 bg-indigo-500/10 px-4 py-1.5 text-[11px] text-indigo-300">{inkMessage}</div>}

      <div className="relative flex min-h-0 flex-1 flex-col">

      {format === "pdf" && <PdfReaderView book={book} initialPage={initialPage} colorMode={colorMode} fontSize={fontSize} onProgress={handleReaderProgress} jumpToHighlight={jumpToHighlight} onJumpToHighlightHandled={onJumpToHighlightHandled} onHighlightAdded={onHighlightAdded} isFullscreen={isFullscreen} isActive={isActive} bookInk={bookInk} {...noteSourceProps} />}
      {format === "epub" && <EpubReaderView book={book} initialPage={initialPage} colorMode={colorMode} fontSize={fontSize} onProgress={handleReaderProgress} jumpToHighlight={jumpToHighlight} onJumpToHighlightHandled={onJumpToHighlightHandled} onHighlightAdded={onHighlightAdded} isFullscreen={isFullscreen} {...noteSourceProps} />}
      {format === "pptx" && <PptxReaderView book={book} initialPage={initialPage} colorMode={colorMode} fontSize={fontSize} onProgress={handleReaderProgress} jumpToHighlight={jumpToHighlight} onJumpToHighlightHandled={onJumpToHighlightHandled} onHighlightAdded={onHighlightAdded} isFullscreen={isFullscreen} {...noteSourceProps} />}
      {format === "audio" && <AudioReaderView book={book} initialPage={initialPage} colorMode={colorMode} fontSize={fontSize} onProgress={handleReaderProgress} />}
      {format === "video" && <VideoReaderView book={book} initialPage={initialPage} colorMode={colorMode} fontSize={fontSize} onProgress={handleReaderProgress} />}
      {format === "txt" && <TxtReaderView book={book} initialPage={initialPage} colorMode={colorMode} fontSize={fontSize} onProgress={handleReaderProgress} jumpToHighlight={jumpToHighlight} onJumpToHighlightHandled={onJumpToHighlightHandled} onHighlightAdded={onHighlightAdded} isFullscreen={isFullscreen} {...noteSourceProps} />}
      {(format === "srt" || format === "vtt") && <CaptionReaderView book={book} initialPage={initialPage} colorMode={colorMode} fontSize={fontSize} onProgress={handleReaderProgress} jumpToHighlight={jumpToHighlight} onJumpToHighlightHandled={onJumpToHighlightHandled} onHighlightAdded={onHighlightAdded} isFullscreen={isFullscreen} {...noteSourceProps} />}
      {(format === "cbz" || format === "cbr") && <ComicReaderView book={book} initialPage={initialPage} colorMode={colorMode} fontSize={fontSize} onProgress={handleReaderProgress} isFullscreen={isFullscreen} />}
      {format === "mobi" && <MobiReaderView book={book} initialPage={initialPage} colorMode={colorMode} fontSize={fontSize} onProgress={handleReaderProgress} jumpToHighlight={jumpToHighlight} onJumpToHighlightHandled={onJumpToHighlightHandled} onHighlightAdded={onHighlightAdded} isFullscreen={isFullscreen} {...noteSourceProps} />}
      {format === "unsupported" && (
        <div className="flex-1 flex items-center justify-center text-gray-500 text-sm">
          This file type ({book.file_extension || book.mime_type || "unknown"}) isn't supported by the reader yet.
        </div>
      )}
      {format !== "pdf" && isFullscreen && bookInk && (
        <div className="absolute inset-0 z-30 bg-transparent">
          <AnnotationCanvas noteId={bookInk.noteId} sourceFileId={bookInk.sourceFileId} bookId={bookInk.bookId} pageNumber={currentPage} annotations={bookInk.annotations} onPersisted={() => undefined} />
        </div>
      )}
      </div>
    </div>
  );
}
