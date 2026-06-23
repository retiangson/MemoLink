import React, { useEffect, useState } from "react";
import { saveAsNoteSource, getNoteSourceStatus, type Book, type BookNoteSourceStatus } from "../api/booksApi";
import {
  getBookFormat,
  isReaderColorMode,
  READER_COLOR_MODE_LABELS,
  READER_COLOR_MODES,
  type ReaderColorMode,
} from "./book-readers/format";
import { PdfReaderView } from "./book-readers/PdfReaderView";
import { EpubReaderView } from "./book-readers/EpubReaderView";
import { AudioReaderView } from "./book-readers/AudioReaderView";

const READER_COLOR_MODE_KEY = "memolink_reader_color_mode";

interface Props {
  book: Book;
  initialPage: number;
  onClose: () => void;
  onProgress?: (currentPage: number, totalPages: number) => void;
  onAskAI?: (book: Book) => void;
}

export function BookReader({ book, initialPage, onClose, onProgress, onAskAI }: Props) {
  const [noteStatus, setNoteStatus] = useState<BookNoteSourceStatus | null>(null);
  const [noteStatusLoaded, setNoteStatusLoaded] = useState(false);
  const [savingNoteSource, setSavingNoteSource] = useState(false);
  const [colorMode, setColorMode] = useState<ReaderColorMode>(() => {
    const saved = localStorage.getItem(READER_COLOR_MODE_KEY);
    return isReaderColorMode(saved) ? saved : "dark";
  });
  const format = getBookFormat(book);

  function handleColorModeChange(next: ReaderColorMode) {
    setColorMode(next);
    localStorage.setItem(READER_COLOR_MODE_KEY, next);
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

  const canExtractNotes = format === "pdf" || format === "epub";

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
          <div className="hidden sm:flex items-center gap-1 rounded-lg bg-[var(--ml-bg-surface)] p-1 border border-[var(--ml-bg-hover)]" aria-label="Reading mode">
            {READER_COLOR_MODES.map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => handleColorModeChange(mode)}
                className={`px-2.5 py-1 text-[11px] rounded-md transition ${
                  colorMode === mode
                    ? "bg-indigo-600 text-white"
                    : "text-gray-500 hover:text-gray-200 hover:bg-[var(--ml-bg-hover)]"
                }`}
              >
                {READER_COLOR_MODE_LABELS[mode]}
              </button>
            ))}
          </div>
          <select
            aria-label="Reading mode"
            value={colorMode}
            onChange={(e) => {
              const next = e.target.value;
              if (isReaderColorMode(next)) handleColorModeChange(next);
            }}
            className="sm:hidden bg-[var(--ml-bg-surface)] border border-[var(--ml-bg-hover)] rounded-lg px-2 py-1.5 text-xs text-gray-300"
          >
            {READER_COLOR_MODES.map((mode) => (
              <option key={mode} value={mode}>{READER_COLOR_MODE_LABELS[mode]}</option>
            ))}
          </select>
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

      {format === "pdf" && <PdfReaderView book={book} initialPage={initialPage} colorMode={colorMode} onProgress={onProgress} {...noteSourceProps} />}
      {format === "epub" && <EpubReaderView book={book} initialPage={initialPage} colorMode={colorMode} onProgress={onProgress} {...noteSourceProps} />}
      {format === "audio" && <AudioReaderView book={book} initialPage={initialPage} colorMode={colorMode} onProgress={onProgress} />}
      {format === "unsupported" && (
        <div className="flex-1 flex items-center justify-center text-gray-500 text-sm">
          This file type ({book.file_extension || book.mime_type || "unknown"}) isn't supported by the reader yet.
        </div>
      )}
    </div>
  );
}
