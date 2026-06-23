import React, { useEffect, useState } from "react";
import { saveAsNoteSource, getNoteSourceStatus, type Book, type BookNoteSourceStatus } from "../api/booksApi";
import { getBookFormat, type HighlightAnchor } from "./book-readers/format";
import { PdfReaderView } from "./book-readers/PdfReaderView";
import { EpubReaderView } from "./book-readers/EpubReaderView";
import { PptxReaderView } from "./book-readers/PptxReaderView";
import { AudioReaderView } from "./book-readers/AudioReaderView";
import { TxtReaderView } from "./book-readers/TxtReaderView";
import { CaptionReaderView } from "./book-readers/CaptionReaderView";
import { ComicReaderView } from "./book-readers/ComicReaderView";
import { MobiReaderView } from "./book-readers/MobiReaderView";
import { ColorModePicker } from "./ColorModePicker";
import { useReaderColorMode } from "../hooks/useReaderColorMode";

interface Props {
  book: Book;
  initialPage: number;
  onClose: () => void;
  onProgress?: (currentPage: number, totalPages: number) => void;
  onAskAI?: (book: Book) => void;
  jumpToHighlight?: HighlightAnchor | null;
  onJumpToHighlightHandled?: () => void;
}

export function BookReader({ book, initialPage, onClose, onProgress, onAskAI, jumpToHighlight, onJumpToHighlightHandled }: Props) {
  const [noteStatus, setNoteStatus] = useState<BookNoteSourceStatus | null>(null);
  const [noteStatusLoaded, setNoteStatusLoaded] = useState(false);
  const [savingNoteSource, setSavingNoteSource] = useState(false);
  const [colorMode, setColorMode] = useReaderColorMode();
  const format = getBookFormat(book);

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
    <div className="flex-1 min-h-0 flex flex-col h-full bg-[var(--ml-bg-base)]">
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
          <ColorModePicker value={colorMode} onChange={setColorMode} />
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

      {noteStatus?.status === "failed" && (
        <div className="px-5 py-2 bg-red-500/10 text-red-400 text-xs shrink-0">
          Note extraction failed{noteStatus.error_message ? `: ${noteStatus.error_message}` : "."}
        </div>
      )}

      {format === "pdf" && <PdfReaderView book={book} initialPage={initialPage} colorMode={colorMode} onProgress={onProgress} jumpToHighlight={jumpToHighlight} onJumpToHighlightHandled={onJumpToHighlightHandled} {...noteSourceProps} />}
      {format === "epub" && <EpubReaderView book={book} initialPage={initialPage} colorMode={colorMode} onProgress={onProgress} jumpToHighlight={jumpToHighlight} onJumpToHighlightHandled={onJumpToHighlightHandled} {...noteSourceProps} />}
      {format === "pptx" && <PptxReaderView book={book} initialPage={initialPage} colorMode={colorMode} onProgress={onProgress} jumpToHighlight={jumpToHighlight} onJumpToHighlightHandled={onJumpToHighlightHandled} {...noteSourceProps} />}
      {format === "audio" && <AudioReaderView book={book} initialPage={initialPage} colorMode={colorMode} onProgress={onProgress} />}
      {format === "txt" && <TxtReaderView book={book} initialPage={initialPage} colorMode={colorMode} onProgress={onProgress} jumpToHighlight={jumpToHighlight} onJumpToHighlightHandled={onJumpToHighlightHandled} {...noteSourceProps} />}
      {(format === "srt" || format === "vtt") && <CaptionReaderView book={book} initialPage={initialPage} colorMode={colorMode} onProgress={onProgress} jumpToHighlight={jumpToHighlight} onJumpToHighlightHandled={onJumpToHighlightHandled} {...noteSourceProps} />}
      {(format === "cbz" || format === "cbr") && <ComicReaderView book={book} initialPage={initialPage} colorMode={colorMode} onProgress={onProgress} />}
      {format === "mobi" && <MobiReaderView book={book} initialPage={initialPage} colorMode={colorMode} onProgress={onProgress} jumpToHighlight={jumpToHighlight} onJumpToHighlightHandled={onJumpToHighlightHandled} />}
      {format === "unsupported" && (
        <div className="flex-1 flex items-center justify-center text-gray-500 text-sm">
          This file type ({book.file_extension || book.mime_type || "unknown"}) isn't supported by the reader yet.
        </div>
      )}
    </div>
  );
}
