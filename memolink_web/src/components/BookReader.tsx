import React, { useEffect, useRef, useState } from "react";
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

interface Props {
  book: Book;
  initialPage: number;
  onClose: () => void;
  onProgress?: (currentPage: number, totalPages: number) => void;
  onAskAI?: (book: Book) => void;
  jumpToHighlight?: HighlightAnchor | null;
  onJumpToHighlightHandled?: () => void;
  onHighlightAdded?: () => void;
}

export function BookReader({ book, initialPage, onClose, onProgress, onAskAI, jumpToHighlight, onJumpToHighlightHandled, onHighlightAdded }: Props) {
  const [noteStatus, setNoteStatus] = useState<BookNoteSourceStatus | null>(null);
  const [noteStatusLoaded, setNoteStatusLoaded] = useState(false);
  const [savingNoteSource, setSavingNoteSource] = useState(false);
  const [colorMode, setColorMode] = useReaderColorMode();
  const [fontSize, setFontSize] = useReaderFontSize();
  const [isFullscreen, setIsFullscreen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const format = getBookFormat(book);
  const canFullscreen = format !== "audio" && format !== "video" && format !== "unsupported";

  // Sync React state with native fullscreen changes (ESC key, focus loss, etc.)
  useEffect(() => {
    const onFSChange = () => {
      setIsFullscreen(document.fullscreenElement === containerRef.current);
    };
    document.addEventListener("fullscreenchange", onFSChange);
    return () => document.removeEventListener("fullscreenchange", onFSChange);
  }, []);

  async function enterFullscreen() {
    try {
      await containerRef.current?.requestFullscreen();
    } catch {
      // requestFullscreen can be rejected in sandboxed iframes — fall back to CSS overlay
      setIsFullscreen(true);
    }
  }

  function exitFullscreen() {
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {});
    } else {
      setIsFullscreen(false);
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

  async function handleSaveAsNoteSource() {
    if (savingNoteSource || noteStatus?.status === "processing") return;
    setSavingNoteSource(true);
    try {
      const status = await saveAsNoteSource(book.id);
      setNoteStatus(status);
    } catch {
      // ignore
    } finally {
      setSavingNoteSource(false);
    }
  }

  const canExtractNotes =
    format === "pdf" || format === "epub" || format === "pptx" ||
    format === "txt" || format === "srt" || format === "vtt";

  const noteSourceProps = canExtractNotes
    ? { noteStatus, noteStatusLoaded, savingNoteSource, onSaveAsNoteSource: handleSaveAsNoteSource }
    : {};

  return (
    <div
      ref={containerRef}
      className={`flex flex-col bg-[var(--ml-bg-base)] ${isFullscreen ? "w-full h-full" : "flex-1 min-h-0 h-full"}`}
    >
      {/* ── Top bar ──────────────────────────────────────────────── */}
      {isFullscreen ? (
        <div className="flex items-center justify-between px-4 py-2 border-b border-[var(--ml-bg-hover)] shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <p className="text-xs text-gray-400 truncate max-w-[200px]">{book.title}</p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
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

      {format === "pdf" && <PdfReaderView book={book} initialPage={initialPage} colorMode={colorMode} fontSize={fontSize} onProgress={onProgress} jumpToHighlight={jumpToHighlight} onJumpToHighlightHandled={onJumpToHighlightHandled} onHighlightAdded={onHighlightAdded} isFullscreen={isFullscreen} {...noteSourceProps} />}
      {format === "epub" && <EpubReaderView book={book} initialPage={initialPage} colorMode={colorMode} fontSize={fontSize} onProgress={onProgress} jumpToHighlight={jumpToHighlight} onJumpToHighlightHandled={onJumpToHighlightHandled} onHighlightAdded={onHighlightAdded} isFullscreen={isFullscreen} {...noteSourceProps} />}
      {format === "pptx" && <PptxReaderView book={book} initialPage={initialPage} colorMode={colorMode} fontSize={fontSize} onProgress={onProgress} jumpToHighlight={jumpToHighlight} onJumpToHighlightHandled={onJumpToHighlightHandled} onHighlightAdded={onHighlightAdded} isFullscreen={isFullscreen} {...noteSourceProps} />}
      {format === "audio" && <AudioReaderView book={book} initialPage={initialPage} colorMode={colorMode} fontSize={fontSize} onProgress={onProgress} />}
      {format === "video" && <VideoReaderView book={book} initialPage={initialPage} colorMode={colorMode} fontSize={fontSize} onProgress={onProgress} />}
      {format === "txt" && <TxtReaderView book={book} initialPage={initialPage} colorMode={colorMode} fontSize={fontSize} onProgress={onProgress} jumpToHighlight={jumpToHighlight} onJumpToHighlightHandled={onJumpToHighlightHandled} onHighlightAdded={onHighlightAdded} isFullscreen={isFullscreen} {...noteSourceProps} />}
      {(format === "srt" || format === "vtt") && <CaptionReaderView book={book} initialPage={initialPage} colorMode={colorMode} fontSize={fontSize} onProgress={onProgress} jumpToHighlight={jumpToHighlight} onJumpToHighlightHandled={onJumpToHighlightHandled} onHighlightAdded={onHighlightAdded} isFullscreen={isFullscreen} {...noteSourceProps} />}
      {(format === "cbz" || format === "cbr") && <ComicReaderView book={book} initialPage={initialPage} colorMode={colorMode} fontSize={fontSize} onProgress={onProgress} isFullscreen={isFullscreen} />}
      {format === "mobi" && <MobiReaderView book={book} initialPage={initialPage} colorMode={colorMode} fontSize={fontSize} onProgress={onProgress} jumpToHighlight={jumpToHighlight} onJumpToHighlightHandled={onJumpToHighlightHandled} onHighlightAdded={onHighlightAdded} isFullscreen={isFullscreen} />}
      {format === "unsupported" && (
        <div className="flex-1 flex items-center justify-center text-gray-500 text-sm">
          This file type ({book.file_extension || book.mime_type || "unknown"}) isn't supported by the reader yet.
        </div>
      )}
    </div>
  );
}
