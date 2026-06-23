import type { Book } from "../../api/booksApi";
import type { BookNoteSourceStatus } from "../../api/booksApi";

export type BookFormat = "pdf" | "epub" | "audio" | "unsupported";
export type ReaderColorMode = "dark" | "light" | "sepia";

export interface ReaderViewProps {
  book: Book;
  initialPage: number;
  colorMode: ReaderColorMode;
  onProgress?: (currentPage: number, totalPages: number) => void;
  noteStatus?: BookNoteSourceStatus | null;
  noteStatusLoaded?: boolean;
  savingNoteSource?: boolean;
  onSaveAsNoteSource?: () => void;
}

export const READER_COLOR_MODE_LABELS: Record<ReaderColorMode, string> = {
  dark: "Dark",
  light: "Light",
  sepia: "Sepia",
};

export const READER_COLOR_MODES: ReaderColorMode[] = ["dark", "light", "sepia"];

export function isReaderColorMode(value: string | null): value is ReaderColorMode {
  return value === "dark" || value === "light" || value === "sepia";
}

export function readerSurfaceClass(mode: ReaderColorMode): string {
  if (mode === "light") return "bg-slate-100 text-slate-900";
  if (mode === "sepia") return "bg-[#efe4cf] text-[#332719]";
  return "bg-[var(--ml-bg-base)] text-gray-100";
}

export function pdfCanvasFilter(mode: ReaderColorMode): string {
  if (mode === "dark") return "invert(1) hue-rotate(180deg) contrast(0.92) brightness(0.86)";
  if (mode === "sepia") return "sepia(0.2) saturate(0.92) brightness(0.98)";
  return "none";
}

export function epubThemeColors(mode: ReaderColorMode): { background: string; foreground: string; muted: string; link: string } {
  if (mode === "light") {
    return { background: "#f8fafc", foreground: "#111827", muted: "#475569", link: "#4338ca" };
  }
  if (mode === "sepia") {
    return { background: "#efe4cf", foreground: "#332719", muted: "#705f4a", link: "#8b5e20" };
  }
  return { background: "#0f0f13", foreground: "#e5e7eb", muted: "#9ca3af", link: "#a5b4fc" };
}

const AUDIO_EXTENSIONS = new Set([".mp3", ".m4a", ".m4b", ".aac", ".wav", ".ogg"]);

export function getBookFormat(book: Pick<Book, "file_extension" | "mime_type">): BookFormat {
  const ext = (book.file_extension || "").toLowerCase();
  if (ext === ".pdf") return "pdf";
  if (ext === ".epub") return "epub";
  if (AUDIO_EXTENSIONS.has(ext)) return "audio";

  const mime = (book.mime_type || "").toLowerCase();
  if (mime === "application/pdf") return "pdf";
  if (mime === "application/epub+zip") return "epub";
  if (mime.startsWith("audio/")) return "audio";

  return "unsupported";
}

export function formatTimestamp(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mm = String(m).padStart(h > 0 ? 2 : 1, "0");
  const ss = String(sec).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

/** Maps each sentence (as produced by splitSentences) to its start offset within fullText. */
export function computeSentenceOffsets(fullText: string, sentences: string[]): number[] {
  const offsets: number[] = [];
  let searchFrom = 0;
  for (const s of sentences) {
    const idx = fullText.indexOf(s, searchFrom);
    const start = idx === -1 ? searchFrom : idx;
    offsets.push(start);
    searchFrom = start + s.length;
  }
  return offsets;
}

/** Index of the sentence (from splitSentences) that contains charOffset within fullText. */
export function findSentenceIndexForOffset(fullText: string, sentences: string[], charOffset: number): number {
  const offsets = computeSentenceOffsets(fullText, sentences);
  let idx = 0;
  for (let i = 0; i < offsets.length; i++) {
    if (offsets[i] <= charOffset) idx = i;
    else break;
  }
  return idx;
}

/** Absolute [start, end) char range within fullText currently being spoken by useTTS. */
export function currentHighlightRange(
  fullText: string,
  sentences: string[],
  sentenceIdx: number,
  word: { start: number; end: number } | null,
): { start: number; end: number } | null {
  if (sentenceIdx < 0 || sentenceIdx >= sentences.length) return null;
  const sentStart = computeSentenceOffsets(fullText, sentences)[sentenceIdx];
  const sentence = sentences[sentenceIdx];
  if (word) return { start: sentStart + word.start, end: sentStart + word.end };
  return { start: sentStart, end: sentStart + sentence.length };
}
